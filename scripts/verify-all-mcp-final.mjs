import { AISHA_ACCESS_TOKEN as K, MCP_URL as MCP } from './lib/remote-api.mjs';
const STORY = "a0000000-0000-0000-0000-000000000001";

async function call(method, params) {
  const r = await fetch(MCP, {
      signal: AbortSignal.timeout(30000),
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${K}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: method, arguments: params } }),
  });
  if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
  const data = await r.json();
  if (data.error) return { ok: false, error: data.error.message || JSON.stringify(data.error) };
  const text = data.result?.content?.[0]?.text || "";
  return { ok: true, text };
}

const tests = [
  // Knowledge Search
  { name: "search_knowledge",        args: { query: "RPC pattern", limit: 3 }, expect: t => t.includes("RPC") },
  { name: "search_knowledge",        args: { query: "security", category: "security_practice" }, expect: t => t.length > 50 },
  { name: "search_knowledge_v2",     args: { query: "audit journal", limit: 3 }, expect: t => t.length > 50 },
  
  // Expert rules
  { name: "get_expert_rule",         args: { slug: "aisha-rpc-only-pattern" }, expect: t => t.includes("RPC") },
  { name: "get_expertise_areas",     args: {}, expect: t => t.includes("area") || t.includes("Area") },
  
  // Agent knowledge (FIXED!)
  { name: "get_agent_knowledge",     args: { agent_slug: "dirigent" }, expect: t => t.includes("17") || t.includes("rules") },
  { name: "get_agent_knowledge",     args: { agent_slug: "compliance_gate" }, expect: t => t.includes("rules") },
  
  // Story context
  { name: "get_story_context",       args: { story_id: STORY }, expect: t => t.includes("Evymo") },
  
  // Compliance
  { name: "validate_compliance",     args: { code_snippet: "supabase.from('users').select('*')", story_id: STORY }, expect: t => t.length > 50 },
  
  // Context composition
  { name: "compose_context",         args: { story_id: STORY, context_profile_slug: "rules_only" }, expect: t => t.includes("context") || t.includes("rules") || t.length > 100 },
  { name: "compose_context",         args: { story_id: STORY, context_profile_slug: "repo_plus_rules" }, expect: t => t.length > 100 },
  
  // Routing
  { name: "route_task",              args: { task_kind: "chat", risk_level: "low" }, expect: t => t.includes("librarian") },
  { name: "route_task",              args: { task_kind: "project_delivery", risk_level: "medium" }, expect: t => t.includes("planner") || t.includes("dev_patch") },
  { name: "route_task",              args: { task_kind: "incident", risk_level: "high" }, expect: t => t.includes("debug") || t.includes("dev_patch") },
  { name: "route_task",              args: { task_kind: "pr_gate", risk_level: "low" }, expect: t => t.includes("compliance") },
  
  // Admin
  { name: "admin_health_check",      args: {}, expect: t => t.includes("healthy") || t.includes("status") || t.length > 20 },
  
  // Stats
  { name: "get_knowledge_stats",     args: {}, expect: t => t.includes("Total") || t.includes("items") || t.length > 30 },
];

(async () => {
  console.log("╔════════════════════════════════════════════════╗");
  console.log("║  FINAL MCP VERIFICATION — All Core Tools      ║");
  console.log("╚════════════════════════════════════════════════╝\n");

  let pass = 0, fail = 0;
  for (const test of tests) {
    const label = `${test.name}(${Object.values(test.args).join(", ") || "∅"})`;
    const result = await call(test.name, test.args);
    
    if (!result.ok) {
      console.log(`  ✗ ${label}`);
      console.log(`    ERROR: ${result.error.substring(0, 120)}`);
      fail++;
    } else if (!test.expect(result.text)) {
      console.log(`  ✗ ${label}`);
      console.log(`    UNEXPECTED: ${result.text.substring(0, 120)}`);
      fail++;
    } else {
      console.log(`  ✓ ${label}`);
      pass++;
    }
  }

  console.log(`\n${"═".repeat(50)}`);
  console.log(`  RESULTS: ${pass}/${pass + fail} passed (${fail} failed)`);
  console.log(`${"═".repeat(50)}`);

  if (fail === 0) {
    console.log("\n  🎉 ALL CORE MCP TOOLS VERIFIED!\n");
  }
})();
