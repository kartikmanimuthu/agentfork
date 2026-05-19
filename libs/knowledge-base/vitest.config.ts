import { defineConfig } from 'vitest/config';

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
        replacement: '/Users/kartik/.superset/worktrees/chatbot/kb/libs/shared/src/workers.ts',
      },
      {
        find: /^@chatbot\/shared\/client$/,
        replacement: '/Users/kartik/.superset/worktrees/chatbot/kb/libs/shared/src/client.ts',
      },
      {
        find: /^@chatbot\/shared$/,
        replacement: '/Users/kartik/.superset/worktrees/chatbot/kb/libs/shared/src/index.ts',
      },
      {
        find: /^@chatbot\/ai$/,
        replacement: '/Users/kartik/.superset/worktrees/chatbot/kb/libs/ai/src/index.ts',
      },
    ],
  },
});
