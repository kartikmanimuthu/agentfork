'use client';

import { useRef, useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { McpServerNodeConfig } from '@chatbot/agent-studio';
import { useMcpServers } from '@/hooks/use-mcp-servers';
import { useMcpServerTools } from '@/hooks/use-mcp-server-tools';

const schema = z.object({
  serverId: z.string().min(1, 'Server is required'),
  toolMode: z.enum(['single', 'selected', 'all']),
  toolName: z.string().optional(),
  argumentSource: z.enum(['from_state', 'static']),
  staticArguments: z.string().optional(),
  channelMappings: z.string().optional(),
  outputChannel: z.string().min(1, 'Output channel is required'),
});

type McpFormValues = z.infer<typeof schema>;

interface McpServerNodeFormProps {
  config: McpServerNodeConfig;
  onChange: (config: McpServerNodeConfig) => void;
}

export function McpServerNodeForm({ config, onChange }: McpServerNodeFormProps) {
  const { data: mcpData, isLoading: mcpLoading } = useMcpServers({ pageSize: 100 });
  const servers = mcpData?.items ?? [];

  const serverNameRef = useRef<string>(config.serverName ?? '');
  const [currentServerId, setCurrentServerId] = useState<string>(config.serverId ?? '');

  // Use ref + state so onSubmit always reads the latest value
  const selectedToolNamesRef = useRef<string[]>(config.toolNames ?? []);
  const [selectedToolNames, setSelectedToolNames] = useState<string[]>(config.toolNames ?? []);

  const { data: toolsData, isLoading: toolsLoading } = useMcpServerTools(currentServerId);
  const discoveredTools = toolsData?.tools ?? [];

  const form = useForm({
    defaultValues: {
      serverId: config.serverId ?? '',
      toolMode: (config.toolMode ?? 'single') as McpFormValues['toolMode'],
      toolName: config.toolName ?? '',
      argumentSource: config.argumentSource ?? 'from_state',
      staticArguments: config.staticArguments ? JSON.stringify(config.staticArguments, null, 2) : '',
      channelMappings: config.channelMappings ? JSON.stringify(config.channelMappings, null, 2) : '',
      outputChannel: config.outputChannel ?? 'mcp_result',
    } as McpFormValues,
    validators: { onChange: schema },
    onSubmit: ({ value }) => {
      let staticArgs: Record<string, unknown> | undefined;
      if (value.argumentSource === 'static' && value.staticArguments) {
        try { staticArgs = JSON.parse(value.staticArguments); } catch { staticArgs = undefined; }
      }
      let mappings: Record<string, string> | undefined;
      if (value.argumentSource === 'from_state' && value.channelMappings) {
        try { mappings = JSON.parse(value.channelMappings); } catch { mappings = undefined; }
      }
      onChange({
        type: 'mcp_server',
        serverId: value.serverId,
        serverName: serverNameRef.current || undefined,
        toolMode: value.toolMode,
        toolName: value.toolMode === 'single' ? (value.toolName || undefined) : undefined,
        toolNames: value.toolMode === 'selected' ? selectedToolNamesRef.current : undefined,
        argumentSource: value.argumentSource,
        staticArguments: staticArgs,
        channelMappings: mappings,
        outputChannel: value.outputChannel,
      });
    },
  });

  const handleBlur = () => form.handleSubmit();

  const toggleTool = (toolName: string, checked: boolean) => {
    const next = checked
      ? [...selectedToolNamesRef.current, toolName]
      : selectedToolNamesRef.current.filter((t) => t !== toolName);
    selectedToolNamesRef.current = next;
    setSelectedToolNames(next);
    form.handleSubmit();
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
      className="space-y-4"
    >
      {/* MCP Server */}
      <form.Field name="serverId">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>MCP Server</Label>
            <Select
              value={field.state.value}
              onValueChange={(v) => {
                const server = servers.find((s) => s.id === v);
                serverNameRef.current = server?.name ?? '';
                setCurrentServerId(v);
                selectedToolNamesRef.current = [];
                setSelectedToolNames([]);
                field.handleChange(v);
                handleBlur();
              }}
              disabled={mcpLoading}
            >
              <SelectTrigger id={field.name} aria-label="MCP Server">
                <SelectValue placeholder={mcpLoading ? 'Loading...' : 'Select a server'} />
              </SelectTrigger>
              <SelectContent>
                {servers.length === 0 && !mcpLoading && (
                  <SelectItem value="__empty__" disabled>No servers configured</SelectItem>
                )}
                {servers.map((server) => (
                  <SelectItem key={server.id} value={server.id}>
                    {server.name}
                    {server.status !== 'active' && (
                      <span className="ml-1 text-xs text-muted-foreground">({server.status})</span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {field.state.meta.errors.length > 0 && (
              <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
            )}
          </div>
        )}
      </form.Field>

      {/* Tool Mode */}
      <form.Field name="toolMode">
        {(field) => (
          <div className="grid gap-1.5">
            <Label>Tool Mode</Label>
            <Select
              value={field.state.value}
              onValueChange={(v) => {
                field.handleChange(v as McpFormValues['toolMode']);
                handleBlur();
              }}
            >
              <SelectTrigger aria-label="Tool mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="single">Single — call one specific tool</SelectItem>
                <SelectItem value="selected">Selected — call chosen tools</SelectItem>
                <SelectItem value="all">All — call every tool (max 20)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </form.Field>

      {/* Tool selector — depends on mode */}
      <form.Field name="toolMode">
        {(modeField) => {
          const mode = modeField.state.value;

          if (mode === 'single') {
            if (discoveredTools.length > 0) {
              return (
                <form.Field name="toolName">
                  {(field) => (
                    <div className="grid gap-1.5">
                      <Label>Tool Name</Label>
                      <Select
                        value={field.state.value ?? ''}
                        onValueChange={(v) => {
                          field.handleChange(v);
                          handleBlur();
                        }}
                      >
                        <SelectTrigger aria-label="Tool name">
                          <SelectValue placeholder="Select a tool" />
                        </SelectTrigger>
                        <SelectContent>
                          {discoveredTools.map((t) => (
                            <SelectItem key={t.name} value={t.name}>
                              <span className="font-mono text-xs">{t.name}</span>
                              {t.description && (
                                <span className="ml-2 text-xs text-muted-foreground">
                                  — {t.description.length > 40 ? `${t.description.slice(0, 40)}…` : t.description}
                                </span>
                              )}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </form.Field>
              );
            }

            // Fallback: text input when discovery failed or no server selected
            return (
              <form.Field name="toolName">
                {(field) => (
                  <div className="grid gap-1.5">
                    <Label htmlFor={field.name}>Tool Name</Label>
                    <Input
                      id={field.name}
                      value={field.state.value ?? ''}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={() => { field.handleBlur(); handleBlur(); }}
                      placeholder="tool_name"
                      disabled={toolsLoading}
                    />
                    {toolsLoading && (
                      <p className="text-xs text-muted-foreground">Discovering tools…</p>
                    )}
                    {!toolsLoading && toolsData?.error && (
                      <p className="text-xs text-muted-foreground">{toolsData.error} — enter tool name manually</p>
                    )}
                  </div>
                )}
              </form.Field>
            );
          }

          if (mode === 'selected') {
            return (
              <div className="grid gap-1.5">
                <Label>Select Tools</Label>
                {toolsLoading && (
                  <p className="text-xs text-muted-foreground">Discovering tools…</p>
                )}
                {!toolsLoading && discoveredTools.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    {currentServerId
                      ? (toolsData?.error ?? 'No tools discovered from this server')
                      : 'Select a server first'}
                  </p>
                )}
                {discoveredTools.length > 0 && (
                  <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border p-2">
                    {discoveredTools.map((t) => (
                      <div key={t.name} className="flex items-start gap-2">
                        <Checkbox
                          id={`tool-${t.name}`}
                          checked={selectedToolNames.includes(t.name)}
                          onCheckedChange={(checked) => toggleTool(t.name, Boolean(checked))}
                        />
                        <div className="grid gap-0.5">
                          <label
                            htmlFor={`tool-${t.name}`}
                            className="cursor-pointer font-mono text-xs font-medium leading-none"
                          >
                            {t.name}
                          </label>
                          {t.description && (
                            <p className="text-xs text-muted-foreground">{t.description}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {selectedToolNames.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {selectedToolNames.map((n) => (
                      <Badge key={n} variant="secondary" className="font-mono text-xs">
                        {n}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            );
          }

          // all mode
          return (
            <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
              All tools exposed by this server will be called in sequence. Capped at 20 tools.
            </div>
          );
        }}
      </form.Field>

      {/* Argument Source */}
      <form.Field name="argumentSource">
        {(field) => (
          <div className="grid gap-1.5">
            <Label>Argument Source</Label>
            <Select
              value={field.state.value}
              onValueChange={(v) => {
                field.handleChange(v as McpFormValues['argumentSource']);
                handleBlur();
              }}
            >
              <SelectTrigger aria-label="Argument source">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="from_state">From State Channels</SelectItem>
                <SelectItem value="static">Static Arguments</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </form.Field>

      <form.Field name="argumentSource">
        {(argField) =>
          argField.state.value === 'static' ? (
            <form.Field name="staticArguments">
              {(field) => (
                <div className="grid gap-1.5">
                  <Label htmlFor={field.name}>Static Arguments (JSON)</Label>
                  <Textarea
                    id={field.name}
                    value={field.state.value ?? ''}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={() => { field.handleBlur(); handleBlur(); }}
                    placeholder='{"key": "value"}'
                    rows={4}
                    className="font-mono text-xs"
                  />
                </div>
              )}
            </form.Field>
          ) : (
            <form.Field name="channelMappings">
              {(field) => (
                <div className="grid gap-1.5">
                  <Label htmlFor={field.name}>Channel Mappings (JSON)</Label>
                  <Textarea
                    id={field.name}
                    value={field.state.value ?? ''}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={() => { field.handleBlur(); handleBlur(); }}
                    placeholder='{"param": "channel_name"}'
                    rows={4}
                    className="font-mono text-xs"
                  />
                </div>
              )}
            </form.Field>
          )
        }
      </form.Field>

      {/* Output Channel */}
      <form.Field name="outputChannel">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Output Channel</Label>
            <Input
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={() => { field.handleBlur(); handleBlur(); }}
              placeholder="mcp_result"
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
            )}
          </div>
        )}
      </form.Field>
    </form>
  );
}
