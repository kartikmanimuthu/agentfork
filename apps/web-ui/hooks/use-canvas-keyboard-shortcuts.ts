'use client';

import { useEffect, type RefObject } from 'react';

interface UseCanvasKeyboardShortcutsOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  getSelectedNodeIds: () => string[];
  onDelete: (ids: string[]) => void;
  onDuplicate: (ids: string[]) => void;
  onCopy: (ids: string[]) => void;
  onPaste: () => void;
}

export function useCanvasKeyboardShortcuts({
  containerRef,
  getSelectedNodeIds,
  onDelete,
  onDuplicate,
  onCopy,
  onPaste,
}: UseCanvasKeyboardShortcutsOptions) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      const ids = getSelectedNodeIds();
      const mod = e.metaKey || e.ctrlKey;

      if ((e.key === 'Delete' || e.key === 'Backspace') && ids.length > 0) {
        e.preventDefault();
        onDelete(ids);
        return;
      }

      if (mod && e.key === 'd' && ids.length > 0) {
        e.preventDefault();
        onDuplicate(ids);
        return;
      }

      if (mod && e.key === 'c' && ids.length > 0) {
        e.preventDefault();
        onCopy(ids);
        return;
      }

      if (mod && e.key === 'v') {
        e.preventDefault();
        onPaste();
        return;
      }
    };

    container.addEventListener('keydown', handler);
    return () => container.removeEventListener('keydown', handler);
  }, [containerRef, getSelectedNodeIds, onDelete, onDuplicate, onCopy, onPaste]);
}
