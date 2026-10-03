/**
 * Flowboard n8n engine path — TEST-FIRST spec.
 *
 * The sandbox engine is fully implemented + covered (flowboardSandboxExecutor.test +
 * flowboard-runtime.integration.test). The n8n engine target is staged: POST
 * /flowboard-execute currently returns 501 for engine_pin='n8n'. This file specifies
 * the n8n path so the implementation is driven by tests:
 *
 *   compile (READY)  → @aisha/flowboard-core compileToN8n produces a pushable workflow
 *   push    (TODO)   → /flowboard-execute compiles + POSTs to the n8n REST API
 *   run     (TODO)   → an n8n execution webhook maps node executions → story_entries
 *                      via the SAME provenance contract as the sandbox (buildRunEntries).
 *
 * The READY block runs today; the TODO blocks are describe.skip until the feature lands.
 */
import { describe, it, expect } from "vitest";
import {
  compileToN8n,
  buildFlowRegistry,
  builtinProvider,
  agentCatalogProvider,
  buildRunEntries,
  type FlowGraph,
  type AgentCatalogRow,
} from "@aisha/flowboard-core";

const registry = () =>
  buildFlowRegistry([
    builtinProvider(),
    agentCatalogProvider(async () => [{ slug: "knowledge", purpose: "KB", safety_level: "standard" } as AgentCatalogRow]),
  ]);

const helpGraph: FlowGraph = {
  id: "g-n8n",
  version: 1,
  name: "Help inbox (n8n)",
  nodes: [
    { id: "t", typeId: "trigger.email_inbound", position: { x: 0, y: 0 }, config: {}, draft: false },
    { id: "a", typeId: "agent.knowledge", position: { x: 240, y: 0 }, config: {}, draft: false },
    { id: "k", typeId: "action.email_send", position: { x: 480, y: 0 }, config: {}, draft: false },
  ],
  edges: [
    { id: "e1", source: "t", sourcePort: "out", target: "a", targetPort: "in" },
    { id: "e2", source: "a", sourcePort: "out", target: "k", targetPort: "in" },
  ],
  meta: {},
};

describe("flowboard n8n engine — compile contract (READY)", () => {
  it("compiles a stored graph to a pushable n8n workflow (agent + auto-wired router + connections)", async () => {
    const wf = compileToN8n(helpGraph, await registry());
    expect(wf.name).toBe("Help inbox (n8n)");
    expect(wf.nodes.some((n) => n.type === "@n8n/n8n-nodes-langchain.agent")).toBe(true);
    expect(wf.nodes.some((n) => n.type === "n8n-nodes-aisha.aishaLlmRouter")).toBe(true);
    // every edge becomes a connection; the workflow is a complete REST payload
    expect(Object.keys(wf.connections).length).toBeGreaterThan(0);
    expect(wf.meta).toMatchObject({ generatedBy: "aisha-flowboard", flowboardGraphId: "g-n8n" });
  });

  it("the n8n run provenance contract reuses the SAME mapper as the sandbox (engine='n8n')", () => {
    const entries = buildRunEntries(
      { storyId: "s", runId: "r", graphId: "g-n8n", graphName: "Help inbox (n8n)", engine: "n8n" },
      [
        { nodeId: "t", typeId: "trigger.email_inbound", kind: "trigger", label: "in", status: "ok", startedAt: "2026-01-01T00:00:00Z" },
        { nodeId: "a", typeId: "agent.knowledge", kind: "agent", label: "triage", status: "ok", startedAt: "2026-01-01T00:00:01Z" },
      ],
    );
    expect(entries[0].p_entry_type).toBe("flow_run");
    expect((entries[0].p_metadata.flowboard as { engine: string }).engine).toBe("n8n");
    expect(entries).toHaveLength(3);
  });
});

// push (compile → CREATE → ACTIVATE → flow_run provenance) is IMPLEMENTED in routes/flowboard-run.ts
// and verified against a live n8n + DB by flowboard-n8n.integration.test.ts (the "200 = real
// execution" contract). Unit-level: flowboard-run.route.test asserts the 503-when-unconfigured gate.

describe.skip("flowboard n8n engine — per-node run provenance webhook (next layer)", () => {
  it("an n8n execution callback maps node executions → story_entries (user-scoped, audited)", async () => {
    // GIVEN n8n executes the pushed workflow and calls back with { story_id, graph_id, run_id, steps[] }
    //       (auth: X-N8N-API-Key, like routes/callback.ts)
    // WHEN the webhook handler maps the execution via buildRunEntries(engine:'n8n', steps)
    // THEN it writes flow_run + one automation_step per node into the run's StoryLoop story
    //      (a service-role create_story_entry path that stamps created_by = the flow owner)
    // AND the StoryLoop timeline shows the same iconographic provenance as a sandbox run.
    expect(true).toBe(true);
  });
});
