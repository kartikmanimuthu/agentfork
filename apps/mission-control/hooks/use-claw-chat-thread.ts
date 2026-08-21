'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import type { ChatMessage } from './use-chat-sessions';
import type { RunEvent } from './use-runs';
import { BASE_PATH } from '@/lib/base-path';

export interface PlanStep {
  step: string;
  status: string;
}

export interface PendingApproval {
  kind: 'plan' | 'tool';
  plan?: PlanStep[];
  pendingTools?: string[];
}

const textPayloadSchema = z.string();
const planStepSchema = z.object({ step: z.string(), status: z.string() });
const approvalPayloadSchema = z.object({
  kind: z.enum(['plan', 'tool']),
  plan: z.array(planStepSchema).optional(),
  pendingTools: z.array(z.string()).optional(),
});

/**
 * How often a reloaded page asks a still-running turn for its new events.
 *
 * A second would be too slow to feel live and a tenth of one would hammer the DB;
 * the events being polled are node transitions and tool calls, which arrive on the
 * order of seconds anyway, so anything finer buys nothing.
 */
const RESUME_POLL_MS = 1_000;

/**
 * How old a non-terminal run may be before a reloaded page stops believing it.
 *
 * Comfortably above CLAW_CHAT_DETACHED_MAX_MS (180s), which is the longest a turn
 * may legitimately keep running after its client disappeared. Past that, a run still
 * marked `in_progress` means whatever was driving it is gone — nothing will ever mark
 * it terminal — so following it just pins the composer shut forever.
 */
const STALE_RUN_MS = 5 * 60_000;

/**
 * Shown when the stream dies mid-turn. Named rather than inlined because recovery
 * REPLACES it: the turn usually finishes server-side regardless, so leaving this
 * above the real answer would tell the user their response failed directly above
 * the response.
 */
const INTERRUPTED_NOTE = '_Response interrupted — recovering…_';

/** Shape of /api/chat/active. */
const activeRunSchema = z.object({
  success: z.boolean().optional(),
  data: z.object({
    run: z
      .object({
        runId: z.string(),
        status: z.string(),
        // Optional so a payload without it degrades the staleness check only,
        // rather than failing the whole parse and silently killing resume.
        createdAt: z.string().optional(),
        answer: z.string().nullable().optional(),
        approvalRequest: approvalPayloadSchema.nullable().optional(),
        error: z.string().nullable().optional(),
      })
      .nullable(),
    events: z.array(z.unknown()).default([]),
    live: z.boolean().default(false),
  }),
});

function parseSseFrame(frame: string): { event: string; data: string } | null {
  const eventMatch = frame.match(/^event: (.+)$/m);
  const dataMatch = frame.match(/^data: (.*)$/m);
  if (!eventMatch || !dataMatch) return null;
  return { event: eventMatch[1].trim(), data: dataMatch[1] };
}

interface UseClawChatThreadArgs {
  sessionId: string | null;
  initialMessages: ChatMessage[];
  onMessagesChange: (messages: ChatMessage[]) => void;
  /**
   * Model chosen in the chat header. Read through a ref at send time rather
   * than captured in the `sendMessage` callback's deps, so switching model
   * never re-creates the callback mid-stream.
   *
   * Both halves are needed: the provider supplies credentials and endpoint,
   * `chatModel` picks one of the models it serves.
   */
  providerModelId?: string | null;
  chatModel?: string | null;
}

/**
 * Drives one Chat session's turn-by-turn execution against /api/chat.
 * Adapted from the Playground's useClawPlayground, minus config overrides and
 * the Playground's event stream (since removed) — Chat is the plain, real conversation
 * surface, just with one independent thread per saved session instead of a
 * single thread shared by the whole tenant.
 */
export function useClawChatThread({
  sessionId,
  initialMessages,
  onMessagesChange,
  providerModelId,
  chatModel,
}: UseClawChatThreadArgs) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [isStreaming, setIsStreaming] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  // Keyed by assistant message id, never cleared on a new turn (only on
  // session switch below) — this is what lets a completed turn's "thought
  // process" stay reviewable instead of vanishing the moment the next turn
  // starts. `onMessagesChange` never sees this map, so it is not part of the saved
  // transcript — but it is no longer lost on reload either: chat turns are
  // persisted runs, and `resumeActiveRun` below replays their events back into
  // this map from the server.
  const [eventsByMessageId, setEventsByMessageId] = useState<Record<string, RunEvent[]>>({});

  const nextIdRef = useRef(0);
  const sessionIdRef = useRef(sessionId);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  // Same live-ref treatment as `messagesRef`: read at send time so the model in
  // effect is whatever the dropdown shows right now.
  const modelRef = useRef({ providerModelId, chatModel });
  modelRef.current = { providerModelId, chatModel };

  /** Model fields for a request body, omitted entirely when none is selected. */
  const modelBody = () => {
    const { providerModelId: p, chatModel: m } = modelRef.current;
    if (!p) return {};
    return m ? { providerModelId: p, chatModel: m } : { providerModelId: p };
  };

  /** Set while THIS page owns a live SSE stream; resume must not fight it. */
  const localStreamRef = useRef(false);
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEventIdRef = useRef<string | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  /**
   * Indirection so `consumeStream` can trigger recovery even though
   * `resumeActiveRun` is defined below it. A ref rather than a reordering because
   * the two genuinely reference each other: a lost stream starts the poller, and
   * the poller must stand down when a new stream takes over.
   */
  const resumeRef = useRef<((sessionId: string) => void) | null>(null);

  const stopResumePolling = useCallback(() => {
    if (resumeTimerRef.current) {
      clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    }
  }, []);

  /** A live stream died. The turn itself probably did not — go find out. */
  const recoverAfterStreamLoss = useCallback(() => {
    localStreamRef.current = false;
    const sid = sessionIdRef.current;
    if (sid) resumeRef.current?.(sid);
  }, []);

  useEffect(() => {
    if (sessionIdRef.current === sessionId) return;
    sessionIdRef.current = sessionId;
    setMessages(initialMessages);
    setPendingApproval(null);
    setEventsByMessageId({});
    // Only re-run when the session identity itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const generateId = useCallback((role: ChatMessage['role']) => {
    nextIdRef.current += 1;
    return `${role}-${Date.now()}-${nextIdRef.current}`;
  }, []);

  const updateAssistantMessage = useCallback(
    (assistantId: string, updater: (content: string) => string) => {
      setMessages((prev) => {
        const next = prev.map((m) => (m.id === assistantId ? { ...m, content: updater(m.content) } : m));
        onMessagesChange(next);
        return next;
      });
    },
    [onMessagesChange],
  );

  /**
   * Links an assistant message to the run that produced it, so its process can be
   * fetched back long after the stream is gone. Persisted with the transcript —
   * this is the only durable pointer from a message to its timeline.
   */
  const attachRunId = useCallback(
    (assistantId: string, runId: string) => {
      setMessages((prev) => {
        const next = prev.map((m) => (m.id === assistantId ? { ...m, runId } : m));
        onMessagesChange(next);
        return next;
      });
    },
    [onMessagesChange],
  );

  const consumeStream = useCallback(
    async (res: Response, assistantId: string) => {
      let hadError = false;
      let shouldStop = false;

      try {
        if (!res.ok || !res.body) {
          throw new Error(`Chat request failed with status ${res.status}`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done || shouldStop) break;
          buffer += decoder.decode(value, { stream: true });

          const parts = buffer.split('\n\n');
          buffer = parts.pop() ?? '';

          for (const rawFrame of parts) {
            const parsed = parseSseFrame(rawFrame);
            if (!parsed) continue;

            if (parsed.event === 'run') {
              const { runId } = JSON.parse(parsed.data) as { runId?: string };
              if (runId) {
                activeRunIdRef.current = runId;
                attachRunId(assistantId, runId);
              }
            } else if (parsed.event === 'token') {
              const text = textPayloadSchema.parse(JSON.parse(parsed.data));
              updateAssistantMessage(assistantId, (content) => content + text);
            } else if (parsed.event === 'run_event') {
              const event = JSON.parse(parsed.data) as RunEvent;
              // Advance the resume cursor as events arrive live, so if this socket
              // dies mid-turn the poller picks up from here instead of refetching
              // the whole timeline.
              lastEventIdRef.current = event.id ?? lastEventIdRef.current;
              setEventsByMessageId((prev) => ({
                ...prev,
                [assistantId]: [...(prev[assistantId] ?? []), event],
              }));
            } else if (parsed.event === 'approval') {
              setPendingApproval(approvalPayloadSchema.parse(JSON.parse(parsed.data)));
              shouldStop = true;
              break;
            } else if (parsed.event === 'error') {
              hadError = true;
              const errorText = textPayloadSchema.parse(JSON.parse(parsed.data));
              updateAssistantMessage(assistantId, (content) => `${content}\n\n_${errorText}_`);
              shouldStop = true;
              break;
            } else if (parsed.event === 'done') {
              shouldStop = true;
              break;
            }
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[useClawChatThread] stream failed for message ${assistantId}: ${message}`, error);
        if (!hadError) {
          // Not a dead end any more. The turn is very likely still running (or
          // already finished) on the server, so say so and let the resume poller
          // collect the real outcome — see `resumeActiveRun`.
          updateAssistantMessage(assistantId, (content) => `${content}\n\n${INTERRUPTED_NOTE}`);
          recoverAfterStreamLoss();
        }
      }
    },
    [updateAssistantMessage, recoverAfterStreamLoss, attachRunId],
  );

  const sendMessage = useCallback(
    async (rawContent: string) => {
      const content = rawContent.trim();
      if (!content || isStreaming || !sessionId) return;

      const now = new Date().toISOString();
      const userMessage: ChatMessage = { id: generateId('user'), role: 'user', content, createdAt: now };
      const assistantId = generateId('assistant');
      // The assistant bubble is stamped when the turn STARTS, not when it finishes —
      // it is the timestamp of the exchange, and it has to be written now because
      // this is the save that survives a reload mid-answer.
      const withNewTurn = [
        ...messagesRef.current,
        userMessage,
        { id: assistantId, role: 'assistant' as const, content: '', createdAt: now },
      ];
      setMessages(withNewTurn);
      onMessagesChange(withNewTurn);
      setIsStreaming(true);
      setPendingApproval(null);
      // This page now owns the turn: stop any poller left over from a recovered
      // run so the two cannot both write into the same bubble.
      localStreamRef.current = true;
      stopResumePolling();

      try {
        const res = await fetch(`${BASE_PATH}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, message: content, ...modelBody() }),
        });
        await consumeStream(res, assistantId);
      } finally {
        setIsStreaming(false);
        localStreamRef.current = false;
      }
    },
    [isStreaming, sessionId, generateId, onMessagesChange, consumeStream, stopResumePolling],
  );

  const respondToApproval = useCallback(
    async (decision: 'approve' | 'reject') => {
      if (isStreaming || !sessionId) return;
      setPendingApproval(null);

      // An approval RESUMES the turn that is already in flight — it is not a new
      // turn. Minting a fresh assistant message here appended an empty bubble per
      // approval, and since <ThoughtProcess> renders per assistant message and
      // events are keyed by message id, each approval also froze the open panel
      // and started another one. Reuse the trailing assistant message so resumed
      // tokens and events land where the turn started: updateAssistantMessage
      // appends (content + text) and setEventsByMessageId appends to that id.
      const previous = messagesRef.current;
      const last = previous[previous.length - 1];
      let assistantId: string;
      if (last?.role === 'assistant') {
        assistantId = last.id;
      } else {
        // Defensive: an approval should always follow an assistant message.
        assistantId = generateId('assistant');
        const withNewTurn = [
          ...previous,
          { id: assistantId, role: 'assistant' as const, content: '', createdAt: new Date().toISOString() },
        ];
        setMessages(withNewTurn);
        onMessagesChange(withNewTurn);
      }
      setIsStreaming(true);
      localStreamRef.current = true;
      stopResumePolling();

      try {
        const res = await fetch(`${BASE_PATH}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, decision, ...modelBody() }),
        });
        await consumeStream(res, assistantId);
      } finally {
        setIsStreaming(false);
        localStreamRef.current = false;
      }
    },
    [isStreaming, sessionId, generateId, onMessagesChange, consumeStream, stopResumePolling],
  );

  /**
   * Rewrites an earlier user message and re-runs from that point.
   *
   * Truncating the local transcript is only half of it: the model reads history
   * from the LangGraph checkpoint, so the server is told how many user turns to
   * keep and deletes the rest (see `keepUserTurns` in /api/chat). Without that
   * the edit would look applied while the model still saw the original text.
   */
  const editMessage = useCallback(
    async (messageId: string, nextContent: string) => {
      const content = nextContent.trim();
      if (!content || isStreaming || !sessionId) return;

      const all = messagesRef.current;
      const index = all.findIndex((m) => m.id === messageId);
      if (index === -1 || all[index].role !== 'user') return;

      // How many of the user's turns precede the one being edited — the server
      // keeps exactly that many and drops everything after.
      const keepUserTurns = all.slice(0, index).filter((m) => m.role === 'user').length;

      const assistantId = generateId('assistant');
      const rebuilt: ChatMessage[] = [
        ...all.slice(0, index),
        // The edited prompt keeps its original timestamp — it is the same turn in
        // the conversation, re-worded, not a new one. The answer is new, so it is
        // stamped now and its stale runId dropped.
        { ...all[index], content },
        { id: assistantId, role: 'assistant' as const, content: '', createdAt: new Date().toISOString() },
      ];
      setMessages(rebuilt);
      onMessagesChange(rebuilt);
      // Events belonging to dropped turns would otherwise linger in the map.
      setEventsByMessageId((prev) => {
        const kept: Record<string, RunEvent[]> = {};
        for (const m of rebuilt) if (prev[m.id]) kept[m.id] = prev[m.id];
        return kept;
      });
      setIsStreaming(true);
      setPendingApproval(null);
      // This page now owns the turn: stop any poller left over from a recovered
      // run so the two cannot both write into the same bubble.
      localStreamRef.current = true;
      stopResumePolling();

      try {
        const res = await fetch(`${BASE_PATH}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, message: content, keepUserTurns, ...modelBody() }),
        });
        await consumeStream(res, assistantId);
      } finally {
        setIsStreaming(false);
        localStreamRef.current = false;
      }
    },
    [isStreaming, sessionId, generateId, onMessagesChange, consumeStream, stopResumePolling],
  );

  // -------------------------------------------------------------------------
  // Resuming a turn the page stopped watching
  // -------------------------------------------------------------------------
  //
  // Reloading mid-answer used to lose the response completely: the SSE socket
  // died, the server aborted the run, and nothing had recorded what it produced.
  // Turns are persisted runs now, so a fresh page can find the one it was
  // watching and either follow it live or collect the answer it already finished.
  //
  // `sendMessage` persists `[..., userMessage, { assistant, content: '' }]` BEFORE
  // it starts streaming, so the reloaded transcript always ends with an empty
  // assistant bubble. That bubble is what a recovered turn is attached to — which
  // is why there is no need to invent a message here.

  const resumeActiveRun = useCallback(
    async (targetSessionId: string) => {
      // The page took over with its own stream, or switched session, while this
      // poll was in flight.
      if (localStreamRef.current || sessionIdRef.current !== targetSessionId) return;

      try {
        const after = lastEventIdRef.current;
        const url =
          `${BASE_PATH}/api/chat/active?sessionId=${encodeURIComponent(targetSessionId)}` +
          (after ? `&after=${encodeURIComponent(after)}` : '');
        const res = await fetch(url);
        if (!res.ok) return;
        const parsed = activeRunSchema.safeParse(await res.json());
        if (!parsed.success) return;
        if (localStreamRef.current || sessionIdRef.current !== targetSessionId) return;

        const { run, events, live } = parsed.data.data;
        if (!run) return;

        // Attach to the trailing assistant bubble. If the transcript does not end
        // with one there is nothing this turn belongs to — a session whose runs
        // predate this feature, for instance — so leave it alone rather than
        // grafting an answer onto someone else's message.
        const current = messagesRef.current;
        const target = current[current.length - 1];
        if (!target || target.role !== 'assistant') return;

        // A recovered turn must be linked too, or its process becomes unreachable
        // the moment this page navigates away again.
        if (!target.runId) attachRunId(target.id, run.runId);
        activeRunIdRef.current = run.runId;

        const fresh = events as RunEvent[];
        if (fresh.length > 0) {
          lastEventIdRef.current = fresh[fresh.length - 1]?.id ?? lastEventIdRef.current;
          setEventsByMessageId((prev) => {
            const seen = new Set((prev[target.id] ?? []).map((e) => e.id));
            const added = fresh.filter((e) => !seen.has(e.id));
            if (added.length === 0) return prev;
            return { ...prev, [target.id]: [...(prev[target.id] ?? []), ...added] };
          });
        }

        if (live) {
          if (run.status === 'awaiting_approval' && run.approvalRequest) {
            // The turn is parked on a decision, so polling would spin forever — the
            // user has to answer before anything else happens.
            setPendingApproval(run.approvalRequest);
            setIsStreaming(false);
            stopResumePolling();
            return;
          }
          // A run row says "in_progress" only until something marks it otherwise, and
          // the thing that would mark it is the request that was driving it. If that
          // process is gone — a deploy, a crash, a dev-server restart mid-turn —
          // nothing will ever finish this run, and following it would keep the
          // composer disabled and the spinner turning forever. Treat an old
          // non-terminal run as abandoned rather than live.
          const startedAt = run.createdAt ? new Date(run.createdAt).getTime() : NaN;
          if (Number.isFinite(startedAt) && Date.now() - startedAt > STALE_RUN_MS) {
            console.warn('[useClawChatThread] abandoning a stale in-progress run', run.runId);
            stopResumePolling();
            setIsStreaming(false);
            return;
          }
          // Keeps the composer disabled and the activity panel open, the same as a
          // turn this page started itself.
          setIsStreaming(true);
          resumeTimerRef.current = setTimeout(() => {
            void resumeActiveRun(targetSessionId);
          }, RESUME_POLL_MS);
          return;
        }

        // Terminal. Fold the outcome into the bubble the turn belongs to.
        stopResumePolling();
        setIsStreaming(false);

        const outcome =
          run.status === 'completed'
            ? (run.answer ?? '')
            : run.status === 'cancelled'
              ? '_Generation stopped._'
              : `_${run.error || 'The response could not be completed.'}_`;

        if (outcome) {
          updateAssistantMessage(target.id, (content) => {
            // Guarded because a page that saw part of the answer before losing the
            // socket would otherwise show it twice.
            if (!content.trim()) return outcome;
            return content.includes(outcome) ? content : `${content}\n\n${outcome}`;
          });
        }
      } catch (error) {
        // A failed poll is not worth surfacing — the next tick retries, and a hard
        // failure just leaves the transcript as it was.
        //
        // `warn`, not `error`. The overwhelmingly common cause is a fetch that never
        // reached the server at all: the dev server restarting under an open tab, a
        // dropped connection, a page navigating away mid-request. All of those throw
        // a bare "Failed to fetch", and logging them at error level put a red entry
        // in the console for something entirely expected and already handled.
        const transient = error instanceof TypeError;
        const log = transient ? console.warn : console.error;
        log('[useClawChatThread] could not reach the active-run endpoint; will retry', error);
      }
    },
    [stopResumePolling, updateAssistantMessage, attachRunId],
  );

  resumeRef.current = (targetSessionId: string) => {
    void resumeActiveRun(targetSessionId);
  };

  // Runs on mount and on every session switch, which is exactly when this page
  // might be looking at a turn it never saw finish.
  //
  // `sessionId` is the ONLY dependency, deliberately, and the resume function is
  // reached through a ref rather than named here.
  //
  // Listing `resumeActiveRun` was a tight loop. It is a useCallback over
  // `attachRunId`/`updateAssistantMessage`, both of which close over the
  // `onMessagesChange` prop — and a caller passing an unmemoized function made all
  // three a new reference on every render. This effect then re-ran every render,
  // fetched, wrote messages, and caused the next render. It hammered
  // /api/chat/active and PUT /api/chat-sessions, saturated the browser, and made
  // unrelated requests fail with "Failed to fetch".
  //
  // The caller is memoized now too, but this must not depend on that: a hook cannot
  // assume its consumers memoize their props, and the failure mode is far too quiet
  // — no error, just a browser that gradually stops working.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!sessionId) return;
    lastEventIdRef.current = null;
    resumeRef.current?.(sessionId);
    return () => stopResumePolling();
  }, [sessionId]);

  const stopGenerating = useCallback(() => {
    if (!sessionId) return;
    void fetch(`${BASE_PATH}/api/chat?sessionId=${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
  }, [sessionId]);

  return {
    messages,
    isStreaming,
    pendingApproval,
    eventsByMessageId,
    sendMessage,
    editMessage,
    respondToApproval,
    stopGenerating,
  };
}
