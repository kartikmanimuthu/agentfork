// Server-only exports — execution engine and node executors
// Do NOT import this from client-side code (use @chatbot/agent-studio for types/registry)

export { GraphExecutor } from './execution/graph-executor';
import {
  LlmNodeExecutor,
  RouterNodeExecutor,
  ToolNodeExecutor,
  StateSchemaNodeExecutor,
  InputNodeExecutor,
  OutputNodeExecutor,
  MemoryNodeExecutor,
  KnowledgeBaseNodeExecutor,
  McpServerNodeExecutor,
  CodeNodeExecutor,
  ConditionNodeExecutor,
  HttpNodeExecutor,
  HumanNodeExecutor,
  ParallelNodeExecutor,
  SubAgentNodeExecutor,
  DelayNodeExecutor,
  WhatsAppTriggerNodeExecutor,
  WhatsAppSendNodeExecutor,
  WhatsAppSendTemplateNodeExecutor,
  TelegramTriggerNodeExecutor,
  TelegramSendNodeExecutor,
  TelegramSendButtonsNodeExecutor,
} from './execution/node-executors';
export {
  LlmNodeExecutor,
  RouterNodeExecutor,
  ToolNodeExecutor,
  StateSchemaNodeExecutor,
  InputNodeExecutor,
  OutputNodeExecutor,
  MemoryNodeExecutor,
  KnowledgeBaseNodeExecutor,
  McpServerNodeExecutor,
  CodeNodeExecutor,
  ConditionNodeExecutor,
  HttpNodeExecutor,
  HumanNodeExecutor,
  ParallelNodeExecutor,
  SubAgentNodeExecutor,
  DelayNodeExecutor,
  WhatsAppTriggerNodeExecutor,
  WhatsAppSendNodeExecutor,
  WhatsAppSendTemplateNodeExecutor,
  TelegramTriggerNodeExecutor,
  TelegramSendNodeExecutor,
  TelegramSendButtonsNodeExecutor,
};
export { createInitialState, readChannel, writeChannel, applyStateUpdates } from './execution/state';
import type { NodeExecutor } from './execution/types';
export type {
  GraphState,
  ExecutionServices,
  NodeExecutionContext,
  NodeExecutor,
  NodeExecutionResult,
  NodeTraceEntry,
  ExecutionEvent,
  ExecutionOptions,
} from './execution/types';

export function createNodeExecutors(): NodeExecutor[] {
  return [
    new LlmNodeExecutor(),
    new RouterNodeExecutor(),
    new ToolNodeExecutor(),
    new StateSchemaNodeExecutor(),
    new InputNodeExecutor(),
    new OutputNodeExecutor(),
    new MemoryNodeExecutor(),
    new KnowledgeBaseNodeExecutor(),
    new McpServerNodeExecutor(),
    new CodeNodeExecutor(),
    new ConditionNodeExecutor(),
    new HttpNodeExecutor(),
    new HumanNodeExecutor(),
    new ParallelNodeExecutor(),
    new SubAgentNodeExecutor(),
    new DelayNodeExecutor(),
    new WhatsAppTriggerNodeExecutor(),
    new WhatsAppSendNodeExecutor(),
    new WhatsAppSendTemplateNodeExecutor(),
    new TelegramTriggerNodeExecutor(),
    new TelegramSendNodeExecutor(),
    new TelegramSendButtonsNodeExecutor(),
  ];
}

// MCP Client — runtime tool discovery and execution
export { McpClientService, buildMcpToolsForAgent } from './services/mcp-client.service';
export type { McpDiscoveredTool } from './services/mcp-client.service';
