import { createLogger } from '@chatbot/shared';
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from '../types';
import type { StateSchemaNodeConfig, SchemaField } from '../../types/nodes';

const logger = createLogger('agent-studio:state-schema-executor');

export class StateSchemaNodeExecutor implements NodeExecutor {
  type = 'state_schema';

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const config = ctx.config as StateSchemaNodeConfig;
    const startedAt = new Date().toISOString();

    const updates: Record<string, unknown> = {};
    for (const field of config.fields) {
      if (ctx.state.channels[field.name] === undefined) {
        updates[field.name] = field.default ?? this.getDefaultForType(field.type);
      }
    }

    return {
      stateUpdates: updates,
      next: null,
      trace: {
        nodeId: ctx.node.id,
        nodeType: 'state_schema',
        nodeLabel: ctx.node.label,
        status: 'completed',
        startedAt,
        completedAt: new Date().toISOString(),
        input: { fieldCount: config.fields.length },
        output: { initializedChannels: Object.keys(updates) },
      },
    };
  }

  private getDefaultForType(type: SchemaField['type']): unknown {
    switch (type) {
      case 'string':
        return '';
      case 'number':
        return 0;
      case 'boolean':
        return false;
      case 'array':
        return [];
      case 'object':
        return {};
    }
  }
}
