/**
 * StoryLoop Layout
 *
 * Responsive 3-panel layout for the partner workspace.
 * Uses react-resizable-panels with percentage-based constraints
 * (minSize / maxSize) for sizing. Pixel-based min-widths are applied
 * to the content wrapper divs so they cannot interfere with the
 * library's internal flex-grow management on the outer panel divs.
 *
 * Panel IDs enable stable identification across mount/unmount cycles
 * and layout persistence.
 *
 * @remarks
 * react-resizable-panels v4.5.4 renders each Panel as TWO nested divs:
 *   outer (library-controlled flex styles) → inner (receives className/style).
 * Passing `style` or unknown props (e.g. `order`) to Panel can leak to the
 * DOM and cause subtle flex conflicts. Avoid it — use CSS classes on content
 * wrappers instead.
 */

import React from 'react';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import { cn } from '@/lib/utils';

interface StoryLoopLayoutProps {
  sidebar: React.ReactNode;
  list: React.ReactNode;
  detail: React.ReactNode;
  className?: string;
  /** Percentage layout [sidebar, list, detail]. Should sum to ~100. */
  defaultLayout?: number[];
  onLayoutChanged?: (layout: number[]) => void;
}

/** Default split: sidebar 20 % | list 30 % | detail 50 % */
const FALLBACK_LAYOUT: [number, number, number] = [20, 30, 50];

export function StoryLoopLayout({
  sidebar,
  list,
  detail,
  className,
  defaultLayout,
  onLayoutChanged,
}: StoryLoopLayoutProps) {
  const layout = defaultLayout ?? FALLBACK_LAYOUT;

  return (
    <div className={cn('h-full w-full min-h-0', className)}>
      <ResizablePanelGroup
        direction="horizontal"
        onLayout={onLayoutChanged}
        className="h-full min-h-0 overflow-hidden"
      >
        {/* ---- Sidebar: folders, labels, bookmarks ---- */}
        <ResizablePanel
          id="sl-sidebar"
          defaultSize={layout[0]}
          minSize={14}
          maxSize={30}
          className="min-h-0"
        >
          <div className="h-full min-h-0 min-w-[160px] overflow-hidden surface-container-high">
            {sidebar}
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle className="storyloop-handle" />

        {/* ---- List: stories or discussions ---- */}
        <ResizablePanel
          id="sl-list"
          defaultSize={layout[1]}
          minSize={18}
          maxSize={45}
          className="min-h-0"
        >
          <div className="h-full min-h-0 min-w-[220px] overflow-hidden surface-container">
            {list}
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle className="storyloop-handle" />

        {/* ---- Detail: story / discussion content ---- */}
        <ResizablePanel
          id="sl-detail"
          defaultSize={layout[2]}
          minSize={28}
          className="min-h-0"
        >
          <div className="h-full min-h-0 min-w-[280px] overflow-hidden bg-background">
            {detail}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
