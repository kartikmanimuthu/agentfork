'use client';

import { useState, useRef, type ChangeEvent } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Play } from 'lucide-react';

const SDK_SCRIPT_URL = '/sdk-assets/smc-chat-widget.esm.js';

export default function SandboxPage() {
  const [sandboxConfig, setSandboxConfig] = useState({ apiUrl: '', session: '' });
  const [sandboxActive, setSandboxActive] = useState(false);
  const sandboxRef = useRef<HTMLIFrameElement>(null);

  const handleSandboxConnect = () => {
    setSandboxActive(true);
    setTimeout(() => {
      const iframe = sandboxRef.current;
      if (!iframe) return;

      const config = {
        apiUrl: sandboxConfig.apiUrl,
        session: sandboxConfig.session.replace(/\n/g, '').replace(/\s{2,}/g, ''),
        userName: 'You',
        botName: 'Bot',
        headerText: 'Chat Assistant',
        welcomeMessage: 'Welcome! How can I help you today?',
        startChatLogo: 'https://cdn-icons-png.flaticon.com/512/4712/4712027.png',
        theme: 'light',
        position: 'right',
        primaryColor: '#2196f3',
        secondaryColor: '#1976d2',
        inputPlaceholder: 'Type your message...',
      };

      const attrs = [
        `api-url="${config.apiUrl}"`,
        `session='${config.session}'`,
        `user-name="${config.userName}"`,
        `bot-name="${config.botName}"`,
        `header-text="${config.headerText}"`,
        `welcome-message="${config.welcomeMessage}"`,
        `start-chat-logo="${config.startChatLogo}"`,
        `theme="${config.theme}"`,
        `position="${config.position}"`,
        `primary-color="${config.primaryColor}"`,
        `secondary-color="${config.secondaryColor}"`,
        `input-placeholder="${config.inputPlaceholder}"`,
      ].join(' ');

      iframe.srcdoc = `<!DOCTYPE html>
<html><head><style>body{margin:0;overflow:hidden;}</style></head>
<body>
<smc-chat-widget ${attrs}></smc-chat-widget>
<script type="module" src="${SDK_SCRIPT_URL}"><\/script>
</body></html>`;
    }, 100);
  };

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
                value={sandboxConfig.apiUrl}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setSandboxConfig(prev => ({ ...prev, apiUrl: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sandboxSession">Session Config (JSON)</Label>
              <Textarea
                id="sandboxSession"
                rows={8}
                placeholder={`{
  "x-platform-agent": "web",
  "x-prompt-session-attribute": {
    "oauthToken": "your-token",
    "clientCode": "your-client-code"
  },
  "x-session-attribute": {
    "oauthToken": "your-token",
    "clientCode": "your-client-code"
  },
  "x-api-key": "your-api-key"
}`}
                value={sandboxConfig.session}
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setSandboxConfig(prev => ({ ...prev, session: e.target.value }))}
                className="font-mono text-sm"
              />
            </div>
            <Button onClick={handleSandboxConnect} disabled={!sandboxConfig.apiUrl || !sandboxConfig.session}>
              <Play className="h-4 w-4 mr-2" /> Connect
            </Button>
          </div>
        </CardContent>
      </Card>

      {sandboxActive && (
        <Card>
          <CardHeader>
            <CardTitle>Live Widget</CardTitle>
          </CardHeader>
          <CardContent>
            <iframe ref={sandboxRef} className="w-full h-[500px] border rounded-lg" sandbox="allow-scripts allow-same-origin" title="Widget Sandbox" />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
