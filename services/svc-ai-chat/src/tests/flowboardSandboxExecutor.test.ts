import { describe, it, expect, vi } from "vitest";
import {
  executeFlowGraph,
  nodeKind,
  topoOrder,
  type FlowGraph,
  type FlowRunContext,
  type ExecutorPgrest,
} from "../lib/flowboardSandboxExecutor.js";

// Fake user-scoped PostgREST that records every RPC call and returns success.
function fakePgrest() {
  const calls: { fn: string; params: Record<string, unknown> }[] = [];
  const pg: ExecutorPgrest = {
    async rpc(fn, params) {
      calls.push({ fn, params });
      return { data: "00000000-0000-0000-0000-000000000001", error: null };
    },
  };
  return { pg, calls };
}

const ctx = (engine: "sandbox" | "n8n" = "sandbox"): FlowRunContext => ({
  storyId: "story-1",
  graphId: "graph-1",
  runId: "run-1",
  userId: "user-1",
  engine,
});

const entryTypes = (calls: { params: Record<string, unknown> }[]) =>
  calls.map((c) => c.params.p_entry_type);

describe("flowboardSandboxExecutor", () => {
  it("nodeKind derives kind from the typeId prefix", () => {
    expect(nodeKind("gate.consent")).toBe("gate");
    expect(nodeKind("agent.knowledge")).toBe("agent");
    expect(nodeKind("trigger.email_inbound")).toBe("trigger");
    expect(nodeKind("action.email_send")).toBe("action");
    expect(nodeKind("weird")).toBe("action"); // unknown → inert action, never a gate
  });

  it("topoOrder is deterministic and never loops on a cycle", () => {
    const g: FlowGraph = {
      id: "g",
      nodes: [{ id: "a", typeId: "trigger.x" }, { id: "b", typeId: "agent.y" }, { id: "c", typeId: "action.z" }],
      edges: [
        { id: "e1", source: "a", target: "b" },
        { id: "e2", source: "b", target: "c" },
        { id: "e3", source: "c", target: "b" }, // back-edge (cycle)
      ],
    };
    const order = topoOrder(g);
    expect(order[0]).toBe("a");
    expect(order).toHaveLength(3); // every node appears exactly once despite the cycle
    expect(new Set(order).size).toBe(3);
  });

  it("runs a gate-free flow to completion and records flow_run + one step per node", async () => {
    const { pg, calls } = fakePgrest();
    const graph: FlowGraph = {
      id: "g1",
      name: "Help inbox",
      nodes: [
        { id: "t", typeId: "trigger.email_inbound" },
        { id: "a", typeId: "agent.knowledge" },
        { id: "k", typeId: "action.email_send" },
      ],
      edges: [
        { id: "e1", source: "t", target: "a" },
        { id: "e2", source: "a", target: "k" },
      ],
    };

    const result = await executeFlowGraph(graph, ctx(), { pgrestUser: pg });

    expect(result.status).toBe("complete");
    expect(result.executed).toEqual(["t", "a", "k"]);
    // flow_run umbrella + one automation_step per node
    expect(entryTypes(calls)).toEqual(["flow_run", "automation_step", "automation_step", "automation_step"]);
    // every persisted call is create_story_entry_audited (user-JWT provenance path)
    expect(calls.every((c) => c.fn === "create_story_entry_audited")).toBe(true);
  });

  it("HALTS at a consent gate: emits consent_request, returns awaiting_approval, runs NO downstream node", async () => {
    const { pg, calls } = fakePgrest();
    const graph: FlowGraph = {
      id: "g2",
      name: "Gated flow",
      nodes: [
        { id: "t", typeId: "trigger.email_inbound" },
        { id: "gate", typeId: "gate.consent", config: { reason: "Potřebuji tvé schválení." } },
        { id: "a", typeId: "agent.knowledge" },
      ],
      edges: [
        { id: "e1", source: "t", target: "gate" },
        { id: "e2", source: "gate", target: "a" },
      ],
    };

    const result = await executeFlowGraph(graph, ctx(), { pgrestUser: pg });

    expect(result.status).toBe("awaiting_approval");
    expect(result.haltedAtNodeId).toBe("gate");
    expect(result.executed).toEqual(["t"]); // only the pre-gate node ran
    // flow_run, the trigger step, then the consent_request — and NOTHING for the downstream agent
    expect(entryTypes(calls)).toEqual(["flow_run", "automation_step", "consent_request"]);
    const consent = calls.find((c) => c.params.p_entry_type === "consent_request")!;
    expect(consent.params.p_content).toBe("Potřebuji tvé schválení.");
    expect(consent.params.p_is_internal).toBe(false); // user-facing — they must approve
  });

  it("records a compliance gate as a checkpoint and continues", async () => {
    const { pg, calls } = fakePgrest();
    const graph: FlowGraph = {
      id: "g3",
      nodes: [
        { id: "c", typeId: "gate.compliance" },
        { id: "a", typeId: "agent.knowledge" },
      ],
      edges: [{ id: "e1", source: "c", target: "a" }],
    };

    const result = await executeFlowGraph(graph, ctx(), { pgrestUser: pg });

    expect(result.status).toBe("complete");
    expect(result.executed).toEqual(["c", "a"]);
    const cp = calls.find((c) => (c.params.p_metadata as { flowboard?: { status?: string } })?.flowboard?.status === "compliance_checkpoint");
    expect(cp).toBeTruthy();
  });

  it("provenance carries semantic lucide icon NAMES, never emoji", async () => {
    const { pg, calls } = fakePgrest();
    const graph: FlowGraph = {
      id: "g4",
      nodes: [{ id: "a", typeId: "agent.knowledge" }],
      edges: [],
    };
    await executeFlowGraph(graph, ctx(), { pgrestUser: pg });
    const icons = calls.map((c) => (c.params.p_metadata as { flowboard?: { icon?: string } })?.flowboard?.icon);
    expect(icons).toContain("play"); // flow_run
    expect(icons).toContain("bot"); // agent step
    // no emoji anywhere
    expect(icons.every((i) => typeof i === "string" && /^[a-z-]+$/.test(i))).toBe(true);
  });

  it("writes ALL provenance as non-internal (member-mode owners cannot create internal entries)", async () => {
    // create_story_entry_audited RAISEs '42501' if a member-mode caller sets is_internal=true.
    // A flow owner runs in their own story as owner_mode='member', so every entry must be
    // non-internal or the run would fail mid-execution against the real DB.
    const { pg, calls } = fakePgrest();
    const graph: FlowGraph = {
      id: "g6",
      nodes: [
        { id: "t", typeId: "trigger.email_inbound" },
        { id: "g", typeId: "gate.consent" },
      ],
      edges: [{ id: "e", source: "t", target: "g" }],
    };
    await executeFlowGraph(graph, ctx(), { pgrestUser: pg });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.params.p_is_internal === false)).toBe(true);
  });

  it("surfaces a provenance write failure (does not silently swallow)", async () => {
    const pg: ExecutorPgrest = {
      async rpc() {
        return { data: null, error: { message: "boom" } };
      },
    };
    const graph: FlowGraph = { id: "g5", nodes: [{ id: "a", typeId: "agent.x" }], edges: [] };
    await expect(executeFlowGraph(graph, ctx(), { pgrestUser: pg })).rejects.toThrow(/provenance write failed/);
  });

  it("dispatches agent nodes through the injected dispatcher and threads the output forward", async () => {
    const { pg, calls } = fakePgrest();
    const prompts: string[] = [];
    const dispatch = vi.fn(async ({ prompt }: { slug: string; model: string; prompt: string }) => {
      prompts.push(prompt);
      return { text: prompts.length === 1 ? "first-output" : "second-output" };
    });
    const graph: FlowGraph = {
      id: "g7",
      nodes: [
        { id: "a1", typeId: "agent.knowledge" },
        { id: "a2", typeId: "agent.summary" },
      ],
      edges: [{ id: "e", source: "a1", target: "a2" }],
    };
    const result = await executeFlowGraph(graph, ctx(), { pgrestUser: pg, dispatch });
    expect(result.status).toBe("complete");
    expect(dispatch).toHaveBeenCalledTimes(2);
    // the second agent's prompt carries the first agent's output (context threaded)
    expect(prompts[1]).toContain("first-output");
    // the agent output is recorded into the step's provenance content
    const a1 = calls.find(
      (c) => (c.params.p_metadata as { flowboard?: { nodeId?: string } })?.flowboard?.nodeId === "a1",
    );
    expect(a1?.params.p_content).toContain("first-output");
  });

  it("records an errored step when the dispatcher throws — without aborting the run", async () => {
    const { pg, calls } = fakePgrest();
    const dispatch = vi.fn(async () => {
      throw new Error("model down");
    });
    const graph: FlowGraph = {
      id: "g8",
      nodes: [
        { id: "a", typeId: "agent.x" },
        { id: "k", typeId: "action.email_send" },
      ],
      edges: [{ id: "e", source: "a", target: "k" }],
    };
    const result = await executeFlowGraph(graph, ctx(), { pgrestUser: pg, dispatch });
    expect(result.status).toBe("complete"); // the run continues past the failed agent
    expect(result.executed).toEqual(["a", "k"]);
    const a = calls.find(
      (c) => (c.params.p_metadata as { flowboard?: { nodeId?: string } })?.flowboard?.nodeId === "a",
    );
    expect((a?.params.p_metadata as { flowboard?: { status?: string } })?.flowboard?.status).toBe("error");
  });

  it("records agent nodes as executed (no LLM call) when no dispatcher is injected", async () => {
    const { pg, calls } = fakePgrest();
    const graph: FlowGraph = { id: "g9", nodes: [{ id: "a", typeId: "agent.x" }], edges: [] };
    const result = await executeFlowGraph(graph, ctx(), { pgrestUser: pg }); // no dispatch
    expect(result.status).toBe("complete");
    const a = calls.find(
      (c) => (c.params.p_metadata as { flowboard?: { nodeId?: string } })?.flowboard?.nodeId === "a",
    );
    expect((a?.params.p_metadata as { flowboard?: { status?: string } })?.flowboard?.status).toBe("executed");
  });

  it("threads context along graph EDGES, not topo-sequence — a sibling never receives the other sibling's output", async () => {
    // Diamond: root -> A, root -> B, A -> merge, B -> merge. topoOrder yields root,A,B,merge, so
    // B runs right after A — but B's only predecessor is root, so it must NOT see A's output.
    const { pg } = fakePgrest();
    const promptBySlug: Record<string, string> = {};
    const dispatch = vi.fn(async ({ slug, prompt }: { slug: string; model: string; prompt: string; storyId: string }) => {
      promptBySlug[slug] = prompt;
      return { text: `${slug}-out` };
    });
    const graph: FlowGraph = {
      id: "diamond",
      name: "Diamond",
      nodes: [
        { id: "root", typeId: "agent.root" },
        { id: "A", typeId: "agent.a" },
        { id: "B", typeId: "agent.b" },
        { id: "merge", typeId: "agent.merge" },
      ],
      edges: [
        { id: "e1", source: "root", target: "A" },
        { id: "e2", source: "root", target: "B" },
        { id: "e3", source: "A", target: "merge" },
        { id: "e4", source: "B", target: "merge" },
      ],
    };
    const result = await executeFlowGraph(graph, ctx(), { pgrestUser: pg, dispatch });
    expect(result.status).toBe("complete");
    // B (sibling of A, no edge A->B) carries ONLY root's output — not A's (the cross-contamination bug)
    expect(promptBySlug["b"]).toContain("root-out");
    expect(promptBySlug["b"]).not.toContain("a-out");
    // merge fans in BOTH real predecessors
    expect(promptBySlug["merge"]).toContain("a-out");
    expect(promptBySlug["merge"]).toContain("b-out");
    // root has no predecessors → no upstream context at all
    expect(promptBySlug["root"]).not.toContain("Upstream output");
  });

  it("resumes past an APPROVED consent gate, runs downstream, and re-emits neither flow_run nor consent_request", async () => {
    const { pg, calls } = fakePgrest();
    const dispatch = vi.fn(async () => ({ text: "agent-out" }));
    const graph: FlowGraph = {
      id: "g-resume",
      name: "Gated",
      nodes: [
        { id: "t", typeId: "trigger.x" },
        { id: "gate", typeId: "gate.consent" },
        { id: "a", typeId: "agent.k" },
      ],
      edges: [
        { id: "e1", source: "t", target: "gate" },
        { id: "e2", source: "gate", target: "a" },
      ],
    };
    const result = await executeFlowGraph(
      graph,
      { ...ctx(), resume: { approvedGateIds: ["gate"], pendingGateIds: [], executedNodeIds: ["t"], priorOutputs: {} } },
      { pgrestUser: pg, dispatch },
    );
    expect(result.status).toBe("complete");
    // no flow_run re-emit, no consent_request re-emit; the already-run trigger is skipped
    expect(calls.some((c) => c.params.p_entry_type === "flow_run")).toBe(false);
    expect(calls.some((c) => c.params.p_entry_type === "consent_request")).toBe(false);
    expect(dispatch).toHaveBeenCalledOnce(); // only the agent runs; the skipped trigger never dispatches
    // the gate is recorded as an 'approved' step
    const gateStep = calls.find(
      (c) => (c.params.p_metadata as { flowboard?: { nodeId?: string } })?.flowboard?.nodeId === "gate",
    );
    expect((gateStep?.params.p_metadata as { flowboard?: { status?: string } })?.flowboard?.status).toBe("approved");
  });

  it("seeds downstream context from prior outputs on resume so an upstream agent's output survives the halt", async () => {
    const { pg } = fakePgrest();
    let bPrompt = "";
    const dispatch = vi.fn(async ({ slug, prompt }: { slug: string; model: string; prompt: string; storyId: string }) => {
      if (slug === "b") bPrompt = prompt;
      return { text: `${slug}-out` };
    });
    // a -> {gate, b}: on the first run a ran + the gate halted; on resume a is skipped, the gate is
    // approved, and b (whose real predecessor is a) must still receive a's prior output.
    const graph: FlowGraph = {
      id: "g-resume2",
      nodes: [
        { id: "a", typeId: "agent.a" },
        { id: "gate", typeId: "gate.consent" },
        { id: "b", typeId: "agent.b" },
      ],
      edges: [
        { id: "e1", source: "a", target: "gate" },
        { id: "e2", source: "a", target: "b" },
      ],
    };
    const result = await executeFlowGraph(
      graph,
      {
        ...ctx(),
        resume: { approvedGateIds: ["gate"], pendingGateIds: [], executedNodeIds: ["a"], priorOutputs: { a: "a-out" } },
      },
      { pgrestUser: pg, dispatch },
    );
    expect(result.status).toBe("complete");
    expect(bPrompt).toContain("a-out"); // prior output threaded across the halt
  });

  it("does NOT duplicate a consent_request on a re-invoke while the gate is still pending (un-approved)", async () => {
    const { pg, calls } = fakePgrest();
    const graph: FlowGraph = {
      id: "g-pending",
      nodes: [
        { id: "gate", typeId: "gate.consent" },
        { id: "a", typeId: "agent.x" },
      ],
      edges: [{ id: "e", source: "gate", target: "a" }],
    };
    const result = await executeFlowGraph(
      graph,
      { ...ctx(), resume: { approvedGateIds: [], pendingGateIds: ["gate"], executedNodeIds: [], priorOutputs: {} } },
      { pgrestUser: pg, dispatch: vi.fn() },
    );
    expect(result.status).toBe("awaiting_approval");
    expect(calls.some((c) => c.params.p_entry_type === "consent_request")).toBe(false); // not re-emitted
    expect(calls.some((c) => c.params.p_entry_type === "flow_run")).toBe(false);
  });

  it("dispatches an action node through the injected actionDispatch and records the outbound step", async () => {
    const { pg, calls } = fakePgrest();
    const actionDispatch = vi.fn(async () => ({ notificationId: "n-1" }));
    const graph: FlowGraph = {
      id: "g-act",
      nodes: [{ id: "k", typeId: "action.email_send", config: { recipient: "a@b.c", subject: "Hi", body: "Hello" } }],
      edges: [],
    };
    const result = await executeFlowGraph(graph, ctx(), { pgrestUser: pg, actionDispatch });
    expect(result.status).toBe("complete");
    expect(actionDispatch).toHaveBeenCalledWith(expect.objectContaining({ channel: "email", recipient: "a@b.c" }));
    const k = calls.find((c) => (c.params.p_metadata as { flowboard?: { nodeId?: string } })?.flowboard?.nodeId === "k");
    expect((k?.params.p_metadata as { flowboard?: { status?: string } })?.flowboard?.status).toBe("executed");
  });

  it("halts per-PATH: an independent branch still runs while the gated branch is fail-closed blocked", async () => {
    // t → gate → guarded-action   (gated path: must NOT run)
    // t → free-action             (independent path: must run)
    const { pg, calls } = fakePgrest();
    const actionDispatch = vi.fn(async () => ({ notificationId: "n-1" }));
    const graph: FlowGraph = {
      id: "g-perpath",
      name: "Per-path",
      nodes: [
        { id: "t", typeId: "trigger.email_inbound" },
        { id: "gate", typeId: "gate.consent" },
        { id: "guarded", typeId: "action.email_send", config: { recipient: "x@y.z" } },
        { id: "free", typeId: "action.notify", config: { recipient: "u-1", message: "hi" } },
      ],
      edges: [
        { id: "e1", source: "t", target: "gate" },
        { id: "e2", source: "gate", target: "guarded" },
        { id: "e3", source: "t", target: "free" },
      ],
    };
    const result = await executeFlowGraph(graph, ctx(), { pgrestUser: pg, actionDispatch });
    expect(result.status).toBe("awaiting_approval");
    expect(result.haltedAtNodeId).toBe("gate");
    expect(result.blockedNodeIds).toEqual(["guarded"]); // ONLY the gated path is blocked
    // the independent branch executed (side effect fired exactly once, for `free`)
    expect(actionDispatch).toHaveBeenCalledTimes(1);
    expect(actionDispatch).toHaveBeenCalledWith(expect.objectContaining({ typeId: "action.notify", recipient: "u-1" }));
    expect(result.executed).toContain("free");
    expect(result.executed).not.toContain("guarded");
    // NO provenance step for the blocked node (a recorded step would be treated as
    // executed by buildResumeState and skipped after approval)
    const guardedStep = calls.find(
      (c) => (c.params.p_metadata as { flowboard?: { nodeId?: string } })?.flowboard?.nodeId === "guarded",
    );
    expect(guardedStep).toBeUndefined();
    // the halt itself is loudly recorded as a consent_request
    expect(calls.some((c) => c.params.p_entry_type === "consent_request")).toBe(true);
  });

  it("emits a consent_request for EACH independent unapproved gate in one run", async () => {
    const { pg, calls } = fakePgrest();
    const graph: FlowGraph = {
      id: "g-twogates",
      nodes: [
        { id: "t", typeId: "trigger.email_inbound" },
        { id: "g1", typeId: "gate.consent" },
        { id: "g2", typeId: "gate.consent" },
        { id: "a1", typeId: "action.notify", config: { recipient: "r", message: "m" } },
        { id: "a2", typeId: "action.notify", config: { recipient: "r", message: "m" } },
      ],
      edges: [
        { id: "e1", source: "t", target: "g1" },
        { id: "e2", source: "t", target: "g2" },
        { id: "e3", source: "g1", target: "a1" },
        { id: "e4", source: "g2", target: "a2" },
      ],
    };
    const result = await executeFlowGraph(graph, ctx(), { pgrestUser: pg, actionDispatch: vi.fn(async () => ({})) });
    expect(result.status).toBe("awaiting_approval");
    expect(result.haltedGateIds).toEqual(["g1", "g2"]);
    expect(calls.filter((c) => c.params.p_entry_type === "consent_request")).toHaveLength(2);
    expect(new Set(result.blockedNodeIds)).toEqual(new Set(["a1", "a2"]));
  });

  it("a chained gate behind another unapproved gate stays silent (sequential approval UX)", async () => {
    // t → g1 → g2 → a: only g1 emits a consent_request; g2 + a are blocked fail-closed.
    const { pg, calls } = fakePgrest();
    const graph: FlowGraph = {
      id: "g-chained",
      nodes: [
        { id: "t", typeId: "trigger.email_inbound" },
        { id: "g1", typeId: "gate.consent" },
        { id: "g2", typeId: "gate.consent" },
        { id: "a", typeId: "agent.x" },
      ],
      edges: [
        { id: "e1", source: "t", target: "g1" },
        { id: "e2", source: "g1", target: "g2" },
        { id: "e3", source: "g2", target: "a" },
      ],
    };
    const result = await executeFlowGraph(graph, ctx(), { pgrestUser: pg, dispatch: vi.fn() });
    expect(result.status).toBe("awaiting_approval");
    expect(result.haltedGateIds).toEqual(["g1"]);
    expect(calls.filter((c) => c.params.p_entry_type === "consent_request")).toHaveLength(1);
    expect(new Set(result.blockedNodeIds)).toEqual(new Set(["g2", "a"]));
  });

  it("a node reachable through BOTH a gated and an ungated path is blocked (fail-closed on ANY pending ancestor)", async () => {
    // root → gate → merge, root → merge: merge must NOT run while the gate is pending.
    const { pg } = fakePgrest();
    const dispatch = vi.fn(async () => ({ text: "out" }));
    const graph: FlowGraph = {
      id: "g-diamond-gate",
      nodes: [
        { id: "root", typeId: "trigger.x" },
        { id: "gate", typeId: "gate.consent" },
        { id: "merge", typeId: "agent.m" },
      ],
      edges: [
        { id: "e1", source: "root", target: "gate" },
        { id: "e2", source: "root", target: "merge" },
        { id: "e3", source: "gate", target: "merge" },
      ],
    };
    const result = await executeFlowGraph(graph, ctx(), { pgrestUser: pg, dispatch });
    expect(result.status).toBe("awaiting_approval");
    expect(dispatch).not.toHaveBeenCalled(); // merge blocked despite the ungated edge
    expect(result.blockedNodeIds).toContain("merge");
  });

  it("does NOT dispatch an action behind an un-approved consent gate (gated structurally)", async () => {
    const { pg } = fakePgrest();
    const actionDispatch = vi.fn(async () => ({}));
    const graph: FlowGraph = {
      id: "g-gated",
      nodes: [
        { id: "gate", typeId: "gate.consent" },
        { id: "k", typeId: "action.email_send", config: { recipient: "a@b.c" } },
      ],
      edges: [{ id: "e", source: "gate", target: "k" }],
    };
    const result = await executeFlowGraph(graph, ctx(), { pgrestUser: pg, actionDispatch });
    expect(result.status).toBe("awaiting_approval");
    expect(actionDispatch).not.toHaveBeenCalled(); // the gate halts before the action fires
  });

  it("records an action as skipped when no recipient is configured (never blind-sends)", async () => {
    const { pg, calls } = fakePgrest();
    const actionDispatch = vi.fn(async () => ({}));
    const graph: FlowGraph = { id: "g-norec", nodes: [{ id: "k", typeId: "action.notify", config: {} }], edges: [] };
    const result = await executeFlowGraph(graph, ctx(), { pgrestUser: pg, actionDispatch });
    expect(result.status).toBe("complete");
    expect(actionDispatch).not.toHaveBeenCalled();
    const k = calls.find((c) => (c.params.p_metadata as { flowboard?: { nodeId?: string } })?.flowboard?.nodeId === "k");
    expect((k?.params.p_metadata as { flowboard?: { status?: string } })?.flowboard?.status).toBe("skipped");
  });

  it("records an errored step when actionDispatch throws — without aborting the run", async () => {
    const { pg, calls } = fakePgrest();
    const actionDispatch = vi.fn(async () => {
      throw new Error("outbox down");
    });
    const graph: FlowGraph = {
      id: "g-act-err",
      nodes: [
        { id: "k", typeId: "action.email_send", config: { recipient: "a@b.c" } },
        { id: "t", typeId: "trigger.x" },
      ],
      edges: [{ id: "e", source: "k", target: "t" }],
    };
    const result = await executeFlowGraph(graph, ctx(), { pgrestUser: pg, actionDispatch });
    expect(result.status).toBe("complete"); // run continues past the failed action
    const k = calls.find((c) => (c.params.p_metadata as { flowboard?: { nodeId?: string } })?.flowboard?.nodeId === "k");
    expect((k?.params.p_metadata as { flowboard?: { status?: string } })?.flowboard?.status).toBe("error");
  });
});
