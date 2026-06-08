'use client';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { GraphNode, MenuOption } from '@chatbot/shared/client';

interface Props {
  node: GraphNode | null;
  onChange: (id: string, data: GraphNode['data']) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export function WorkflowInspector({ node, onChange, onDelete, onClose }: Props) {
  if (!node) return <div className="w-72 border-l p-4 text-sm text-muted-foreground">Select a node to edit.</div>;
  const d = node.data;
  const set = (patch: Partial<GraphNode['data']>) => onChange(node.id, { ...d, ...patch });

  return (
    <div className="w-72 border-l p-4 space-y-3 overflow-y-auto">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold capitalize">{node.type} node</span>
        <Button variant="ghost" size="sm" onClick={onClose}>×</Button>
      </div>

      {node.type === 'menu' && (
        <>
          <div className="space-y-1"><Label>Title</Label>
            <Input value={d.title ?? ''} onChange={(e) => set({ title: e.target.value })} /></div>
          <div className="space-y-2">
            <Label>Options</Label>
            {(d.options ?? []).map((o, i) => (
              <div key={i} className="flex gap-1">
                <Input placeholder="Label" value={o.label} onChange={(e) => {
                  const options = [...(d.options ?? [])]; options[i] = { ...o, label: e.target.value }; set({ options });
                }} />
                <Input placeholder="value" value={o.value} onChange={(e) => {
                  const options = [...(d.options ?? [])]; options[i] = { ...o, value: e.target.value }; set({ options });
                }} />
                <Button variant="ghost" size="sm" onClick={() => {
                  const options = (d.options ?? []).filter((_, j) => j !== i); set({ options });
                }}>×</Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => {
              const options: MenuOption[] = [...(d.options ?? []), { label: 'New', value: `opt_${(d.options ?? []).length + 1}` }]; set({ options });
            }}>+ Add option</Button>
          </div>
        </>
      )}

      {node.type === 'text' && (
        <div className="space-y-1"><Label>Text</Label>
          <Textarea value={d.text ?? ''} onChange={(e) => set({ text: e.target.value })} rows={5} /></div>
      )}

      {node.type === 'file' && (
        <div className="space-y-1"><Label>File reference</Label>
          <Input value={d.fileRef ?? ''} onChange={(e) => set({ fileRef: e.target.value })} placeholder="s3://… or /path" /></div>
      )}

      <div className="pt-3 border-t">
        <Button variant="destructive" size="sm" className="w-full" onClick={() => onDelete(node.id)}>
          Delete node
        </Button>
      </div>
    </div>
  );
}
