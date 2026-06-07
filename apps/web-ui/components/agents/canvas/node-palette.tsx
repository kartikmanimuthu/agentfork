'use client';

import { NodeRegistry } from '@chatbot/agent-studio';
import { Bot, Wrench, GitBranch, Database, ArrowDownToLine, ArrowUpFromLine, Brain, BookOpen, Plug, Code, GitFork, Globe, UserCheck, GitMerge, Users, Timer, Send } from 'lucide-react';
import type { ElementType } from 'react';
import { WhatsAppIcon } from '@/components/icons/whatsapp-icon';

const NODE_ICONS: Record<string, ElementType> = {
  llm: Bot,
  tool: Wrench,
  router: GitBranch,
  state_schema: Database,
  input: ArrowDownToLine,
  output: ArrowUpFromLine,
  memory: Brain,
  knowledge_base: BookOpen,
  mcp_server: Plug,
  code: Code,
  condition: GitFork,
  http: Globe,
  human: UserCheck,
  parallel: GitMerge,
  sub_agent: Users,
  delay: Timer,
  whatsapp_trigger: WhatsAppIcon,
  whatsapp_send: WhatsAppIcon,
  whatsapp_send_template: WhatsAppIcon,
  telegram_trigger: Send,
  telegram_send: Send,
  telegram_send_buttons: Send,
};

const NODE_COLORS: Record<string, string> = {
  llm: 'text-primary',
  tool: 'text-orange-500',
  router: 'text-purple-500',
  state_schema: 'text-teal-500',
  input: 'text-green-500',
  output: 'text-red-500',
  memory: 'text-indigo-500',
  knowledge_base: 'text-amber-500',
  mcp_server: 'text-cyan-500',
  code: 'text-emerald-500',
  condition: 'text-yellow-500',
  http: 'text-blue-500',
  human: 'text-pink-500',
  parallel: 'text-violet-500',
  sub_agent: 'text-rose-500',
  delay: 'text-slate-500',
  whatsapp_trigger: 'text-green-600',
  whatsapp_send: 'text-green-600',
  whatsapp_send_template: 'text-green-600',
  telegram_trigger: 'text-sky-600',
  telegram_send: 'text-sky-600',
  telegram_send_buttons: 'text-sky-600',
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
