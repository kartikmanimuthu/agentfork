'use client';

import { cn } from '@/lib/utils';

/**
 * The grab strip between a panel and the content beside it.
 *
 * Wider hit area than visible line — 6px is comfortable to grab, a 6px border
 * would be ugly — so the strip is transparent and only paints on hover or while
 * dragging. `touch-none` stops a touch drag from scrolling the page instead of
 * resizing.
 */
export function ResizeHandle({
  onPointerDown,
  onDoubleClick,
  isResizing,
  label,
  className,
  style,
}: {
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onDoubleClick: () => void;
  isResizing: boolean;
  label: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title={`${label} — drag to resize, double-click to reset`}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      style={style}
      className={cn(
        'group/resize absolute inset-y-0 right-0 z-20 w-1.5 translate-x-1/2 cursor-col-resize touch-none select-none',
        className,
      )}
    >
      <div
        className={cn(
          'mx-auto h-full w-px transition-colors',
          isResizing ? 'bg-primary' : 'bg-transparent group-hover/resize:bg-primary/40',
        )}
      />
    </div>
  );
}
