'use client';

import { useState } from 'react';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { Copy, Check, RotateCcw, Bot, User } from 'lucide-react';
import { sanitizeMarkdown } from '@/lib/playground/sanitize';
import { createMarkdownComponents } from '@/lib/markdown-components';

interface ChatBubbleProps {
  role: 'user' | 'assistant';
  content: string;
  onRegenerate?: () => void;
}

export function ChatBubble({ role, content, onRegenerate }: ChatBubbleProps) {
  const isUser = role === 'user';
  const [copied, setCopied] = useState(false);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className={cn(
        'group flex gap-3 px-4 py-5 md:px-6',
        isUser ? 'flex-row-reverse' : 'flex-row'
      )}
    >
      {/* Avatar */}
      <div className="flex shrink-0 flex-col items-center pt-0.5">
        <Avatar className="h-8 w-8">
          <AvatarFallback
            className={cn(
              'text-xs',
              isUser
                ? 'bg-primary text-primary-foreground'
                : 'bg-primary/10 text-primary'
            )}
          >
            {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
          </AvatarFallback>
        </Avatar>
      </div>

      {/* Message content */}
      <div className={cn('flex min-w-0 flex-col', isUser ? 'items-end' : 'items-start', 'max-w-[85%] md:max-w-[75%]')}>
        {isUser ? (
          <div className="rounded-2xl bg-primary px-4 py-3 text-sm text-primary-foreground shadow-sm">
            <p className="whitespace-pre-wrap leading-relaxed">{content}</p>
          </div>
        ) : (
          <div className="w-full">
            <div className="rounded-2xl border bg-card/60 px-4 py-3 shadow-sm backdrop-blur-sm">
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkBreaks]}
                  components={createMarkdownComponents(isDark)}
                >
                  {sanitizeMarkdown(content)}
                </ReactMarkdown>
              </div>
            </div>

            {/* Actions */}
            <div className="mt-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      onClick={handleCopy}
                    >
                      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    </Button>
                  }
                />
                <TooltipContent side="top">
                  <p>{copied ? 'Copied!' : 'Copy message'}</p>
                </TooltipContent>
              </Tooltip>

              {onRegenerate && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        onClick={onRegenerate}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                    }
                  />
                  <TooltipContent side="top">
                    <p>Regenerate</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
