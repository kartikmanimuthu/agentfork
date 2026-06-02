'use client';

import { useState } from 'react';
import { ChevronRight, Brain } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ThinkingContent } from '@/lib/playground/types';

interface ThinkingBlockProps {
  thinking: ThinkingContent;
}

export function ThinkingBlock({ thinking }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mb-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Brain className="h-3 w-3" />
        <span>Thought for {(thinking.durationMs / 1000).toFixed(1)}s</span>
        <ChevronRight className={cn('h-3 w-3 transition-transform', expanded && 'rotate-90')} />
      </button>
      {expanded && (
        <div className="mt-1.5 rounded-md bg-muted/50 border px-3 py-2 text-xs text-muted-foreground font-mono whitespace-pre-wrap max-h-48 overflow-auto">
          {thinking.text}
        </div>
      )}
    </div>
  );
}
