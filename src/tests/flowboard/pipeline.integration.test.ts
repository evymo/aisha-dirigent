/**
 * Flowboard pipeline integration — the whole engine-agnostic core wired as ONE flow,
 * across every component: recipe (AISHA draft) → federated registry → graph validation
 * (ports + governance) → engine routing → compile (n8n workflow / sandbox RoutePlan) →
 * StoryLoop provenance. Plus the cross-component CONTRACT seam: the package FlowGraph
 * the web emits must be consumable by the svc-ai-chat executor's minimal runtime shape.
 *
 * Pure-core (no DB / service / network) so it runs in the normal web vitest. The DB+executor
 * A-to-Z is covered separately by services/svc-ai-chat flowboard-runtime.integration.test.ts.
 */
import { describe, it, expect } from "vitest";
import {
  validateGraph,
  selectEngine,
  compileGraph,
  compileToN8n,
  draftHelpInboxFlow,
  buildRunEntries,
} from "@/lib/flowboard";
import { makeRegistry, makeGraph } from "./fixtures";

describe("flowboard pipeline integration (recipe → validate → route → compile → provenance)", () => {
  it("the help@ recipe validates, routes to n8n, and compiles to a runnable n8n workflow", async () => {
    const reg = await makeRegistry();
    const g = draftHelpInboxFlow(); // what the Dirigent draft_flow tool emits

    expect(validateGraph(g, reg).ok).toBe(true); // ports + governance OK
    expect(selectEngine(g, reg).target).toBe("n8n"); // low-sensitivity → n8n fast path

    const res = compileGraph(g, reg);
    expect(res.ok).toBe(true);
    const types = res.n8n!.nodes.map((n) => n.type);
    expect(types).toContain("@n8n/n8n-nodes-langchain.agent"); // the triage agent
    expect(types).toContain("n8n-nodes-aisha.aishaLlmRouter"); // auto-wired model
  });

  it("governance: a confidential source → egress is BLOCKED without a gate, then routes to sandbox once gated", async () => {
    const reg = await makeRegistry(); // has agent.guardian (safety_level critical → confidential)

    const ungated = makeGraph(
      [
        { id: "ag", typeId: "agent.guardian" },
        { id: "mail", typeId: "action.email_send" },
      ],
      [{ id: "e1", source: "ag", sourcePort: "out", target: "mail", targetPort: "in" }],
    );
    expect(
      validateGraph(ungated, reg).errors.some((e) => e.code === "CONSENT_GATE_REQUIRED"),
    ).toBe(true);

    const gated = makeGraph(
      [
        { id: "ag", typeId: "agent.guardian" },
        { id: "gate", typeId: "gate.consent" },
        { id: "mail", typeId: "action.email_send" },
      ],
      [
        { id: "e1", source: "ag", sourcePort: "out", target: "gate", targetPort: "in" },
        { id: "e2", source: "gate", sourcePort: "out", target: "mail", targetPort: "in" },
      ],
    );
    expect(validateGraph(gated, reg).ok).toBe(true);
    const decision = selectEngine(gated, reg);
    expect(decision.target).toBe("sandbox"); // a gate forces the governed runtime
    const res = compileGraph(gated, reg);
    expect(res.sandbox!.stopConditions.requireHumanApproval).toBe(true); // consent gate → human approval
  });

  it("CONTRACT: the package FlowGraph is consumable by the svc executor's minimal runtime shape", () => {
    // The executor only reads { id, nodes:[{id,typeId,config?}], edges:[{id,source,target}] }.
    // This locks the web↔service seam so the two FlowGraph shapes never drift apart.
    const g = draftHelpInboxFlow();
    expect(typeof g.id).toBe("string");
    for (const n of g.nodes) {
      expect(typeof n.id).toBe("string");
      expect(typeof n.typeId).toBe("string");
      expect(typeof n.config).toBe("object");
    }
    for (const e of g.edges) {
      expect(typeof e.id).toBe("string");
      expect(typeof e.source).toBe("string");
      expect(typeof e.target).toBe("string");
    }
  });

  it("run provenance emits a flow_run umbrella + per-node steps, all with lucide icon names", () => {
    const entries = buildRunEntries(
      { storyId: "s", runId: "r", graphId: "g", graphName: "Help inbox", engine: "n8n" },
      [
        { nodeId: "t", typeId: "trigger.email_inbound", kind: "trigger", label: "in", status: "ok", startedAt: "2026-01-01T00:00:00Z" },
        { nodeId: "a", typeId: "agent.knowledge", kind: "agent", label: "triage", status: "ok", startedAt: "2026-01-01T00:00:01Z" },
      ],
    );
    expect(entries).toHaveLength(3); // umbrella + 2 steps
    expect(entries[0].p_entry_type).toBe("flow_run");
    expect(
      entries.every((e) => /^[a-z-]+$/.test((e.p_metadata.flowboard as { icon: string }).icon)),
    ).toBe(true);
  });

  it("n8n compile injects a provenance callback node carrying the run context + execution id", async () => {
    const reg = await makeRegistry();
    const g = makeGraph(
      [
        { id: "t", typeId: "trigger.webhook" },
        { id: "a", typeId: "agent.knowledge" },
      ],
      [{ id: "e", source: "t", sourcePort: "out", target: "a", targetPort: "in" }],
    );
    const wf = compileToN8n(g, reg, {
      callback: { url: "http://svc-ai-chat/flowboard-n8n-callback", storyId: "s1", ownerId: "u1", runId: "r1" },
    });
    const cb = wf.nodes.find((n) => n.type === "n8n-nodes-base.httpRequest");
    expect(cb).toBeTruthy();
    expect(cb!.parameters.url).toBe("http://svc-ai-chat/flowboard-n8n-callback");
    const body = (cb!.parameters.bodyParameters as { parameters: { name: string; value: string }[] }).parameters;
    expect(body.find((p) => p.name === "run_id")?.value).toBe("r1");
    expect(body.find((p) => p.name === "owner_id")?.value).toBe("u1");
    expect(body.find((p) => p.name === "execution_id")?.value).toContain("$execution.id");
    // wired from the sink node (agent a is the terminal of t→a)
    const agentName = wf.nodes.find((n) => n.type === "@n8n/n8n-nodes-langchain.agent")!.name;
    expect(wf.connections[agentName]?.main?.[0]?.some((c) => c.node === cb!.name)).toBe(true);
    // no callback node when opts omitted
    expect(compileToN8n(g, reg).nodes.some((n) => n.type === "n8n-nodes-base.httpRequest")).toBe(false);
  });
});
