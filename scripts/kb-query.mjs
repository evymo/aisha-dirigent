#!/usr/bin/env node
/**
 * Knowledge Base CLI — Query evymo knowledge base from terminal.
 *
 * Used by AISHA agent mode in VS Code Copilot chat to retrieve
 * expert rules, patterns, and compliance checks.
 *
 * Usage:
 *   node scripts/kb-query.mjs search "RPC pattern"
 *   node scripts/kb-query.mjs search "security definer" --limit 3
 *   node scripts/kb-query.mjs rule <rule_slug>
 *   node scripts/kb-query.mjs agent <agent_slug>
 *   node scripts/kb-query.mjs validate <code_snippet>
 *   node scripts/kb-query.mjs areas
 *   node scripts/kb-query.mjs tools
 *
 * @module
 */
import { resolveDirigentConfig } from "./dirigent/config.mjs";

// ── MCP call ────────────────────────────────────────────────────
async function mcpCall(method, params) {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: method, arguments: params },
  };

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!r.ok) {
    const t = await r.text();
    process.stderr.write(`HTTP ${r.status}: ${t.substring(0, 300)}\n`);
    process.exit(1);
  }

  const data = await r.json();

  if (data.error) {
    process.stderr.write(`MCP error: ${JSON.stringify(data.error)}\n`);
    process.exit(1);
  }

  // Extract content from MCP response
  const result = data.result;
  if (result?.content) {
    for (const block of result.content) {
      if (block.type === "text") {
        process.stdout.write(block.text + "\n");
      }
    }
  } else {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  }
}

// ── CLI ─────────────────────────────────────────────────────────
const [command, ...args] = process.argv.slice(2);

if (!command || command === "help") {
  process.stdout.write(`Usage:
  kb-query search <query> [--limit N]  Search knowledge base
  kb-query rule <slug>                 Get expert rule
  kb-query agent <slug>                Get agent knowledge
  kb-query areas                       List expertise areas
  kb-query validate <snippet>          Validate code compliance
  kb-query tools                       List available MCP tools
`);
  process.exit(0);
}

const { mcpUrl: url, accessToken: token } = resolveDirigentConfig();

if (!url) {
  process.stderr.write("MCP URL is not configured. Use .aisha/dirigent.local.json or AISHA_MCP_URL.\n");
  process.exit(1);
}

if (!token) {
  process.stderr.write("AISHA access token is not configured. Set AISHA_ACCESS_TOKEN or AISHA_KEYCLOAK_ACCESS_TOKEN.\n");
  process.exit(1);
}

switch (command) {
  case "search": {
    const limitIdx = args.indexOf("--limit");
    const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 5;
    const query = args.filter((_, i) => i !== limitIdx && i !== limitIdx + 1).join(" ");
    await mcpCall("search_knowledge", { query, limit, scope: "all" });
    break;
  }
  case "search2": {
    const limitIdx = args.indexOf("--limit");
    const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 5;
    const query = args.filter((_, i) => i !== limitIdx && i !== limitIdx + 1).join(" ");
    await mcpCall("search_knowledge_v2", { query_text: query, limit });
    break;
  }
  case "rule":
    await mcpCall("get_expert_rule", { slug: args[0] });
    break;
  case "agent":
    await mcpCall("get_agent_knowledge", { agent_slug: args[0] });
    break;
  case "areas":
    await mcpCall("get_expertise_areas", {});
    break;
  case "validate":
    await mcpCall("validate_compliance", {
      code_snippet: args.join(" "),
      story_id: "a0000000-0000-0000-0000-000000000001",
    });
    break;
  case "tools": {
    const body = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} };
    const r = await fetch(url, {
        signal: AbortSignal.timeout(30000),
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) { process.stderr.write(`HTTP ${r.status}\n`); break; }
    const data = await r.json();
    const tools = data.result?.tools || [];
    for (const t of tools) {
      process.stdout.write(`${t.name} — ${t.description?.substring(0, 80) || ""}\n`);
    }
    break;
  }
  default:
    process.stderr.write(`Unknown command: ${command}. Run 'kb-query help'.\n`);
    process.exit(1);
}
