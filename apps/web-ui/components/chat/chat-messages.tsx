'use client';

import type { Message } from 'ai';
import { ChatBubble } from './chat-bubble';
import { useChatScroll } from '@/lib/hooks/use-chat-scroll';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ChatMessagesProps {
  messages: Message[];
  isLoading?: boolean;
}

export function ChatMessages({ messages, isLoading }: ChatMessagesProps) {
  const scrollRef = useChatScroll(messages);

  return (
    <ScrollArea className="flex-1" ref={scrollRef}>
      <div className="flex flex-col">
        {messages.map((message) => (
          <ChatBubble key={message.id} role={message.role as 'user' | 'assistant'} content={message.content} />
        ))}
        {isLoading && messages[messages.length - 1]?.role === 'user' && (
          <div className="flex gap-3 p-4">
            <div className="h-8 w-8 rounded-full bg-secondary animate-pulse" />
            <div className="max-w-[80%] rounded-lg bg-muted px-4 py-2">
              <div className="flex gap-1">
                <span className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce" />
                <span className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:0.2s]" />
                <span className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:0.4s]" />
              </div>
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
