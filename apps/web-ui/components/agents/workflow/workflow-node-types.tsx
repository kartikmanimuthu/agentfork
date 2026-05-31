'use client';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { MenuOption } from '@chatbot/shared';

export function MenuNode({ data }: NodeProps) {
  const d = data as { title?: string; options?: MenuOption[] };
  return (
    <div className="rounded-lg border bg-card shadow-sm min-w-[180px]">
      <Handle type="target" position={Position.Left} />
      <div className="px-3 py-2 border-b text-sm font-semibold">{d.title || 'Menu'}</div>
      <div className="py-1">
        {(d.options ?? []).map((o) => (
          <div key={o.value} className="relative px-3 py-1.5 text-sm flex items-center justify-between">
            <span>{o.icon ? `${o.icon} ` : ''}{o.label}</span>
            <Handle type="source" id={o.value} position={Position.Right} style={{ position: 'relative', transform: 'none', right: -6 }} />
          </div>
        ))}
        {(d.options ?? []).length === 0 && <div className="px-3 py-1.5 text-xs text-muted-foreground">No options yet</div>}
      </div>
    </div>
  );
}

export function TextNode({ data }: NodeProps) {
  const d = data as { text?: string };
  return (
    <div className="rounded-lg border bg-card shadow-sm min-w-[160px] max-w-[240px]">
      <Handle type="target" position={Position.Left} />
      <div className="px-3 py-1 border-b text-xs font-medium text-muted-foreground">Text</div>
      <div className="px-3 py-2 text-sm whitespace-pre-wrap">{d.text || '(empty)'}</div>
    </div>
  );
}

export function FileNode({ data }: NodeProps) {
  const d = data as { fileRef?: string };
  return (
    <div className="rounded-lg border bg-card shadow-sm min-w-[160px]">
      <Handle type="target" position={Position.Left} />
      <div className="px-3 py-1 border-b text-xs font-medium text-muted-foreground">File</div>
      <div className="px-3 py-2 text-sm font-mono truncate">{d.fileRef || '(no file)'}</div>
    </div>
  );
}

export const workflowNodeTypes = { menu: MenuNode, text: TextNode, file: FileNode };
