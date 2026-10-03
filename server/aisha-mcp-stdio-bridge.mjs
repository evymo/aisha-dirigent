#!/usr/bin/env node

/**
 * AISHA MCP stdio bridge for Zed / AISHA ZEDBENCH.
 *
 * The bridge stays editor- and database-blind: it reads local workspace context,
 * exposes local helper tools, and forwards canonical AISHA tool calls to the
 * configured AISHA MCP endpoint over JSON-RPC.
 */

import { existsSync, mkdirSync, readdirSync, watch, writeFileSync } from "fs";
import path from "path";
import { execFile } from "child_process";
import { randomUUID } from "crypto";
import {
  AISHA_PROFILES,
  AISHA_ROUTING_MODES,
  findWorkspaceRoot,
  readJsonIfExists,
  readStoryFile as readStoryFileForRoot,
  redactDirigentConfig,
  resolveDirigentConfig,
  updateLocalConfig as updateLocalConfigForRoot,
  writeJson,
  writeStoryFile,
} from "../packages/dirigent-core/src/index.mjs";

const BRIDGE_VERSION = "0.1.0";
const PROTOCOL_VERSION = "2024-11-05";
const REQUEST_TIMEOUT_MS = 30_000;

const LOCAL_TOOLS = [
  {
    name: "aisha_health",
    description: "Check AISHA bridge, local profile, story, rules, and remote MCP connectivity.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "aisha_connect",
    description: "Set up or update AISHA Runtime/MCP profile, token presence, story, routing, and rules for Zed.",
    inputSchema: {
      type: "object",
      properties: {
        profile: { type: "string", enum: ["local", "cloud", "staging", "custom"] },
        apiBaseUrl: { type: "string" },
        mcpUrl: { type: "string" },
        clientToken: { type: "string" },
        story_id: { type: "string" },
        guidanceProfile: { type: "string", enum: ["beginner", "intermediate", "advanced", "expert"] },
        routingMode: { type: "string", enum: ["local", "hybrid", "cloud"] },
        dashboardUrl: { type: "string" },
        syncRules: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "aisha_get_profile",
    description: "Return the active AISHA backend profile without exposing secrets.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "aisha_set_profile",
    description: "Switch the active AISHA backend profile in .aisha/dirigent.local.json.",
    inputSchema: {
      type: "object",
      required: ["profile"],
      properties: {
        profile: { type: "string", enum: ["local", "cloud", "staging", "custom"] },
      },
      additionalProperties: false,
    },
  },
  {
    name: "aisha_set_routing_mode",
    description: "Set the AISHA model routing mode in local editor config.",
    inputSchema: {
      type: "object",
      required: ["routingMode"],
      properties: {
        routingMode: { type: "string", enum: ["local", "hybrid", "cloud"] },
      },
      additionalProperties: false,
    },
  },
  {
    name: "aisha_repair_mcp",
    description: "Run AISHA Zed repair: verify profile, MCP, story, rules, and optionally regenerate .rules.",
    inputSchema: {
      type: "object",
      properties: {
        syncRules: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "aisha_clear_session",
    description: "Clear local AISHA Zed session state without touching profile or story configuration.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "aisha_get_story",
    description: "Read the active AISHA story context from .aisha/story.json and local config.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "aisha_set_story",
    description: "Set the active AISHA story context in .aisha/story.json.",
    inputSchema: {
      type: "object",
      required: ["story_id"],
      properties: {
        story_id: { type: "string", minLength: 1 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "aisha_open_dashboard",
    description: "Return the AISHA cockpit/dashboard/story URL for opening from Zed.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["dashboard", "story", "health"] },
      },
      additionalProperties: false,
    },
  },
  {
    name: "aisha_queue_dirigent_brief",
    description: "Build and persist a pending Dirigent Brief under .aisha/briefs for Zed Agent Panel use.",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string" },
        include_diff: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "aisha_list_dirigent_briefs",
    description: "List pending Dirigent Brief files created by the AISHA Zed sidecar.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "aisha_start_watcher",
    description: "Start a lightweight sidecar watcher for .aisha/story.json and .rules changes.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "aisha_stop_watcher",
    description: "Stop the lightweight AISHA Zed sidecar watcher.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "aisha_model_routing_status",
    description: "Return local model routing mode and Runtime/MCP routing availability.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "aisha_build_dirigent_brief",
    description: "Build a local Dirigent Brief from workspace, git, profile, and story context.",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string" },
        include_diff: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "aisha_sync_rules",
    description: "Regenerate Zed .rules through the AISHA ide-instructions zedrules adapter.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
];

const REMOTE_TOOLS = [
  ["suggest_next_step", "Suggest the next delivery step for the active story/workspace."],
  ["moderate_flow", "Moderate delivery flow, risk, and orchestration decisions."],
  ["assess_quality", "Assess code/design quality against AISHA rules."],
  ["evaluate_tests", "Evaluate test strategy, failures, or coverage gaps."],
  ["check_pr_compliance", "Check pull request and ruleset compliance."],
  ["estimate_effort", "Estimate effort, risk, and implementation complexity."],
  ["get_story_context", "Fetch active story context and constraints."],
  ["search_knowledge", "Search AISHA knowledge/rules context."],
  ["route_task", "Route a task to the appropriate model/provider/tool path."],
].map(([name, description]) => ({
  name,
  description,
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: true,
  },
}));

const PROMPTS = [
  ["aisha-next", "Ask AISHA for the next delivery step.", "Call `suggest_next_step` with the current story/workspace context."],
  ["aisha-quality", "Ask AISHA for quality review.", "Call `assess_quality` for the current file, diff, or task."],
  ["aisha-test", "Ask AISHA for test strategy.", "Call `evaluate_tests` with relevant test output or implementation context."],
  ["aisha-compliance", "Ask AISHA for compliance review.", "Call `check_pr_compliance` before PR or risky changes."],
  ["aisha-health", "Check AISHA Zed health.", "Call `aisha_health` and then `aisha_repair_mcp` if any required surface is missing."],
  ["aisha-story", "Fetch story context.", "Call `get_story_context` for the active AISHA story."],
  ["aisha-route", "Inspect model routing.", "Call `aisha_model_routing_status`; use `route_task` for remote routing decisions."],
  ["aisha-onboard", "Run AISHA Zed onboarding.", "Call `aisha_connect`, `aisha_set_story`, `aisha_sync_rules`, and `aisha_health` as needed."],
  ["aisha-rules", "Synchronize AISHA Zed rules.", "Call `aisha_sync_rules` and explain how `.rules` guides the Zed Agent Panel."],
  ["aisha-dirigent", "Run high-level AISHA orchestration.", "Call `moderate_flow` for planning, risk, routing, and next actions."],
];

let watcherState = {
  active: false,
  watchers: [],
  events: [],
};

function stderr(message) {
  process.stderr.write(`[aisha-mcp-bridge] ${message}\n`);
}

const ROOT = findWorkspaceRoot(process.cwd());

function readStoryFile() {
  return readStoryFileForRoot(ROOT);
}

function resolveConfig() {
  return resolveDirigentConfig(ROOT);
}

function redactConfig(config) {
  return redactDirigentConfig(config);
}

function textResult(text, extra = {}) {
  return {
    content: [{ type: "text", text }],
    ...extra,
  };
}

function jsonResult(value) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

async function callRemoteMcp(method, params, config = resolveConfig()) {
  if (!config.mcpUrl) {
    throw new Error("AISHA MCP URL is not configured.");
  }

  const headers = { "Content-Type": "application/json" };
  if (config.anonKey || config.clientToken) {
    headers.apikey = config.anonKey || config.clientToken;
  }
  if (config.clientToken) {
    headers.Authorization = `Bearer ${config.clientToken}`;
  }

  const response = await fetch(config.mcpUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`AISHA MCP HTTP ${response.status}: ${body.slice(0, 240)}`);
  }

  const json = await response.json();
  if (json.error) {
    throw new Error(`AISHA MCP RPC error: ${json.error.message || "unknown error"}`);
  }
  return json.result;
}

function execFileText(command, args, options = {}) {
  return new Promise((resolve) => {
    execFile(command, args, { cwd: ROOT, timeout: 15_000, maxBuffer: 512_000, ...options }, (error, stdout, stderrOutput) => {
      resolve({
        ok: !error,
        stdout: stdout.trim(),
        stderr: stderrOutput.trim(),
        error: error ? error.message : "",
      });
    });
  });
}

async function health() {
  const config = resolveConfig();
  const rulesPath = path.join(ROOT, ".rules");
  const storyPath = path.join(ROOT, ".aisha", "story.json");
  const result = {
    bridge: {
      ok: true,
      version: BRIDGE_VERSION,
      root: ROOT,
    },
    profile: redactConfig(config),
    files: {
      story: existsSync(storyPath),
      rules: existsSync(rulesPath),
      localConfig: existsSync(config.localPath),
      trackedConfig: existsSync(config.trackedPath),
    },
    remoteMcp: {
      configured: Boolean(config.mcpUrl),
      ok: false,
      error: "",
    },
  };

  if (config.mcpUrl) {
    try {
      await callRemoteMcp("tools/list", {}, config);
      result.remoteMcp.ok = true;
    } catch (error) {
      result.remoteMcp.error = error instanceof Error ? error.message : String(error);
    }
  }

  return result;
}

async function setProfile(args) {
  const profile = args?.profile;
  if (!AISHA_PROFILES.includes(profile)) {
    throw new Error("profile must be one of local, cloud, staging, custom");
  }

  const config = resolveConfig();
  const nextLocal = {
    ...config.local,
    activeProfile: profile,
  };
  writeJson(config.localPath, nextLocal);

  return {
    activeProfile: profile,
    localConfig: path.relative(ROOT, config.localPath),
  };
}

function updateLocalConfig(mutator) {
  return updateLocalConfigForRoot(ROOT, mutator);
}

async function connect(args = {}) {
  const profile = args.profile || "local";
  if (!AISHA_PROFILES.includes(profile)) {
    throw new Error("profile must be one of local, cloud, staging, custom");
  }

  const profilePatch = {};
  for (const key of ["apiBaseUrl", "mcpUrl", "clientToken", "guidanceProfile", "routingMode", "dashboardUrl"]) {
    if (typeof args[key] === "string" && args[key].trim().length > 0) {
      profilePatch[key] = args[key].trim();
    }
  }

  const updated = updateLocalConfig((local) => {
    const profiles = typeof local.profiles === "object" && local.profiles !== null ? local.profiles : {};
    const currentProfile = typeof profiles[profile] === "object" && profiles[profile] !== null ? profiles[profile] : {};
    return {
      ...local,
      activeProfile: profile,
      profiles: {
        ...profiles,
        [profile]: {
          ...currentProfile,
          ...profilePatch,
        },
      },
      sidecar: {
        ...(typeof local.sidecar === "object" && local.sidecar !== null ? local.sidecar : {}),
        enabled: true,
      },
      rules: {
        ...(typeof local.rules === "object" && local.rules !== null ? local.rules : {}),
        autoSync: args.syncRules !== false,
      },
      updated_at: new Date().toISOString(),
    };
  });

  let story = null;
  if (typeof args.story_id === "string" && args.story_id.trim().length > 0) {
    story = await setStory({ story_id: args.story_id });
  }

  let rules = null;
  if (args.syncRules === true) {
    rules = await syncRules();
  }

  return {
    ok: true,
    activeProfile: profile,
    localConfig: updated.localConfig,
    story,
    rules,
    profile: redactConfig(resolveConfig()),
  };
}

async function setRoutingMode(args) {
  const routingMode = args?.routingMode;
  if (!AISHA_ROUTING_MODES.includes(routingMode)) {
    throw new Error("routingMode must be one of local, hybrid, cloud");
  }

  const updated = updateLocalConfig((local, config) => {
    const profiles = typeof local.profiles === "object" && local.profiles !== null ? local.profiles : {};
    const activeProfile = config.activeProfile || "local";
    const currentProfile = typeof profiles[activeProfile] === "object" && profiles[activeProfile] !== null ? profiles[activeProfile] : {};
    return {
      ...local,
      activeProfile,
      routingMode,
      profiles: {
        ...profiles,
        [activeProfile]: {
          ...currentProfile,
          routingMode,
        },
      },
      updated_at: new Date().toISOString(),
    };
  });

  return {
    routingMode,
    localConfig: updated.localConfig,
  };
}

async function clearSession() {
  const sessionPath = path.join(ROOT, ".aisha", "session.json");
  writeJson(sessionPath, {
    session_id: randomUUID(),
    status: "cleared",
    story_id: resolveConfig().storyId || null,
    workspace_path: ROOT,
    updated_at: new Date().toISOString(),
  });
  return {
    ok: true,
    path: path.relative(ROOT, sessionPath),
  };
}

async function setStory(args) {
  const storyId = args?.story_id || args?.storyId;
  const story = writeStoryFile(ROOT, storyId);
  return {
    storyId: story.storyId,
    path: path.relative(ROOT, story.path),
  };
}

async function buildDirigentBrief(args) {
  const config = resolveConfig();
  const [branch, status, diff] = await Promise.all([
    execFileText("git", ["branch", "--show-current"]),
    execFileText("git", ["status", "--short"]),
    args?.include_diff ? execFileText("git", ["diff", "--stat"]) : Promise.resolve({ ok: true, stdout: "", stderr: "", error: "" }),
  ]);

  const lines = [
    "# AISHA Dirigent Brief",
    "",
    `Workspace: ${ROOT}`,
    `Profile: ${config.activeProfile}`,
    `Story: ${config.storyId || "not set"}`,
    `Guidance: ${config.guidanceProfile}`,
    `Routing: ${config.routingMode}`,
    "",
    "## Task",
    "",
    typeof args?.task === "string" && args.task.trim() ? args.task.trim() : "Assess current workspace state and suggest the next safe step.",
    "",
    "## Git",
    "",
    `Branch: ${branch.stdout || "unknown"}`,
    "",
    "Changed files:",
    status.stdout || "(clean or unavailable)",
  ];

  if (diff.stdout) {
    lines.push("", "Diff stat:", diff.stdout);
  }

  lines.push(
    "",
    "## Directives",
    "",
    "- Use AISHA MCP tools for story, quality, compliance, tests, and routing decisions.",
    "- Do not perform irreversible or high-risk actions without Dirigent approval.",
    "- Keep Zed-facing workflow on AISHA Runtime/MCP contracts; do not use database internals.",
  );

  return lines.join("\n");
}

function safeTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function queueDirigentBrief(args) {
  const brief = await buildDirigentBrief(args);
  const briefId = `${safeTimestamp()}-${randomUUID().slice(0, 8)}`;
  const dir = path.join(ROOT, ".aisha", "briefs");
  const mdPath = path.join(dir, `${briefId}.md`);
  const metaPath = path.join(dir, `${briefId}.json`);
  const config = resolveConfig();
  mkdirSync(dir, { recursive: true });
  writeFileSync(mdPath, brief + "\n");
  writeJson(metaPath, {
    id: briefId,
    status: "pending",
    story_id: config.storyId || null,
    active_profile: config.activeProfile,
    routing_mode: config.routingMode,
    markdown_path: path.relative(ROOT, mdPath),
    created_at: new Date().toISOString(),
  });

  return {
    id: briefId,
    status: "pending",
    markdownPath: path.relative(ROOT, mdPath),
    metadataPath: path.relative(ROOT, metaPath),
    brief,
  };
}

function listDirigentBriefs() {
  const dir = path.join(ROOT, ".aisha", "briefs");
  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const filePath = path.join(dir, name);
      return {
        file: path.relative(ROOT, filePath),
        ...readJsonIfExists(filePath),
      };
    });
}

async function repairMcp(args = {}) {
  const before = await health();
  const actions = [];

  if (!before.files.rules || args.syncRules === true) {
    try {
      const rules = await syncRules();
      actions.push({ action: "sync_rules", ok: true, path: rules.path });
    } catch (error) {
      actions.push({
        action: "sync_rules",
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (!before.files.localConfig) {
    updateLocalConfig((local) => ({
      ...local,
      activeProfile: local.activeProfile || "local",
      sidecar: {
        ...(typeof local.sidecar === "object" && local.sidecar !== null ? local.sidecar : {}),
        enabled: true,
      },
      rules: {
        ...(typeof local.rules === "object" && local.rules !== null ? local.rules : {}),
        autoSync: true,
      },
      updated_at: new Date().toISOString(),
    }));
    actions.push({ action: "write_local_config", ok: true });
  }

  const after = await health();
  return {
    ok: after.bridge.ok && after.files.rules && after.files.localConfig,
    before,
    actions,
    after,
  };
}

function dashboardLink(args = {}) {
  const config = resolveConfig();
  const kind = args.kind || "dashboard";
  const base =
    kind === "health"
      ? config.healthUrl || config.dashboardUrl
      : config.dashboardUrl;

  if (!base) {
    return {
      kind,
      url: null,
      message: "No dashboardUrl/healthUrl configured in AISHA profile.",
    };
  }

  const url = new URL(base);
  if (kind === "story" && config.storyId) {
    url.searchParams.set("storyId", config.storyId);
  }
  if (config.activeProfile) {
    url.searchParams.set("profile", config.activeProfile);
  }

  return {
    kind,
    url: url.toString(),
    storyId: config.storyId || null,
  };
}

function modelRoutingStatus() {
  const config = resolveConfig();
  return {
    routingMode: config.routingMode,
    activeProfile: config.activeProfile,
    routeTaskAvailable: true,
    remoteMcpConfigured: Boolean(config.mcpUrl),
    guidanceProfile: config.guidanceProfile,
  };
}

function recordWatcherEvent(type, filePath) {
  watcherState.events.push({
    type,
    file: path.relative(ROOT, filePath),
    at: new Date().toISOString(),
  });
  watcherState.events = watcherState.events.slice(-50);
}

function startWatcher() {
  if (watcherState.active) {
    return {
      active: true,
      watched: watcherState.watchers.length,
      events: watcherState.events,
    };
  }

  const candidates = [
    path.join(ROOT, ".aisha", "story.json"),
    path.join(ROOT, ".rules"),
  ];

  const watchers = [];
  for (const filePath of candidates) {
    if (!existsSync(filePath)) {
      recordWatcherEvent("missing", filePath);
      continue;
    }
    const watcher = watch(filePath, { persistent: false }, (eventType) => {
      recordWatcherEvent(eventType, filePath);
    });
    watchers.push(watcher);
  }

  watcherState = {
    active: watchers.length > 0,
    watchers,
    events: watcherState.events,
  };

  return {
    active: watcherState.active,
    watched: watchers.length,
    events: watcherState.events,
  };
}

function stopWatcher() {
  for (const watcher of watcherState.watchers) {
    watcher.close();
  }
  watcherState = {
    active: false,
    watchers: [],
    events: watcherState.events,
  };
  return {
    active: false,
    events: watcherState.events,
  };
}

async function syncRules() {
  const script = path.join(ROOT, "scripts", "generate-ide-instructions.mjs");
  if (!existsSync(script)) {
    throw new Error("scripts/generate-ide-instructions.mjs not found in workspace");
  }
  const result = await execFileText(process.execPath, [script, "--format=zedrules"], { timeout: 60_000, maxBuffer: 1024 * 1024 });
  if (!result.ok) {
    throw new Error(result.stderr || result.stdout || result.error || "zedrules generation failed");
  }
  return {
    ok: true,
    output: result.stdout,
    path: ".rules",
  };
}

async function callLocalTool(name, args) {
  if (name === "aisha_health") {
    return jsonResult(await health());
  }
  if (name === "aisha_connect") {
    return jsonResult(await connect(args));
  }
  if (name === "aisha_get_profile") {
    return jsonResult(redactConfig(resolveConfig()));
  }
  if (name === "aisha_set_profile") {
    return jsonResult(await setProfile(args));
  }
  if (name === "aisha_set_routing_mode") {
    return jsonResult(await setRoutingMode(args));
  }
  if (name === "aisha_repair_mcp") {
    return jsonResult(await repairMcp(args));
  }
  if (name === "aisha_clear_session") {
    return jsonResult(await clearSession());
  }
  if (name === "aisha_get_story") {
    return jsonResult({
      story: readStoryFile(),
      configuredStoryId: resolveConfig().storyId || null,
    });
  }
  if (name === "aisha_set_story") {
    return jsonResult(await setStory(args));
  }
  if (name === "aisha_open_dashboard") {
    return jsonResult(dashboardLink(args));
  }
  if (name === "aisha_queue_dirigent_brief") {
    return jsonResult(await queueDirigentBrief(args));
  }
  if (name === "aisha_list_dirigent_briefs") {
    return jsonResult(listDirigentBriefs());
  }
  if (name === "aisha_start_watcher") {
    return jsonResult(startWatcher());
  }
  if (name === "aisha_stop_watcher") {
    return jsonResult(stopWatcher());
  }
  if (name === "aisha_model_routing_status") {
    return jsonResult(modelRoutingStatus());
  }
  if (name === "aisha_build_dirigent_brief") {
    return textResult(await buildDirigentBrief(args));
  }
  if (name === "aisha_sync_rules") {
    return jsonResult(await syncRules());
  }
  return null;
}

async function handleRequest(message) {
  const method = message.method;
  const params = message.params || {};

  if (method === "initialize") {
    return {
      protocolVersion: params.protocolVersion || PROTOCOL_VERSION,
      capabilities: {
        tools: {},
        prompts: {},
      },
      serverInfo: {
        name: "aisha-mcp-stdio-bridge",
        version: BRIDGE_VERSION,
      },
    };
  }

  if (method === "notifications/initialized" || method?.startsWith("notifications/")) {
    return undefined;
  }

  if (method === "tools/list") {
    return {
      tools: [...LOCAL_TOOLS, ...REMOTE_TOOLS],
    };
  }

  if (method === "tools/call") {
    const name = params.name;
    const args = params.arguments || {};
    const local = await callLocalTool(name, args);
    if (local) {
      return local;
    }
    return await callRemoteMcp("tools/call", { name, arguments: args });
  }

  if (method === "prompts/list") {
    return {
      prompts: PROMPTS.map(([name, description]) => ({
        name,
        description,
        arguments: [],
      })),
    };
  }

  if (method === "prompts/get") {
    const prompt = PROMPTS.find(([name]) => name === params.name);
    if (!prompt) {
      throw new Error(`Unknown prompt: ${params.name}`);
    }
    return {
      description: prompt[1],
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: prompt[2],
          },
        },
      ],
    };
  }

  throw new Error(`Unsupported MCP method: ${method}`);
}

function writeMessage(message) {
  const json = JSON.stringify(message);
  const bytes = Buffer.byteLength(json, "utf8");
  process.stdout.write(`Content-Length: ${bytes}\r\n\r\n${json}`);
}

function respond(id, result) {
  if (id === undefined || id === null) {
    return;
  }
  writeMessage({ jsonrpc: "2.0", id, result });
}

function respondError(id, error) {
  if (id === undefined || id === null) {
    stderr(error instanceof Error ? error.message : String(error));
    return;
  }
  writeMessage({
    jsonrpc: "2.0",
    id,
    error: {
      code: -32000,
      message: error instanceof Error ? error.message : String(error),
    },
  });
}

async function processMessage(message) {
  try {
    const result = await handleRequest(message);
    if (result !== undefined) {
      respond(message.id, result);
    }
  } catch (error) {
    respondError(message.id, error);
  }
}

let inputBuffer = Buffer.alloc(0);

function tryParseContentLengthMessage() {
  const headerEnd = inputBuffer.indexOf("\r\n\r\n");
  const altHeaderEnd = inputBuffer.indexOf("\n\n");
  const end = headerEnd >= 0 ? headerEnd : altHeaderEnd;
  const separatorLength = headerEnd >= 0 ? 4 : 2;
  if (end < 0) {
    return null;
  }

  const header = inputBuffer.slice(0, end).toString("utf8");
  const match = header.match(/content-length:\s*(\d+)/i);
  if (!match) {
    return null;
  }

  const length = Number(match[1]);
  const bodyStart = end + separatorLength;
  const bodyEnd = bodyStart + length;
  if (inputBuffer.length < bodyEnd) {
    return undefined;
  }

  const body = inputBuffer.slice(bodyStart, bodyEnd).toString("utf8");
  inputBuffer = inputBuffer.slice(bodyEnd);
  return JSON.parse(body);
}

function tryParseLineMessage() {
  const newline = inputBuffer.indexOf("\n");
  if (newline < 0) {
    return null;
  }
  const line = inputBuffer.slice(0, newline).toString("utf8").trim();
  inputBuffer = inputBuffer.slice(newline + 1);
  if (!line) {
    return null;
  }
  return JSON.parse(line);
}

function pumpInput() {
  while (inputBuffer.length > 0) {
    const looksFramed = inputBuffer.toString("utf8", 0, Math.min(inputBuffer.length, 32)).toLowerCase().startsWith("content-length:");
    const parsed = looksFramed ? tryParseContentLengthMessage() : tryParseLineMessage();
    if (parsed === undefined || parsed === null) {
      return;
    }
    void processMessage(parsed);
  }
}

async function main() {
  if (process.argv.includes("--health-json")) {
    process.stdout.write(JSON.stringify(await health(), null, 2) + "\n");
    return;
  }

  process.stdin.on("data", (chunk) => {
    inputBuffer = Buffer.concat([inputBuffer, chunk]);
    pumpInput();
  });

  process.stdin.on("error", (error) => {
    stderr(`stdin error: ${error.message}`);
  });

  stderr(`started v${BRIDGE_VERSION} root=${ROOT}`);
}

main().catch((error) => {
  stderr(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
