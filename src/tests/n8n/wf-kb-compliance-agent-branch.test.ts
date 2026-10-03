import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Locks the agent branch added to WF_KB_COMPLIANCE_GATE so AISHA compliance
 * review works for marketplace agents (resource_type='agent'), not just rules.
 * The generic n8n-workflow-integrity gate validates structure; this asserts the
 * feature-specific wiring + that the resource-agnostic callbacks stayed intact.
 */
interface SwitchRule {
  outputKey?: string;
  conditions?: unknown;
}
interface BodyParam {
  name?: string;
  value?: string;
}
interface EvalMessage {
  role?: string;
  content?: string;
}
interface NodeParameters {
  jsonOutput?: string;
  url?: string;
  rules?: { values?: SwitchRule[] };
  bodyParameters?: { parameters?: BodyParam[] };
  messages?: { values?: EvalMessage[] };
  [key: string]: unknown;
}
interface N8nNode {
  name: string;
  type?: string;
  parameters?: NodeParameters;
  [key: string]: unknown;
}
interface ConnectionTarget {
  node: string;
}
interface N8nWorkflow {
  nodes: N8nNode[];
  connections: Record<string, { main?: ConnectionTarget[][] }>;
}

const WF = JSON.parse(
  readFileSync(join(process.cwd(), "n8n/workflows/WF_KB_COMPLIANCE_GATE.json"), "utf-8"),
) as N8nWorkflow;

const node = (name: string): N8nNode => {
  const found = WF.nodes.find((n) => n.name === name);
  if (!found) throw new Error(`node not found: ${name}`);
  return found;
};
const conn = (name: string): ConnectionTarget[][] => WF.connections[name]?.main ?? [];

describe("WF_KB_COMPLIANCE_GATE — agent compliance branch", () => {
  it("Parse Publish Request surfaces resource_type + plugin_id (+ name/description fallbacks)", () => {
    const out = node("Parse Publish Request").parameters?.jsonOutput ?? "";
    expect(out).toContain("resource_type");
    expect(out).toContain("plugin_id");
    expect(out).toContain("$json.body.name"); // title fallback for agents
    expect(out).toContain("$json.body.description"); // summary fallback
  });

  it("has a Resource Type Router switch keyed on resource_type", () => {
    const router = node("Resource Type Router");
    expect(router.type).toBe("n8n-nodes-base.switch");
    const rule = router.parameters?.rules?.values?.[0];
    expect(rule?.outputKey).toBe("agent");
    expect(JSON.stringify(rule?.conditions)).toContain("resource_type");
  });

  it("has a Fetch Agent Detail node calling get_agent_publish_detail with p_plugin_id", () => {
    const fetch = node("Fetch Agent Detail");
    expect(fetch.parameters?.url).toContain("get_agent_publish_detail");
    const param = fetch.parameters?.bodyParameters?.parameters?.find((p) => p.name === "p_plugin_id");
    expect(param?.value).toContain("plugin_id");
  });

  it("routes Parse → Router → {agent: Fetch Agent Detail, fallback: Fetch Full Rule Content} → KB Context", () => {
    expect(conn("Parse Publish Request")[0][0].node).toBe("Resource Type Router");
    const r = conn("Resource Type Router");
    expect(r[0][0].node).toBe("Fetch Agent Detail"); // output 0 = agent rule
    expect(r[1][0].node).toBe("Fetch Full Rule Content"); // output 1 = fallback (expert_rule)
    expect(conn("Fetch Agent Detail")[0][0].node).toBe("Fetch KB Context for Evaluation");
  });

  it("makes the AISHA evaluation content agent-aware", () => {
    const userMsg =
      node("AISHA Compliance Evaluation").parameters?.messages?.values?.find((m) => m.role === "user")
        ?.content ?? "";
    expect(userMsg).toContain("resource_type === 'agent'");
    expect(userMsg).toContain("agent_spec");
    expect(userMsg).toContain("Fetch Agent Detail");
    // null-guard: a missing/NULL get_agent_publish_detail body must not throw on
    // .capabilities/.agent_spec (optional chaining), else the whole eval errors.
    expect(userMsg).toContain("json?.capabilities");
    expect(userMsg).toContain("json?.agent_spec");
  });

  it("leaves the resource-agnostic decision callbacks intact (still 3 → fn_aisha_kb_decision)", () => {
    const callbacks = WF.nodes.filter((n) => n.parameters?.url?.includes("fn_aisha_kb_decision"));
    expect(callbacks).toHaveLength(3); // approved / rejected / escalated
    expect(node("Decision Router")).toBeTruthy();
  });
});
