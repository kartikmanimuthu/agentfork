'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { ArrowLeft, Plus, Globe, Database, Plug } from 'lucide-react';

const urlSourceSchema = z.object({
  type: z.literal('URL'),
  seedUrls: z.string().min(1, 'At least one seed URL is required'),
  crawlDepth: z.string(),
  includePatterns: z.string().optional(),
  excludePatterns: z.string().optional(),
  syncSchedule: z.string().optional(),
});

const fileSourceSchema = z.object({
  type: z.literal('FILE'),
  seedUrls: z.string().optional(),
  crawlDepth: z.string().optional(),
  includePatterns: z.string().optional(),
  excludePatterns: z.string().optional(),
  syncSchedule: z.string().optional(),
});

const connectorSourceSchema = z.object({
  type: z.literal('CONNECTOR'),
  seedUrls: z.string().optional(),
  crawlDepth: z.string().optional(),
  includePatterns: z.string().optional(),
  excludePatterns: z.string().optional(),
  syncSchedule: z.string().optional(),
});

const schema = z.discriminatedUnion('type', [urlSourceSchema, fileSourceSchema, connectorSourceSchema]);

type SourceFormValues = z.infer<typeof schema>;

export default function NewDataSourcePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const form = useForm({
    defaultValues: {
      type: 'URL' as const,
      seedUrls: '',
      crawlDepth: '0',
      includePatterns: '',
      excludePatterns: '',
      syncSchedule: '',
    } as SourceFormValues,
    validators: { onChange: schema },
    onSubmit: async ({ value }) => {
      const seedUrlsArray = value.seedUrls
        ?.split('\n')
        .map((u) => u.trim())
        .filter((u) => u.length > 0) ?? [];

      const includeArray = value.includePatterns
        ?.split('\n')
        .map((p) => p.trim())
        .filter((p) => p.length > 0) ?? [];

      const excludeArray = value.excludePatterns
        ?.split('\n')
        .map((p) => p.trim())
        .filter((p) => p.length > 0) ?? [];

      const body: Record<string, unknown> = {
        type: value.type,
        config: {},
      };

      if (value.type === 'URL') {
        body.config = {
          urls: seedUrlsArray,
          crawlDepth: Number(value.crawlDepth),
          ...(includeArray.length > 0 ? { includePatterns: includeArray } : {}),
          ...(excludeArray.length > 0 ? { excludePatterns: excludeArray } : {}),
        };
      }

      if (value.syncSchedule?.trim()) {
        body.syncSchedule = value.syncSchedule.trim();
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
    },
  });

  const type = form.getFieldValue('type');

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

      <form
        onSubmit={(e) => {
          e.preventDefault();
          form.handleSubmit();
        }}
      >
        <Card>
          <CardHeader>
            <CardTitle>Source Configuration</CardTitle>
            <CardDescription>Choose a source type and configure how data is ingested.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form.Field name="type">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>Source Type</Label>
                  <Select value={field.state.value} onValueChange={(v) => field.handleChange(v as 'URL' | 'FILE' | 'CONNECTOR')}>
                    <SelectTrigger id={field.name}>
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
              )}
            </form.Field>

            {type === 'URL' && (
              <>
                <form.Field name="seedUrls">
                  {(field) => (
                    <div className="space-y-2">
                      <Label htmlFor={field.name}>Seed URLs *</Label>
                      <Textarea
                        id={field.name}
                        placeholder="Enter one URL per line"
                        value={field.state.value ?? ''}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onBlur={field.handleBlur}
                        rows={4}
                      />
                      {field.state.meta.errors.length > 0 && (
                        <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
                      )}
                    </div>
                  )}
                </form.Field>
                <form.Field name="crawlDepth">
                  {(field) => (
                    <div className="space-y-2">
                      <Label htmlFor={field.name}>Crawl Depth</Label>
                      <Select value={field.state.value ?? '0'} onValueChange={(v) => field.handleChange(v)}>
                        <SelectTrigger id={field.name}>
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
                  )}
                </form.Field>
                <form.Field name="includePatterns">
                  {(field) => (
                    <div className="space-y-2">
                      <Label htmlFor={field.name}>Include Patterns</Label>
                      <Textarea
                        id={field.name}
                        placeholder="One pattern per line (optional)"
                        value={field.state.value ?? ''}
                        onChange={(e) => field.handleChange(e.target.value)}
                        rows={3}
                      />
                    </div>
                  )}
                </form.Field>
                <form.Field name="excludePatterns">
                  {(field) => (
                    <div className="space-y-2">
                      <Label htmlFor={field.name}>Exclude Patterns</Label>
                      <Textarea
                        id={field.name}
                        placeholder="One pattern per line (optional)"
                        value={field.state.value ?? ''}
                        onChange={(e) => field.handleChange(e.target.value)}
                        rows={3}
                      />
                    </div>
                  )}
                </form.Field>
                <form.Field name="syncSchedule">
                  {(field) => (
                    <div className="space-y-2">
                      <Label htmlFor={field.name}>Sync Schedule</Label>
                      <Input
                        id={field.name}
                        placeholder="Cron expression (optional), e.g. 0 2 * * *"
                        value={field.state.value ?? ''}
                        onChange={(e) => field.handleChange(e.target.value)}
                      />
                    </div>
                  )}
                </form.Field>
              </>
            )}

            {type === 'FILE' && (
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

            {type === 'CONNECTOR' && (
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
          <Button type="submit" disabled={form.state.isSubmitting || type !== 'URL'}>
            {form.state.isSubmitting ? 'Creating...' : 'Create Source'}
          </Button>
        </div>
      </form>
    </div>
  );
}
