let rechartsPreloadPromise: Promise<unknown> | null = null;
let xyflowPreloadPromise: Promise<unknown> | null = null;

/**
 * Přednačte knihovnu Recharts.
 * 
 * Používá se pro lazy loading grafů, aby se zrychlilo načítání stránek,
 * které grafy nepotřebují okamžitě.
 * 
 * @returns Promise s modulem Recharts
 */
export function preloadRecharts(): Promise<unknown> {
  if (!rechartsPreloadPromise) {
    rechartsPreloadPromise = import("recharts");
  }
  return rechartsPreloadPromise;
}

/**
 * Přednačte knihovnu React Flow (xyflow).
 * 
 * Používá se pro lazy loading diagramů a workflow editorů.
 * 
 * @returns Promise s modulem xyflow
 */
export function preloadXyflowReact(): Promise<unknown> {
  if (!xyflowPreloadPromise) {
    xyflowPreloadPromise = import("@xyflow/react");
  }
  return xyflowPreloadPromise;
}
