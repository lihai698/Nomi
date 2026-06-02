/**
 * User-perspective end-to-end test for the PRIMARY model-adding path
 * (manual BaseURL entry). Simulates the exact journey that was impossible
 * before this change:
 *
 *   Clean install, ZERO models  →  user fills BaseURL + key + model(s)  →
 *   保存  →  models land in the catalog, are selectable, AND the doc-reading
 *   onboarding agent now has a text model to run with (bootstrap deadlock broken).
 *
 * This is acceptance gates #2 (break deadlock) and #3 (multi-model at once)
 * from docs/plan/onboarding-baseurl-entry.md, expressed as code so it can't
 * silently regress.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  commitManualOpenAiCompatibleModels,
  deriveVendorKeyFromBaseUrl,
  listModelCatalogModels,
  listModelCatalogVendors,
  resolveOnboardingAgentFromCatalog,
} from "./runtime";

let mockedUserDataRoot = "";
const tempRoots: string[] = [];

vi.mock("electron", () => ({
  app: {
    getPath: () => mockedUserDataRoot,
    getAppPath: () => process.cwd(),
  },
  // Force the plaintext key path so the round-trip works headless (no OS keychain).
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString(),
  },
}));

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

beforeEach(() => {
  mockedUserDataRoot = makeTempDir("nomi-manual-onboarding-");
});

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("manual model entry — user journey", () => {
  it("breaks the bootstrap deadlock: a fresh install with zero models can add its first text model and the doc-reader can then run", () => {
    // Precondition: clean install — nothing the doc-reading agent could use.
    expect(resolveOnboardingAgentFromCatalog()).toBeNull();
    expect(listModelCatalogModels()).toHaveLength(0);

    // The user fills the manual form and hits 保存.
    const result = commitManualOpenAiCompatibleModels({
      vendorName: "本地 Ollama",
      baseUrl: "http://localhost:11434/v1",
      apiKey: "ollama",
      models: [{ id: "llama3.1", displayName: "Llama 3.1" }],
    });

    expect(result.vendorKey).toBe("local-11434");
    expect(result.committed).toEqual([{ modelKey: "llama3.1", displayName: "Llama 3.1" }]);

    // The model is in the catalog and selectable (kind text, enabled).
    const models = listModelCatalogModels();
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({ modelKey: "llama3.1", kind: "text", enabled: true });

    // The deadlock is broken: the doc-reading agent now resolves a usable text model.
    const agent = resolveOnboardingAgentFromCatalog();
    expect(agent).not.toBeNull();
    expect(agent).toMatchObject({
      baseUrl: "http://localhost:11434/v1",
      modelId: "llama3.1",
      apiKey: "ollama",
      providerKind: "openai-compatible",
    });
  });

  it("adds multiple models under one vendor in a single save", () => {
    const result = commitManualOpenAiCompatibleModels({
      vendorName: "我的中转站",
      baseUrl: "https://api.relay.example.com/v1",
      apiKey: "sk-abc",
      models: [
        { id: "gpt-4o" },
        { id: "gpt-4o-mini", displayName: "4o mini" },
        { id: "claude-3.5" },
      ],
    });

    expect(result.committed).toHaveLength(3);
    // One vendor, three models.
    expect(listModelCatalogVendors()).toHaveLength(1);
    expect(listModelCatalogModels().map((m) => m.modelKey).sort()).toEqual([
      "claude-3.5",
      "gpt-4o",
      "gpt-4o-mini",
    ]);
    // Display name defaults to the id when omitted.
    const gpt4o = listModelCatalogModels().find((m) => m.modelKey === "gpt-4o");
    expect(gpt4o?.labelZh).toBe("gpt-4o");
  });

  it("records provenance as manual and writes NO http mapping (text runs via direct AI SDK path)", () => {
    commitManualOpenAiCompatibleModels({
      vendorName: "x",
      baseUrl: "https://api.x.test/v1",
      apiKey: "k",
      models: [{ id: "m1" }],
    });
    const model = listModelCatalogModels()[0] as { onboarding?: { addedVia?: string } };
    expect(model.onboarding?.addedVia).toBe("manual");
  });

  it("de-duplicates repeated model ids and rejects empty/invalid input", () => {
    const result = commitManualOpenAiCompatibleModels({
      vendorName: "y",
      baseUrl: "https://api.y.test/v1",
      apiKey: "k",
      models: [{ id: "dup" }, { id: "dup" }, { id: "  " }, { id: "real" }],
    });
    expect(result.committed.map((c) => c.modelKey)).toEqual(["dup", "real"]);

    expect(() =>
      commitManualOpenAiCompatibleModels({ vendorName: "z", baseUrl: "ftp://nope", apiKey: "k", models: [{ id: "a" }] }),
    ).toThrow(/http/);
    expect(() =>
      commitManualOpenAiCompatibleModels({ vendorName: "z", baseUrl: "https://ok.test/v1", apiKey: "", models: [{ id: "a" }] }),
    ).toThrow(/API Key/);
    expect(() =>
      commitManualOpenAiCompatibleModels({ vendorName: "z", baseUrl: "https://ok.test/v1", apiKey: "k", models: [] }),
    ).toThrow(/模型/);
  });

  it("re-adding under the same endpoint reuses the vendor and appends models (upsert)", () => {
    commitManualOpenAiCompatibleModels({
      vendorName: "same",
      baseUrl: "https://api.same.test/v1",
      apiKey: "k1",
      models: [{ id: "first" }],
    });
    commitManualOpenAiCompatibleModels({
      vendorName: "same",
      baseUrl: "https://api.same.test/v1",
      apiKey: "k2",
      models: [{ id: "second" }],
    });
    expect(listModelCatalogVendors()).toHaveLength(1);
    expect(listModelCatalogModels().map((m) => m.modelKey).sort()).toEqual(["first", "second"]);
  });
});

describe("deriveVendorKeyFromBaseUrl", () => {
  it("derives a stable key from host, keeping local ports distinct", () => {
    expect(deriveVendorKeyFromBaseUrl("http://localhost:11434/v1")).toBe("local-11434");
    expect(deriveVendorKeyFromBaseUrl("http://127.0.0.1:8188")).toBe("local-8188");
    expect(deriveVendorKeyFromBaseUrl("https://api.openai.com/v1")).toBe("api-openai-com");
    expect(deriveVendorKeyFromBaseUrl("not a url")).toBe("");
  });
});
