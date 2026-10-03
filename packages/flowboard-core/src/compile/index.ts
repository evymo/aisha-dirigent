/**
 * Flowboard — compile entrypoint.
 *
 * Validates a graph, routes it to an engine, and produces the matching artifact.
 * Both compile targets are exported so the hybrid path can also produce both.
 *
 * @module flowboard/compile
 */

import { validateGraph, type FlowGraph, type ValidationError } from "../graph.js";
import { selectEngine, type EngineDecision } from "../engine.js";
import type { FlowRegistry } from "../registry.js";
import { compileToN8n, type N8nWorkflow } from "./n8n.js";
import { compileToSandbox, type SandboxPlan } from "./sandbox.js";

export { compileToN8n } from "./n8n.js";
export { compileToSandbox } from "./sandbox.js";
export { topoOrder } from "./topo.js";
export type { N8nWorkflow } from "./n8n.js";
export type { SandboxPlan } from "./sandbox.js";

export interface CompileResult {
  ok: boolean;
  errors: ValidationError[];
  decision: EngineDecision;
  n8n?: N8nWorkflow;
  sandbox?: SandboxPlan;
}

export function compileGraph(graph: FlowGraph, registry: FlowRegistry): CompileResult {
  const { ok, errors } = validateGraph(graph, registry);
  const decision = selectEngine(graph, registry);
  if (!ok) return { ok: false, errors, decision };

  if (decision.target === "n8n") {
    return { ok: true, errors: [], decision, n8n: compileToN8n(graph, registry) };
  }
  return { ok: true, errors: [], decision, sandbox: compileToSandbox(graph, registry) };
}
