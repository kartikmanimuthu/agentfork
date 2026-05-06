'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { ArrowLeft, Plus, Globe, Database, Plug } from 'lucide-react';

interface FormState {
  type: 'URL' | 'FILE' | 'CONNECTOR';
  seedUrls: string;
  crawlDepth: string;
  includePatterns: string;
  excludePatterns: string;
  syncSchedule: string;
}

export default function NewDataSourcePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<FormState>({
    type: 'URL',
    seedUrls: '',
    crawlDepth: '0',
    includePatterns: '',
    excludePatterns: '',
    syncSchedule: '',
  });

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const seedUrlsArray = form.seedUrls
        .split('\n')
        .map((u) => u.trim())
        .filter((u) => u.length > 0);

      const includeArray = form.includePatterns
        .split('\n')
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

      const excludeArray = form.excludePatterns
        .split('\n')
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

      if (form.type === 'URL' && seedUrlsArray.length === 0) {
        toast.error('At least one seed URL is required');
        setSubmitting(false);
        return;
      }

      const body: Record<string, unknown> = {
        type: form.type,
        config: {},
      };

      if (form.type === 'URL') {
        body.config = {
          urls: seedUrlsArray,
          crawlDepth: Number(form.crawlDepth),
          ...(includeArray.length > 0 ? { includePatterns: includeArray } : {}),
          ...(excludeArray.length > 0 ? { excludePatterns: excludeArray } : {}),
        };
      }

      if (form.syncSchedule.trim()) {
        body.syncSchedule = form.syncSchedule.trim();
      }

      const res = await fetch(`/api/knowledge-bases/${id}/sources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? 'Failed to create source');
      }

      toast.success('Source created');
      router.push(`/knowledge-bases/${id}/sources`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create source');
      setSubmitting(false);
    }
  };

  return (
    <div className="flex-1 space-y-6 p-4 md:p-8 pt-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-2">
        <Link
          href={`/knowledge-bases/${id}/sources`}
          aria-label="Back"
          className={buttonVariants({ variant: 'ghost', size: 'icon' })}
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex items-center gap-2">
          <Plus className="h-6 w-6" />
          <h2 className="text-2xl font-bold tracking-tight">Add Data Source</h2>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Source Configuration</CardTitle>
          <CardDescription>
            Choose a source type and configure how data is ingested.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="type">Source Type</Label>
            <Select value={form.type} onValueChange={(v) => update('type', v as FormState['type'])}>
              <SelectTrigger id="type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="URL">
                  <div className="flex items-center gap-2">
                    <Globe className="h-4 w-4" />
                    URL
                  </div>
                </SelectItem>
                <SelectItem value="FILE">
                  <div className="flex items-center gap-2">
                    <Database className="h-4 w-4" />
                    File Upload
                  </div>
                </SelectItem>
                <SelectItem value="CONNECTOR">
                  <div className="flex items-center gap-2">
                    <Plug className="h-4 w-4" />
                    Connector
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {form.type === 'URL' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="seedUrls">Seed URLs *</Label>
                <Textarea
                  id="seedUrls"
                  placeholder="Enter one URL per line"
                  value={form.seedUrls}
                  onChange={(e) => update('seedUrls', e.target.value)}
                  rows={4}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="crawlDepth">Crawl Depth</Label>
                <Select value={form.crawlDepth} onValueChange={(v) => update('crawlDepth', v)}>
                  <SelectTrigger id="crawlDepth">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">0 (Seed URLs only)</SelectItem>
                    <SelectItem value="1">1</SelectItem>
                    <SelectItem value="2">2</SelectItem>
                    <SelectItem value="3">3</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="includePatterns">Include Patterns</Label>
                <Textarea
                  id="includePatterns"
                  placeholder="One pattern per line (optional)"
                  value={form.includePatterns}
                  onChange={(e) => update('includePatterns', e.target.value)}
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="excludePatterns">Exclude Patterns</Label>
                <Textarea
                  id="excludePatterns"
                  placeholder="One pattern per line (optional)"
                  value={form.excludePatterns}
                  onChange={(e) => update('excludePatterns', e.target.value)}
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="syncSchedule">Sync Schedule</Label>
                <Input
                  id="syncSchedule"
                  placeholder="Cron expression (optional), e.g. 0 2 * * *"
                  value={form.syncSchedule}
                  onChange={(e) => update('syncSchedule', e.target.value)}
                />
              </div>
            </>
          )}

          {form.type === 'FILE' && (
            <div className="rounded-md border bg-muted/50 p-4 text-sm text-muted-foreground">
              <p className="flex items-center gap-2">
                <Database className="h-4 w-4" />
                File uploads are managed from the Documents page.
              </p>
              <Link
                href={`/knowledge-bases/${id}/documents`}
                className={buttonVariants({ variant: 'link', size: 'sm' }) + ' mt-2 px-0'}
              >
                Go to Documents &rarr;
              </Link>
            </div>
          )}

          {form.type === 'CONNECTOR' && (
            <div className="rounded-md border bg-muted/50 p-4 text-sm text-muted-foreground">
              <p className="flex items-center gap-2">
                <Plug className="h-4 w-4" />
                Connector configuration coming soon.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSubmit} disabled={submitting || form.type !== 'URL'}>
          {submitting ? 'Creating...' : 'Create Source'}
        </Button>
      </div>
    </div>
  );
}
