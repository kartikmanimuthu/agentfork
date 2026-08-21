// Kept free of server-only imports (logger, crypto, prisma) so the band can also be
// imported by client components through `@chatbot/shared/client`.

export interface ThresholdBand {
  min: number;
  default: number;
  max: number;
}

// One band for every embedding model, by product decision: tenants tune it themselves
// rather than the platform guessing per model.
//
// The trade-off is real and worth knowing. Cosine similarity is not comparable across
// embedding families. Measured against amazon.titan-embed-text-v2:0, true paraphrases
// score ~0.50 ("what are your business hours" / "when are you open" = 0.4951) while
// OpenAI-family models put the same kind of pair in the 0.9x band. So the BALANCED
// default below is deliberately mid-scale and will rarely produce a hit on Titan —
// those agents need to be moved toward LOOSE using the near-miss logs.
//
// The floor sits at 0.45 because the highest measured *unguarded* Titan non-match was
// 0.3841 ("cancel my subscription" / "upgrade my subscription"). Below the floor,
// unrelated questions start matching each other.
const BAND: ThresholdBand = { min: 0.45, default: 0.75, max: 0.99 };

export const WIDEST_THRESHOLD_MIN = BAND.min;
export const WIDEST_THRESHOLD_MAX = BAND.max;

// Signature keeps the embedding model so callers need no change and a per-model band
// can return later without touching them.
export function getThresholdBand(_embeddingModel?: string): ThresholdBand {
  return BAND;
}

export type ThresholdPreset = 'strict' | 'balanced' | 'loose';

export const THRESHOLD_PRESETS: readonly ThresholdPreset[] = ['strict', 'balanced', 'loose'];

const PRESET_VALUES: Record<ThresholdPreset, number> = {
  loose: 0.45,
  balanced: 0.75,
  strict: 0.95,
};

// Zone boundaries, so every value on the slider reports a label rather than only the
// three exact points: below LOOSE_MAX is loose, 0.95 and above is strict.
const LOOSE_MAX = 0.6;
const STRICT_MIN = PRESET_VALUES.strict;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function getPresetThreshold(_embeddingModel: string, preset: ThresholdPreset): number {
  return round2(PRESET_VALUES[preset] ?? PRESET_VALUES.balanced);
}

// A stored threshold is a raw number — it may predate the presets or have been dragged
// anywhere on the slider. Report which zone it falls in.
export function presetForThreshold(_embeddingModel: string, value: number): ThresholdPreset {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'balanced';
  if (value >= STRICT_MIN) return 'strict';
  if (value < LOOSE_MAX) return 'loose';
  return 'balanced';
}
