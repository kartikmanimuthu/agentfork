import type { NodeTypes } from '@xyflow/react';
import { LlmNode } from './nodes/llm-node';
import { ToolNode } from './nodes/tool-node';
import { RouterNode } from './nodes/router-node';
import { StateSchemaNode } from './nodes/state-schema-node';

/**
 * Pass this object to the `nodeTypes` prop of <ReactFlow />.
 * Keys match the `type` field on GraphNode.
 */
export const nodeTypes: NodeTypes = {
  llm: LlmNode,
  tool: ToolNode,
  router: RouterNode,
  state_schema: StateSchemaNode,
};
