'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { type WorkspaceFileDTO } from '@/hooks/use-workspace-files';
import { FileEditor } from './file-editor';
import { RevisionHistoryDialog } from './revision-history-dialog';
import { UnderlineTabsList, UnderlineTabsTrigger } from './underline-tabs';

/**
 * A file holding only its seeded scaffold has never really been written. Strips
 * HTML comments AND markdown headings before checking, because every seed template
 * opens with a title — checking for comments alone would never flag anything.
 */
function isUnset(content: string): boolean {
  const stripped = content
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*#{1,6}\s.*$/gm, '')
    .trim();
  return stripped.length === 0;
}

export function CoreFilesCard({ files }: { files: WorkspaceFileDTO[] }) {
  const [historySlug, setHistorySlug] = useState<string | null>(null);
  const qc = useQueryClient();

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1.5">
          <CardTitle className="text-base">Core Files</CardTitle>
          <CardDescription>Bootstrap persona, identity, and tool guidance.</CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => qc.invalidateQueries({ queryKey: ['workspace-files'] })}
        >
          <RefreshCw className="w-4 h-4 mr-1" /> Refresh
        </Button>
      </CardHeader>

      <CardContent>
        <Tabs defaultValue={files[0].slug}>
          <UnderlineTabsList scale="file" className="mb-5">
            {files.map((file) => (
              <UnderlineTabsTrigger
                key={file.slug}
                value={file.slug}
                scale="file"
                unset={isUnset(file.content)}
              >
                {file.slug}
              </UnderlineTabsTrigger>
            ))}
          </UnderlineTabsList>

          {files.map((file) => (
            <TabsContent key={file.slug} value={file.slug} className="mt-0">
              <FileEditor file={file} onHistory={() => setHistorySlug(file.slug)} />
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>

      <RevisionHistoryDialog
        slug={historySlug}
        open={historySlug !== null}
        onOpenChange={(next) => {
          if (!next) setHistorySlug(null);
        }}
      />
    </Card>
  );
}
