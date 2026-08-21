'use client';

import { TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

/**
 * Underline tab styling, adapted from the OpenClaw control UI's layout while
 * keeping Mission Control's neutral palette (no brand red — the active marker is
 * `foreground`). Two scales: `page` for the outer section tabs, `file` for the
 * uppercase inner file switcher.
 */

const LIST_BASE = 'h-auto w-full flex-wrap justify-start rounded-none border-b bg-transparent p-0';

const TRIGGER_BASE =
  'relative rounded-none border-b-2 border-transparent bg-transparent shadow-none '
  + 'text-muted-foreground transition-colors hover:text-foreground '
  + 'data-[state=active]:border-foreground data-[state=active]:bg-transparent '
  + 'data-[state=active]:text-foreground data-[state=active]:shadow-none';

export function UnderlineTabsList({
  scale = 'page',
  className,
  children,
}: {
  scale?: 'page' | 'file';
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <TabsList className={cn(LIST_BASE, scale === 'page' ? 'gap-6' : 'gap-5', className)}>
      {children}
    </TabsList>
  );
}

export function UnderlineTabsTrigger({
  value,
  scale = 'page',
  count,
  unset,
  children,
}: {
  value: string;
  scale?: 'page' | 'file';
  /** Rendered muted beside the label, as in `Files 8`. */
  count?: number;
  /** Marks a file that has never been written — a muted dot, not a word, so a
   *  row of unseeded files stays readable. */
  unset?: boolean;
  children: React.ReactNode;
}) {
  return (
    <TabsTrigger
      value={value}
      className={cn(
        TRIGGER_BASE,
        scale === 'page'
          ? 'h-9 gap-1.5 px-0 pb-2 text-sm font-medium'
          : 'h-8 gap-1.5 px-0 pb-2 text-xs font-semibold uppercase tracking-wide',
      )}
    >
      {children}
      {count !== undefined && (
        <span className="text-xs font-normal text-muted-foreground/70">{count}</span>
      )}
      {unset && (
        <span
          aria-label="not written yet"
          title="Not written yet"
          className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40"
        />
      )}
    </TabsTrigger>
  );
}
