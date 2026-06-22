'use client';

import { VIZ_TYPES } from '@chatbot/shared/client';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import type { VizType, VizConfig } from '@/lib/reports/types';

const NONE = '__none__';

export function VizMapper({
  columns,
  vizType,
  vizConfig,
  onVizTypeChange,
  onVizConfigChange,
}: {
  columns: string[];
  vizType: VizType;
  vizConfig: VizConfig;
  onVizTypeChange: (v: VizType) => void;
  onVizConfigChange: (c: VizConfig) => void;
}) {
  const yKeys = vizConfig.yKeys ?? [];
  const isTable = vizType === 'table';
  const isKpi = vizType === 'kpi';
  const isPie = vizType === 'pie';

  const toggleY = (col: string) => {
    const next = yKeys.includes(col) ? yKeys.filter((k) => k !== col) : [...yKeys, col];
    onVizConfigChange({ ...vizConfig, yKeys: next });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Visualization</Label>
        <Select value={vizType} onValueChange={(v) => onVizTypeChange(v as VizType)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VIZ_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!isTable && columns.length > 0 && (
        <>
          <div className="space-y-1.5">
            <Label>{isPie ? 'Label column' : 'X axis'}</Label>
            <Select
              value={vizConfig.xKey ?? columns[0]}
              onValueChange={(v) => onVizConfigChange({ ...vizConfig, xKey: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select column" />
              </SelectTrigger>
              <SelectContent>
                {columns.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>{isKpi || isPie ? 'Value column' : 'Y axis (series)'}</Label>
            {isKpi || isPie ? (
              <Select
                value={yKeys[0] ?? ''}
                onValueChange={(v) => onVizConfigChange({ ...vizConfig, yKeys: [v] })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select column" />
                </SelectTrigger>
                <SelectContent>
                  {columns.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {columns.map((c) => (
                  <Badge
                    key={c}
                    variant={yKeys.includes(c) ? 'default' : 'outline'}
                    className="cursor-pointer select-none"
                    onClick={() => toggleY(c)}
                  >
                    {c}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {!isKpi && !isPie && (
            <div className="space-y-1.5">
              <Label>Split into series by (optional)</Label>
              <Select
                value={vizConfig.seriesKey ?? NONE}
                onValueChange={(v) =>
                  onVizConfigChange({ ...vizConfig, seriesKey: v === NONE ? undefined : v })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {columns.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Pivots the first Y column into one series per distinct value.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
