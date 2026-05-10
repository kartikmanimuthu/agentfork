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
