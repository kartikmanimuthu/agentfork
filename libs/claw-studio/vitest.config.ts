import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      // Must precede the bare '@chatbot/shared' entry — Vite matches aliases in
      // declaration order, so the shorter key would otherwise swallow this one.
      '@chatbot/shared/server': path.resolve(__dirname, '../../libs/shared/src/server.ts'),
      '@chatbot/shared': path.resolve(__dirname, '../../libs/shared/src/index.ts'),
      '@chatbot/whatsapp': path.resolve(__dirname, '../../libs/whatsapp/src/index.ts'),
      // Deep-imported (not the @chatbot/agent-studio / @chatbot/agent-studio/server
      // barrels) so pulling in MCP support doesn't drag agent-studio's WhatsApp/
      // Telegram node executors (and their own transitive deps) into this lib's
      // test graph — mirrors why claw-studio exposes its own "./*" subpath export.
      // Same reasoning as the agent-studio deep imports below: importing the
      // @chatbot/ai barrel to reach one pure function would pull the Bedrock
      // provider, transcription, and the AI SDK into this lib's test graph.
      '@chatbot/ai/tools/url-guard': path.resolve(__dirname, '../../libs/ai/src/tools/url-guard.ts'),
      '@chatbot/ai/tools/web-search': path.resolve(__dirname, '../../libs/ai/src/tools/web-search.ts'),
      '@chatbot/ai/tools/web-fetch': path.resolve(__dirname, '../../libs/ai/src/tools/web-fetch.ts'),
      '@chatbot/ai/tools/built-in-registry': path.resolve(__dirname, '../../libs/ai/src/tools/built-in-registry.ts'),
      '@chatbot/agent-studio/services/mcp-server-service': path.resolve(__dirname, '../../libs/agent-studio/src/services/mcp-server-service.ts'),
      '@chatbot/agent-studio/services/mcp-client.service': path.resolve(__dirname, '../../libs/agent-studio/src/services/mcp-client.service.ts'),
      '@chatbot/agent-studio/types/mcp-server': path.resolve(__dirname, '../../libs/agent-studio/src/types/mcp-server.ts'),
      // LangChain/MCP packages vendor their own nested zod@3 copies
      // (node_modules/@langchain+*/node_modules/zod). Without pinning this,
      // Vite's resolver non-deterministically picks one of those nested
      // copies for the bare "zod" specifier instead of the root-hoisted
      // zod@4 that @t3-oss/env-core (T3 Env) requires, breaking `z.string`/
      // `z.enum` at runtime. Force every "zod" import in this project to the
      // one canonical root install.
      zod: path.resolve(__dirname, '../../node_modules/zod/index.cjs'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    // Many suites here are integration-style against the real Postgres in
    // DATABASE_URL, which is commonly a REMOTE host — `resolveClawRuntime`
    // alone runs a long sequential chain (studio → claw → MCP servers →
    // provider → checkpointer → six workspace-file upserts), and one network
    // round-trip per query blows past vitest's 5s default.
    //
    // That default made claw-runtime/persistence/skill-synthesis fail
    // permanently, and the failures got written off as "needs local Postgres"
    // across an entire migration — hiding real integration coverage that
    // passes fine given time. At 60s the full suite is 834/834.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
