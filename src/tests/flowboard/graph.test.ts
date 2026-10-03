import { describe, it, expect } from "vitest";
import { validateGraph } from "@/lib/flowboard/graph";
import { makeRegistry, makeGraph } from "./fixtures";

describe("flowboard/graph validation", () => {
  it("accepts a valid trigger -> action chain", async () => {
    const reg = await makeRegistry();
    const g = makeGraph(
      [
        { id: "t", typeId: "trigger.email_inbound" },
        { id: "a", typeId: "action.story_entry" },
      ],
      [{ id: "e1", source: "t", sourcePort: "out", target: "a", targetPort: "in" }],
    );
    expect(validateGraph(g, reg).ok).toBe(true);
  });

  it("rejects incompatible ports", async () => {
    const reg = await makeRegistry();
    // ai_tool output of a tool cannot feed a main input of an action.
    const g = makeGraph(
      [
        { id: "tool", typeId: "tool.search_knowledge" },
        { id: "a", typeId: "action.story_entry" },
      ],
      [{ id: "e1", source: "tool", sourcePort: "tool", target: "a", targetPort: "in" }],
    );
    const res = validateGraph(g, reg);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.code === "INCOMPATIBLE_PORTS")).toBe(true);
  });

  it("flags a missing required input", async () => {
    const reg = await makeRegistry();
    const g = makeGraph([{ id: "a", typeId: "action.email_send" }], []);
    const res = validateGraph(g, reg);
    expect(res.errors.some((e) => e.code === "MISSING_REQUIRED_INPUT")).toBe(true);
  });

  it("rejects an engine-unsupported node for the n8n target (gate.consent is sandbox-only)", async () => {
    // Consent fail-CLOSED on the n8n engine: gate.consent declares engines:["sandbox"],
    // so validating FOR the n8n target must fail — the compiler must never get the
    // chance to degrade a human-approval gate into a noOp passthrough.
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
    const res = validateGraph(g, reg, { engine: "n8n" });
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.code === "ENGINE_UNSUPPORTED_NODE" && e.nodeId === "gate")).toBe(true);
    // the same graph is fine for the sandbox engine, where the gate is enforced
    expect(validateGraph(g, reg, { engine: "sandbox" }).ok).toBe(true);
    // and without an engine option the (engine-agnostic) validation is unchanged
    expect(validateGraph(g, reg).ok).toBe(true);
  });

  it("rejects gate.compliance for the n8n target (no real n8n compliance node exists yet)", async () => {
    const reg = await makeRegistry();
    const g = makeGraph(
      [
        { id: "t", typeId: "trigger.webhook" },
        { id: "gate", typeId: "gate.compliance" },
      ],
      [{ id: "e1", source: "t", sourcePort: "out", target: "gate", targetPort: "in" }],
    );
    const res = validateGraph(g, reg, { engine: "n8n" });
    expect(res.errors.some((e) => e.code === "ENGINE_UNSUPPORTED_NODE" && e.nodeId === "gate")).toBe(true);
  });

  it("requires a consent gate between a confidential source and egress", async () => {
    const reg = await makeRegistry();
    const g = makeGraph(
      [
        { id: "ag", typeId: "agent.guardian" }, // confidential
        { id: "mail", typeId: "action.email_send" }, // egress
      ],
      [{ id: "e1", source: "ag", sourcePort: "out", target: "mail", targetPort: "in" }],
    );
    const res = validateGraph(g, reg);
    expect(res.errors.some((e) => e.code === "CONSENT_GATE_REQUIRED")).toBe(true);
  });

  it("clears the governance error once a gate is inserted", async () => {
    const reg = await makeRegistry();
    const g = makeGraph(
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
    const res = validateGraph(g, reg);
    expect(res.errors.some((e) => e.code === "CONSENT_GATE_REQUIRED")).toBe(false);
  });
});
