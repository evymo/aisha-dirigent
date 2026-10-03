import { describe, it, expect } from "vitest";
import { draftHelpInboxFlow } from "@/lib/flowboard/recipes";
import { compileGraph } from "@/lib/flowboard/compile";
import { validateGraph } from "@/lib/flowboard/graph";
import { makeRegistry } from "./fixtures";

describe("flowboard/recipes — help@ inbox", () => {
  it("produces a valid graph that compiles to n8n", async () => {
    const reg = await makeRegistry();
    const g = draftHelpInboxFlow();
    expect(validateGraph(g, reg).ok).toBe(true);
    const res = compileGraph(g, reg);
    expect(res.ok).toBe(true);
    expect(res.decision.target).toBe("n8n");
    expect(res.n8n!.nodes.some((n) => n.type === "@n8n/n8n-nodes-langchain.agent")).toBe(true);
  });

  it("uses StoryLoop-known entry types for provenance", () => {
    const g = draftHelpInboxFlow({ storyAgentSlug: "knowledge" });
    expect(g.nodes.find((n) => n.id === "s")?.config.entry_type).toBe("automation_step");
  });
});
