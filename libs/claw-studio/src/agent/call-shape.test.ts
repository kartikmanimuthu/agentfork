import { describe, it, expect } from 'vitest';
import { summarizeCallShape } from './call-shape';

describe('summarizeCallShape', () => {
  // The point of this is to separate what summarization CAN shrink (messages)
  // from what it cannot (system prompt, tool schemas). If the fixed half alone
  // exceeds the model's input budget, compaction can never bring a call under it
  // and no amount of trimming history will stop the timeouts — that is the
  // distinction the timeout debugging turned on.
  it('separates compactable history from the fixed system prompt and tool schemas', () => {
    const shape = summarizeCallShape(
      [
        { _getType: () => 'system', content: 'x'.repeat(400) },
        { _getType: () => 'human', content: 'y'.repeat(200) },
        { _getType: () => 'tool', content: 'z'.repeat(200) },
      ],
      [{ name: 'a', description: 'd'.repeat(96) }],
    );

    expect(shape.systemChars).toBe(400);
    expect(shape.historyChars).toBe(400);
    // The tool array serializes to more than its description alone; assert it is
    // counted at all rather than pinning JSON punctuation.
    expect(shape.toolSchemaChars).toBeGreaterThan(96);
  });

  it('estimates tokens at roughly four characters each', () => {
    const shape = summarizeCallShape([{ _getType: () => 'human', content: 'a'.repeat(4000) }], []);
    expect(shape.estPromptTokens).toBe(1000);
  });

  it('counts the fixed half as system prompt plus tool schemas', () => {
    const shape = summarizeCallShape([{ _getType: () => 'system', content: 's'.repeat(1000) }], []);
    expect(shape.estFixedTokens).toBe(Math.round(shape.systemChars / 4));
  });

  it('survives multimodal content blocks instead of counting [object Object]', () => {
    const shape = summarizeCallShape(
      [{ _getType: () => 'human', content: [{ type: 'text', text: 'hello' }] }],
      [],
    );
    expect(shape.historyChars).toBeGreaterThan(0);
    expect(shape.estPromptTokens).toBeGreaterThanOrEqual(1);
  });

  it('handles an empty call without dividing by zero or throwing', () => {
    const shape = summarizeCallShape([], []);
    expect(shape).toEqual({
      systemChars: 0,
      historyChars: 0,
      toolSchemaChars: 0,
      messageCount: 0,
      estPromptTokens: 0,
      estFixedTokens: 0,
    });
  });
});
