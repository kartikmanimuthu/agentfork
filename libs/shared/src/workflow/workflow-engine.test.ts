import { describe, it, expect } from 'vitest';
import { WorkflowEngine } from './workflow-engine';
import type { WorkflowDefinition, WorkflowCursor } from './workflow-types';
import type { StreamEvent } from '@chatbot/ai';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function menuDef(): WorkflowDefinition {
  return {
    entryNodeId: 'menu1',
    nodes: [
      { id: 'menu1', type: 'menu', title: 'What do you need?', options: [{ label: 'Info', value: 'info' }, { label: 'File', value: 'file' }] },
      { id: 'text1', type: 'text', text: 'Here is the info you requested.' },
      { id: 'file1', type: 'file', fileRef: 's3://bucket/doc.pdf' },
    ],
    transitions: [
      { fromNodeId: 'menu1', optionValue: 'info', toNodeId: 'text1' },
      { fromNodeId: 'menu1', optionValue: 'file', toNodeId: 'file1' },
    ],
  };
}

const engine = new WorkflowEngine((ref) => `https://cdn.example.com/${ref.replace('s3://bucket/', '')}`);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkflowEngine', () => {
  it('no cursor → emits entry node (menu) and sets cursor to entry node', () => {
    const result = engine.resolve(menuDef(), 'hello', null, 'm1');
    expect(result).not.toBeNull();
    const { events, nextCursor } = result!;
    expect(nextCursor).toEqual({ nodeId: 'menu1' });
    const start = events.find((e) => e.type === 'part_start');
    expect(start?.partType).toBe('menu');
    expect(start?.part).toMatchObject({ type: 'menu', title: 'What do you need?' });
    expect(events.some((e) => e.type === 'part_complete')).toBe(true);
    expect(events.at(-1)?.type).toBe('done');
    // All events carry messageId
    expect(events.every((e) => e.messageId === 'm1')).toBe(true);
  });

  it('cursor set, value matches transition → emits target text node, advances cursor', () => {
    const cursor: WorkflowCursor = { nodeId: 'menu1' };
    const result = engine.resolve(menuDef(), 'info', cursor, 'm2');
    expect(result).not.toBeNull();
    const { events, nextCursor } = result!;
    // text1 has no outgoing transitions → terminal node → cursor cleared
    expect(nextCursor).toBeNull();
    const start = events.find((e) => e.type === 'part_start');
    expect(start?.partType).toBe('text');
    const token = events.find((e) => e.type === 'token');
    expect(token?.content).toBe('Here is the info you requested.');
    expect(events.at(-1)?.type).toBe('done');
  });

  it('cursor set, value matches transition → emits file node with resolved URL', () => {
    const cursor: WorkflowCursor = { nodeId: 'menu1' };
    const result = engine.resolve(menuDef(), 'file', cursor, 'm3');
    expect(result).not.toBeNull();
    const { events, nextCursor } = result!;
    // file1 has no outgoing transitions → terminal node → cursor cleared
    expect(nextCursor).toBeNull();
    const start = events.find((e) => e.type === 'part_start');
    expect(start?.partType).toBe('file');
    expect(start?.part).toMatchObject({
      type: 'file',
      url: 'https://cdn.example.com/doc.pdf',
    });
    expect(events.some((e) => e.type === 'part_complete')).toBe(true);
    expect(events.at(-1)?.type).toBe('done');
  });

  it('cursor set, no matching transition → returns null (LLM fallback)', () => {
    const cursor: WorkflowCursor = { nodeId: 'menu1' };
    const result = engine.resolve(menuDef(), 'unknown_value', cursor, 'm4');
    expect(result).toBeNull();
  });

  it('target node has no outgoing transitions → emits parts and clears cursor', () => {
    const cursor: WorkflowCursor = { nodeId: 'menu1' };
    const result = engine.resolve(menuDef(), 'info', cursor, 'm5');
    expect(result).not.toBeNull();
    // text1 has no outgoing transitions → cursor cleared
    expect(result!.nextCursor).toBeNull();
  });

  it('target node is a menu with outgoing transitions → cursor stays set', () => {
    const def: WorkflowDefinition = {
      entryNodeId: 'menu1',
      nodes: [
        { id: 'menu1', type: 'menu', options: [{ label: 'Go', value: 'go' }] },
        { id: 'menu2', type: 'menu', options: [{ label: 'Done', value: 'done' }] },
      ],
      transitions: [
        { fromNodeId: 'menu1', optionValue: 'go', toNodeId: 'menu2' },
        { fromNodeId: 'menu2', optionValue: 'done', toNodeId: 'menu1' },
      ],
    };
    const cursor: WorkflowCursor = { nodeId: 'menu1' };
    const result = engine.resolve(def, 'go', cursor, 'm6');
    expect(result).not.toBeNull();
    // menu2 has outgoing transitions → cursor stays
    expect(result!.nextCursor).toEqual({ nodeId: 'menu2' });
  });

  it('missing node referenced in transition → returns null (safe fallback)', () => {
    const def: WorkflowDefinition = {
      entryNodeId: 'menu1',
      nodes: [
        { id: 'menu1', type: 'menu', options: [{ label: 'Go', value: 'go' }] },
      ],
      transitions: [
        { fromNodeId: 'menu1', optionValue: 'go', toNodeId: 'ghost' }, // ghost doesn't exist
      ],
    };
    const cursor: WorkflowCursor = { nodeId: 'menu1' };
    const result = engine.resolve(def, 'go', cursor, 'm7');
    expect(result).toBeNull();
  });

  it('malformed definition (invalid JSON shape) → returns null', () => {
    const bad = { entryNodeId: '', nodes: [], transitions: [] } as unknown as WorkflowDefinition;
    const result = engine.resolve(bad, 'hi', null, 'm8');
    expect(result).toBeNull();
  });

  it('partIndex is 0 for the single part emitted per node', () => {
    const result = engine.resolve(menuDef(), 'hello', null, 'm9');
    const start = result!.events.find((e) => e.type === 'part_start');
    expect(start?.partIndex).toBe(0);
    const complete = result!.events.find((e) => e.type === 'part_complete');
    expect(complete?.partIndex).toBe(0);
  });
});
