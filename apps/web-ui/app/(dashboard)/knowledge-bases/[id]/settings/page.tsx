'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { Settings, ArrowLeft, Save } from 'lucide-react';

interface KbConfig {
  id: string;
  name: string;
  description: string | null;
  status: string;
  chunkStrategy: string;
  chunkSize: number;
  chunkOverlap: number;
}

export default function KnowledgeBaseSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const [kb, setKb] = useState<KbConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Partial<KbConfig>>({});

  useEffect(() => {
    fetch(`/api/knowledge-bases/${id}`)
      .then((res) => res.json())
      .then((data) => {
        setKb(data);
        setForm({
          name: data.name,
          description: data.description ?? '',
          status: data.status,
          chunkStrategy: data.chunkStrategy,
          chunkSize: data.chunkSize,
          chunkOverlap: data.chunkOverlap,
        });
        setLoading(false);
      })
      .catch(() => {
        toast.error('Failed to load settings');
        setLoading(false);
      });
  }, [id]);

  const update = (key: keyof KbConfig, value: string | number) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/knowledge-bases/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error('Save failed');
      toast.success('Settings saved');
    } catch {
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 space-y-6 p-4 md:p-8 pt-6 max-w-2xl">
      <div className="flex items-center gap-2">
        <Link href={`/knowledge-bases/${id}`} aria-label="Back" className={buttonVariants({ variant: 'ghost', size: 'icon' })}>
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <Settings className="h-5 w-5" />
        <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>General</CardTitle>
              <CardDescription>Basic knowledge base information.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={form.name ?? ''}
                  onChange={(e) => update('name', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={form.description ?? ''}
                  onChange={(e) => update('description', e.target.value)}
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <Select value={form.status} onValueChange={(v) => update('status', v)}>
                  <SelectTrigger id="status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Chunking</CardTitle>
              <CardDescription>
                Changes apply to newly ingested documents only.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="strategy">Strategy</Label>
                <Select value={form.chunkStrategy} onValueChange={(v) => update('chunkStrategy', v)}>
                  <SelectTrigger id="strategy">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="RECURSIVE_CHARACTER">Recursive Character</SelectItem>
                    <SelectItem value="FIXED_SIZE">Fixed Size</SelectItem>
                    <SelectItem value="SEMANTIC">Semantic</SelectItem>
                    <SelectItem value="MARKDOWN_AWARE">Markdown Aware</SelectItem>
                    <SelectItem value="CODE_AWARE">Code Aware</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="chunkSize">Chunk Size (tokens)</Label>
                  <Input
                    id="chunkSize"
                    type="number"
                    value={form.chunkSize ?? 512}
                    onChange={(e) => update('chunkSize', parseInt(e.target.value, 10))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="chunkOverlap">Overlap (tokens)</Label>
                  <Input
                    id="chunkOverlap"
                    type="number"
                    value={form.chunkOverlap ?? 50}
                    onChange={(e) => update('chunkOverlap', parseInt(e.target.value, 10))}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={saving}>
              <Save className="h-4 w-4 mr-2" />
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
