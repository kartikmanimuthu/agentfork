import { workflowDefinitionSchema } from './workflow-types';
import type { WorkflowDefinition, WorkflowCursor, WorkflowNode } from './workflow-types';
import pino from 'pino';

const logger = pino({ name: 'shared:workflow-engine' });

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type FileRefResolver = (fileRef: string) => string;

/**
 * Minimal StreamEvent shape — structurally compatible with libs/ai StreamEvent.
 * Defined locally to avoid a circular dependency (libs/shared → libs/ai → libs/shared).
 */
export interface WorkflowStreamEvent {
  type: 'part_start' | 'token' | 'part_complete' | 'done' | 'error';
  messageId?: string;
  partIndex?: number;
  partType?: string;
  content?: string;
  message?: string;
  part?: Record<string, unknown>;
}

export interface ResolveResult {
  events: WorkflowStreamEvent[];
  nextCursor: WorkflowCursor | null;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class WorkflowEngine {
  constructor(private readonly resolveFileRef: FileRefResolver) {}

  /**
   * Resolve one turn of the workflow.
   *
   * - `cursor === null` → first turn; emit the entry node.
   * - `cursor` set + `incomingValue` matches a transition → emit target node.
   * - No match → return `null` (caller falls back to LLM).
   * - Malformed definition or missing node → return `null` (safe fallback).
   */
  resolve(
    definition: WorkflowDefinition,
    incomingValue: string,
    cursor: WorkflowCursor | null,
    messageId: string,
  ): ResolveResult | null {
    // Validate definition — malformed → LLM fallback
    const parsed = workflowDefinitionSchema.safeParse(definition);
    if (!parsed.success) {
      logger.warn(
        { messageId, issues: parsed.error.issues },
        'Invalid workflow definition — falling back to LLM',
      );
      return null;
    }
    const def = parsed.data;

    // Build node index for O(1) lookup
    const nodeMap = new Map(def.nodes.map((n) => [n.id, n]));

    let targetNodeId: string;

    if (cursor === null) {
      // No active cursor → emit entry node
      targetNodeId = def.entryNodeId;
    } else {
      // Find a matching transition from the current cursor node
      const transition = def.transitions.find(
        (t) => t.fromNodeId === cursor.nodeId && t.optionValue === incomingValue,
      );
      if (!transition) {
        logger.debug(
          { messageId, cursorNodeId: cursor.nodeId, incomingValue },
          'No matching transition — LLM fallback',
        );
        return null;
      }
      targetNodeId = transition.toNodeId;
    }

    const targetNode = nodeMap.get(targetNodeId);
    if (!targetNode) {
      logger.warn(
        { messageId, targetNodeId },
        'Target node not found in definition — LLM fallback',
      );
      return null;
    }

    // Determine next cursor: clear if terminal (no outgoing transitions from target)
    const hasOutgoing = def.transitions.some((t) => t.fromNodeId === targetNodeId);
    const nextCursor: WorkflowCursor | null = hasOutgoing ? { nodeId: targetNodeId } : null;

    const events = this.emitNode(targetNode, messageId);

    logger.info(
      { messageId, targetNodeId, nodeType: targetNode.type, nextCursor },
      'Workflow node resolved',
    );

    return { events, nextCursor };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private emitNode(node: WorkflowNode, messageId: string): WorkflowStreamEvent[] {
    const partIndex = 0;
    const events: WorkflowStreamEvent[] = [];

    switch (node.type) {
      case 'menu': {
        const part: Record<string, unknown> = {
          type: 'menu',
          options: node.options,
          ...(node.title !== undefined ? { title: node.title } : {}),
        };
        events.push({ type: 'part_start', messageId, partIndex, partType: 'menu', part });
        events.push({ type: 'part_complete', messageId, partIndex });
        break;
      }

      case 'text': {
        events.push({ type: 'part_start', messageId, partIndex, partType: 'text' });
        events.push({ type: 'token', messageId, partIndex, content: node.text });
        events.push({ type: 'part_complete', messageId, partIndex });
        break;
      }

      case 'file': {
        const url = this.resolveFileRef(node.fileRef);
        const name = node.fileRef.split('/').at(-1) ?? 'file';
        const mimeType = guessMimeType(name);
        const part: Record<string, unknown> = { type: 'file', name, mimeType, url };
        events.push({ type: 'part_start', messageId, partIndex, partType: 'file', part });
        events.push({ type: 'part_complete', messageId, partIndex });
        break;
      }
    }

    events.push({ type: 'done', messageId });
    return events;
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function guessMimeType(filename: string): string {
  const ext = filename.split('.').at(-1)?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.ms-excel',
    csv: 'text/csv',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc: 'application/msword',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    txt: 'text/plain',
    md: 'text/markdown',
  };
  return map[ext] ?? 'application/octet-stream';
}
