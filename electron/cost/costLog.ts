/**
 * Phase E Task E10 — Per-project cost tracking (P0).
 *
 * Writes a jsonl line per AI generation invocation to:
 *   <projectRoot>/<projectName>/logs/cost-log.jsonl
 *
 * Each line is a single CostEntry. Append-only; never overwrites.
 *
 * IMPORTANT: Cost figures are ESTIMATES based on a static price table
 * (`providerCostTable.ts`). They are explicitly meant to be "have
 * something rather than nothing" — accuracy improves over time as the
 * table is updated against real billing. The UI must surface the
 * estimate-not-billing nature.
 */

import fs from "node:fs";
import path from "node:path";
import { estimateCost, type CostEstimateInput } from "./providerCostTable";

export type CostEntry = {
  ts: number;
  provider: string;
  model: string;
  kind: "text" | "image" | "video" | "audio" | "unknown";
  cost: number;          // USD
  unit: "estimate";
  tokens?: number;       // for text models
  durationSec?: number;  // for video/audio
  pixels?: number;       // for image models
  nodeId?: string;
  projectId?: string;
  vendorRequestId?: string;
};

export type LogCostInput = CostEstimateInput & {
  projectsRoot: string;
  projectId?: string;
  nodeId?: string;
  vendorRequestId?: string;
};

/**
 * Append one cost line to the project's cost-log.jsonl.
 * Fails silently (writes to stderr) if anything goes wrong — cost logging
 * MUST NEVER break a generation call.
 */
export function logCostEntry(input: LogCostInput): CostEntry | null {
  const estimate = estimateCost(input);
  if (estimate == null) return null;

  const entry: CostEntry = {
    ts: Date.now(),
    provider: input.provider,
    model: input.model,
    kind: input.kind,
    cost: estimate,
    unit: "estimate",
    ...(input.tokens != null ? { tokens: input.tokens } : {}),
    ...(input.durationSec != null ? { durationSec: input.durationSec } : {}),
    ...(input.pixels != null ? { pixels: input.pixels } : {}),
    ...(input.nodeId ? { nodeId: input.nodeId } : {}),
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.vendorRequestId ? { vendorRequestId: input.vendorRequestId } : {}),
  };

  try {
    const projectDir = locateProjectDir(input.projectsRoot, input.projectId);
    if (!projectDir) return entry; // no project to attribute to; still return for UI
    const logsDir = path.join(projectDir, "logs");
    fs.mkdirSync(logsDir, { recursive: true });
    fs.appendFileSync(
      path.join(logsDir, "cost-log.jsonl"),
      `${JSON.stringify(entry)}\n`,
      "utf8",
    );
  } catch (error) {
    console.warn("[cost-log] failed to append entry:", error);
  }
  return entry;
}

/**
 * Read all cost entries for a project. Returns [] if no log file.
 */
export function readCostLog(projectsRoot: string, projectId: string): CostEntry[] {
  const projectDir = locateProjectDir(projectsRoot, projectId);
  if (!projectDir) return [];
  const logPath = path.join(projectDir, "logs", "cost-log.jsonl");
  if (!fs.existsSync(logPath)) return [];
  try {
    const text = fs.readFileSync(logPath, "utf8");
    return text
      .split("\n")
      .filter((line) => line.trim())
      .flatMap((line) => {
        try { return [JSON.parse(line) as CostEntry]; } catch { return []; }
      });
  } catch (error) {
    console.warn("[cost-log] failed to read log:", error);
    return [];
  }
}

/**
 * Aggregate cost summary for a project.
 */
export function summarizeProjectCost(
  projectsRoot: string,
  projectId: string,
): {
  total: number;
  count: number;
  byProvider: Record<string, number>;
  byKind: Record<string, number>;
} {
  const entries = readCostLog(projectsRoot, projectId);
  const byProvider: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  let total = 0;
  for (const entry of entries) {
    total += entry.cost;
    byProvider[entry.provider] = (byProvider[entry.provider] || 0) + entry.cost;
    byKind[entry.kind] = (byKind[entry.kind] || 0) + entry.cost;
  }
  return { total, count: entries.length, byProvider, byKind };
}

function locateProjectDir(projectsRoot: string, projectId?: string): string | null {
  if (!projectId) return null;
  try {
    for (const entry of fs.readdirSync(projectsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const projectJsonPath = path.join(projectsRoot, entry.name, "project.json");
      if (!fs.existsSync(projectJsonPath)) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(projectJsonPath, "utf8")) as { id?: string };
        if (raw?.id === projectId) return path.join(projectsRoot, entry.name);
      } catch {
        continue;
      }
    }
  } catch {
    return null;
  }
  return null;
}
