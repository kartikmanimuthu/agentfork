import { describe, it, expect } from 'vitest';
import { createDeepAgent } from 'deepagents';
import type { BackendProtocolV2 } from 'deepagents';
import { FakeListChatModel } from '@langchain/core/utils/testing';

/**
 * Minimal BackendProtocolV2 — proves a hand-written backend is accepted.
 *
 * Note: the real `BackendProtocolV2` (node_modules/deepagents/dist/agent-*.d.ts)
 * still requires `edit()` — it is inherited, unmodified, from `BackendProtocolV1`
 * (V2's `Omit<BackendProtocolV1, ...>` does not omit it). `execute()` is NOT part
 * of `BackendProtocolV2` (it belongs to `SandboxBackendProtocolV2`) but is kept
 * here as harmless extra surface since TS interfaces don't forbid extra members.
 */
class StubBackend implements BackendProtocolV2 {
  async ls() {
    return { files: [{ path: '/a.md', is_dir: false }] };
  }
  async read() {
    return { content: 'hello' };
  }
  async readRaw() {
    return {
      data: {
        content: 'hello',
        mimeType: 'text/plain',
        created_at: new Date(0).toISOString(),
        modified_at: new Date(0).toISOString(),
      },
    };
  }
  async write() {
    return { path: '/a.md' };
  }
  async edit() {
    return { path: '/a.md', occurrences: 1 };
  }
  async grep() {
    return { matches: [] };
  }
  async glob() {
    return { files: [] };
  }
  async execute() {
    return { output: '', exitCode: 0, truncated: false };
  }
}

describe('deepagents contract', () => {
  it('accepts a hand-written BackendProtocolV2', () => {
    const agent = createDeepAgent({
      model: new FakeListChatModel({ responses: ['ok'] }),
      tools: [],
      backend: new StubBackend(),
    });
    expect(agent).toBeDefined();
    expect(typeof agent.stream).toBe('function');
    expect(typeof agent.invoke).toBe('function');
  });
});
