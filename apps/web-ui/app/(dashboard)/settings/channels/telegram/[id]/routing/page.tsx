'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { TelegramIcon } from '@/components/icons/telegram-icon';
import { ArrowLeft, Save, Plus, Trash2 } from 'lucide-react';

interface RoutingRule {
  id: string;
  agentId: string;
  priority: number;
  condition: Record<string, unknown>;
  isActive: boolean;
}

interface RoutingConfig {
  id: string;
  strategy: string;
  config: Record<string, unknown>;
  fallbackAgentId: string | null;
  rules: RoutingRule[];
}

interface Agent {
  id: string;
  name: string;
}

export default function TelegramRoutingPage({ params }: { params: Promise<{ id: string }> }) {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [routing, setRouting] = useState<RoutingConfig | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    params.then(({ id }) => {
      setAccountId(id);
      fetchRouting(id);
      fetchAgents();
    });
  }, [params]);

  const fetchRouting = async (id: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/telegram/accounts/${id}/routing`);
      if (!res.ok) throw new Error('Failed to load routing');
      const data = await res.json();
      setRouting(data ?? { id: '', strategy: 'keyword', config: {}, fallbackAgentId: null, rules: [] });
    } catch {
      toast.error('Failed to load routing configuration');
    } finally {
      setLoading(false);
    }
  };

  const fetchAgents = async () => {
    try {
      const res = await fetch('/api/agents?pageSize=100');
      if (!res.ok) throw new Error('Failed to load agents');
      const data = await res.json();
      setAgents(data.items ?? []);
    } catch {
      toast.error('Failed to load agents');
    }
  };

  const handleSave = async () => {
    if (!accountId || !routing) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/telegram/accounts/${accountId}/routing`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategy: routing.strategy,
          config: routing.config,
          fallbackAgentId: routing.fallbackAgentId,
          rules: routing.rules,
        }),
      });
      if (!res.ok) throw new Error('Failed to save');
      toast.success('Routing configuration saved');
    } catch {
      toast.error('Failed to save routing configuration');
    } finally {
      setSaving(false);
    }
  };

  const addRule = () => {
    if (!routing) return;
    const newRule: RoutingRule = {
      id: `temp-${Date.now()}`,
      agentId: agents[0]?.id ?? '',
      priority: routing.rules.length,
      condition: { type: 'keyword', value: '' },
      isActive: true,
    };
    setRouting({ ...routing, rules: [...routing.rules, newRule] });
  };

  const updateRule = (index: number, updates: Partial<RoutingRule>) => {
    if (!routing) return;
    const rules = [...routing.rules];
    rules[index] = { ...rules[index], ...updates };
    setRouting({ ...routing, rules });
  };

  const removeRule = (index: number) => {
    if (!routing) return;
    const rules = routing.rules.filter((_, i) => i !== index);
    setRouting({ ...routing, rules });
  };

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6 bg-background">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-500/10 text-sky-500">
            <TelegramIcon className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Routing Configuration</h2>
            <p className="text-sm text-muted-foreground">Configure how incoming Telegram messages are routed to agents.</p>
          </div>
        </div>
        <Link href="/settings/channels/telegram">
          <Button variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Channels
          </Button>
        </Link>
      </div>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : routing ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Strategy & Fallback</CardTitle>
              <CardDescription>Choose how messages are routed when no rule matches.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="strategy">Routing Strategy</Label>
                  <Select
                    value={routing.strategy}
                    onValueChange={(value) => setRouting({ ...routing, strategy: value })}
                  >
                    <SelectTrigger id="strategy">
                      <SelectValue placeholder="Select strategy" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="keyword">Keyword</SelectItem>
                      <SelectItem value="menu">Menu</SelectItem>
                      <SelectItem value="time_based">Time Based</SelectItem>
                      <SelectItem value="ai_intent">AI Intent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fallback">Fallback Agent</Label>
                  <Select
                    value={routing.fallbackAgentId ?? '__none__'}
                    onValueChange={(value) => setRouting({ ...routing, fallbackAgentId: value === '__none__' ? null : value })}
                  >
                    <SelectTrigger id="fallback">
                      <SelectValue placeholder="Select fallback agent" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None</SelectItem>
                      {agents.map((agent) => (
                        <SelectItem key={agent.id} value={agent.id}>
                          {agent.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <div>
                <CardTitle>Routing Rules</CardTitle>
                <CardDescription>Define rules for matching incoming messages to agents.</CardDescription>
              </div>
              <Button onClick={addRule}>
                <Plus className="mr-2 h-4 w-4" />
                Add Rule
              </Button>
            </CardHeader>
            <CardContent>
              {routing.rules.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No rules configured. Messages will go to the fallback agent.
                </p>
              ) : (
                <div className="space-y-4">
                  {routing.rules.map((rule, index) => (
                    <div key={rule.id} className="flex items-start gap-4 rounded-lg border p-4">
                      <div className="flex-1 grid gap-4 md:grid-cols-4">
                        <div className="space-y-2">
                          <Label>Priority</Label>
                          <Input
                            type="number"
                            value={rule.priority}
                            onChange={(e) => updateRule(index, { priority: parseInt(e.target.value) || 0 })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Agent</Label>
                          <Select
                            value={rule.agentId}
                            onValueChange={(value) => updateRule(index, { agentId: value })}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select agent" />
                            </SelectTrigger>
                            <SelectContent>
                              {agents.map((agent) => (
                                <SelectItem key={agent.id} value={agent.id}>
                                  {agent.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Condition</Label>
                          <Input
                            value={JSON.stringify(rule.condition)}
                            onChange={(e) => {
                              try {
                                const parsed = JSON.parse(e.target.value);
                                updateRule(index, { condition: parsed });
                              } catch {
                                // ignore invalid JSON while typing
                              }
                            }}
                            placeholder='{"type":"keyword","value":"sales"}'
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Active</Label>
                          <div className="flex items-center h-9">
                            <Switch
                              checked={rule.isActive}
                              onCheckedChange={(checked) => updateRule(index, { isActive: checked })}
                            />
                          </div>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive shrink-0 mt-6"
                        onClick={() => removeRule(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={saving}>
              <Save className="mr-2 h-4 w-4" />
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">No routing configuration found.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
