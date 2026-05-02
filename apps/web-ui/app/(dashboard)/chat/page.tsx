'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useSearchParams } from 'next/navigation';
import { ChatMessages } from '@/components/chat/chat-messages';
import { ChatInput } from '@/components/chat/chat-input';
import { useEffect, useMemo, useState } from 'react';

export default function ChatPage() {
  const searchParams = useSearchParams();
  const conversationId = searchParams.get('id');
  const [currentConversationId, setCurrentConversationId] = useState(conversationId);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/chat',
        body: { conversationId: currentConversationId },
      }),
    [currentConversationId],
  );

  const { messages, status, sendMessage, setMessages } = useChat({
    transport,
    onFinish: ({ messages }) => {
      const lastAssistant = messages.filter((m) => m.role === 'assistant').pop();
      if (lastAssistant) {
        const headerConvId = currentConversationId;
        if (!headerConvId) {
          fetch('/api/conversations?limit=1')
            .then((res) => res.json())
            .then((data) => {
              if (data.items?.[0]) {
                setCurrentConversationId(data.items[0].id);
              }
            });
        }
      }
    },
  });

  const isLoading = status === 'streaming' || status === 'submitted';

  useEffect(() => {
    if (conversationId) {
      setCurrentConversationId(conversationId);
      fetch(`/api/messages?conversationId=${conversationId}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.messages) {
            setMessages(
              data.messages.map((m: any) => ({
                id: m.id,
                role: m.role,
                content: m.content,
                parts: [{ type: 'text' as const, text: m.content }],
              })),
            );
          }
        });
    }
  }, [conversationId, setMessages]);

  const handleSend = (content: string) => {
    sendMessage({ text: content });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center border-b px-4 py-3">
        <h2 className="text-lg font-semibold">Chat</h2>
      </div>
      <ChatMessages messages={messages} isLoading={isLoading} />
      <ChatInput onSend={handleSend} isLoading={isLoading} />
    </div>
  );
}
