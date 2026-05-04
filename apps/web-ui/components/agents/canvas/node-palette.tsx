'use client';

import { NodeRegistry } from '@chatbot/agent-studio';
import { Bot, Wrench, GitBranch, Database } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const NODE_ICONS: Record<string, LucideIcon> = {
  llm: Bot,
  tool: Wrench,
  router: GitBranch,
  state_schema: Database,
};

const NODE_COLORS: Record<string, string> = {
  llm: 'text-primary',
  tool: 'text-orange-500',
  router: 'text-purple-500',
  state_schema: 'text-teal-500',
};

export function NodePalette() {
  const definitions = NodeRegistry.getAll();

  const handleDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData('application/reactflow/type', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <aside className="w-52 border-r bg-background flex flex-col shrink-0">
      <div className="px-3 py-2.5 border-b">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Nodes
        </p>
      </div>

      <div className="p-2 space-y-1">
        {definitions.map((def) => {
          const Icon = NODE_ICONS[def.type] ?? Bot;
          const colorClass = NODE_COLORS[def.type] ?? 'text-foreground';

          return (
            <div
              key={def.type}
              draggable
              onDragStart={(e) => handleDragStart(e, def.type)}
              className="flex items-center gap-2.5 px-3 py-2 rounded-md border bg-card cursor-grab active:cursor-grabbing hover:bg-accent hover:border-accent-foreground/20 transition-colors select-none"
              title={def.description}
              role="button"
              aria-label={`Drag ${def.label} node onto canvas`}
            >
              <Icon className={`h-4 w-4 shrink-0 ${colorClass}`} />
              <div>
                <p className="text-xs font-medium leading-none">{def.label}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">
                  {def.description}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
