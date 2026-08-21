import { describe, expect, it } from 'vitest';
import { mapRunStatusToOutcome } from './scheduled-notifier';

describe('mapRunStatusToOutcome', () => {
  it('maps terminal success to result', () => {
    expect(mapRunStatusToOutcome('completed')).toBe('result');
  });

  it('maps failure and cancellation to failure', () => {
    expect(mapRunStatusToOutcome('failed')).toBe('failure');
    expect(mapRunStatusToOutcome('cancelled')).toBe('failure');
  });

  it('maps both awaiting states to attention', () => {
    expect(mapRunStatusToOutcome('awaiting_input')).toBe('attention');
    expect(mapRunStatusToOutcome('awaiting_approval')).toBe('attention');
  });

  it('returns null for non-terminal statuses so nothing is delivered mid-run', () => {
    expect(mapRunStatusToOutcome('queued')).toBeNull();
    expect(mapRunStatusToOutcome('in_progress')).toBeNull();
    expect(mapRunStatusToOutcome('anything-else')).toBeNull();
  });
});
