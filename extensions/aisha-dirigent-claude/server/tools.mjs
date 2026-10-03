/**
 * @module tools
 * AISHA Dirigent capability surface, exposed as MCP tools.
 *
 * Each tool mirrors a Dirigent feature that the VS Code / Zed extensions provide
 * inside the editor, made available to Claude Code / Claude Desktop:
 *   - seed + merge tracking        (aisha_seed_status, aisha_merge_status, aisha_db_convergence)
 *   - rules + IDE sync             (aisha_active_rules, aisha_ruleset, aisha_sync_instructions)
 *   - session + story context      (aisha_session, aisha_story, aisha_decisions)
 *   - routing + health             (aisha_route, aisha_models, aisha_health, aisha_bringup, aisha_scan_env)
 *   - cost/usage of local LLMs     (aisha_cost_usage)
 *   - feed / communication         (aisha_feed)
 *
 * Tool contract:
 *   { name, title, description, inputSchema, handler(args, ctx) }
 *   handler → Promise<{ text: string, isError?: boolean }>
 *   ctx     → { root: string }   (resolved workspace root)
 *
 * Handlers are total: they never throw — failures are returned as text with
 * isError, so the protocol layer stays simple.
 */

import { readdirSync } from "node:fs";
import {
  exists,
  hasBin,
  mtimeOf,
  probeJson,
  readJson,
  readText,
  run,
  safeJoin,
} from "./lib.mjs";
import { COMPOSE_TOOLS } from "./compose.mjs";
import { PARITY_TOOLS } from "./parity.mjs";

/** Pretty-print a value as fenced JSON text. */
function asJson(value) {
  return "```json\n" + JSON.stringify(value, null, 2) + "\n```";
}

/**
 * Shared local-stack bring-up entry-point.
 *
 * SoT: scripts/lib/bringup-contract.mjs (STACK_BRINGUP_CMD/_JSON/_ARGS). That
 * module reuses the local-gateway SoT (config/local-presets.mjs). We intentionally
 * DUPLICATE only the minimal argv here instead of importing it: this MCP server is
 * zero-dependency and is packaged standalone into the .mcpb bundle (which ships
 * only `server/` — scripts/lib is NOT bundled), so a relative import outside the
 * server dir would crash the server when installed outside the repo. Keep this in
 * lock-step with the SoT (a gate test asserts the strings match).
 */
// Exported so a drift gate (scripts/ide-adapters/__tests__/claude-app-drift.test.mjs)
// can assert these match scripts/lib/bringup-contract.mjs at CI time.
export const STACK_BRINGUP_ARGS = ["run", "stack:bringup", "--", "--json"];
export const STACK_BRINGUP_CMD = "npm run stack:bringup";

/**
 * Extract the final brace-delimited JSON status line from `stack:bringup --json`
 * stdout. Mirrors parseBringupResult() in the SoT module and the line-scan in the
 * VS Code SetupPanel, so every IDE/agent consumer parses the bring-up identically.
 * @param {string} stdout
 * @returns {object|null}
 */
export function parseBringupResult(stdout) {
  let result = null;
  for (const raw of String(stdout || "").split("\n")) {
    const line = raw.trim();
    if (line.startsWith("{") && line.endsWith("}")) {
      try {
        result = JSON.parse(line);
      } catch {
        /* not the JSON status line — keep scanning */
      }
    }
  }
  return result;
}

/** List files in a workspace-relative dir (sorted), or [] if absent. */
function listDir(root, rel, filterExt) {
  try {
    const full = safeJoin(root, rel);
    return readdirSync(full)
      .filter((f) => (filterExt ? f.endsWith(filterExt) : true))
      .sort();
  } catch {
    return [];
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Session + story context
// ───────────────────────────────────────────────────────────────────────────

const sessionTool = {
  name: "aisha_session",
  title: "AISHA session",
  description:
    "Current Dirigent session: workspace, active story, domain, status, active model/tier. Reads .aisha/session.json.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async handler(_args, { root }) {
    const session = readJson(root, ".aisha/session.json");
    if (!session) {
      return {
        text: "No active session (.aisha/session.json not found). Open the workspace in an editor with AISHA Dirigent, or run `npm run dirigent:bootstrap`.",
      };
    }
    return { text: asJson(session) };
  },
};

const storyTool = {
  name: "aisha_story",
  title: "AISHA story context",
  description:
    "Active story / development direction: story id, inferred domain, active roles and files. Reads .aisha/session.json + active-rules.json.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async handler(_args, { root }) {
    const session = readJson(root, ".aisha/session.json") || {};
    const rules = readJson(root, ".aisha/active-rules.json") || {};
    return {
      text: asJson({
        storyId: session.storyId ?? rules.storyId ?? null,
        domain: session.domain ?? rules.direction?.domain ?? "general",
        direction: rules.direction ?? null,
        activeTemplate: rules.activeTemplate ?? null,
        lastActivityAt: session.lastActivityAt ?? rules.direction?.lastActivityAt ?? null,
      }),
    };
  },
};

const decisionsTool = {
  name: "aisha_decisions",
  title: "AISHA decisions",
  description:
    "Recent Dirigent decisions / reports captured in .aisha/reports (routing choices, gate outcomes, proposals).",
  inputSchema: {
    type: "object",
    properties: { limit: { type: "number", description: "Max reports to list (default 10)" } },
    additionalProperties: false,
  },
  async handler(args, { root }) {
    const limit = Number.isFinite(args?.limit) ? args.limit : 10;
    const files = listDir(root, ".aisha/reports", ".json").slice(-limit);
    if (files.length === 0) return { text: "No decision reports found under .aisha/reports." };
    const out = files.map((f) => ({ file: f, mtime: mtimeOf(root, `.aisha/reports/${f}`) }));
    return { text: asJson({ count: files.length, reports: out }) };
  },
};

// ───────────────────────────────────────────────────────────────────────────
// Rules + IDE sync
// ───────────────────────────────────────────────────────────────────────────

const activeRulesTool = {
  name: "aisha_active_rules",
  title: "AISHA active rules",
  description:
    "Contextual rule subset Dirigent currently applies (by category). Reads .aisha/active-rules.json. Optionally filter by category.",
  inputSchema: {
    type: "object",
    properties: {
      category: {
        type: "string",
        description: "Filter to one category, e.g. security, testing, code_quality, architecture.",
      },
    },
    additionalProperties: false,
  },
  async handler(args, { root }) {
    const rules = readJson(root, ".aisha/active-rules.json");
    if (!rules) return { text: "No .aisha/active-rules.json found. Run `npm run gen:ide` to populate." };
    if (args?.category) {
      const subset = rules.rules?.[args.category];
      if (!subset) {
        return { text: `No rules for category "${args.category}". Available: ${Object.keys(rules.rules || {}).join(", ")}` };
      }
      return { text: asJson({ category: args.category, rules: subset, source: rules.source }) };
    }
    return { text: asJson(rules) };
  },
};

const rulesetTool = {
  name: "aisha_ruleset",
  title: "AISHA ruleset info",
  description:
    "Ruleset fingerprint, context profile, expertise level and active LLM slot profile. Reads .aisha config + cached instruction payload.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async handler(_args, { root }) {
    const tpl = readJson(root, ".aisha/dirigent.template.json") || {};
    const payload = readJson(root, ".aisha/instruction-payload.json") || {};
    const rules = readJson(root, ".aisha/active-rules.json") || {};
    return {
      text: asJson({
        fingerprint: payload.ruleset?.fingerprint ?? null,
        contextProfile: tpl.contextProfile ?? payload.ruleset?.context_profile ?? null,
        expertiseLevel: tpl.expertiseLevel ?? null,
        autonomyMode: tpl.autonomyMode ?? null,
        activeSlotProfile: tpl.routerCoach?.slotProfile ?? null,
        rulesSource: rules.source ?? null,
        rulesUpdatedAt: rules.updatedAt ?? null,
      }),
    };
  },
};

const syncTool = {
  name: "aisha_sync_instructions",
  title: "AISHA sync IDE instructions",
  description:
    "Regenerate IDE instruction files from the AISHA ruleset (the Dirigent `gen:ide` pipeline): CLAUDE.md, .cursorrules, copilot-instructions, claude-overlay, and this claude-app. Defaults to a dry run; set apply=true to write files.",
  inputSchema: {
    type: "object",
    properties: {
      format: {
        type: "string",
        description:
          "Adapter id to regenerate (e.g. claude, claude-overlay, claude-app, cursorrules). Omit for all adapters.",
      },
      apply: {
        type: "boolean",
        description: "When true, write files. When false/omitted, dry-run only (no writes).",
      },
      offline: {
        type: "boolean",
        description: "Use the cached payload (.aisha/instruction-payload.json) instead of fetching from the backend.",
      },
    },
    additionalProperties: false,
  },
  async handler(args, { root }) {
    if (!exists(root, "package.json")) {
      return { text: "No package.json at workspace root — cannot run gen:ide here.", isError: true };
    }
    const cliArgs = ["run", "gen:ide", "--"];
    if (args?.format) cliArgs.push(`--format=${String(args.format)}`);
    if (args?.offline) cliArgs.push("--offline");
    if (!args?.apply) cliArgs.push("--dry-run");
    const r = await run("npm", cliArgs, { cwd: root, timeoutMs: 120_000 });
    const head = `$ npm ${cliArgs.join(" ")}  (exit ${r.code})`;
    const body = (r.stdout || r.stderr || "(no output)").trim().slice(0, 6000);
    return { text: `${head}\n\n${body}`, isError: !r.ok };
  },
};

// ───────────────────────────────────────────────────────────────────────────
// Seed + merge tracking
// ───────────────────────────────────────────────────────────────────────────

const seedTool = {
  name: "aisha_seed_status",
  title: "AISHA seed status",
  description:
    "Database seed tracking: available seed datasets (aisha/db/seed), seed scripts, and git status of seed files.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async handler(_args, { root }) {
    const seeds = listDir(root, "aisha/db/seed").map((f) => ({
      file: f,
      mtime: mtimeOf(root, `aisha/db/seed/${f}`),
    }));
    const altSeeds = listDir(root, "scripts/db").filter((f) => /seed/i.test(f));
    const git = await run("git", ["status", "--porcelain", "--", "aisha/db/seed"], {
      cwd: root,
      timeoutMs: 10_000,
    });
    const dirty = git.ok ? git.stdout.trim().split("\n").filter(Boolean) : [];
    return {
      text: asJson({
        seedDatasets: seeds,
        seedScripts: altSeeds,
        uncommittedSeedChanges: dirty,
        hint: "Apply locally with `npm run db:seed:local`.",
      }),
    };
  },
};

const mergeTool = {
  name: "aisha_merge_status",
  title: "AISHA merge status",
  description:
    "Git merge / branch tracking: current branch, ahead/behind upstream, working-tree changes, and recent merge commits.",
  inputSchema: {
    type: "object",
    properties: { limit: { type: "number", description: "Recent merges to list (default 10)" } },
    additionalProperties: false,
  },
  async handler(args, { root }) {
    const limit = Number.isFinite(args?.limit) ? args.limit : 10;
    if (!(await hasBin("git"))) return { text: "git not available on PATH.", isError: true };
    const branch = (await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root })).stdout.trim();
    const tracking = (await run("git", ["status", "-sb"], { cwd: root })).stdout.split("\n")[0] || "";
    const dirty = (await run("git", ["status", "--porcelain"], { cwd: root })).stdout
      .trim()
      .split("\n")
      .filter(Boolean);
    const merges = (
      await run("git", ["log", "--merges", `-n${limit}`, "--pretty=%h %ci %s"], { cwd: root })
    ).stdout
      .trim()
      .split("\n")
      .filter(Boolean);
    return {
      text: asJson({
        branch,
        tracking: tracking.replace(/^## /, ""),
        changedFiles: dirty.length,
        changes: dirty.slice(0, 50),
        recentMerges: merges,
      }),
    };
  },
};

const convergenceTool = {
  name: "aisha_db_convergence",
  title: "AISHA DB convergence",
  description:
    "Migration / schema convergence tracking: migration files present and any uncommitted migration changes.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async handler(_args, { root }) {
    const migrations = listDir(root, "aisha/db/migrations", ".sql");
    const latest = migrations.slice(-5);
    const git = await run("git", ["status", "--porcelain", "--", "aisha/db/migrations"], {
      cwd: root,
      timeoutMs: 10_000,
    });
    const dirty = git.ok ? git.stdout.trim().split("\n").filter(Boolean) : [];
    return {
      text: asJson({
        migrationCount: migrations.length,
        latestMigrations: latest,
        uncommittedMigrationChanges: dirty,
        hint: "Apply locally with `npm run db:migrate:local`; verify with `npm run db:convergence:verify`.",
      }),
    };
  },
};

// ───────────────────────────────────────────────────────────────────────────
// Routing + models + health + local-LLM cost/usage
// ───────────────────────────────────────────────────────────────────────────

/** Default local LLM endpoints probed for /v1/models (OpenAI-compatible). */
const DEFAULT_LLM_ENDPOINTS = [
  { name: "ollama", url: "http://localhost:11434/v1/models" },
  { name: "docker-model-runner", url: "http://localhost:12434/engines/v1/models" },
  { name: "lmstudio", url: "http://localhost:1234/v1/models" },
  { name: "vllm", url: "http://localhost:8000/v1/models" },
];

const modelsTool = {
  name: "aisha_models",
  title: "AISHA local models",
  description:
    "Discover local LLM models from OpenAI-compatible endpoints (Ollama, Docker Model Runner, LM Studio, vLLM) and show the configured slot profiles. Honors AISHA_LLM_ENDPOINTS (comma-separated URLs).",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async handler(_args, { root }) {
    const custom = (process.env.AISHA_LLM_ENDPOINTS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((url, i) => ({ name: `custom-${i + 1}`, url }));
    const endpoints = custom.length ? custom : DEFAULT_LLM_ENDPOINTS;
    const probes = await Promise.all(
      endpoints.map(async (e) => {
        const data = await probeJson(e.url);
        const models = Array.isArray(data?.data) ? data.data.map((m) => m.id) : [];
        return { provider: e.name, url: e.url, online: data != null, models };
      }),
    );
    const tpl = readJson(root, ".aisha/dirigent.template.json") || {};
    return {
      text: asJson({
        discovered: probes,
        activeSlotProfile: tpl.routerCoach?.slotProfile ?? null,
        slotProfiles: tpl.routerCoach?.slotProfiles ?? null,
      }),
    };
  },
};

const routeTool = {
  name: "aisha_route",
  title: "AISHA route advisor",
  description:
    "Recommend an LLM tier/model for a task using the Dirigent router-coach slot profiles in .aisha/dirigent.template.json.",
  inputSchema: {
    type: "object",
    properties: {
      task: {
        type: "string",
        description: "Task slot: spark (cheap/draft), ember (mid), verify (review), or default.",
      },
      estimatedCostUsd: { type: "number", description: "Estimated spend; compared to the coach threshold." },
    },
    additionalProperties: false,
  },
  async handler(args, { root }) {
    const tpl = readJson(root, ".aisha/dirigent.template.json") || {};
    const coach = tpl.routerCoach || {};
    const profileName = coach.slotProfile || "balanced";
    const profile = coach.slotProfiles?.[profileName] || {};
    const slot = (args?.task && profile[args.task]) || profile.default || null;
    const threshold = coach.costThresholdUsd ?? null;
    const overBudget =
      typeof args?.estimatedCostUsd === "number" && threshold != null
        ? args.estimatedCostUsd > threshold
        : null;
    return {
      text: asJson({
        activeProfile: profileName,
        task: args?.task || "default",
        recommendedModel: slot,
        costThresholdUsd: threshold,
        overBudget,
        suggestion: overBudget
          ? "Estimated cost exceeds the coach threshold — consider the 'budget' slot profile or a local model."
          : "Within budget.",
      }),
    };
  },
};

const costTool = {
  name: "aisha_cost_usage",
  title: "AISHA cost & local-LLM usage",
  description:
    "Cost / token usage overview: persisted usage snapshots from .aisha/reports plus the router cost guardrails and per-slot model→cost mapping. (Live in-session token counts are tracked by the editor extension.)",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async handler(_args, { root }) {
    const tpl = readJson(root, ".aisha/dirigent.template.json") || {};
    const usageFiles = listDir(root, ".aisha/reports", ".json").filter((f) => /usage|cost|token|spend/i.test(f));
    const snapshots = usageFiles.map((f) => ({
      file: f,
      data: readJson(root, `.aisha/reports/${f}`),
    }));
    return {
      text: asJson({
        costThresholdUsd: tpl.routerCoach?.costThresholdUsd ?? null,
        suggestProfileSwitch: tpl.routerCoach?.suggestProfileSwitch ?? null,
        slotProfiles: tpl.routerCoach?.slotProfiles ?? null,
        persistedUsageSnapshots: snapshots.length ? snapshots : "none found under .aisha/reports",
        note: "Local LLMs (Ollama/Docker/vLLM) incur $0 API cost; this tool surfaces config + persisted reports. Use aisha_models to see which local models are online.",
      }),
    };
  },
};

const feedTool = {
  name: "aisha_feed",
  title: "AISHA activity feed",
  description:
    "Recent Dirigent activity / communication feed assembled from .aisha state: last session activity, recent reports, and rule-direction changes.",
  inputSchema: {
    type: "object",
    properties: { limit: { type: "number", description: "Max feed entries (default 15)" } },
    additionalProperties: false,
  },
  async handler(args, { root }) {
    const limit = Number.isFinite(args?.limit) ? args.limit : 15;
    const session = readJson(root, ".aisha/session.json") || {};
    const rules = readJson(root, ".aisha/active-rules.json") || {};
    const reports = listDir(root, ".aisha/reports", ".json")
      .slice(-limit)
      .map((f) => ({ type: "report", file: f, at: mtimeOf(root, `.aisha/reports/${f}`) }));
    const feed = [
      session.lastActivityAt && {
        type: "session",
        status: session.status,
        task: session.currentTask,
        at: session.lastActivityAt,
      },
      rules.updatedAt && { type: "rules-update", domain: rules.direction?.domain, at: rules.updatedAt },
      ...reports,
    ]
      .filter(Boolean)
      .sort((a, b) => String(b.at).localeCompare(String(a.at)))
      .slice(0, limit);
    return { text: asJson({ entries: feed.length, feed }) };
  },
};

const healthTool = {
  name: "aisha_health",
  title: "AISHA health",
  description:
    "Environment health: runtime versions, required CLIs present, .aisha config presence, and reachability of the configured AISHA backend.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async handler(_args, { root }) {
    const [git, node, npm, docker] = await Promise.all([
      hasBin("git"),
      hasBin("node"),
      hasBin("npm"),
      hasBin("docker"),
    ]);
    const local = readJson(root, ".aisha/dirigent.local.json") || {};
    const profile = local.profiles?.[local.activeProfile] || {};
    let backendReachable = null;
    if (profile.aishaUrl) {
      const ping = await probeJson(`${profile.aishaUrl.replace(/\/$/, "")}/health`, 2_000);
      backendReachable = ping != null;
    }
    return {
      text: asJson({
        node: process.version,
        platform: process.platform,
        tools: { git, node, npm, docker },
        aishaConfig: {
          present: exists(root, ".aisha"),
          activeProfile: local.activeProfile ?? null,
          aishaUrl: profile.aishaUrl ?? null,
          backendReachable,
        },
      }),
    };
  },
};

const bringupTool = {
  name: "aisha_bringup",
  title: "AISHA local stack bring-up",
  description:
    "Bring up the local AISHA stack via the shared entry-point `npm run stack:bringup` (non-interactive, health-gated, JSON output) when no backend is reachable. Spawns the bring-up in the workspace, parses the final JSON status line, and returns { healthy, gatewayUrl, services }. Use after aisha_health reports the backend unreachable. Pass dryRun=true to see the exact command (and expected gateway) without starting anything.",
  inputSchema: {
    type: "object",
    properties: {
      dryRun: {
        type: "boolean",
        description: "If true, report the command that would run and the expected gateway WITHOUT starting the stack.",
      },
    },
    additionalProperties: false,
  },
  async handler(args, { root }) {
    if (!exists(root, "package.json")) {
      return { text: "No package.json at workspace root — cannot run stack:bringup here.", isError: true };
    }
    if (args?.dryRun) {
      const local = readJson(root, ".aisha/dirigent.local.json") || {};
      const profile = local.profiles?.[local.activeProfile] || {};
      return {
        text: asJson({
          dryRun: true,
          wouldRun: { command: STACK_BRINGUP_CMD, args: STACK_BRINGUP_ARGS },
          expectedGateway:
            process.env.AISHA_LOCAL_GATEWAY_URL ||
            profile.aishaUrl ||
            "http://localhost:3001 (default; actual gatewayUrl is reported on the bring-up's JSON status line)",
          note: "No stack was started. Re-run without dryRun to bring up the stack — it is health-gated and may take several minutes.",
        }),
      };
    }
    // `stack:bringup` is health-gated and waits for the stack; allow a generous timeout.
    const r = await run("npm", STACK_BRINGUP_ARGS, { cwd: root, timeoutMs: 900_000 });
    const result = parseBringupResult(r.stdout);
    const healthy = r.ok && result?.healthy === true;
    if (!healthy) {
      const reason = result
        ? `stack not healthy (gateway: ${result.gatewayUrl ?? "?"})`
        : `bring-up exited with code ${r.code}`;
      const tail = (r.stderr || r.stdout || "(no output)").trim().slice(-1500);
      return {
        text: asJson({
          ok: false,
          command: STACK_BRINGUP_CMD,
          healthy: result?.healthy ?? false,
          gatewayUrl: result?.gatewayUrl ?? null,
          reason,
          tail,
        }),
        isError: true,
      };
    }
    return {
      text: asJson({
        ok: true,
        command: STACK_BRINGUP_CMD,
        healthy: true,
        gatewayUrl: result.gatewayUrl ?? null,
        preset: result.preset ?? null,
        services: Array.isArray(result.services) ? result.services : [],
      }),
    };
  },
};

const scanEnvTool = {
  name: "aisha_scan_env",
  title: "AISHA scan environment",
  description:
    "Scan the workspace: package manager, declared workspaces, key frameworks/tooling, Docker compose presence, and pinned Node version.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async handler(_args, { root }) {
    const pkg = readJson(root, "package.json") || {};
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const detect = (name) => Object.keys(deps).some((d) => d === name || d.startsWith(`${name}/`) || d.startsWith(`@${name}`));
    const pm = exists(root, "bun.lockb") || exists(root, "bun.lock")
      ? "bun"
      : exists(root, "pnpm-lock.yaml")
        ? "pnpm"
        : exists(root, "package-lock.json")
          ? "npm"
          : exists(root, "yarn.lock")
            ? "yarn"
            : "unknown";
    const compose = listDir(root, ".").filter((f) => /^docker-compose.*\.ya?ml$/.test(f));
    return {
      text: asJson({
        name: pkg.name ?? null,
        version: pkg.version ?? null,
        packageManager: pm,
        nodePinned: (readText(root, ".nvmrc") || "").trim() || pkg.engines?.node || null,
        workspaces: pkg.workspaces ?? null,
        frameworks: {
          react: detect("react"),
          vite: detect("vite"),
          vitest: detect("vitest"),
          playwright: detect("@playwright") || detect("playwright"),
          typescript: detect("typescript"),
        },
        dockerComposeFiles: compose.length,
        scripts: Object.keys(pkg.scripts || {}).filter((s) => /^(gen:|ext:|dirigent|db:|test)/.test(s)).slice(0, 40),
      }),
    };
  },
};

/**
 * Full, ordered tool registry. The claude-app adapter reads this list (via the
 * server's `--list-tools` mode) to declare tools in manifest.json and to emit
 * one slash command per tool for the Claude Code plugin.
 */
export const TOOLS = [
  sessionTool,
  storyTool,
  decisionsTool,
  activeRulesTool,
  rulesetTool,
  syncTool,
  seedTool,
  mergeTool,
  convergenceTool,
  modelsTool,
  routeTool,
  costTool,
  feedTool,
  healthTool,
  bringupTool,
  scanEnvTool,
  // Write-capable composition tools (author .claude/* artifacts; backend-parameterized).
  ...COMPOSE_TOOLS,
  // Parity tools — @aisha command equivalents (local: compliance/estimate/onboard;
  // backend: proposals + spend pending/approve/reject).
  ...PARITY_TOOLS,
];

/** Resources exposed (read-only views of .aisha state). */
export const RESOURCES = [
  { uri: "aisha://session", name: "AISHA session", rel: ".aisha/session.json", mimeType: "application/json" },
  { uri: "aisha://rules", name: "AISHA active rules", rel: ".aisha/active-rules.json", mimeType: "application/json" },
  { uri: "aisha://config", name: "AISHA dirigent config", rel: ".aisha/dirigent.template.json", mimeType: "application/json" },
];
