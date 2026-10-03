/**
 * Flowboard — compile a FlowGraph to a governed sandbox plan.
 *
 * The sandbox target reuses the platform's existing `route_task` execution path:
 * the emitted plan is shaped like the `RoutePlan` the orchestration bridge
 * already produces (agents + tool allowlist + stop conditions), so the
 * workflowEngine can run it inside the consent/provenance boundary.
 *
 * @module flowboard/compile/sandbox
 */

import type { FlowNodeDescriptor } from "../nodeTypes.js";
import type { FlowGraph } from "../graph.js";
import type { FlowRegistry } from "../registry.js";
import { topoOrder } from "./topo.js";

export interface SandboxTrigger {
  nodeId: string;
  typeId: string;
  config: Record<string, unknown>;
}

export interface SandboxStep {
  nodeId: string;
  slug: string;
  model: string;
  stepIndex: number;
}

export interface SandboxStopConditions {
  maxLoops: number;
  mustPassCompliance: boolean;
  requireHumanApproval: boolean;
}

export interface SandboxPlan {
  graphId: string;
  triggers: SandboxTrigger[];
  steps: SandboxStep[];
  toolsAllowlist: string[];
  stopConditions: SandboxStopConditions;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export function compileToSandbox(graph: FlowGraph, registry: FlowRegistry): SandboxPlan {
  const order = topoOrder(graph);
  const instanceById = new Map(graph.nodes.map((n) => [n.id, n]));

  const triggers: SandboxTrigger[] = [];
  const steps: SandboxStep[] = [];
  const tools = new Set<string>();
  let mustPassCompliance = false;
  let requireHumanApproval = false;
  let maxLoops = 3;

  let stepIndex = 0;
  for (const id of order) {
    const inst = instanceById.get(id);
    if (!inst) continue;
    const d: FlowNodeDescriptor | undefined = registry.get(inst.typeId);
    if (!d) continue;

    switch (d.kind) {
      case "trigger":
        triggers.push({ nodeId: id, typeId: d.typeId, config: inst.config });
        break;
      case "agent": {
        steps.push({
          nodeId: id,
          slug: d.ref ?? d.typeId,
          model: asString(inst.config.default_model, "balanced"),
          stepIndex: stepIndex++,
        });
        for (const t of (inst.config.allowed_tools as string[] | undefined) ?? []) {
          tools.add(t);
        }
        if (inst.config.autonomy_level === "manual") requireHumanApproval = true;
        if (typeof inst.config.max_loops === "number") {
          maxLoops = Math.max(maxLoops, inst.config.max_loops);
        }
        break;
      }
      case "tool":
        if (d.ref) tools.add(d.ref);
        break;
      case "gate":
        if (d.typeId === "gate.compliance") mustPassCompliance = true;
        if (d.typeId === "gate.consent") requireHumanApproval = true;
        break;
      default:
        break;
    }
  }

  return {
    graphId: graph.id,
    triggers,
    steps,
    toolsAllowlist: [...tools],
    stopConditions: { maxLoops, mustPassCompliance, requireHumanApproval },
  };
}
