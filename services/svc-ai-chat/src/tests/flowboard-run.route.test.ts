import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

// Mock the route's collaborators so the test exercises the route's own wiring
// (auth gate, story_id guard, graph load, engine routing, error handling) without
// a real DB or JWT. The executor logic itself is covered by flowboardSandboxExecutor.test,
// the n8n client by n8n-client.unit.test (and the real create/activate by
// flowboard-n8n.integration.test against a live n8n).
vi.mock("../auth.js", () => ({ verifyToken: vi.fn() }));
vi.mock("../lib/rpcAdapter.js", () => ({ createUserRpcAdapter: vi.fn() }));
vi.mock("../lib/flowboardSandboxExecutor.js", () => ({ executeFlowGraph: vi.fn() }));
vi.mock("../lib/n8n-client.js", async (importOriginal) => {
  // Keep the REAL N8nEngineError class so the route's `instanceof` mapping is exercised;
  // stub only the network-touching functions.
  const actual = await importOriginal<typeof import("../lib/n8n-client.js")>();
  return {
    ...actual,
    pushWorkflowToN8n: vi.fn(),
    activateWorkflowInN8n: vi.fn(),
  };
});

import { flowboardRunRoutes } from "../routes/flowboard-run.js";
import { verifyToken } from "../auth.js";
import { createUserRpcAdapter } from "../lib/rpcAdapter.js";
import { executeFlowGraph } from "../lib/flowboardSandboxExecutor.js";
import { pushWorkflowToN8n, activateWorkflowInN8n, N8nEngineError } from "../lib/n8n-client.js";

const AUTH = { authorization: "Bearer ey.header.payload" };

async function buildApp() {
  const app = Fastify();
  await app.register(flowboardRunRoutes);
  await app.ready();
  return app;
}

function rpcReturning(data: unknown, error: unknown = null) {
  (createUserRpcAdapter as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue({
    rpc: async () => ({ data, error }),
  });
}

/** A structurally valid graph the n8n engine CAN run (no gates). */
const N8N_OK_GRAPH = {
  id: "g",
  name: "Fast flow",
  version: 1,
  nodes: [
    { id: "t", typeId: "trigger.webhook", position: { x: 0, y: 0 }, config: {}, draft: false },
    { id: "n", typeId: "action.notify", position: { x: 200, y: 0 }, config: {}, draft: false },
  ],
  edges: [{ id: "e1", source: "t", sourcePort: "out", target: "n", targetPort: "in" }],
  meta: {},
};

/** The same graph with a consent gate on the path — sandbox-only by descriptor. */
const N8N_GATED_GRAPH = {
  ...N8N_OK_GRAPH,
  nodes: [
    N8N_OK_GRAPH.nodes[0],
    { id: "gate", typeId: "gate.consent", position: { x: 100, y: 0 }, config: {}, draft: false },
    N8N_OK_GRAPH.nodes[1],
  ],
  edges: [
    { id: "e1", source: "t", sourcePort: "out", target: "gate", targetPort: "in" },
    { id: "e2", source: "gate", sourcePort: "out", target: "n", targetPort: "in" },
  ],
};

describe("POST /flowboard-execute", () => {
  beforeEach(() => vi.clearAllMocks());

  it("401 when there is no bearer token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/flowboard-execute", payload: {} });
    expect(res.statusCode).toBe(401);
    expect(verifyToken).not.toHaveBeenCalled();
    await app.close();
  });

  it("400 when graph_id or story_id is missing (the run is always story-scoped)", async () => {
    (verifyToken as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({ sub: "u1" });
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/flowboard-execute", headers: AUTH, payload: {} });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("404 when the graph is not found or access is denied", async () => {
    (verifyToken as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({ sub: "u1" });
    rpcReturning(null);
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/flowboard-execute", headers: AUTH, payload: { graph_id: "g1", story_id: "s1" } });
    expect(res.statusCode).toBe(404);
    expect(executeFlowGraph).not.toHaveBeenCalled();
    await app.close();
  });

  it("503 for the n8n engine target when n8n is not configured (no N8N_BASE_URL/API_KEY)", async () => {
    // The client throws not_configured with no n8n env (see n8n-client.unit.test) — the route
    // maps it to 503, NEVER a silent sandbox fallback. The real create→activate→provenance is
    // covered against a live n8n by flowboard-n8n.integration.test. The sandbox engine is unaffected.
    (verifyToken as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({ sub: "u1" });
    (pushWorkflowToN8n as unknown as { mockRejectedValue: (v: unknown) => void }).mockRejectedValue(
      new N8nEngineError("not_configured", "n8n engine is not configured"),
    );
    rpcReturning({ graph: N8N_OK_GRAPH, engine_pin: "n8n" });
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/flowboard-execute", headers: AUTH, payload: { graph_id: "g1", story_id: "s1" } });
    expect(res.statusCode).toBe(503);
    expect(executeFlowGraph).not.toHaveBeenCalled();
    await app.close();
  });

  it("422 FAIL-CLOSED for a consent-gated graph pinned to n8n — the gate must never compile to a noOp passthrough", async () => {
    // THE consent-fail-closed regression test for the n8n engine: gate.consent declares
    // engines:["sandbox"], so an n8n-pinned run is rejected by engine-aware validation
    // BEFORE any side effect (no n8n create, no provenance). Previously the gate compiled
    // to n8n-nodes-base.noOp — the human-approval halt was silently dropped (fail-OPEN).
    (verifyToken as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({ sub: "u1" });
    rpcReturning({ graph: N8N_GATED_GRAPH, engine_pin: "n8n" });
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/flowboard-execute", headers: AUTH, payload: { graph_id: "g1", story_id: "s1" } });
    expect(res.statusCode).toBe(422);
    const body = res.json() as { error: string; errors: { code: string; nodeId?: string }[] };
    expect(body.error).toBe("graph_validation_failed");
    expect(body.errors.some((e) => e.code === "ENGINE_UNSUPPORTED_NODE" && e.nodeId === "gate")).toBe(true);
    expect(pushWorkflowToN8n).not.toHaveBeenCalled(); // halted BEFORE any side effect
    expect(executeFlowGraph).not.toHaveBeenCalled(); // and no silent sandbox fallback either
    await app.close();
  });

  it("200 running_in_n8n when create + activate + provenance all really succeeded", async () => {
    (verifyToken as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({ sub: "u1" });
    (pushWorkflowToN8n as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      workflowId: "wf42",
      active: false,
      name: "Fast flow",
    });
    (activateWorkflowInN8n as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(undefined);
    rpcReturning({ graph: N8N_OK_GRAPH, engine_pin: "n8n" });
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/flowboard-execute", headers: AUTH, payload: { graph_id: "g1", story_id: "s1" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "running_in_n8n", engine: "n8n", n8nWorkflowId: "wf42", active: true });
    expect(pushWorkflowToN8n).toHaveBeenCalledOnce();
    expect(activateWorkflowInN8n).toHaveBeenCalledWith("wf42");
    await app.close();
  });

  it("502 when activation fails after create (created-but-inactive = partial failure, fail loud)", async () => {
    (verifyToken as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({ sub: "u1" });
    (pushWorkflowToN8n as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      workflowId: "wf42",
      active: false,
      name: "Fast flow",
    });
    (activateWorkflowInN8n as unknown as { mockRejectedValue: (v: unknown) => void }).mockRejectedValue(
      new N8nEngineError("push_failed", "n8n workflow activate returned 400", 400),
    );
    rpcReturning({ graph: N8N_OK_GRAPH, engine_pin: "n8n" });
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/flowboard-execute", headers: AUTH, payload: { graph_id: "g1", story_id: "s1" } });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ code: "push_failed", n8nWorkflowId: "wf42" });
    await app.close();
  });

  it("422 when the compiled artifact still carries __REMAP__ placeholders (gap #7 — no runtime remapper)", async () => {
    (verifyToken as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({ sub: "u1" });
    (pushWorkflowToN8n as unknown as { mockRejectedValue: (v: unknown) => void }).mockRejectedValue(
      new N8nEngineError("unresolved_placeholder", "compiled workflow still contains __REMAP__ placeholders"),
    );
    rpcReturning({ graph: N8N_OK_GRAPH, engine_pin: "n8n" });
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/flowboard-execute", headers: AUTH, payload: { graph_id: "g1", story_id: "s1" } });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ code: "unresolved_placeholder" });
    await app.close();
  });

  it("runs the sandbox and returns the executor result (incl. a consent halt)", async () => {
    (verifyToken as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({ sub: "u1" });
    rpcReturning({ graph: { id: "g", name: "Flow", nodes: [], edges: [] } });
    (executeFlowGraph as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      runId: "r1",
      status: "awaiting_approval",
      executed: ["t"],
      haltedAtNodeId: "gate",
    });
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/flowboard-execute", headers: AUTH, payload: { graph_id: "g1", story_id: "s1" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "awaiting_approval", haltedAtNodeId: "gate" });
    expect(executeFlowGraph).toHaveBeenCalledOnce();
    await app.close();
  });

  it("500 when the executor throws (e.g. a provenance write fails)", async () => {
    (verifyToken as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({ sub: "u1" });
    rpcReturning({ graph: { id: "g", nodes: [], edges: [] } });
    (executeFlowGraph as unknown as { mockRejectedValue: (v: unknown) => void }).mockRejectedValue(new Error("boom"));
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/flowboard-execute", headers: AUTH, payload: { graph_id: "g1", story_id: "s1" } });
    expect(res.statusCode).toBe(500);
    await app.close();
  });

  it("422 (not 500) when the stored graph is structurally invalid — empty {} default", async () => {
    // flowboard_graphs.graph DEFAULTs to '{}' and is stored verbatim ("validated app-side"); a flow
    // that was never validated at write time must fail-loud here, not throw a TypeError in the compiler.
    (verifyToken as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({ sub: "u1" });
    rpcReturning({ graph: {} });
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/flowboard-execute", headers: AUTH, payload: { graph_id: "g1", story_id: "s1" } });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe("invalid_graph");
    expect(executeFlowGraph).not.toHaveBeenCalled();
    await app.close();
  });

  it("422 (not an uncaught compiler 500) when a stored node is missing position — incl. the n8n target", async () => {
    // This is the exact crash the bug describes: Math.round(inst.position.x) on a node with no position.
    // The upfront guard rejects it before the engine split, so even the n8n path returns a clean 422.
    (verifyToken as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({ sub: "u1" });
    rpcReturning({ graph: { id: "g", nodes: [{ id: "n1", typeId: "builtin.note" }], edges: [] }, engine_pin: "n8n" });
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/flowboard-execute", headers: AUTH, payload: { graph_id: "g1", story_id: "s1" } });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe("invalid_graph");
    await app.close();
  });
});
