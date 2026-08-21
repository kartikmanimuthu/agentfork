'use client';

import { AlertTriangle } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { type ApprovalMode, useGrantableTools } from '@/hooks/use-scheduled-tasks';

/**
 * Least-privilege control for unattended runs. Only mutative tools are listed —
 * read-only tools never hit the approval gate, so showing them would be noise.
 */
export function ToolGrantPicker({
  mode,
  allowedTools,
  onModeChange,
  onAllowedToolsChange,
}: {
  mode: ApprovalMode;
  allowedTools: string[];
  onModeChange: (mode: ApprovalMode) => void;
  onAllowedToolsChange: (tools: string[]) => void;
}) {
  const { data, isLoading } = useGrantableTools();

  const toggle = (name: string, checked: boolean) => {
    onAllowedToolsChange(
      checked ? [...new Set([...allowedTools, name])] : allowedTools.filter((t) => t !== name),
    );
  };

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div>
        <p className="text-sm font-medium">Allowed without asking</p>
        <p className="text-xs text-muted-foreground">
          This runs on schedule with nobody watching. Anything not listed here pauses the run
          and notifies you.
        </p>
      </div>

      <RadioGroup
        value={mode}
        onValueChange={(next) => onModeChange(next as ApprovalMode)}
        data-testid="task-approval-mode"
      >
        <div className="flex items-center gap-2">
          <RadioGroupItem value="ask" id="approval-ask" />
          <Label htmlFor="approval-ask" className="text-sm font-normal">
            Ask me for everything
            <span className="ml-1.5 text-xs text-muted-foreground">(default)</span>
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem value="allowlist" id="approval-allowlist" />
          <Label htmlFor="approval-allowlist" className="text-sm font-normal">
            Allow only what&apos;s checked below
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem value="all" id="approval-all" />
          <Label htmlFor="approval-all" className="flex items-center gap-1.5 text-sm font-normal">
            Allow everything
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <AlertTriangle className="h-3 w-3" /> unattended, no prompts
            </span>
          </Label>
        </div>
      </RadioGroup>

      <div
        className={cn(
          'space-y-3 border-t pt-3 transition-opacity',
          mode !== 'allowlist' && 'pointer-events-none opacity-40',
        )}
      >
        {isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : !data?.length ? (
          <p className="text-xs text-muted-foreground">
            No tools that change anything are connected yet.
          </p>
        ) : (
          data.map((group) => (
            <div key={group.source} className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.displayName}
              </p>
              {group.tools.map((tool) => (
                <div key={tool.name} className="flex items-start gap-2">
                  <Checkbox
                    id={`grant-${tool.name}`}
                    className="mt-0.5"
                    checked={allowedTools.includes(tool.name)}
                    onCheckedChange={(checked) => toggle(tool.name, checked === true)}
                    disabled={mode !== 'allowlist'}
                  />
                  <Label htmlFor={`grant-${tool.name}`} className="font-normal leading-tight">
                    <span className="text-sm">{friendlyName(tool.name, group.source)}</span>
                    <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                      {tool.name}
                    </span>
                  </Label>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/** `gmail_send_message` → `Send message`. The raw name is shown alongside anyway. */
function friendlyName(toolName: string, source: string): string {
  const withoutPrefix = toolName.startsWith(`${source}_`)
    ? toolName.slice(source.length + 1)
    : toolName;
  const words = withoutPrefix.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
