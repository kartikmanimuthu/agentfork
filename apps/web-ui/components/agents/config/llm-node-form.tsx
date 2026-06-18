'use client';

import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { ProviderModelSelect } from '@/components/llm-providers/provider-model-select';
import type { LlmNodeConfig } from '@chatbot/agent-studio';
import { BUILT_IN_TOOLS, BUILT_IN_TOOL_NAMES } from './built-in-tools';

const schema = z.object({
  model: z.string().min(1, 'Model is required'),
  systemPrompt: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
});

type LlmFormValues = z.infer<typeof schema>;

interface LlmNodeFormProps {
  config: LlmNodeConfig;
  onChange: (config: LlmNodeConfig) => void;
}

export function LlmNodeForm({ config, onChange }: LlmNodeFormProps) {
  // Preserve any non-built-in tool names already wired into this node.
  const [enabledBuiltIns, setEnabledBuiltIns] = useState<string[]>(
    (config.tools ?? []).filter((t) => BUILT_IN_TOOL_NAMES.includes(t)),
  );

  const form = useForm({
    defaultValues: {
      model: config.model ?? '',
      systemPrompt: config.systemPrompt ?? '',
      temperature: config.temperature ?? 0.7,
      maxTokens: config.maxTokens,
    } as LlmFormValues,
    validators: { onChange: schema },
    onSubmit: ({ value }) => {
      const nonBuiltInTools = (config.tools ?? []).filter((t) => !BUILT_IN_TOOL_NAMES.includes(t));
      const tools = [...nonBuiltInTools, ...enabledBuiltIns];
      onChange({
        type: 'llm',
        model: value.model,
        systemPrompt: value.systemPrompt || undefined,
        temperature: value.temperature,
        maxTokens: value.maxTokens || undefined,
        tools: tools.length > 0 ? tools : undefined,
      });
    },
  });

  const handleBlur = () => form.handleSubmit();

  const toggleBuiltIn = (name: string, enabled: boolean) => {
    setEnabledBuiltIns((prev) => {
      const next = enabled ? [...new Set([...prev, name])] : prev.filter((t) => t !== name);
      // Persist immediately so the change is saved without needing another field blur.
      const nonBuiltInTools = (config.tools ?? []).filter((t) => !BUILT_IN_TOOL_NAMES.includes(t));
      const tools = [...nonBuiltInTools, ...next];
      onChange({
        type: 'llm',
        model: form.state.values.model,
        systemPrompt: form.state.values.systemPrompt || undefined,
        temperature: form.state.values.temperature,
        maxTokens: form.state.values.maxTokens || undefined,
        tools: tools.length > 0 ? tools : undefined,
      });
      return next;
    });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
      className="space-y-4"
    >
      <form.Field name="model">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Model</Label>
            <ProviderModelSelect
              capability="chat"
              value={field.state.value ?? ''}
              onChange={(v) => { field.handleChange(v); handleBlur(); }}
              placeholder="Select a model"
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
            )}
          </div>
        )}
      </form.Field>

      <form.Field name="systemPrompt">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>System Prompt</Label>
            <Textarea
              id={field.name}
              value={field.state.value ?? ''}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={() => { field.handleBlur(); handleBlur(); }}
              placeholder="You are a helpful assistant..."
              rows={4}
            />
          </div>
        )}
      </form.Field>

      <form.Field name="temperature">
        {(field) => (
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <Label>Temperature</Label>
              <span className="text-xs text-muted-foreground">{field.state.value ?? 0.7}</span>
            </div>
            <Slider
              min={0}
              max={2}
              step={0.1}
              value={[field.state.value ?? 0.7]}
              onValueChange={(vals) => {
                const v = Array.isArray(vals) ? vals[0] : (vals as number);
                field.handleChange(v);
                handleBlur();
              }}
            />
          </div>
        )}
      </form.Field>

      <form.Field name="maxTokens">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Max Tokens</Label>
            <Input
              id={field.name}
              type="number"
              min={1}
              value={field.state.value ?? ''}
              onChange={(e) => field.handleChange(e.target.value ? Number(e.target.value) : undefined)}
              onBlur={() => { field.handleBlur(); handleBlur(); }}
              placeholder="Leave blank for default"
            />
          </div>
        )}
      </form.Field>

      <div className="grid gap-3">
        <div>
          <Label>Tools</Label>
          <p className="text-xs text-muted-foreground">
            Built-in tools this node can call during agentic loops.
          </p>
        </div>
        {BUILT_IN_TOOLS.map((tool) => {
          const checked = enabledBuiltIns.includes(tool.name);
          return (
            <div key={tool.name} className="flex items-center justify-between gap-4 rounded-md border p-3">
              <div className="grid gap-0.5">
                <Label htmlFor={`llm-tool-${tool.name}`} className="cursor-pointer">
                  {tool.label}
                </Label>
                <p className="text-xs text-muted-foreground">{tool.description}</p>
              </div>
              <Switch
                id={`llm-tool-${tool.name}`}
                checked={checked}
                onCheckedChange={(v) => toggleBuiltIn(tool.name, v)}
              />
            </div>
          );
        })}
      </div>
    </form>
  );
}
