'use client';

import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

/**
 * Ported from nucleus `components/agent-ops/cron-picker.tsx`.
 * cronstrue is imported lazily — it is only needed once this dialog is open.
 */

const PRESETS = [
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Daily at 9am', value: '0 9 * * *' },
  { label: 'Daily at 10am', value: '0 10 * * *' },
  { label: 'Weekdays at 9am', value: '0 9 * * 1-5' },
  { label: 'Weekly Monday 8am', value: '0 8 * * 1' },
  { label: 'Custom', value: 'custom' },
];

// Asia/Kolkata first — it is the primary timezone in use here.
const TIMEZONES = [
  'Asia/Kolkata',
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Australia/Sydney',
];

const INVALID = 'Invalid cron expression';

export function CronPicker({
  value,
  timezone,
  onValueChange,
  onTimezoneChange,
}: {
  value: string;
  timezone: string;
  onValueChange: (cron: string) => void;
  onTimezoneChange: (tz: string) => void;
}) {
  const [preset, setPreset] = useState<string>(() => {
    const found = PRESETS.find((p) => p.value === value && p.value !== 'custom');
    return found ? found.value : 'custom';
  });
  const [customCron, setCustomCron] = useState(value);
  const [humanReadable, setHumanReadable] = useState('');

  useEffect(() => {
    let active = true;
    void import('cronstrue').then(({ default: cronstrue }) => {
      try {
        const text = cronstrue.toString(value, { throwExceptionOnParseError: true });
        if (active) setHumanReadable(text);
      } catch {
        if (active) setHumanReadable(INVALID);
      }
    });
    return () => {
      active = false;
    };
  }, [value]);

  const handlePresetChange = (next: string) => {
    setPreset(next);
    if (next !== 'custom') {
      onValueChange(next);
      setCustomCron(next);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Schedule</Label>
          <Select value={preset} onValueChange={handlePresetChange}>
            <SelectTrigger data-testid="task-cron-preset"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PRESETS.map((p) => (
                <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Timezone</Label>
          <Select value={timezone} onValueChange={onTimezoneChange}>
            <SelectTrigger data-testid="task-timezone"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TIMEZONES.map((tz) => (
                <SelectItem key={tz} value={tz}>{tz}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {preset === 'custom' && (
        <div className="space-y-1.5">
          <Label className="text-xs">Cron expression</Label>
          <Input
            placeholder="e.g. 0 9 * * 1-5"
            value={customCron}
            onChange={(e) => {
              setCustomCron(e.target.value);
              onValueChange(e.target.value);
            }}
            className="font-mono"
          />
        </div>
      )}

      {humanReadable && (
        <p className="text-xs" data-testid="cron-human-readable">
          {humanReadable === INVALID ? (
            <span className="text-destructive">{humanReadable}</span>
          ) : (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Clock className="h-3 w-3" /> {humanReadable}
            </span>
          )}
        </p>
      )}
    </div>
  );
}
