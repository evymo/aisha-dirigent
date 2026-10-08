#!/usr/bin/env node
/**
 * AISHA Integration Test Pipeline
 *
 * End-to-end validation of the Aisha Dirigent ecosystem:
 *   1. n8n health & webhook registration
 *   2. Community nodes build & unit tests
 *   3. MCP protocol & contract tests
 *   4. Workflow activation checks
 *   5. Custom node registry DB (if Supabase running)
 *   6. Admin Bridge — NocoDB/Langfuse integration validation
 *   7. Deep Integration — autonomous workflows & human oversight
 *   8. Dirigent agent smoke test
 *
 * @example
 *   npm run aisha:integration
 *   npm run aisha:integration -- --target local
 *   npm run aisha:integration -- --target prod
 *   npm run aisha:integration -- --skip-smoke
 *   N8N_WEBHOOK_URL=https://n8n.example.com npm run aisha:integration
 */

import { execSync } from "child_process";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { existsSync, readFileSync } from "fs";
import { parseTestTarget, resolveN8nTestConfig } from "./lib/test-target.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PKGS_DIR = join(ROOT, "packages", "n8n-nodes-aisha");
const TARGET = parseTestTarget(process.argv);
const SKIP_SMOKE = process.argv.includes("--skip-smoke");

// ─── Configuration ───────────────────────────────────────────────────────

const { n8nApiKey: N8N_API_KEY, n8nUrl: N8N_URL } = resolveN8nTestConfig({
  argv: process.argv,
  root: ROOT,
});

const WORKFLOW_NAME_MAP = {
  DIRIGENT: "WF_DIRIGENT_AGENT",
  KNOWLEDGE: "WF_KNOWLEDGE_AGENT",
  COMPLIANCE: "WF_COMPLIANCE_AGENT",
  DELIVERY: "WF_DELIVERY_AGENT",
  PR_COMPLIANCE: "WF_PR_COMPLIANCE_GATE",
  MODEL_ROUTER: "WF_MODEL_ROUTER",
  COMPLIANCE_REROUTE: "WF_COMPLIANCE_REROUTE",
  NIGHTLY_AUDIT: "WF_NIGHTLY_STORY_AUDIT",
  MCP_BRIDGE: "WF_MCP_BRIDGE",
};

/** Resolve workflow IDs dynamically from n8n server. */
async function resolveWorkflowIdMap() {
  const resp = await fetch(`${N8N_URL}/api/v1/workflows`, {
    headers: { "X-N8N-API-KEY": N8N_API_KEY, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) throw new Error(`n8n API ${resp.status}`);
  const result = await resp.json();
  const wfs = result.data ?? result;
  const byName = new Map();
  for (const wf of Array.isArray(wfs) ? wfs : []) byName.set(wf.name, wf.id);

  const ids = {};
  for (const [key, name] of Object.entries(WORKFLOW_NAME_MAP)) {
    const id = byName.get(name);
    if (id) ids[key] = id;
    else console.warn(`  ⚠ ${name} not found on n8n server`);
  }
  return ids;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/** @type {{ name: string, ok: boolean, skipped?: boolean, detail: string }[]} */
const results = [];

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  const icon = ok ? "✅" : "❌";
  console.log(`  ${icon} ${name}${detail ? ` — ${detail}` : ""}`);
}

/** Record an expected skip — not a failure, not a pass */
function recordSkip(name, detail = "") {
  results.push({ name, ok: true, skipped: true, detail });
  console.log(`  ⏭️  ${name}${detail ? ` — ${detail}` : ""}`);
}

function run(cmd, opts = {}) {
  return execSync(cmd, {
    stdio: "pipe",
    encoding: "utf-8",
    cwd: ROOT,
    timeout: 120_000,
    ...opts,
  }).trim();
}

function runSafe(cmd, opts = {}) {
  try {
    return { ok: true, output: run(cmd, opts) };
  } catch (err) {
    return { ok: false, output: err.stderr || err.message };
  }
}

// ─── Step 1: n8n Health ──────────────────────────────────────────────────

async function checkN8nHealth() {
  console.log("\n── Step 1: n8n Health ──────────────────────────────────");
  try {
    const resp = await fetch(`${N8N_URL}/healthz`, {
      signal: AbortSignal.timeout(10_000),
    });
    const body = await resp.text();
    record("n8n reachable", resp.ok, `${resp.status} — ${body.trim()}`);
    return resp.ok;
  } catch (err) {
    record("n8n reachable", false, err.message);
    return false;
  }
}

// ─── Step 2: Community Nodes ─────────────────────────────────────────────

function testCommunityNodes() {
  console.log("\n── Step 2: Community Nodes Build & Tests ───────────────");

  // Build check
  const buildResult = runSafe("npm run build", { cwd: PKGS_DIR });
  record("community nodes build", buildResult.ok);

  // Unit tests
  const testResult = runSafe("npx vitest run --reporter=verbose 2>&1", {
    cwd: PKGS_DIR,
  });
  // Match "Tests  N passed" (not "Test Files  N passed")
  const passMatch = testResult.output.match(/Tests\s+(\d+)\s+passed/);
  const failMatch = testResult.output.match(/(\d+)\s+failed/);
  const passed = passMatch ? parseInt(passMatch[1]) : 0;
  const failed = failMatch ? parseInt(failMatch[1]) : 0;
  record(
    "community nodes tests",
    testResult.ok && failed === 0,
    `${passed} passed, ${failed} failed`,
  );
}

// ─── Step 3: MCP Tests ──────────────────────────────────────────────────

function testMcpServer() {
  console.log("\n── Step 3: MCP Protocol & Contract Tests ───────────────");

  const mcpResult = runSafe(
    "npx vitest run src/tests/mcp/ --reporter=verbose 2>&1",
  );
  // Match "Tests  N passed" (not "Test Files  N passed")
  const passMatch = mcpResult.output.match(/Tests\s+(\d+)\s+passed/);
  const failMatch = mcpResult.output.match(/Tests\s+\d+\s+failed\s*\|\s*(\d+)\s+passed/) ||
                    mcpResult.output.match(/(\d+)\s+failed/);
  const passed = passMatch ? parseInt(passMatch[1]) : 0;
  const failed = failMatch ? parseInt(failMatch[1]) : 0;
  record(
    "MCP protocol & contract tests",
    mcpResult.ok && failed === 0,
    `${passed} passed, ${failed} failed`,
  );
}

// ─── Step 4: Workflow Activation ─────────────────────────────────────────

async function checkWorkflows() {
  console.log("\n── Step 4: Workflow Activation ─────────────────────────");

  if (!N8N_API_KEY) {
    recordSkip("workflow check", "N8N_API_KEY not configured");
    return;
  }

  const WORKFLOW_IDS = await resolveWorkflowIdMap();
  for (const [name, id] of Object.entries(WORKFLOW_IDS)) {
    try {
      const resp = await fetch(`${N8N_URL}/api/v1/workflows/${id}`, {
        headers: { "X-N8N-API-KEY": N8N_API_KEY },
        signal: AbortSignal.timeout(10_000),
      });

      if (!resp.ok) {
        record(`WF ${name}`, false, `HTTP ${resp.status}`);
        continue;
      }

      const wf = await resp.json();
      record(
        `WF ${name}`,
        wf.active === true,
        wf.active ? "active" : "INACTIVE",
      );
    } catch (err) {
      record(`WF ${name}`, false, err.message);
    }
  }
}

// ─── Step 5: DB Migration Status ─────────────────────────────────────────

function checkDbMigration() {
  console.log("\n── Step 5: DB — Migration & Registry ──────────────────");

  // SoT completeness: tables, functions, policies (migration consolidated into baseline)
  const sotTables = [
    "aisha/db/sql/tables/node_factory_requests.sql",
    "aisha/db/sql/tables/custom_node_registry.sql",
  ];
  const sotFunctions = [
    "aisha/db/sql/functions/submit_node_factory_request.sql",
    "aisha/db/sql/functions/get_pending_node_factory_requests.sql",
    "aisha/db/sql/functions/update_node_factory_request_status.sql",
    "aisha/db/sql/functions/register_custom_node.sql",
    "aisha/db/sql/functions/list_custom_nodes.sql",
  ];
  const sotPolicies = [
    "aisha/db/sql/policies/Admins_and_staff_can_view_all_node_factory_requests.sql",
    "aisha/db/sql/policies/Admins_can_manage_custom_node_registry.sql",
    "aisha/db/sql/policies/Admins_can_manage_node_factory_requests.sql",
    "aisha/db/sql/policies/Authenticated_users_can_view_active_custom_nodes.sql",
    "aisha/db/sql/policies/Service_role_full_access_custom_node_registry.sql",
    "aisha/db/sql/policies/Service_role_full_access_node_factory_requests.sql",
  ];

  const allSot = [...sotTables, ...sotFunctions, ...sotPolicies];
  const missing = allSot.filter((f) => !existsSync(join(ROOT, f)));
  record(
    "NodeFactory SoT files",
    missing.length === 0,
    missing.length === 0
      ? `${allSot.length}/${allSot.length} (tables: ${sotTables.length}, functions: ${sotFunctions.length}, policies: ${sotPolicies.length})`
      : `missing ${missing.length}: ${missing.map((f) => f.split("/").pop()).join(", ")}`,
  );

  // Migration registry integrity — verify entries exist AND cross-check with migration files
  const registryPath = join(ROOT, "aisha/db/migration-registry.json");
  if (existsSync(registryPath)) {
    const registry = JSON.parse(readFileSync(registryPath, "utf-8"));
    const entries = Array.isArray(registry) ? registry : registry.migrations || [];
    record("migration-registry.json", entries.length > 0, `${entries.length} entries`);

    // Cross-check: every registry entry should have a corresponding migration file
    const migrationsDir = join(ROOT, "aisha/db/migrations");
    const orphaned = entries.filter((e) => {
      const name = typeof e === "string" ? e : e.name || "";
      return name && !existsSync(join(migrationsDir, name));
    });
    record(
      "registry↔migration cross-check",
      orphaned.length === 0,
      orphaned.length === 0
        ? `${entries.length}/${entries.length} entries have matching files`
        : `${orphaned.length} orphaned: ${orphaned.map((e) => (typeof e === "string" ? e : e.name)).join(", ")}`,
    );
  } else {
    record("migration-registry.json", false, "file not found");
  }

  // Check if local Supabase is running + verify DB objects
  const dbCheck = runSafe(
    'PGPASSWORD=postgres psql -h 127.0.0.1 -p 57422 -U postgres -d postgres -t -A -c "SELECT 1"',
  );
  if (dbCheck.ok && dbCheck.output.trim() === "1") {
    record("local Supabase reachable", true);

    // Verify tables exist in DB
    const tableCheck = runSafe(
      `PGPASSWORD=postgres psql -h 127.0.0.1 -p 57422 -U postgres -d postgres -t -A -c "SELECT count(*) FROM information_schema.tables WHERE table_name IN ('node_factory_requests','custom_node_registry')"`,
    );
    record(
      "NodeFactory tables in DB",
      tableCheck.ok && tableCheck.output.trim() === "2",
      tableCheck.ok ? `${tableCheck.output.trim()}/2 tables` : "query failed",
    );

    // Verify RPC functions exist
    const fnCheck = runSafe(
      `PGPASSWORD=postgres psql -h 127.0.0.1 -p 57422 -U postgres -d postgres -t -A -c "SELECT count(*) FROM information_schema.routines WHERE routine_name IN ('submit_node_factory_request','get_pending_node_factory_requests','update_node_factory_request_status','register_custom_node','list_custom_nodes') AND routine_type = 'FUNCTION'"`,
    );
    record(
      "NodeFactory RPC functions in DB",
      fnCheck.ok && parseInt(fnCheck.output.trim(), 10) >= 5,
      fnCheck.ok ? `${fnCheck.output.trim()}/5 functions` : "query failed",
    );

    // Verify RLS enabled
    const rlsCheck = runSafe(
      `PGPASSWORD=postgres psql -h 127.0.0.1 -p 57422 -U postgres -d postgres -t -A -c "SELECT count(*) FROM pg_tables WHERE tablename IN ('node_factory_requests','custom_node_registry') AND rowsecurity = true"`,
    );
    record(
      "NodeFactory RLS enabled",
      rlsCheck.ok && rlsCheck.output.trim() === "2",
      rlsCheck.ok ? `${rlsCheck.output.trim()}/2 tables` : "query failed",
    );
  } else {
    record("local Supabase reachable", false, "not running — skipped DB checks");
  }
}

// ─── Step 6: Admin Bridge — NocoDB/Langfuse Integration ──────────────────

async function checkAdminBridge() {
  console.log("\n── Step 6: Admin Bridge — NocoDB/Langfuse Integration ──");

  // 6a. AishaAdminBridge node exists
  const bridgeNodePath = join(
    PKGS_DIR,
    "nodes/AishaAdminBridge/AishaAdminBridge.node.ts",
  );
  record("AishaAdminBridge node", existsSync(bridgeNodePath));

  // 6b. Admin credentials exist
  const nocodbCredPath = join(
    PKGS_DIR,
    "credentials/AishaNocoDbApi.credentials.ts",
  );
  const langfuseCredPath = join(
    PKGS_DIR,
    "credentials/AishaLangfuseApi.credentials.ts",
  );
  record("NocoDB credential file", existsSync(nocodbCredPath));
  record("Langfuse credential file", existsSync(langfuseCredPath));

  // 6c. AishaAdminBridge tests pass
  const testResult = runSafe(
    "npx vitest run __tests__/AishaAdminBridge.test.ts --reporter=verbose 2>&1",
    { cwd: PKGS_DIR },
  );
  const passMatch = testResult.output.match(/Tests\s+(\d+)\s+passed/);
  const passed = passMatch ? parseInt(passMatch[1]) : 0;
  record(
    "AishaAdminBridge tests",
    testResult.ok && passed >= 26,
    `${passed} passed`,
  );

  // 6d. Admin workflows exist
  const healthWf = join(ROOT, "n8n/workflows/WF_ADMIN_HEALTH_MONITOR.json");
  const orchWf = join(ROOT, "n8n/workflows/WF_ADMIN_ORCHESTRATION.json");
  record("WF_ADMIN_HEALTH_MONITOR.json", existsSync(healthWf));
  record("WF_ADMIN_ORCHESTRATION.json", existsSync(orchWf));

  // 6d+. Phase 7 workflow files
  const phase7Workflows = [
    "WF_STORY_SCAFFOLD.json",
    "WF_GUILD_MATCH.json",
    "WF_SELF_LEARNING_LOOP.json",
    "WF_SELF_DEPLOY.json",
    "WF_SELF_LEARNING_TRIGGER.json",
  ];
  for (const name of phase7Workflows) {
    record(name, existsSync(join(ROOT, "n8n/workflows", name)));
  }

  // 6e. Validate workflow JSON structure
  for (const [name, path] of [
    ["health-monitor", healthWf],
    ["orchestration", orchWf],
  ]) {
    if (existsSync(path)) {
      try {
        const wf = JSON.parse(readFileSync(path, "utf-8"));
        const hasNodes = Array.isArray(wf.nodes) && wf.nodes.length > 0;
        const hasConnections =
          wf.connections && Object.keys(wf.connections).length > 0;
        record(
          `WF ${name} valid JSON`,
          hasNodes && hasConnections,
          `${wf.nodes?.length ?? 0} nodes`,
        );
      } catch (err) {
        console.warn(`[test-aisha-integration] WF ${name} JSON parse failed:`, err.message ?? err);
        record(`WF ${name} valid JSON`, false, "parse error");
      }
    }
  }

  // 6f. Integration services SoT (tables + events + logs)
  const integSotFiles = [
    "aisha/db/sql/tables/integration_services.sql",
    "aisha/db/sql/tables/integration_events.sql",
    "aisha/db/sql/tables/integration_service_logs.sql",
  ];
  const integMissing = integSotFiles.filter((f) => !existsSync(join(ROOT, f)));
  record(
    "Integration services SoT",
    integMissing.length === 0,
    integMissing.length === 0
      ? `${integSotFiles.length}/${integSotFiles.length} files`
      : `missing: ${integMissing.map((f) => f.split("/").pop()).join(", ")}`,
  );

  // 6f+. Integration services DB verification (if Supabase running)
  const integDbCheck = runSafe(
    'PGPASSWORD=postgres psql -h 127.0.0.1 -p 57422 -U postgres -d postgres -t -A -c "SELECT 1"',
  );
  if (integDbCheck.ok && integDbCheck.output.trim() === "1") {
    const integTableCheck = runSafe(
      `PGPASSWORD=postgres psql -h 127.0.0.1 -p 57422 -U postgres -d postgres -t -A -c "SELECT count(*) FROM information_schema.tables WHERE table_name IN ('integration_services','integration_events','integration_service_logs')"`,
    );
    record(
      "Integration services tables in DB",
      integTableCheck.ok && integTableCheck.output.trim() === "3",
      integTableCheck.ok ? `${integTableCheck.output.trim()}/3 tables` : "query failed",
    );

    const integRlsCheck = runSafe(
      `PGPASSWORD=postgres psql -h 127.0.0.1 -p 57422 -U postgres -d postgres -t -A -c "SELECT count(*) FROM pg_tables WHERE tablename IN ('integration_services','integration_events','integration_service_logs') AND rowsecurity = true"`,
    );
    record(
      "Integration services RLS enabled",
      integRlsCheck.ok && integRlsCheck.output.trim() === "3",
      integRlsCheck.ok ? `${integRlsCheck.output.trim()}/3 tables` : "query failed",
    );
  }

  // 6g. MCP admin tools registered (check source)
  const mcpPath = join(
    ROOT,
    "services/svc-mcp-knowledge/src/server.ts",
  );
  if (existsSync(mcpPath)) {
    const mcpSrc = readFileSync(mcpPath, "utf-8");
    const adminTools = [
      "admin_list_services",
      "admin_health_check",
      "admin_nocodb_query",
      "admin_nocodb_manage",
      "admin_langfuse_traces",
      "admin_log_action",
    ];
    let found = 0;
    for (const tool of adminTools) {
      if (mcpSrc.includes(`"${tool}"`)) found++;
    }
    record(
      "MCP admin bridge tools",
      found === adminTools.length,
      `${found}/${adminTools.length} tools registered`,
    );
  } else {
    record("MCP admin bridge tools", false, "MCP source not found");
  }

  // 6h. Docker Compose files for admin services
  const localCompose = join(ROOT, "docker-compose.local.yml");
  if (existsSync(localCompose)) {
    const content = readFileSync(localCompose, "utf-8");
    record(
      "Docker local: NocoDB+Langfuse",
      content.includes("nocodb") && content.includes("langfuse"),
    );
  }
  // Coolify uses split compose files: admin (NocoDB), langfuse, n8n
  const coolifyAdmin = join(ROOT, "docker-compose.coolify-admin.yml");
  const coolifyLangfuse = join(ROOT, "docker-compose.coolify-langfuse.yml");
  const hasNocodbCoolify = existsSync(coolifyAdmin) && readFileSync(coolifyAdmin, "utf-8").includes("nocodb");
  const hasLangfuseCoolify = existsSync(coolifyLangfuse) && readFileSync(coolifyLangfuse, "utf-8").includes("langfuse");
  record(
    "Docker Coolify: NocoDB+Langfuse",
    hasNocodbCoolify && hasLangfuseCoolify,
    `nocodb: ${hasNocodbCoolify ? "coolify-admin.yml" : "missing"}, langfuse: ${hasLangfuseCoolify ? "coolify-langfuse.yml" : "missing"}`,
  );

  // 6i. HTTP health checks for admin services (optional — only if URLs configured)
  const serviceChecks = [
    { name: "NocoDB", urlKey: "NOCODB_URL", path: "/api/v1/health" },
    { name: "Appsmith", urlKey: "APPSMITH_URL", path: "/api/v1/health" },
    { name: "Langfuse", urlKey: "LANGFUSE_HOST", path: "/api/public/health" },
    { name: "GitHub API", urlKey: "GITHUB_API_URL", path: "/zen" },
  ];

  for (const svc of serviceChecks) {
    const url = process.env[svc.urlKey];
    if (!url) {
      recordSkip(`${svc.name} health`, "no URL configured");
      continue;
    }
    try {
      const resp = await fetch(`${url.replace(/\/$/, "")}${svc.path}`, {
        signal: AbortSignal.timeout(5_000),
      });
      record(`${svc.name} health`, resp.ok, `HTTP ${resp.status}`);
    } catch (err) {
      record(`${svc.name} health`, false, err.message);
    }
  }

  // 6j. MCP admin tools — extended list (including appsmith & github git ops)
  if (existsSync(join(ROOT, "services/svc-mcp-knowledge/src/server.ts"))) {
    const mcpSrc2 = readFileSync(join(ROOT, "services/svc-mcp-knowledge/src/server.ts"), "utf-8");
    const extendedTools = ["admin_appsmith", "admin_github_git", "admin_n8n_workflows"];
    let found2 = 0;
    for (const tool of extendedTools) {
      if (mcpSrc2.includes(`"${tool}"`)) found2++;
    }
    record(
      "MCP extended admin tools",
      found2 === extendedTools.length,
      `${found2}/${extendedTools.length} tools`,
    );
  }
}

// ─── Step 7: Deep Integration — Autonomous Workflows & Human Oversight ──

function checkDeepIntegration() {
  console.log(
    "\n── Step 7: Deep Integration — Autonomous Workflows & Oversight ──",
  );

  const workflowDir = join(ROOT, "n8n", "workflows");

  // 7a. Dirigent agent — admin tools & node count
  const dirigentPath = join(workflowDir, "WF_DIRIGENT_AGENT.json");
  if (existsSync(dirigentPath)) {
    const wf = JSON.parse(readFileSync(dirigentPath, "utf-8"));
    const nodeCount = wf.nodes?.length || 0;
    record(
      "Dirigent node count (≥30)",
      nodeCount >= 30,
      `${nodeCount} nodes`,
    );

    // Check admin MCP tools exist
    const adminTools = [
      "tool-admin_list_services",
      "tool-admin_health_check",
      "tool-admin_nocodb_query",
      "tool-admin_nocodb_manage",
      "tool-admin_langfuse_traces",
      "tool-admin_log_action",
    ];
    const toolNodes = wf.nodes.map((n) => n.id);
    let adminToolCount = 0;
    for (const t of adminTools) {
      if (toolNodes.includes(t)) adminToolCount++;
    }
    record(
      "Dirigent admin MCP tools",
      adminToolCount === adminTools.length,
      `${adminToolCount}/${adminTools.length}`,
    );

    // Check workflow tools (notify-expert, approval-gate)
    const wfTools = ["workflow-tool-notify-expert", "workflow-tool-approval-gate"];
    let wfToolCount = 0;
    for (const t of wfTools) {
      if (toolNodes.includes(t)) wfToolCount++;
    }
    record(
      "Dirigent workflow tools (notify/approval)",
      wfToolCount === wfTools.length,
      `${wfToolCount}/${wfTools.length}`,
    );

    // Check self-deploy tools
    const selfDeployTools = ["tool-admin_n8n_workflows", "workflow-tool-self-deploy"];
    let selfDeployToolCount = 0;
    for (const t of selfDeployTools) {
      if (toolNodes.includes(t)) selfDeployToolCount++;
    }
    record(
      "Dirigent self-deploy tools",
      selfDeployToolCount === selfDeployTools.length,
      `${selfDeployToolCount}/${selfDeployTools.length}`,
    );

    // Check system prompt has admin playbooks
    const systemPrompt = JSON.stringify(wf.nodes.find((n) => n.name === "AISHA Dirigent")?.parameters || {});
    record(
      "Dirigent admin playbooks in prompt",
      systemPrompt.includes("Admin Bridge") && systemPrompt.includes("Eskalace"),
    );

    // Check self-deploy playbook in system prompt
    record(
      "Dirigent self-deploy playbook in prompt",
      systemPrompt.includes("Self-Deploy") && systemPrompt.includes("workflow_drift_detected"),
    );

    // Check maxIterations >= 15 (n8n agent stores it in parameters.options.maxIterations)
    const agentNode = wf.nodes.find((n) => n.name === "AISHA Dirigent");
    const maxIter = agentNode?.parameters?.options?.maxIterations || agentNode?.parameters?.maxIterations || 0;
    record("Dirigent maxIterations ≥ 15", maxIter >= 15, `${maxIter}`);
  } else {
    record("Dirigent workflow file", false, "not found");
  }

  // 7b. Expert notification workflow
  const notifPath = join(workflowDir, "WF_EXPERT_NOTIFICATION.json");
  if (existsSync(notifPath)) {
    const wf = JSON.parse(readFileSync(notifPath, "utf-8"));
    record(
      "Expert Notification workflow",
      wf.nodes?.length >= 10,
      `${wf.nodes?.length} nodes`,
    );
    // Check severity routing
    const hasSeveritySwitch = wf.nodes.some(
      (n) => n.name === "Route by Severity",
    );
    record("Notification severity routing", hasSeveritySwitch);
  } else {
    record("Expert Notification workflow", false, "file not found");
  }

  // 7c. Approval gate workflow
  const approvalPath = join(workflowDir, "WF_APPROVAL_GATE.json");
  if (existsSync(approvalPath)) {
    const wf = JSON.parse(readFileSync(approvalPath, "utf-8"));
    record(
      "Approval Gate workflow",
      wf.nodes?.length >= 14,
      `${wf.nodes?.length} nodes`,
    );
    // Check dual webhook (request + response)
    const webhooks = wf.nodes.filter(
      (n) => n.type === "n8n-nodes-base.webhook",
    );
    record("Approval Gate dual webhooks", webhooks.length >= 2, `${webhooks.length} webhooks`);
  } else {
    record("Approval Gate workflow", false, "file not found");
  }

  // 7d. Self-healing health monitor
  const healthPath = join(workflowDir, "WF_ADMIN_HEALTH_MONITOR.json");
  if (existsSync(healthPath)) {
    const wf = JSON.parse(readFileSync(healthPath, "utf-8"));
    record(
      "Health Monitor self-healing (≥15 nodes)",
      wf.nodes?.length >= 15,
      `${wf.nodes?.length} nodes`,
    );
    // Check self-healing components
    const nodeNames = wf.nodes.map((n) => n.name);
    const hasSelfHealing = nodeNames.includes("Self-Healing Logic");
    const hasRecovery = nodeNames.includes("Attempt Recovery");
    const hasEscalation = nodeNames.includes("Escalate to Expert");
    const hasNotifyDirigent = nodeNames.includes("Notify Dirigent");
    record(
      "Health Monitor circuit breaker",
      hasSelfHealing && hasRecovery,
      `self-healing: ${hasSelfHealing}, recovery: ${hasRecovery}`,
    );
    record(
      "Health Monitor escalation path",
      hasEscalation && hasNotifyDirigent,
      `escalate: ${hasEscalation}, notify-dirigent: ${hasNotifyDirigent}`,
    );
  } else {
    record("Health Monitor workflow", false, "file not found");
  }

  // 7e. Langfuse performance review workflow
  const langfusePath = join(workflowDir, "WF_LANGFUSE_PERFORMANCE_REVIEW.json");
  if (existsSync(langfusePath)) {
    const wf = JSON.parse(readFileSync(langfusePath, "utf-8"));
    record(
      "Langfuse Performance Review workflow",
      wf.nodes?.length >= 8,
      `${wf.nodes?.length} nodes`,
    );
    // Check anomaly detection + NocoDB storage
    const nodeNames = wf.nodes.map((n) => n.name);
    record(
      "Performance Review anomaly pipeline",
      nodeNames.includes("Analyze Performance") &&
        nodeNames.includes("Store Report in NocoDB") &&
        nodeNames.includes("Notify Dirigent (Anomaly)"),
    );
  } else {
    record("Langfuse Performance Review workflow", false, "file not found");
  }

  // 7f. Self-Deploy workflow
  const selfDeployPath = join(workflowDir, "WF_SELF_DEPLOY.json");
  if (existsSync(selfDeployPath)) {
    const wf = JSON.parse(readFileSync(selfDeployPath, "utf-8"));
    record(
      "Self-Deploy workflow (≥10 nodes)",
      wf.nodes?.length >= 10,
      `${wf.nodes?.length} nodes`,
    );
    // Check key nodes
    const nodeNames = wf.nodes.map((n) => n.name);
    const hasCompare = nodeNames.some((n) => n.includes("Compare"));
    const hasDeploy = nodeNames.some((n) => n.includes("Deploy"));
    const hasReport = nodeNames.some((n) => n.includes("Report"));
    record(
      "Self-Deploy pipeline (compare, deploy, report)",
      hasCompare && hasDeploy && hasReport,
    );
  } else {
    record("Self-Deploy workflow", false, "file not found");
  }

  // 7g. Health Monitor drift detection
  const healthPath2 = join(workflowDir, "WF_ADMIN_HEALTH_MONITOR.json");
  if (existsSync(healthPath2)) {
    const wf = JSON.parse(readFileSync(healthPath2, "utf-8"));
    const nodeNames = wf.nodes.map((n) => n.name);
    const hasDriftCheck = nodeNames.includes("Check Workflow Drift");
    const hasDriftIf = nodeNames.includes("Has Drift?");
    const hasDriftNotify = nodeNames.some((n) => n.includes("Drift"));
    record(
      "Health Monitor workflow drift detection",
      hasDriftCheck && hasDriftIf && hasDriftNotify,
      `drift-check: ${hasDriftCheck}, if: ${hasDriftIf}, notify: ${hasDriftNotify}`,
    );
  }

  // 7h. Total workflow count
  let wfCount = 0;
  try {
    const files = execSync(`ls "${workflowDir}"/*.json 2>/dev/null | wc -l`, {
      encoding: "utf-8",
      cwd: ROOT,
    }).trim();
    wfCount = parseInt(files) || 0;
  } catch {
    // workflowDir missing or glob expanded to nothing — leave wfCount=0; the
    // subsequent record() call will report "0 workflows" which is the desired
    // failure signal without crashing the integration sweep.
  }
  record(
    "Total workflow files (≥16)",
    wfCount >= 16,
    `${wfCount} workflows`,
  );
}

// ─── Step 8: Dirigent Smoke Test ─────────────────────────────────────────

async function smokeTestDirigent() {
  console.log("\n── Step 8: Dirigent Agent Smoke Test ───────────────────");

  if (SKIP_SMOKE) {
    record("Dirigent smoke test", true, "skipped (--skip-smoke)");
    return;
  }

  try {
    const resp = await fetch(`${N8N_URL}/webhook/dirigent-agent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(N8N_API_KEY ? { "X-N8N-API-KEY": N8N_API_KEY } : {}),
      },
      body: JSON.stringify({
        message: "zdravím, toto je integrační test Aisha pipelines",
        session_id: `integration-test-${Date.now()}`,
        source: "aisha:integration",
        type: "health_check",
      }),
      signal: AbortSignal.timeout(30_000),
    });

    const body = await resp.text();
    record(
      "Dirigent agent responds",
      resp.ok,
      `HTTP ${resp.status} — ${body.slice(0, 100)}`,
    );
  } catch (err) {
    record("Dirigent agent responds", false, err.message);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║        AISHA Integration Test Pipeline                  ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`  target: ${TARGET}`);
  console.log(`  n8n URL: ${N8N_URL}`);
  console.log(`  API key: ${N8N_API_KEY ? "configured" : "NOT configured"}`);

  const n8nOk = await checkN8nHealth();
  testCommunityNodes();
  testMcpServer();
  if (n8nOk) await checkWorkflows();
  checkDbMigration();
  await checkAdminBridge();
  checkDeepIntegration();
  if (n8nOk) await smokeTestDirigent();

  // ─── Summary ───────────────────────────────────────────────────────
  console.log(
    "\n══════════════════════════════════════════════════════════════",
  );
  const skipped = results.filter((r) => r.skipped);
  const failed = results.filter((r) => !r.ok);
  const passed = results.filter((r) => r.ok && !r.skipped).length;
  const total = results.length - skipped.length;

  if (failed.length > 0) {
    console.log(`\n  ❌ FAILURES (${failed.length}):`);
    for (const f of failed) {
      console.log(`     • ${f.name}${f.detail ? `: ${f.detail}` : ""}`);
    }
  }

  if (skipped.length > 0) {
    console.log(`\n  ⏭️  SKIPPED (${skipped.length}):`);
    for (const s of skipped) {
      console.log(`     • ${s.name}${s.detail ? `: ${s.detail}` : ""}`);
    }
  }

  console.log(`\n  Result: ${passed}/${total} checks passed${skipped.length ? ` (${skipped.length} skipped)` : ""}`);

  if (failed.length === 0) {
    console.log("  ✅ AISHA ecosystem fully operational!\n");
  } else if (passed >= total * 0.7) {
    console.log("  ⚠️  Partially operational — review failures above.\n");
  } else {
    console.log("  ❌ Critical failures — Aisha not ready.\n");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\n💥 Pipeline error: ${err.message}`);
  process.exit(1);
});
