'use client';

import { useChat } from 'ai/react';
import { useSearchParams } from 'next/navigation';
import { ChatMessages } from '@/components/chat/chat-messages';
import { ChatInput } from '@/components/chat/chat-input';
import { useEffect, useState } from 'react';

export default function ChatPage() {
  const searchParams = useSearchParams();
  const conversationId = searchParams.get('id');
  const [currentConversationId, setCurrentConversationId] = useState(conversationId);

  const { messages, input, handleInputChange, handleSubmit, isLoading, setMessages } = useChat({
    api: '/api/chat',
    body: { conversationId: currentConversationId },
    onResponse: (response) => {
      const newId = response.headers.get('x-conversation-id');
      if (newId && !currentConversationId) {
        setCurrentConversationId(newId);
      }
    },
  });

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
              })),
            );
          }
        });
    }
  }, [conversationId, setMessages]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center border-b px-4 py-3">
        <h2 className="text-lg font-semibold">Chat</h2>
      </div>
      <ChatMessages messages={messages} isLoading={isLoading} />
      <ChatInput
        input={input}
        handleInputChange={handleInputChange}
        handleSubmit={handleSubmit}
        isLoading={isLoading}
      />
    </div>
  );
}
