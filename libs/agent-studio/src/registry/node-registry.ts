import { z } from 'zod';
import { llmNodeSchema } from './schemas/llm';
import { toolNodeSchema } from './schemas/tool';
import { routerNodeSchema } from './schemas/router';
import { stateSchemaNodeSchema } from './schemas/state-schema';
import { inputNodeSchema } from './schemas/input';
import { outputNodeSchema } from './schemas/output';
import { memoryNodeSchema } from './schemas/memory';
import { knowledgeBaseNodeSchema } from './schemas/knowledge-base';
import { mcpServerNodeSchema } from './schemas/mcp-server';
import { codeNodeSchema } from './schemas/code';
import { conditionNodeSchema } from './schemas/condition';
import { httpNodeSchema } from './schemas/http';
import { humanNodeSchema } from './schemas/human';
import { parallelNodeSchema } from './schemas/parallel';
import { subAgentNodeSchema } from './schemas/sub-agent';
import { delayNodeSchema } from './schemas/delay';
import { whatsappTriggerNodeSchema } from './schemas/whatsapp-trigger';
import { whatsappSendNodeSchema } from './schemas/whatsapp-send';
import { whatsappSendTemplateNodeSchema } from './schemas/whatsapp-send-template';
import { telegramTriggerNodeSchema } from './schemas/telegram-trigger';
import { telegramSendNodeSchema } from './schemas/telegram-send';
import { telegramSendButtonsNodeSchema } from './schemas/telegram-send-buttons';
import type { NodeType, NodeConfig, ValidationError } from '../types/nodes';

// Discriminated union of all node config schemas
const nodeConfigSchema = z.discriminatedUnion('type', [
  llmNodeSchema,
  toolNodeSchema,
  routerNodeSchema,
  stateSchemaNodeSchema,
  inputNodeSchema,
  outputNodeSchema,
  memoryNodeSchema,
  knowledgeBaseNodeSchema,
  mcpServerNodeSchema,
  codeNodeSchema,
  conditionNodeSchema,
  httpNodeSchema,
  humanNodeSchema,
  parallelNodeSchema,
  subAgentNodeSchema,
  delayNodeSchema,
  whatsappTriggerNodeSchema,
  whatsappSendNodeSchema,
  whatsappSendTemplateNodeSchema,
  telegramTriggerNodeSchema,
  telegramSendNodeSchema,
  telegramSendButtonsNodeSchema,
]);

export interface NodeDefinition {
  type: NodeType;
  label: string;
  description: string;
  /** Default config used when a new node of this type is dropped onto the canvas */
  defaultConfig: NodeConfig;
  /** Validate a config object; returns errors or empty array */
  validate(config: unknown): ValidationError[];
}

const definitions: NodeDefinition[] = [
  {
    type: 'llm',
    label: 'LLM',
    description: 'Calls a language model with an optional system prompt and tools.',
    defaultConfig: {
      type: 'llm',
      model: 'anthropic.claude-sonnet-4-20250514',
      temperature: 0.7,
    },
    validate(config) {
      const result = llmNodeSchema.safeParse(config);
      if (result.success) return [];
      return result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      }));
    },
  },
  {
    type: 'tool',
    label: 'Tool',
    description: 'Executes a named tool with optional parameter overrides.',
    defaultConfig: {
      type: 'tool',
      toolName: '',
    },
    validate(config) {
      const result = toolNodeSchema.safeParse(config);
      if (result.success) return [];
      return result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      }));
    },
  },
  {
    type: 'router',
    label: 'Router',
    description: 'Routes execution to different nodes based on conditions.',
    defaultConfig: {
      type: 'router',
      conditions: [],
    },
    validate(config) {
      const result = routerNodeSchema.safeParse(config);
      if (result.success) return [];
      return result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      }));
    },
  },
  {
    type: 'condition',
    label: 'Condition',
    description: 'Evaluates a single expression and branches to true or false path.',
    defaultConfig: {
      type: 'condition',
      expression: '',
      trueBranch: '',
      falseBranch: '',
    },
    validate(config) {
      const result = conditionNodeSchema.safeParse(config);
      if (result.success) return [];
      return result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      }));
    },
  },
  {
    type: 'state_schema',
    label: 'State Schema',
    description: 'Defines the shared state shape passed between nodes.',
    defaultConfig: {
      type: 'state_schema',
      fields: [],
    },
    validate(config) {
      const result = stateSchemaNodeSchema.safeParse(config);
      if (result.success) return [];
      return result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      }));
    },
  },
  {
    type: 'input',
    label: 'Input',
    description: 'Entry point that defines expected input and populates initial state.',
    defaultConfig: {
      type: 'input',
      mode: 'messages',
    },
    validate(config) {
      const result = inputNodeSchema.safeParse(config);
      if (result.success) return [];
      return result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      }));
    },
  },
  {
    type: 'output',
    label: 'Output',
    description: 'Terminal node that formats and returns the final response.',
    defaultConfig: {
      type: 'output',
      responseChannel: 'response',
      format: 'text',
    },
    validate(config) {
      const result = outputNodeSchema.safeParse(config);
      if (result.success) return [];
      return result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      }));
    },
  },
  {
    type: 'memory',
    label: 'Memory',
    description: 'Manages conversation context window with configurable strategies.',
    defaultConfig: {
      type: 'memory',
      strategy: 'full',
      messagesChannel: 'messages',
    },
    validate(config) {
      const result = memoryNodeSchema.safeParse(config);
      if (result.success) return [];
      return result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      }));
    },
  },
  {
    type: 'knowledge_base',
    label: 'Knowledge Base',
    description: 'Retrieves relevant context from one or more knowledge bases.',
    defaultConfig: {
      type: 'knowledge_base',
      knowledgeBaseIds: [],
      queryChannel: 'query',
      outputChannel: 'kb_results',
      topK: 5,
    },
    validate(config) {
      const result = knowledgeBaseNodeSchema.safeParse(config);
      if (result.success) return [];
      return result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      }));
    },
  },
  {
    type: 'mcp_server',
    label: 'MCP Server',
    description: 'Invokes a tool on a connected MCP server.',
    defaultConfig: {
      type: 'mcp_server',
      serverId: '',
      toolName: '',
      argumentSource: 'from_state',
      outputChannel: 'mcp_result',
    },
    validate(config) {
      const result = mcpServerNodeSchema.safeParse(config);
      if (result.success) return [];
      return result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      }));
    },
  },
  {
    type: 'human',
    label: 'Human',
    description: 'Pauses execution and waits for human input before continuing.',
    defaultConfig: {
      type: 'human',
      prompt: '',
      outputChannel: 'human_response',
    },
    validate(config) {
      const result = humanNodeSchema.safeParse(config);
      if (result.success) return [];
      return result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      }));
    },
  },
  {
    type: 'parallel',
    label: 'Parallel',
    description: 'Dispatches execution to multiple branches simultaneously.',
    defaultConfig: {
      type: 'parallel',
      branches: [],
      mergeStrategy: 'all',
      outputChannel: 'parallel_result',
    },
    validate(config) {
      const result = parallelNodeSchema.safeParse(config);
      if (result.success) return [];
      return result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      }));
    },
  },
  {
    type: 'sub_agent',
    label: 'Sub-Agent',
    description: 'Invokes another agent as a sub-routine within this graph.',
    defaultConfig: {
      type: 'sub_agent',
      agentId: '',
      inputChannel: 'messages',
      outputChannel: 'sub_agent_response',
    },
    validate(config) {
      const result = subAgentNodeSchema.safeParse(config);
      if (result.success) return [];
      return result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      }));
    },
  },
  {
    type: 'delay',
    label: 'Delay',
    description: 'Pauses execution for a specified duration before continuing.',
    defaultConfig: {
      type: 'delay',
      delayMs: 1000,
    },
    validate(config) {
      const result = delayNodeSchema.safeParse(config);
      if (result.success) return [];
      return result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      }));
    },
  },
  {
    type: 'whatsapp_trigger',
    label: 'WhatsApp Trigger',
    description: 'Entry point for WhatsApp-driven graphs. Reads inbound message data into state channels.',
    defaultConfig: {
      type: 'whatsapp_trigger',
    },
    validate(config) {
      const result = whatsappTriggerNodeSchema.safeParse(config);
      if (result.success) return [];
      return result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      }));
    },
  },
  {
    type: 'whatsapp_send',
    label: 'WhatsApp Send',
    description: 'Sends a freeform message to the WhatsApp sender. Only valid within the 24-hour customer service window.',
    defaultConfig: {
      type: 'whatsapp_send',
      messageType: 'text',
      messageChannel: 'llm_output',
    },
    validate(config) {
      const result = whatsappSendNodeSchema.safeParse(config);
      if (result.success) return [];
      return result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      }));
    },
  },
  {
    type: 'whatsapp_send_template',
    label: 'WhatsApp Send Template',
    description: 'Sends a pre-approved template message. Works outside the 24-hour window.',
    defaultConfig: {
      type: 'whatsapp_send_template',
      templateName: 'my_template',
      languageCode: 'en',
    },
    validate(config) {
      const result = whatsappSendTemplateNodeSchema.safeParse(config);
      if (result.success) return [];
      return result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      }));
    },
  },
  {
    type: 'telegram_trigger',
    label: 'Telegram Trigger',
    description: 'Entry point for Telegram-driven graphs. Reads inbound message data into state channels.',
    defaultConfig: {
      type: 'telegram_trigger',
    },
    validate(config) {
      const result = telegramTriggerNodeSchema.safeParse(config);
      if (result.success) return [];
      return result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      }));
    },
  },
  {
    type: 'telegram_send',
    label: 'Telegram Send Message',
    description: 'Sends a text or media message to a Telegram chat.',
    defaultConfig: {
      type: 'telegram_send',
      messageChannel: 'response',
    },
    validate(config) {
      const result = telegramSendNodeSchema.safeParse(config);
      if (result.success) return [];
      return result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      }));
    },
  },
  {
    type: 'telegram_send_buttons',
    label: 'Telegram Send Buttons',
    description: 'Sends a message with inline keyboard buttons to a Telegram chat.',
    defaultConfig: {
      type: 'telegram_send_buttons',
      messageChannel: 'response',
      buttons: [[{ text: 'Yes', callbackData: 'yes' }, { text: 'No', callbackData: 'no' }]],
    },
    validate(config) {
      const result = telegramSendButtonsNodeSchema.safeParse(config);
      if (result.success) return [];
      return result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      }));
    },
  },
];

export class NodeRegistry {
  private static readonly _definitions = new Map<NodeType, NodeDefinition>(
    definitions.map((d) => [d.type, d])
  );

  /** All registered node types */
  static getAll(): NodeDefinition[] {
    return [...this._definitions.values()];
  }

  /** Look up a single definition by type; throws if not found */
  static get(type: NodeType): NodeDefinition {
    const def = this._definitions.get(type);
    if (!def) throw new Error(`Unknown node type: "${type}"`);
    return def;
  }

  /** Returns true when the type is registered */
  static has(type: string): type is NodeType {
    return this._definitions.has(type as NodeType);
  }

  /**
   * Validate any node config using the discriminated union schema.
   * Returns an empty array when valid.
   */
  static validateConfig(config: unknown): ValidationError[] {
    const result = nodeConfigSchema.safeParse(config);
    if (result.success) return [];
    return result.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
      code: issue.code,
    }));
  }
}
