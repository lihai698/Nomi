import { describe, it, expect } from "vitest";
import { buildPlannedNodeMeta } from "./plannedNodeMeta";
import { buildAgentModelEntries, type AgentModelEntry } from "./availableModels";
import type { ModelOption } from "../../../config/models";

function entryByKey(): Map<string, AgentModelEntry> {
  const entries = buildAgentModelEntries([
    { value: "seedance-2", label: "即梦 Seedance", vendor: "kie", meta: { archetypeId: "seedance-2" } } as ModelOption,
  ]);
  return new Map(entries.map((e) => [e.modelKey, e]));
}

describe("buildPlannedNodeMeta", () => {
  it("无 modelKey 返回 undefined（走原自动选）", () => {
    expect(buildPlannedNodeMeta({}, entryByKey())).toBeUndefined();
  });

  it("modelKey 不在清单返回 undefined", () => {
    expect(buildPlannedNodeMeta({ modelKey: "not-available" }, entryByKey())).toBeUndefined();
  });

  it("有效 modelKey 自铺全 vendor/label/archetype + 默认参数", () => {
    const meta = buildPlannedNodeMeta({ modelKey: "seedance-2" }, entryByKey());
    expect(meta).toBeTruthy();
    expect(meta!.modelKey).toBe("seedance-2");
    expect(meta!.modelVendor).toBe("kie");
    expect(meta!.modelLabel).toBe("即梦 Seedance");
    expect(meta!.archetype).toMatchObject({ id: "seedance-2" });
    // 默认参数已铺（seedance aspect_ratio 默认 16:9）
    expect(meta!.aspect_ratio).toBe("16:9");
  });

  it("agent 的合法参数覆盖默认", () => {
    const meta = buildPlannedNodeMeta(
      { modelKey: "seedance-2", params: { aspect_ratio: "9:16" } },
      entryByKey(),
    );
    expect(meta!.aspect_ratio).toBe("9:16");
  });

  it("非法参数值被丢弃，保留默认", () => {
    const meta = buildPlannedNodeMeta(
      { modelKey: "seedance-2", params: { aspect_ratio: "999:1" } },
      entryByKey(),
    );
    expect(meta!.aspect_ratio).toBe("16:9"); // 非法 → 回默认
  });

  it("非标量参数值被忽略", () => {
    const meta = buildPlannedNodeMeta(
      { modelKey: "seedance-2", params: { aspect_ratio: { bad: 1 } } },
      entryByKey(),
    );
    expect(meta!.aspect_ratio).toBe("16:9");
  });
});
