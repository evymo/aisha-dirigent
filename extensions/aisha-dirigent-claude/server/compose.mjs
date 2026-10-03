/**
 * @module compose
 * Write-capable composition tools — the part of the Claude app that *authors*
 * Claude Code artifacts (skills, hooks, commands, agents, the supervision
 * overlay) tailored to the project.
 *
 * Two levers, by design:
 *   1. Backend-parameterized generation (aisha_overlay_plan / aisha_compose_overlay):
 *      delegates to the AISHA `gen:ide` pipeline, which fetches the ruleset +
 *      claude_hook_bindings for the current story/domain from the backend and
 *      emits exactly the .claude/* artifacts that fit the project. The backend
 *      decides what's appropriate — the tool just applies it.
 *   2. Ad-hoc authoring (aisha_scaffold): writes a single project-tailored
 *      skill/hook/command/agent into .claude/, pre-filled with project context.
 *
 * Safety: every writing tool defaults to a preview/dry-run. Nothing is written
 * unless the caller passes apply=true (Principle of Least Privilege — CLAUDE.md).
 */

import { exists, mergeSettingsJson, readJson, readText, run, writeFile } from "./lib.mjs";

/** Format ids the overlay composer may drive (subset of the gen:ide registry). */
const CLAUDE_FORMATS = new Set(["claude", "claude-overlay", "claude-app"]);

/** Read lightweight project context for tailoring scaffolds. */
function projectContext(root) {
  const rules = readJson(root, ".aisha/active-rules.json") || {};
  const session = readJson(root, ".aisha/session.json") || {};
  return {
    domain: session.domain || rules.direction?.domain || "general",
    storyId: session.storyId || rules.storyId || null,
    categories: Object.keys(rules.rules || {}),
  };
}

function asJson(value) {
  return "```json\n" + JSON.stringify(value, null, 2) + "\n```";
}

// ───────────────────────────────────────────────────────────────────────────
// aisha_overlay_plan — preview backend-driven parameterization (read-only)
// ───────────────────────────────────────────────────────────────────────────

const overlayPlanTool = {
  name: "aisha_overlay_plan",
  title: "AISHA overlay plan",
  description:
    "Preview what the AISHA backend would compose for this project: the Claude artifacts (overlay/CLAUDE.md/app) and the hook bindings keyed to the active story/domain. Read-only — does not write. Run aisha_compose_overlay with apply=true to materialize.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async handler(_args, { root }) {
    const ctx = projectContext(root);
    // Offline mirror of backend-managed Claude hook bindings (kept in sync by a gate test).
    const bindings = readJson(root, "aisha/db/seed/claude_hook_bindings.json");
    const bindingSummary = Array.isArray(bindings)
      ? bindings.map((b) => ({ slug: b.slug ?? b.rule_slug ?? null, event: b.event ?? b.hook_event ?? null }))
      : Array.isArray(bindings?.bindings)
        ? bindings.bindings.map((b) => ({ slug: b.slug ?? b.rule_slug ?? null, event: b.event ?? b.hook_event ?? null }))
        : "no offline mirror found (backend is authoritative when online)";
    return {
      text: asJson({
        project: ctx,
        claudeArtifacts: [
          { format: "claude", writes: "CLAUDE.md" },
          { format: "claude-overlay", writes: ".claude/hooks, agents, skills, commands, statusline, settings.json" },
          { format: "claude-app", writes: "extensions/aisha-dirigent-claude (plugin + MCPB)" },
        ],
        hookBindings: bindingSummary,
        note: "Parameterization is backend-driven: gen:ide fetches the ruleset + hook bindings for this story/domain and emits only what fits. Use aisha_compose_overlay (apply=true) to write.",
      }),
    };
  },
};

// ───────────────────────────────────────────────────────────────────────────
// aisha_compose_overlay — run the backend-parameterized generator (write via apply)
// ───────────────────────────────────────────────────────────────────────────

const composeOverlayTool = {
  name: "aisha_compose_overlay",
  title: "AISHA compose overlay",
  description:
    "Compose Claude Code artifacts for this project via the AISHA gen:ide pipeline (backend-parameterized: rules + hook bindings for the active story/domain). Defaults to a dry run; set apply=true to write. formats defaults to ['claude-overlay'] and may include 'claude' and 'claude-app'.",
  inputSchema: {
    type: "object",
    properties: {
      formats: {
        type: "array",
        items: { type: "string", enum: ["claude", "claude-overlay", "claude-app"] },
        description: "Which Claude adapters to generate. Default: ['claude-overlay'].",
      },
      apply: { type: "boolean", description: "Write files when true; dry-run when false/omitted." },
      offline: { type: "boolean", description: "Use the cached ruleset payload instead of the backend." },
    },
    additionalProperties: false,
  },
  async handler(args, { root }) {
    if (!exists(root, "package.json")) {
      return { text: "No package.json at workspace root — cannot run gen:ide here.", isError: true };
    }
    const requested = Array.isArray(args?.formats) && args.formats.length ? args.formats : ["claude-overlay"];
    const formats = requested.filter((f) => CLAUDE_FORMATS.has(f));
    if (!formats.length) {
      return { text: `No valid formats. Allowed: ${[...CLAUDE_FORMATS].join(", ")}`, isError: true };
    }

    const blocks = [];
    let anyError = false;
    for (const format of formats) {
      const cliArgs = ["run", "gen:ide", "--", `--format=${format}`];
      if (args?.offline) cliArgs.push("--offline");
      if (!args?.apply) cliArgs.push("--dry-run");
      const r = await run("npm", cliArgs, { cwd: root, timeoutMs: 120_000 });
      anyError = anyError || !r.ok;
      blocks.push(
        `$ npm ${cliArgs.join(" ")}  (exit ${r.code})\n${(r.stdout || r.stderr || "(no output)").trim().slice(0, 3000)}`,
      );
    }
    const mode = args?.apply ? "APPLIED" : "DRY-RUN (no files written; pass apply=true to write)";
    return { text: `Mode: ${mode}\n\n${blocks.join("\n\n———\n\n")}`, isError: anyError };
  },
};

// ───────────────────────────────────────────────────────────────────────────
// aisha_scaffold — author a single project-tailored .claude/* artifact (write via apply)
// ───────────────────────────────────────────────────────────────────────────

function scaffoldContent(kind, name, purpose, ctx, hook) {
  const note = "> Scaffolded by AISHA Dirigent (aisha_scaffold) — tailor as needed.";
  const ctxBlock = `Project domain: **${ctx.domain}**${ctx.storyId ? ` · story \`${ctx.storyId}\`` : ""}.${
    ctx.categories.length ? ` Active rule categories: ${ctx.categories.join(", ")}.` : ""
  }`;

  if (kind === "skill") {
    return {
      path: `.claude/skills/${name}/SKILL.md`,
      content: [
        "---",
        `name: ${name}`,
        `description: ${purpose || `Project skill for ${ctx.domain} work in this AISHA repository.`}`,
        "---",
        note,
        "",
        `# ${name}`,
        "",
        purpose || `Use this skill for ${ctx.domain} tasks in this project.`,
        "",
        "## Project context",
        ctxBlock,
        "",
        "## Steps",
        "1. Establish context (see the aisha-dirigent MCP tools: aisha_active_rules, aisha_session).",
        "2. Perform the task following the project rules.",
        "3. Verify (tests/lint/gates) before handing back.",
        "",
      ].join("\n"),
    };
  }
  if (kind === "command") {
    return {
      path: `.claude/commands/${name}.md`,
      content: [
        "---",
        `description: ${purpose || name}`,
        "---",
        note,
        "",
        purpose || `Project command: ${name}.`,
        "",
        `Context: ${ctxBlock}`,
        "",
        "$ARGUMENTS",
        "",
      ].join("\n"),
    };
  }
  if (kind === "agent") {
    return {
      path: `.claude/agents/${name}.md`,
      content: [
        "---",
        `name: ${name}`,
        `description: ${purpose || `Project agent for ${ctx.domain} work.`}`,
        "---",
        note,
        "",
        `You are **${name}**, a project agent for the ${ctx.domain} domain in this AISHA repository.`,
        "",
        purpose || "Describe the agent's responsibilities here.",
        "",
        `Context: ${ctxBlock}`,
        "Follow the project's CLAUDE.md and AISHA rules. Use the aisha-dirigent MCP tools for governance state.",
        "",
      ].join("\n"),
    };
  }
  // hook
  const command = hook.command || `echo "[${name}] ${purpose || "advisory"} (domain: ${ctx.domain})"`;
  return {
    path: `.claude/hooks/${name}.sh`,
    content: ["#!/usr/bin/env bash", `# Scaffolded by AISHA Dirigent — event: ${hook.event}`, "set -euo pipefail", command, ""].join("\n"),
    executable: true,
    settingsEntry: {
      event: hook.event,
      matcher: hook.matcher || "",
      command: `bash "$CLAUDE_PROJECT_DIR/.claude/hooks/${name}.sh"`,
      marker: `aisha-scaffold:${name}`,
    },
  };
}

const scaffoldTool = {
  name: "aisha_scaffold",
  title: "AISHA scaffold artifact",
  description:
    "Author a project-tailored Claude Code artifact (skill | hook | command | agent) into .claude/, pre-filled with project context. Defaults to a preview; set apply=true to write. Refuses to clobber an existing same-slug artifact unless overwrite=true (safest default — protects user content). For kind=hook, also deep-merges an entry into .claude/settings.json, preserving all user keys.",
  inputSchema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["skill", "hook", "command", "agent"], description: "Artifact type." },
      name: { type: "string", description: "Artifact name (slug; used for filename/id)." },
      purpose: { type: "string", description: "What it is for (fills description/body)." },
      event: {
        type: "string",
        enum: ["PreToolUse", "PostToolUse", "SessionStart", "Stop", "UserPromptSubmit", "SubagentStop"],
        description: "Hook event (kind=hook only).",
      },
      matcher: { type: "string", description: "Hook matcher, e.g. a tool name or regex (kind=hook only)." },
      command: { type: "string", description: "Shell command the hook runs (kind=hook only; defaults to an advisory echo)." },
      apply: { type: "boolean", description: "Write files when true; preview when false/omitted." },
      overwrite: {
        type: "boolean",
        description:
          "Allow overwriting an existing same-slug artifact file. Default false: apply=true refuses (isError) if the target already exists, so user content is never silently destroyed.",
      },
    },
    required: ["kind", "name"],
    additionalProperties: false,
  },
  async handler(args, { root }) {
    const { kind, name } = args || {};
    if (!kind || !name) return { text: "kind and name are required.", isError: true };
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(name)) {
      return { text: `Invalid name "${name}" — use letters, digits, dashes.`, isError: true };
    }
    if (kind === "hook" && !args.event) {
      return { text: "kind=hook requires an 'event'.", isError: true };
    }

    const ctx = projectContext(root);
    const art = scaffoldContent(kind, name, args.purpose, ctx, { event: args.event, matcher: args.matcher, command: args.command });

    if (!args.apply) {
      const collides = exists(root, art.path);
      const preview = [
        `Preview (apply=true to write) — ${kind} "${name}":`,
        `→ ${art.path}${collides ? "  ⚠ EXISTS — apply refuses unless overwrite=true" : ""}`,
        "```",
        art.content,
        "```",
      ];
      if (art.settingsEntry) {
        const { event, matcher, command, marker } = art.settingsEntry;
        preview.push(
          "Would deep-merge into .claude/settings.json (preserving your existing keys):",
          asJson({ hooks: { [event]: [{ matcher, hooks: [{ type: "command", command, _aisha: { managed: true, marker } }] }] } }),
        );
      }
      return { text: preview.join("\n") };
    }

    // apply=true → write.
    // Safety (fix #1): never silently clobber a same-slug artifact. Refuse unless
    // overwrite=true so user-authored content is preserved (Principle of Least
    // Privilege — CLAUDE.md). The schema documents this default.
    if (exists(root, art.path) && !args.overwrite) {
      return {
        text: `Refusing to overwrite existing ${kind} at ${art.path}. Pass overwrite=true to replace it, or choose a different name.`,
        isError: true,
      };
    }

    const written = [];
    writeFile(root, art.path, art.content, { executable: Boolean(art.executable) });
    written.push(art.path);

    if (art.settingsEntry) {
      const { event, matcher, command, marker } = art.settingsEntry;
      // Safety (fix #2): deep-merge into settings.json via mergeSettingsJson so a
      // malformed / comment-bearing user file is NOT silently reduced to {} (which
      // the old readJson(...)||{} + re-serialize did, dropping every user key). The
      // AISHA-owned hook entry carries `_aisha.managed: true`; everything the user
      // added survives. We refuse (isError) on invalid existing JSON rather than
      // clobber it.
      const existingRaw = readText(root, ".claude/settings.json") || "";
      let existing;
      try {
        existing = existingRaw.trim() ? JSON.parse(existingRaw) : {};
      } catch (err) {
        return {
          text: `Wrote ${art.path}, but .claude/settings.json is not valid JSON (${err?.message || err}); refusing to merge the hook entry to avoid losing your settings. Fix the JSON and re-run, or add the hook manually.`,
          isError: true,
        };
      }

      const alreadyManaged = Array.isArray(existing?.hooks?.[event])
        ? existing.hooks[event].some(
            (g) => Array.isArray(g?.hooks) && g.hooks.some((h) => h?._aisha?.marker === marker),
          )
        : false;

      if (!alreadyManaged) {
        const patch = {
          hooks: {
            [event]: [
              { matcher, hooks: [{ type: "command", command, _aisha: { managed: true, marker } }] },
            ],
          },
        };
        writeFile(root, ".claude/settings.json", mergeSettingsJson(existingRaw, JSON.stringify(patch)));
        written.push(".claude/settings.json");
      }
    }
    return { text: `Wrote ${kind} "${name}":\n- ${written.join("\n- ")}` };
  },
};

/** Composition tools, appended to the main registry. */
export const COMPOSE_TOOLS = [overlayPlanTool, composeOverlayTool, scaffoldTool];
