// Client-safe exports from @chatbot/shared
// Only exports validation schemas, types, and utilities — no server-only code.

export * from './validation/schemas';
export * from './validation/parse-request';

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
