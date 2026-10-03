#!/usr/bin/env node

import { randomUUID } from "crypto";
import { resolveDirigentConfig } from "./config.mjs";
import {
  emitResult,
  persistWorkflowAudit,
  runDbWorkflow,
  runDeployWorkflow,
  runDirigentWorkflow,
  runHealthWorkflow,
  runNextWorkflow,
  runPluginWorkflow,
  runQualityWorkflow,
  runStorySyncWorkflow,
  runTestWorkflow,
} from "./workflows.mjs";
import { runAdviseRouterWorkflow } from "./router-advise.mjs";

function parseArgs(argv) {
  const flags = { _: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith("--")) {
      flags._.push(current);
      continue;
    }

    const key = current.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }

    flags[key] = next;
    index += 1;
  }

  return flags;
}

async function main() {
  const [workflow = "health", ...rest] = process.argv.slice(2);
  const flags = parseArgs(rest);
  const runId = flags["run-id"] || randomUUID();
  const config = resolveDirigentConfig({
    activeProfile: typeof flags.profile === "string" ? flags.profile : undefined,
    accessToken: typeof flags["access-token"] === "string" ? flags["access-token"] : undefined,
    anonKey: typeof flags["anon-key"] === "string" ? flags["anon-key"] : undefined,
    mcpUrl: typeof flags["mcp-url"] === "string" ? flags["mcp-url"] : undefined,
    riskLevel: typeof flags.lane === "string" ? flags.lane : undefined,
    storyId: typeof flags["story-id"] === "string" ? flags["story-id"] : undefined,
  });

  let result;

  switch (workflow) {
    case "health":
      result = await runHealthWorkflow(config, { deep: flags.deep === true });
      break;
    case "next":
      result = await runNextWorkflow(config, { prompt: flags._.join(" ") });
      break;
    case "quality":
      result = await runQualityWorkflow(config, { prompt: flags._.join(" ") });
      break;
    case "test":
      result = await runTestWorkflow(config, { lane: flags.lane });
      break;
    case "db":
      result = await runDbWorkflow(config, { action: flags.action || flags._[0] });
      break;
    case "deploy":
      result = await runDeployWorkflow(config, {
        execute: flags.execute === true,
        runId,
      });
      break;
    case "dirigent":
      result = await runDirigentWorkflow(config, {
        prompt: flags._.join(" "),
        riskLevel: flags["risk-level"],
        runId,
      });
      break;
    case "story-sync":
      result = await runStorySyncWorkflow(config, {
        storyId: flags["story-id"],
      });
      break;
    case "plugin":
      result = await runPluginWorkflow(config, {
        action: flags._[0],
        path: flags._[1],
        pluginId: flags["plugin-id"],
        tenantId: flags["tenant-id"],
        kind: flags.kind,
      });
      break;
    case "advise-router":
      // Router-coach advisory: prints rolling cost + slot/profile suggestion.
      // Reads .aisha/session-cost.jsonl + (optional) RPC fn_advise_session_router
      // when AISHA backend config is available. Pure read; advisory-only.
      result = await runAdviseRouterWorkflow(config, {
        sessionId: flags["session-id"] || flags._[0] || process.env.CLAUDE_SESSION_ID || "unknown",
      });
      break;
    default:
      throw new Error(`Unknown workflow: ${workflow}`);
  }

  const auditPath = persistWorkflowAudit(workflow, result, {
    runId,
    riskLevel: config.riskLevel,
    autonomyMode: config.autonomyMode,
  });

  result.auditPath = auditPath;
  emitResult(result, { json: flags.json === true });

  if (!result.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exit(1);
});
