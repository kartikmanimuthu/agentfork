'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Eye, EyeOff, History, RotateCcw, Save } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { type WorkspaceFileDTO, useSaveWorkspaceFile } from '@/hooks/use-workspace-files';
import { FilePreviewDialog } from './file-preview-dialog';

/** Workspace files are rows, not files — but naming them like files is how the
 *  concept reads, and it matches the workspace they're modelled on. */
export function fileNameFor(slug: string): string {
  return `${slug.toUpperCase()}.md`;
}

export function FileEditor({
  file,
  onHistory,
}: {
  file: WorkspaceFileDTO;
  onHistory: () => void;
}) {
  const [draft, setDraft] = useState(file.content);
  const [previewOpen, setPreviewOpen] = useState(false);
  // These files hold persona, credentials guidance and personal context, so the
  // content starts obscured and is revealed deliberately — Preview or the eye.
  const [revealed, setRevealed] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const save = useSaveWorkspaceFile();

  const revealAndFocus = () => {
    setRevealed(true);
    // Next frame: the overlay covering the textarea unmounts on reveal, so focus
    // has to wait for it to go.
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  useEffect(() => {
    setDraft(file.content);
    setRevealed(false);
  }, [file.slug, file.version, file.content]);

  const dirty = draft !== file.content;
  const overCap = draft.length > file.charCap;

  const onSave = async () => {
    try {
      const saved = await save.mutateAsync({ slug: file.slug, content: draft });
      toast.success('Saved', { description: `${fileNameFor(file.slug)} is now v${saved.version}` });
    } catch (error) {
      toast.error('Save failed', {
        description: error instanceof Error ? error.message : 'Try again',
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-mono text-sm text-muted-foreground">{fileNameFor(file.slug)}</span>
        <div className="flex items-center gap-2">
          {/* Only shown once revealed. A reveal button here would duplicate both the
              overlay's click target and Preview's eye icon. */}
          {revealed && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRevealed(false)}
              aria-label="Hide content"
              title="Hide content"
            >
              <EyeOff className="w-4 h-4" />
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setPreviewOpen(true)}>
            <Eye className="w-4 h-4 mr-1" /> Preview
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!dirty}
            onClick={() => setDraft(file.content)}
            data-testid="file-editor-reset"
          >
            <RotateCcw className="w-4 h-4 mr-1" /> Reset
          </Button>
          <Button
            size="sm"
            disabled={!dirty || overCap || save.isPending}
            onClick={onSave}
            data-testid="file-editor-save"
          >
            <Save className="w-4 h-4 mr-1" /> {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Content</p>
        <p className="text-xs text-muted-foreground">{file.label.blurb}</p>

        <div className="relative">
          <Textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            // Focusing to type must reveal, or the file would be uneditable.
            onFocus={() => setRevealed(true)}
            rows={20}
            className={cn(
              'font-mono text-sm',
              // Blur the TEXT, not the element: filter:blur on a textarea softens its
              // border too, which reads as broken. Transparent glyphs plus a shadow
              // leaves the box crisp.
              !revealed
                && 'select-none text-transparent caret-transparent [text-shadow:0_0_7px_rgba(15,23,42,0.5)] dark:[text-shadow:0_0_7px_rgba(226,232,240,0.5)]',
            )}
            aria-label={`${file.label.title} content`}
            data-testid="file-editor-textarea"
          />
          {!revealed && (
            <button
              type="button"
              onClick={revealAndFocus}
              className="absolute inset-0 flex cursor-pointer items-center justify-center rounded-md"
              aria-label="Reveal content"
            >
              <span className="flex items-center gap-2 rounded-md border bg-background/95 px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
                <Eye className="h-3.5 w-3.5" /> Hidden — click to reveal, or use Preview
              </span>
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
          data-testid="file-editor-meta"
        >
          <span className={overCap ? 'text-destructive' : undefined}>
            {draft.length} / {file.charCap} characters
          </span>
          <span>·</span>
          <span>v{file.version}</span>
          <span>·</span>
          <span className="flex items-center gap-1">
            last edited by
            {file.updatedBy === 'claw' ? <Badge variant="secondary">Claw</Badge> : <span>you</span>}
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={onHistory} data-testid="file-editor-history">
          <History className="w-4 h-4 mr-1" /> History
        </Button>
      </div>

      <FilePreviewDialog
        fileName={fileNameFor(file.slug)}
        content={draft}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        onEdit={revealAndFocus}
      />
    </div>
  );
}
