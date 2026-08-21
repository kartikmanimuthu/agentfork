'use client';

import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

/**
 * Document-scale markdown renderer for workspace-file previews.
 *
 * Structure follows the OpenClaw control UI's `.md-preview-dialog__reader`
 * (ui/src/styles/components.css): a section rule above every h2, 15px/1.74 body,
 * 1.05rem block rhythm.
 *
 * Typeface and heading scale are deliberately NOT theirs. They use a serif display
 * face at clamp(2.2rem, 4.4vw, 3.35rem); this app is sans throughout and that size
 * overwhelms a settings pane. Structure from the reference, type from our theme.
 *
 * Deliberately separate from components/ui/markdown-content.tsx, which is tuned for
 * chat bubbles (13px body, tight margins) and hardcodes those sizes per element, so
 * it cannot be scaled from a parent — and retuning it would change /chat.
 */

// Horizontal padding lives on each block rather than the container, so the h1's
// tint band can span the full content width the way the reference's does.
const PX = 'px-8 sm:px-10';

// Shared block rhythm: OpenClaw sets margin-bottom 1.05rem on every block element.
const BLOCK = `${PX} mt-0 mb-[1.05rem] last:mb-0`;

const HEADING = 'font-semibold tracking-tight text-foreground text-balance';

// Module-level so ReactMarkdown sees a stable reference and skips re-parsing.
const DOCUMENT_COMPONENTS: React.ComponentProps<typeof ReactMarkdown>['components'] = {
  // Full-width tint band + rule beneath, as the reference's title block reads.
  h1: ({ children }) => (
    <h1
      className={cn(
        HEADING, PX,
        'mb-6 border-b border-border bg-muted/40 py-6 text-2xl leading-snug',
      )}
    >
      {children}
    </h1>
  ),

  // The rule above each section is what gives the reference its document feel.
  h2: ({ children }) => (
    <h2
      className={cn(
        HEADING, PX,
        'mb-3 mt-8 border-t border-border pt-7 text-lg',
        'first:mt-0 first:border-t-0 first:pt-0',
      )}
    >
      {children}
    </h2>
  ),

  h3: ({ children }) => (
    <h3 className={cn(HEADING, PX, 'mb-2 mt-6 text-base first:mt-0')}>{children}</h3>
  ),

  h4: ({ children }) => (
    <h4 className={cn(HEADING, PX, 'mb-2 mt-5 text-sm first:mt-0')}>{children}</h4>
  ),

  p: ({ children }) => <p className={BLOCK}>{children}</p>,

  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,

  // list-outside + ml keeps the marker indent from fighting the block's px padding.
  ul: ({ children }) => <ul className={cn(BLOCK, 'list-outside list-disc ml-5')}>{children}</ul>,
  ol: ({ children }) => <ol className={cn(BLOCK, 'list-outside list-decimal ml-5')}>{children}</ol>,
  li: ({ children }) => <li className="pl-1 [&+li]:mt-[0.32rem]">{children}</li>,

  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-2 hover:text-primary/80"
    >
      {children}
    </a>
  ),

  code: ({ children }) => (
    <code className="rounded border bg-muted px-[0.42rem] py-[0.16rem] font-mono text-[0.9em]">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <div className={BLOCK}>
      <pre className="overflow-x-auto rounded-lg border bg-muted p-4 font-mono text-[13px]">
        {children}
      </pre>
    </div>
  ),

  blockquote: ({ children }) => (
    <div className={BLOCK}>
      <blockquote className="rounded-r-md border-l-[3px] border-primary/70 bg-muted/60 px-4 py-3.5 text-muted-foreground">
        {children}
      </blockquote>
    </div>
  ),

  // Full-bleed rule — no side padding, matching the reference's section divider.
  hr: () => <hr className="my-6 border-0 border-t border-border" />,

  table: ({ children }) => (
    <div className={BLOCK}>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse">{children}</table>
      </div>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b bg-muted/60 px-3 py-2.5 text-left align-top font-semibold">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border-b px-3 py-2.5 align-top [tr:last-child_&]:border-b-0">{children}</td>
  ),
};

export const MarkdownDocument = React.memo(function MarkdownDocument({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0 break-words text-[15px] leading-[1.74] text-foreground/90', className)}>
      {/* remarkBreaks matches the reference's markdown-it `breaks: true`. Without it
          a file written as one fact per line (IDENTITY.md's `name:` / `role:` lines)
          collapses into a single run-on paragraph. */}
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={DOCUMENT_COMPONENTS}>
        {content}
      </ReactMarkdown>
    </div>
  );
});
