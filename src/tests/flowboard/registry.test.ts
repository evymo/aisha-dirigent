import { describe, it, expect } from "vitest";
import {
  agentToDescriptor,
  buildFlowRegistry,
  builtinProvider,
  mcpToolToDescriptor,
  n8nNodeToDescriptor,
  mergeRegistry,
} from "@/lib/flowboard/registry";
import { makeRegistry } from "./fixtures";

describe("flowboard/registry", () => {
  it("federates builtin + agent_catalog + mcp into one catalog", async () => {
    const reg = await makeRegistry();
    expect(reg.get("trigger.email_inbound")?.source).toBe("builtin");
    expect(reg.get("agent.knowledge")?.kind).toBe("agent");
    expect(reg.get("tool.search_knowledge")?.kind).toBe("tool");
    expect(reg.byKind("gate").length).toBeGreaterThan(0);
  });

  it("maps a critical agent to confidential sensitivity", () => {
    const d = agentToDescriptor({ slug: "guardian", safety_level: "critical" });
    expect(d.sensitivity).toBe("confidential");
    expect(d.engines).toContain("sandbox");
    expect(d.ports.some((p) => p.type === "ai_tool" && p.direction === "in")).toBe(true);
  });

  it("maps an mcp tool to an ai_tool output", () => {
    const d = mcpToolToDescriptor({ name: "search_knowledge" });
    expect(d.ports).toHaveLength(1);
    expect(d.ports[0]).toMatchObject({ type: "ai_tool", direction: "out" });
  });

  it("marks an n8n trigger node and a regular node", () => {
    const trig = n8nNodeToDescriptor({ type: "n8n-nodes-base.webhook", isTrigger: true });
    expect(trig.kind).toBe("trigger");
    expect(trig.engines).toEqual(["n8n"]);
    const act = n8nNodeToDescriptor({ type: "n8n-nodes-base.gmail", egress: true });
    expect(act.kind).toBe("action");
    expect(act.egress).toBe(true);
  });

  it("de-duplicates by typeId (first provider wins)", async () => {
    const a = await builtinProvider().load();
    const merged = mergeRegistry([a, a]);
    expect(merged.all().length).toBe(a.length);
  });
});
