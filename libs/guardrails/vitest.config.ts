import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      thresholds: {
        lines: 60,
        branches: 60,
        functions: 60,
      },
    },
  },
  resolve: {
    alias: {
      '@chatbot/shared': path.resolve(__dirname, '../shared/src/index.ts'),
      '@chatbot/ai': path.resolve(__dirname, '../ai/src/index.ts'),
    },
  },
});