/**
 * Flowboard — engine router.
 *
 * The user never picks an execution engine; the stack decides. `selectEngine`
 * routes a graph to `sandbox` (governed, via route_task/workflowEngine) when it
 * touches restricted/confidential data or contains a gate, otherwise to `n8n`
 * (fast path, compiled and pushed via the n8n REST API). A graph may pin a
 * target via `meta.engine`.
 *
 * @module flowboard/engine
 */

import { isMoreSensitive, type EngineTarget, type FlowNodeDescriptor } from "./nodeTypes.js";
import type { FlowGraph } from "./graph.js";
import type { FlowRegistry } from "./registry.js";

export interface EngineDecision {
  target: EngineTarget;
  rationale: string;
}

function descriptorsOf(graph: FlowGraph, registry: FlowRegistry): FlowNodeDescriptor[] {
  return graph.nodes
    .map((n) => registry.get(n.typeId))
    .filter((d): d is FlowNodeDescriptor => Boolean(d));
}

export function canRunOn(graph: FlowGraph, registry: FlowRegistry, target: EngineTarget): boolean {
  return descriptorsOf(graph, registry).every((d) => d.engines.includes(target));
}

export function selectEngine(graph: FlowGraph, registry: FlowRegistry): EngineDecision {
  const descriptors = descriptorsOf(graph, registry);

  const pinned = graph.meta?.engine;
  if (pinned === "n8n" || pinned === "sandbox") {
    if (canRunOn(graph, registry, pinned)) {
      return { target: pinned, rationale: `Pinned přes meta.engine = ${pinned}.` };
    }
  }

  const hasGate = descriptors.some((d) => d.kind === "gate");
  const hasSensitive = descriptors.some((d) => isMoreSensitive(d.sensitivity, "internal"));
  const sandboxOnly = descriptors.some(
    (d) => d.engines.includes("sandbox") && !d.engines.includes("n8n"),
  );

  if (sandboxOnly) {
    return { target: "sandbox", rationale: "Obsahuje node, který umí běžet jen v governed sandboxu." };
  }
  if (hasGate || hasSensitive) {
    return {
      target: "sandbox",
      rationale: hasGate
        ? "Obsahuje governance gate → governed sandbox."
        : "Pracuje s citlivými daty (restricted+) → governed sandbox.",
    };
  }
  if (canRunOn(graph, registry, "n8n")) {
    return { target: "n8n", rationale: "Nízká citlivost, integrace-heavy → rychlá n8n cesta." };
  }
  return { target: "sandbox", rationale: "Některý node neumí n8n → fallback na sandbox." };
}
