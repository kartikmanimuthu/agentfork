'use client';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Copy, Check } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useState } from 'react';
import type { Components } from 'react-markdown';

function CodeBlock({
  language,
  children,
  isDark,
}: {
  language: string;
  children: string;
  isDark: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
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
        {children.replace(/\n$/, '')}
      </SyntaxHighlighter>
    </div>
  );
}

export function createMarkdownComponents(isDark: boolean): Components {
  return {
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

      return <CodeBlock language={language} isDark={isDark}>{String(children)}</CodeBlock>;
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
  };
}
