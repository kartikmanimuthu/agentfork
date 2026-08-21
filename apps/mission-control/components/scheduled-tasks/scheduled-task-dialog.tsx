'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  type ApprovalMode, type DeliveryChannel, type ScheduledTaskDTO, type SessionMode,
  type TaskDraft, useCreateScheduledTask, useUpdateScheduledTask,
} from '@/hooks/use-scheduled-tasks';
import { CronPicker } from './cron-picker';
import { ToolGrantPicker } from './tool-grant-picker';

const DEFAULT_CRON = '0 9 * * *';

interface FormState {
  name: string;
  prompt: string;
  scheduleType: 'cron' | 'interval' | 'once';
  cronExpression: string;
  intervalMinutes: number;
  runAt: string;
  timezone: string;
  sessionMode: SessionMode;
  approvalMode: ApprovalMode;
  allowedTools: string[];
  deliveryType: DeliveryChannel;
  deliveryTarget: string;
}

function initialState(task?: ScheduledTaskDTO, draft?: TaskDraft): FormState {
  if (task) {
    return {
      name: task.name,
      prompt: task.prompt,
      scheduleType: task.scheduleType,
      cronExpression: task.cronExpression || DEFAULT_CRON,
      intervalMinutes: task.intervalMinutes ?? 60,
      runAt: task.runAt ? task.runAt.slice(0, 16) : '',
      timezone: task.timezone,
      sessionMode: task.sessionMode,
      approvalMode: task.approvalMode,
      allowedTools: task.allowedTools,
      deliveryType: task.delivery?.type ?? 'none',
      deliveryTarget: task.delivery?.target ?? '',
    };
  }
  return {
    name: draft?.name ?? '',
    prompt: draft?.prompt ?? '',
    scheduleType: 'cron',
    cronExpression: draft?.suggestedCron ?? DEFAULT_CRON,
    intervalMinutes: 60,
    runAt: '',
    timezone: 'Asia/Kolkata',
    sessionMode: 'isolated',
    // A draft distilled from chat already knows which tools the conversation used,
    // so pre-select allowlist rather than making the user re-derive it.
    approvalMode: draft?.suggestedTools?.length ? 'allowlist' : 'ask',
    allowedTools: draft?.suggestedTools ?? [],
    deliveryType: 'none',
    deliveryTarget: '',
  };
}

export function ScheduledTaskDialog({
  open,
  onOpenChange,
  task,
  draft,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  task?: ScheduledTaskDTO;
  draft?: TaskDraft;
}) {
  const [form, setForm] = useState<FormState>(() => initialState(task, draft));
  const create = useCreateScheduledTask();
  const update = useUpdateScheduledTask();
  const saving = create.isPending || update.isPending;

  useEffect(() => {
    if (open) setForm(initialState(task, draft));
  }, [open, task, draft]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const onSubmit = async () => {
    if (!form.name.trim() || !form.prompt.trim()) {
      toast.error('Name and prompt are both required');
      return;
    }
    const payload = {
      name: form.name.trim(),
      prompt: form.prompt.trim(),
      scheduleType: form.scheduleType,
      cronExpression: form.scheduleType === 'cron' ? form.cronExpression : '',
      intervalMinutes: form.scheduleType === 'interval' ? form.intervalMinutes : null,
      runAt: form.scheduleType === 'once' && form.runAt ? new Date(form.runAt).toISOString() : null,
      timezone: form.timezone,
      sessionMode: form.sessionMode,
      approvalMode: form.approvalMode,
      allowedTools: form.approvalMode === 'allowlist' ? form.allowedTools : [],
      delivery: {
        type: form.deliveryType,
        ...(form.deliveryTarget.trim() ? { target: form.deliveryTarget.trim() } : {}),
      },
    };

    try {
      if (task) {
        await update.mutateAsync({ taskId: task.taskId, input: payload });
        toast.success('Scheduled task updated', { description: payload.name });
      } else {
        await create.mutateAsync(payload);
        toast.success('Scheduled task created', { description: payload.name });
      }
      onOpenChange(false);
    } catch (error) {
      toast.error(task ? 'Update failed' : 'Create failed', {
        description: error instanceof Error ? error.message : 'Try again',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{task ? 'Edit scheduled task' : 'New scheduled task'}</DialogTitle>
          <DialogDescription>
            Claw runs this on its own. Write the prompt so it stands alone — there is nobody
            to answer questions when it fires.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Daily Jira Report"
              data-testid="task-name"
            />
          </div>

          <div className="space-y-1.5">
            <Label>What should Claw do?</Label>
            <Textarea
              value={form.prompt}
              onChange={(e) => set('prompt', e.target.value)}
              rows={6}
              placeholder="Every run, read the ENG board for tickets updated in the last 24 hours, summarise by priority, and email me the result."
              data-testid="task-prompt"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Runs</Label>
            <Select
              value={form.scheduleType}
              onValueChange={(v) => set('scheduleType', v as FormState['scheduleType'])}
            >
              <SelectTrigger data-testid="task-schedule-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cron">On a schedule</SelectItem>
                <SelectItem value="interval">Every N minutes</SelectItem>
                <SelectItem value="once">Once, at a time</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {form.scheduleType === 'cron' && (
            <CronPicker
              value={form.cronExpression}
              timezone={form.timezone}
              onValueChange={(v) => set('cronExpression', v)}
              onTimezoneChange={(v) => set('timezone', v)}
            />
          )}

          {form.scheduleType === 'interval' && (
            <div className="space-y-1.5">
              <Label className="text-xs">Every (minutes)</Label>
              <Input
                type="number"
                min={15}
                value={form.intervalMinutes}
                onChange={(e) => set('intervalMinutes', Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">Minimum 15 minutes.</p>
            </div>
          )}

          {form.scheduleType === 'once' && (
            <div className="space-y-1.5">
              <Label className="text-xs">Run at</Label>
              <Input
                type="datetime-local"
                value={form.runAt}
                onChange={(e) => set('runAt', e.target.value)}
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Context</Label>
              <Select
                value={form.sessionMode}
                onValueChange={(v) => set('sessionMode', v as SessionMode)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="isolated">Isolated — fresh each run</SelectItem>
                  <SelectItem value="main">Main — remembers previous runs</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {form.sessionMode === 'isolated'
                  ? 'Best for reports.'
                  : 'Best for reminders that should not repeat themselves.'}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Send the result to</Label>
              <Select
                value={form.deliveryType}
                onValueChange={(v) => set('deliveryType', v as DeliveryChannel)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nowhere — just record the run</SelectItem>
                  <SelectItem value="slack">Slack</SelectItem>
                  <SelectItem value="telegram">Telegram</SelectItem>
                  <SelectItem value="discord">Discord</SelectItem>
                  <SelectItem value="jira">Jira</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                </SelectContent>
              </Select>
              {form.deliveryType !== 'none' && (
                <Input
                  value={form.deliveryTarget}
                  onChange={(e) => set('deliveryTarget', e.target.value)}
                  placeholder={deliveryPlaceholder(form.deliveryType)}
                />
              )}
            </div>
          </div>

          <ToolGrantPicker
            mode={form.approvalMode}
            allowedTools={form.allowedTools}
            onModeChange={(m) => set('approvalMode', m)}
            onAllowedToolsChange={(t) => set('allowedTools', t)}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={saving} data-testid="task-submit">
            {saving ? 'Saving…' : task ? 'Save changes' : 'Create task'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function deliveryPlaceholder(channel: DeliveryChannel): string {
  switch (channel) {
    case 'slack': return '#eng-reports';
    case 'telegram': return 'Chat id';
    case 'discord': return 'Channel id';
    case 'jira': return 'ENG-123';
    case 'email': return 'you@example.com';
    default: return '';
  }
}
