/**
 * Flowboard sandbox executor — the GOVERNED runtime for a saved FlowGraph.
 *
 * This is the controls-first core the Phase-0 analysis (docs/AISHA_FLOWBOARD_DESIGN.md)
 * flagged as missing: the existing workflowEngine treats requireHumanApproval /
 * mustPassCompliance as HINTS (logged, never halted). Here the executor is the
 * ENFORCEMENT point — a consent gate HALTS the run (emits a consent_request and
 * returns `awaiting_approval`) instead of proceeding. Gates fail CLOSED.
 *
 * Why the plan is derived server-side (not trusting a client-sent SandboxPlan):
 * a FlowGraph node's typeId already encodes its kind by prefix
 * (`gate.consent` | `agent.<slug>` | `action.<x>` | `trigger.<x>` | `tool.<x>` |
 * `control.<x>`), so the governance-relevant plan (gates + ordered steps) is
 * re-derived here from the authoritative stored graph. The richer FE
 * `compileToSandbox` (src/lib/flowboard) drives canvas/engine display only.
 * Unify both behind @aisha/flowboard-core when the core is extracted.
 *
 * Provenance lands in StoryLoop via create_story_entry_audited under the USER's
 * identity (pgrestUser), so the run is the existing iconographic timeline — no
 * new visualisation surface. Mirrors src/lib/flowboard/provenance.ts.
 *
 * @module svc-ai-chat/lib/flowboardSandboxExecutor
 */

// Shared single-source helpers from the extracted core package. The minimal
// FlowGraph shape below stays LOCAL on purpose — the runtime needs only
// {id,typeId,config}+edges and must not couple to the FE Zod schema.
import { topoOrder, kindIcon } from '@aisha/flowboard-core';

// ── Minimal FlowGraph shape (authoritative copy lives in src/lib/flowboard/graph.ts;
//    duplicated here because svc-ai-chat cannot import the web `@/lib` tree — see
//    the @aisha/flowboard-core follow-up). Only the fields the runtime needs. ──
export interface FlowNodeInstance {
  id: string;
  typeId: string;
  config?: Record<string, unknown>;
}
export interface FlowEdgeInstance {
  id: string;
  source: string;
  target: string;
  sourcePort?: string;
  targetPort?: string;
}
export interface FlowGraph {
  id: string;
  name?: string;
  version?: number;
  nodes: FlowNodeInstance[];
  edges: FlowEdgeInstance[];
  meta?: Record<string, unknown>;
}

export type FlowNodeKind = "trigger" | "agent" | "tool" | "action" | "control" | "gate";

export type FlowRunStatus = "complete" | "awaiting_approval" | "blocked";

export interface FlowRunResult {
  runId: string;
  status: FlowRunStatus;
  /** Node ids executed (in order) before completion or a halt. */
  executed: string[];
  /** Set when status==='awaiting_approval' — the FIRST gate node (topo order) that halted its path. */
  haltedAtNodeId?: string;
  /** Human-facing reason (also written to the consent_request entry). */
  reason?: string;
  /** All unapproved consent gates reached this run (per-PATH halts; each emitted a consent_request). */
  haltedGateIds?: string[];
  /** Nodes NOT executed because they sit downstream of an unapproved consent gate (fail-closed). */
  blockedNodeIds?: string[];
}

/** Story-entry params for create_story_entry_audited (mirrors provenance.ts:StoryEntryParams). */
interface StoryEntryParams {
  p_story_id: string;
  p_entry_type: string;
  p_content: string;
  p_metadata: Record<string, unknown>;
  p_is_internal: boolean;
}

/**
 * The user-scoped PostgREST surface the executor needs. A subset of the svc's
 * PostgrestClient so the executor is testable with a fake. All writes go through
 * the USER's JWT (create_story_entry_audited asserts auth.uid()).
 */
export interface ExecutorPgrest {
  rpc(fn: string, params: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
}

export interface FlowRunContext {
  storyId: string;
  /** The stored FlowGraph id — stamped on provenance so the StoryLoop approve block can resume. */
  graphId: string;
  runId: string;
  userId: string | null;
  engine: "sandbox" | "n8n";
  /**
   * Resume state reconstructed from the story's prior provenance entries (the story_entries ARE the
   * run state — the executor stays stateless). Present on a re-invoke after a consent-gate approval;
   * undefined on a fresh run. Makes a re-invoke idempotent: already-recorded nodes are skipped (with
   * their outputs preloaded for downstream context), approved gates are passed instead of re-halting,
   * and an already-emitted consent_request is not duplicated.
   */
  resume?: {
    approvedGateIds: string[];
    pendingGateIds: string[];
    executedNodeIds: string[];
    priorOutputs: Record<string, string>;
  };
}

/**
 * Governed per-agent-node executor. Injected so the executor stays unit-testable and so the
 * service reuses its EXISTING LLM router (unifiedChat) at the route boundary — there is no second
 * dispatch path. Returns the agent's text output, which becomes the step's provenance + the input
 * context for the next agent in topo order.
 */
export type AgentDispatch = (input: { slug: string; model: string; prompt: string; storyId: string }) => Promise<{ text: string }>;

/**
 * Governed per-action-node executor — performs a node's real outbound side-effect (email / in-app
 * notification) via the service's EXISTING outbox RPC at the route boundary. Injected so the executor
 * stays unit-testable. Actions are GATED structurally: a consent gate upstream halts the run before
 * the action is reached, so it only fires after approval.
 */
export type ActionDispatch = (input: {
  typeId: string;
  channel: string;
  recipient: string;
  payload: Record<string, unknown>;
  storyId: string;
}) => Promise<{ notificationId?: string }>;

export interface ExecutorDeps {
  pgrestUser: ExecutorPgrest;
  /** Optional structured logger (no-op default). */
  log?: { safeInfo?: (msg: string, meta?: unknown) => void; safeError?: (msg: string, meta?: unknown) => void };
  /** Optional agent dispatcher. When absent, agent nodes are recorded only (no LLM call). */
  dispatch?: AgentDispatch;
  /** Optional action dispatcher. When absent, action nodes are recorded only (no side-effect). */
  actionDispatch?: ActionDispatch;
}

/** Derive a node's kind from its typeId prefix (the FlowGraph naming convention). */
export function nodeKind(typeId: string): FlowNodeKind {
  const prefix = typeId.split(".")[0];
  if (prefix === "trigger" || prefix === "agent" || prefix === "tool" || prefix === "action" || prefix === "control" || prefix === "gate") {
    return prefix;
  }
  // Unknown prefixes are treated as inert actions (recorded, never executed as a gate).
  return "action";
}

// topoOrder (Kahn) — the single implementation lives in @aisha/flowboard-core
// (structurally generic, so this minimal runtime FlowGraph satisfies it). Imported
// above for internal use; re-exported so existing importers keep their path.
export { topoOrder };

function nodeLabel(node: FlowNodeInstance): string {
  const cfg = node.config ?? {};
  if (typeof cfg.label === "string" && cfg.label.length > 0) return cfg.label;
  return node.typeId;
}

function buildFlowRunEntry(ctx: FlowRunContext, graphName: string): StoryEntryParams {
  return {
    p_story_id: ctx.storyId,
    p_entry_type: "flow_run",
    p_content: `Automatizace „${graphName}" spuštěna (${ctx.engine}).`,
    p_metadata: { flowboard: { kind: "flow_run", runId: ctx.runId, graphId: ctx.graphId, engine: ctx.engine, icon: "play" } },
    // Owner-visible: a flow owner runs in their own story as owner_mode='member',
    // and create_story_entry_audited forbids members from creating INTERNAL entries.
    // The run provenance is the owner's automation activity, so it is non-internal.
    p_is_internal: false,
  };
}

function buildStepEntry(ctx: FlowRunContext, node: FlowNodeInstance, status: string, output?: string): StoryEntryParams {
  const kind = nodeKind(node.typeId);
  return {
    p_story_id: ctx.storyId,
    p_entry_type: "automation_step",
    p_content: output ? `${nodeLabel(node)} — ${status}\n\n${output}` : `${nodeLabel(node)} — ${status}`,
    p_metadata: {
      flowboard: {
        kind: "automation_step",
        runId: ctx.runId,
        nodeId: node.id,
        typeId: node.typeId,
        nodeKind: kind,
        status,
        icon: kindIcon(kind),
        output: output ?? null,
      },
    },
    // Owner-visible: a flow owner runs in their own story as owner_mode='member',
    // and create_story_entry_audited forbids members from creating INTERNAL entries.
    // The run provenance is the owner's automation activity, so it is non-internal.
    p_is_internal: false,
  };
}

function buildConsentRequestEntry(ctx: FlowRunContext, node: FlowNodeInstance, reason: string): StoryEntryParams {
  return {
    p_story_id: ctx.storyId,
    p_entry_type: "consent_request",
    p_content: reason,
    p_metadata: {
      flowboard: {
        kind: "consent_request",
        runId: ctx.runId,
        graphId: ctx.graphId,
        nodeId: node.id,
        typeId: node.typeId,
        status: "awaiting_approval",
        icon: "lock",
      },
    },
    p_is_internal: false, // consent requests are user-facing (they must approve)
  };
}

async function persist(deps: ExecutorDeps, params: StoryEntryParams): Promise<void> {
  // StoryEntryParams is a fixed-shape record; widen for the generic RPC seam.
  const { error } = await deps.pgrestUser.rpc(
    "create_story_entry_audited",
    params as unknown as Record<string, unknown>,
  );
  if (error) {
    // Provenance write failed — surface, do not swallow (the run record is the contract).
    deps.log?.safeError?.("flowboard.executor.provenance_failed", { entryType: params.p_entry_type, error });
    throw new Error(`flowboard provenance write failed (${params.p_entry_type})`);
  }
}

/**
 * Compute the set of nodes that must NOT execute because they sit downstream of an
 * unapproved consent gate — the fail-CLOSED per-PATH halt set. Every node reachable
 * along graph edges from any pending gate is blocked; independent branches are not.
 */
function blockedByPendingGates(
  graph: FlowGraph,
  pendingGateIds: ReadonlySet<string>,
): Set<string> {
  const blocked = new Set<string>();
  const outgoing = new Map<string, string[]>();
  for (const e of graph.edges) {
    const list = outgoing.get(e.source) ?? [];
    list.push(e.target);
    outgoing.set(e.source, list);
  }
  for (const gateId of pendingGateIds) {
    const stack = [...(outgoing.get(gateId) ?? [])];
    while (stack.length > 0) {
      const id = stack.pop() as string;
      if (blocked.has(id)) continue;
      blocked.add(id);
      for (const next of outgoing.get(id) ?? []) stack.push(next);
    }
  }
  return blocked;
}

/**
 * Execute a FlowGraph in the governed sandbox.
 *
 * Controls-first contract (fail-CLOSED, per-PATH): when a `gate.consent` node is
 * reached without approval, THAT PATH halts — a consent_request is emitted and no
 * node downstream of the gate executes (no side effect can fire behind an
 * unapproved gate). Independent branches that do not pass through the gate still
 * run, and the overall run returns `awaiting_approval`. A `gate.compliance` node
 * records a compliance checkpoint (full automated compliance enforcement is the
 * next layer). Every executed non-gate node is recorded as an automation_step.
 */
export async function executeFlowGraph(
  graph: FlowGraph,
  ctx: FlowRunContext,
  deps: ExecutorDeps,
): Promise<FlowRunResult> {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  // The story_entries ARE the run state: on a resume re-invoke the route reconstructs what already
  // ran, which gates are approved, and the prior agent outputs. A fresh run (no resume) emits the
  // flow_run umbrella; a resume does not re-emit it.
  const resume = ctx.resume;
  const approvedGates = new Set(resume?.approvedGateIds ?? []);
  const pendingGates = new Set(resume?.pendingGateIds ?? []);
  const alreadyExecuted = new Set(resume?.executedNodeIds ?? []);
  // Agent outputs keyed by node id, threaded forward ALONG GRAPH EDGES (not topo-sequence position)
  // so each agent's prompt carries only its real upstream predecessors' output — seeded from prior
  // outputs on resume so downstream context survives the halt.
  const outputs = new Map<string, string>(Object.entries(resume?.priorOutputs ?? {}));
  if (!resume) {
    await persist(deps, buildFlowRunEntry(ctx, graph.name ?? "Nový flow"));
  }

  // FAIL-CLOSED per-PATH: everything downstream of an UNAPPROVED consent gate is blocked
  // up front, BEFORE any side effect. Computed from the authoritative graph edges, so a
  // blocked node stays blocked no matter where it lands in topo order.
  const unapprovedConsentGates = new Set(
    graph.nodes
      .filter((n) => n.typeId === "gate.consent" && !approvedGates.has(n.id) && !alreadyExecuted.has(n.id))
      .map((n) => n.id),
  );
  const blocked = blockedByPendingGates(graph, unapprovedConsentGates);
  const haltedGates: { node: FlowNodeInstance; reason: string }[] = [];

  const executed: string[] = [...alreadyExecuted];
  for (const nodeId of topoOrder(graph)) {
    const node = byId.get(nodeId);
    if (!node) continue;
    const kind = nodeKind(node.typeId);

    // Idempotency: a node already recorded by a prior invoke is skipped (its output is preloaded).
    if (alreadyExecuted.has(nodeId)) continue;

    // Per-PATH halt: this node sits downstream of an unapproved consent gate — it must not
    // run (and must not emit provenance, or the resume machinery would treat it as done).
    // The halt itself is recorded loudly via the gate's consent_request + the halt log below.
    if (blocked.has(nodeId)) continue;

    if (kind === "gate" && node.typeId === "gate.consent") {
      if (approvedGates.has(node.id)) {
        // Approved by the run owner on a prior turn → record the approval and continue past the gate.
        await persist(deps, buildStepEntry(ctx, node, "approved"));
        executed.push(node.id);
        continue;
      }
      // FAIL-CLOSED: an unapproved consent gate halts ITS path pending explicit human approval
      // (descendants are in `blocked`). On a re-invoke an already-pending consent_request is
      // not duplicated. Independent branches continue — the run result is still awaiting_approval.
      const reason =
        (typeof node.config?.reason === "string" && node.config.reason) ||
        `Flow „${graph.name ?? "Nový flow"}" čeká na schválení člověkem před pokračováním.`;
      if (!pendingGates.has(node.id)) {
        await persist(deps, buildConsentRequestEntry(ctx, node, reason));
      }
      haltedGates.push({ node, reason });
      continue;
    }

    if (kind === "gate" && node.typeId === "gate.compliance") {
      await persist(deps, buildStepEntry(ctx, node, "compliance_checkpoint"));
      executed.push(node.id);
      continue;
    }

    if (kind === "agent" && deps.dispatch) {
      // Run the agent through the service's existing LLM router. Its output becomes this step's
      // provenance and the context for the next agent. A dispatch failure records an errored step
      // but does NOT abort the run — the GATES are the hard stops, not a flaky model call.
      const slug = node.typeId.slice("agent.".length);
      const model =
        (typeof node.config?.default_model === "string" && node.config.default_model) || "balanced";
      // Edge-correct context: concatenate the outputs of THIS node's actual upstream predecessors,
      // not whichever agent happened to run last in topo order.
      const context = graph.edges
        .filter((e) => e.target === node.id)
        .map((e) => outputs.get(e.source))
        .filter((o): o is string => Boolean(o))
        .join("\n\n");
      const prompt = context
        ? `Automation "${graph.name ?? "flow"}", step "${nodeLabel(node)}".\nUpstream output:\n${context}\n\nProduce this step's output.`
        : `Automation "${graph.name ?? "flow"}", step "${nodeLabel(node)}". Produce this step's output.`;
      try {
        const { text } = await deps.dispatch({ slug, model, prompt, storyId: ctx.storyId });
        outputs.set(node.id, text);
        await persist(deps, buildStepEntry(ctx, node, "executed", text));
      } catch (err) {
        deps.log?.safeError?.("flowboard.executor.agent_failed", { runId: ctx.runId, nodeId: node.id, err });
        await persist(deps, buildStepEntry(ctx, node, "error"));
      }
      executed.push(node.id);
      continue;
    }

    if (
      kind === "action" &&
      deps.actionDispatch &&
      (node.typeId === "action.email_send" || node.typeId === "action.notify")
    ) {
      // Real outbound side-effect via the service's existing outbox RPC. GATED STRUCTURALLY — a
      // consent gate upstream halts the run before this node, so it only fires after approval. A
      // failure records an errored step but does NOT abort the run.
      const channel = node.typeId === "action.email_send" ? "email" : "in_app";
      const cfg = (node.config ?? {}) as Record<string, unknown>;
      const recipient = typeof cfg.recipient === "string" ? cfg.recipient : "";
      const payload: Record<string, unknown> = {
        subject: typeof cfg.subject === "string" ? cfg.subject : nodeLabel(node),
        body: (typeof cfg.body === "string" && cfg.body) || (typeof cfg.message === "string" && cfg.message) || "",
      };
      if (!recipient) {
        // No recipient configured → record as skipped; never dispatch a side-effect blindly.
        await persist(deps, buildStepEntry(ctx, node, "skipped"));
        executed.push(node.id);
        continue;
      }
      try {
        const { notificationId } = await deps.actionDispatch({
          typeId: node.typeId,
          channel,
          recipient,
          payload,
          storyId: ctx.storyId,
        });
        await persist(
          deps,
          buildStepEntry(ctx, node, "executed", `→ ${channel}: ${recipient}${notificationId ? ` (#${notificationId})` : ""}`),
        );
      } catch (err) {
        deps.log?.safeError?.("flowboard.executor.action_failed", { runId: ctx.runId, nodeId: node.id, err });
        await persist(deps, buildStepEntry(ctx, node, "error"));
      }
      executed.push(node.id);
      continue;
    }

    // Non-gate node: record execution (the node's concrete action is the next layer).
    await persist(deps, buildStepEntry(ctx, node, "executed"));
    executed.push(node.id);
  }

  if (haltedGates.length > 0) {
    // Loud, auditable record of the per-PATH halt: which gates are pending and which
    // nodes were fail-closed blocked behind them (the consent_request story entries
    // carry the user-facing side; this is the operator/trace side).
    const blockedNodeIds = [...blocked];
    deps.log?.safeInfo?.("flowboard.executor.halt_consent", {
      runId: ctx.runId,
      gateIds: haltedGates.map((g) => g.node.id),
      blockedNodeIds,
    });
    return {
      runId: ctx.runId,
      status: "awaiting_approval",
      executed,
      haltedAtNodeId: haltedGates[0].node.id,
      reason: haltedGates[0].reason,
      haltedGateIds: haltedGates.map((g) => g.node.id),
      blockedNodeIds,
    };
  }

  deps.log?.safeInfo?.("flowboard.executor.complete", { runId: ctx.runId, nodes: executed.length });
  return { runId: ctx.runId, status: "complete", executed };
}
