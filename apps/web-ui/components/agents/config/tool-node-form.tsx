'use client';

import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect, NativeSelectOption, NativeSelectOptGroup } from '@/components/ui/native-select';
import type { ToolNodeConfig } from '@chatbot/agent-studio';
import { BUILT_IN_TOOLS, BUILT_IN_TOOL_NAMES } from './built-in-tools';

const CUSTOM = '__custom__';

const schema = z.object({
  toolName: z.string().min(1, 'Tool name is required'),
});

interface ToolNodeFormProps {
  config: ToolNodeConfig;
  onChange: (config: ToolNodeConfig) => void;
}

export function ToolNodeForm({ config, onChange }: ToolNodeFormProps) {
  const isBuiltIn = config.toolName ? BUILT_IN_TOOL_NAMES.includes(config.toolName) : false;
  const [selection, setSelection] = useState<string>(
    config.toolName ? (isBuiltIn ? config.toolName : CUSTOM) : '',
  );
  const [paramsText, setParamsText] = useState<string>(
    config.parameters ? JSON.stringify(config.parameters, null, 2) : '',
  );
  const [paramsError, setParamsError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: {
      toolName: config.toolName ?? '',
    },
    validators: { onChange: schema },
    onSubmit: ({ value }) => {
      let parameters: Record<string, unknown> | undefined;
      if (paramsText.trim()) {
        try {
          parameters = JSON.parse(paramsText) as Record<string, unknown>;
          setParamsError(null);
        } catch {
          setParamsError('Parameters must be valid JSON');
          return;
        }
      }
      onChange({ type: 'tool', toolName: value.toolName, parameters });
    },
  });

  const handleBlur = () => form.handleSubmit();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
      className="space-y-4"
    >
      <form.Field name="toolName">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor="tool-select">Tool</Label>
            <NativeSelect
              id="tool-select"
              className="w-full"
              value={selection}
              onChange={(e) => {
                const v = e.target.value;
                setSelection(v);
                if (v === CUSTOM) {
                  // Switching to custom: clear a previously-selected built-in name.
                  if (BUILT_IN_TOOL_NAMES.includes(field.state.value)) field.handleChange('');
                } else {
                  field.handleChange(v);
                  handleBlur();
                }
              }}
            >
              <NativeSelectOption value="" disabled>
                Select a tool…
              </NativeSelectOption>
              <NativeSelectOptGroup label="Built-in">
                {BUILT_IN_TOOLS.map((tool) => (
                  <NativeSelectOption key={tool.name} value={tool.name}>
                    {tool.label}
                  </NativeSelectOption>
                ))}
              </NativeSelectOptGroup>
              <NativeSelectOptGroup label="Other">
                <NativeSelectOption value={CUSTOM}>Custom / MCP tool…</NativeSelectOption>
              </NativeSelectOptGroup>
            </NativeSelect>

            {selection === CUSTOM && (
              <Input
                id={field.name}
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={() => { field.handleBlur(); handleBlur(); }}
                placeholder="Enter MCP tool name"
                className="mt-1.5"
              />
            )}

            {field.state.meta.errors.length > 0 && (
              <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
            )}
          </div>
        )}
      </form.Field>

      <div className="grid gap-1.5">
        <Label htmlFor="tool-parameters">Parameters (JSON, optional)</Label>
        <Textarea
          id="tool-parameters"
          value={paramsText}
          onChange={(e) => setParamsText(e.target.value)}
          onBlur={handleBlur}
          placeholder={'{\n  "query": "latest AI news"\n}'}
          rows={5}
          className="font-mono text-xs"
        />
        {paramsError && <p className="text-xs text-destructive">{paramsError}</p>}
      </div>
    </form>
  );
}
