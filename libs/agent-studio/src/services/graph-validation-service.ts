import { NodeRegistry } from '../registry/node-registry';
import type { GraphDefinition, GraphNode, GraphEdge } from '../types/agent';
import type { ValidationError } from '../types/nodes';

export interface GraphValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export class GraphValidationService {
  /**
   * Run all validation rules against a graph definition.
   * Returns a result with all accumulated errors (not fail-fast).
   */
  static validate(graph: GraphDefinition): GraphValidationResult {
    const errors: ValidationError[] = [
      ...this.validateEdgeReferences(graph),
      ...this.validateEntryNode(graph),
      ...this.validateNoOrphanNodes(graph),
      ...this.validateRouterEdges(graph),
      ...this.validateStateSchema(graph),
      ...this.validateNodeConfigs(graph),
    ];

    return { valid: errors.length === 0, errors };
  }

  // ─── Rule: all edge source/target IDs must reference existing nodes ──────────

  static validateEdgeReferences(graph: GraphDefinition): ValidationError[] {
    const nodeIds = new Set(graph.nodes.map((n) => n.id));
    const errors: ValidationError[] = [];

    for (const edge of graph.edges) {
      if (!nodeIds.has(edge.source)) {
        errors.push({
          field: `edges[${edge.id}].source`,
          message: `Edge references non-existent source node "${edge.source}"`,
          code: 'INVALID_EDGE_SOURCE',
        });
      }
      if (!nodeIds.has(edge.target)) {
        errors.push({
          field: `edges[${edge.id}].target`,
          message: `Edge references non-existent target node "${edge.target}"`,
          code: 'INVALID_EDGE_TARGET',
        });
      }
    }

    return errors;
  }

  // ─── Rule: exactly one entry node (node with no incoming edges) ──────────────

  static validateEntryNode(graph: GraphDefinition): ValidationError[] {
    if (graph.nodes.length === 0) return [];

    const nodesWithIncoming = new Set(graph.edges.map((e) => e.target));
    const entryNodes = graph.nodes.filter((n) => !nodesWithIncoming.has(n.id));

    if (entryNodes.length === 0) {
      return [
        {
          field: 'nodes',
          message: 'Graph has no entry node — at least one node must have no incoming edges',
          code: 'NO_ENTRY_NODE',
        },
      ];
    }

    if (entryNodes.length > 1) {
      return [
        {
          field: 'nodes',
          message: `Graph has ${entryNodes.length} entry nodes (${entryNodes.map((n) => `"${n.id}"`).join(', ')}); expected exactly one`,
          code: 'MULTIPLE_ENTRY_NODES',
        },
      ];
    }

    return [];
  }

  // ─── Rule: no orphan nodes (every node must have at least one edge) ──────────

  static validateNoOrphanNodes(graph: GraphDefinition): ValidationError[] {
    if (graph.nodes.length <= 1) return [];

    const connectedNodeIds = new Set<string>();
    for (const edge of graph.edges) {
      connectedNodeIds.add(edge.source);
      connectedNodeIds.add(edge.target);
    }

    const errors: ValidationError[] = [];
    for (const node of graph.nodes) {
      if (!connectedNodeIds.has(node.id)) {
        errors.push({
          field: `nodes[${node.id}]`,
          message: `Node "${node.id}" (${node.label}) is orphaned — it has no edges`,
          code: 'ORPHAN_NODE',
        });
      }
    }

    return errors;
  }

  // ─── Rule: router nodes must have outgoing edges for each condition ──────────

  static validateRouterEdges(graph: GraphDefinition): ValidationError[] {
    const errors: ValidationError[] = [];
    const outgoingEdges = this._buildOutgoingMap(graph.edges);

    for (const node of graph.nodes) {
      if (node.config.type !== 'router') continue;

      const outgoing = outgoingEdges.get(node.id) ?? [];
      const conditionCount = node.config.conditions.length;

      if (outgoing.length < conditionCount) {
        errors.push({
          field: `nodes[${node.id}].config.conditions`,
          message: `Router node "${node.id}" has ${conditionCount} condition(s) but only ${outgoing.length} outgoing edge(s)`,
          code: 'ROUTER_MISSING_EDGES',
        });
      }

      // Verify each condition's target node exists
      const nodeIds = new Set(graph.nodes.map((n) => n.id));
      for (let i = 0; i < node.config.conditions.length; i++) {
        const { target } = node.config.conditions[i];
        if (!nodeIds.has(target)) {
          errors.push({
            field: `nodes[${node.id}].config.conditions[${i}].target`,
            message: `Router condition target "${target}" does not exist`,
            code: 'ROUTER_INVALID_TARGET',
          });
        }
      }

      if (node.config.defaultTarget && !nodeIds.has(node.config.defaultTarget)) {
        errors.push({
          field: `nodes[${node.id}].config.defaultTarget`,
          message: `Router default target "${node.config.defaultTarget}" does not exist`,
          code: 'ROUTER_INVALID_DEFAULT_TARGET',
        });
      }
    }

    return errors;
  }

  // ─── Rule: at most one state_schema node ────────────────────────────────────

  static validateStateSchema(graph: GraphDefinition): ValidationError[] {
    const schemaNodes = graph.nodes.filter((n) => n.config.type === 'state_schema');

    if (schemaNodes.length > 1) {
      return [
        {
          field: 'nodes',
          message: `Graph has ${schemaNodes.length} state_schema nodes; at most one is allowed`,
          code: 'MULTIPLE_STATE_SCHEMA_NODES',
        },
      ];
    }

    return [];
  }

  // ─── Rule: each node config must be valid per NodeRegistry ──────────────────

  static validateNodeConfigs(graph: GraphDefinition): ValidationError[] {
    const errors: ValidationError[] = [];

    for (const node of graph.nodes) {
      if (!NodeRegistry.has(node.config.type)) {
        errors.push({
          field: `nodes[${node.id}].config.type`,
          message: `Unknown node type "${node.config.type}"`,
          code: 'UNKNOWN_NODE_TYPE',
        });
        continue;
      }

      const def = NodeRegistry.get(node.config.type);
      const configErrors = def.validate(node.config);
      for (const err of configErrors) {
        errors.push({
          field: `nodes[${node.id}].config.${err.field}`,
          message: err.message,
          code: err.code,
        });
      }
    }

    return errors;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private static _buildOutgoingMap(edges: GraphEdge[]): Map<string, GraphEdge[]> {
    const map = new Map<string, GraphEdge[]>();
    for (const edge of edges) {
      const list = map.get(edge.source) ?? [];
      list.push(edge);
      map.set(edge.source, list);
    }
    return map;
  }

  /** Convenience: build a minimal valid node for tests */
  static _makeNode(overrides: Partial<GraphNode> & { id: string }): GraphNode {
    return {
      label: overrides.id,
      config: { type: 'llm', model: 'test-model' },
      position: { x: 0, y: 0 },
      type: overrides.config?.type ?? 'llm',
      ...overrides,
    };
  }
}
