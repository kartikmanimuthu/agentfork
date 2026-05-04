'use client';

import { useState } from 'react';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Copy, Check, RotateCcw, Bot, User } from 'lucide-react';

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
                  components={{
                    code({ className, children, ...props }) {
                      const match = /language-(\w+)/.exec(className || '');
                      const language = match ? match[1] : '';
                      const isInline = !className;

                      if (isInline) {
                        return (
                          <code
                            className="rounded bg-muted px-1 py-0.5 text-sm font-mono text-foreground"
                            {...props}
                          >
                            {children}
                          </code>
                        );
                      }

                      return (
                        <div className="my-3 overflow-hidden rounded-lg border">
                          <div className="flex items-center justify-between bg-muted/80 px-3 py-1.5">
                            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                              {language || 'text'}
                            </span>
                            <Tooltip>
                            <TooltipTrigger
                              render={
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                  onClick={handleCopy}
                                >
                                  {copied ? (
                                    <Check className="h-3.5 w-3.5" />
                                  ) : (
                                    <Copy className="h-3.5 w-3.5" />
                                  )}
                                </Button>
                              }
                            />
                            <TooltipContent side="top">
                              <p>{copied ? 'Copied!' : 'Copy code'}</p>
                            </TooltipContent>
                          </Tooltip>
                          </div>
                          <SyntaxHighlighter
                            language={language || 'text'}
                            style={isDark ? oneDark : oneLight}
                            customStyle={{ margin: 0, borderRadius: 0, fontSize: '0.8125rem', padding: '1rem' }}
                            wrapLongLines
                          >
                            {String(children).replace(/\n$/, '')}
                          </SyntaxHighlighter>
                        </div>
                      );
                    },
                    p({ children }) {
                      return <p className="mb-2 last:mb-0 leading-7">{children}</p>;
                    },
                    ul({ children }) {
                      return <ul className="mb-2 list-disc pl-5 last:mb-0 space-y-1">{children}</ul>;
                    },
                    ol({ children }) {
                      return <ol className="mb-2 list-decimal pl-5 last:mb-0 space-y-1">{children}</ol>;
                    },
                    li({ children }) {
                      return <li className="leading-7">{children}</li>;
                    },
                    h1({ children }) {
                      return <h1 className="mb-2 text-lg font-bold tracking-tight">{children}</h1>;
                    },
                    h2({ children }) {
                      return <h2 className="mb-2 text-base font-semibold tracking-tight">{children}</h2>;
                    },
                    h3({ children }) {
                      return <h3 className="mb-1 text-sm font-semibold tracking-tight">{children}</h3>;
                    },
                    blockquote({ children }) {
                      return (
                        <blockquote className="mb-2 border-l-2 border-primary/30 pl-3 italic text-muted-foreground">
                          {children}
                        </blockquote>
                      );
                    },
                    hr() {
                      return <hr className="my-3 border-border" />;
                    },
                    table({ children }) {
                      return (
                        <div className="my-2 overflow-hidden rounded-lg border">
                          <table className="w-full text-sm">{children}</table>
                        </div>
                      );
                    },
                    thead({ children }) {
                      return <thead className="bg-muted">{children}</thead>;
                    },
                    th({ children }) {
                      return <th className="border-b px-3 py-2 text-left font-semibold">{children}</th>;
                    },
                    td({ children }) {
                      return <td className="border-b px-3 py-2">{children}</td>;
                    },
                  }}
                >
                  {content}
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
