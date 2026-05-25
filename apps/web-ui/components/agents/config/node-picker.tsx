'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface NodeOption {
  id: string;
  label: string;
  type: string;
}

interface NodePickerProps {
  nodes: NodeOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  className?: string;
}

export function NodePicker({ nodes, value, onChange, placeholder = 'Select node…', className }: NodePickerProps) {
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {nodes.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">No other nodes on canvas</div>
        ) : (
          nodes.map((n) => (
            <SelectItem key={n.id} value={n.id}>
              {n.label} · {n.type}
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );
}
