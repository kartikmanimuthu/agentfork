'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  Check,
  Copy,
  FileText,
  Loader2,
  MessageSquarePlus,
  PanelLeft,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { MarkdownContent } from '@/components/ui/markdown-content';
import { cn } from '@/lib/utils';
import { PlanningSection } from '@/components/chat/planning-section';
import { TurnDetails } from './turn-details';
import { useTurnMetrics } from '@/hooks/use-chat-turns';
import { useQueryClient } from '@tanstack/react-query';
import { ResizeHandle } from '@/components/ui/resize-handle';
import { useResizableWidth } from '@/hooks/use-resizable-width';
import {
  useChatSessions,
  useCreateChatSession,
  useUpdateChatSession,
  useDeleteChatSession,
  type ChatSession,
} from '@/hooks/use-chat-sessions';
import { useClawChatThread } from '@/hooks/use-claw-chat-thread';
import { ModelPicker } from '@/components/chat/model-picker';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useAgentSummary } from '@/hooks/use-agent-summary';
import { toast } from 'sonner';

/** Content sits in a fixed reading column rather than stretching to the viewport. */
const COLUMN = 'mx-auto w-full max-w-4xl';

const SUGGESTIONS = [
  'What can you help me with?',
  'What do you remember about me?',
  'Summarise my scheduled tasks',
];

/**
 * Threads are created as "Thread 7" by chat-sessions/route.ts:66. That is what
 * fills the sidebar, and it tells you nothing about what a thread was for. Once
 * the first message is sent we retitle from it — but only while the name is
 * still the generated one, so a name the user chose is never overwritten.
 */
const GENERATED_NAME = /^Thread \d+$/;

function titleFrom(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > 42 ? `${t.slice(0, 41).trimEnd()}…` : t;
}

function ago(iso: string): string {
  const secs = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (secs < 60) return 'now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  return `${Math.floor(secs / 86400)}d`;
}

/**
 * Files are inlined into the message text rather than uploaded.
 *
 * /api/chat accepts `{ sessionId, message: string }` and the graph is driven
 * with a plain HumanMessage, so there is nowhere for a binary to go and no
 * multimodal path to carry one. Inlining text keeps the feature honest: what
 * the model receives is exactly what the user sees attached. Binary formats are
 * refused with a reason rather than silently dropped.
 */
const MAX_ATTACHMENT_BYTES = 256 * 1024;
const TEXTUAL = /\.(txt|md|markdown|csv|tsv|json|ya?ml|xml|html?|css|jsx?|tsx?|py|rb|go|rs|java|kt|sh|sql|log|ini|toml|env)$/i;

interface Attachment {
  name: string;
  content: string;
}

/**
 * Threads carry their full message history in the list payload, so search runs
 * client-side over names AND message bodies — instant, and no endpoint needed.
 */
interface ThreadMatch {
  snippet: string;
  role: 'user' | 'assistant';
}

function findMatch(session: ChatSession, needle: string): ThreadMatch | null {
  for (const message of session.messages ?? []) {
    const at = message.content.toLowerCase().indexOf(needle);
    if (at === -1) continue;
    // A window around the hit, so the match is visible rather than the opening
    // words of a long message.
    const from = Math.max(0, at - 24);
    const raw = message.content.slice(from, from + 96).replace(/\s+/g, ' ').trim();
    return {
      snippet: `${from > 0 ? '…' : ''}${raw}${from + 96 < message.content.length ? '…' : ''}`,
      role: message.role,
    };
  }
  return null;
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-1" aria-label="Claw is typing">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60"
          style={{ animationDelay: `${i * 150}ms`, animationDuration: '1s' }}
        />
      ))}
    </span>
  );
}

/** Hover toolbar under an assistant reply. Reserves its own height so the
 *  transcript does not reflow when it appears. */
function MessageActions({ text, onRegenerate }: { text: string; onRegenerate?: () => void }) {
  const [copied, setCopied] = useState(false);
  const base =
    'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground';
  return (
    <div className="-ml-1.5 mt-1 flex h-7 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
      <button
        type="button"
        className={base}
        onClick={() => {
          void navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        aria-label="Copy message"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
      {onRegenerate && (
        <button type="button" className={base} onClick={onRegenerate} aria-label="Regenerate reply">
          <RefreshCw className="h-3.5 w-3.5" />
          Retry
        </button>
      )}
    </div>
  );
}

/**
 * The time a message was sent or answered.
 *
 * Absent on anything saved before timestamps existed, and nothing is rendered in
 * that case — a fabricated time on an old message is worse than no time at all.
 * Shown as a time of day, with the full date on hover, because a chat is read
 * relative to "now" far more often than by absolute date.
 */
function MessageTime({ iso, className = '' }: { iso?: string; className?: string }) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return (
    <time
      dateTime={iso}
      title={date.toLocaleString()}
      className={`text-[11px] text-muted-foreground ${className}`}
    >
      {date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
    </time>
  );
}

function UserMessage({
  content,
  onEdit,
  disabled,
}: {
  content: string;
  onEdit: (next: string) => void;
  disabled: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(content);
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    if (!editing) return;
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [editing, value]);

  const commit = () => {
    const next = value.trim();
    setEditing(false);
    if (next && next !== content) onEdit(next);
  };

  if (editing) {
    return (
      <div className="w-full max-w-[85%] rounded-2xl border bg-background p-2 shadow-sm">
        <Textarea
          ref={ref}
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setValue(content);
              setEditing(false);
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              commit();
            }
          }}
          className="max-h-60 resize-none border-0 bg-transparent p-1.5 text-sm shadow-none focus-visible:ring-0"
        />
        <div className="flex items-center justify-end gap-1.5 pt-1">
          <span className="mr-auto pl-1.5 text-[11px] text-muted-foreground">
            Re-runs the conversation from here
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-7"
            onClick={() => {
              setValue(content);
              setEditing(false);
            }}
          >
            Cancel
          </Button>
          <Button size="sm" className="h-7" disabled={!value.trim() || value.trim() === content} onClick={commit}>
            Send
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex max-w-[85%] items-start gap-1.5">
      <button
        type="button"
        onClick={() => {
          setValue(content);
          setEditing(true);
        }}
        disabled={disabled}
        className="mt-1 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus:opacity-100 disabled:pointer-events-none group-hover:opacity-100"
        aria-label="Edit message"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <div className="whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary/10 px-3.5 py-2.5 text-sm ring-1 ring-primary/15">
        {content}
      </div>
    </div>
  );
}

function ClawAvatar() {
  return (
    <div className="flex h-7 w-7 shrink-0 select-none items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary ring-1 ring-primary/20">
      C
    </div>
  );
}

export function ChatClient() {
  const { data: sessions, isLoading } = useChatSessions();
  const createSession = useCreateChatSession();
  const updateSession = useUpdateChatSession();
  const deleteSession = useDeleteChatSession();

  const queryClient = useQueryClient();
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  // One request per conversation for every turn's response time and token counts;
  // the per-turn timelines are fetched only on expand. See use-chat-turns.ts.
  const { data: turnMetrics } = useTurnMetrics(activeSessionId);
  const [draft, setDraft] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const threadPane = useResizableWidth({
    storageKey: 'mc:chat-threads-width',
    defaultWidth: 256,
    min: 180,
    max: 420,
  });

  // Default to the most recently used thread once the list loads, but
  // never fight a selection the user already made.
  useEffect(() => {
    if (!sessions) return;
    if (activeSessionId && sessions.some((s) => s.id === activeSessionId)) return;
    setActiveSessionId(sessions[0]?.id ?? null);
  }, [sessions, activeSessionId]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const all = sessions ?? [];
    if (!needle) return all.map((session) => ({ session, match: null as ThreadMatch | null }));
    return all
      .map((session) => ({
        session,
        nameHit: session.name.toLowerCase().includes(needle),
        match: findMatch(session, needle),
      }))
      .filter((r) => r.nameHit || r.match)
      .map(({ session, match }) => ({ session, match }));
  }, [sessions, query]);

  const activeSession = useMemo(
    () => sessions?.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );

  // MEMOIZED, and it matters. This is passed to useClawChatThread as
  // `onMessagesChange`, which several of that hook's useCallbacks depend on. As a
  // plain function it was a new reference every render, so those callbacks were too
  // — and the resume effect that depends on them re-ran on every render, fetched,
  // wrote messages, and triggered the next render. A tight loop that hammered
  // /api/chat/active and PUT /api/chat-sessions, saturated the browser, and made
  // unrelated requests (including the approval POST) fail with "Failed to fetch".
  const handleMessagesChange = useCallback(
    (messages: ChatSession['messages']) => {
      if (!activeSessionId) return;
      updateSession.mutate({ sessionId: activeSessionId, patch: { messages } });
    },
    [activeSessionId, updateSession],
  );

  // Seeded ONCE from the Claw's saved model, so the header opens showing what
  // is actually in use rather than a generic "Default". Guarded by a ref rather
  // than by `model === null`, because null is itself a valid choice (follow the
  // tenant default) and would otherwise be overwritten by the next summary
  // refetch the moment the user selected it.
  const agentSummary = useAgentSummary();
  const [model, setModel] = useState<{ providerModelId: string; chatModel: string | null } | null>(null);
  const modelSeeded = useRef(false);
  useEffect(() => {
    if (modelSeeded.current || !agentSummary.data) return;
    modelSeeded.current = true;
    const { providerModelId, chatModel } = agentSummary.data;
    setModel(providerModelId ? { providerModelId, chatModel } : null);
  }, [agentSummary.data]);

  const {
    messages,
    isStreaming,
    pendingApproval,
    eventsByMessageId,
    sendMessage,
    editMessage,
    respondToApproval,
    stopGenerating,
  } = useClawChatThread({
      sessionId: activeSessionId,
      initialMessages: activeSession?.messages ?? [],
      onMessagesChange: handleMessagesChange,
      providerModelId: model?.providerModelId ?? null,
      chatModel: model?.chatModel ?? null,
    });

  // Autoscroll, but never fight a user who has scrolled up to read something —
  // the steps panel grows continuously while streaming, so an unconditional
  // scroll makes the transcript impossible to read mid-turn.
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const eventCount = Object.values(eventsByMessageId).reduce((sum, e) => sum + e.length, 0);

  // A turn's metrics only exist once it completes, and `useTurnMetrics` does not
  // poll — so refetch on the streaming→idle edge, or the answer that just landed
  // shows no response time until the cache goes stale on its own.
  const wasStreamingRef = useRef(isStreaming);
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming && activeSessionId) {
      void queryClient.invalidateQueries({ queryKey: ['chat', 'turns', activeSessionId] });
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming, activeSessionId, queryClient]);

  const viewport = useCallback(
    () => scrollRef.current?.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]') ?? null,
    [],
  );

  useEffect(() => {
    const el = viewport();
    if (!el) return;
    const onScroll = () => {
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
      setPinned(gap < 80);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [viewport, activeSessionId]);

  useLayoutEffect(() => {
    if (pinned) bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [activeSessionId, messages, eventCount, pinned]);

  const handleNewSession = async () => {
    const created = await createSession.mutateAsync(undefined);
    setActiveSessionId(created.id);
  };

  // Deleting a thread destroys its whole transcript, so it gets a real dialog
  // rather than window.confirm — whose default button is the one that deletes.
  const [pendingDelete, setPendingDelete] = useState<ChatSession | null>(null);

  const handleDeleteSession = async () => {
    const session = pendingDelete;
    if (!session) return;
    await deleteSession.mutateAsync(session.id);
    if (activeSessionId === session.id) setActiveSessionId(null);
  };

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const accepted: Attachment[] = [];
    for (const file of Array.from(files)) {
      if (!TEXTUAL.test(file.name)) {
        toast.error(`${file.name} can't be attached`, {
          description: 'Only text-based files are supported — Claw reads their contents inline.',
        });
        continue;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        toast.error(`${file.name} is too large`, {
          description: `Attachments are capped at ${MAX_ATTACHMENT_BYTES / 1024}KB so they don't crowd out the conversation.`,
        });
        continue;
      }
      accepted.push({ name: file.name, content: await file.text() });
    }
    if (accepted.length) setAttachments((prev) => [...prev, ...accepted]);
    if (fileRef.current) fileRef.current.value = '';
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSidebarOpen(true);
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Grow with the content instead of staying a one-line box. rows={1} alone
  // does not do this — the element keeps its initial height and overflows.
  const composerRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  const handleSend = (text?: string) => {
    const typed = (text ?? draft).trim();
    // An attachment alone is a valid message — "here, look at this".
    if ((!typed && attachments.length === 0) || isStreaming || !activeSessionId || pendingApproval) return;
    const content = [
      typed,
      ...attachments.map((a) => `\n\nAttached file \`${a.name}\`:\n\n\`\`\`\n${a.content}\n\`\`\``),
    ]
      .join('')
      .trim();

    // Retitle from the opening message so the sidebar reads as a list of topics
    // rather than "Thread 5, Thread 6, Thread 7".
    if (messages.length === 0 && activeSession && GENERATED_NAME.test(activeSession.name)) {
      updateSession.mutate({
        sessionId: activeSessionId,
        patch: { name: titleFrom(typed || attachments[0]?.name || content) },
      });
    }

    setDraft('');
    setAttachments([]);
    setPinned(true);
    void sendMessage(content);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)]">
        <div className="w-64 shrink-0 space-y-2 border-r p-3">
          <Skeleton className="h-7 w-full" />
          <Skeleton className="h-7 w-full" />
          <Skeleton className="h-7 w-2/3" />
        </div>
        <div className="flex-1 space-y-4 p-8">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-24 w-full max-w-3xl rounded-xl" />
          <Skeleton className="h-40 w-full max-w-3xl rounded-xl" />
        </div>
      </div>
    );
  }


  return (
    <div className="flex h-[calc(100vh-3.5rem)] bg-background">
      {/* ── threads ─────────────────────────────────────────────────────── */}
      <aside
        style={{ width: sidebarOpen ? threadPane.width : 0 }}
        className={cn(
          'relative flex shrink-0 flex-col overflow-hidden border-r bg-muted/20',
          // Animate the collapse, but NOT the drag — a transition during a drag
          // makes the panel lag behind the cursor.
          threadPane.isResizing ? '' : 'transition-[width] duration-200',
          !sidebarOpen && 'border-r-0',
        )}
      >
        <div className="flex items-center justify-between px-3 py-2.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Threads</span>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={handleNewSession}
            disabled={createSession.isPending}
            aria-label="New thread"
          >
            {createSession.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          </Button>
        </div>
        <div className="relative px-2 pb-2">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
            placeholder="Search conversations"
            className="h-8 bg-background pl-8 pr-7 text-xs"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-4 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <ScrollArea className="flex-1">
          <div className="space-y-0.5 px-2 pb-2">
            {results.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                {query ? `No conversations matching “${query}”` : 'No threads yet.'}
              </p>
            ) : (
              results.map(({ session: s, match }) => (
                <div
                  key={s.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setActiveSessionId(s.id)}
                  onKeyDown={(e) => e.key === 'Enter' && setActiveSessionId(s.id)}
                  className={cn(
                    'group flex cursor-pointer flex-wrap items-center gap-x-2 rounded-lg px-2.5 py-2 text-sm transition-colors',
                    s.id === activeSessionId
                      ? 'bg-background font-medium shadow-sm ring-1 ring-border'
                      : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{s.name}</span>
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70 group-hover:hidden">
                    {ago(s.updatedAt)}
                  </span>
                  <button
                    type="button"
                    className="hidden shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive group-hover:block"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPendingDelete(s);
                    }}
                    aria-label={`Delete ${s.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                  {match && (
                    <p className="w-full truncate text-[11px] text-muted-foreground">
                      <span className="text-muted-foreground/60">
                        {match.role === 'user' ? 'You: ' : 'Claw: '}
                      </span>
                      {match.snippet}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        </ScrollArea>
        {sidebarOpen && (
          <ResizeHandle
            label="Resize threads"
            isResizing={threadPane.isResizing}
            onPointerDown={threadPane.startResize}
            onDoubleClick={threadPane.resetWidth}
          />
        )}
      </aside>

      {/* ── conversation ────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0 text-muted-foreground"
            onClick={() => setSidebarOpen((o) => !o)}
            aria-label={sidebarOpen ? 'Hide threads' : 'Show threads'}
            title={sidebarOpen ? 'Hide threads' : 'Show threads'}
          >
            <PanelLeft className="h-4 w-4" />
          </Button>
          <h1 className="truncate text-sm font-semibold">{activeSession?.name ?? 'Talk with Claw'}</h1>
          {isStreaming && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              working
            </span>
          )}
          {/* Disabled mid-turn: the model is bound when the runtime resolves, so
              switching during a stream would not affect the answer in flight and
              would misreport what produced it. */}
          <div className="ml-auto shrink-0">
            <ModelPicker
              providerModelId={model?.providerModelId ?? null}
              chatModel={model?.chatModel ?? null}
              // Display-only fallback for an unpinned Claw. `model` stays null so
              // the request carries no override and /api/chat writes no pin, which
              // is what keeps this Claw tracking the tenant default as it changes.
              fallbackProviderModelId={agentSummary.data?.defaultProviderModelId ?? null}
              fallbackChatModel={agentSummary.data?.defaultChatModel ?? null}
              onChange={setModel}
              disabled={isStreaming}
            />
          </div>
        </header>

        {!activeSessionId ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <MessageSquarePlus className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">Start a new thread to talk to Claw.</p>
            <Button size="sm" onClick={handleNewSession} disabled={createSession.isPending}>
              <Plus className="mr-1.5 h-4 w-4" />
              New thread
            </Button>
          </div>
        ) : (
          <>
            <div className="relative min-h-0 flex-1">
              <ScrollArea ref={scrollRef} className="h-full">
                <div
                  className={cn(COLUMN, 'flex flex-col gap-5 px-4 py-4')}
                  role="log"
                  aria-live="polite"
                  aria-relevant="additions text"
                >
                  {messages.length === 0 && (
                    <div className="flex flex-col items-center gap-4 py-16 text-center">
                      <ClawAvatar />
                      <div>
                        <p className="text-sm font-medium">How can I help?</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Claw remembers this thread and can use your connected tools.
                        </p>
                      </div>
                      <div className="flex flex-wrap justify-center gap-2">
                        {SUGGESTIONS.map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => handleSend(s)}
                            className="rounded-full border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {messages.map((message, index) => {
                    const isLast = index === messages.length - 1;
                    if (message.role === 'user') {
                      return (
                        <div key={message.id} className="group flex flex-col items-end gap-0.5">
                          <UserMessage
                            content={message.content}
                            disabled={isStreaming || !!pendingApproval}
                            onEdit={(next) => {
                              setPinned(true);
                              void editMessage(message.id, next);
                            }}
                          />
                          <MessageTime iso={message.createdAt} className="pr-1" />
                        </div>
                      );
                    }
                    const live = isStreaming && isLast;
                    const steps = eventsByMessageId[message.id] ?? [];
                    const metrics = message.runId ? turnMetrics?.[message.runId] : undefined;
                    // An assistant turn that produced no text, no steps and is
                    // not streaming would otherwise render a bare avatar on an
                    // empty row — which is what a rejected approval leaves behind.
                    // A recoverable turn (one with a runId) is exempt: its process
                    // is fetchable even when nothing is in memory, so hiding it
                    // would make reloaded history disappear.
                    if (!message.content && !live && steps.length === 0 && !message.runId) return null;

                    return (
                      <div key={message.id} className="group flex gap-3">
                        <ClawAvatar />
                        <div className="min-w-0 flex-1">
                          <TurnDetails
                            liveEvents={steps}
                            isLive={live}
                            runId={message.runId}
                            metrics={metrics}
                          />
                          {message.content ? (
                            <div className="text-sm leading-relaxed">
                              <MarkdownContent content={message.content} />
                              {live && (
                                <span
                                  className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-foreground/70 align-text-bottom"
                                  aria-hidden
                                />
                              )}
                            </div>
                          ) : live ? (
                            <TypingDots />
                          ) : null}
                          {message.content && !live && <MessageTime iso={message.createdAt} />}
                          {message.content && !live && (
                            <MessageActions
                              text={message.content}
                              onRegenerate={
                                // Retry re-runs the turn from the user's last
                                // message: editMessage trims the checkpoint back
                                // to that point, so the model re-answers rather
                                // than answering a duplicated question.
                                isLast && !isStreaming && !pendingApproval
                                  ? () => {
                                      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
                                      if (!lastUser) return;
                                      setPinned(true);
                                      void editMessage(lastUser.id, lastUser.content);
                                    }
                                  : undefined
                              }
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <div ref={bottomRef} />
                </div>
              </ScrollArea>

              {!pinned && (
                <Button
                  size="sm"
                  variant="outline"
                  className="absolute bottom-3 right-4 h-8 gap-1.5 rounded-full bg-background/95 pl-2.5 pr-3 text-xs shadow-md backdrop-blur"
                  onClick={() => {
                    setPinned(true);
                    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
                  }}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                  Latest
                </Button>
              )}
            </div>

            {pendingApproval && (
              <div className={cn(COLUMN, 'px-4')}>
                <div
                  data-testid="chat-approval-banner"
                  className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3"
                >
                  <p className="mb-2 text-sm font-medium">
                    {pendingApproval.kind === 'plan'
                      ? 'Claw wants to proceed with this plan'
                      : 'Claw wants to run a tool'}
                  </p>
                  {pendingApproval.kind !== 'plan' && pendingApproval.pendingTools?.length ? (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {pendingApproval.pendingTools.map((t) => (
                        <code key={t} className="rounded bg-background px-1.5 py-0.5 font-mono text-[11px] ring-1 ring-border">
                          {t}
                        </code>
                      ))}
                    </div>
                  ) : null}
                  {pendingApproval.plan && pendingApproval.plan.length > 0 && (
                    <div className="mb-3">
                      <PlanningSection plan={pendingApproval.plan} />
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button size="sm" className="h-8" disabled={isStreaming} onClick={() => respondToApproval('approve')}>
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      disabled={isStreaming}
                      onClick={() => respondToApproval('reject')}
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <div className="shrink-0 border-t bg-background/80 backdrop-blur">
              <div className={cn(COLUMN, 'px-4 py-3')}>
                {attachments.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {attachments.map((a, i) => (
                      <span
                        key={`${a.name}-${i}`}
                        className="inline-flex items-center gap-1.5 rounded-lg border bg-muted/50 py-1 pl-2 pr-1 text-xs"
                      >
                        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="max-w-40 truncate">{a.name}</span>
                        <span className="tabular-nums text-[10px] text-muted-foreground">
                          {(a.content.length / 1024).toFixed(1)}KB
                        </span>
                        <button
                          type="button"
                          onClick={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                          className="rounded p-0.5 text-muted-foreground hover:text-destructive"
                          aria-label={`Remove ${a.name}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex items-end gap-1 rounded-2xl border bg-background p-2 shadow-sm transition-colors focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10">
                  <input
                    ref={fileRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => void handleFiles(e.target.files)}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 shrink-0 text-muted-foreground"
                    disabled={isStreaming || !!pendingApproval}
                    onClick={() => fileRef.current?.click()}
                    aria-label="Attach a file"
                    title="Attach a text file — its contents are sent with your message"
                  >
                    <Paperclip className="h-4 w-4" />
                  </Button>
                  <Textarea
                    ref={composerRef}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={pendingApproval ? 'Respond to the approval above to continue…' : 'Message Claw…'}
                    disabled={isStreaming || !!pendingApproval}
                    rows={1}
                    className="max-h-40 min-h-9 resize-none border-0 bg-transparent px-2 py-1.5 text-sm shadow-none focus-visible:ring-0"
                  />
                  {isStreaming ? (
                    <Button
                      onClick={stopGenerating}
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 shrink-0"
                      aria-label="Stop generating"
                    >
                      <Square className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Button
                      onClick={() => handleSend()}
                      disabled={(!draft.trim() && attachments.length === 0) || !!pendingApproval}
                      size="icon"
                      className="h-8 w-8 shrink-0 rounded-lg"
                      aria-label="Send message"
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <p
                  className={cn(
                    'mt-1.5 px-1 text-[11px] text-muted-foreground transition-opacity',
                    draft.trim() ? 'opacity-100' : 'opacity-0',
                  )}
                  aria-hidden={!draft.trim()}
                >
                  <kbd className="rounded border px-1 font-sans">Enter</kbd> to send ·{' '}
                  <kbd className="rounded border px-1 font-sans">Shift</kbd>+
                  <kbd className="rounded border px-1 font-sans">Enter</kbd> for a new line
                </p>
              </div>
            </div>
          </>
        )}
      </div>

    <ConfirmDialog

      open={pendingDelete !== null}

      onOpenChange={(open) => !open && setPendingDelete(null)}

      title={`Delete thread "${pendingDelete?.name ?? ''}"?`}

      description="The entire transcript is removed. This cannot be undone."

      confirmLabel="Delete thread"

      onConfirm={handleDeleteSession}

    />

    </div>
  );
}
