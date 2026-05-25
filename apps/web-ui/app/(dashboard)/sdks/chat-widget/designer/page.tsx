'use client';

import { useState, useEffect, useCallback, type ChangeEvent } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Copy, Check, Save, RefreshCw } from 'lucide-react';

const SDK_SCRIPT_URL = '/sdk-assets/smc-chat-widget.esm.js';

interface Agent {
  id: string;
  name: string;
}

interface ApiKey {
  id: string;
  name: string;
  key?: string;
}

interface WidgetConfig {
  // Appearance
  primaryColor: string;
  secondaryColor: string;
  theme: string;
  position: string;
  botName: string;
  headerText: string;
  welcomeMessage: string;
  inputPlaceholder: string;
  // Behavior
  quickReplies: string;
  fileUploadEnabled: boolean;
  csatEnabled: boolean;
  csatType: string;
  allowedOrigins: string;
  // Pre-chat
  preChatEnabled: boolean;
  preChatTitle: string;
  preChatSubtitle: string;
  // Proactive
  proactiveEnabled: boolean;
  proactiveMessage: string;
  proactiveDelay: string;
  // Knowledge Base
  knowledgeBaseEnabled: boolean;
  knowledgeBaseIds: string;
  // Agent / API Key
  agentId: string;
  apiKeyId: string;
}

const DEFAULT_CONFIG: WidgetConfig = {
  primaryColor: '#2196f3',
  secondaryColor: '#1976d2',
  theme: 'light',
  position: 'right',
  botName: 'Bot',
  headerText: 'Chat Assistant',
  welcomeMessage: 'Welcome! How can I help you today?',
  inputPlaceholder: 'Type your message...',
  quickReplies: '',
  fileUploadEnabled: false,
  csatEnabled: false,
  csatType: 'stars',
  allowedOrigins: '',
  preChatEnabled: false,
  preChatTitle: 'Start a conversation',
  preChatSubtitle: 'Fill in the form below to get started',
  proactiveEnabled: false,
  proactiveMessage: 'Hi! Need any help?',
  proactiveDelay: '5',
  knowledgeBaseEnabled: false,
  knowledgeBaseIds: '',
  agentId: '',
  apiKeyId: '',
};

function buildIframeHtml(config: WidgetConfig, sdkId: string): string {
  if (!sdkId) return '';

  const ts = Date.now();
  return `<!DOCTYPE html>
<html><head><style>body{margin:0;overflow:hidden;}</style></head>
<body>
<smc-chat-widget sdk-id="${sdkId}" api-url="${typeof window !== 'undefined' ? window.location.origin : ''}" cache-bust="${ts}"></smc-chat-widget>
<script type="module" src="${SDK_SCRIPT_URL}"><\/script>
</body></html>`;
}

function buildEmbedCode(config: WidgetConfig, sdkId: string): string {
  const attrs: string[] = [];
  if (sdkId) attrs.push(`sdk-id="${sdkId}"`);
  attrs.push(`primary-color="${config.primaryColor}"`);
  attrs.push(`secondary-color="${config.secondaryColor}"`);
  if (config.theme !== 'light') attrs.push(`theme="${config.theme}"`);
  if (config.position !== 'right') attrs.push(`position="${config.position}"`);
  if (config.botName !== 'Bot') attrs.push(`bot-name="${config.botName}"`);
  if (config.headerText !== 'Chat Assistant') attrs.push(`header-text="${config.headerText}"`);
  if (config.welcomeMessage !== 'Welcome! How can I help you today?') attrs.push(`welcome-message="${config.welcomeMessage}"`);
  if (config.inputPlaceholder !== 'Type your message...') attrs.push(`input-placeholder="${config.inputPlaceholder}"`);

  return `<script type="module" src="https://your-cdn.com/sdk/smc-chat-widget.esm.js"><\/script>\n<smc-chat-widget\n  ${attrs.join('\n  ')}\n><\/smc-chat-widget>`;
}

export default function DesignerPage() {
  const [config, setConfig] = useState<WidgetConfig>(DEFAULT_CONFIG);
  const [sdkId, setSdkId] = useState('');
  const [widgetId, setWidgetId] = useState('');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [iframeHtml, setIframeHtml] = useState('');

  // Load agents on mount
  useEffect(() => {
    fetch('/api/agents?pageSize=100')
      .then(r => r.json())
      .then(data => {
        const list: Agent[] = Array.isArray(data) ? data : (data.items ?? []);
        setAgents(list);
      })
      .catch(() => {});
  }, []);

  // Load API keys when agent changes
  useEffect(() => {
    if (!config.agentId) {
      setApiKeys([]);
      return;
    }
    fetch(`/api/agents/${config.agentId}/api-keys`)
      .then(r => r.json())
      .then(data => {
        const list: ApiKey[] = Array.isArray(data) ? data : [];
        setApiKeys(list);
      })
      .catch(() => {});
  }, [config.agentId]);

  // Load existing widget on mount (first widget for this tenant)
  useEffect(() => {
    fetch('/api/v1/sdk-widgets')
      .then(r => r.json())
      .then((data: unknown[]) => {
        if (Array.isArray(data) && data.length > 0) {
          const w = data[0] as Record<string, unknown>;
          setWidgetId(w.id as string);
          setSdkId(w.sdkId as string ?? '');

          const proactiveRulesArr = Array.isArray(w.proactiveRules) ? w.proactiveRules as Array<Record<string, unknown>> : [];
          const preChatFormArr = Array.isArray(w.preChatForm) ? w.preChatForm as Array<Record<string, unknown>> : [];

          setConfig(prev => ({
            ...prev,
            primaryColor: (w.primaryColor as string) ?? prev.primaryColor,
            secondaryColor: (w.secondaryColor as string) ?? prev.secondaryColor,
            theme: (w.theme as string) ?? prev.theme,
            position: (w.position as string) ?? prev.position,
            botName: (w.botName as string) ?? prev.botName,
            headerText: (w.headerText as string) ?? prev.headerText,
            welcomeMessage: (w.welcomeMessage as string) ?? prev.welcomeMessage,
            inputPlaceholder: (w.inputPlaceholder as string) ?? prev.inputPlaceholder,
            agentId: (w.agentId as string) ?? prev.agentId,
            apiKeyId: (w.apiKeyId as string) ?? prev.apiKeyId,
            fileUploadEnabled: typeof w.fileUpload === 'boolean' ? w.fileUpload : prev.fileUploadEnabled,
            csatEnabled: typeof w.csatEnabled === 'boolean' ? w.csatEnabled : prev.csatEnabled,
            csatType: (w.csatType as string) ?? prev.csatType,
            knowledgeBaseEnabled: typeof w.kbEnabled === 'boolean' ? w.kbEnabled : prev.knowledgeBaseEnabled,
            quickReplies: Array.isArray(w.quickReplies) ? (w.quickReplies as string[]).join(', ') : prev.quickReplies,
            allowedOrigins: Array.isArray(w.allowedOrigins) ? (w.allowedOrigins as string[]).join(', ') : prev.allowedOrigins,
            preChatEnabled: preChatFormArr.length > 0,
            proactiveEnabled: proactiveRulesArr.length > 0,
            proactiveMessage: proactiveRulesArr.length > 0 ? (proactiveRulesArr[0].message as string ?? prev.proactiveMessage) : prev.proactiveMessage,
            proactiveDelay: proactiveRulesArr.length > 0 ? String(Math.round(((proactiveRulesArr[0].delay as number) ?? 5000) / 1000)) : prev.proactiveDelay,
          }));
        }
      })
      .catch(() => {});
  }, []);

  // Rebuild iframe HTML whenever config or sdkId changes
  useEffect(() => {
    setIframeHtml(buildIframeHtml(config, sdkId));
  }, [config, sdkId]);

  const update = useCallback(<K extends keyof WidgetConfig>(key: K, value: WidgetConfig[K]) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  }, []);

  const handlePublish = async () => {
    setSaving(true);
    try {
      const preChatForm = config.preChatEnabled
        ? [
            { field: 'name', type: 'text', label: 'Name', required: true },
            { field: 'email', type: 'email', label: 'Email', required: true },
          ]
        : null;

      const proactiveRules = config.proactiveEnabled
        ? [
            {
              trigger: 'time',
              delay: parseInt(config.proactiveDelay, 10) * 1000,
              message: config.proactiveMessage,
            },
          ]
        : null;

      const payload: Record<string, unknown> = {
        agentId: config.agentId || undefined,
        apiKeyId: config.apiKeyId || undefined,
        name: config.headerText || 'My Widget',
        primaryColor: config.primaryColor,
        secondaryColor: config.secondaryColor,
        theme: config.theme,
        position: config.position,
        botName: config.botName,
        headerText: config.headerText,
        welcomeMessage: config.welcomeMessage,
        inputPlaceholder: config.inputPlaceholder,
        fileUpload: config.fileUploadEnabled,
        csatEnabled: config.csatEnabled,
        csatType: config.csatType,
        allowedOrigins: config.allowedOrigins ? config.allowedOrigins.split(',').map(s => s.trim()).filter(Boolean) : [],
        quickReplies: config.quickReplies ? config.quickReplies.split(',').map(s => s.trim()).filter(Boolean) : null,
        kbEnabled: config.knowledgeBaseEnabled,
        preChatForm,
        proactiveRules,
      };

      console.log('[designer] Publishing widget', { widgetId, sdkId, payload });

      if (widgetId) {
        const res = await fetch(`/api/v1/sdk-widgets/${widgetId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        console.log('[designer] PATCH response', { status: res.status, ok: res.ok });
        if (res.ok) {
          const updated = await res.json();
          console.log('[designer] Widget updated', updated);
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
          setIframeHtml(buildIframeHtml(config, sdkId) + `<!-- refresh:${Date.now()} -->`);
        } else {
          const err = await res.text();
          console.error('[designer] PATCH failed', { status: res.status, body: err });
        }
      } else {
        console.log('[designer] Creating new widget (no widgetId yet)');
        const res = await fetch('/api/v1/sdk-widgets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        console.log('[designer] POST response', { status: res.status, ok: res.ok });
        if (res.ok) {
          const w = await res.json() as Record<string, unknown>;
          console.log('[designer] Widget created', w);
          setWidgetId(w.id as string);
          setSdkId(w.sdkId as string ?? '');
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
        } else {
          const err = await res.text();
          console.error('[designer] POST failed', { status: res.status, body: err });
        }
      }
    } catch (err) {
      console.error('[designer] Publish error', err);
    } finally {
      setSaving(false);
    }
  };

  const handleCopyEmbed = () => {
    navigator.clipboard.writeText(buildEmbedCode(config, sdkId));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Widget Designer</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {sdkId ? (
              <span>SDK ID: <code className="font-mono bg-muted px-1 rounded">{sdkId}</code></span>
            ) : (
              'Configure and publish your chat widget'
            )}
          </p>
        </div>
        <Button onClick={handlePublish} disabled={saving}>
          {saving ? (
            <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
          ) : saved ? (
            <Check className="h-4 w-4 mr-2" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          {saved ? 'Saved' : 'Publish Changes'}
        </Button>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Config tabs */}
        <Tabs defaultValue="appearance">
          <TabsList className="grid grid-cols-3 mb-4">
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
            <TabsTrigger value="behavior">Behavior</TabsTrigger>
            <TabsTrigger value="prechat">Pre-chat</TabsTrigger>
          </TabsList>
          <TabsList className="grid grid-cols-3 mb-4">
            <TabsTrigger value="proactive">Proactive</TabsTrigger>
            <TabsTrigger value="knowledge">Knowledge</TabsTrigger>
            <TabsTrigger value="embed">Embed</TabsTrigger>
          </TabsList>

          {/* Appearance */}
          <TabsContent value="appearance">
            <Card>
              <CardHeader><CardTitle>Appearance</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Primary Color</Label>
                    <div className="flex gap-2">
                      <input
                        type="color"
                        value={config.primaryColor}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => update('primaryColor', e.target.value)}
                        className="h-9 w-12 rounded border cursor-pointer"
                      />
                      <Input
                        value={config.primaryColor}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => update('primaryColor', e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Secondary Color</Label>
                    <div className="flex gap-2">
                      <input
                        type="color"
                        value={config.secondaryColor}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => update('secondaryColor', e.target.value)}
                        className="h-9 w-12 rounded border cursor-pointer"
                      />
                      <Input
                        value={config.secondaryColor}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => update('secondaryColor', e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Theme</Label>
                    <Select value={config.theme} onValueChange={v => update('theme', v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="light">Light</SelectItem>
                        <SelectItem value="dark">Dark</SelectItem>
                        <SelectItem value="auto">Auto</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Position</Label>
                    <Select value={config.position} onValueChange={v => update('position', v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="right">Right</SelectItem>
                        <SelectItem value="left">Left</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Bot Name</Label>
                  <Input value={config.botName} onChange={(e: ChangeEvent<HTMLInputElement>) => update('botName', e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Header Text</Label>
                  <Input value={config.headerText} onChange={(e: ChangeEvent<HTMLInputElement>) => update('headerText', e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Welcome Message</Label>
                  <Input value={config.welcomeMessage} onChange={(e: ChangeEvent<HTMLInputElement>) => update('welcomeMessage', e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Input Placeholder</Label>
                  <Input value={config.inputPlaceholder} onChange={(e: ChangeEvent<HTMLInputElement>) => update('inputPlaceholder', e.target.value)} />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Behavior */}
          <TabsContent value="behavior">
            <Card>
              <CardHeader><CardTitle>Behavior</CardTitle></CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label>Quick Replies (comma-separated)</Label>
                  <Input
                    placeholder="Yes, No, Tell me more"
                    value={config.quickReplies}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => update('quickReplies', e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">Shown as quick-reply chips at the start of the conversation</p>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>File Upload</Label>
                    <p className="text-xs text-muted-foreground">Allow users to attach files</p>
                  </div>
                  <Switch
                    checked={config.fileUploadEnabled}
                    onCheckedChange={v => update('fileUploadEnabled', v)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>CSAT Survey</Label>
                    <p className="text-xs text-muted-foreground">Show satisfaction survey after conversation ends</p>
                  </div>
                  <Switch
                    checked={config.csatEnabled}
                    onCheckedChange={v => update('csatEnabled', v)}
                  />
                </div>
                {config.csatEnabled && (
                  <div className="space-y-2">
                    <Label>CSAT Type</Label>
                    <Select value={config.csatType} onValueChange={v => update('csatType', v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="stars">Stars (1–5)</SelectItem>
                        <SelectItem value="thumbs">Thumbs Up / Down</SelectItem>
                        <SelectItem value="nps">NPS (0–10)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-2">
                  <Label>Allowed Origins (comma-separated)</Label>
                  <Input
                    placeholder="https://example.com, https://app.example.com"
                    value={config.allowedOrigins}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => update('allowedOrigins', e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">Domains allowed to embed this widget. Leave blank to allow all.</p>
                </div>
                <div className="space-y-2">
                  <Label>Agent</Label>
                  <Select value={config.agentId} onValueChange={v => update('agentId', v)}>
                    <SelectTrigger><SelectValue placeholder="Select an agent" /></SelectTrigger>
                    <SelectContent>
                      {agents.map(a => (
                        <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {config.agentId && (
                  <div className="space-y-2">
                    <Label>API Key</Label>
                    <Select value={config.apiKeyId} onValueChange={v => update('apiKeyId', v)}>
                      <SelectTrigger><SelectValue placeholder="Select an API key" /></SelectTrigger>
                      <SelectContent>
                        {apiKeys.map(k => (
                          <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Pre-chat */}
          <TabsContent value="prechat">
            <Card>
              <CardHeader><CardTitle>Pre-chat Form</CardTitle></CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Enable Pre-chat Form</Label>
                    <p className="text-xs text-muted-foreground">Collect user info before the conversation starts</p>
                  </div>
                  <Switch
                    checked={config.preChatEnabled}
                    onCheckedChange={v => update('preChatEnabled', v)}
                  />
                </div>
                {config.preChatEnabled && (
                  <>
                    <div className="space-y-2">
                      <Label>Form Title</Label>
                      <Input
                        value={config.preChatTitle}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => update('preChatTitle', e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Form Subtitle</Label>
                      <Input
                        value={config.preChatSubtitle}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => update('preChatSubtitle', e.target.value)}
                      />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Proactive */}
          <TabsContent value="proactive">
            <Card>
              <CardHeader><CardTitle>Proactive Messaging</CardTitle></CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Enable Proactive Message</Label>
                    <p className="text-xs text-muted-foreground">Automatically open the widget with a message after a delay</p>
                  </div>
                  <Switch
                    checked={config.proactiveEnabled}
                    onCheckedChange={v => update('proactiveEnabled', v)}
                  />
                </div>
                {config.proactiveEnabled && (
                  <>
                    <div className="space-y-2">
                      <Label>Message</Label>
                      <Textarea
                        rows={3}
                        value={config.proactiveMessage}
                        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => update('proactiveMessage', e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Delay (seconds)</Label>
                      <Input
                        type="number"
                        min="1"
                        value={config.proactiveDelay}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => update('proactiveDelay', e.target.value)}
                        className="max-w-[120px]"
                      />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Knowledge Base */}
          <TabsContent value="knowledge">
            <Card>
              <CardHeader><CardTitle>Knowledge Base</CardTitle></CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Enable Knowledge Base</Label>
                    <p className="text-xs text-muted-foreground">Ground responses in your knowledge base documents</p>
                  </div>
                  <Switch
                    checked={config.knowledgeBaseEnabled}
                    onCheckedChange={v => update('knowledgeBaseEnabled', v)}
                  />
                </div>
                {config.knowledgeBaseEnabled && (
                  <div className="space-y-2">
                    <Label>Knowledge Base IDs (comma-separated)</Label>
                    <Input
                      placeholder="kb_abc123, kb_def456"
                      value={config.knowledgeBaseIds}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => update('knowledgeBaseIds', e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">Find IDs in the Knowledge Bases section of the dashboard</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Embed */}
          <TabsContent value="embed">
            <Card>
              <CardHeader><CardTitle>Embed Code</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {sdkId ? (
                  <>
                    <div className="space-y-1">
                      <Label>SDK ID</Label>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 font-mono text-sm bg-muted px-3 py-2 rounded">{sdkId}</code>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => { navigator.clipboard.writeText(sdkId); }}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label>Embed Snippet</Label>
                        <Button variant="outline" size="sm" onClick={handleCopyEmbed}>
                          {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
                          {copied ? 'Copied' : 'Copy'}
                        </Button>
                      </div>
                      <pre className="text-xs bg-muted p-4 rounded-lg overflow-x-auto whitespace-pre-wrap font-mono">
                        {buildEmbedCode(config, sdkId)}
                      </pre>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Publish your widget first to get the SDK ID and embed code.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Right: Live preview */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Live Preview</CardTitle>
            </CardHeader>
            <CardContent>
              {sdkId ? (
                <iframe
                  srcDoc={iframeHtml}
                  className="w-full h-[500px] border rounded-lg"
                  sandbox="allow-scripts allow-same-origin"
                  title="Widget Preview"
                />
              ) : (
                <div className="w-full h-[500px] border rounded-lg flex items-center justify-center text-muted-foreground text-sm">
                  Publish your widget to see the live preview
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
