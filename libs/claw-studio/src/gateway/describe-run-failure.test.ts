import { describe, it, expect } from 'vitest';
import { describeRunFailure } from './describe-run-failure';

describe('describeRunFailure', () => {
  // A turn dies for very different reasons — the model never answered, a
  // connected Google account needs reauthorizing, the provider is misconfigured
  // — and all three used to reach the user as the single sentence "Claw
  // encountered an error. Please try again.". Retrying is right for exactly one
  // of them, so the message has to say which happened.
  it('names a model timeout, since retrying the same prompt will time out again', () => {
    const err = Object.assign(new Error('Request timed out.'), { name: 'TimeoutError' });
    expect(describeRunFailure(err)).toMatch(/model/i);
    expect(describeRunFailure(err)).toMatch(/timed out|did not respond/i);
  });

  it('recognises a timeout reported only in the message, as LangChain wraps it', () => {
    const wrapped = new Error('Request timed out.: Request timed out.: Request timed out.');
    expect(describeRunFailure(wrapped)).toMatch(/timed out|did not respond/i);
  });

  it('asks for reconnection when a connected account lost authorization', () => {
    const err = Object.assign(new Error('token refresh rejected'), { name: 'OAuthReauthRequiredError' });
    expect(describeRunFailure(err)).toMatch(/reconnect/i);
  });

  it('treats an invalid_grant as needing reconnection too', () => {
    expect(describeRunFailure(new Error('Google token refresh rejected: invalid_grant'))).toMatch(/reconnect/i);
  });

  it('points at provider configuration when no chat model is set', () => {
    const err = new Error('createClawModel: chatModel is required on the provider config');
    expect(describeRunFailure(err)).toMatch(/provider/i);
  });

  it('falls back to the original wording for anything unrecognised', () => {
    expect(describeRunFailure(new Error('something nobody predicted'))).toBe(
      'Claw encountered an error. Please try again.',
    );
  });

  it('handles a non-Error throw without crashing the stream', () => {
    expect(describeRunFailure('just a string')).toBe('Claw encountered an error. Please try again.');
    expect(describeRunFailure(undefined)).toBe('Claw encountered an error. Please try again.');
  });
});
