'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Play } from 'lucide-react';
import { PlaygroundVersionSelector } from './version-selector';

interface ConsoleConfigProps {
  agentId: string;
  versionValue: string;
  onVersionChange: (value: string) => void;
  model: string;
  onModelChange: (value: string) => void;
  systemPrompt: string;
  onSystemPromptChange: (value: string) => void;
  temperature: number;
  onTemperatureChange: (value: number) => void;
  maxTokens: number | undefined;
  onMaxTokensChange: (value: number | undefined) => void;
  onApplyOverrides: () => void;
}

export function ConsoleConfig({
  agentId,
  versionValue,
  onVersionChange,
  model,
  onModelChange,
  systemPrompt,
  onSystemPromptChange,
  temperature,
  onTemperatureChange,
  maxTokens,
  onMaxTokensChange,
  onApplyOverrides,
}: ConsoleConfigProps) {
  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-5">
        {/* Version */}
        <div className="space-y-2">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Version
          </label>
          <PlaygroundVersionSelector
            agentId={agentId}
            value={versionValue}
            onChange={onVersionChange}
          />
        </div>

        <Separator />

        {/* Model */}
        <div className="space-y-2">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Model
          </label>
          <Input
            value={model}
            onChange={(e) => onModelChange(e.target.value)}
            placeholder="Override model..."
            className="h-8 text-xs font-mono"
          />
        </div>

        {/* System Prompt */}
        <div className="space-y-2">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            System Prompt
          </label>
          <Textarea
            value={systemPrompt}
            onChange={(e) => onSystemPromptChange(e.target.value)}
            placeholder="Override system prompt..."
            rows={4}
            className="text-xs resize-none font-mono"
          />
        </div>

        {/* Temperature */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Temperature
            </label>
            <span className="text-xs font-mono text-muted-foreground">{temperature}</span>
          </div>
          <input
            type="range"
            min={0}
            max={2}
            step={0.1}
            value={temperature}
            onChange={(e) => onTemperatureChange(parseFloat(e.target.value))}
            className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>Precise</span>
            <span>Creative</span>
          </div>
        </div>

        {/* Max Tokens */}
        <div className="space-y-2">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Max Tokens
          </label>
          <Input
            type="number"
            value={maxTokens ?? ''}
            onChange={(e) => {
              const val = e.target.value;
              onMaxTokensChange(val ? parseInt(val, 10) : undefined);
            }}
            placeholder="Default (no limit)"
            className="h-8 text-xs font-mono"
          />
        </div>

        <Separator />

        <Button size="sm" className="w-full" onClick={onApplyOverrides}>
          <Play className="h-3.5 w-3.5 mr-1.5" />
          Apply Overrides
        </Button>
      </div>
    </ScrollArea>
  );
}
