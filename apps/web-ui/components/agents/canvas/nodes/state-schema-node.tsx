'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Badge } from '@/components/ui/badge';
import { Database } from 'lucide-react';
import type { StateSchemaNodeConfig } from '@chatbot/agent-studio';

export interface StateSchemaNodeData extends Record<string, unknown> {
  label: string;
  config: StateSchemaNodeConfig;
}

export const StateSchemaNode = memo(function StateSchemaNode({ data, selected }: NodeProps) {
  const nodeData = data as StateSchemaNodeData;
  const config = nodeData.config as StateSchemaNodeConfig;
  const fieldCount = config.fields?.length ?? 0;

  return (
    <div
      className={`min-w-[180px] rounded-lg border bg-card text-card-foreground shadow-sm transition-shadow ${
        selected ? 'ring-2 ring-primary shadow-md' : 'hover:shadow-md'
      }`}
    >
      {/* State schema is typically an entry node — no target handle */}
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/40 rounded-t-lg">
        <Database className="h-3.5 w-3.5 text-teal-500 shrink-0" />
        <span className="text-xs font-semibold truncate">{nodeData.label}</span>
        <Badge variant="outline" className="ml-auto text-[10px] px-1.5 py-0 border-teal-300 text-teal-600">
          State
        </Badge>
      </div>

      <div className="px-3 py-2">
        {fieldCount === 0 ? (
          <p className="text-[11px] text-muted-foreground italic">No fields defined</p>
        ) : (
          <ul className="space-y-0.5">
            {config.fields.slice(0, 4).map((field) => (
              <li key={field.name} className="flex items-center gap-1.5 text-[11px]">
                <span className="font-mono text-foreground truncate">{field.name}</span>
                <span className="text-muted-foreground shrink-0">{field.type}</span>
              </li>
            ))}
            {fieldCount > 4 && (
              <li className="text-[11px] text-muted-foreground">+{fieldCount - 4} more</li>
            )}
          </ul>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground" />
    </div>
  );
});
