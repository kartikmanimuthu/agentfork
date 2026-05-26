'use client';

import { useState, useRef, type ChangeEvent } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Play, RotateCcw } from 'lucide-react';

const SDK_SCRIPT_URL = '/sdk-assets/smc-chat-widget.esm.js';

interface SandboxConfig {
  apiUrl: string;
  session: string;
}

const DEFAULT_SESSION = JSON.stringify(
  {
    'x-platform-agent': 'web',
    'x-api-key': 'your-api-key',
  },
  null,
  2
);

function buildSandboxHtml(apiUrl: string, session: string): string {
  const sessionCompact = session.replace(/\n/g, '').replace(/\s{2,}/g, '');
  return `<!DOCTYPE html>
<html><head><style>body{margin:0;overflow:hidden;}</style></head>
<body>
<smc-chat-widget
  api-url="${apiUrl}"
  session='${sessionCompact}'
  user-name="You"
  bot-name="Bot"
  header-text="Chat Assistant"
  welcome-message="Welcome! How can I help you today?"
  theme="light"
  position="right"
  primary-color="#2196f3"
  secondary-color="#1976d2"
  input-placeholder="Type your message..."
></smc-chat-widget>
<script type="module" src="${SDK_SCRIPT_URL}"><\/script>
</body></html>`;
}

export default function SandboxPage() {
  const [config, setConfig] = useState<SandboxConfig>({ apiUrl: '', session: DEFAULT_SESSION });
  const [connected, setConnected] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const handleConnect = () => {
    if (!config.apiUrl.trim() || !config.session.trim()) return;
    setConnected(true);
    // Give the iframe a moment to mount before setting srcdoc
    setTimeout(() => {
      const iframe = iframeRef.current;
      if (!iframe) return;
      iframe.srcdoc = buildSandboxHtml(config.apiUrl, config.session);
    }, 50);
  };

  const handleReset = () => {
    setConnected(false);
    if (iframeRef.current) {
      iframeRef.current.srcdoc = '';
    }
  };

  const isReady = config.apiUrl.trim().length > 0 && config.session.trim().length > 0;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Chat Widget Sandbox</h1>
        <p className="text-muted-foreground">Test the widget against your real API endpoint</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Connect to Your API</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Enter your backend endpoint and session configuration to test the widget with live data.
          </p>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="sandboxApiUrl">API URL</Label>
              <Input
                id="sandboxApiUrl"
                placeholder="https://your-api.example.com/chat"
                value={config.apiUrl}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setConfig(prev => ({ ...prev, apiUrl: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sandboxSession">Session Config (JSON)</Label>
              <Textarea
                id="sandboxSession"
                rows={8}
                placeholder={DEFAULT_SESSION}
                value={config.session}
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                  setConfig(prev => ({ ...prev, session: e.target.value }))
                }
                className="font-mono text-sm"
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleConnect} disabled={!isReady}>
                <Play className="h-4 w-4 mr-2" />
                Connect
              </Button>
              {connected && (
                <Button variant="outline" onClick={handleReset}>
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Reset
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {connected && (
        <Card>
          <CardHeader>
            <CardTitle>Live Widget</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="bg-muted/40 rounded-lg p-4 min-h-[520px] relative">
              <iframe
                ref={iframeRef}
                className="w-full h-[500px] border-0 rounded"
                sandbox="allow-scripts allow-same-origin"
                title="Widget Sandbox"
              />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
