#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { ROOT } from "./config.mjs";
import { callMcp, callN8nWorkflow, extractAgentText, listMcpTools } from "./remote.mjs";
import { createRequestEnvelope } from "./request-envelope.mjs";
import { runCommand, runShell, writeAuditTrace } from "./runtime.mjs";

function step(name, ok, details, extra = {}) {
  return { name, ok, details, ...extra };
}

function summariseSteps(steps) {
  return steps
    .map((item) => `${item.ok ? "PASS" : "FAIL"} ${item.name}: ${item.details}`)
    .join("\n");
}

function readStorySnapshot(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}

async function runSequence(workflow, commands) {
  const steps = [];

  for (const command of commands) {
    const result = await runShell(command.command, { capture: true });
    steps.push(
      step(
        command.name,
        result.ok,
        result.ok ? "ok" : (result.stderr || result.stdout || "command failed").trim().split("\n").slice(-5).join("\n"),
        {
          command: command.command,
          durationMs: result.durationMs,
        },
      ),
    );

    if (!result.ok) {
      return {
        ok: false,
        steps,
        summary: `${workflow} failed at ${command.name}`,
      };
    }
  }

  return {
    ok: true,
    steps,
    summary: `${workflow} completed`,
  };
}

export async function runHealthWorkflow(config, options = {}) {
  const steps = [];

  steps.push(
    step(
      "config",
      config.hasRemoteConfig,
      config.hasRemoteConfig ? "remote configuration detected" : "remote configuration missing; local fallback only",
    ),
  );

  const localDb = await runCommand(process.execPath, ["scripts/db/status.mjs", "--local"], {
    capture: true,
  });
  steps.push(
    step(
      "db-status-local",
      localDb.ok,
      localDb.ok
        ? "local DB status available"
        : (localDb.stderr || localDb.stdout || "local DB status failed").trim().split("\n").slice(-3).join("\n"),
    ),
  );

  if (config.mcpUrl) {
    try {
      const mcpTools = await listMcpTools(config);
      const count = mcpTools.body?.result?.tools?.length ?? 0;
      steps.push(
        step(
          "mcp-tools",
          mcpTools.ok,
          mcpTools.ok ? `${count} tool(s) listed` : JSON.stringify(mcpTools.body).slice(0, 240),
        ),
      );
    } catch (error) {
      steps.push(step("mcp-tools", false, error instanceof Error ? error.message : String(error)));
    }
  } else {
    steps.push(step("mcp-tools", true, "skipped; MCP not configured"));
  }

  if (config.n8nTriggerUrl) {
    try {
      const response = await fetch(config.n8nTriggerUrl, {
        method: "OPTIONS",
        signal: AbortSignal.timeout(10_000),
      });
      steps.push(step("n8n-reachability", true, `HTTP ${response.status}`));
    } catch (error) {
      steps.push(step("n8n-reachability", false, error instanceof Error ? error.message : String(error)));
    }
  } else {
    steps.push(step("n8n-reachability", true, "skipped; n8n not configured"));
  }

  if (options.deep === true) {
    const aishaCheck = await runCommand("bash", ["scripts/aisha-setup.sh", "--check"], {
      capture: true,
    });
    steps.push(
      step(
        "aisha-setup-check",
        aishaCheck.ok,
        (aishaCheck.stdout || aishaCheck.stderr || "no output").trim().split("\n").slice(-8).join("\n"),
      ),
    );
  }

  const remoteStepNames = new Set(["config", "mcp-tools", "n8n-reachability"]);
  const localStepNames = new Set(["db-status-local"]);

  const remoteOk = steps
    .filter((item) => remoteStepNames.has(item.name))
    .every((item) => item.ok);
  const localOk = steps
    .filter((item) => localStepNames.has(item.name))
    .every((item) => item.ok);
  const degraded = !localOk || steps.some((item) => !item.ok);
  const mode = remoteOk ? (localOk ? "hybrid" : "remote-only") : "unhealthy";

  return {
    ok: remoteOk,
    degraded,
    remoteOk,
    localOk,
    mode,
    workflow: "health",
    steps,
    summary: remoteOk
      ? localOk
        ? "Remote control plane and local fallback are healthy."
        : "Remote control plane is healthy; local fallback is unavailable."
      : summariseSteps(steps),
  };
}

export async function runTestWorkflow(config, options = {}) {
  const lane = options.lane === "full" ? "full" : "smoke";
  const commands =
    lane === "full"
      ? [
          { name: "tsc", command: "npx tsc --noEmit -p tsconfig.app.json" },
          { name: "lint", command: "npm run lint" },
          { name: "i18n", command: "npm run i18n:check" },
          { name: "gates", command: "npm run test:gates" },
          { name: "tests", command: "npm run test:run" },
          { name: "build", command: "npm run build" },
        ]
      : [
          { name: "tsc", command: "npx tsc --noEmit -p tsconfig.app.json" },
          { name: "lint", command: "npm run lint" },
          { name: "i18n", command: "npm run i18n:check" },
          { name: "gates", command: "npm run test:gates" },
          { name: "build", command: "npm run build" },
        ];

  const result = await runSequence(`test:${lane}`, commands);
  return {
    ...result,
    workflow: "test",
    lane,
  };
}

export async function runQualityWorkflow(config, options = {}) {
  const task = options.prompt || "Assess current workspace quality and highlight the next fix.";

  if (config.n8nTriggerUrl) {
    const remote = await callN8nWorkflow(
      "dirigent-agent",
      {
        task,
        intent: "code_review",
      },
      config,
      { riskLevel: options.riskLevel ?? "smoke" },
    );

    return {
      ok: remote.ok,
      workflow: "quality",
      text: extractAgentText(remote.body),
      remote,
    };
  }

  if (config.mcpUrl) {
    const remote = await callMcp(
      "assess_quality",
      {
        user_prompt: task,
        expertise_level: config.expertiseLevel,
        story_id: config.storyId || undefined,
      },
      config,
    );

    return {
      ok: remote.ok,
      workflow: "quality",
      text: extractAgentText(remote.body),
      remote,
    };
  }

  const fallback = await runSequence("quality:local", [
    { name: "lint", command: "npm run lint" },
    { name: "gates", command: "npm run test:gates" },
  ]);

  return {
    ...fallback,
    workflow: "quality",
  };
}

export async function runNextWorkflow(config, options = {}) {
  const task = options.prompt || "What should I do next in this workspace?";

  if (config.n8nTriggerUrl) {
    const remote = await callN8nWorkflow(
      "dirigent-agent",
      {
        task,
        intent: "delivery",
      },
      config,
      { riskLevel: options.riskLevel ?? "smoke" },
    );

    return {
      ok: remote.ok,
      workflow: "next",
      text: extractAgentText(remote.body),
      remote,
    };
  }

  if (config.mcpUrl) {
    const remote = await callMcp(
      "suggest_next_step",
      {
        user_prompt: task,
        expertise_level: config.expertiseLevel,
        story_id: config.storyId || undefined,
      },
      config,
    );

    return {
      ok: remote.ok,
      workflow: "next",
      text: extractAgentText(remote.body),
      remote,
    };
  }

  const gitStatus = await runCommand("git", ["status", "--short"], { capture: true });
  const hasChanges = Boolean(gitStatus.stdout.trim());
  return {
    ok: true,
    workflow: "next",
    text: hasChanges
      ? "Working tree is dirty. Run `evymo-test --lane smoke`, then `evymo-quality`."
      : "Workspace is clean. Run `evymo-health`, then delegate planning with `evymo-dirigent \"plan next step\"`.",
  };
}

export async function runDbWorkflow(config, options = {}) {
  const action = options.action || "status";
  const actionMap = {
    status: "npm run db:status:local",
    migrate: "npm run db:migrate:local",
    types: "npm run db:types:gen:local",
    reset: "npm run db:reset:local",
  };

  const command = actionMap[action];
  if (!command) {
    return {
      ok: false,
      workflow: "db",
      text: `Unknown db action: ${action}`,
    };
  }

  const result = await runSequence(`db:${action}`, [
    {
      name: action,
      command,
    },
  ]);

  return {
    ...result,
    workflow: "db",
  };
}

export async function runStorySyncWorkflow(config, options = {}) {
  const snapshotPath = path.join(ROOT, ".aisha", "story.json");
  const snapshot = readStorySnapshot(snapshotPath);
  const storyId = options.storyId || config.storyId || snapshot.story_id;
  if (!storyId) {
    return {
      ok: false,
      workflow: "story-sync",
      text: "Missing story_id. Provide --story-id or set EVYMO_STORY_ID/.aisha story context.",
    };
  }

  let context = null;

  if (config.mcpUrl && config.accessToken) {
    const mcpResult = await callMcp(
      "tools/call",
      {
        name: "get_story_context",
        arguments: { story_id: storyId },
      },
      config,
    );

    if (mcpResult.ok) {
      const text = mcpResult.body?.result?.content?.[0]?.text;
      if (typeof text === "string" && text.length > 0) {
        try {
          context = JSON.parse(text);
        } catch (parseErr) {
          console.warn("[dirigent/workflows] MCP returned non-JSON text payload, ignoring:", parseErr);
          context = null;
        }
      }
    }
  }

  if (!context) {
    const supabaseUrl = config.supabaseUrl;
    const accessToken = config.accessToken;

    if (!supabaseUrl || !accessToken) {
      return {
        ok: false,
        workflow: "story-sync",
        text: "Missing AISHA access token and API URL for story sync.",
      };
    }

    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/get_story_detail_audited`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ p_story_id: storyId }),
      signal: AbortSignal.timeout(20_000),
    });

    const raw = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        workflow: "story-sync",
        text: `Story sync failed via MCP and audited RPC (${response.status}): ${raw.slice(0, 400)}`,
      };
    }

    try {
      context = JSON.parse(raw);
    } catch {
      return {
        ok: false,
        workflow: "story-sync",
        text: "Invalid JSON response from get_story_detail_audited fallback RPC.",
      };
    }
  }

  if (!context || context.error) {
    return {
      ok: false,
      workflow: "story-sync",
      text: `Story context error: ${context?.error || "unknown"}`,
    };
  }

  const storyFilePath = snapshotPath;
  mkdirSync(path.dirname(storyFilePath), { recursive: true });

  const previous = snapshot;
  const next = {
    ...previous,
    story_id: storyId,
    updated_at: new Date().toISOString(),
    project_preview: context.project_preview ?? context.story?.project_preview ?? null,
    story_snapshot: {
      delivery_status: context.story?.delivery_status ?? null,
      domain: context.story?.domain ?? [],
      risk_profile: context.story?.risk_profile ?? null,
      status: context.story?.status ?? null,
      tech_stack: context.story?.tech_stack ?? [],
      title: context.story?.title ?? null,
    },
  };

  writeFileSync(storyFilePath, `${JSON.stringify(next, null, 2)}\n`);

  return {
    ok: true,
    workflow: "story-sync",
    text: `Story snapshot synchronized to .aisha/story.json for ${storyId}.`,
    outputPath: storyFilePath,
  };
}

export async function runDirigentWorkflow(config, options = {}) {
  const task = options.prompt || "Plan the next autonomous action.";
  const envelope = createRequestEnvelope(
    "dirigent",
    { task },
    config,
    { riskLevel: options.riskLevel ?? config.riskLevel },
  );

  if (config.n8nTriggerUrl) {
    const remote = await callN8nWorkflow(
      "dirigent-agent",
      {
        task,
        intent: options.intent || "general",
      },
      config,
      { riskLevel: envelope.risk_level, runId: envelope.run_id },
    );

    return {
      ok: remote.ok,
      workflow: "dirigent",
      text: extractAgentText(remote.body),
      envelope,
      remote,
    };
  }

  if (config.mcpUrl) {
    const remote = await callMcp(
      "moderate_flow",
      {
        session_type: "codex_autopilot",
        expertise_level: config.expertiseLevel,
        story_id: config.storyId || undefined,
        user_prompt: task,
      },
      config,
    );

    return {
      ok: remote.ok,
      workflow: "dirigent",
      text: extractAgentText(remote.body),
      envelope,
      remote,
    };
  }

  return {
    ok: true,
    workflow: "dirigent",
    text: "Remote Dirigent is unavailable. Continue in local fallback mode with `evymo-health`, `evymo-quality`, and `evymo-test --lane smoke`.",
    envelope,
  };
}

export async function runDeployWorkflow(config, options = {}) {
  const runId = options.runId;
  const health = await runHealthWorkflow(config);
  if (!health.ok) {
    return {
      ok: false,
      workflow: "deploy",
      stopped: true,
      failedAt: "health",
      summary: "Deploy stopped because health gate failed.",
      incident: health,
      runId,
    };
  }

  const tests = await runTestWorkflow(config, { lane: "full" });
  if (!tests.ok) {
    return {
      ok: false,
      workflow: "deploy",
      stopped: true,
      failedAt: "tests",
      summary: "Deploy stopped because full validation lane failed.",
      incident: tests,
      runId,
    };
  }

  if (options.execute !== true) {
    return {
      ok: true,
      workflow: "deploy",
      dryRun: true,
      summary: "Trusted deploy dry-run passed all gates.",
      checks: {
        health,
        tests,
      },
      runId,
    };
  }

  if (!config.deployCommand) {
    return {
      ok: false,
      workflow: "deploy",
      stopped: true,
      failedAt: "deploy-command",
      summary: "Deploy command is not configured.",
      runId,
    };
  }

  const deploy = await runSequence("deploy:execute", [
    { name: "deploy", command: config.deployCommand },
  ]);

  if (!deploy.ok) {
    return {
      ok: false,
      workflow: "deploy",
      stopped: true,
      failedAt: "deploy",
      summary: "Deploy command failed.",
      incident: deploy,
      runId,
    };
  }

  let postVerify = null;
  if (config.postDeployVerifyCommand) {
    postVerify = await runSequence("deploy:verify", [
      { name: "post-verify", command: config.postDeployVerifyCommand },
    ]);
    if (!postVerify.ok) {
      return {
        ok: false,
        workflow: "deploy",
        stopped: true,
        failedAt: "post-verify",
        summary: "Deploy completed but post-deploy verification failed.",
        incident: postVerify,
        runId,
      };
    }
  }

  return {
    ok: true,
    workflow: "deploy",
    dryRun: false,
    summary: "Trusted deploy completed.",
    checks: {
      health,
      tests,
      deploy,
      postVerify,
    },
    runId,
  };
}

// =============================================================================
// Plugin Workflow — scaffold, submit, status, list
// =============================================================================

export async function runPluginWorkflow(config, options = {}) {
  const action = options.action || "list";

  switch (action) {
    case "scaffold": {
      const pluginId = options.path || options.pluginId;
      const kind = options.kind || "full_stack";
      if (!pluginId) {
        return {
          ok: false,
          workflow: "plugin",
          text: "Usage: evymo-plugin scaffold <plugin-slug> [--kind full_stack]",
        };
      }

      const pluginDir = path.join(ROOT, "plugins", pluginId);
      if (existsSync(pluginDir)) {
        return {
          ok: false,
          workflow: "plugin",
          text: `Plugin directory already exists: plugins/${pluginId}`,
        };
      }

      // Create plugin directory structure
      mkdirSync(pluginDir, { recursive: true });
      mkdirSync(path.join(pluginDir, "src"), { recursive: true });

      // Generate manifest.json
      const manifest = {
        id: pluginId,
        version: "0.1.0",
        name: pluginId.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        description: `${pluginId} plugin for AISHA platform`,
        author: "Evymo",
        kind,
        trust_tier: "internal",
        capabilities: [
          "rpc.get_available_plugins",
        ],
        config_schema: {},
        lifecycle: {
          backend_entry: "src/index.ts",
          load_strategy: kind === "auth_provider" ? "cold" : "hot",
        },
        sandbox: {
          timeout_ms: 10000,
          network_allowlist: [],
          max_memory_mb: 64,
        },
        dependencies: {},
      };
      writeFileSync(
        path.join(pluginDir, "manifest.json"),
        JSON.stringify(manifest, null, 2) + "\n",
      );

      // Generate plugin entry point
      const entryCode = kind === "full_stack"
        ? `/**
 * ${manifest.name} — AISHA Full-Stack Plugin
 *
 * All interaction happens through the SandboxContext.
 * This plugin NEVER accesses infrastructure directly.
 */

export async function init(ctx) {
  ctx.log("info", "${pluginId} initialized", { version: "0.1.0" });
}

export async function handle(ctx, capability, payload) {
  ctx.log("info", "Handling capability", { capability });

  switch (capability) {
    case "http.GET./status":
      return { status: "ok", plugin: ctx.plugin.id, tenant: ctx.tenant.id };

    default:
      return { error: "Unknown capability", capability };
  }
}

export async function dispose(ctx) {
  ctx.log("info", "${pluginId} disposing");
}
`
        : `/**
 * ${manifest.name} — AISHA Plugin
 *
 * Plugin kind: ${kind}
 */

export async function init(ctx) {
  ctx.log("info", "${pluginId} initialized");
}

export async function handle(ctx, capability, payload) {
  return { status: "ok", capability };
}

export async function dispose(ctx) {
  ctx.log("info", "${pluginId} disposing");
}
`;

      writeFileSync(path.join(pluginDir, "src", "index.ts"), entryCode);

      // Generate README
      writeFileSync(
        path.join(pluginDir, "README.md"),
        `# ${manifest.name}\n\n${manifest.description}\n\n## Development\n\n\`\`\`bash\n# Submit to AISHA\nevymo-plugin submit ./plugins/${pluginId}\n\n# Check status\nevymo-plugin status --plugin-id ${pluginId}\n\`\`\`\n`,
      );

      return {
        ok: true,
        workflow: "plugin",
        text: `Plugin scaffolded at plugins/${pluginId}/\n  manifest.json — plugin contract\n  src/index.ts  — entry point (init, handle, dispose)\n  README.md     — documentation\n\nNext: edit src/index.ts, then run: evymo-plugin submit ./plugins/${pluginId}`,
      };
    }

    case "submit": {
      const pluginPath = options.path;
      if (!pluginPath) {
        return {
          ok: false,
          workflow: "plugin",
          text: "Usage: evymo-plugin submit <path-to-plugin-dir>",
        };
      }

      const manifestPath = path.resolve(pluginPath, "manifest.json");
      if (!existsSync(manifestPath)) {
        return {
          ok: false,
          workflow: "plugin",
          text: `No manifest.json found at ${manifestPath}`,
        };
      }

      let manifest;
      try {
        manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      } catch (err) {
        return {
          ok: false,
          workflow: "plugin",
          text: `Invalid manifest.json: ${err.message}`,
        };
      }

      // Call submit RPC via Supabase edge function
      const supabaseUrl = config.supabaseUrl;
      const anonKey = config.anonKey;

      if (!supabaseUrl || !anonKey) {
        return {
          ok: false,
          workflow: "plugin",
          text: "Missing Supabase config. Set AISHA_POSTGREST_URL and AISHA_POSTGREST_ANON_KEY.",
        };
      }

      // TODO: upload artifact to MinIO, compute SHA256, call submit_plugin RPC
      return {
        ok: true,
        workflow: "plugin",
        text: `Plugin "${manifest.id}" v${manifest.version} (${manifest.kind}) ready for submission.\nManifest validated. Artifact upload pending (MinIO integration).`,
        manifest: { id: manifest.id, version: manifest.version, kind: manifest.kind },
      };
    }

    case "status": {
      const pluginId = options.pluginId;
      if (!pluginId) {
        return {
          ok: false,
          workflow: "plugin",
          text: "Usage: evymo-plugin status --plugin-id <slug>",
        };
      }

      // Call get_available_plugins RPC
      return {
        ok: true,
        workflow: "plugin",
        text: `Plugin status check for "${pluginId}" — requires Supabase connection.`,
      };
    }

    case "list": {
      // Call plugin-registry edge function
      const supabaseUrl = config.supabaseUrl;
      if (!supabaseUrl) {
        return {
          ok: false,
          workflow: "plugin",
          text: "Missing Supabase config. Set AISHA_POSTGREST_URL.",
        };
      }

      return {
        ok: true,
        workflow: "plugin",
        text: `Plugin list — call ${supabaseUrl}/functions/v1/plugin-registry to see available plugins.`,
      };
    }

    default:
      return {
        ok: false,
        workflow: "plugin",
        text: `Unknown plugin action: ${action}\nAvailable: scaffold, submit, status, list`,
      };
  }
}

export function emitResult(result, flags = {}) {
  if (flags.json === true) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }

  if (typeof result.text === "string" && result.text.length > 0) {
    process.stdout.write(result.text.trimEnd() + "\n");
  }

  if (result.summary) {
    process.stdout.write(`${result.summary}\n`);
  }

  if (Array.isArray(result.steps) && result.steps.length > 0) {
    process.stdout.write(`${summariseSteps(result.steps)}\n`);
  }
}

export function persistWorkflowAudit(workflow, result, meta = {}) {
  const trace = {
    workflow,
    runId: meta.runId,
    generatedAt: new Date().toISOString(),
    root: ROOT,
    ...meta,
    result,
  };

  return writeAuditTrace(workflow, trace);
}
