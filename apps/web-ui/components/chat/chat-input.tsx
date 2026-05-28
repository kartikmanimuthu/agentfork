'use client';

import { useRef, useState, useCallback, type FormEvent, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SendHorizontal, Paperclip } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { FileChip, type FileChipStatus } from './file-chip';

const ALLOWED_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_FILES = 5;

export interface UploadedAttachment {
  fileId: string;
  s3Key: string;
  mimeType: string;
  fileName: string;
  size: number;
}

interface PendingFile {
  /** Local ID for React key / removal */
  localId: string;
  file: File;
  status: FileChipStatus;
  previewUrl?: string;
  attachment?: UploadedAttachment;
  error?: string;
}

export interface ChatInputProps {
  onSend: (content: string, attachments?: UploadedAttachment[]) => void;
  isLoading: boolean;
  /**
   * Optional upload handler. When provided, the paperclip button is shown.
   * The parent is responsible for calling the upload API and returning the
   * attachment metadata.
   */
  uploadFile?: (file: File) => Promise<UploadedAttachment>;
}

export function ChatInput({ onSend, isLoading, uploadFile }: ChatInputProps) {
  const [input, setInput] = useState('');
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canSend =
    !isLoading &&
    (input.trim().length > 0 || pendingFiles.some((f) => f.status === 'done')) &&
    pendingFiles.every((f) => f.status !== 'uploading');

  const resetInput = () => {
    setInput('');
    setPendingFiles([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSend) return;

    const attachments = pendingFiles
      .filter((f) => f.status === 'done' && f.attachment)
      .map((f) => f.attachment!);

    onSend(input.trim(), attachments.length > 0 ? attachments : undefined);
    resetInput();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canSend) {
        const attachments = pendingFiles
          .filter((f) => f.status === 'done' && f.attachment)
          .map((f) => f.attachment!);
        onSend(input.trim(), attachments.length > 0 ? attachments : undefined);
        resetInput();
      }
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!uploadFile || !e.target.files) return;

      const files = Array.from(e.target.files);
      e.target.value = '';

      const availableSlots = MAX_FILES - pendingFiles.length;
      const filesToAdd = files.slice(0, availableSlots);

      const newPending: PendingFile[] = filesToAdd.map((file) => ({
        localId: crypto.randomUUID(),
        file,
        status: 'uploading' as FileChipStatus,
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
      }));

      setPendingFiles((prev) => [...prev, ...newPending]);

      // Upload each file concurrently
      await Promise.all(
        newPending.map(async (pending) => {
          // Client-side validation
          if (!ALLOWED_MIME_TYPES.includes(pending.file.type)) {
            setPendingFiles((prev) =>
              prev.map((f) =>
                f.localId === pending.localId
                  ? { ...f, status: 'error', error: `File type ${pending.file.type} not allowed` }
                  : f
              )
            );
            return;
          }
          if (pending.file.size > MAX_FILE_SIZE) {
            setPendingFiles((prev) =>
              prev.map((f) =>
                f.localId === pending.localId
                  ? { ...f, status: 'error', error: 'File exceeds 10 MB limit' }
                  : f
              )
            );
            return;
          }

          try {
            const attachment = await uploadFile(pending.file);
            setPendingFiles((prev) =>
              prev.map((f) =>
                f.localId === pending.localId
                  ? { ...f, status: 'done', attachment }
                  : f
              )
            );
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Upload failed';
            setPendingFiles((prev) =>
              prev.map((f) =>
                f.localId === pending.localId
                  ? { ...f, status: 'error', error: message }
                  : f
              )
            );
          }
        })
      );
    },
    [uploadFile]
  );

  const removeFile = (localId: string) => {
    setPendingFiles((prev) => {
      const file = prev.find((f) => f.localId === localId);
      if (file?.previewUrl) URL.revokeObjectURL(file.previewUrl);
      return prev.filter((f) => f.localId !== localId);
    });
  };

  const retryFile = useCallback(
    async (localId: string) => {
      if (!uploadFile) return;
      const pending = pendingFiles.find((f) => f.localId === localId);
      if (!pending) return;

      setPendingFiles((prev) =>
        prev.map((f) => (f.localId === localId ? { ...f, status: 'uploading' as FileChipStatus, error: undefined } : f)),
      );

      try {
        const attachment = await uploadFile(pending.file);
        setPendingFiles((prev) =>
          prev.map((f) => (f.localId === localId ? { ...f, status: 'done' as FileChipStatus, attachment } : f)),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Upload failed';
        setPendingFiles((prev) =>
          prev.map((f) => (f.localId === localId ? { ...f, status: 'error' as FileChipStatus, error: message } : f)),
        );
      }
    },
    [uploadFile, pendingFiles],
  );

  return (
    <form onSubmit={handleSubmit} className="border-t bg-background/80 px-4 py-3 backdrop-blur-sm">
      {/* File chips */}
      {pendingFiles.length > 0 && (
        <div
          className="mx-auto mb-2 flex max-w-3xl flex-wrap gap-1.5"
          role="list"
          aria-label="Attached files"
        >
          {pendingFiles.map((pf) => (
            <FileChip
              key={pf.localId}
              fileName={pf.file.name}
              size={pf.file.size}
              mimeType={pf.file.type}
              status={pf.status}
              previewUrl={pf.previewUrl}
              error={pf.error}
              onRemove={() => removeFile(pf.localId)}
              onRetry={pf.status === 'error' ? () => retryFile(pf.localId) : undefined}
            />
          ))}
        </div>
      )}

      <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border bg-muted/40 p-2 shadow-sm transition-all focus-within:border-primary/30 focus-within:bg-background focus-within:shadow-md focus-within:ring-1 focus-within:ring-ring/40">
        {/* Hidden file input */}
        {uploadFile && (
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ALLOWED_MIME_TYPES.join(',')}
            className="sr-only"
            aria-hidden
            onChange={handleFileChange}
          />
        )}

        {/* Paperclip button */}
        {uploadFile && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={isLoading}
                  className="h-9 w-9 shrink-0 rounded-xl text-muted-foreground transition-all hover:text-foreground disabled:opacity-40"
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Attach files"
                >
                  <Paperclip className="h-4 w-4" />
                </Button>
              }
            />
            <TooltipContent side="top">
              <p>Attach files</p>
              <p className="text-[10px] text-muted-foreground">PDF, DOCX, TXT, images — max 10 MB</p>
            </TooltipContent>
          </Tooltip>
        )}

        <Textarea
          ref={textareaRef}
          value={input}
          onChange={handleChange}
          onKeyDown={onKeyDown}
          placeholder={isLoading ? 'Assistant is typing...' : 'Type a message...'}
          disabled={isLoading}
          rows={1}
          className="min-h-0 flex-1 resize-none border-0 bg-transparent px-3 py-2 text-sm shadow-none outline-none focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed placeholder:text-muted-foreground/60"
        />

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="submit"
                size="icon"
                disabled={!canSend}
                className="h-9 w-9 shrink-0 rounded-xl transition-all disabled:opacity-40"
              >
                {isLoading ? (
                  <Spinner />
                ) : (
                  <SendHorizontal className="h-4 w-4" />
                )}
              </Button>
            }
          />
          <TooltipContent side="top">
            <p>{isLoading ? 'Sending...' : 'Send message'}</p>
            <p className="text-[10px] text-muted-foreground">Shift + Enter for new line</p>
          </TooltipContent>
        </Tooltip>
      </div>
      <p className="mt-1.5 text-center text-[10px] text-muted-foreground/60">
        Press Enter to send, Shift + Enter for a new line
      </p>
    </form>
  );
}
