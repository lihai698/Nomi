// 把 agent 建议的 modelKey/modeId/params 校验+补全成可写入 node.meta 的对象。
//
// 关键约束（bug① spike）：agent 一旦写了 modelKey，useNodeModelAutoSelect 的 effect1（只在
// modelKey 空时跑）就不会再自动补 vendor/label/默认参数——所以这里必须**自铺全**：
// modelVendor / modelLabel / archetype.{id,modeId} / 该 mode 的默认参数，再用 agent 的合法参数覆盖。
import type { AgentModelEntry } from "./availableModels";
import type { ModelParameterControl } from "../../../config/modelCatalogMeta";

export type PlannedNodeModelInput = {
  modelKey?: unknown;
  modeId?: unknown;
  params?: unknown;
};

// 单字段校验（跨字段互斥/依赖留二期）：select 取值必须在 options；number 在 min-max；boolean 是布尔。
function isValidParamValue(
  control: ModelParameterControl,
  value: string | number | boolean,
): boolean {
  if (control.options.length > 0) {
    return control.options.some((option) => String(option.value) === String(value));
  }
  if (control.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
    if (control.min !== undefined && value < control.min) return false;
    if (control.max !== undefined && value > control.max) return false;
    return true;
  }
  if (control.type === "boolean") return typeof value === "boolean";
  return true;
}

export function buildPlannedNodeMeta(
  planned: PlannedNodeModelInput,
  entryByKey: ReadonlyMap<string, AgentModelEntry>,
): Record<string, unknown> | undefined {
  const modelKey = typeof planned.modelKey === "string" ? planned.modelKey.trim() : "";
  if (!modelKey) return undefined;
  const entry = entryByKey.get(modelKey);
  // 模型不在可用清单 → 不写模型 meta，回退原自动选（避开 effect3 供应商断开自愈覆盖）。
  if (!entry) return undefined;

  const wantModeId = typeof planned.modeId === "string" ? planned.modeId.trim() : "";
  const mode =
    entry.modes.find((m) => m.modeId === wantModeId) ??
    entry.modes.find((m) => m.modeId === entry.defaultModeId) ??
    entry.modes[0];

  const meta: Record<string, unknown> = {
    modelKey,
    modelLabel: entry.label,
    archetype: { id: entry.archetypeId, modeId: mode?.modeId ?? entry.defaultModeId },
  };
  if (entry.vendor) meta.modelVendor = entry.vendor;
  if (!mode) return meta;

  // 1) 铺 mode 默认参数
  for (const control of mode.params) {
    if (control.defaultValue !== undefined) meta[control.key] = control.defaultValue;
  }
  // 2) agent 的合法参数覆盖（非法值丢弃，保留默认）
  const rawParams =
    planned.params && typeof planned.params === "object" && !Array.isArray(planned.params)
      ? (planned.params as Record<string, unknown>)
      : {};
  for (const control of mode.params) {
    const value = rawParams[control.key];
    if (value === undefined) continue;
    if (
      (typeof value === "string" || typeof value === "number" || typeof value === "boolean") &&
      isValidParamValue(control, value)
    ) {
      meta[control.key] = value;
    }
  }
  return meta;
}
