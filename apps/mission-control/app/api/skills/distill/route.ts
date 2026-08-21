import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { createLogger, LlmProviderService } from '@chatbot/shared';
import { createClawModel } from '@chatbot/claw-studio';
import { authOptions } from '@/lib/auth';

const logger = createLogger('mission-control:api:skills:distill');
const MAX_TRANSCRIPT_CHARS = 600_000;
const bodySchema = z.object({ transcript: z.string().min(1).max(MAX_TRANSCRIPT_CHARS) });

const DISTILL_PROMPT = `You are distilling Claw's chat transcript into a reusable "skill" — a
generalized procedure Claw can follow again for similar future requests.

The transcript may include tool-call/tool-result content showing the exact
tools or commands Claw actually used — infer the actual domain and tools
from the transcript itself; do not assume any specific system.

Return ONLY a JSON object (no markdown fences) with keys:
- "name": short Title Case name (max 5 words)
- "description": one sentence describing when to use this skill
- "tier": one of "read-only" | "mutation" | "approval-gated" — pick based on
  what the actual tool calls did:
  - "read-only": every tool call only queried/read/listed state, nothing was changed
  - "mutation": at least one tool call created, updated, deleted, sent, or posted something
  - "approval-gated": the transcript shows a destructive/irreversible action, or Claw explicitly asked for confirmation first
- "content": a markdown SKILL body with a one-line intro and a numbered,
  generalized step-by-step procedure GROUNDED in the actual tool calls made.
  Strip one-off identifiers and replace with placeholders — describe the
  repeatable method, not the one-off answer.

Transcript:
`;

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.studio?.tenantId) {
      return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    }
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }

    const tenantId = session.studio.tenantId;
    const config = await new LlmProviderService(tenantId).getDefaultConfig();
    if (!config) {
      return NextResponse.json({ success: false, error: 'No LLM provider configured for this tenant' }, { status: 400 });
    }
    const model = createClawModel(config);
    const resp = await model.invoke(`${DISTILL_PROMPT}\n${parsed.data.transcript}`);
    const raw = typeof resp.content === 'string' ? resp.content : JSON.stringify(resp.content);
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      logger.error({ tenantId }, 'Distill: model reply was not parseable JSON');
      return NextResponse.json({ success: false, error: 'Model did not return valid JSON' }, { status: 502 });
    }
    const draft = JSON.parse(match[0]) as { name?: string; description?: string; tier?: string; content?: string };
    const validTiers = ['read-only', 'mutation', 'approval-gated'];
    const tier = validTiers.includes(draft.tier ?? '') ? draft.tier : 'read-only';
    return NextResponse.json({
      success: true,
      data: { name: draft.name ?? 'Untitled Skill', description: draft.description ?? '', tier, content: draft.content ?? '' },
    });
  } catch (error) {
    logger.error({ error }, 'Failed to distill skill');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
