import { z } from 'zod';
import { llmNodeSchema } from './schemas/llm';
import { toolNodeSchema } from './schemas/tool';
import { routerNodeSchema } from './schemas/router';
import { stateSchemaNodeSchema } from './schemas/state-schema';
import type { NodeType, NodeConfig, ValidationError } from '../types/nodes';

// Discriminated union of all node config schemas
const nodeConfigSchema = z.discriminatedUnion('type', [
  llmNodeSchema,
  toolNodeSchema,
  routerNodeSchema,
  stateSchemaNodeSchema,
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
