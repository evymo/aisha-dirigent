/**
 * TS port of scripts/ide-adapters/adapter-claude-overlay.mjs.
 *
 * Templates are embedded at build time via esbuild's `text` loader
 * (see esbuild.config.js) — no runtime workspace.fs dependency. This means
 * the extension can generate the supervision overlay even before the user
 * has anything in their `.aisha/` directory.
 *
 * Drift between this file and the .mjs sibling is detected by
 * src/tests/gates/claude-overlay-drift.gate.test.ts in the repo root.
 *
 * @module
 */

import type { IdeAdapter, InstructionPayload, AdapterOutput } from "./registry";
import type { GeneratedFile, MultiFileOutput } from "./multi-file";

// ---------------------------------------------------------------------------
// Bundled templates (loaded as text by esbuild)
// ---------------------------------------------------------------------------

// Templates live under repo root scripts/ide-adapters/templates/claude-overlay/
// — same SoT as the CLI .mjs adapter consumes. Drift between CLI bytes and
// extension bytes is caught by the gate test.
//
// @ts-expect-error — esbuild text loader resolves .sh imports to string
import advisorLib from "../../../../scripts/ide-adapters/templates/claude-overlay/_aisha-advise-lib.sh";
// @ts-expect-error
import advisorI18n from "../../../../scripts/ide-adapters/templates/claude-overlay/aisha-advise-i18n.sh";
// @ts-expect-error
import advisorBashRisk from "../../../../scripts/ide-adapters/templates/claude-overlay/aisha-advise-bash-risk.sh";
// @ts-expect-error
import regexHookTemplate from "../../../../scripts/ide-adapters/templates/claude-overlay/regex-hook.template.sh";
// @ts-expect-error
import advisorAgent from "../../../../scripts/ide-adapters/templates/claude-overlay/aisha-advisor.md";
// @ts-expect-error
import supervisorSkill from "../../../../scripts/ide-adapters/templates/claude-overlay/aisha-supervisor.SKILL.md";
// @ts-expect-error
import cmdAdvise from "../../../../scripts/ide-adapters/templates/claude-overlay/cmd-aisha-advise.md";
// @ts-expect-error
import cmdSupervise from "../../../../scripts/ide-adapters/templates/claude-overlay/cmd-aisha-supervise.md";
// @ts-expect-error
import cmdCooldowns from "../../../../scripts/ide-adapters/templates/claude-overlay/cmd-aisha-cooldowns.md";
// @ts-expect-error
import statusline from "../../../../scripts/ide-adapters/templates/claude-overlay/statusline.sh";
// @ts-expect-error — template stored as .mjs.txt so Vite/esbuild don't try
// to parse its top-level await (script is extracted to disk, not bundled
// for execution inside the extension).
import supervisorRelay from "../../../../scripts/ide-adapters/templates/claude-overlay/aisha-supervisor-relay.mjs.txt";

// Bindings JSON also bundled (same SoT pattern, must stay in sync with the
// SQL seed — gate test claude-overlay-drift verifies).
import bindingsMirror from "../../../../aisha/db/seed/claude_hook_bindings.json";

// Canonical binding contract — the SINGLE definition lives in fetch-bindings.ts
// (alongside its parser); importing it here `type`-only keeps the two consumers
// from drifting apart. The import is erased at build time, preserving the
// no-runtime-dependency guarantee the bundler relies on (see file header).
import type { ClaudeHookBinding } from "./fetch-bindings";

// ---------------------------------------------------------------------------
// Payload type — the binding contract itself (ClaudeHookBinding) is imported
// from ./fetch-bindings in the import block above.
// ---------------------------------------------------------------------------

interface PayloadWithBindings extends InstructionPayload {
  claude_hook_bindings?: ClaudeHookBinding[];
}

// ---------------------------------------------------------------------------
// Adapter metadata
// ---------------------------------------------------------------------------

const meta = {
  id: "claude-overlay",
  outputPath: "<multi>",
  description:
    "Claude Code supervision overlay (.claude/hooks + agent + skill + commands + statusline + settings)",
  multiFile: true,
};

// ---------------------------------------------------------------------------
// Template helpers (mirror of .mjs sibling — must produce byte-identical output)
// ---------------------------------------------------------------------------

const AUTO_GEN_MARKER = "Auto-generated from AISHA Expert Overlay ruleset.";

function runtimeContractFragment(): string {
  return [
    "## AISHA Runtime Contract",
    "",
    "- Treat AISHA Gateway as the only app-facing backend surface: `/rest/v1/rpc/*`, `/functions/v1/*`, `/admin/*`, and MCP URLs from `.well-known/app-config.json`.",
    "- Use `@aisha/api-core`, generated RPC types, and `api.rpc(...)` / `api.invoke(...)` contracts. Do not create parallel raw " +
      "Supa" +
      "base/Postgres clients in editor plugins or mobile/desktop shells.",
    "- Bring up local services with `npm run stack:bringup`; run `npm run gen:ide` after runtime, env, or rule changes so Cursor/Windsurf/Zed/Claude/Codex surfaces stay aligned.",
    "- Plugin execution is isolated through `svc-plugin-system` and `svc-agent-runner`; broker tokens require `BROKER_TOKEN_SECRET` and plugin LLM calls must go through `/functions/v1/ai-generate`, not vendor APIs.",
    "- Environment and dynamic functions are generated from `config/local-presets.mjs`, `scripts/render-app-config.mjs`, `scripts/local-compose-gen.mjs`, and gateway `ROUTE_TABLE`. Add a route/table/env entry before referencing a new function.",
    "",
  ].join("\n");
}

function applyTemplate(tpl: string, vars: Record<string, string | number>): string {
  let out = tpl;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{{${k}}}`).join(String(v));
  }
  return out;
}

function hookSlugToFilename(slug: string): string {
  let s = slug;
  if (s.startsWith("no-")) s = s.slice(3);
  if (s.endsWith("-only")) s = s.slice(0, -5);
  return `aisha-advise-${s}.sh`;
}

function injectAutoGenHeader(content: string): string {
  if (content.includes(AUTO_GEN_MARKER)) return content;
  const headerBlock =
    `> ${AUTO_GEN_MARKER}\n` +
    `> **Do not edit manually** — regenerate via \`npm run gen:ide -- --format=claude-overlay\`.\n\n`;
  const userSectionBlock =
    `\n<!-- aisha:user-section:start -->\n` +
    `<!--\n  Anything between these markers is preserved across regenerations.\n  Add project-specific notes, overrides, or constraints that Claude/Copilot\n  should always see. Lines outside this block may be regenerated by Dirigent.\n-->\n` +
    `<!-- aisha:user-section:end -->\n`;

  let withHeader: string;
  if (content.startsWith("---\n")) {
    const fmEnd = content.indexOf("\n---\n", 4);
    if (fmEnd !== -1) {
      const fmClose = fmEnd + "\n---\n".length;
      withHeader = content.slice(0, fmClose) + "\n" + headerBlock + content.slice(fmClose);
    } else {
      withHeader = headerBlock + content;
    }
  } else if (/^#\s+/.test(content)) {
    const firstBlank = content.indexOf("\n\n");
    if (firstBlank !== -1) {
      withHeader =
        content.slice(0, firstBlank + 2) + headerBlock + content.slice(firstBlank + 2);
    } else {
      withHeader = content + "\n\n" + headerBlock;
    }
  } else {
    withHeader = headerBlock + content;
  }
  return withHeader.includes("<!-- aisha:user-section:start -->")
    ? withHeader
    : withHeader + userSectionBlock;
}

function injectRuntimeContract(content: string): string {
  if (content.includes("## AISHA Runtime Contract")) return content;
  const firstHeading = content.indexOf("\n# ");
  if (firstHeading === -1) return runtimeContractFragment() + content;
  const firstBlankAfterHeading = content.indexOf("\n\n", firstHeading + 1);
  if (firstBlankAfterHeading === -1) return content + "\n\n" + runtimeContractFragment();
  return (
    content.slice(0, firstBlankAfterHeading + 2) +
    runtimeContractFragment() +
    content.slice(firstBlankAfterHeading + 2)
  );
}

function renderRegexHook(binding: ClaudeHookBinding): { filename: string; content: string } {
  if (!binding.pattern_regex) {
    throw new Error(`claude-overlay: regex binding ${binding.rule_slug} missing pattern_regex`);
  }
  const filename = hookSlugToFilename(binding.rule_slug);
  const hintLine = binding.hint ? `Tip: ${binding.hint}` : "";
  const content = applyTemplate(regexHookTemplate as string, {
    HOOK_FILENAME: filename,
    RULE_SLUG: binding.rule_slug,
    SEVERITY: binding.severity,
    HOOK_EVENT: binding.hook_event,
    MATCHER: binding.matcher,
    PATTERN_REGEX: binding.pattern_regex,
    COOLDOWN_SEC: binding.cooldown_sec,
    MESSAGE_CS: binding.messages.cs,
    HINT_LINE: hintLine,
  });
  return { filename, content };
}

/**
 * Pick the relay binding (scanner_kind='relay') — mirror of the .mjs sibling.
 * The supervisor relay's behaviour is seed data; missing row = broken SoT.
 */
function pickRelayBinding(bindings: ClaudeHookBinding[]): ClaudeHookBinding {
  const relay = bindings.find(
    (b) => b.scanner_kind === "relay" && b.rule_slug === "supervisor-relay",
  );
  if (!relay || typeof relay.config !== "object" || relay.config === null) {
    throw new Error(
      "adapter-claude-overlay: missing 'supervisor-relay' binding (scanner_kind='relay') with config — seed aisha/db/seed/claude_hook_bindings.json is the SoT",
    );
  }
  if (!Array.isArray(relay.config.events) || relay.config.events.length === 0) {
    throw new Error("adapter-claude-overlay: supervisor-relay config.events must be a non-empty array");
  }
  return relay;
}

/**
 * Render the supervisor relay script with the binding's config injected as
 * the CONFIG constant — mirror of the .mjs sibling (byte parity).
 */
function renderRelayScript(relayBinding: ClaudeHookBinding): string {
  return applyTemplate(supervisorRelay as string, {
    RELAY_CONFIG_JSON: JSON.stringify(relayBinding.config, null, 2),
  });
}

function renderSettingsFragment(
  regexBindings: ClaudeHookBinding[],
  hookFilenamesByEvent: {
    PreToolUse: Array<{ filename: string; rule_slug: string }>;
    Bash: Array<{ filename: string; rule_slug: string }>;
  },
  relayBinding: ClaudeHookBinding,
): string {
  const preToolUseHooks = hookFilenamesByEvent.PreToolUse.map((entry) => ({
    type: "command",
    command: `\${CLAUDE_PROJECT_DIR}/.claude/hooks/${entry.filename}`,
    _aisha: { kind: "advisory", rule: entry.rule_slug, managed: true },
  }));
  const bashHooks = hookFilenamesByEvent.Bash.map((entry) => ({
    type: "command",
    command: `\${CLAUDE_PROJECT_DIR}/.claude/hooks/${entry.filename}`,
    _aisha: { kind: "advisory", rule: entry.rule_slug, managed: true },
  }));

  // Vrstva 2 HTTP relay — wired per relayBinding.config.events (data-driven,
  // mirror of the .mjs sibling).
  const relayHook = (eventArg: string) => ({
    type: "command",
    command: `node \${CLAUDE_PROJECT_DIR}/.claude/hooks/aisha-supervisor-relay.mjs ${eventArg}`,
    _aisha: { kind: "relay", event: eventArg, managed: true },
  });

  type HookEntry = { matcher?: string; hooks: Array<object> };
  const hooksFragment: Record<string, HookEntry[]> = {};
  const pushEntry = (hookEvent: string, matcher: string | undefined, hook: object) => {
    hooksFragment[hookEvent] = hooksFragment[hookEvent] || [];
    const existing = hooksFragment[hookEvent].find(
      (e) => (e.matcher || "") === (matcher || ""),
    );
    if (existing) {
      existing.hooks.push(hook);
    } else {
      hooksFragment[hookEvent].push(matcher ? { matcher, hooks: [hook] } : { hooks: [hook] });
    }
  };

  // 1. Advisory regex + heuristic hooks (fixed Edit|Write|MultiEdit + Bash wiring)
  for (const hook of preToolUseHooks) {
    pushEntry("PreToolUse", "Edit|Write|MultiEdit", hook);
  }
  for (const hook of bashHooks) {
    pushEntry("PreToolUse", "Bash", hook);
  }

  // 2. Relay events from binding config ('*' or absent matcher = no matcher key)
  const relayEvents = relayBinding.config?.events ?? [];
  for (const evt of relayEvents) {
    const matcher = evt.matcher && evt.matcher !== "*" ? evt.matcher : undefined;
    pushEntry(evt.hook_event, matcher, relayHook(evt.arg));
  }

  const fragment: Record<string, unknown> = {
    permissions: {
      allow: [
        "Bash(cat .claude/*)",
        "Bash(cat .mcp.json)",
        "Bash(ls /tmp/aisha-advise-*)",
        "Bash(rm -f /tmp/aisha-advise-*)",
        "Bash(bash .claude/hooks/aisha-*)",
        "mcp__aisha-knowledge__*",
      ],
    },
    hooks: hooksFragment,
    statusLine: {
      type: "command",
      command: "${CLAUDE_PROJECT_DIR}/.claude/statusline.sh",
      padding: 0,
      _aisha: { kind: "statusline", managed: true },
    },
    _aisha_managed: {
      version: "1.2.0",
      principle: "advisory-only — hooks emit additionalContext, never deny actions",
      generator: "adapter-claude-overlay",
      bindings_count: regexBindings.length + 2,
      relay_events: relayEvents.map((e) => e.arg),
      regenerate_with: "npm run gen:ide -- --format=claude-overlay",
    },
  };
  return JSON.stringify(fragment, null, 2) + "\n";
}

// ---------------------------------------------------------------------------
// Public adapter API
// ---------------------------------------------------------------------------

function generate(payload: InstructionPayload): AdapterOutput {
  const p = payload as PayloadWithBindings;
  const allBindings: ClaudeHookBinding[] = Array.isArray(p.claude_hook_bindings)
    ? p.claude_hook_bindings
    : (bindingsMirror as { bindings: ClaudeHookBinding[] }).bindings || [];
  const bindings = allBindings.filter((b) => b.scanner_kind === "regex");
  const relayBinding = pickRelayBinding(allBindings);

  const files: GeneratedFile[] = [];

  files.push({
    path: ".claude/hooks/_aisha-advise-lib.sh",
    content: advisorLib as string,
    mode: "executable",
  });
  files.push({
    path: ".claude/hooks/aisha-advise-i18n.sh",
    content: advisorI18n as string,
    mode: "executable",
  });
  files.push({
    path: ".claude/hooks/aisha-advise-bash-risk.sh",
    content: advisorBashRisk as string,
    mode: "executable",
  });
  files.push({
    path: ".claude/hooks/aisha-supervisor-relay.mjs",
    // CONFIG ({{RELAY_CONFIG_JSON}}) injected from the supervisor-relay
    // binding's config jsonb — the script interprets seed data.
    content: renderRelayScript(relayBinding),
    mode: "executable",
  });

  const filenamesByEvent = {
    PreToolUse: [] as Array<{ filename: string; rule_slug: string }>,
    Bash: [] as Array<{ filename: string; rule_slug: string }>,
  };
  for (const b of bindings) {
    const { filename, content } = renderRegexHook(b);
    files.push({
      path: `.claude/hooks/${filename}`,
      content,
      mode: "executable",
    });
    const bucket = b.hook_event === "PreToolUse" && b.matcher !== "Bash" ? "PreToolUse" : "Bash";
    filenamesByEvent[bucket].push({ filename, rule_slug: b.rule_slug });
  }
  filenamesByEvent.PreToolUse.push({ filename: "aisha-advise-i18n.sh", rule_slug: "i18n" });
  filenamesByEvent.Bash.push({ filename: "aisha-advise-bash-risk.sh", rule_slug: "bash-risk" });

  files.push({
    path: ".claude/agents/aisha-advisor.md",
    content: injectAutoGenHeader(injectRuntimeContract(advisorAgent as string)),
  });
  files.push({
    path: ".claude/skills/aisha-supervisor/SKILL.md",
    content: injectAutoGenHeader(injectRuntimeContract(supervisorSkill as string)),
  });
  files.push({
    path: ".claude/commands/aisha-advise.md",
    content: injectAutoGenHeader(cmdAdvise as string),
  });
  files.push({
    path: ".claude/commands/aisha-supervise.md",
    content: injectAutoGenHeader(cmdSupervise as string),
  });
  files.push({
    path: ".claude/commands/aisha-cooldowns.md",
    content: injectAutoGenHeader(cmdCooldowns as string),
  });
  files.push({
    path: ".claude/statusline.sh",
    content: statusline as string,
    mode: "executable",
  });
  files.push({
    path: ".claude/settings.json",
    content: renderSettingsFragment(bindings, filenamesByEvent, relayBinding),
    merge: "merge-json-keys",
  });

  return { files } satisfies MultiFileOutput;
}

export const adapterClaudeOverlay: IdeAdapter = { meta, generate };
