'use client';

import { useState, useRef, useEffect, useCallback, type ChangeEvent } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Copy, Check } from 'lucide-react';

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
  apiUrl: 'https://your-api.example.com/chat',
  session: JSON.stringify({ 'x-api-key': 'your-api-key', 'x-platform-agent': 'web' }, null, 2),
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

function generateEmbedCode(config: WidgetConfig): string {
  const attrs = [
    `api-url="${config.apiUrl}"`,
    `session='${config.session.replace(/\n/g, '').replace(/\s{2,}/g, '')}'`,
    config.userName !== 'You' ? `user-name="${config.userName}"` : '',
    config.botName !== 'Bot' ? `bot-name="${config.botName}"` : '',
    config.headerText !== 'Chat Assistant' ? `header-text="${config.headerText}"` : '',
    config.headerIcon ? `header-icon="${config.headerIcon}"` : '',
    config.welcomeMessage !== 'Welcome! How can I help you today?' ? `welcome-message="${config.welcomeMessage}"` : '',
    config.theme !== 'light' ? `theme="${config.theme}"` : '',
    config.position !== 'right' ? `position="${config.position}"` : '',
    config.primaryColor !== '#2196f3' ? `primary-color="${config.primaryColor}"` : '',
    config.secondaryColor !== '#1976d2' ? `secondary-color="${config.secondaryColor}"` : '',
    config.inputPlaceholder !== 'Type your message...' ? `input-placeholder="${config.inputPlaceholder}"` : '',
    config.defaultOptions !== '[]' ? `default-options='${config.defaultOptions}'` : '',
  ].filter(Boolean);

  return `<script type="module" src="https://your-cdn.com/sdk/smc-chat-widget.esm.js"><\/script>\n<smc-chat-widget\n  ${attrs.join('\n  ')}\n><\/smc-chat-widget>`;
}

export default function DesignerPage() {
  const [config, setConfig] = useState<WidgetConfig>(DEFAULT_CONFIG);
  const [copied, setCopied] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    renderWidget(previewRef.current, config);
  }, [config, renderWidget]);

  const handleCopy = () => {
    navigator.clipboard.writeText(generateEmbedCode(config));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const updateConfig = (key: keyof WidgetConfig, value: string) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Chat Widget Designer</h1>
        <p className="text-muted-foreground">Customize the widget appearance and generate embed code</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="headerText">Header Text</Label>
                <Input id="headerText" value={config.headerText} onChange={(e: ChangeEvent<HTMLInputElement>) => updateConfig('headerText', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="botName">Bot Name</Label>
                <Input id="botName" value={config.botName} onChange={(e: ChangeEvent<HTMLInputElement>) => updateConfig('botName', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="primaryColor">Primary Color</Label>
                <div className="flex gap-2">
                  <input type="color" value={config.primaryColor} onChange={(e: ChangeEvent<HTMLInputElement>) => updateConfig('primaryColor', e.target.value)} className="h-9 w-12 rounded border cursor-pointer" />
                  <Input value={config.primaryColor} onChange={(e: ChangeEvent<HTMLInputElement>) => updateConfig('primaryColor', e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="secondaryColor">Secondary Color</Label>
                <div className="flex gap-2">
                  <input type="color" value={config.secondaryColor} onChange={(e: ChangeEvent<HTMLInputElement>) => updateConfig('secondaryColor', e.target.value)} className="h-9 w-12 rounded border cursor-pointer" />
                  <Input value={config.secondaryColor} onChange={(e: ChangeEvent<HTMLInputElement>) => updateConfig('secondaryColor', e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="theme">Theme</Label>
                <Select value={config.theme} onValueChange={(v: string) => updateConfig('theme', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="light">Light</SelectItem>
                    <SelectItem value="dark">Dark</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="position">Position</Label>
                <Select value={config.position} onValueChange={(v: string) => updateConfig('position', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="right">Right</SelectItem>
                    <SelectItem value="left">Left</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="welcomeMessage">Welcome Message</Label>
              <Input id="welcomeMessage" value={config.welcomeMessage} onChange={(e: ChangeEvent<HTMLInputElement>) => updateConfig('welcomeMessage', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inputPlaceholder">Input Placeholder</Label>
              <Input id="inputPlaceholder" value={config.inputPlaceholder} onChange={(e: ChangeEvent<HTMLInputElement>) => updateConfig('inputPlaceholder', e.target.value)} />
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Live Preview</CardTitle>
            </CardHeader>
            <CardContent>
              <div ref={previewRef} className="relative min-h-[400px] border rounded-lg bg-muted/30" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Embed Code</CardTitle>
              <Button variant="outline" size="sm" onClick={handleCopy}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </CardHeader>
            <CardContent>
              <pre className="text-xs bg-muted p-4 rounded-lg overflow-x-auto whitespace-pre-wrap">
                {generateEmbedCode(config)}
              </pre>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
