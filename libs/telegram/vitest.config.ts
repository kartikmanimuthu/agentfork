import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
  resolve: {
    alias: {
      '@chatbot/shared': path.resolve(__dirname, '../shared/src/index.ts'),
      '@chatbot/ai': path.resolve(__dirname, '../ai/src/index.ts'),
      '@chatbot/agent-studio': path.resolve(__dirname, '../agent-studio/src/index.ts'),
      '@chatbot/agent-studio/server': path.resolve(__dirname, '../agent-studio/src/server.ts'),
    },
  },
});
