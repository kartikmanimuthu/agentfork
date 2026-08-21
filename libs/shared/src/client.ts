// Client-safe exports from @chatbot/shared
// Only exports validation schemas, types, and utilities — no server-only code.

export * from './validation/schemas';
export * from './validation/parse-request';

// Per-embedding-model similarity bands — a pure lookup table, safe in the browser.
export {
  getThresholdBand,
  getPresetThreshold,
  presetForThreshold,
  THRESHOLD_PRESETS,
  WIDEST_THRESHOLD_MIN,
  WIDEST_THRESHOLD_MAX,
} from './services/semantic-cache-thresholds';
export type { ThresholdBand, ThresholdPreset } from './services/semantic-cache-thresholds';

export {
  resolveCachingConfig,
  CACHE_OVERRIDE_LABELS,
  DEFAULT_CACHE_TTL_SECONDS,
  MAX_CACHE_TTL_SECONDS,
} from './services/caching-config';
export type { ResolvedCaching, ExactCacheOverrides, SemanticCacheOverrides } from './services/caching-config';

export { computeCacheEligibility } from './services/cache-eligibility';
export type { EligibilityInput, EligibilityResult } from './services/cache-eligibility';

// Workflow — pure graph utilities + types/schemas (no env/prisma/aws deps).
export {
  graphToDefinition,
  definitionToGraph,
  validateGraph,
} from './workflow/workflow-graph';
export {
  workflowDefinitionSchema,
  workflowNodeSchema,
  workflowTransitionSchema,
  workflowCursorSchema,
  menuOptionSchema,
} from './workflow/workflow-types';
export type {
  WorkflowDefinition,
  WorkflowNode,
  WorkflowTransition,
  WorkflowCursor,
  MenuOption,
  GraphNode,
  GraphEdge,
  GraphError,
} from './workflow/workflow-types';
