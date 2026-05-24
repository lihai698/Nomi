/**
 * Phase E Task E10 — Static provider/model cost reference table.
 *
 * All values are ESTIMATES, not contractual rates. Update freely as
 * provider pricing evolves. The UI must label cost as "估算" / "estimate"
 * to set user expectations.
 */

export type CostUnit =
  | "per-call"           // flat per invocation (most image models)
  | "per-1k-tokens"      // text/chat models
  | "per-second"         // video models priced by output length
  | "per-megapixel";     // image models priced by output area

export type CostTableEntry = {
  provider: string;
  modelKeyPattern: RegExp;  // matched against vendor+modelKey
  kind: "text" | "image" | "video" | "audio";
  unit: CostUnit;
  unitCost: number;         // USD per unit
};

export const COST_TABLE: CostTableEntry[] = [
  // OpenAI-compatible / Chatfire — text
  { provider: "*", modelKeyPattern: /gpt-4o-mini/i,      kind: "text", unit: "per-1k-tokens", unitCost: 0.00015 },
  { provider: "*", modelKeyPattern: /gpt-4o/i,           kind: "text", unit: "per-1k-tokens", unitCost: 0.005   },
  { provider: "*", modelKeyPattern: /gpt-4/i,            kind: "text", unit: "per-1k-tokens", unitCost: 0.03    },
  { provider: "*", modelKeyPattern: /gpt-3\.5/i,         kind: "text", unit: "per-1k-tokens", unitCost: 0.0005  },
  { provider: "*", modelKeyPattern: /claude.*opus/i,     kind: "text", unit: "per-1k-tokens", unitCost: 0.015   },
  { provider: "*", modelKeyPattern: /claude.*sonnet/i,   kind: "text", unit: "per-1k-tokens", unitCost: 0.003   },
  { provider: "*", modelKeyPattern: /claude.*haiku/i,    kind: "text", unit: "per-1k-tokens", unitCost: 0.00025 },
  { provider: "*", modelKeyPattern: /gemini.*pro/i,      kind: "text", unit: "per-1k-tokens", unitCost: 0.00125 },
  { provider: "*", modelKeyPattern: /deepseek/i,         kind: "text", unit: "per-1k-tokens", unitCost: 0.00027 },
  { provider: "*", modelKeyPattern: /qwen/i,             kind: "text", unit: "per-1k-tokens", unitCost: 0.0005  },

  // Image models
  { provider: "*", modelKeyPattern: /flux.*pro/i,        kind: "image", unit: "per-call", unitCost: 0.055 },
  { provider: "*", modelKeyPattern: /flux.*dev/i,        kind: "image", unit: "per-call", unitCost: 0.025 },
  { provider: "*", modelKeyPattern: /flux.*schnell/i,    kind: "image", unit: "per-call", unitCost: 0.003 },
  { provider: "*", modelKeyPattern: /sd3.*large/i,       kind: "image", unit: "per-call", unitCost: 0.065 },
  { provider: "*", modelKeyPattern: /sd3/i,              kind: "image", unit: "per-call", unitCost: 0.035 },
  { provider: "*", modelKeyPattern: /sdxl/i,             kind: "image", unit: "per-call", unitCost: 0.012 },
  { provider: "*", modelKeyPattern: /dall-e-3/i,         kind: "image", unit: "per-call", unitCost: 0.040 },
  { provider: "*", modelKeyPattern: /midjourney/i,       kind: "image", unit: "per-call", unitCost: 0.025 },
  { provider: "*", modelKeyPattern: /ideogram/i,         kind: "image", unit: "per-call", unitCost: 0.020 },
  { provider: "*", modelKeyPattern: /recraft/i,          kind: "image", unit: "per-call", unitCost: 0.025 },

  // Video models
  { provider: "*", modelKeyPattern: /kling/i,            kind: "video", unit: "per-second", unitCost: 0.50  },
  { provider: "*", modelKeyPattern: /runway.*gen3/i,     kind: "video", unit: "per-second", unitCost: 0.95  },
  { provider: "*", modelKeyPattern: /luma/i,             kind: "video", unit: "per-second", unitCost: 0.40  },
  { provider: "*", modelKeyPattern: /sora/i,             kind: "video", unit: "per-second", unitCost: 0.80  },
  { provider: "*", modelKeyPattern: /pika/i,             kind: "video", unit: "per-second", unitCost: 0.35  },
  { provider: "*", modelKeyPattern: /minimax|hailuo/i,   kind: "video", unit: "per-second", unitCost: 0.30  },
  { provider: "*", modelKeyPattern: /cogvideox/i,        kind: "video", unit: "per-second", unitCost: 0.15  },
  { provider: "*", modelKeyPattern: /wan/i,              kind: "video", unit: "per-second", unitCost: 0.25  },

  // Audio (placeholder — Phase F)
  { provider: "*", modelKeyPattern: /elevenlabs/i,       kind: "audio", unit: "per-1k-tokens", unitCost: 0.30 },
  { provider: "*", modelKeyPattern: /suno/i,             kind: "audio", unit: "per-call",      unitCost: 0.10 },
];

export type CostEstimateInput = {
  provider: string;
  model: string;
  kind: "text" | "image" | "video" | "audio" | "unknown";
  tokens?: number;        // for text
  durationSec?: number;   // for video/audio
  pixels?: number;        // for image (W*H)
};

/**
 * Best-effort cost estimate in USD. Returns null when no entry matches —
 * caller should still log the invocation but mark cost as unknown.
 */
export function estimateCost(input: CostEstimateInput): number | null {
  if (input.kind === "unknown") return null;
  const entry = COST_TABLE.find(
    (e) => (e.provider === "*" || e.provider === input.provider) &&
            e.modelKeyPattern.test(input.model),
  );
  if (!entry) return null;

  switch (entry.unit) {
    case "per-call":
      return entry.unitCost;
    case "per-1k-tokens":
      if (input.tokens == null) {
        // Reasonable fallback: assume average 1500 tokens per chat call
        return (entry.unitCost * 1500) / 1000;
      }
      return (entry.unitCost * input.tokens) / 1000;
    case "per-second":
      if (input.durationSec == null) {
        // Reasonable fallback: 5-second clip
        return entry.unitCost * 5;
      }
      return entry.unitCost * input.durationSec;
    case "per-megapixel":
      if (input.pixels == null) {
        return entry.unitCost; // assume 1MP
      }
      return entry.unitCost * (input.pixels / 1_000_000);
  }
}

/**
 * Format USD cost as a short human string.
 */
export function formatCost(usd: number): string {
  if (usd < 0.01) return "<$0.01";
  if (usd < 1) return `$${usd.toFixed(3)}`;
  if (usd < 100) return `$${usd.toFixed(2)}`;
  return `$${Math.round(usd)}`;
}
