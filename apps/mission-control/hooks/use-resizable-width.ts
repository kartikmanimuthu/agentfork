'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Drag-to-resize width for a panel, persisted per key.
 *
 * Pointer events rather than mouse events, so a trackpad, pen or touch drag all
 * work, and `setPointerCapture` keeps the drag alive when the cursor outruns the
 * 4px handle — without it a fast drag drops the resize the moment the pointer
 * leaves the strip.
 *
 * The stored width is read AFTER mount, never during render: reading
 * localStorage while rendering would produce different markup on server and
 * client and trip a hydration mismatch.
 */
export interface ResizableWidth {
  width: number;
  isResizing: boolean;
  /** Attach to the drag handle's onPointerDown. */
  startResize: (event: React.PointerEvent<HTMLElement>) => void;
  /** Attach to the handle's onDoubleClick — snaps back to the default. */
  resetWidth: () => void;
}

export function useResizableWidth({
  storageKey,
  defaultWidth,
  min,
  max,
}: {
  storageKey: string;
  defaultWidth: number;
  min: number;
  max: number;
}): ResizableWidth {
  const clamp = useCallback((n: number) => Math.min(max, Math.max(min, n)), [min, max]);

  const [width, setWidth] = useState(defaultWidth);
  const [isResizing, setIsResizing] = useState(false);
  const origin = useRef({ x: 0, width: defaultWidth });

  useEffect(() => {
    const stored = Number(window.localStorage.getItem(storageKey));
    if (Number.isFinite(stored) && stored > 0) setWidth(clamp(stored));
  }, [storageKey, clamp]);

  const startResize = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      origin.current = { x: event.clientX, width };
      setIsResizing(true);

      const onMove = (e: PointerEvent) => {
        setWidth(clamp(origin.current.width + (e.clientX - origin.current.x)));
      };
      const onUp = () => {
        setIsResizing(false);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        // Read off the element rather than closing over a stale `width`.
        setWidth((current) => {
          window.localStorage.setItem(storageKey, String(current));
          return current;
        });
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [width, clamp, storageKey],
  );

  // A resize drag that starts over the panel would otherwise select text across
  // the whole page, and the cursor would flicker back to the default whenever it
  // left the handle.
  useEffect(() => {
    if (!isResizing) return;
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
    };
  }, [isResizing]);

  const resetWidth = useCallback(() => {
    setWidth(defaultWidth);
    window.localStorage.setItem(storageKey, String(defaultWidth));
  }, [defaultWidth, storageKey]);

  return { width, isResizing, startResize, resetWidth };
}
