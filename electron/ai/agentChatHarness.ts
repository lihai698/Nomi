// Harness helpers for the user-facing agent chat loop (runAgentChatV2).
// Kept out of the runtime.ts mega-shell (规则 9/12) — pure, testable functions.
import {
  generateText,
  type CoreMessage,
  type LanguageModelV1,
  type ToolCallRepairFunction,
  type ToolSet,
} from "ai";

// History cap by message count. Slicing can decapitate a tool-call/tool-result
// pair, so after trimming we drop any leading orphan `tool` messages (results
// the provider would reject) — advancing to the next clean boundary.
// (Token-aware budgeting / compaction is tracked separately in the harness plan.)
const AGENT_HISTORY_MAX_MESSAGES = 30;
export function capAgentHistory(messages: CoreMessage[]): CoreMessage[] {
  let trimmed =
    messages.length > AGENT_HISTORY_MAX_MESSAGES
      ? messages.slice(messages.length - AGENT_HISTORY_MAX_MESSAGES)
      : messages;
  while (trimmed.length > 0 && trimmed[0].role === "tool") {
    trimmed = trimmed.slice(1);
  }
  return trimmed;
}

// Multi-round planning skills create many nodes in a single turn; the old
// hard-coded `maxSteps: 5` silently truncated a long storyboard / 角色卡 plan.
// Give planners headroom; keep a modest default for one-shot edit skills.
const PLANNING_SKILL_KEYS = new Set<string>([
  "workbench.storyboard.planner",
  "workbench.fixation.planner",
  "workbench.generation.canvas-planner",
]);
const DEFAULT_AGENT_MAX_STEPS = 8;
const PLANNING_AGENT_MAX_STEPS = 24;
export function maxStepsForSkill(skillKey: string): number {
  return PLANNING_SKILL_KEYS.has(skillKey) ? PLANNING_AGENT_MAX_STEPS : DEFAULT_AGENT_MAX_STEPS;
}

// Self-repair malformed tool-call JSON: weaker models sometimes emit invalid
// args for complex schemas. Ask the same model to fix its own JSON instead of
// crashing the whole turn; return null to let the SDK report the original error.
// Ported from the onboarding agent (provider-agnostic).
export function createToolCallRepair(model: LanguageModelV1): ToolCallRepairFunction<ToolSet> {
  return async ({ toolCall, error, messages }) => {
    try {
      const repaired = await generateText({
        model,
        system:
          "You are a JSON repair assistant. Given a tool call with broken arguments, return ONLY the corrected JSON object that matches the tool's parameter schema.",
        messages: [
          ...messages,
          {
            role: "user",
            content:
              `The previous tool call to "${toolCall.toolName}" had invalid arguments:\n` +
              `\`\`\`json\n${toolCall.args}\n\`\`\`\n` +
              `Error: ${error.message}\n` +
              `Output only the corrected JSON arguments — no markdown, no explanation.`,
          },
        ],
        temperature: 0.1,
        maxTokens: 1024,
      });
      JSON.parse(repaired.text);
      return { ...toolCall, args: repaired.text };
    } catch {
      return null;
    }
  };
}
