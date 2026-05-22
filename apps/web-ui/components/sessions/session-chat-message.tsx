'use client';

import { useTheme } from 'next-themes';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { Bot, User } from 'lucide-react';
import { sanitizeMarkdown } from '@/lib/playground/sanitize';
import { createMarkdownComponents } from '@/lib/markdown-components';

interface SessionChatMessageProps {
  role: string;
  content: string;
  timestamp: string;
  tokenCount?: number | null;
}

export function SessionChatMessage({ role, content, timestamp, tokenCount }: SessionChatMessageProps) {
  const isUser = role === 'user';
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });

  return (
    <div className={cn('flex gap-3', isUser ? 'flex-row-reverse' : 'flex-row')}>
      <div className="flex shrink-0 flex-col items-center pt-1">
        <Avatar className="h-8 w-8">
          <AvatarFallback
            className={cn(
              'text-xs',
              isUser
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground'
            )}
          >
            {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
          </AvatarFallback>
        </Avatar>
      </div>

      <div className={cn('flex min-w-0 flex-col', isUser ? 'items-end' : 'items-start', 'max-w-[85%] md:max-w-[75%]')}>
        {isUser ? (
          <div className="rounded-2xl bg-primary px-4 py-3 text-sm text-primary-foreground shadow-sm">
            <p className="whitespace-pre-wrap leading-relaxed">{content}</p>
          </div>
        ) : (
          <div className="w-full rounded-2xl border bg-card/60 px-4 py-3 shadow-sm">
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkBreaks]}
                components={createMarkdownComponents(isDark)}
              >
                {sanitizeMarkdown(content)}
              </ReactMarkdown>
            </div>
          </div>
        )}
        <div className={cn('mt-1 flex items-center gap-2 text-[11px] text-muted-foreground', isUser ? 'flex-row-reverse' : 'flex-row')}>
          <span>{formatTime(timestamp)}</span>
          {!isUser && tokenCount != null && (
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{tokenCount} tok</span>
          )}
        </div>
      </div>
    </div>
  );
}
