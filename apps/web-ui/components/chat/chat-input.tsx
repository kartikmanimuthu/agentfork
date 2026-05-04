'use client';

import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SendHorizontal } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';

interface ChatInputProps {
  onSend: (content: string) => void;
  isLoading: boolean;
}

export function ChatInput({ onSend, isLoading }: ChatInputProps) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isLoading) {
      onSend(input.trim());
      setInput('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (input.trim() && !isLoading) {
        onSend(input.trim());
        setInput('');
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto';
        }
      }
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  return (
    <form onSubmit={handleSubmit} className="border-t bg-background/80 px-4 py-3 backdrop-blur-sm">
      <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border bg-muted/40 p-2 shadow-sm transition-all focus-within:border-primary/30 focus-within:bg-background focus-within:shadow-md focus-within:ring-1 focus-within:ring-ring/40">
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={handleChange}
          onKeyDown={onKeyDown}
          placeholder={isLoading ? 'Assistant is typing...' : 'Type a message...'}
          disabled={isLoading}
          rows={1}
          className="min-h-0 flex-1 resize-none border-0 bg-transparent px-3 py-2 text-sm shadow-none outline-none focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed placeholder:text-muted-foreground/60"
        />

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="submit"
                size="icon"
                disabled={isLoading || !input.trim()}
                className="h-9 w-9 shrink-0 rounded-xl transition-all disabled:opacity-40"
              >
                {isLoading ? (
                  <Spinner />
                ) : (
                  <SendHorizontal className="h-4 w-4" />
                )}
              </Button>
            }
          />
          <TooltipContent side="top">
            <p>{isLoading ? 'Sending...' : 'Send message'}</p>
            <p className="text-[10px] text-muted-foreground">Shift + Enter for new line</p>
          </TooltipContent>
        </Tooltip>
      </div>
      <p className="mt-1.5 text-center text-[10px] text-muted-foreground/60">
        Press Enter to send, Shift + Enter for a new line
      </p>
    </form>
  );
}
