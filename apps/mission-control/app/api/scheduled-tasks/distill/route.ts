import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Cron } from 'croner';
import { createLogger, LlmProviderService } from '@chatbot/shared';
import { createClawModel } from '@chatbot/claw-studio';
import { UnauthenticatedError, resolveClawForSession } from '@/lib/claw-resolver';

const logger = createLogger('mission-control:api:scheduled-tasks:distill');

/** Provider-agnostic backstop, matching nucleus's skills/scheduled-task distillers. */
const MAX_TRANSCRIPT_CHARS = 600_000;

/** Fallback cadence when the conversation gives no schedule signal. */
const DEFAULT_CRON = '0 9 * * *';

const bodySchema = z.object({ transcript: z.string().min(1, 'Missing transcript') });

/**
 * Ported from nucleus `app/api/agent-ops/scheduled-tasks/distill/route.ts`. Its rules
 * are the important part and are kept verbatim: KEEP concrete identifiers (this is
 * one specific job, not a reusable template), rewrite every time window as relative
 * to run time, never ask a clarifying question — there is no human at 10am.
 */
const DISTILL_PROMPT = `You are converting an AI agent's chat transcript into a RECURRING SCHEDULED TASK
— a single, self-contained instruction the same agent will run on a schedule,
UNATTENDED, with NO human available to answer questions.

The transcript may include TOOL_CALL / TOOL_RESULT blocks showing the exact tools the
agent used. Infer the actual domain and tools from the transcript itself; do not
assume any particular system.

CRITICAL — this is the OPPOSITE of writing a reusable template:
- KEEP every concrete target from the transcript verbatim: real board names, project
  keys, channel names, email addresses, numeric thresholds. Do NOT replace them with
  placeholders — this is one specific job.
- Distinguish STABLE identifiers (keep verbatim) from TIME-BOUND references. Never
  hard-code an absolute date, month, or a phrase like "since our chat". Rewrite any
  time window as relative to run time (e.g. "in the trailing 24 hours", "the current
  calendar month", "since the previous run").
- The prompt must be fully standalone: assume fresh context on every run. Never refer
  to "the previous chat", "as we discussed", or the user. Never ask a clarifying
  question — decide and act.

Return ONLY a JSON object (no markdown fences) with keys:
- "name": short Title Case name for the recurring job (max 6 words).
- "prompt": the standalone run instruction. It MUST:
  1. Open with the recurring objective in one line ("Every run, ...").
  2. Give the exact ordered steps, naming the REAL tools used in the transcript, with
     the concrete targets retained.
  3. End with the deliverable: what to check and exactly what to include in the run
     summary each time. State the pass/no-op case explicitly (e.g. "Report: no
     changes found this run") so every run produces an unambiguous summary.
  If the conversation is a one-off answer with no genuinely repeatable objective,
  still produce the best-effort recurring framing of the underlying check.
- "suggestedCron": a 5-field cron expression inferred from the chat's intent (e.g. a
  daily report -> "0 9 * * *"). If there is no cadence signal, use "${DEFAULT_CRON}".
- "cadenceLabel": a short human label for that cadence (e.g. "Daily at 9:00 AM").
- "suggestedTools": array of the exact tool names seen in TOOL_CALL blocks that change
  state (send, create, update, delete). Empty array if none.

Transcript:
`;

function isValidCron(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim().split(/\s+/).length !== 5) return false;
  try {
    new Cron(value.trim());
    return true;
  } catch {
    return false;
  }
}

/** Models often wrap JSON in prose or fences despite instructions. */
function extractJsonObject(raw: string): Record<string, unknown> | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 },
      );
    }
    const { transcript } = parsed.data;
    if (transcript.length > MAX_TRANSCRIPT_CHARS) {
      return NextResponse.json({
        success: false,
        error: `This conversation is too long to convert in one pass (~${Math.round(transcript.length / 1000)}k chars, limit ~${Math.round(MAX_TRANSCRIPT_CHARS / 1000)}k). Try a shorter portion of the chat.`,
      }, { status: 413 });
    }

    const { tenantId } = await resolveClawForSession();
    const config = await new LlmProviderService(tenantId).getDefaultConfig();
    if (!config) {
      return NextResponse.json(
        { success: false, error: 'No LLM provider is configured for this tenant.' },
        { status: 400 },
      );
    }

    const model = createClawModel(config);
    const response = await model.invoke(`${DISTILL_PROMPT}\n${transcript}`);
    const raw = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

    const draft = extractJsonObject(raw);
    if (!draft) {
      logger.error({ tenantId, preview: raw.slice(0, 500) }, 'Distill reply was not parseable JSON');
      return NextResponse.json(
        { success: false, error: 'The model did not return a usable task. Try again.' },
        { status: 502 },
      );
    }

    const suggestedCron = isValidCron(draft.suggestedCron)
      ? (draft.suggestedCron as string).trim()
      : DEFAULT_CRON;

    logger.info({ tenantId, suggestedCron }, 'Distilled a scheduled task draft');
    return NextResponse.json({
      success: true,
      data: {
        name: typeof draft.name === 'string' ? draft.name : 'Untitled Scheduled Task',
        prompt: typeof draft.prompt === 'string' ? draft.prompt : '',
        suggestedCron,
        cadenceLabel: typeof draft.cadenceLabel === 'string' ? draft.cadenceLabel : 'Daily at 9:00 AM',
        suggestedTools: Array.isArray(draft.suggestedTools)
          ? draft.suggestedTools.filter((t): t is string => typeof t === 'string')
          : [],
      },
    });
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ error }, 'Failed to distill scheduled task');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
