import { describe, it, expect } from 'vitest';
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { computeReflectionStall, REFLECTION_STALL_LIMIT, sanitizeToolCallPairs } from './agent-shared';

describe('computeReflectionStall', () => {
  it('resets the stall count when there is no issue', () => {
    expect(computeReflectionStall('', undefined, 3)).toEqual({ stallCount: 0, stalled: false });
    expect(computeReflectionStall('None', 'None', 3)).toEqual({ stallCount: 0, stalled: false });
  });

  it('resets the stall count when the issue differs from the previous one', () => {
    expect(computeReflectionStall('issue B', 'issue A', 1)).toEqual({ stallCount: 0, stalled: false });
  });

  it('increments the stall count when the same issue repeats', () => {
    expect(computeReflectionStall('issue A', 'issue A', 0)).toEqual({ stallCount: 1, stalled: false });
  });

  it('flags stalled once the repeat count reaches REFLECTION_STALL_LIMIT', () => {
    const result = computeReflectionStall('issue A', 'issue A', REFLECTION_STALL_LIMIT - 1);
    expect(result.stallCount).toBe(REFLECTION_STALL_LIMIT);
    expect(result.stalled).toBe(true);
  });

  it('counts a reworded repeat as a stall when the model flags it as the same core issue', () => {
    // Text differs completely, so the normalized-equality path alone would
    // reset this to 0 — sameCoreIssueAsBefore is what should carry it forward.
    const result = computeReflectionStall(
      'the Jira ticket ID passed to the API does not exist',
      'tool call failed: unknown issue key',
      1,
      true,
    );
    expect(result).toEqual({ stallCount: 2, stalled: true });
  });

  it('ignores sameCoreIssueAsBefore when there is no real previous issue', () => {
    // A caller passing `true` with nothing to compare against must not be
    // able to manufacture a stall out of thin air.
    expect(computeReflectionStall('issue A', undefined, 0, true)).toEqual({ stallCount: 0, stalled: false });
    expect(computeReflectionStall('issue A', 'None', 0, true)).toEqual({ stallCount: 0, stalled: false });
  });

  it('does not stall on a reworded issue when the model does not flag it as the same', () => {
    const result = computeReflectionStall(
      'the Jira ticket ID passed to the API does not exist',
      'tool call failed: unknown issue key',
      1,
      false,
    );
    expect(result).toEqual({ stallCount: 0, stalled: false });
  });
});

describe('sanitizeToolCallPairs', () => {
  it('drops an assistant tool_call that has no tool response (the dangling-orphan case)', () => {
    const messages = [
      new HumanMessage('list my tasks'),
      new AIMessage({ content: '', tool_calls: [{ id: 'call_1', name: 'search', args: {} }] }),
    ];
    const out = sanitizeToolCallPairs(messages);
    // The orphaned tool_call message is removed entirely (it had no text), so no
    // assistant-with-tool_calls survives without a matching response.
    expect(out).toHaveLength(1);
    expect(out[0]._getType()).toBe('human');
  });

  it('keeps the assistant text but strips the orphaned tool_calls when the message also has content', () => {
    const messages = [
      new HumanMessage('hi'),
      new AIMessage({ content: 'Let me check that.', tool_calls: [{ id: 'call_x', name: 'search', args: {} }] }),
    ];
    const out = sanitizeToolCallPairs(messages);
    expect(out).toHaveLength(2);
    const ai = out[1] as AIMessage;
    expect(ai._getType()).toBe('ai');
    expect(ai.tool_calls ?? []).toHaveLength(0);
    expect(ai.content).toBe('Let me check that.');
  });

  it('keeps a properly paired tool_call + tool response intact', () => {
    const messages = [
      new HumanMessage('list my tasks'),
      new AIMessage({ content: '', tool_calls: [{ id: 'call_1', name: 'search', args: {} }] }),
      new ToolMessage({ content: 'PROJ-1, PROJ-2', tool_call_id: 'call_1' }),
      new AIMessage('You have 2 tasks.'),
    ];
    const out = sanitizeToolCallPairs(messages);
    expect(out).toHaveLength(4);
    expect((out[1] as AIMessage).tool_calls ?? []).toHaveLength(1);
  });

  it('drops an orphaned tool response whose call is absent', () => {
    const messages = [
      new HumanMessage('hi'),
      new ToolMessage({ content: 'stale result', tool_call_id: 'call_gone' }),
      new AIMessage('done'),
    ];
    const out = sanitizeToolCallPairs(messages);
    expect(out.some((m) => m._getType() === 'tool')).toBe(false);
    expect(out).toHaveLength(2);
  });
});
