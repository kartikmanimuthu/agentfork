'use client';

import { X, FileText, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export type FileChipStatus = 'uploading' | 'done' | 'error';

export interface FileChipProps {
  fileName: string;
  status: FileChipStatus;
  error?: string;
  onRemove?: () => void;
  className?: string;
}

export function FileChip({ fileName, status, error, onRemove, className }: FileChipProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 rounded-lg border bg-muted/60 px-2.5 py-1 text-xs',
        status === 'error' && 'border-destructive/40 bg-destructive/10 text-destructive',
        status === 'done' && 'border-border',
        status === 'uploading' && 'border-border opacity-70',
        className
      )}
      role="listitem"
      aria-label={`${fileName} — ${status}`}
    >
      {/* Status icon */}
      {status === 'uploading' && (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" aria-hidden />
      )}
      {status === 'done' && (
        <CheckCircle2 className="h-3 w-3 shrink-0 text-green-500" aria-hidden />
      )}
      {status === 'error' && (
        <Tooltip>
          <TooltipTrigger asChild>
            <AlertCircle className="h-3 w-3 shrink-0 cursor-help" aria-hidden />
          </TooltipTrigger>
          <TooltipContent side="top">
            <p>{error ?? 'Upload failed'}</p>
          </TooltipContent>
        </Tooltip>
      )}

      {/* File icon + name */}
      <FileText className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
      <span className="max-w-[120px] truncate" title={fileName}>
        {fileName}
      </span>

      {/* Remove button */}
      {onRemove && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="ml-0.5 h-4 w-4 shrink-0 rounded-sm p-0 hover:bg-muted-foreground/20"
          onClick={onRemove}
          aria-label={`Remove ${fileName}`}
        >
          <X className="h-2.5 w-2.5" />
        </Button>
      )}
    </div>
  );
}
