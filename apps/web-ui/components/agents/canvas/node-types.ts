import type { NodeTypes } from '@xyflow/react';
import { LlmNode } from './nodes/llm-node';
import { ToolNode } from './nodes/tool-node';
import { RouterNode } from './nodes/router-node';
import { StateSchemaNode } from './nodes/state-schema-node';
import { InputNode } from './nodes/input-node';
import { OutputNode } from './nodes/output-node';
import { MemoryNode } from './nodes/memory-node';
import { KnowledgeBaseNode } from './nodes/knowledge-base-node';
import { McpServerNode } from './nodes/mcp-server-node';

/**
 * Pass this object to the `nodeTypes` prop of <ReactFlow />.
 * Keys match the `type` field on GraphNode.
 */
export const nodeTypes: NodeTypes = {
  llm: LlmNode,
  tool: ToolNode,
  router: RouterNode,
  state_schema: StateSchemaNode,
  input: InputNode,
  output: OutputNode,
  memory: MemoryNode,
  knowledge_base: KnowledgeBaseNode,
  mcp_server: McpServerNode,
};
