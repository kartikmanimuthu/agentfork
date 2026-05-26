import { test, expect } from '@playwright/test';

test.describe('Inference API', () => {
  test('should reject request without API key', async ({ request }) => {
    const response = await request.post('/api/v1/inference', {
      data: { messages: [{ role: 'user', content: 'Hello' }] },
    });
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.error.type).toBe('invalid_api_key');
  });

  test('should reject request with invalid API key', async ({ request }) => {
    const response = await request.post('/api/v1/inference', {
      headers: { Authorization: 'Bearer invalid_key_12345' },
      data: { messages: [{ role: 'user', content: 'Hello' }] },
    });
    expect(response.status()).toBe(401);
  });

  test('should get usage stats with invalid key', async ({ request }) => {
    const response = await request.get('/api/v1/inference/usage', {
      headers: { Authorization: 'Bearer invalid_key_12345' },
    });
    expect(response.status()).toBe(401);
  });
});

test.describe('Inference Sessions API', () => {
  test('POST /sessions rejects without API key', async ({ request }) => {
    const response = await request.post('/api/v1/inference/sessions', {
      data: { name: 'test', channel: 'API' },
    });
    expect(response.status()).toBe(401);
  });

  test('GET /sessions rejects without API key', async ({ request }) => {
    const response = await request.get('/api/v1/inference/sessions');
    expect(response.status()).toBe(401);
  });

  test('POST /sessions/{id}/close rejects without API key', async ({ request }) => {
    const response = await request.post('/api/v1/inference/sessions/some-id/close');
    expect(response.status()).toBe(401);
  });

  test('GET /sessions/{id} rejects without API key', async ({ request }) => {
    const response = await request.get('/api/v1/inference/sessions/some-id');
    expect(response.status()).toBe(401);
  });

  test('DELETE /sessions/{id} rejects without API key', async ({ request }) => {
    const response = await request.delete('/api/v1/inference/sessions/some-id');
    expect(response.status()).toBe(401);
  });
});

test.describe('Sessions Dashboard API', () => {
  test('GET /api/sessions rejects unauthenticated', async ({ request }) => {
    const response = await request.get('/api/sessions');
    // Either 401 (unauthenticated) or 403 (signed in but no role) — both acceptable.
    expect([401, 403]).toContain(response.status());
  });
});

test.describe('Inferences Dashboard API', () => {
  test('GET /api/inferences rejects unauthenticated', async ({ request }) => {
    const response = await request.get('/api/inferences');
    expect([401, 403]).toContain(response.status());
  });

  test('GET /api/inferences/[id] rejects unauthenticated', async ({ request }) => {
    const response = await request.get('/api/inferences/some-id');
    expect([401, 403]).toContain(response.status());
  });
});
