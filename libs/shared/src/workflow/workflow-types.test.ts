import { describe, it, expect } from 'vitest';
import {
  workflowDefinitionSchema,
  workflowCursorSchema,
  type WorkflowDefinition,
  type WorkflowCursor,
  type WorkflowNode,
  type WorkflowTransition,
} from './workflow-types';

const menuNode = (id: string): WorkflowNode => ({
  id,
  type: 'menu',
  title: 'Choose an option',
  options: [{ label: 'Option A', value: 'a' }, { label: 'Option B', value: 'b' }],
});

const textNode = (id: string): WorkflowNode => ({
  id,
  type: 'text',
  text: 'Here is some information.',
});

const fileNode = (id: string): WorkflowNode => ({
  id,
  type: 'file',
  fileRef: 's3://bucket/key/doc.pdf',
});

const validDefinition: WorkflowDefinition = {
  entryNodeId: 'n1',
  nodes: [menuNode('n1'), textNode('n2'), fileNode('n3')],
  transitions: [
    { fromNodeId: 'n1', optionValue: 'a', toNodeId: 'n2' },
    { fromNodeId: 'n1', optionValue: 'b', toNodeId: 'n3' },
  ],
};

describe('workflowDefinitionSchema', () => {
  it('parses a valid definition with all node types', () => {
    const result = workflowDefinitionSchema.safeParse(validDefinition);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.entryNodeId).toBe('n1');
      expect(result.data.nodes).toHaveLength(3);
      expect(result.data.transitions).toHaveLength(2);
    }
  });

  it('rejects a definition missing entryNodeId', () => {
    const bad = { ...validDefinition, entryNodeId: '' };
    expect(workflowDefinitionSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a definition with no nodes', () => {
    const bad = { ...validDefinition, nodes: [] };
    expect(workflowDefinitionSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a menu node with no options', () => {
    const bad = {
      ...validDefinition,
      nodes: [{ id: 'n1', type: 'menu', options: [] }],
    };
    expect(workflowDefinitionSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a text node with empty text', () => {
    const bad = {
      ...validDefinition,
      nodes: [{ id: 'n1', type: 'text', text: '' }],
    };
    expect(workflowDefinitionSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a file node with empty fileRef', () => {
    const bad = {
      ...validDefinition,
      nodes: [{ id: 'n1', type: 'file', fileRef: '' }],
    };
    expect(workflowDefinitionSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an unknown node type', () => {
    const bad = {
      ...validDefinition,
      nodes: [{ id: 'n1', type: 'video', url: 'https://example.com' }],
    };
    expect(workflowDefinitionSchema.safeParse(bad).success).toBe(false);
  });

  it('accepts a definition with no transitions (terminal-only workflow)', () => {
    const def = {
      entryNodeId: 'n1',
      nodes: [textNode('n1')],
      transitions: [],
    };
    expect(workflowDefinitionSchema.safeParse(def).success).toBe(true);
  });

  it('rejects a transition with empty fromNodeId', () => {
    const bad = {
      ...validDefinition,
      transitions: [{ fromNodeId: '', optionValue: 'a', toNodeId: 'n2' }],
    };
    expect(workflowDefinitionSchema.safeParse(bad).success).toBe(false);
  });
});

describe('workflowCursorSchema', () => {
  it('parses a valid cursor', () => {
    const cursor: WorkflowCursor = { nodeId: 'n1' };
    const result = workflowCursorSchema.safeParse(cursor);
    expect(result.success).toBe(true);
  });

  it('rejects a cursor with empty nodeId', () => {
    expect(workflowCursorSchema.safeParse({ nodeId: '' }).success).toBe(false);
  });

  it('rejects a cursor missing nodeId', () => {
    expect(workflowCursorSchema.safeParse({}).success).toBe(false);
  });
});
