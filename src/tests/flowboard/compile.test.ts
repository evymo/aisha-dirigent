import { describe, it, expect } from "vitest";
import { selectEngine } from "@/lib/flowboard/engine";
import { compileGraph } from "@/lib/flowboard/compile";
import { makeRegistry, makeGraph } from "./fixtures";

describe("flowboard/engine routing", () => {
  it("routes a low-sensitivity flow to n8n", async () => {
    const reg = await makeRegistry();
    const g = makeGraph(
      [
        { id: "t", typeId: "trigger.webhook" },
        { id: "n", typeId: "action.notify" },
      ],
      [{ id: "e1", source: "t", sourcePort: "out", target: "n", targetPort: "in" }],
    );
    expect(selectEngine(g, reg).target).toBe("n8n");
  });

  it("routes a flow with a gate to the governed sandbox", async () => {
    const reg = await makeRegistry();
    const g = makeGraph(
      [
        { id: "t", typeId: "trigger.webhook" },
        { id: "gate", typeId: "gate.consent" },
        { id: "n", typeId: "action.notify" },
      ],
      [
        { id: "e1", source: "t", sourcePort: "out", target: "gate", targetPort: "in" },
        { id: "e2", source: "gate", sourcePort: "out", target: "n", targetPort: "in" },
      ],
    );
    expect(selectEngine(g, reg).target).toBe("sandbox");
  });
});

describe("flowboard/compile", () => {
  it("compiles to an n8n workflow and auto-wires AishaLlmRouter", async () => {
    const reg = await makeRegistry();
    const g = makeGraph(
      [
        { id: "t", typeId: "trigger.webhook" },
        { id: "ag", typeId: "agent.knowledge" },
        { id: "n", typeId: "action.notify" },
      ],
      [
        { id: "e1", source: "t", sourcePort: "out", target: "ag", targetPort: "in" },
        { id: "e2", source: "ag", sourcePort: "out", target: "n", targetPort: "in" },
      ],
    );
    const res = compileGraph(g, reg);
    expect(res.ok).toBe(true);
    expect(res.decision.target).toBe("n8n");
    const wf = res.n8n!;
    expect(wf.nodes.some((node) => node.type === "@n8n/n8n-nodes-langchain.agent")).toBe(true);
    expect(wf.nodes.some((node) => node.type === "n8n-nodes-aisha.aishaLlmRouter")).toBe(true);
    // router -> agent connection exists under ai_languageModel
    const routerName = wf.nodes.find((n) => n.type.endsWith("aishaLlmRouter"))!.name;
    expect(wf.connections[routerName]?.ai_languageModel).toBeTruthy();
  });

  it("compiles a governed flow to a sandbox RoutePlan", async () => {
    const reg = await makeRegistry();
    const g = makeGraph(
      [
        { id: "t", typeId: "trigger.webhook" },
        { id: "ag", typeId: "agent.guardian" },
        { id: "gate", typeId: "gate.compliance" },
      ],
      [
        { id: "e1", source: "t", sourcePort: "out", target: "ag", targetPort: "in" },
        { id: "e2", source: "ag", sourcePort: "out", target: "gate", targetPort: "in" },
      ],
    );
    const res = compileGraph(g, reg);
    expect(res.ok).toBe(true);
    expect(res.decision.target).toBe("sandbox");
    expect(res.sandbox!.steps.map((s) => s.slug)).toContain("guardian");
    expect(res.sandbox!.stopConditions.mustPassCompliance).toBe(true);
  });
});

describe("flowboard/compile — fail-loud n8n compiler (no noOp passthrough)", () => {
  it("compileToN8n THROWS on a consent gate instead of degrading it to a noOp", async () => {
    // Regression: gate.consent used to fall back to n8n-nodes-base.noOp — a human-approval
    // gate silently compiled into a passthrough (fail-open). Direct compileToN8n calls now
    // refuse; the run route rejects earlier via validateGraph(..., { engine: "n8n" }).
    const { compileToN8n } = await import("@/lib/flowboard/compile");
    const reg = await makeRegistry();
    const g = makeGraph(
      [
        { id: "t", typeId: "trigger.webhook" },
        { id: "gate", typeId: "gate.consent" },
      ],
      [{ id: "e1", source: "t", sourcePort: "out", target: "gate", targetPort: "in" }],
    );
    expect(() => compileToN8n(g, reg)).toThrow(/no n8n node mapping/);
  });

  it("compileToN8n THROWS on an unknown node type instead of silently dropping the node", async () => {
    const { compileToN8n } = await import("@/lib/flowboard/compile");
    const reg = await makeRegistry();
    const g = makeGraph([{ id: "x", typeId: "mystery.node" }], []);
    expect(() => compileToN8n(g, reg)).toThrow(/unknown node type/);
  });
});
