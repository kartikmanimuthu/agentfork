'use client';

import { useEffect, useRef } from 'react';
import { Pencil, Copy, Trash2 } from 'lucide-react';

interface NodeContextMenuProps {
  nodeId: string;
  position: { x: number; y: number };
  onEdit: (nodeId: string) => void;
  onDuplicate: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
  onClose: () => void;
}

export function NodeContextMenu({
  nodeId,
  position,
  onEdit,
  onDuplicate,
  onDelete,
  onClose,
}: NodeContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-40 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 animate-in fade-in-0 zoom-in-95"
      style={{ left: position.x, top: position.y }}
      role="menu"
    >
      <button
        className="relative flex w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground"
        role="menuitem"
        onClick={() => { onEdit(nodeId); onClose(); }}
      >
        <Pencil className="h-4 w-4" />
        Edit
      </button>
      <button
        className="relative flex w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground"
        role="menuitem"
        onClick={() => { onDuplicate(nodeId); onClose(); }}
      >
        <Copy className="h-4 w-4" />
        Duplicate
        <span className="ml-auto text-xs text-muted-foreground">Ctrl+D</span>
      </button>
      <div className="-mx-1 my-1 h-px bg-border" />
      <button
        className="relative flex w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm text-destructive outline-none select-none hover:bg-destructive/10"
        role="menuitem"
        onClick={() => { onDelete(nodeId); onClose(); }}
      >
        <Trash2 className="h-4 w-4" />
        Delete
        <span className="ml-auto text-xs text-muted-foreground">Del</span>
      </button>
    </div>
  );
}
