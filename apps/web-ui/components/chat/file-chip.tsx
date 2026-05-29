'use client';

import { X, FileText, Image as ImageIcon, Loader2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export type FileChipStatus = 'uploading' | 'done' | 'error';

export interface FileChipProps {
  fileName: string;
  size?: number;
  mimeType?: string;
  status: FileChipStatus;
  previewUrl?: string;
  error?: string;
  onRemove?: () => void;
  onRetry?: () => void;
  className?: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(mimeType?: string) {
  if (mimeType?.startsWith('image/')) return ImageIcon;
  return FileText;
}

export function FileChip({
  fileName,
  size,
  mimeType,
  status,
  previewUrl,
  error,
  onRemove,
  onRetry,
  className,
}: FileChipProps) {
  const Icon = getFileIcon(mimeType);
  const isImage = mimeType?.startsWith('image/');

  return (
    <div
      className={cn(
        'group relative flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2 text-xs',
        status === 'error' && 'border-destructive/40 bg-destructive/10',
        className,
      )}
      role="listitem"
      aria-label={`${fileName} — ${status}`}
    >
      {isImage && previewUrl ? (
        <img
          src={previewUrl}
          alt={fileName}
          className="h-8 w-8 rounded object-cover"
        />
      ) : (
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      )}

      <div className="min-w-0 flex-1">
        <p className="max-w-[120px] truncate font-medium" title={fileName}>
          {fileName}
        </p>
        <p className="text-[10px] text-muted-foreground">
          {status === 'uploading' && 'Uploading...'}
          {status === 'done' && size != null && formatFileSize(size)}
          {status === 'error' && (
            <span className="text-destructive">
              {error ?? 'Failed'}
              {onRetry && (
                <>
                  {' '}
                  <button
                    type="button"
                    onClick={onRetry}
                    className="underline hover:no-underline"
                  >
                    Retry
                  </button>
                </>
              )}
            </span>
          )}
        </p>
      </div>

      {status === 'uploading' && (
        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" aria-hidden />
      )}

      {status === 'error' && !onRetry && (
        <Tooltip>
          <TooltipTrigger asChild>
            <AlertCircle className="h-3 w-3 shrink-0 text-destructive cursor-help" aria-hidden />
          </TooltipTrigger>
          <TooltipContent side="top">
            <p>{error ?? 'Upload failed'}</p>
          </TooltipContent>
        </Tooltip>
      )}

      {onRemove && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-5 w-5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
          onClick={onRemove}
          aria-label={`Remove ${fileName}`}
        >
          <X className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
