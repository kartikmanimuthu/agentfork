'use client';

import { useState, useRef, useEffect, useCallback, type ChangeEvent } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Play } from 'lucide-react';

const SDK_SCRIPT_URL = '/sdk-assets/smc-chat-widget.esm.js';

interface WidgetConfig {
  apiUrl: string;
  session: string;
  userName: string;
  botName: string;
  headerText: string;
  headerIcon: string;
  welcomeMessage: string;
  startChatLogo: string;
  theme: 'light' | 'dark';
  position: 'left' | 'right';
  primaryColor: string;
  secondaryColor: string;
  inputPlaceholder: string;
  defaultOptions: string;
}

const DEFAULT_CONFIG: WidgetConfig = {
  apiUrl: '',
  session: '',
  userName: 'You',
  botName: 'Bot',
  headerText: 'Chat Assistant',
  headerIcon: '',
  welcomeMessage: 'Welcome! How can I help you today?',
  startChatLogo: 'https://cdn-icons-png.flaticon.com/512/4712/4712027.png',
  theme: 'light',
  position: 'right',
  primaryColor: '#2196f3',
  secondaryColor: '#1976d2',
  inputPlaceholder: 'Type your message...',
  defaultOptions: '[]',
};

export default function SandboxPage() {
  const [sandboxConfig, setSandboxConfig] = useState({ apiUrl: '', session: '' });
  const [sandboxActive, setSandboxActive] = useState(false);
  const sandboxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const script = document.createElement('script');
    script.type = 'module';
    script.src = SDK_SCRIPT_URL;
    document.head.appendChild(script);
    return () => { script.remove(); };
  }, []);

  const renderWidget = useCallback((container: HTMLDivElement | null, widgetConfig: WidgetConfig) => {
    if (!container) return;
    container.innerHTML = '';
    const widget = document.createElement('smc-chat-widget');
    widget.setAttribute('api-url', widgetConfig.apiUrl);
    widget.setAttribute('session', widgetConfig.session.replace(/\n/g, '').replace(/\s{2,}/g, ''));
    widget.setAttribute('user-name', widgetConfig.userName);
    widget.setAttribute('bot-name', widgetConfig.botName);
    widget.setAttribute('header-text', widgetConfig.headerText);
    if (widgetConfig.headerIcon) widget.setAttribute('header-icon', widgetConfig.headerIcon);
    widget.setAttribute('welcome-message', widgetConfig.welcomeMessage);
    widget.setAttribute('start-chat-logo', widgetConfig.startChatLogo);
    widget.setAttribute('theme', widgetConfig.theme);
    widget.setAttribute('position', widgetConfig.position);
    widget.setAttribute('primary-color', widgetConfig.primaryColor);
    widget.setAttribute('secondary-color', widgetConfig.secondaryColor);
    widget.setAttribute('input-placeholder', widgetConfig.inputPlaceholder);
    if (widgetConfig.defaultOptions !== '[]') widget.setAttribute('default-options', widgetConfig.defaultOptions);
    container.appendChild(widget);
  }, []);

  const handleSandboxConnect = () => {
    setSandboxActive(true);
    setTimeout(() => {
      renderWidget(sandboxRef.current, {
        ...DEFAULT_CONFIG,
        apiUrl: sandboxConfig.apiUrl,
        session: sandboxConfig.session,
      });
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
            <div ref={sandboxRef} className="relative min-h-[500px] border rounded-lg bg-muted/30" />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
