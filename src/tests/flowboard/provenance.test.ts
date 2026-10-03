import { describe, it, expect } from "vitest";
import {
  buildRunEntries,
  buildStepEntry,
  iconFor,
  type FlowRunContext,
  type NodeRunRecord,
} from "@/lib/flowboard/provenance";

const ctx: FlowRunContext = {
  storyId: "story-1",
  runId: "run-1",
  graphId: "g1",
  graphName: "help@ inbox",
  engine: "sandbox",
};

const rec = (typeId: string, kind: NodeRunRecord["kind"]): NodeRunRecord => ({
  nodeId: "n1",
  typeId,
  kind,
  label: typeId,
  status: "ok",
  startedAt: "2026-06-21T10:00:00Z",
});

describe("flowboard/provenance", () => {
  it("reuses an existing entry type for an inbound e-mail", () => {
    const e = buildStepEntry(ctx, rec("trigger.email_inbound", "trigger"));
    expect(e.p_entry_type).toBe("email");
    expect(e.p_metadata.flowboard).toMatchObject({ icon: "mail", status: "ok" });
  });

  it("falls back to automation_step for generic nodes", () => {
    const e = buildStepEntry(ctx, rec("action.story_entry", "action"));
    expect(e.p_entry_type).toBe("automation_step");
    expect(e.p_story_id).toBe("story-1");
  });

  it("emits an umbrella flow_run plus one entry per node", () => {
    const entries = buildRunEntries(ctx, [
      rec("trigger.email_inbound", "trigger"),
      rec("agent.knowledge", "agent"),
    ]);
    expect(entries).toHaveLength(3);
    expect(entries[0].p_entry_type).toBe("flow_run");
  });

  it("picks lucide icon names by type then kind", () => {
    expect(iconFor("action.email_send", "action")).toBe("send");
    expect(iconFor("unknown.thing", "agent")).toBe("bot");
  });
});
