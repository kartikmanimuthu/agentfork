import { z } from 'zod';

// ---------------------------------------------------------------------------
// Node schemas
// ---------------------------------------------------------------------------

const menuOptionSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
  icon: z.string().optional(),
});

const menuNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal('menu'),
  title: z.string().optional(),
  options: z.array(menuOptionSchema).min(1),
});

const textNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal('text'),
  text: z.string().min(1),
});

const fileNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal('file'),
  fileRef: z.string().min(1),
});

export const workflowNodeSchema = z.discriminatedUnion('type', [
  menuNodeSchema,
  textNodeSchema,
  fileNodeSchema,
]);

// ---------------------------------------------------------------------------
// Transition schema
// ---------------------------------------------------------------------------

export const workflowTransitionSchema = z.object({
  fromNodeId: z.string().min(1),
  optionValue: z.string().min(1),
  toNodeId: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Definition schema
// ---------------------------------------------------------------------------

export const workflowDefinitionSchema = z.object({
  entryNodeId: z.string().min(1),
  nodes: z.array(workflowNodeSchema).min(1),
  transitions: z.array(workflowTransitionSchema),
});

// ---------------------------------------------------------------------------
// Cursor schema
// ---------------------------------------------------------------------------

export const workflowCursorSchema = z.object({
  nodeId: z.string().min(1),
});

// ---------------------------------------------------------------------------
// TypeScript types (inferred from schemas — single source of truth)
// ---------------------------------------------------------------------------

export type MenuOption = z.infer<typeof menuOptionSchema>;
export type WorkflowNode = z.infer<typeof workflowNodeSchema>;
export type WorkflowTransition = z.infer<typeof workflowTransitionSchema>;
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;
export type WorkflowCursor = z.infer<typeof workflowCursorSchema>;
