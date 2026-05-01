'use client';

import { useRef, type FormEvent, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { SendHorizontal } from 'lucide-react';

interface ChatInputProps {
  input: string;
  handleInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  handleSubmit: (e: FormEvent<HTMLFormElement>) => void;
  isLoading: boolean;
}

export function ChatInput({ input, handleInputChange, handleSubmit, isLoading }: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const form = e.currentTarget.closest('form');
      if (form && input.trim()) form.requestSubmit();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2 border-t p-4">
      <textarea
        ref={textareaRef}
        value={input}
        onChange={handleInputChange}
        onKeyDown={onKeyDown}
        placeholder="Type a message..."
        disabled={isLoading}
        rows={1}
        className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      />
      <Button type="submit" size="icon" disabled={isLoading || !input.trim()}>
        <SendHorizontal className="h-4 w-4" />
      </Button>
    </form>
  );
}
