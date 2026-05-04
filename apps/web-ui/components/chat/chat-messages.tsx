'use client';

import type { UIMessage } from '@ai-sdk/react';
import { ChatBubble } from './chat-bubble';
import { useChatScroll } from '@/lib/hooks/use-chat-scroll';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Spinner } from '@/components/ui/spinner';
import { MessageSquare, Sparkles } from 'lucide-react';

function getMessageText(message: UIMessage): string {
  return message.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

interface ChatMessagesProps {
  messages: UIMessage[];
  isLoading?: boolean;
  onRegenerate?: () => void;
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

export function ChatMessages({ messages, isLoading, onRegenerate }: ChatMessagesProps) {
  const scrollRef = useChatScroll(messages);

  if (messages.length === 0) {
    return (
      <div className="flex-1 overflow-hidden">
        <EmptyState />
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1" ref={scrollRef}>
      <div className="flex flex-col pb-2">
        {messages.map((message) => (
          <ChatBubble
            key={message.id}
            role={message.role as 'user' | 'assistant'}
            content={getMessageText(message)}
            onRegenerate={message.role === 'assistant' ? onRegenerate : undefined}
          />
        ))}
        {isLoading && messages[messages.length - 1]?.role === 'user' && <TypingIndicator />}
      </div>
    </ScrollArea>
  );
}
