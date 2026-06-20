/**
 * Guardrails API parity (e2e).
 *
 * Route-level coverage for the guardrails surface. The PRIMARY guardrail
 * coverage is the in-process integration test at
 * `libs/guardrails/src/integration/inference.integration.test.ts`, which
 * composes the guardrails components the way the routes do, via the public
 * API with stubs — fast and reliable (no DB / auth / LLM). This e2e module
 * adds:
 *  - An unconditional negative-parity test: an unauthenticated POST to
 *    `/api/v1/inference` is rejected with 401 regardless of any guardrails
 *    config in the body. Guardrails never change auth rejection. This runs
 *    in the existing harness (no seeded agent needed) and mirrors
 *    `modules/inference-api/inference-api.spec.ts`.
 *  - Positive route-level scenarios (block/mask) gated by `hasGuardrailsCreds()`,
 *    which require a seeded guardrails agent + valid API key. These are an
 *    additional CI-only layer; when no fixture is provisioned they are skipped.
 */
import { test, expect } from '../../fixtures/base';
import { TAG } from '../../constants/tags';
import { env, hasGuardrailsCreds } from '../../config/env';

test.describe('Guardrails API parity', { tag: [TAG.guardrails, TAG.api, TAG.regression] }, () => {
  test('unauthenticated POST /api/v1/inference is rejected (guardrails do not bypass auth)', async ({ request }) => {
    const response = await request.post('/api/v1/inference', {
      // Body carries a guardrails-shaped config; auth must still reject first.
      data: {
        messages: [{ role: 'user', content: 'Hello' }],
        guardrails: { enabled: true, input: { bannedPhrases: { phrases: ['x'], action: 'block' } } },
      },
    });
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.error.type).toBe('invalid_api_key');
  });
});

// Positive route-level scenarios require a seeded guardrails agent + valid API
// key (and, for the judge, a live LLM). Skipped unless both env vars are set.
// Positive coverage is ALSO provided by the in-process integration test.
test.describe('Guardrails API positive routes (seeded agent)', () => {
  test.skip(!hasGuardrailsCreds(), 'requires seeded guardrails agent');

  test('input banned-phrase block returns a refusal (non-stream JSON)', async ({ request }) => {
    const response = await request.post('/api/v1/inference', {
      headers: { Authorization: `Bearer ${env.E2E_GUARDRAILS_API_KEY}` },
      data: {
        agentId: env.E2E_GUARDRAILS_AGENT_ID,
        messages: [{ role: 'user', content: 'this is forbidden' }],
        stream: false,
      },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.blocked).toBe(true);
  });

  test('input PII mask passes through with PII redacted', async ({ request }) => {
    const response = await request.post('/api/v1/inference', {
      headers: { Authorization: `Bearer ${env.E2E_GUARDRAILS_API_KEY}` },
      data: {
        agentId: env.E2E_GUARDRAILS_AGENT_ID,
        messages: [{ role: 'user', content: 'my SSN is 123-45-6789' }],
        stream: false,
      },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    // The masked text is what gets persisted/served; raw SSN must not leak.
    expect(JSON.stringify(body)).not.toContain('123-45-6789');
  });
});