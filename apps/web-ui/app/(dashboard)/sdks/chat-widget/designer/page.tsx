'use client';

import { useState, useEffect, useCallback, useMemo, type ChangeEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Copy,
  Check,
  Save,
  RefreshCw,
  Plus,
  Trash2,
  Bot,
  MessageSquare,
  Palette,
  Settings,
  Eye,
  Code,
  ChevronRight,
  LayoutTemplate,
  AlertCircle,
  Sparkles,
  X,
  ExternalLink,
} from 'lucide-react';

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

interface Widget {
  id: string;
  name: string;
  sdkId: string;
  agentId: string;
  agent?: { id: string; name: string };
  apiKeyId: string;
  status: string;
  primaryColor: string;
  secondaryColor: string;
  theme: string;
  position: string;
  botName: string;
  headerText: string;
  welcomeMessage: string;
  inputPlaceholder: string;
  fileUpload: boolean;
  csatEnabled: boolean;
  csatType: string;
  kbEnabled: boolean;
  allowedOrigins: string[];
  quickReplies: string[] | null;
  preChatForm: Array<Record<string, unknown>> | null;
  proactiveRules: Array<Record<string, unknown>> | null;
  rateLimitRpm: number;
  customCss?: string;
  createdAt: string;
  updatedAt: string;
}

interface WidgetConfig {
  name: string;
  primaryColor: string;
  secondaryColor: string;
  theme: string;
  position: string;
  botName: string;
  headerText: string;
  welcomeMessage: string;
  inputPlaceholder: string;
  quickReplies: string;
  fileUploadEnabled: boolean;
  csatEnabled: boolean;
  csatType: string;
  allowedOrigins: string;
  preChatEnabled: boolean;
  preChatTitle: string;
  preChatSubtitle: string;
  proactiveEnabled: boolean;
  proactiveMessage: string;
  proactiveDelay: string;
  knowledgeBaseEnabled: boolean;
  knowledgeBaseIds: string;
  agentId: string;
  apiKeyId: string;
}

const DEFAULT_CONFIG: WidgetConfig = {
  name: 'New Widget',
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

function widgetToConfig(widget: Widget): WidgetConfig {
  const preChatArr = Array.isArray(widget.preChatForm) ? widget.preChatForm : [];
  const proactiveArr = Array.isArray(widget.proactiveRules) ? widget.proactiveRules : [];
  return {
    name: widget.name,
    primaryColor: widget.primaryColor,
    secondaryColor: widget.secondaryColor,
    theme: widget.theme,
    position: widget.position,
    botName: widget.botName,
    headerText: widget.headerText,
    welcomeMessage: widget.welcomeMessage,
    inputPlaceholder: widget.inputPlaceholder,
    agentId: widget.agentId,
    apiKeyId: widget.apiKeyId,
    fileUploadEnabled: widget.fileUpload,
    csatEnabled: widget.csatEnabled,
    csatType: widget.csatType,
    knowledgeBaseEnabled: widget.kbEnabled,
    quickReplies: Array.isArray(widget.quickReplies) ? widget.quickReplies.join(', ') : '',
    allowedOrigins: Array.isArray(widget.allowedOrigins) ? widget.allowedOrigins.join(', ') : '',
    preChatEnabled: preChatArr.length > 0,
    preChatTitle: preChatArr.length > 0 ? (preChatArr[0]?.label as string) || 'Start a conversation' : 'Start a conversation',
    preChatSubtitle: preChatArr.length > 0 ? (preChatArr[1]?.label as string) || 'Fill in the form below to get started' : 'Fill in the form below to get started',
    proactiveEnabled: proactiveArr.length > 0,
    proactiveMessage: proactiveArr.length > 0 ? (proactiveArr[0]?.message as string) || 'Hi! Need any help?' : 'Hi! Need any help?',
    proactiveDelay: proactiveArr.length > 0 ? String(Math.round(((proactiveArr[0]?.delay as number) ?? 5000) / 1000)) : '5',
    knowledgeBaseIds: '',
  };
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

export default function DesignerPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlWidgetId = searchParams.get('id');

  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(urlWidgetId);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loadingWidgets, setLoadingWidgets] = useState(true);
  const [loadingAgents, setLoadingAgents] = useState(true);

  const [config, setConfig] = useState<WidgetConfig>(DEFAULT_CONFIG);
  const [widgetId, setWidgetId] = useState('');
  const [sdkId, setSdkId] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [iframeHtml, setIframeHtml] = useState('');
  const [activeTab, setActiveTab] = useState('appearance');

  // Create dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [newWidgetName, setNewWidgetName] = useState('');
  const [newWidgetAgentId, setNewWidgetAgentId] = useState('');
  const [newWidgetApiKeyId, setNewWidgetApiKeyId] = useState('');
  const [newWidgetPrimaryColor, setNewWidgetPrimaryColor] = useState('#2196f3');
  const [creating, setCreating] = useState(false);

  // Delete dialog state
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const selectedWidget = useMemo(() => widgets.find(w => w.id === selectedWidgetId) ?? null, [widgets, selectedWidgetId]);

  // Load widgets on mount
  useEffect(() => {
    setLoadingWidgets(true);
    fetch('/api/v1/sdk-widgets')
      .then(r => r.json())
      .then((data: unknown[]) => {
        const list = Array.isArray(data) ? (data as Widget[]) : [];
        setWidgets(list);
        // If URL has id, select it; otherwise select first if exists
        if (urlWidgetId) {
          const found = list.find(w => w.id === urlWidgetId);
          if (found) setSelectedWidgetId(urlWidgetId);
        } else if (list.length > 0) {
          setSelectedWidgetId(list[0].id);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingWidgets(false));
  }, [urlWidgetId]);

  // Load agents
  useEffect(() => {
    setLoadingAgents(true);
    fetch('/api/agents?pageSize=100')
      .then(r => r.json())
      .then(data => {
        const list: Agent[] = Array.isArray(data) ? data : (data.items ?? []);
        setAgents(list);
      })
      .catch(() => {})
      .finally(() => setLoadingAgents(false));
  }, []);

  // Load API keys when agent changes (for create dialog or selected widget)
  useEffect(() => {
    const agentId = selectedWidget ? selectedWidget.agentId : newWidgetAgentId;
    if (!agentId) {
      setApiKeys([]);
      return;
    }
    fetch(`/api/agents/${agentId}/api-keys`)
      .then(r => r.json())
      .then(data => {
        const list: ApiKey[] = Array.isArray(data) ? data : [];
        setApiKeys(list);
      })
      .catch(() => {});
  }, [selectedWidget, newWidgetAgentId]);

  // When selected widget changes, load its config
  useEffect(() => {
    if (selectedWidget) {
      setWidgetId(selectedWidget.id);
      setSdkId(selectedWidget.sdkId);
      setConfig(widgetToConfig(selectedWidget));
    } else {
      setWidgetId('');
      setSdkId('');
      setConfig(DEFAULT_CONFIG);
    }
  }, [selectedWidget]);

  // Rebuild iframe HTML whenever config or sdkId changes
  useEffect(() => {
    setIframeHtml(buildIframeHtml(config, sdkId));
  }, [config, sdkId]);

  // Update URL when selection changes
  useEffect(() => {
    const currentId = searchParams.get('id');
    if (selectedWidgetId === currentId) return;
    if (selectedWidgetId) {
      const params = new URLSearchParams(searchParams.toString());
      params.set('id', selectedWidgetId);
      router.replace(`/sdks/chat-widget/designer?${params.toString()}`, { scroll: false });
    } else {
      const params = new URLSearchParams(searchParams.toString());
      params.delete('id');
      router.replace(`/sdks/chat-widget/designer?${params.toString()}`, { scroll: false });
    }
  }, [selectedWidgetId, searchParams, router]);

  const update = useCallback(<K extends keyof WidgetConfig>(key: K, value: WidgetConfig[K]) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  }, []);

  const handlePublish = async () => {
    if (!widgetId) return;
    setSaving(true);
    try {
      const preChatForm = config.preChatEnabled
        ? [
            { field: 'name', type: 'text', label: config.preChatTitle, required: true },
            { field: 'email', type: 'email', label: config.preChatSubtitle, required: true },
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
        name: config.name || 'My Widget',
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

      const res = await fetch(`/api/v1/sdk-widgets/${widgetId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      console.log('[designer] PATCH response', { status: res.status, ok: res.ok });
      if (res.ok) {
        const updated = await res.json() as Widget;
        console.log('[designer] Widget updated', updated);
        setWidgets(prev => prev.map(w => (w.id === updated.id ? updated : w)));
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
        setIframeHtml(buildIframeHtml(config, sdkId) + `<!-- refresh:${Date.now()} -->`);
      } else {
        const err = await res.text();
        console.error('[designer] PATCH failed', { status: res.status, body: err });
      }
    } catch (err) {
      console.error('[designer] Publish error', err);
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async () => {
    if (!newWidgetName.trim() || !newWidgetAgentId || !newWidgetApiKeyId) return;
    setCreating(true);
    try {
      const payload = {
        name: newWidgetName.trim(),
        agentId: newWidgetAgentId,
        apiKeyId: newWidgetApiKeyId,
        primaryColor: newWidgetPrimaryColor,
        secondaryColor: '#1976d2',
        theme: 'light',
        position: 'right',
        botName: 'Bot',
        headerText: newWidgetName.trim(),
        welcomeMessage: 'Welcome! How can I help you today?',
        inputPlaceholder: 'Type your message...',
      };
      const res = await fetch('/api/v1/sdk-widgets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const w = await res.json() as Widget;
        setWidgets(prev => [w, ...prev]);
        setSelectedWidgetId(w.id);
        setCreateOpen(false);
        setNewWidgetName('');
        setNewWidgetAgentId('');
        setNewWidgetApiKeyId('');
        setNewWidgetPrimaryColor('#2196f3');
      } else {
        const err = await res.text();
        console.error('[designer] Create failed', { status: res.status, body: err });
      }
    } catch (err) {
      console.error('[designer] Create error', err);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!widgetId) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/sdk-widgets/${widgetId}`, { method: 'DELETE' });
      if (res.ok || res.status === 204) {
        setWidgets(prev => prev.filter(w => w.id !== widgetId));
        const remaining = widgets.filter(w => w.id !== widgetId);
        setSelectedWidgetId(remaining.length > 0 ? remaining[0].id : null);
        setDeleteOpen(false);
      } else {
        console.error('[designer] Delete failed', { status: res.status });
      }
    } catch (err) {
      console.error('[designer] Delete error', err);
    } finally {
      setDeleting(false);
    }
  };

  const handleCopyEmbed = () => {
    navigator.clipboard.writeText(buildEmbedCode(config, sdkId));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopySdkId = () => {
    navigator.clipboard.writeText(sdkId);
  };

  const handleDuplicate = async () => {
    if (!selectedWidget) return;
    setCreating(true);
    try {
      const payload = {
        name: `${selectedWidget.name} (Copy)`,
        agentId: selectedWidget.agentId,
        apiKeyId: selectedWidget.apiKeyId,
        primaryColor: selectedWidget.primaryColor,
        secondaryColor: selectedWidget.secondaryColor,
        theme: selectedWidget.theme,
        position: selectedWidget.position,
        botName: selectedWidget.botName,
        headerText: selectedWidget.headerText,
        welcomeMessage: selectedWidget.welcomeMessage,
        inputPlaceholder: selectedWidget.inputPlaceholder,
        fileUpload: selectedWidget.fileUpload,
        csatEnabled: selectedWidget.csatEnabled,
        csatType: selectedWidget.csatType,
        kbEnabled: selectedWidget.kbEnabled,
        allowedOrigins: selectedWidget.allowedOrigins,
        quickReplies: selectedWidget.quickReplies,
        preChatForm: selectedWidget.preChatForm,
        proactiveRules: selectedWidget.proactiveRules,
      };
      const res = await fetch('/api/v1/sdk-widgets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const w = await res.json() as Widget;
        setWidgets(prev => [w, ...prev]);
        setSelectedWidgetId(w.id);
      }
    } catch (err) {
      console.error('[designer] Duplicate error', err);
    } finally {
      setCreating(false);
    }
  };

  return (
    <TooltipProvider>
      <div className="flex h-[calc(100vh-4rem)] gap-0 overflow-hidden">
        {/* Left sidebar: Widget list */}
        <div className="w-72 flex-shrink-0 border-r bg-sidebar flex flex-col">
          <div className="p-4 border-b">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-sidebar-foreground/70">Widgets</h2>
              <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogTrigger render={<Button size="icon" variant="ghost" className="h-7 w-7" />}>
                  <Plus className="h-4 w-4" />
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Create New Widget</DialogTitle>
                    <DialogDescription>
                      Create a new chat widget for an agent. You can customize it after creation.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4 py-4">
                    <div className="space-y-2">
                      <Label>Widget Name</Label>
                      <Input
                        placeholder="e.g., Website Support Widget"
                        value={newWidgetName}
                        onChange={e => setNewWidgetName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Agent</Label>
                      <Select value={newWidgetAgentId} onValueChange={setNewWidgetAgentId}>
                        <SelectTrigger><SelectValue placeholder="Select an agent" /></SelectTrigger>
                        <SelectContent>
                          {agents.map(a => (
                            <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {newWidgetAgentId && (
                      <div className="space-y-2">
                        <Label>API Key</Label>
                        <Select value={newWidgetApiKeyId} onValueChange={setNewWidgetApiKeyId}>
                          <SelectTrigger><SelectValue placeholder="Select an API key" /></SelectTrigger>
                          <SelectContent>
                            {apiKeys.map(k => (
                              <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <div className="space-y-2">
                      <Label>Primary Color</Label>
                      <div className="flex gap-2">
                        <input
                          type="color"
                          value={newWidgetPrimaryColor}
                          onChange={e => setNewWidgetPrimaryColor(e.target.value)}
                          className="h-9 w-12 rounded border cursor-pointer"
                        />
                        <Input value={newWidgetPrimaryColor} onChange={e => setNewWidgetPrimaryColor(e.target.value)} />
                      </div>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                    <Button
                      onClick={handleCreate}
                      disabled={creating || !newWidgetName.trim() || !newWidgetAgentId || !newWidgetApiKeyId}
                    >
                      {creating ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                      Create Widget
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
            <p className="text-xs text-sidebar-foreground/50">{widgets.length} widget{widgets.length !== 1 ? 's' : ''}</p>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {loadingWidgets ? (
                <>
                  <Skeleton className="h-16 w-full rounded-lg" />
                  <Skeleton className="h-16 w-full rounded-lg" />
                  <Skeleton className="h-16 w-full rounded-lg" />
                </>
              ) : widgets.length === 0 ? (
                <div className="p-4 text-center">
                  <LayoutTemplate className="h-8 w-8 mx-auto mb-2 text-sidebar-foreground/30" />
                  <p className="text-sm text-sidebar-foreground/50">No widgets yet</p>
                  <Button variant="ghost" size="sm" className="mt-2 text-xs" onClick={() => setCreateOpen(true)}>
                    Create your first widget
                  </Button>
                </div>
              ) : (
                widgets.map(widget => {
                  const isActive = selectedWidgetId === widget.id;
                  const agentName = widget.agent?.name ?? 'Unknown Agent';
                  return (
                    <button
                      key={widget.id}
                      onClick={() => setSelectedWidgetId(widget.id)}
                      className={`w-full text-left p-3 rounded-lg transition-all duration-150 group relative ${
                        isActive
                          ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm'
                          : 'hover:bg-sidebar-accent/50 text-sidebar-foreground/80'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <div
                              className="h-3 w-3 rounded-full flex-shrink-0 border"
                              style={{ backgroundColor: widget.primaryColor }}
                            />
                            <span className="font-medium text-sm truncate">{widget.name}</span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-1 text-xs text-sidebar-foreground/50">
                            <Bot className="h-3 w-3" />
                            <span className="truncate">{agentName}</span>
                          </div>
                        </div>
                        <ChevronRight className={`h-4 w-4 flex-shrink-0 transition-transform ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-50'}`} />
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <Badge variant={widget.status === 'active' ? 'default' : 'secondary'} className="text-[10px] h-4 px-1">
                          {widget.status}
                        </Badge>
                        <span className="text-[10px] text-sidebar-foreground/40">{formatDate(widget.updatedAt)}</span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Main editor area */}
        <div className="flex-1 flex flex-col min-w-0 bg-background">
          {!selectedWidget ? (
            <div className="flex-1 flex items-center justify-center">
              <Card className="max-w-md mx-auto">
                <CardContent className="p-8 text-center">
                  <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                    <MessageSquare className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">No Widget Selected</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Select a widget from the sidebar to edit it, or create a new one to get started.
                  </p>
                  <Button onClick={() => setCreateOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Create Widget
                  </Button>
                </CardContent>
              </Card>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="border-b px-6 py-4">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      <h1 className="text-xl font-semibold truncate">{config.name}</h1>
                      <Badge variant="outline" className="font-mono text-xs hidden sm:inline-flex">
                        {sdkId}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Bot className="h-3.5 w-3.5" />
                        {selectedWidget.agent?.name ?? 'Unknown Agent'}
                      </span>
                      <Separator orientation="vertical" className="h-3" />
                      <span>Updated {formatDate(selectedWidget.updatedAt)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Tooltip>
                      <TooltipTrigger render={<Button variant="outline" size="sm" onClick={handleDuplicate} disabled={creating} />}>
                          {creating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
                        </TooltipTrigger>
                      <TooltipContent>Duplicate widget</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger render={<Button variant="outline" size="sm" onClick={() => setDeleteOpen(true)} />}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </TooltipTrigger>
                      <TooltipContent>Delete widget</TooltipContent>
                    </Tooltip>
                    <Button size="sm" onClick={handlePublish} disabled={saving}>
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
                </div>
              </div>

              {/* Content: tabs + preview */}
              <div className="flex-1 flex overflow-hidden">
                <div className="flex-1 min-w-0 overflow-y-auto">
                  <div className="max-w-2xl mx-auto p-6">
                    <Tabs value={activeTab} onValueChange={setActiveTab}>
                      <TabsList className="grid grid-cols-3 mb-6 h-10">
                        <TabsTrigger value="appearance" className="text-xs gap-1.5">
                          <Palette className="h-3.5 w-3.5" /> Appearance
                        </TabsTrigger>
                        <TabsTrigger value="behavior" className="text-xs gap-1.5">
                          <Settings className="h-3.5 w-3.5" /> Behavior
                        </TabsTrigger>
                        <TabsTrigger value="prechat" className="text-xs gap-1.5">
                          <MessageSquare className="h-3.5 w-3.5" /> Pre-chat
                        </TabsTrigger>
                      </TabsList>
                      <TabsList className="grid grid-cols-3 mb-6 h-10">
                        <TabsTrigger value="proactive" className="text-xs gap-1.5">
                          <Sparkles className="h-3.5 w-3.5" /> Proactive
                        </TabsTrigger>
                        <TabsTrigger value="knowledge" className="text-xs gap-1.5">
                          <BookIcon className="h-3.5 w-3.5" /> Knowledge
                        </TabsTrigger>
                        <TabsTrigger value="embed" className="text-xs gap-1.5">
                          <Code className="h-3.5 w-3.5" /> Embed
                        </TabsTrigger>
                      </TabsList>

                      {/* Appearance */}
                      <TabsContent value="appearance" className="space-y-6">
                        <Card>
                          <CardHeader className="pb-3">
                            <CardTitle className="text-base flex items-center gap-2">
                              <Palette className="h-4 w-4 text-primary" />
                              Appearance
                            </CardTitle>
                            <CardDescription>Customize how your widget looks to visitors</CardDescription>
                          </CardHeader>
                          <CardContent className="space-y-5">
                            <div className="grid grid-cols-2 gap-5">
                              <div className="space-y-2">
                                <Label>Primary Color</Label>
                                <div className="flex gap-2">
                                  <input
                                    type="color"
                                    value={config.primaryColor}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => update('primaryColor', e.target.value)}
                                    className="h-9 w-12 rounded border cursor-pointer flex-shrink-0"
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
                                    className="h-9 w-12 rounded border cursor-pointer flex-shrink-0"
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
                            <Separator />
                            <div className="space-y-2">
                              <Label>Widget Name</Label>
                              <Input value={config.name} onChange={(e: ChangeEvent<HTMLInputElement>) => update('name', e.target.value)} />
                              <p className="text-xs text-muted-foreground">Internal name for this widget configuration</p>
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
                      <TabsContent value="behavior" className="space-y-6">
                        <Card>
                          <CardHeader className="pb-3">
                            <CardTitle className="text-base flex items-center gap-2">
                              <Settings className="h-4 w-4 text-primary" />
                              Behavior
                            </CardTitle>
                            <CardDescription>Configure how the widget interacts with users</CardDescription>
                          </CardHeader>
                          <CardContent className="space-y-6">
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
                              <p className="text-xs text-muted-foreground">The AI agent that will handle conversations</p>
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
                            <Separator />
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
                          </CardContent>
                        </Card>
                      </TabsContent>

                      {/* Pre-chat */}
                      <TabsContent value="prechat" className="space-y-6">
                        <Card>
                          <CardHeader className="pb-3">
                            <CardTitle className="text-base flex items-center gap-2">
                              <MessageSquare className="h-4 w-4 text-primary" />
                              Pre-chat Form
                            </CardTitle>
                            <CardDescription>Collect visitor information before starting the chat</CardDescription>
                          </CardHeader>
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
                                <Separator />
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
                      <TabsContent value="proactive" className="space-y-6">
                        <Card>
                          <CardHeader className="pb-3">
                            <CardTitle className="text-base flex items-center gap-2">
                              <Sparkles className="h-4 w-4 text-primary" />
                              Proactive Messaging
                            </CardTitle>
                            <CardDescription>Automatically engage visitors after a delay</CardDescription>
                          </CardHeader>
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
                                <Separator />
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
                      <TabsContent value="knowledge" className="space-y-6">
                        <Card>
                          <CardHeader className="pb-3">
                            <CardTitle className="text-base flex items-center gap-2">
                              <BookIcon className="h-4 w-4 text-primary" />
                              Knowledge Base
                            </CardTitle>
                            <CardDescription>Ground responses in your knowledge base documents</CardDescription>
                          </CardHeader>
                          <CardContent className="space-y-6">
                            <div className="flex items-center justify-between">
                              <div>
                                <Label>Enable Knowledge Base</Label>
                                <p className="text-xs text-muted-foreground">Use documents to improve response quality</p>
                              </div>
                              <Switch
                                checked={config.knowledgeBaseEnabled}
                                onCheckedChange={v => update('knowledgeBaseEnabled', v)}
                              />
                            </div>
                            {config.knowledgeBaseEnabled && (
                              <>
                                <Separator />
                                <div className="space-y-2">
                                  <Label>Knowledge Base IDs (comma-separated)</Label>
                                  <Input
                                    placeholder="kb_abc123, kb_def456"
                                    value={config.knowledgeBaseIds}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => update('knowledgeBaseIds', e.target.value)}
                                  />
                                  <p className="text-xs text-muted-foreground">Find IDs in the Knowledge Bases section of the dashboard</p>
                                </div>
                              </>
                            )}
                          </CardContent>
                        </Card>
                      </TabsContent>

                      {/* Embed */}
                      <TabsContent value="embed" className="space-y-6">
                        <Card>
                          <CardHeader className="pb-3">
                            <CardTitle className="text-base flex items-center gap-2">
                              <Code className="h-4 w-4 text-primary" />
                              Embed Code
                            </CardTitle>
                            <CardDescription>Copy this snippet to embed the widget on your website</CardDescription>
                          </CardHeader>
                          <CardContent className="space-y-5">
                            <div className="space-y-2">
                              <Label>SDK ID</Label>
                              <div className="flex items-center gap-2">
                                <code className="flex-1 font-mono text-sm bg-muted px-3 py-2 rounded border">{sdkId}</code>
                                <Button variant="outline" size="sm" onClick={handleCopySdkId}>
                                  <Copy className="h-4 w-4" />
                                </Button>
                                <a
                                  href={`/sdks/chat-widget/sandbox?id=${widgetId}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center justify-center rounded-lg border border-border bg-background hover:bg-muted text-sm font-medium whitespace-nowrap h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem]"
                                >
                                  <ExternalLink className="h-4 w-4" />
                                </a>
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
                              <pre className="text-xs bg-muted p-4 rounded-lg overflow-x-auto whitespace-pre-wrap font-mono border">
                                {buildEmbedCode(config, sdkId)}
                              </pre>
                            </div>
                          </CardContent>
                        </Card>
                      </TabsContent>
                    </Tabs>
                  </div>
                </div>

                {/* Right preview panel */}
                <div className="w-[420px] flex-shrink-0 border-l bg-muted/30 flex flex-col">
                  <div className="px-4 py-3 border-b bg-background flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Eye className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Live Preview</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="h-2 w-2 rounded-full bg-green-500" />
                      <span className="text-xs text-muted-foreground">Live</span>
                    </div>
                  </div>
                  <div className="flex-1 p-4">
                    {sdkId ? (
                      <div className="h-full bg-white rounded-xl border shadow-sm overflow-hidden relative">
                        <iframe
                          srcDoc={iframeHtml}
                          className="w-full h-full"
                          sandbox="allow-scripts allow-same-origin"
                          title="Widget Preview"
                        />
                      </div>
                    ) : (
                      <div className="h-full bg-white rounded-xl border shadow-sm flex flex-col items-center justify-center p-6 text-center">
                        <AlertCircle className="h-10 w-10 text-muted-foreground/40 mb-3" />
                        <p className="text-sm text-muted-foreground font-medium">No preview available</p>
                        <p className="text-xs text-muted-foreground mt-1">Publish this widget to see the live preview</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-destructive" />
              Delete Widget
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{config.name}</strong>? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}

// Inline icon component for Knowledge tab (not imported from lucide-react to avoid naming conflict)
function BookIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
    </svg>
  );
}
