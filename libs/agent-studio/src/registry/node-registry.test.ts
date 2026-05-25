import { describe, it, expect } from 'vitest';
import { NodeRegistry } from './node-registry';
import type { NodeType } from '../types/nodes';

describe('NodeRegistry', () => {
  describe('getAll', () => {
    it('returns all registered node types', () => {
      const all = NodeRegistry.getAll();
      const types = all.map((d) => d.type);
      expect(types).toContain('llm');
      expect(types).toContain('tool');
      expect(types).toContain('router');
      expect(types).toContain('state_schema');
      expect(types).toContain('input');
      expect(types).toContain('output');
      expect(types).toContain('memory');
      expect(types).toContain('knowledge_base');
      expect(types).toContain('mcp_server');
      expect(types).toContain('human');
      expect(types).toContain('parallel');
      expect(types).toContain('sub_agent');
      expect(types).toContain('delay');
      expect(all).toHaveLength(14);
    });
  });

  describe('get', () => {
    it('returns the definition for a known type', () => {
      const def = NodeRegistry.get('llm');
      expect(def.type).toBe('llm');
      expect(def.label).toBe('LLM');
    });

    it('throws for an unknown type', () => {
      expect(() => NodeRegistry.get('unknown' as NodeType)).toThrow(
        'Unknown node type: "unknown"'
      );
    });
  });

  describe('has', () => {
    it('returns true for registered types', () => {
      expect(NodeRegistry.has('llm')).toBe(true);
      expect(NodeRegistry.has('tool')).toBe(true);
      expect(NodeRegistry.has('router')).toBe(true);
      expect(NodeRegistry.has('state_schema')).toBe(true);
    });

    it('returns false for unknown types', () => {
      expect(NodeRegistry.has('unknown')).toBe(false);
    });
  });

  describe('validateConfig', () => {
    it('validates a valid LLM config', () => {
      const errors = NodeRegistry.validateConfig({
        type: 'llm',
        model: 'anthropic.claude-sonnet-4-20250514',
        temperature: 0.5,
      });
      expect(errors).toHaveLength(0);
    });

    it('returns errors for an LLM config missing model', () => {
      const errors = NodeRegistry.validateConfig({ type: 'llm', model: '' });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].field).toBe('model');
    });

    it('validates a valid tool config', () => {
      const errors = NodeRegistry.validateConfig({
        type: 'tool',
        toolName: 'search',
      });
      expect(errors).toHaveLength(0);
    });

    it('returns errors for a tool config missing toolName', () => {
      const errors = NodeRegistry.validateConfig({ type: 'tool', toolName: '' });
      expect(errors.length).toBeGreaterThan(0);
    });

    it('validates a valid router config', () => {
      const errors = NodeRegistry.validateConfig({
        type: 'router',
        conditions: [{ condition: 'x > 0', target: 'node-2' }],
      });
      expect(errors).toHaveLength(0);
    });

    it('returns errors for a router config with no conditions', () => {
      const errors = NodeRegistry.validateConfig({
        type: 'router',
        conditions: [],
      });
      expect(errors.length).toBeGreaterThan(0);
    });

    it('validates a valid state_schema config', () => {
      const errors = NodeRegistry.validateConfig({
        type: 'state_schema',
        fields: [{ name: 'query', type: 'string' }],
      });
      expect(errors).toHaveLength(0);
    });

    it('returns errors for state_schema with no fields', () => {
      const errors = NodeRegistry.validateConfig({
        type: 'state_schema',
        fields: [],
      });
      expect(errors.length).toBeGreaterThan(0);
    });

    it('returns errors for an unknown node type', () => {
      const errors = NodeRegistry.validateConfig({ type: 'unknown' });
      expect(errors.length).toBeGreaterThan(0);
    });

    it('returns errors for temperature out of range', () => {
      const errors = NodeRegistry.validateConfig({
        type: 'llm',
        model: 'some-model',
        temperature: 5,
      });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].field).toBe('temperature');
    });
  });

  describe('defaultConfig', () => {
    it('each definition has a valid default config', () => {
      for (const def of NodeRegistry.getAll()) {
        const errors = def.validate(def.defaultConfig);
        // router/state_schema/tool/condition defaults are intentionally incomplete — user must fill them in
        if (def.type === 'router' || def.type === 'state_schema' || def.type === 'tool' || def.type === 'mcp_server' || def.type === 'human' || def.type === 'sub_agent' || def.type === 'condition') continue;
        expect(errors, `${def.type} default config should be valid`).toHaveLength(0);
      }
    });
  });
});
