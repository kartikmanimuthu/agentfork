/**
 * Turns a failed turn into a sentence that tells the user what to do about it.
 *
 * Every failure used to surface as "Claw encountered an error. Please try again."
 * — advice that is right for a transient blip and actively misleading for the two
 * most common real causes. A model that timed out on an oversized prompt will time
 * out again on retry, and a Google account whose refresh token was rejected
 * (`invalid_grant`) will keep failing until someone reconnects it. Both were
 * indistinguishable from the UI, so diagnosing them meant reading the server log.
 *
 * Deliberately conservative: anything unrecognised keeps the original wording
 * rather than guessing, so a new failure mode can never be described wrongly.
 */
const GENERIC = 'Claw encountered an error. Please try again.';

export function describeRunFailure(err: unknown): string {
  const name = err instanceof Error ? err.name : '';
  const message = err instanceof Error ? err.message : '';
  const haystack = `${name} ${message}`;

  if (name === 'TimeoutError' || /timed out|timeout/i.test(haystack)) {
    return 'The model did not respond in time. This usually means the conversation grew too large for it, or the provider is overloaded — try a shorter request, a new thread, or a different model.';
  }

  if (name === 'OAuthReauthRequiredError' || /invalid_grant|reauth/i.test(haystack)) {
    return 'A connected account needs to be reconnected before Claw can use it. Open Integrations and reconnect the account, then try again.';
  }

  if (/chatModel is required|provider config|unsupported provider|missing a base URL/i.test(haystack)) {
    return 'This tenant\'s LLM provider is not fully configured. Check the provider in LLM Providers — it needs a chat model and an endpoint.';
  }

  return GENERIC;
}
