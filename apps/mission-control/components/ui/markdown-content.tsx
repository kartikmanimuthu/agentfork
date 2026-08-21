"use client"

import * as React from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "@/lib/utils"

interface MarkdownContentProps {
  content: string;
  className?: string;
}

// Defined at module level so the reference is stable across renders.
// ReactMarkdown treats a new `components` object as a config change and
// re-parses the entire AST — keeping this outside the component prevents
// that unnecessary work on every parent re-render.
const MARKDOWN_COMPONENTS: React.ComponentProps<typeof ReactMarkdown>["components"] = {
  // Headings
  h1: ({ children }) => (
    <h1 className="text-lg font-bold mt-3 mb-1.5 first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-base font-bold mt-2.5 mb-1.5 first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-semibold mt-2 mb-1 first:mt-0">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-[13px] font-semibold mt-1.5 mb-1 first:mt-0">{children}</h4>
  ),

  // Paragraphs
  p: ({ children }) => (
    <p className="mb-1.5 last:mb-0 leading-relaxed text-[13px]">{children}</p>
  ),

  // Bold and italic
  strong: ({ children }) => (
    <strong className="font-bold">{children}</strong>
  ),
  em: ({ children }) => (
    <em className="italic">{children}</em>
  ),

  // Links
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline hover:text-primary/80 transition-colors"
    >
      {children}
    </a>
  ),

  // Lists
  ul: ({ children }) => (
    <ul className="list-disc list-inside mb-1.5 space-y-0.5 text-[13px]">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal list-inside mb-1.5 space-y-0.5 text-[13px]">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="leading-relaxed text-[13px]">{children}</li>
  ),

  // Code
  code: ({ className, children, ...props }) => {
    const isInline = !className;
    if (isInline) {
      return (
        <code
          className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono text-foreground"
          {...props}
        >
          {children}
        </code>
      );
    }
    return (
      <code className={cn("block", className)} {...props}>
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="bg-muted/50 border rounded-md p-3 mb-2 text-xs font-mono whitespace-pre-wrap break-words [word-break:break-word] overflow-hidden">
      {children}
    </pre>
  ),

  // Blockquotes
  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-primary/50 pl-4 py-1 mb-2 italic text-muted-foreground">
      {children}
    </blockquote>
  ),

  // Tables
  table: ({ children }) => (
    <div className="overflow-x-auto mb-2">
      <table className="min-w-full border-collapse text-xs">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-muted/50">{children}</thead>
  ),
  th: ({ children }) => (
    <th className="border border-border px-2 py-1 font-semibold text-left">
      {children}
    </th>
  ),
  tbody: ({ children }) => (
    <tbody>{children}</tbody>
  ),
  tr: ({ children }) => (
    <tr className="border-b border-border">{children}</tr>
  ),
  td: ({ children }) => (
    <td className="border border-border px-2 py-1">{children}</td>
  ),

  // Horizontal rule
  hr: () => (
    <hr className="border-t border-border my-4" />
  ),

  // Images
  img: ({ src, alt }) => (
    <img
      src={src}
      alt={alt || ""}
      className="max-w-full h-auto rounded-md my-2"
    />
  ),
};

/**
 * MarkdownContent component for rendering markdown text with proper formatting.
 * Supports GitHub-flavored markdown including tables, strikethrough, and task lists.
 *
 * Wrapped in React.memo so that unchanged message parts skip re-rendering entirely.
 * The MARKDOWN_COMPONENTS constant above keeps the ReactMarkdown config reference
 * stable, preventing redundant AST re-parses on parent re-renders.
 */
export const MarkdownContent = React.memo(function MarkdownContent({ content, className }: MarkdownContentProps) {
  if (!content) return null;

  return (
    // NOT whitespace-pre-wrap. ReactMarkdown already turns blank lines into
    // block elements, so preserving the source whitespace rendered every blank
    // line a SECOND time as a literal break — stacking on top of each block's
    // own margin and leaving ~60px gaps between list items. Code blocks keep
    // their own whitespace via <pre> in MARKDOWN_COMPONENTS.
    <div className={cn("markdown-content break-words overflow-hidden min-w-0", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={MARKDOWN_COMPONENTS}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
