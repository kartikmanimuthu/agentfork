'use client';
const ITEMS: { type: 'menu' | 'text' | 'file'; label: string }[] = [
  { type: 'menu', label: 'Menu' }, { type: 'text', label: 'Text' }, { type: 'file', label: 'File' },
];
export function WorkflowPalette() {
  return (
    <div className="w-40 border-r p-3 space-y-2">
      <div className="text-xs font-semibold text-muted-foreground uppercase">Nodes</div>
      {ITEMS.map((it) => (
        <div
          key={it.type}
          draggable
          onDragStart={(e) => e.dataTransfer.setData('application/workflow/type', it.type)}
          className="rounded-md border bg-card px-3 py-2 text-sm cursor-grab active:cursor-grabbing"
        >{it.label}</div>
      ))}
    </div>
  );
}
