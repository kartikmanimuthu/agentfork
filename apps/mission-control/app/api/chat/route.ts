import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { createLogger, getPrismaClient } from '@chatbot/shared';
import {
  resolveClawRuntime, registerRun, cancelRun, cleanupRun, extractTextContent,
  recordRunEvents, approvalRequestFrom, describeRunFailure, getRunService,
  CHAT_SOURCE, CHAT_DETACHED_MAX_MS, isTerminalStatus,
  type NodeUpdate, type ClawRunRecord,
} from '@chatbot/claw-studio';
import { HumanMessage, RemoveMessage } from '@langchain/core/messages';
import { Command } from '@langchain/langgraph';
import { authOptions } from '@/lib/auth';

const logger = createLogger('mission-control:api:chat');

/**
 * SSE keepalive cadence. CloudFront's originReadTimeout is 60s
 * (infra/compute/index.ts:1218) and measures the gap BETWEEN bytes rather than
 * the length of the request, so a quarter of that budget leaves room for a
 * missed tick without tripping it.
 */
const HEARTBEAT_MS = 15_000;

const bodySchema = z.union([
  z.object({
    sessionId: z.string(),
    message: z.string().min(1),
    /**
     * Set when the user EDITED an earlier message: how many of their turns to
     * keep before the edit. Everything after that point is deleted from the
     * checkpoint before the new message is sent.
     *
     * Load-bearing. The model reads history from the LangGraph checkpoint, not
     * from the client's transcript, so rewriting the UI alone would leave the
     * original wording in context and the "edit" would silently do nothing.
     */
    keepUserTurns: z.number().int().nonnegative().optional(),
    /**
     * Model to answer this turn with, chosen from the chat header's dropdown.
     * `resolveClawRuntime` already prefers `overrides.providerModelId` over the
     * Claw's saved `providerModelId` (claw-runtime.ts:252), so this only has to
     * be forwarded — no model-resolution logic belongs here.
     *
     * Also PERSISTED to the Claw when it differs, so the choice sticks across
     * threads and reloads instead of being re-picked every conversation.
     */
    providerModelId: z.string().min(1).optional(),
    /** One model from within that provider (LlmProvider.models), e.g. llm-powerhouse-nemotron-lightning. */
    chatModel: z.string().min(1).optional(),
  }),
  z.object({
    sessionId: z.string(),
    decision: z.enum(['approve', 'reject']),
    // Carried on the resume leg too: an approved tool call finishes the SAME
    // turn in a LATER request, and that request rebuilds the runtime from
    // scratch. Without it the turn would silently finish on a different model
    // than it started on.
    providerModelId: z.string().min(1).optional(),
    chatModel: z.string().min(1).optional(),
  }),
]);

interface CheckpointMessage {
  id?: string;
  _getType?: () => string;
}

/**
 * Drops every checkpoint message after the user's `keepUserTurns`-th turn.
 * Returns how many were removed, for logging.
 */
async function trimThread(
  graph: { getState: (c: unknown) => Promise<{ values?: { messages?: CheckpointMessage[] } }>; updateState: (c: unknown, v: unknown) => Promise<unknown> },
  config: unknown,
  keepUserTurns: number,
): Promise<number> {
  const state = await graph.getState(config);
  const messages = state?.values?.messages ?? [];

  let humanSeen = 0;
  let cutFrom = messages.length;
  for (let i = 0; i < messages.length; i += 1) {
    if (messages[i]?._getType?.() === 'human') {
      if (humanSeen === keepUserTurns) {
        cutFrom = i;
        break;
      }
      humanSeen += 1;
    }
  }

  // Only messages carrying an id can be addressed by RemoveMessage.
  const removals = messages
    .slice(cutFrom)
    .filter((m): m is CheckpointMessage & { id: string } => typeof m.id === 'string')
    .map((m) => new RemoveMessage({ id: m.id }));

  if (removals.length > 0) await graph.updateState(config, { messages: removals });
  return removals.length;
}

interface StateValues {
  messages?: Array<{ _getType?: () => string; content?: unknown }>;
  pendingToolApprovals?: string[];
  plan?: unknown;
  [key: string]: unknown;
}

export async function POST(req: NextRequest) {
  let threadId: string | undefined;
  let tenantId: string | undefined;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.studio?.tenantId) {
      return new Response(JSON.stringify({ error: 'Unauthenticated' }), { status: 401 });
    }
    tenantId = session.studio.tenantId;

    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: 'Invalid input' }), { status: 400 });
    }

    const db = getPrismaClient();
    const chatSession = await db.clawChatSession.findFirst({ where: { id: parsed.data.sessionId, tenantId } });
    if (!chatSession) {
      return new Response(JSON.stringify({ error: 'Session not found' }), { status: 404 });
    }
    threadId = chatSession.threadId;

    // The ONLY override Chat accepts is the model, picked from the header
    // dropdown. Everything else (temperature, system prompt, autoApprove) stays
    // the Claw's real saved config — those are Playground's business.
    //
    // The id arrives from the browser, so it is verified to belong to THIS
    // tenant before it is either used or stored — `LlmProvider.id` is a plain
    // cuid with no tenant component, and `resolveClawRuntime` looks it up by id
    // alone, so an unchecked value would let one tenant run on (and repoint
    // their Claw at) another tenant's provider row. An unknown id is ignored
    // rather than rejected: falling back to the Claw's saved model answers the
    // user's message, where a 400 would drop it.
    let providerModelId: string | undefined;
    let chatModel: string | undefined;
    if (parsed.data.providerModelId) {
      const provider = await db.llmProvider.findFirst({
        where: { id: parsed.data.providerModelId, tenantId },
        select: { id: true, models: true, chatModel: true },
      });
      if (provider) {
        providerModelId = provider.id;
        // A provider is credentials + an endpoint, not one model: the
        // self-hosted gateway serves the whole llm-powerhouse fleet behind a
        // single row. The requested model is checked against that provider's
        // own discovered list so the browser cannot make us call an arbitrary
        // model id — an unknown one silently falls back to the provider's saved
        // chatModel rather than failing the turn.
        const requested = parsed.data.chatModel;
        if (requested) {
          const known =
            (provider.models as { models?: Array<{ id?: string; capabilities?: string[] }> } | null)
              ?.models ?? [];
          // Must also be CHAT-capable. Discovery records embedding models in the
          // same list (18 of them across the Bedrock providers), and pinning the
          // Claw to `amazon.titan-embed-text-v2:0` would break every turn with a
          // model that cannot converse. The UI filters these out, but the check
          // belongs here too — this value arrives from the browser.
          const match = known.find((m) => m?.id === requested);
          const chatCapable = match && (!Array.isArray(match.capabilities) || match.capabilities.includes('chat'));
          // The provider's own saved chatModel counts as known even when discovery
          // never listed it — it is the model buildConfig already sends
          // (llm-provider-service.ts:289), and it is server-side data, so accepting
          // it adds no trust in the browser. Without this the discovered list and
          // the configured model can disagree (the self-hosted gateway lists eight
          // models, none of them its own llm-powerhouse-qwen-3-8) and every attempt
          // to select the configured model was discarded here as unknown.
          if (chatCapable || requested === provider.chatModel) {
            chatModel = requested;
          } else {
            logger.warn(
              { tenantId, providerModelId, requested },
              'Chat requested a model this provider does not list — using its saved chatModel',
            );
          }
        }
      } else {
        logger.warn(
          { tenantId, requested: parsed.data.providerModelId },
          'Chat requested a provider that does not belong to this tenant — using the saved model',
        );
      }
    }

    // Persisted BEFORE the runtime resolves, and awaited, so it cannot lose a
    // race with the next turn reading it back. Claw carries no tenantId of its
    // own (it hangs off ClawStudio), so the studio is resolved first.
    //
    // The provider goes in its own column; the chosen model rides in the
    // existing `settings` JSON, read-modify-written so a future key added there
    // is not clobbered. That avoids a migration on a schema whose pgvector
    // indexes make `prisma migrate dev` unusable (see libs/claw-studio/CLAUDE.md).
    if (providerModelId) {
      const studio = await db.clawStudio.findFirst({ where: { tenantId }, select: { id: true } });
      const target = studio
        ? await db.claw.findFirst({
            where: { clawStudioId: studio.id },
            select: { id: true, settings: true, providerModelId: true },
            orderBy: { createdAt: 'asc' },
          })
        : null;
      if (target) {
        const settings = (target.settings as Record<string, unknown> | null) ?? {};
        const changed = target.providerModelId !== providerModelId || settings.chatModel !== chatModel;
        if (changed) {
          await db.claw.update({
            where: { id: target.id },
            data: {
              providerModelId,
              // Explicit null clears a stale pin when the user picks the
              // provider's default entry, rather than leaving the old model set.
              settings: { ...settings, chatModel: chatModel ?? null },
            },
          });
          logger.info({ tenantId, providerModelId, chatModel }, 'Chat switched the Claw default model');
        }
      }
    }

    const runtime = await resolveClawRuntime({
      tenantId,
      threadId,
      ...(providerModelId ? { overrides: { providerModelId, ...(chatModel ? { chatModel } : {}) } } : {}),
    });
    const abortController = registerRun(threadId);

    // Chat turns are persisted runs now. Without a run row the answer lived only
    // in the SSE frames, so a reload lost it outright — nothing had ever recorded
    // what the turn produced. See CHAT_SOURCE in gateway/types.ts.
    //
    // An approval decision RESUMES the turn that paused, in a second request, so
    // it must attach to that turn's existing run instead of opening a new one —
    // otherwise the timeline splits in two and the reloaded page shows only half.
    const turnStartedAt = Date.now();
    const runs = getRunService();
    let run: ClawRunRecord;
    const resuming = 'decision' in parsed.data;
    const existing = resuming ? await runs.findLatestByThread(threadId, tenantId) : null;
    if (existing && !isTerminalStatus(existing.status)) {
      run = await runs.markInProgress(existing.runId);
    } else {
      run = await runs.create({
        tenantId,
        source: CHAT_SOURCE,
        // The turn's own prompt. On a resume leg there is no new message, so the
        // decision is recorded instead of an empty string.
        taskDescription: 'decision' in parsed.data ? `Approval: ${parsed.data.decision}` : parsed.data.message,
        // The CHAT thread, deliberately, not a per-run one: this is the id a
        // reloaded page can resolve from its session, and it is what
        // `findLatestByThread` looks up. Chat is sequential on a thread, so there
        // is no concurrent-run checkpoint clash to avoid here.
        threadId,
        trigger: { sessionId: chatSession.id },
      });
      run = await runs.markInProgress(run.runId);
    }
    const runId = run.runId;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        // Set once the user's answer is delivered and the rest of the run
        // (memory_save, etc.) has been handed to a detached background task.
        // Both the try block and the catch block check it before touching
        // `controller` or the run registry, since ownership of both has
        // transferred by that point — see the `terminalAnswerNode` branch.
        let handedOff = false;

        // Streaming real content protects only the stretch of a turn that is
        // already producing it. The gap it cannot cover is the silence BEFORE
        // the first token of the final answer: prompt caching is disabled on
        // the self-hosted fleet, so that answer re-prefills the whole
        // tool-laden conversation from scratch, and a perfectly healthy run
        // goes quiet for longer than CloudFront's 60s read timeout. CloudFront
        // then drops the connection and the client renders "Response
        // interrupted. Please try again." (use-claw-chat-thread.ts:171) over a
        // run the server went on to finish — the answer is lost to the user
        // even though it was produced.
        //
        // A comment frame is SSE's own keepalive: parseSseFrame ignores every
        // frame that lacks both an `event:` and a `data:` line, so this costs
        // the client nothing while resetting the read timer of each proxy in
        // the path.
        // The client's presence is now tracked rather than relied upon.
        //
        // Every enqueue used to be deliberately unguarded, because a throw was
        // how a vanished client got noticed — and the catch then ABORTED the run.
        // That is precisely what made a page reload lose the answer: the turn was
        // killed a moment after the socket closed, so the reply was never
        // produced, let alone recorded. Now a failed write only marks the client
        // gone; the turn keeps running and keeps persisting its events, and a
        // reloaded page reads them back from the run.
        //
        // Driving the graph to completion "writing into a void" is therefore the
        // intended behaviour now — the void is a database table — but it is
        // bounded: see `detachedExpired` below.
        let clientAlive = true;
        let clientGoneAt = 0;
        const markClientGone = (reason: string) => {
          if (!clientAlive) return;
          clientAlive = false;
          clientGoneAt = Date.now();
          logger.info(
            { tenantId, threadId, runId, reason },
            'Chat client disconnected — finishing the turn detached so a reload can pick it up',
          );
        };
        const emit = (frame: string) => {
          if (!clientAlive) return;
          try {
            controller.enqueue(encoder.encode(frame));
          } catch {
            markClientGone('enqueue failed');
          }
        };
        /** True once an abandoned turn has outstayed its welcome. */
        const detachedExpired = () => !clientAlive && Date.now() - clientGoneAt > CHAT_DETACHED_MAX_MS;

        const safeEnqueue = emit;
        const safeClose = () => {
          try {
            controller.close();
          } catch {
            // Already closed by the disconnect itself.
          }
        };

        let heartbeat: ReturnType<typeof setInterval> | null = null;
        const stopHeartbeat = () => {
          if (heartbeat) {
            clearInterval(heartbeat);
            heartbeat = null;
          }
        };
        heartbeat = setInterval(() => {
          if (!clientAlive) {
            stopHeartbeat();
            return;
          }
          try {
            controller.enqueue(encoder.encode(': ping\n\n'));
          } catch {
            // The client hung up. enqueue() on a closed stream throws, and an
            // interval that throws every tick would outlive the request. The turn
            // itself continues — only the keepalive stops.
            markClientGone('heartbeat failed');
            stopHeartbeat();
          }
        }, HEARTBEAT_MS);

        try {
          // Sent first: the client stores this so a reload knows which run it was
          // watching without having to look one up by thread.
          emit(`event: run\ndata: ${JSON.stringify({ runId })}\n\n`);

          let graphInput: { messages: HumanMessage[] } | Command;
          if ('decision' in parsed.data) {
            // Chat writes no ClawRun row (per design), so there is no
            // persisted ApprovalRequest to read a pending-tool count off, the
            // way execute-run.ts does via `run.approvalRequest.pendingTools`.
            // Read the live interrupt payload straight off the checkpoint
            // instead — same derivation (approvalRequestFrom), just sourced
            // fresh from state rather than a stored field. The count matters:
            // humanInTheLoopMiddleware requires exactly one decision per
            // pending action request and throws on a mismatch (hitl.js:480).
            const pauseState = (await runtime.graph.getState(runtime.config)) as {
              values?: StateValues;
              tasks?: Array<{ interrupts?: unknown[] }>;
            };
            const pendingInterrupts = (pauseState.tasks ?? []).flatMap((t) => t.interrupts ?? []);
            const pendingRequest = approvalRequestFrom(pendingInterrupts, (pauseState.values ?? {}) as never);
            const decisionCount = pendingRequest.kind === 'tool' ? pendingRequest.pendingTools?.length || 1 : 1;
            const decisionType = parsed.data.decision === 'approve' ? ('approve' as const) : ('reject' as const);
            graphInput = new Command({
              resume: { decisions: Array.from({ length: decisionCount }, () => ({ type: decisionType })) },
            });
          } else {
            if (typeof parsed.data.keepUserTurns === 'number') {
              const removed = await trimThread(
                runtime.graph as never,
                runtime.config,
                parsed.data.keepUserTurns,
              );
              logger.info(
                { tenantId, threadId, keepUserTurns: parsed.data.keepUserTurns, removed },
                'Trimmed thread for an edited message',
              );
            }
            graphInput = { messages: [new HumanMessage(parsed.data.message)] };
          }
          // Two stream modes at once:
          //   'updates' → node transitions, rendered as the inline "Activity"
          //               timeline via deriveNodeEvents (live-only; Chat writes
          //               no ClawRun/ClawRunEvent rows, per design).
          //   'custom'  → the token deltas `respondNode`/`finalNode` push via
          //               `getWriter()` — see claw-graph.ts for why this is
          //               'custom', not LangGraph's 'messages' mode: 'messages'
          //               taps every node's model call indiscriminately (the
          //               evaluator's raw JSON included) and, against this
          //               codebase's real provider, reproduced the full reply
          //               TWICE in the persisted graph state. 'custom' only
          //               ever carries what those two nodes explicitly emit,
          //               so no node-name filter is needed here.
          // Both also mean real content flows continuously rather than in one
          // lump at the end — but that alone does NOT survive CloudFront's 60s
          // originReadTimeout (infra/compute/index.ts:1218), because a turn is
          // still silent while the final answer prefills. The heartbeat above
          // is what covers that gap.
          const events = await runtime.graph.stream(graphInput, {
            ...runtime.config,
            streamMode: ['updates', 'custom'],
            signal: abortController.signal,
          });
          let eventSeq = 0;
          // Unique per REQUEST, not just per event. A single turn spans several
          // requests — it pauses at an approval gate and resumes in a new one —
          // and resumed events append to the SAME assistant message, so a
          // counter that restarts at 0 each request produced duplicate React
          // keys (`live-1` twice in one list).
          const eventRun = crypto.randomUUID().slice(0, 8);
          // Sending the answer twice would be visible (the client appends
          // token events), so the aggregated fallback below only fires when
          // NOTHING was streamed — covers clarify and any other path that ends
          // a turn without going through respond/final.
          // Both completion paths (answer-ready mid-stream, and the clarify/plain-end
          // path below) must record the same metrics, so the shape lives in one place.
          const completeRun = async (answer: string) =>
            runs.markCompleted(runId, {
              answer,
              usage: runtime.usage.totals(),
              // Wall-clock as the user experienced it — includes tool execution and
              // any approval wait, which summed model time does not.
              durationMs: Date.now() - turnStartedAt,
            });

          let streamedAnswer = false;
          // Accumulated so the run record can carry the answer for a reloaded page
          // to read. The client transcript is still written by the client itself —
          // two writers on ClawChatSession.messages would race.
          let answerText = '';

          // Manual iterator, NOT `for await...of`: the whole point of this
          // loop is to stop pulling partway through and resume from a
          // detached background task once the user's answer is ready.
          // `for...of`'s `break` triggers IteratorClose (calls the iterator's
          // `.return()` per spec) and would abort the graph's remaining
          // execution — memory_save would simply never run. Plain `.next()`
          // calls never do that; verified against a real graph before relying
          // on it here.
          // One Set for the whole stream — deepagents reports several nodes per
          // chunk, each echoing the same trailing message, which rendered one
          // answer two to four times in the timeline.
          const seenMessageIds = new Set<string>();
          const iterator = events[Symbol.asyncIterator]();
          while (true) {
            const { value: chunk, done } = await iterator.next();
            if (done) break;
            const [mode, payload] = chunk as unknown as [string, unknown];

            // An abandoned turn is not an immortal one. The old abort-on-disconnect
            // existed because an orphaned run was seen still calling the model two
            // minutes after its client left, holding a browser session the whole
            // time; this keeps that ceiling while letting an ordinary reload finish.
            if (detachedExpired()) {
              logger.warn(
                { tenantId, threadId, runId, detachedMs: Date.now() - clientGoneAt },
                'Detached chat turn exceeded CLAW_CHAT_DETACHED_MAX_MS — aborting',
              );
              abortController.abort();
              break;
            }

            if (mode === 'custom') {
              const { delta } = (payload ?? {}) as { node?: string; delta?: string };
              if (delta) {
                streamedAnswer = true;
                answerText += delta;
                emit(`event: token\ndata: ${JSON.stringify(delta)}\n\n`);
              }
              continue;
            }

            const updates = (payload ?? {}) as Record<string, NodeUpdate>;
            // `final` always ends the task path. `respond` ends the
            // conversational path UNLESS it escalated to the planner (needed
            // a tool after all) — that case must keep streaming normally, not
            // be treated as the answer.
            const answerIsReady = Object.entries(updates).some(
              ([node, update]) => node === 'final' || (node === 'respond' && update?.nextAction !== 'escalate'),
            );

            if (answerIsReady) {
              // Every token for this answer already streamed via 'custom'
              // above (writer() calls happen inside the node before it
              // returns this update) — EXCEPT when a provider/model produced
              // no usable deltas at all, which is exactly what streamedAnswer
              // guards against.
              if (!streamedAnswer) {
                for (const update of Object.values(updates)) {
                  const msgs = update.messages ?? [];
                  const lastAi = [...msgs].reverse().find((m) => m._getType?.() === 'ai');
                  const text = lastAi ? extractTextContent(lastAi.content) : '';
                  if (text) {
                    answerText = text;
                    emit(`event: token\ndata: ${JSON.stringify(text)}\n\n`);
                    break;
                  }
                }
              }
              // Recorded BEFORE the controller closes and before the background
              // tail is detached. This is the write a reloaded page depends on: if
              // it landed after the handoff it would race the reload, and the very
              // scenario being fixed — refresh, then look for the answer — is the
              // one most likely to lose that race.
              await completeRun(answerText);
              emit(`event: done\ndata: {}\n\n`);
              safeClose();
              handedOff = true;

              // What's left (memory_save, and anything else on the way to
              // END) is bookkeeping the user never sees and can legitimately
              // take several seconds (an extraction LLM call, sometimes a
              // JSON-repair retry, an optional multi-call reconcile pass).
              // Run it to completion on the SAME iterator, but detached from
              // this request — the user gets their answer and can send the
              // next message immediately instead of the input staying
              // disabled until this finishes.
              void (async () => {
                try {
                  while (true) {
                    const { done: drained } = await iterator.next();
                    if (drained) break;
                  }
                } catch (bgErr) {
                  logger.warn({ err: bgErr, tenantId, threadId }, '[chat] background graph tail failed (e.g. memory_save)');
                } finally {
                  if (threadId) cleanupRun(threadId, abortController);
                  await runtime.cleanup?.().catch(() => {});
                }
              })();

              break;
            }

            for (const [node, update] of Object.entries(updates)) {
              // recordRunEvents derives the SAME drafts `deriveNodeEvents` used to
              // produce here, then persists each one and hands back the stored row.
              // Streaming those rows rather than locally-minted `live-*` objects is
              // what makes a replayed timeline identical to the live one — same
              // ids, same ordering, so a reload cannot duplicate or reorder steps.
              for (const event of await recordRunEvents(run, node, update ?? {}, seenMessageIds)) {
                eventSeq += 1;
                emit(`event: run_event\ndata: ${JSON.stringify(event)}\n\n`);
              }
            }
          }

          if (!handedOff) {
            // Reached only for clarify and approval-interrupt paths — neither
            // final nor respond ran, so there's nothing slow left to defer.
            const state = (await runtime.graph.getState(runtime.config)) as {
              values?: StateValues;
              tasks?: Array<{ interrupts?: unknown[] }>;
            };
            const values = (state.values ?? {}) as StateValues;
            const interrupts = (state.tasks ?? []).flatMap((t: { interrupts?: unknown[] }) => t.interrupts ?? []);

            // Load-bearing for browsing: the turn is PAUSED, not finished, and
            // the tool it is paused on (browser_click / browser_type — every
            // page interaction classifies as mutative) is going to run against
            // the page currently loaded. Tearing the browser down here is what
            // made the approved click land on a fresh about:blank and look like
            // an unstable browser session. `keepBrowser` parks it instead,
            // bounded by CLAW_BROWSER_HOLD_MS.
            const pausedForApproval = interrupts.length > 0;

            if (pausedForApproval) {
              const request = approvalRequestFrom(interrupts, values as never);
              // Persisted as the run's status, so a reload lands back on the
              // approval prompt instead of an apparently-idle conversation. The
              // turn is genuinely unfinished here — the run stays non-terminal.
              await runs.markAwaitingApproval(runId, request);
              emit(`event: approval\ndata: ${JSON.stringify(request)}\n\n`);
            } else {
              if (!streamedAnswer) {
                const messages = values.messages ?? [];
                const lastAi = [...messages].reverse().find((m) => m._getType?.() === 'ai');
                const text = lastAi ? extractTextContent(lastAi.content) : '';
                if (text) {
                  answerText = text;
                  emit(`event: token\ndata: ${JSON.stringify(text)}\n\n`);
                }
              }
              await completeRun(answerText);
              emit(`event: done\ndata: {}\n\n`);
            }

            if (threadId) cleanupRun(threadId, abortController);
            await runtime.cleanup?.({ keepBrowser: pausedForApproval }).catch(() => {});
            safeClose();
          }
        } catch (err) {
          if (handedOff) {
            // The answer was already delivered and cleanup already handed to
            // the background task before this threw — nothing left to do.
            return;
          }
          const isAbort = abortController.signal.aborted || (err instanceof Error && err.name === 'AbortError');
          // The client's connection was severed while the server was mid-write:
          // a proxy read timeout, a closed tab, a dropped network. Every write
          // below would throw the same way, and there is no longer anyone to
          // send an error event to.
          const clientGone = err instanceof Error && /controller is already closed/i.test(err.message);

          if (clientGone) {
            // Reached only for a throw `emit` did not already absorb. It no longer
            // aborts: the turn is allowed to finish without a listener precisely so
            // a reload can collect the answer, bounded by `detachedExpired()` in the
            // loop above rather than by killing it here. The old abort is what made
            // a reload lose the response, and the orphan-run risk it was guarding
            // against (a run seen still calling the model two minutes after its
            // client left) is now covered by that deadline instead.
            markClientGone('stream threw after disconnect');
            await runs.markFailed(runId, 'Client disconnected before the turn completed').catch(() => {});
          } else if (isAbort) {
            logger.info({ tenantId, threadId, runId }, 'Chat stream cancelled by user');
            await runs.markCancelled(runId, 'Cancelled from chat').catch(() => {});
            safeEnqueue('event: done\ndata: {}\n\n');
          } else {
            logger.error({ err, tenantId, threadId, runId }, 'Chat stream failed');
            const failure = describeRunFailure(err);
            await runs.markFailed(runId, typeof failure === 'string' ? failure : JSON.stringify(failure)).catch(() => {});
            // A timeout, a dead OAuth refresh token, and a half-configured
            // provider each need a different action from the user, and all three
            // used to arrive as the same "please try again" — which is only sound
            // advice for the transient case.
            safeEnqueue(`event: error\ndata: ${JSON.stringify(failure)}\n\n`);
          }
          // Reached unconditionally now. These two lines are what releases the
          // run registration and the browser session, so no write above them may
          // be able to throw.
          if (threadId) cleanupRun(threadId, abortController);
          await runtime.cleanup?.().catch(() => {});
          safeClose();
        } finally {
          // Runs on every exit, including the `return` the handed-off branch
          // takes from the catch above. The background tail never enqueues —
          // the controller is already closed by then — so there is nothing left
          // for the heartbeat to keep alive.
          stopHeartbeat();
        }
      },
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        // A buffering reverse proxy would hold the heartbeat back along with
        // every token, which defeats both. Ignored by proxies that don't buffer.
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    logger.error({ error, tenantId, threadId }, 'Chat route failed');
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.studio?.tenantId) {
      return new Response(JSON.stringify({ error: 'Unauthenticated' }), { status: 401 });
    }
    const sessionId = new URL(req.url).searchParams.get('sessionId');
    if (!sessionId) {
      return new Response(JSON.stringify({ error: 'sessionId is required' }), { status: 400 });
    }
    const db = getPrismaClient();
    const chatSession = await db.clawChatSession.findFirst({ where: { id: sessionId, tenantId: session.studio.tenantId } });
    if (!chatSession) {
      return new Response(JSON.stringify({ error: 'Session not found' }), { status: 404 });
    }
    const cancelled = cancelRun(chatSession.threadId);
    // The in-process abort only reaches a turn running in THIS container. Marking
    // the run terminal is what stops a reloaded page from polling a turn that is
    // never coming back — and covers the case where the turn is detached in
    // another replica.
    const runs = getRunService();
    const active = await runs.findLatestByThread(chatSession.threadId, session.studio.tenantId);
    if (active && !isTerminalStatus(active.status)) {
      await runs.markCancelled(active.runId, 'Cancelled from chat');
    }
    return new Response(JSON.stringify({ cancelled }), { status: 200 });
  } catch (error) {
    logger.error({ error }, 'Chat cancel failed');
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
  }
}
