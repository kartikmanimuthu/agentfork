'use client';

import type { UIMessage } from '@ai-sdk/react';
import { ChatBubble } from './chat-bubble';
import { useChatScroll } from '@/lib/hooks/use-chat-scroll';
import { Spinner } from '@/components/ui/spinner';
import { MessageSquare, Sparkles, Globe, Search } from 'lucide-react';
import { MessageMetadataBar } from '@/components/agents/playground/message-metadata-bar';
import { ThinkingBlock } from '@/components/agents/playground/thinking-block';
import { cn } from '@/lib/utils';
import type { MessageMetrics, ThinkingContent } from '@/lib/playground/types';

function getMessageText(message: UIMessage): string {
  return message.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

type ToolInvocationPart = {
  type: 'tool-invocation';
  toolInvocation: { toolCallId: string; toolName: string; state: string; args?: unknown; result?: unknown };
};

function getToolInvocations(message: UIMessage): ToolInvocationPart['toolInvocation'][] {
  return (message.parts as Array<{ type: string }>)
    .filter((p): p is ToolInvocationPart => p.type === 'tool-invocation')
    .map((p) => p.toolInvocation);
}

const TOOL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  web_search: Search,
  web_fetch: Globe,
};

function ToolCallIndicator({ invocations }: { invocations: ToolInvocationPart['toolInvocation'][] }) {
  if (invocations.length === 0) return null;
  return (
    <div className="px-4 pt-3 space-y-1.5">
      {invocations.map((inv) => {
        const isDone = inv.state === 'result';
        const Icon = TOOL_ICONS[inv.toolName] ?? Globe;
        const label = inv.toolName.replace(/_/g, ' ');
        return (
          <div key={inv.toolCallId} className="flex items-center gap-2 text-xs text-muted-foreground">
            {isDone ? (
              <Icon className="h-3.5 w-3.5 text-green-500 shrink-0" />
            ) : (
              <Spinner className="h-3.5 w-3.5 shrink-0" />
            )}
            <span className={isDone ? 'text-muted-foreground/70' : ''}>
              {isDone ? `Used ${label}` : `Using ${label}…`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

interface ChatMessagesProps {
  messages: UIMessage[];
  isLoading?: boolean;
  onRegenerate?: () => void;
  selectedMessageId?: string | null;
  onSelectMessage?: (messageId: string | null) => void;
  messageMetrics?: Map<string, MessageMetrics>;
  thinkingMap?: Map<string, ThinkingContent>;
  showMetadata?: boolean;
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-4">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
          <Sparkles className="h-6 w-6 text-primary" />
        </div>
        <div className="space-y-1">
          <h3 className="text-lg font-semibold tracking-tight">How can I help you today?</h3>
          <p className="max-w-sm text-sm text-muted-foreground">
            Ask me anything — I can help with coding, writing, analysis, brainstorming, and more.
          </p>
        </div>
        <div className="grid gap-2 pt-2">
          {[
            'Explain a complex topic simply',
            'Help me debug this code',
            'Write a professional email',
            'Brainstorm creative ideas',
          ].map((suggestion) => (
            <div
              key={suggestion}
              className="cursor-pointer rounded-lg border bg-card/50 px-4 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {suggestion}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-3 px-4 py-5 md:px-6">
      <div className="flex shrink-0 flex-col items-center pt-0.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
          <MessageSquare className="h-4 w-4 text-primary" />
        </div>
      </div>
      <div className="flex items-center">
        <div className="flex items-center gap-2 rounded-2xl border bg-card/60 px-4 py-3">
          <Spinner />
        </div>
      </div>
    </div>
  );
}

export function ChatMessages({
  messages,
  isLoading,
  onRegenerate,
  selectedMessageId,
  onSelectMessage,
  messageMetrics,
  thinkingMap,
  showMetadata = false,
}: ChatMessagesProps) {
  const scrollRef = useChatScroll(messages);

  if (messages.length === 0) {
    return (
      <div className="flex-1 overflow-hidden">
        <EmptyState />
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto" ref={scrollRef}>
      <div className="flex flex-col pb-2">
        {messages.map((message) => {
          const isAssistant = message.role === 'assistant';
          const isSelected = selectedMessageId === message.id;
          const metrics = messageMetrics?.get(message.id);
          const thinking = thinkingMap?.get(message.id);

          const toolInvocations = isAssistant ? getToolInvocations(message) : [];
          const messageText = getMessageText(message);

          return (
            <div
              key={message.id}
              className={cn(
                'transition-colors',
                isAssistant && onSelectMessage && 'cursor-pointer',
                isSelected && 'border-l-2 border-l-primary bg-primary/5'
              )}
              onClick={() => {
                if (isAssistant && onSelectMessage) {
                  onSelectMessage(isSelected ? null : message.id);
                }
              }}
            >
              {isAssistant && thinking && (
                <div className="px-4 md:px-6 pt-3">
                  <ThinkingBlock thinking={thinking} />
                </div>
              )}
              {isAssistant && toolInvocations.length > 0 && (
                <ToolCallIndicator invocations={toolInvocations} />
              )}
              {(messageText || !isAssistant) && (
                <ChatBubble
                  role={message.role as 'user' | 'assistant'}
                  content={messageText}
                  onRegenerate={isAssistant ? onRegenerate : undefined}
                />
              )}
              {showMetadata && isAssistant && (
                <div className="px-4 md:px-6 -mt-3 ml-11">
                  <MessageMetadataBar
                    metrics={metrics}
                    isStreaming={
                      isLoading && message.id === messages[messages.length - 1]?.id
                    }
                  />
                </div>
              )}
            </div>
          );
        })}
        {isLoading && (() => {
          const last = messages[messages.length - 1];
          const showSpinner =
            !last ||
            last.role === 'user' ||
            (last.role === 'assistant' && !getMessageText(last) && getToolInvocations(last).length === 0);
          return showSpinner ? <TypingIndicator /> : null;
        })()}
      </div>
    </div>
  );
}
