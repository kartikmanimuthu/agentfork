import { describe, it, expect } from 'vitest';
import { validateWebhookSecret } from './signature';

describe('validateWebhookSecret', () => {
  it('returns false for missing header', () => {
    expect(validateWebhookSecret(null, 'secret')).toBe(false);
  });

  it('returns false for wrong secret', () => {
    expect(validateWebhookSecret('wrong', 'secret')).toBe(false);
  });

  it('returns true for valid secret', () => {
    expect(validateWebhookSecret('secret', 'secret')).toBe(true);
  });
});
