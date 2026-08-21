import { describe, it, expect } from 'vitest';
import { withTimeout, TimeoutError } from './with-timeout';

function delay<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

describe('withTimeout', () => {
  it('resolves with the original value when the promise settles before the timeout', async () => {
    const result = await withTimeout(delay(10, 'done'), 200, 'should not fire');
    expect(result).toBe('done');
  });

  it('rejects with TimeoutError when the promise takes longer than the timeout', async () => {
    await expect(withTimeout(delay(200, 'too slow'), 10, 'timed out waiting')).rejects.toThrow(TimeoutError);
    await expect(withTimeout(delay(200, 'too slow'), 10, 'timed out waiting')).rejects.toThrow('timed out waiting');
  });

  it('propagates the original rejection when the promise rejects before the timeout', async () => {
    const failing = Promise.reject(new Error('boom'));
    await expect(withTimeout(failing, 200, 'should not fire')).rejects.toThrow('boom');
  });
});
