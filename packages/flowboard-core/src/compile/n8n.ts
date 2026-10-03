/**
 * Flowboard — compile a FlowGraph to an n8n workflow.
 *
 * Emits the `{ name, nodes, connections }` shape consumed by the n8n REST API
 * (the same artifact shape as the committed `WF_*.json` workflows). Agent nodes
 * are auto-wired to an `AishaLlmRouter` language-model sub-node when no model is
 * connected, mirroring the platform's n8n agent convention.
 *
 * Beta scope: faithful node + connection topology and engine wiring; per-node
 * parameter schemas are filled in incrementally (config is passed through).
 *
 * @module flowboard/compile/n8n
 */

import type { PortType } from "../ports.js";
import type { FlowNodeDescriptor } from "../nodeTypes.js";
import type { FlowGraph } from "../graph.js";
import type { FlowRegistry } from "../registry.js";

export interface N8nWorkflowNode {
  id: string;
  name: string;
  type: string;
  typeVersion: number;
  position: [number, number];
  parameters: Record<string, unknown>;
}

export type N8nConnectionTarget = { node: string; type: string; index: number };
export type N8nConnections = Record<string, Record<string, N8nConnectionTarget[][]>>;

export interface N8nWorkflow {
  name: string;
  nodes: N8nWorkflowNode[];
  connections: N8nConnections;
  settings: Record<string, unknown>;
  meta: Record<string, unknown>;
}

const AISHA_ROUTER_TYPE = "n8n-nodes-aisha.aishaLlmRouter";

// NOTE (governance, fail-loud): gates are intentionally ABSENT from this map.
// `gate.consent` and `gate.compliance` have no real n8n node implementation yet
// (packages/n8n-nodes-aisha ships no consent/compliance gate node), so their
// descriptors declare `engines: ["sandbox"]` and the n8n target must REJECT them
// at validation (ENGINE_UNSUPPORTED_NODE) instead of compiling a human-approval
// gate into a passthrough. Re-add a mapping here ONLY together with the real
// node in packages/n8n-nodes-aisha AND `engines: [..., "n8n"]` on the descriptor.
const N8N_TYPE_MAP: Readonly<Record<string, string>> = {
  "trigger.email_inbound": "n8n-nodes-base.emailReadImap",
  "trigger.webhook": "n8n-nodes-base.webhook",
  "trigger.schedule": "n8n-nodes-base.scheduleTrigger",
  "trigger.story_event": "n8n-nodes-aisha.storyEventTrigger",
  "action.story_entry": "n8n-nodes-aisha.storyEntry",
  "action.notify": "n8n-nodes-aisha.notify",
  "action.email_send": "n8n-nodes-base.emailSend",
  "control.switch": "n8n-nodes-base.switch",
};

function n8nTypeFor(descriptor: FlowNodeDescriptor): string {
  if (descriptor.source === "n8n" && descriptor.ref) return descriptor.ref;
  if (descriptor.kind === "agent") return "@n8n/n8n-nodes-langchain.agent";
  if (descriptor.kind === "tool") return "@n8n/n8n-nodes-langchain.toolMcp";
  const mapped = N8N_TYPE_MAP[descriptor.typeId];
  if (!mapped) {
    // Fail-loud: an unmapped node MUST NOT silently become a noOp passthrough —
    // for a gate that would drop the governance halt (fail-open), for any other
    // node it would silently skip the step. Callers validate with
    // `validateGraph(graph, registry, { engine: "n8n" })` first for a clean error.
    throw new Error(
      `compileToN8n: no n8n node mapping for "${descriptor.typeId}" — refusing to compile it to a noOp passthrough`,
    );
  }
  return mapped;
}

function n8nCategory(portType: PortType): string {
  switch (portType) {
    case "ai_languageModel":
    case "ai_memory":
    case "ai_tool":
      return portType;
    default:
      return "main";
  }
}

function uniqueName(base: string, used: Set<string>): string {
  let name = base;
  let i = 2;
  while (used.has(name)) name = `${base} ${i++}`;
  used.add(name);
  return name;
}

export interface CompileN8nOptions {
  /**
   * When set, append a final httpRequest node that POSTs the run context + the n8n
   * execution id to the Flowboard callback after the flow runs. That callback writes
   * per-node `automation_step` provenance (svc-ai-chat /flowboard-n8n-callback).
   */
  callback?: { url: string; storyId: string; ownerId: string; runId: string };
}

export function compileToN8n(
  graph: FlowGraph,
  registry: FlowRegistry,
  opts: CompileN8nOptions = {},
): N8nWorkflow {
  const usedNames = new Set<string>();
  const nameOf = new Map<string, string>();
  const descriptorOf = new Map<string, FlowNodeDescriptor>();
  const nodes: N8nWorkflowNode[] = [];

  for (const inst of graph.nodes) {
    const d = registry.get(inst.typeId);
    if (!d) {
      // Fail-loud: silently dropping an unknown node would push a workflow that
      // quietly skips steps. validateGraph reports this as UNKNOWN_NODE_TYPE first.
      throw new Error(
        `compileToN8n: unknown node type "${inst.typeId}" (node ${inst.id}) — refusing to compile a workflow with silently dropped nodes`,
      );
    }
    descriptorOf.set(inst.id, d);
    const name = uniqueName(inst.label ?? d.label, usedNames);
    nameOf.set(inst.id, name);
    nodes.push({
      id: inst.id,
      name,
      type: n8nTypeFor(d),
      typeVersion: 1,
      position: [Math.round(inst.position.x), Math.round(inst.position.y)],
      parameters: { ...d.defaultConfig, ...inst.config, _flowboardTypeId: d.typeId },
    });
  }

  const connections: N8nConnections = {};
  const addConnection = (fromName: string, category: string, toName: string): void => {
    connections[fromName] ??= {};
    connections[fromName][category] ??= [[]];
    connections[fromName][category][0].push({ node: toName, type: category, index: 0 });
  };

  const agentsWithModel = new Set<string>();
  for (const edge of graph.edges) {
    const srcName = nameOf.get(edge.source);
    const tgtName = nameOf.get(edge.target);
    const srcD = descriptorOf.get(edge.source);
    if (!srcName || !tgtName || !srcD) continue;
    const outPort = srcD.ports.find((p) => p.id === edge.sourcePort);
    if (!outPort) continue;
    const category = n8nCategory(outPort.type);
    addConnection(srcName, category, tgtName);
    if (category === "ai_languageModel") agentsWithModel.add(edge.target);
  }

  let routerX = 0;
  for (const inst of graph.nodes) {
    const d = descriptorOf.get(inst.id);
    if (!d || d.kind !== "agent" || agentsWithModel.has(inst.id)) continue;
    const agentName = nameOf.get(inst.id);
    if (!agentName) continue;
    const routerName = uniqueName(`${agentName} Model`, usedNames);
    nodes.push({
      id: `${inst.id}__router`,
      name: routerName,
      type: AISHA_ROUTER_TYPE,
      typeVersion: 1,
      position: [Math.round(inst.position.x - 220), Math.round(inst.position.y + 160 + routerX)],
      parameters: { strategy: "auto" },
    });
    addConnection(routerName, "ai_languageModel", agentName);
    routerX += 40;
  }

  // Optional provenance callback: after the flow runs, POST the run context + n8n execution
  // id to the Flowboard callback so the service writes per-node automation_step provenance.
  if (opts.callback) {
    const sources = new Set(graph.edges.map((e) => e.source));
    const sinks = graph.nodes.filter((n) => nameOf.has(n.id) && !sources.has(n.id));
    const cbName = uniqueName("Flowboard Callback", usedNames);
    let maxX = 0;
    for (const n of nodes) maxX = Math.max(maxX, n.position[0]);
    nodes.push({
      id: "__flowboard_callback",
      name: cbName,
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4,
      position: [maxX + 240, 0],
      parameters: {
        method: "POST",
        url: opts.callback.url,
        sendHeaders: true,
        headerParameters: { parameters: [{ name: "X-N8N-API-Key", value: "={{ $env.N8N_API_KEY }}" }] },
        sendBody: true,
        bodyParameters: {
          parameters: [
            { name: "story_id", value: opts.callback.storyId },
            { name: "owner_id", value: opts.callback.ownerId },
            { name: "graph_id", value: graph.id },
            { name: "run_id", value: opts.callback.runId },
            { name: "execution_id", value: "={{ $execution.id }}" },
          ],
        },
      },
    });
    for (const s of sinks) {
      const sn = nameOf.get(s.id);
      if (sn) addConnection(sn, "main", cbName);
    }
  }

  // name → { id, typeId } so the execution callback can map n8n's per-node-NAME run data
  // back to the flowboard node ids when it writes per-node provenance.
  const flowboardNodeMap: Record<string, { id: string; typeId: string }> = {};
  for (const inst of graph.nodes) {
    const nm = nameOf.get(inst.id);
    if (nm) flowboardNodeMap[nm] = { id: inst.id, typeId: inst.typeId };
  }

  return {
    name: graph.name,
    nodes,
    connections,
    settings: {},
    meta: {
      generatedBy: "aisha-flowboard",
      flowboardGraphId: graph.id,
      flowboardVersion: graph.version,
      flowboardNodeMap,
    },
  };
}
