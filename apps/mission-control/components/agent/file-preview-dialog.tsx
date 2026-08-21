'use client';

import { useState } from 'react';
import { Maximize2, Minimize2, PencilLine, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { MarkdownDocument } from './markdown-document';

/**
 * Rendered-markdown preview of a workspace file.
 *
 * Geometry ported from the OpenClaw control UI's `.md-preview-dialog__panel`
 * (ui/src/styles/components.css):
 *   panel      min-height: min(76vh, 820px);  max-height: calc(100vh - 32px)
 *   fullscreen max-height: calc(100vh - 20px)
 *   body       flex:1; overflow:auto; padding: clamp(18px, 3vw, 28px)
 *   reader     width: min(100%, 82ch) — 96ch fullscreen — centred, own surface
 *
 * `min-height` is the important one: the panel keeps its size no matter how little
 * content there is, which is what makes it feel stable rather than collapsing around
 * a two-line file.
 */
export function FilePreviewDialog({
  fileName,
  content,
  open,
  onOpenChange,
  onEdit,
}: {
  fileName: string;
  content: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /** `Editor` must land the user in a usable editor — revealed and focused — not
   *  just dismiss back to a hidden textarea. */
  onEdit: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasContent = content.trim().length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setExpanded(false);
        onOpenChange(next);
      }}
    >
      <DialogContent
        showCloseButton={false}
        // Reference uses backdrop-filter: blur(14px) on this overlay; the shared
        // default is only 2px, which reads as no blur at all behind a reading pane.
        overlayClassName="bg-black/25 supports-backdrop-filter:backdrop-blur-md"
        className={cn(
          'flex flex-col gap-0 overflow-hidden p-0',
          'min-h-[min(76vh,820px)]',
          expanded
            ? 'max-h-[calc(100vh-20px)] sm:max-w-[calc(100vw-40px)]'
            : 'max-h-[calc(100vh-32px)] sm:max-w-4xl',
        )}
      >
        <div className="flex shrink-0 items-center justify-between gap-4 border-b px-5 py-3">
          <DialogTitle className="font-mono text-sm font-normal">{fileName}</DialogTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setExpanded((v) => !v)}>
              {expanded ? (
                <><Minimize2 className="w-4 h-4 mr-1" /> Collapse</>
              ) : (
                <><Maximize2 className="w-4 h-4 mr-1" /> Expand</>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { onOpenChange(false); onEdit(); }}
            >
              <PencilLine className="w-4 h-4 mr-1" /> Editor
            </Button>
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              <X className="w-4 h-4 mr-1" /> Close
            </Button>
          </div>
        </div>

        {/* Content sits flush on the panel — no inner card. The reference's reader
            surface is near-invisible in a light theme, and an outlined card inside a
            dialog reads as a box in a box. Horizontal padding lives on each markdown
            block so the H1 tint band can span the full width. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className={cn('mx-auto w-full py-2', expanded ? 'max-w-[110ch]' : 'max-w-[82ch]')}>
            {hasContent ? (
              <MarkdownDocument content={content} />
            ) : (
              <p className="px-8 py-8 text-[15px] text-muted-foreground sm:px-10">
                This file is empty.
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
