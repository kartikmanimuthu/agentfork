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
    alias: [
      {
        find: /^@chatbot\/shared\/workers$/,
        replacement: path.resolve(__dirname, '../shared/src/workers.ts'),
      },
      {
        find: /^@chatbot\/shared\/client$/,
        replacement: path.resolve(__dirname, '../shared/src/client.ts'),
      },
      {
        find: /^@chatbot\/shared$/,
        replacement: path.resolve(__dirname, '../shared/src/index.ts'),
      },
      {
        find: /^@chatbot\/ai$/,
        replacement: path.resolve(__dirname, '../ai/src/index.ts'),
      },
    ],
  },
});
