/**
 * memory-tools.ts
 *
 * `save_memory`/`search_memory` LangChain tools bound into Claw's `generate`
 * node — ported verbatim (schemas, descriptions, tool bodies) from nucleus
 * lib/agent/model-factory.ts's `createMemoryTools(tenantId, userId)`, wired
 * to this repo's own `saveMemory`/`searchMemory` (Plan C2, `./persistence`).
 *
 * This is the minimal tool surface `generate` binds until Plan C4 (skill
 * loader tool) and Plan C5 (MCP tools) add more.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { saveMemory, searchMemory } from './persistence';

export function createMemoryTools(tenantId: string, userId: string) {
  return [
    tool(
      async (input: { namespace: string[]; key: string; value: Record<string, unknown> }) => {
        await saveMemory(tenantId, userId, input.namespace, input.key, input.value);
        return `Memory saved: ${input.namespace.join('/')}/${input.key}`;
      },
      {
        name: 'save_memory',
        description: 'Save a fact, preference, or finding to long-term memory for the current user. Use for user preferences, infrastructure facts, and recurring task patterns.',
        schema: z.object({
          namespace: z.array(z.string()).describe('Namespace path e.g. ["user","preferences"] or ["infra","<account-id>"]'),
          key: z.string().describe('Unique key within the namespace'),
          value: z.record(z.string(), z.unknown()).describe('Structured data to store'),
        }),
      },
    ),
    tool(
      async (input: { namespacePrefix: string[]; query: string; limit?: number }) => {
        const results = await searchMemory(tenantId, userId, input.namespacePrefix, input.query, input.limit ?? 5);
        if (!results || (results as unknown[]).length === 0) return 'No memories found.';
        return JSON.stringify(results, null, 2);
      },
      {
        name: 'search_memory',
        description: 'Search long-term memory for the current user using semantic search. Call at the start of a new task to retrieve relevant context from previous sessions.',
        schema: z.object({
          namespacePrefix: z.array(z.string()).describe('Namespace prefix to search within e.g. ["user"] or ["infra"]'),
          query: z.string().describe('Natural language query describing what to look for'),
          limit: z.number().optional().describe('Max results to return (default 5)'),
        }),
      },
    ),
  ];
}
