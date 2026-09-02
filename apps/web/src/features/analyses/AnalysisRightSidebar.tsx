"use client";



import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { Panel } from "@/components/shell/Panel";

import { PanelResizeHandle } from "@/components/shell/PanelResizeHandle";

import { cn } from "@/lib/utils";

import {

  DRAWING_PANEL,

  useLayoutStore,

} from "@/features/plan-viewer/useLayoutStore";



type AnalysisRightSidebarProps = {

  drawingInfo: ReactNode;

  overlayView: ReactNode;

};



function clampDrawingHeight(total: number, height: number): number {

  const max = Math.max(DRAWING_PANEL.min, total - DRAWING_PANEL.viewMin);

  return Math.min(max, Math.max(DRAWING_PANEL.min, height));

}



export function AnalysisRightSidebar({ drawingInfo, overlayView }: AnalysisRightSidebarProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState(0);
  const viewOpen = useLayoutStore((s) => s.viewSectionOpen);
  const toggleView = useLayoutStore((s) => s.toggleViewSection);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  const drawingRatio = useLayoutStore((s) => s.drawingPanelRatio);
  const setDrawingPanelRatio = useLayoutStore((s) => s.setDrawingPanelRatio);



  useEffect(() => {

    const node = containerRef.current;

    if (!node) return;

    const sync = () => setContainerHeight(node.clientHeight);

    sync();

    const observer = new ResizeObserver(sync);

    observer.observe(node);

    return () => observer.disconnect();

  }, []);



  const drawingHeight =

    viewOpen && containerHeight > 0

      ? clampDrawingHeight(containerHeight, Math.round(containerHeight * drawingRatio))

      : 0;



  const handleDrawingHeightChange = useCallback(

    (height: number) => {

      if (containerHeight <= 0) return;

      setDrawingPanelRatio(height / containerHeight);

    },

    [containerHeight, setDrawingPanelRatio],

  );



  return (

    <div ref={containerRef} className="hl-panel-stack h-full">

      <div

        className={cn(

          "hl-group flex min-h-0 flex-col overflow-hidden",

          viewOpen ? "shrink-0" : "min-h-0 flex-1",

        )}

        style={viewOpen && drawingHeight > 0 ? { height: drawingHeight } : undefined}

      >

        <Panel
          title="Properties"
          className="h-full min-h-0"
          bodyClassName="overflow-y-auto p-2"
          action={
            <button
              type="button"
              className="rounded p-1 text-slate-500 hover:bg-[var(--hl-raised)] hover:text-slate-800"
              onClick={toggleSidebar}
              title="Hide properties panel"
              aria-label="Hide properties panel"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M9 6l6 6-6 6"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          }
        >
          {drawingInfo}
        </Panel>
      </div>



      {viewOpen ? (

        <PanelResizeHandle

          orientation="horizontal"

          edge="bottom"

          value={drawingHeight}

          onChange={handleDrawingHeightChange}

          min={DRAWING_PANEL.min}

          max={Math.max(DRAWING_PANEL.min, containerHeight - DRAWING_PANEL.viewMin)}

        />

      ) : null}



      <div

        className={cn(

          "hl-group flex min-h-0 flex-col overflow-hidden",

          viewOpen ? "min-h-0 flex-1" : "shrink-0",

        )}

      >

        <Panel

          title="View"

          className="h-full min-h-0"

          bodyClassName="overflow-y-auto p-2"

          action={

            <button

              type="button"

              className="rounded px-1.5 py-0.5 text-xs text-slate-500 hover:bg-[var(--hl-raised)] hover:text-slate-800"

              onClick={toggleView}

              title={viewOpen ? "Collapse view panel" : "Expand view panel"}

            >

              {viewOpen ? "▾" : "▸"}

            </button>

          }

        >

          {viewOpen ? overlayView : null}

        </Panel>

      </div>

    </div>

  );

}


