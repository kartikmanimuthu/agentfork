'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { ArrowLeft, Upload, FileUp, X } from 'lucide-react';

interface Source {
  id: string;
  type: string;
  name: string;
}

interface UploadFile {
  file: File;
  id: string;
  status: 'pending' | 'uploading' | 'processing' | 'done' | 'error';
  progress: number;
  error?: string;
}

export default function KnowledgeBaseUploadPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const sourceParam = searchParams.get('source');
  const [sources, setSources] = useState<Source[]>([]);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [loadingSources, setLoadingSources] = useState(true);
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const loadSources = useCallback(() => {
    fetch(`/api/knowledge-bases/${id}/sources`)
      .then((res) => res.json())
      .then((data) => {
        const items = (data.items ?? []) as Source[];
        const fileSources = items.filter((s) => s.type === 'FILE');
        setSources(fileSources);
        // Pre-select from query param if provided and valid
        if (sourceParam && fileSources.some((s) => s.id === sourceParam)) {
          setSelectedSource(sourceParam);
        } else if (fileSources.length > 0 && !selectedSource) {
          setSelectedSource(fileSources[0].id);
        }
        setLoadingSources(false);
      })
      .catch(() => {
        toast.error('Failed to load sources');
        setLoadingSources(false);
      });
  }, [id, sourceParam, selectedSource]);

  useEffect(() => {
    loadSources();
  }, [id, loadSources]);

  const addFiles = (newFiles: FileList | null) => {
    if (!newFiles) return;
    const uploaded = Array.from(newFiles).map((file) => ({
      file,
      id: crypto.randomUUID(),
      status: 'pending' as const,
      progress: 0,
    }));
    setFiles((prev) => [...prev, ...uploaded]);
  };

  const removeFile = (fileId: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== fileId));
  };

  const uploadFile = async (uploadFile: UploadFile) => {
    if (!selectedSource) {
      toast.error('No file source selected');
      return;
    }

    setFiles((prev) =>
      prev.map((f) => (f.id === uploadFile.id ? { ...f, status: 'uploading' as const } : f))
    );

    try {
      // 1. Get pre-signed upload URL and create document record
      const res = await fetch(`/api/knowledge-bases/${id}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataSourceId: selectedSource,
          fileName: uploadFile.file.name,
          mimeType: uploadFile.file.type || 'application/octet-stream',
          sizeBytes: uploadFile.file.size,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Upload failed' }));
        throw new Error(err.error ?? 'Upload failed');
      }

      const { uploadUrl, document } = await res.json();

      // 2. Upload file directly to S3
      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        body: uploadFile.file,
        headers: {
          'Content-Type': uploadFile.file.type || 'application/octet-stream',
        },
      });

      if (!uploadRes.ok) {
        throw new Error('Failed to upload file to storage');
      }

      // 3. Trigger ingestion now that the file is in S3
      const ingestRes = await fetch(`/api/knowledge-bases/${id}/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId: document.id,
          s3Key: document.sourceKey,
          mimeType: uploadFile.file.type || 'application/octet-stream',
        }),
      });

      if (!ingestRes.ok) {
        throw new Error('File uploaded but failed to start processing');
      }

      setFiles((prev) =>
        prev.map((f) => (f.id === uploadFile.id ? { ...f, status: 'done' as const, progress: 100 } : f))
      );
      toast.success(`${uploadFile.file.name} uploaded and queued for processing`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed';
      console.error("[KB Upload] Upload failed:", error);
      setFiles((prev) =>
        prev.map((f) => (f.id === uploadFile.id ? { ...f, status: 'error' as const, error: message } : f))
      );
      toast.error(message);
    }
  };

  const uploadAll = () => {
    files.filter((f) => f.status === 'pending').forEach((f) => uploadFile(f));
  };

  const pendingCount = files.filter((f) => f.status === 'pending').length;
  const uploadingCount = files.filter((f) => f.status === 'uploading').length;
  const doneCount = files.filter((f) => f.status === 'done').length;

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link
            href={`/knowledge-bases/${id}/documents`}
            aria-label="Back"
            className={buttonVariants({ variant: 'ghost', size: 'icon' })}
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <FileUp className="h-5 w-5" />
          <h2 className="text-2xl font-bold tracking-tight">Upload Documents</h2>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Source</CardTitle>
          <CardDescription>Select the file source to upload documents into.</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingSources ? (
            <Skeleton className="h-10 w-full" />
          ) : sources.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No file sources found.{` `}
              <Link
                href={`/knowledge-bases/${id}/sources/new`}
                className={buttonVariants({ variant: 'link', size: 'sm' }) + ' px-0'}
              >
                Create a file source &rarr;
              </Link>
            </div>
          ) : (
            <div className="flex gap-2 flex-wrap">
              {sources.map((s) => (
                <Button
                  key={s.id}
                  variant={selectedSource === s.id ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedSource(s.id)}
                >
                  {s.name || 'File Source'}
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Files</CardTitle>
          <CardDescription>Drag and drop files or click to browse.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              addFiles(e.dataTransfer.files);
            }}
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
              isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-muted-foreground/50'
            }`}
          >
            <input
              type="file"
              multiple
              className="hidden"
              id="file-upload"
              onChange={(e) => addFiles(e.target.files)}
            />
            <label htmlFor="file-upload" className="cursor-pointer flex flex-col items-center gap-2">
              <Upload className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium">Click or drag files here</p>
              <p className="text-xs text-muted-foreground">PDF, TXT, MD, DOCX, and more</p>
            </label>
          </div>

          {files.length > 0 && (
            <div className="space-y-2">
              {files.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <FileUp className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm truncate">{f.file.name}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {(f.file.size / 1024).toFixed(1)} KB
                    </span>
                    {f.status === 'done' && (
                      <span className="text-xs text-green-600 font-medium">Done</span>
                    )}
                    {f.status === 'error' && (
                      <span className="text-xs text-destructive font-medium">{f.error ?? 'Failed'}</span>
                    )}
                    {f.status === 'uploading' && (
                      <span className="text-xs text-muted-foreground animate-pulse">Uploading...</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {f.status === 'pending' && (
                      <Button variant="ghost" size="sm" onClick={() => uploadFile(f)}>
                        Upload
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground"
                      onClick={() => removeFile(f.id)}
                      aria-label="Remove file"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {files.length > 0 && (
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {pendingCount} pending · {uploadingCount} uploading · {doneCount} done
              </p>
              <div className="flex gap-2">
                {doneCount > 0 && (
                  <Button
                    variant="outline"
                    onClick={() => router.push(`/knowledge-bases/${id}/documents`)}
                  >
                    View Documents
                  </Button>
                )}
                {pendingCount > 0 && (
                  <Button onClick={uploadAll} disabled={!selectedSource}>
                    Upload All
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
