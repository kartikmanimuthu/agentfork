'use client';

import { useEffect, useRef } from 'react';
import { Trash2, Tag } from 'lucide-react';

interface EdgeContextMenuProps {
  edgeId: string;
  position: { x: number; y: number };
  onAddLabel: (edgeId: string) => void;
  onDelete: (edgeId: string) => void;
  onClose: () => void;
}

export function EdgeContextMenu({
  edgeId,
  position,
  onAddLabel,
  onDelete,
  onClose,
}: EdgeContextMenuProps) {
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
      className="fixed z-50 min-w-36 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 animate-in fade-in-0 zoom-in-95"
      style={{ left: position.x, top: position.y }}
      role="menu"
    >
      <button
        className="relative flex w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground"
        role="menuitem"
        onClick={() => { onAddLabel(edgeId); onClose(); }}
      >
        <Tag className="h-4 w-4" />
        Edit Label
      </button>
      <div className="-mx-1 my-1 h-px bg-border" />
      <button
        className="relative flex w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm text-destructive outline-none select-none hover:bg-destructive/10"
        role="menuitem"
        onClick={() => { onDelete(edgeId); onClose(); }}
      >
        <Trash2 className="h-4 w-4" />
        Delete Edge
      </button>
    </div>
  );
}
