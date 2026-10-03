/**
 * @module adapter-claude-app
 * Multi-file adapter: converts AISHA Dirigent into a packaged Claude app.
 *
 * Emits, under `extensions/aisha-dirigent-claude/`, BOTH install formats from a
 * single source of truth (the MCP server's own `--list-tools` surface):
 *
 *   Claude Code plugin                  Claude Desktop Extension (MCPB)
 *   ──────────────────                  ──────────────────────────────
 *   .claude-plugin/plugin.json          manifest.json   (MCPB spec 0.3)
 *   .mcp.json                           package.json
 *   commands/<tool>.md  (1 per tool)    (server/ + icon bundled by packager)
 *   skills/aisha-dirigent/SKILL.md
 *   agents/aisha-dirigent.md
 *   hooks/hooks.json
 *   README.md
 *
 * The hand-written, zero-dependency MCP server lives at
 * `extensions/aisha-dirigent-claude/server/` and is shared by both formats. This
 * adapter never edits the server — it only (re)generates the packaging layer, so
 * the manifests can never drift from the server's real capabilities.
 *
 * Auto-conversion source: the VS Code extension's contributed chat commands are
 * read for the "editor parity" table, and every MCP tool becomes a slash command
 * + a manifest tool entry.
 *
 * Trigger:  npm run gen:ide -- --format=claude-app
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runtimeContractFragment } from "./runtime-contract-fragment.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const APP_DIR = "extensions/aisha-dirigent-claude";
const SERVER_ENTRY = path.join(REPO_ROOT, APP_DIR, "server", "index.mjs");

const AUTO_GEN_MARKER = "Auto-generated from AISHA Expert Overlay ruleset.";
const REGEN_HINT = "regenerate via `npm run gen:ide -- --format=claude-app`";

const meta = {
  id: "claude-app",
  outputPath: "<multi>",
  description: "Claude app package — Claude Code plugin + Claude Desktop Extension (MCPB) for AISHA Dirigent",
  multiFile: true,
};

// ───────────────────────────────────────────────────────────────────────────
// Source-of-truth readers
// ───────────────────────────────────────────────────────────────────────────

/** Read a JSON file from the repo, or return fallback. */
function readRepoJson(rel, fallback = null) {
  try {
    return JSON.parse(readFileSync(path.join(REPO_ROOT, rel), "utf-8"));
  } catch (err) {
    console.warn(`[claude-app] readRepoJson(${rel}) failed: ${err?.message || err} — using fallback`);
    return fallback;
  }
}

/**
 * Derive the tool/resource surface by invoking the server's `--list-tools` mode.
 * This guarantees the package is always in sync with the actual server code.
 * @returns {{ serverInfo: object, tools: Array<{name,title,description,inputSchema}>, resources: Array<object> }}
 */
function readServerSurface() {
  try {
    const out = execFileSync("node", [SERVER_ENTRY, "--list-tools"], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      timeout: 20_000,
    });
    return JSON.parse(out);
  } catch (err) {
    throw new Error(
      `adapter-claude-app: failed to read server surface from ${SERVER_ENTRY} — ${err?.message || err}`,
    );
  }
}

/** Pull the package version from the VS Code Dirigent extension (keeps versions aligned). */
function appVersion() {
  if (process.env.AISHA_CLAUDE_APP_VERSION) return process.env.AISHA_CLAUDE_APP_VERSION;
  const ext = readRepoJson("extensions/aisha-dirigent/package.json", {});
  return ext.version || "0.1.0";
}

const AUTHOR = { name: "evymo", url: "https://github.com/evymo" };
const REPOSITORY = { type: "git", url: "https://github.com/evymo/aisha-dirigent" };
const DESCRIPTION =
  "AISHA Dirigent for Claude — governance rules, seed/merge tracking, model routing, health, and local-LLM cost/usage, exposed as MCP tools.";

// ───────────────────────────────────────────────────────────────────────────
// Small formatting helpers
// ───────────────────────────────────────────────────────────────────────────

/** aisha_seed_status → seed-status (slash-command slug). */
function slug(toolName) {
  return toolName.replace(/^aisha_/, "").replace(/_/g, "-");
}

/** First sentence of a description, for concise frontmatter. */
function firstSentence(text) {
  const m = String(text).match(/^.*?[.:](\s|$)/);
  return (m ? m[0] : String(text)).trim();
}

/** Does a tool take any arguments? */
function hasArgs(tool) {
  return Boolean(tool.inputSchema?.properties && Object.keys(tool.inputSchema.properties).length);
}

/** Markdown auto-gen header (blockquote) for generated .md files. */
function mdHeader() {
  return `> ${AUTO_GEN_MARKER}\n> **Do not edit manually** — ${REGEN_HINT}.\n\n`;
}

// ───────────────────────────────────────────────────────────────────────────
// Builders — JSON manifests
// ───────────────────────────────────────────────────────────────────────────

function buildManifest(surface, version, payload) {
  const manifest = {
    manifest_version: "0.3",
    name: "aisha-dirigent",
    display_name: "AISHA Dirigent",
    version,
    description: DESCRIPTION,
    long_description:
      "Brings the AISHA Dirigent governance overlay into Claude Desktop. Tracks database seeds and git merges, exposes the active rule set, recommends an LLM tier/model via the router-coach, reports environment health, and surfaces local-LLM (Ollama/Docker/vLLM) availability and cost/usage — all backed by a local, zero-dependency MCP server reading your project's .aisha/ state.",
    author: AUTHOR,
    repository: REPOSITORY,
    homepage: "https://github.com/evymo/aisha-dirigent",
    icon: "icon.png",
    license: "Elastic-2.0",
    keywords: ["aisha", "dirigent", "governance", "mcp", "rules", "routing", "devops"],
    server: {
      type: "node",
      entry_point: "server/index.mjs",
      mcp_config: {
        command: "node",
        args: ["${__dirname}/server/index.mjs"],
        env: { AISHA_WORKSPACE: "${user_config.workspace_root}" },
      },
    },
    tools: surface.tools.map((t) => ({ name: t.name, description: firstSentence(t.description) })),
    tools_generated: false,
    user_config: {
      workspace_root: {
        type: "directory",
        title: "AISHA workspace",
        description: "Path to your AISHA project — the folder containing .aisha/ and package.json.",
        required: true,
      },
    },
    compatibility: {
      claude_desktop: ">=0.10.0",
      platforms: ["darwin", "win32", "linux"],
      runtimes: { node: ">=22" },
    },
    _meta: {
      "guru.aisha.dirigent": {
        generated_by: "gen:ide claude-app adapter",
        do_not_edit: true,
        // Deterministic on purpose — no wall-clock timestamp, so the committed
        // manifest only changes when tools/version/fingerprint change (the git
        // commit already records when). Avoids "always modified" diff noise.
        ruleset_fingerprint: payload?.ruleset?.fingerprint ?? null,
      },
    },
  };
  return JSON.stringify(manifest, null, 2) + "\n";
}

function buildPluginJson(version) {
  const plugin = {
    name: "aisha-dirigent",
    description: DESCRIPTION,
    version,
    author: AUTHOR,
    homepage: "https://github.com/evymo/aisha-dirigent",
    repository: REPOSITORY.url,
    license: "Elastic-2.0",
    keywords: ["aisha", "dirigent", "governance", "mcp", "rules"],
  };
  return JSON.stringify(plugin, null, 2) + "\n";
}

function buildMcpJson() {
  const cfg = {
    mcpServers: {
      "aisha-dirigent": {
        command: "node",
        args: ["${CLAUDE_PLUGIN_ROOT}/server/index.mjs"],
        env: { AISHA_WORKSPACE: "${CLAUDE_PROJECT_DIR}" },
      },
    },
  };
  return JSON.stringify(cfg, null, 2) + "\n";
}

function buildPackageJson(version) {
  const pkg = {
    name: "aisha-dirigent-claude",
    version,
    description: DESCRIPTION,
    type: "module",
    private: true,
    license: "Elastic-2.0",
    bin: { "aisha-dirigent-mcp": "server/index.mjs" },
    engines: { node: ">=22" },
    dependencies: {},
  };
  return JSON.stringify(pkg, null, 2) + "\n";
}

function buildHooksJson() {
  const hooks = {
    hooks: {
      SessionStart: [
        {
          hooks: [
            {
              type: "command",
              command: 'node "${CLAUDE_PLUGIN_ROOT}/server/hook-session-context.mjs"',
            },
          ],
        },
      ],
    },
  };
  return JSON.stringify(hooks, null, 2) + "\n";
}

// ───────────────────────────────────────────────────────────────────────────
// Builders — markdown (commands / skill / agent / readme)
// ───────────────────────────────────────────────────────────────────────────

function buildCommand(tool) {
  const mcpName = `mcp__aisha-dirigent__${tool.name}`;
  const fm = [
    "---",
    `description: ${firstSentence(tool.description)}`,
    hasArgs(tool) ? 'argument-hint: "[json arguments]"' : null,
    `allowed-tools: ${mcpName}`,
    "---",
  ]
    .filter(Boolean)
    .join("\n");

  const body = [
    mdHeader().trim(),
    "",
    `Use the \`${tool.name}\` tool from the **aisha-dirigent** MCP server.`,
    "",
    tool.description,
    "",
    hasArgs(tool)
      ? "If the user passed arguments, forward them to the tool as JSON: $ARGUMENTS"
      : "This tool takes no arguments.",
    "",
    "Then summarize the result for the user and call out anything actionable (uncommitted seed/migration changes, over-budget routing, offline services, stale rules).",
    "",
  ].join("\n");

  return `${fm}\n\n${body}`;
}

function buildSkill(surface, editorCommands) {
  const toolRows = surface.tools
    .map((t) => `| \`${t.name}\` | /aisha-dirigent:${slug(t.name)} | ${firstSentence(t.description)} |`)
    .join("\n");

  const editorRows = editorCommands.length
    ? editorCommands.map((c) => `| @aisha /${c.name} | ${c.description || ""} |`).join("\n")
    : "| _(none discovered)_ | |";

  const fm = [
    "---",
    "name: aisha-dirigent",
    `description: ${DESCRIPTION} Use whenever working inside an AISHA project (a .aisha/ folder is present) — to check governance rules before edits, track seeds/merges/migrations, choose an LLM tier via the router-coach, check health, or review local-LLM availability and cost.`,
    "---",
  ].join("\n");

  return [
    fm,
    "",
    mdHeader().trim(),
    "",
    "# AISHA Dirigent",
    "",
    "This skill operates **AISHA Dirigent** from Claude via the local `aisha-dirigent` MCP server. ",
    "It is the Claude-native counterpart of the AISHA Dirigent VS Code / Zed extensions: same governance overlay, exposed as tools.",
    "",
    "## When to use",
    "",
    "- Before committing, merging, or seeding: check `aisha_merge_status`, `aisha_seed_status`, `aisha_db_convergence`.",
    "- Before a costly LLM task: ask `aisha_route` / `aisha_models` for the right tier and whether a local model is online.",
    "- When unsure of project rules: `aisha_active_rules` (optionally by category) and `aisha_ruleset`.",
    "- To orient at session start or when asked about status: `aisha_session`, `aisha_story`, `aisha_feed`, `aisha_health`.",
    "- To regenerate IDE instruction files (CLAUDE.md, overlay, etc.): `aisha_sync_instructions` (dry-run by default; pass apply=true to write).",
    "- To compose Claude artifacts for the project: `aisha_overlay_plan` (preview what the backend would emit), `aisha_compose_overlay` (generate the overlay / CLAUDE.md / app — backend-parameterized by story & domain), `aisha_scaffold` (author a new skill/hook/command/agent into .claude/).",
    "",
    runtimeContractFragment(),
    "## Tools",
    "",
    "| MCP tool | Slash command | Purpose |",
    "| --- | --- | --- |",
    toolRows,
    "",
    "## Editor parity (source: VS Code extension `@aisha` chat commands)",
    "",
    "These editor chat sub-commands are mirrored by the tools above; listed for traceability of the auto-conversion.",
    "",
    "| Editor command | Description |",
    "| --- | --- |",
    editorRows,
    "",
    "## Notes",
    "",
    "- Status/read tools are side-effect free. The composing tools (`aisha_sync_instructions`, `aisha_compose_overlay`, `aisha_scaffold`) **write only when `apply=true`** — they preview/dry-run otherwise (Principle of Least Privilege).",
    "- Composition is **backend-parameterized**: `aisha_compose_overlay` drives `gen:ide`, which pulls the ruleset + hook bindings for the active story/domain and emits exactly the artifacts that fit the project.",
    "- Local LLMs (Ollama/Docker/vLLM) incur $0 API cost; `aisha_cost_usage` surfaces config + persisted reports.",
    "- All tools operate on your project's `.aisha/`, `.claude/`, and git state; nothing leaves the machine.",
    "",
  ].join("\n");
}

function buildAgent(surface) {
  const toolList = surface.tools.map((t) => `mcp__aisha-dirigent__${t.name}`).join(", ");
  const fm = [
    "---",
    "name: aisha-dirigent",
    "description: AISHA Dirigent governance advisor. Use proactively before merges, seeds, or migrations, when choosing an LLM tier/model, or to compose project Claude artifacts. Reports status and can author overlay/skills/hooks via the aisha-dirigent MCP tools (writes only with apply=true).",
    `tools: ${toolList}`,
    "---",
  ].join("\n");

  return [
    fm,
    "",
    mdHeader().trim(),
    "",
    "You are the **AISHA Dirigent** advisor and composer for an AISHA project.",
    "",
    runtimeContractFragment(),
    "On invocation:",
    "1. Establish context — `aisha_session`, `aisha_story`, `aisha_active_rules`.",
    "2. Check state relevant to the request — `aisha_merge_status`, `aisha_seed_status`, `aisha_db_convergence`, `aisha_health`.",
    "3. For model/cost questions — `aisha_route`, `aisha_models`, `aisha_cost_usage`.",
    "4. To compose project artifacts — `aisha_overlay_plan` to preview, then `aisha_compose_overlay` / `aisha_scaffold`.",
    "",
    "Report findings concisely. Flag risks (uncommitted seed/migration changes, over-budget routing, offline backend, stale rules) and recommend the next concrete step. Preview composition first; only write (apply=true) when the user confirms.",
    "",
  ].join("\n");
}

function buildReadme(surface, version) {
  return [
    `# AISHA Dirigent — Claude app (v${version})`,
    "",
    mdHeader().trim(),
    "",
    DESCRIPTION,
    "",
    "This single directory is **two installable artifacts** from one source:",
    "",
    "1. **Claude Code plugin** — `.claude-plugin/plugin.json` + `commands/`, `skills/`, `agents/`, `hooks/`, `.mcp.json`.",
    "2. **Claude Desktop Extension (MCPB)** — `manifest.json` + bundled `server/` (packaged to `.mcpb`).",
    "",
    "Both run the same local, zero-dependency MCP server in `server/`.",
    "",
    "## Install — Claude Code (plugin)",
    "",
    "```bash",
    "# from a marketplace that lists this repo, or for local dev:",
    "claude plugin install ./extensions/aisha-dirigent-claude",
    "```",
    "",
    "The plugin's `.mcp.json` launches the server with `AISHA_WORKSPACE=${CLAUDE_PROJECT_DIR}`, so it reads the project you have open.",
    "",
    "## Install — Claude Desktop (.mcpb)",
    "",
    "```bash",
    "npm run package:claude-app      # builds dist/claude-app/aisha-dirigent.mcpb",
    "```",
    "",
    "Then double-click the `.mcpb`, or Settings → Extensions → Install, and pick your AISHA workspace folder when prompted.",
    "",
    `## Tools (${surface.tools.length})`,
    "",
    "| Tool | Purpose |",
    "| --- | --- |",
    ...surface.tools.map((t) => `| \`${t.name}\` | ${firstSentence(t.description)} |`),
    "",
    "## Regenerate",
    "",
    "This packaging layer is generated. Edit the server (`server/*.mjs`) or the adapter",
    "(`scripts/ide-adapters/adapter-claude-app.mjs`), then:",
    "",
    "```bash",
    "npm run gen:ide -- --format=claude-app   # regenerate manifests + commands",
    "npm run package:claude-app               # rebuild the .mcpb bundle",
    "```",
    "",
  ].join("\n");
}

// ───────────────────────────────────────────────────────────────────────────
// generate()
// ───────────────────────────────────────────────────────────────────────────

/**
 * @param {object} payload  IDE instruction payload (ruleset SoT).
 * @returns {{ files: Array<{path:string, content:string, mode?:string}> }}
 */
async function generate(payload) {
  const surface = readServerSurface();
  const version = appVersion();
  const ext = readRepoJson("extensions/aisha-dirigent/package.json", {});
  const editorCommands = ext?.contributes?.chatParticipants?.[0]?.commands || [];

  const files = [];
  const add = (rel, content, extra = {}) => files.push({ path: `${APP_DIR}/${rel}`, content, ...extra });

  // MCPB + plugin manifests
  add("manifest.json", buildManifest(surface, version, payload));
  add(".claude-plugin/plugin.json", buildPluginJson(version));
  add(".mcp.json", buildMcpJson());
  add("package.json", buildPackageJson(version));
  add("hooks/hooks.json", buildHooksJson());

  // One slash command per MCP tool (auto-mapped)
  for (const tool of surface.tools) {
    add(`commands/${slug(tool.name)}.md`, buildCommand(tool));
  }

  // Skill + agent + readme
  add("skills/aisha-dirigent/SKILL.md", buildSkill(surface, editorCommands));
  add("agents/aisha-dirigent.md", buildAgent(surface));
  add("README.md", buildReadme(surface, version));

  return { files };
}

export { meta, generate };
