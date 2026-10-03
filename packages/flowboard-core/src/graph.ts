/**
 * Flowboard — graph model and validation.
 *
 * A `FlowGraph` is the versioned, engine-agnostic source of truth for one
 * automation, stored as JSON (same lifecycle as a GrapesJS page). It is the
 * artifact the AISHA auto-builder emits and the user edits on the canvas.
 *
 * `validateGraph` is shared by the canvas (live edge checks) and the compiler
 * (pre-flight). It enforces structural integrity, port-type compatibility, and
 * the governance "locked edge" rule (a restricted/confidential source may not
 * reach an egress node without passing through a gate).
 *
 * @module flowboard/graph
 */

import { z } from "zod";
import { canConnect, type PortSpec } from "./ports.js";
import {
  getPort,
  isMoreSensitive,
  type EngineTarget,
  type FlowNodeDescriptor,
} from "./nodeTypes.js";
import type { FlowRegistry } from "./registry.js";

export const flowNodeInstanceSchema = z.object({
  id: z.string().min(1),
  typeId: z.string().min(1),
  position: z.object({ x: z.number(), y: z.number() }),
  label: z.string().optional(),
  config: z.record(z.string(), z.unknown()).default({}),
  draft: z.boolean().default(false),
});
export type FlowNodeInstance = z.infer<typeof flowNodeInstanceSchema>;

export const flowEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  sourcePort: z.string().min(1),
  target: z.string().min(1),
  targetPort: z.string().min(1),
});
export type FlowEdge = z.infer<typeof flowEdgeSchema>;

export const flowGraphSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().min(1).default(1),
  name: z.string().default("Untitled flow"),
  nodes: z.array(flowNodeInstanceSchema),
  edges: z.array(flowEdgeSchema),
  meta: z.record(z.string(), z.unknown()).default({}),
});
export type FlowGraph = z.infer<typeof flowGraphSchema>;

export type ValidationCode =
  | "UNKNOWN_NODE_TYPE"
  | "UNKNOWN_EDGE_ENDPOINT"
  | "UNKNOWN_PORT"
  | "INCOMPATIBLE_PORTS"
  | "MISSING_REQUIRED_INPUT"
  | "CONSENT_GATE_REQUIRED"
  | "ENGINE_UNSUPPORTED_NODE";

export interface ValidationError {
  code: ValidationCode;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
}

export interface ValidateGraphOptions {
  /**
   * When set, additionally enforce each node descriptor's `engines` support claim
   * for this execution target. A node whose descriptor excludes the target (e.g.
   * `gate.consent` with `engines: ["sandbox"]` on the n8n target) is a hard
   * validation error — the compiler must NEVER silently degrade such a node to a
   * passthrough (that would make a governance gate fail-OPEN on that engine).
   */
  engine?: EngineTarget;
}

interface ResolvedEdge {
  edge: FlowEdge;
  outPort: PortSpec;
  inPort: PortSpec;
}

export function validateGraph(
  graph: FlowGraph,
  registry: FlowRegistry,
  opts: ValidateGraphOptions = {},
): ValidationResult {
  const errors: ValidationError[] = [];
  const descriptorOf = new Map<string, FlowNodeDescriptor>();

  for (const node of graph.nodes) {
    const d = registry.get(node.typeId);
    if (!d) {
      errors.push({
        code: "UNKNOWN_NODE_TYPE",
        message: `Neznámý typ nodu: ${node.typeId}`,
        nodeId: node.id,
      });
      continue;
    }
    descriptorOf.set(node.id, d);
    if (opts.engine && !d.engines.includes(opts.engine)) {
      errors.push({
        code: "ENGINE_UNSUPPORTED_NODE",
        message: `Node ${node.label ?? d.label} (${node.typeId}) neumí běžet na enginu "${opts.engine}" (podporuje: ${d.engines.join(", ")}).`,
        nodeId: node.id,
      });
    }
  }

  const wiredInputs = new Set<string>();
  for (const edge of graph.edges) {
    const srcD = descriptorOf.get(edge.source);
    const tgtD = descriptorOf.get(edge.target);
    if (!srcD || !tgtD) {
      errors.push({
        code: "UNKNOWN_EDGE_ENDPOINT",
        message: `Hrana ${edge.id} odkazuje na neexistující node.`,
        edgeId: edge.id,
      });
      continue;
    }
    const outPort = getPort(srcD, edge.sourcePort);
    const inPort = getPort(tgtD, edge.targetPort);
    if (!outPort || !inPort) {
      errors.push({
        code: "UNKNOWN_PORT",
        message: `Hrana ${edge.id} odkazuje na neexistující port.`,
        edgeId: edge.id,
      });
      continue;
    }
    if (!canConnect(outPort, inPort)) {
      errors.push({
        code: "INCOMPATIBLE_PORTS",
        message: `Nekompatibilní porty: ${outPort.type} → ${inPort.type}.`,
        edgeId: edge.id,
      });
      continue;
    }
    wiredInputs.add(`${edge.target}:${edge.targetPort}`);
  }

  for (const node of graph.nodes) {
    const d = descriptorOf.get(node.id);
    if (!d) continue;
    for (const port of d.ports) {
      if (port.direction === "in" && port.required) {
        if (!wiredInputs.has(`${node.id}:${port.id}`)) {
          errors.push({
            code: "MISSING_REQUIRED_INPUT",
            message: `Node ${node.label ?? node.typeId} má nezapojený povinný vstup "${port.label ?? port.id}".`,
            nodeId: node.id,
          });
        }
      }
    }
  }

  errors.push(...checkConsentGates(graph, descriptorOf));
  return { ok: errors.length === 0, errors };
}

function checkConsentGates(
  graph: FlowGraph,
  descriptorOf: ReadonlyMap<string, FlowNodeDescriptor>,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const incoming = new Map<string, string[]>();
  for (const e of graph.edges) {
    const list = incoming.get(e.target) ?? [];
    list.push(e.source);
    incoming.set(e.target, list);
  }

  for (const node of graph.nodes) {
    const d = descriptorOf.get(node.id);
    if (!d?.egress) continue;

    const visited = new Set<string>([node.id]);
    const frontier = [...(incoming.get(node.id) ?? [])];
    let sensitiveUngated = false;

    while (frontier.length > 0) {
      const id = frontier.shift() as string;
      if (visited.has(id)) continue;
      visited.add(id);
      const ud = descriptorOf.get(id);
      if (!ud) continue;
      if (ud.kind === "gate") continue;
      if (isMoreSensitive(ud.sensitivity, "internal")) sensitiveUngated = true;
      for (const upstream of incoming.get(id) ?? []) frontier.push(upstream);
    }

    if (sensitiveUngated) {
      errors.push({
        code: "CONSENT_GATE_REQUIRED",
        message: `Egress "${node.label ?? d.label}" dostává citlivá data bez consent gate. Vlož gate.consent mezi zdroj a výstup.`,
        nodeId: node.id,
      });
    }
  }
  return errors;
}

export function resolveEdges(graph: FlowGraph, registry: FlowRegistry): ResolvedEdge[] {
  const resolved: ResolvedEdge[] = [];
  for (const edge of graph.edges) {
    const srcD = registry.get(graph.nodes.find((n) => n.id === edge.source)?.typeId ?? "");
    const tgtD = registry.get(graph.nodes.find((n) => n.id === edge.target)?.typeId ?? "");
    if (!srcD || !tgtD) continue;
    const outPort = getPort(srcD, edge.sourcePort);
    const inPort = getPort(tgtD, edge.targetPort);
    if (outPort && inPort) resolved.push({ edge, outPort, inPort });
  }
  return resolved;
}
