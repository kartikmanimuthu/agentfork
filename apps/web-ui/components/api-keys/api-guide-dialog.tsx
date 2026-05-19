'use client';

import { useState } from 'react';
import { Copy, Check, Code2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface ApiGuideDialogProps {
  keyName: string;
  rawKey?: string;
  trigger?: React.ReactNode;
}

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="relative mt-2">
      <pre className="bg-zinc-950 text-zinc-100 rounded-md p-4 text-xs font-mono overflow-x-auto leading-relaxed">
        <code>{code}</code>
      </pre>
      <Button
        size="sm"
        variant="ghost"
        className="absolute top-2 right-2 h-7 w-7 p-0 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
        onClick={handleCopy}
        aria-label="Copy code"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}

export function ApiGuideDialog({ keyName, rawKey, trigger }: ApiGuideDialogProps) {
  const [open, setOpen] = useState(false);
  const [editableKey, setEditableKey] = useState(rawKey ?? '');
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://your-app.com';
  const key = editableKey || 'YOUR_API_KEY';

  const curlSnippet = `curl -X POST ${baseUrl}/api/v1/inference \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "messages": [
      { "role": "user", "content": "Hello!" }
    ]
  }'`;

  const pythonSnippet = `import requests

response = requests.post(
    "${baseUrl}/api/v1/inference",
    headers={
        "Authorization": "Bearer ${key}",
        "Content-Type": "application/json",
    },
    json={
        "messages": [{"role": "user", "content": "Hello!"}],
    },
)
print(response.json()["content"])`;

  const jsSnippet = `const res = await fetch("${baseUrl}/api/v1/inference", {
  method: "POST",
  headers: {
    "Authorization": "Bearer ${key}",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    messages: [{ role: "user", content: "Hello!" }],
  }),
});
const data = await res.json();
console.log(data.content);`;

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) setEditableKey(rawKey ?? '');
  };

  return (
    <>
      <span onClick={() => setOpen(true)}>
        {trigger ?? (
          <Button variant="outline" size="sm">
            <Code2 className="h-4 w-4 mr-2" />
            Integration Guide
          </Button>
        )}
      </span>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-[700px]">
          <DialogHeader>
            <DialogTitle>Integration Guide — {keyName}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-1.5">
            <Label htmlFor="api-key-input" className="text-sm">API Key</Label>
            <Input
              id="api-key-input"
              className="font-mono text-xs"
              placeholder="Paste your API key here to populate the snippets"
              value={editableKey}
              onChange={(e) => setEditableKey(e.target.value)}
            />
          </div>

          <Tabs defaultValue="curl">
            <TabsList>
              <TabsTrigger value="curl">cURL</TabsTrigger>
              <TabsTrigger value="python">Python</TabsTrigger>
              <TabsTrigger value="javascript">JavaScript</TabsTrigger>
            </TabsList>
            <TabsContent value="curl">
              <CodeBlock code={curlSnippet} />
            </TabsContent>
            <TabsContent value="python">
              <CodeBlock code={pythonSnippet} />
            </TabsContent>
            <TabsContent value="javascript">
              <CodeBlock code={jsSnippet} />
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}
