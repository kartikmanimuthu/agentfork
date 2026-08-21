'use client';

import { SidebarProvider, SidebarInset, SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { ConsoleSidebar } from '@/components/console-sidebar';
import { ThemeToggle } from '@/components/theme-toggle';
import { ResizeHandle } from '@/components/ui/resize-handle';
import { useResizableWidth } from '@/hooks/use-resizable-width';

const MIN_WIDTH = 180;
const MAX_WIDTH = 420;
const DEFAULT_WIDTH = 256; // 16rem, the shadcn default

/**
 * Sits inside the provider so it can read the collapse state: while collapsed
 * the rail is icon-width and dragging it would fight the collapse animation, so
 * the handle is simply not rendered.
 */
function SidebarResizer({ resizer }: { resizer: ReturnType<typeof useResizableWidth> }) {
  const { state, isMobile } = useSidebar();
  if (isMobile || state === 'collapsed') return null;
  // -translate-x-1/2 so the 6px strip is CENTRED on the sidebar's border-r.
  // With the base translate-x-1/2 the strip started at `left` and shifted right,
  // putting its line 6px clear of the border — which read as two separate
  // vertical lines, one of which resized and one of which did not.
  return (
    <ResizeHandle
      label="Resize navigation"
      isResizing={resizer.isResizing}
      onPointerDown={resizer.startResize}
      onDoubleClick={resizer.resetWidth}
      className="fixed inset-y-0 right-auto z-30 -translate-x-1/2"
      style={{ left: resizer.width }}
    />
  );
}

export function ConsoleShell({ studioId, children }: { studioId: string; children: React.ReactNode }) {
  const resizer = useResizableWidth({
    storageKey: 'mc:nav-width',
    defaultWidth: DEFAULT_WIDTH,
    min: MIN_WIDTH,
    max: MAX_WIDTH,
  });

  return (
    <SidebarProvider
      // SidebarProvider spreads `style` AFTER its own defaults, so this wins.
      // Everything downstream reads w-[var(--sidebar-width)].
      style={{ '--sidebar-width': `${resizer.width}px` } as React.CSSProperties}
    >
      <ConsoleSidebar />
      <SidebarResizer resizer={resizer} />
      <SidebarInset>
        <header className="glass sticky top-0 z-30 flex h-14 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <span className="text-sm text-muted-foreground">Studio: {studioId}</span>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </header>
        <main className="flex-1">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
