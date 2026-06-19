import { NextRequest, NextResponse } from 'next/server';
import { getPrismaClient } from '@chatbot/shared';
import crypto from 'crypto';

export interface ScoreAuthResult { tenantId: string; apiKeyId: string; }

export async function validateScoreApiKey(
  req: NextRequest,
): Promise<{ success: true; auth: ScoreAuthResult } | { success: false; response: NextResponse }> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { success: false, response: NextResponse.json({ error: { type: 'invalid_api_key', message: 'Missing or invalid Authorization header' } }, { status: 401 }) };
  }
  const rawKey = authHeader.slice(7);
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const db = getPrismaClient();
  const apiKey = await db.apiKey.findFirst({ where: { keyHash } }) as { id: string; tenantId: string; status: string; expiresAt: Date | null; scopes: string[] } | null;

  if (!apiKey) return { success: false, response: NextResponse.json({ error: { type: 'invalid_api_key', message: 'API key not found' } }, { status: 401 }) };
  if (apiKey.status === 'revoked') return { success: false, response: NextResponse.json({ error: { type: 'invalid_api_key', message: 'API key has been revoked' } }, { status: 401 }) };
  if (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date()) return { success: false, response: NextResponse.json({ error: { type: 'invalid_api_key', message: 'API key has expired' } }, { status: 401 }) };
  if (!apiKey.scopes?.includes('scores:write')) {
    return { success: false, response: NextResponse.json({ error: { type: 'insufficient_scope', message: 'API key missing scores:write scope' } }, { status: 403 }) };
  }
  return { success: true, auth: { tenantId: apiKey.tenantId, apiKeyId: apiKey.id } };
}
