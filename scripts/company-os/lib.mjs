/**
 * @module company-os/lib
 * AISHA Company OS — customizable agent-fleet layer (docs/AISHA_COMPANY_OS.md).
 *
 * Pure generation core: load + validate a fleet manifest (company-os/fleet.json),
 * resolve per-agent defaults (slots → models, autonomy → tools, brain files),
 * and emit the multi-file artifact set:
 *
 *   .claude/agents/<prefix>-<slug>.md      one subagent per fleet agent
 *   .claude/commands/<prefix>-<slug>.md    /<prefix>-<slug> delegation command
 *   .claude/commands/<prefix>-ship.md      review-gate ritual (requires review agent)
 *   .claude/commands/<prefix>-weekly.md    weekly planning ritual
 *   company-os/agent-map.md                generated fleet overview
 *
 * Output is deterministic (no timestamps) — `check` mode is a pure content
 * diff. Every emitted file carries the shared AUTO_GEN_MARKER so it falls
 * under the safeWriteSync contract (user-owned files refused, user-section
 * preserved); the marker line is followed by the accurate provenance line
 * pointing at company-os/fleet.json.
 *
 * Shared agent fields mirror plugin_catalog.agent_spec (see
 * aisha/db/sql/functions/materialize_agent_runtime.sql) so `emitAgentSpec`
 * can bridge a local agent into the marketplace publish flow.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  AUTO_GEN_MARKER,
  USER_SECTION_CLOSE,
  USER_SECTION_OPEN,
  extractUserSection,
  injectUserSection,
} from "../lib/ide-instructions-safety.mjs";

// ---------------------------------------------------------------------------
// Constants — contract vocabulary
// ---------------------------------------------------------------------------

export const INSTANCE_DIR = "company-os";
export const FLEET_FILE = "company-os/fleet.json";
export const BRAIN_DIR = "company-os/brain";
export const AGENT_MAP_FILE = "company-os/agent-map.md";
export const PRESETS_DIR = "config/company-os/presets";
export const BRAIN_TEMPLATES_DIR = "config/company-os/brain-templates";

export const SLOTS = ["spark", "ember", "verify", "default"];
export const AUTONOMY_LEVELS = ["advisory", "draft", "execute"];
export const CLAUDE_MODELS = ["haiku", "sonnet", "opus", "inherit"];

export const DEFAULT_PREFIX = "os";
export const DEFAULT_SLOT = "ember";
export const DEFAULT_AUTONOMY = "draft";
export const DEFAULT_SLOT_MODELS = Object.freeze({
  spark: "haiku",
  ember: "sonnet",
  verify: "opus",
  default: "inherit",
});

/** Tools derived from autonomy when the manifest does not list tools.claude. */
export const AUTONOMY_TOOLS = Object.freeze({
  advisory: Object.freeze(["Read", "Grep", "Glob"]),
  draft: Object.freeze(["Read", "Grep", "Glob", "Write", "Edit", "WebSearch", "WebFetch"]),
  execute: Object.freeze(["Read", "Grep", "Glob", "Write", "Edit", "WebSearch", "WebFetch", "Bash"]),
});

/** Tools an advisory agent must never carry — the decision-seat guarantee. */
export const WRITE_CAPABLE_TOOLS = Object.freeze(["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash"]);

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,30}$/;
const PREFIX_RE = /^[a-z][a-z0-9]{0,11}$/;
const BRAIN_FILE_RE = /^[a-z0-9][a-z0-9-]*\.md$/;
const MCP_TOOL_RE = /^mcp__[A-Za-z0-9_-]+__[A-Za-z0-9_-]+$/;

/**
 * Slugs an agent may not claim. generateFleet emits ritual commands at
 * .claude/commands/<prefix>-ship.md and <prefix>-weekly.md; a per-agent
 * command lands at .claude/commands/<prefix>-<slug>.md. An agent slug of
 * "ship" or "weekly" therefore produces two artifacts at the SAME path with
 * different content — a silent overwrite plus a drift check that can never
 * reconcile (permanently red). Reject at validation instead.
 */
const RESERVED_SLUGS = new Set(["ship", "weekly"]);

const MANIFEST_KEYS = new Set(["$schema", "version", "preset", "prefix", "owner", "slot_models", "defaults", "agents"]);
const OWNER_KEYS = new Set(["name", "decision_seat"]);
const DEFAULTS_KEYS = new Set(["slot", "autonomy_level", "brain"]);
const AGENT_KEYS = new Set([
  "slug", "title", "purpose", "mission", "best_for", "tip", "role",
  "slot", "autonomy_level", "brain", "outputs", "tools", "platform",
]);
const TOOLS_KEYS = new Set(["claude", "mcp"]);
const PLATFORM_KEYS = new Set([
  "default_model", "context_profile", "max_loops", "safety_level", "rule_slugs", "knowledge_items",
]);

/** Credential-looking patterns that must never live in brain files. */
const SECRET_PATTERNS = [
  { re: /sk-[A-Za-z0-9]{16,}/, label: "provider API key (sk-…)" },
  { re: /AKIA[0-9A-Z]{16}/, label: "AWS access key id (AKIA…)" },
  { re: /ghp_[A-Za-z0-9]{30,}/, label: "GitHub personal access token (ghp_…)" },
  { re: /xox[baprs]-[A-Za-z0-9-]{10,}/, label: "Slack token (xox…)" },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: "PEM private key block" },
];

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * Read + parse a fleet manifest JSON file.
 * @param {string} absPath
 * @returns {object}
 */
export function loadManifest(absPath) {
  if (!existsSync(absPath)) {
    throw new Error(`Fleet manifest not found: ${absPath} (run \`npm run company-os:init\` first)`);
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(absPath, "utf-8"));
  } catch (err) {
    throw new Error(`Fleet manifest is not valid JSON: ${absPath} — ${err.message}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Fleet manifest must be a JSON object: ${absPath}`);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Validation — reject unexpected shapes instead of coercing them
// ---------------------------------------------------------------------------

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function checkUnknownKeys(obj, allowed, where, errors) {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) errors.push(`${where}: unknown key "${key}"`);
  }
}

function checkStringArray(value, where, itemRe, itemLabel, errors) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push(`${where}: must be an array`);
    return;
  }
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0) {
      errors.push(`${where}: entries must be non-empty strings`);
    } else if (itemRe && !itemRe.test(item)) {
      errors.push(`${where}: "${item}" does not match ${itemLabel}`);
    }
  }
}

/**
 * Validate a fleet manifest.
 *
 * @param {object} manifest  Parsed manifest.
 * @param {object} [opts]
 * @param {string=} opts.brainDir  Absolute path to company-os/brain. When given,
 *   every referenced brain file must exist (gen-time strictness); omit for
 *   preset-time validation where the instance does not exist yet.
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function validateManifest(manifest, opts = {}) {
  const errors = [];
  const warnings = [];

  if (!isPlainObject(manifest)) {
    return { errors: ["manifest: must be a JSON object"], warnings };
  }
  checkUnknownKeys(manifest, MANIFEST_KEYS, "manifest", errors);

  if (manifest.version !== 1) {
    errors.push(`manifest.version: must be 1 (got ${JSON.stringify(manifest.version)})`);
  }
  if (manifest.prefix !== undefined && (typeof manifest.prefix !== "string" || !PREFIX_RE.test(manifest.prefix))) {
    errors.push(`manifest.prefix: must match ${PREFIX_RE} (got ${JSON.stringify(manifest.prefix)})`);
  }
  if (manifest.preset !== undefined && typeof manifest.preset !== "string") {
    errors.push("manifest.preset: must be a string");
  }

  if (manifest.owner !== undefined) {
    if (!isPlainObject(manifest.owner)) {
      errors.push("manifest.owner: must be an object");
    } else {
      checkUnknownKeys(manifest.owner, OWNER_KEYS, "manifest.owner", errors);
      if (manifest.owner.decision_seat !== undefined && manifest.owner.decision_seat !== true) {
        errors.push("manifest.owner.decision_seat: must be true — the human decides, the agents execute");
      }
    }
  }

  if (manifest.slot_models !== undefined) {
    if (!isPlainObject(manifest.slot_models)) {
      errors.push("manifest.slot_models: must be an object");
    } else {
      for (const [slot, model] of Object.entries(manifest.slot_models)) {
        if (!SLOTS.includes(slot)) {
          errors.push(`manifest.slot_models: unknown slot "${slot}" (allowed: ${SLOTS.join(", ")})`);
        }
        if (!CLAUDE_MODELS.includes(model)) {
          errors.push(`manifest.slot_models.${slot}: unknown model "${model}" (allowed: ${CLAUDE_MODELS.join(", ")})`);
        }
      }
    }
  }

  if (manifest.defaults !== undefined) {
    if (!isPlainObject(manifest.defaults)) {
      errors.push("manifest.defaults: must be an object");
    } else {
      checkUnknownKeys(manifest.defaults, DEFAULTS_KEYS, "manifest.defaults", errors);
      if (manifest.defaults.slot !== undefined && !SLOTS.includes(manifest.defaults.slot)) {
        errors.push(`manifest.defaults.slot: unknown slot "${manifest.defaults.slot}"`);
      }
      if (manifest.defaults.autonomy_level !== undefined && !AUTONOMY_LEVELS.includes(manifest.defaults.autonomy_level)) {
        errors.push(`manifest.defaults.autonomy_level: unknown level "${manifest.defaults.autonomy_level}"`);
      }
      checkStringArray(manifest.defaults.brain, "manifest.defaults.brain", BRAIN_FILE_RE, "a brain file name (*.md, no paths)", errors);
    }
  }

  if (!Array.isArray(manifest.agents) || manifest.agents.length === 0) {
    errors.push("manifest.agents: must be a non-empty array");
    return { errors, warnings };
  }

  const seenSlugs = new Set();
  const reviewSlugs = [];
  const brainRefs = new Set(collectDefaultBrain(manifest));

  manifest.agents.forEach((agent, i) => {
    const where = `agents[${i}]${agent && typeof agent.slug === "string" ? ` (${agent.slug})` : ""}`;
    if (!isPlainObject(agent)) {
      errors.push(`${where}: must be an object`);
      return;
    }
    checkUnknownKeys(agent, AGENT_KEYS, where, errors);

    if (typeof agent.slug !== "string" || !SLUG_RE.test(agent.slug)) {
      errors.push(`${where}.slug: required, must match ${SLUG_RE}`);
    } else if (RESERVED_SLUGS.has(agent.slug)) {
      errors.push(`${where}.slug: "${agent.slug}" is reserved for the generated /<prefix>-${agent.slug} ritual command — choose another slug`);
    } else if (seenSlugs.has(agent.slug)) {
      errors.push(`${where}.slug: duplicate slug "${agent.slug}"`);
    } else {
      seenSlugs.add(agent.slug);
    }

    for (const field of ["title", "purpose"]) {
      if (typeof agent[field] !== "string" || agent[field].trim().length === 0) {
        errors.push(`${where}.${field}: required non-empty string`);
      }
    }
    for (const field of ["mission", "best_for", "tip", "outputs"]) {
      if (agent[field] !== undefined && typeof agent[field] !== "string") {
        errors.push(`${where}.${field}: must be a string`);
      }
    }

    if (agent.role !== undefined && !["worker", "review"].includes(agent.role)) {
      errors.push(`${where}.role: must be "worker" or "review"`);
    }
    if (agent.role === "review") reviewSlugs.push(agent.slug);

    if (agent.slot !== undefined && !SLOTS.includes(agent.slot)) {
      errors.push(`${where}.slot: unknown slot "${agent.slot}" (allowed: ${SLOTS.join(", ")})`);
    }
    if (agent.autonomy_level !== undefined && !AUTONOMY_LEVELS.includes(agent.autonomy_level)) {
      errors.push(`${where}.autonomy_level: unknown level "${agent.autonomy_level}" (allowed: ${AUTONOMY_LEVELS.join(", ")})`);
    }
    if (agent.role === "review" && agent.autonomy_level !== undefined && agent.autonomy_level !== "advisory") {
      errors.push(`${where}: the review agent must stay "advisory" — that is the decision-seat guarantee`);
    }

    checkStringArray(agent.brain, `${where}.brain`, BRAIN_FILE_RE, "a brain file name (*.md, no paths)", errors);
    for (const f of agent.brain || []) brainRefs.add(f);

    if (agent.tools !== undefined) {
      if (!isPlainObject(agent.tools)) {
        errors.push(`${where}.tools: must be an object`);
      } else {
        checkUnknownKeys(agent.tools, TOOLS_KEYS, `${where}.tools`, errors);
        checkStringArray(agent.tools.claude, `${where}.tools.claude`, null, "", errors);
        checkStringArray(agent.tools.mcp, `${where}.tools.mcp`, MCP_TOOL_RE, "mcp__<server>__<tool>", errors);
      }
    }

    const effectiveAutonomy = resolveAutonomy(manifest, agent);
    if (effectiveAutonomy === "advisory" && Array.isArray(agent.tools?.claude)) {
      const offending = agent.tools.claude.filter((t) => WRITE_CAPABLE_TOOLS.includes(t));
      if (offending.length > 0) {
        errors.push(`${where}.tools.claude: advisory agents are read-only — remove ${offending.join(", ")}`);
      }
    }
    // The decision-seat guarantee must hold for MCP tools too. An MCP tool's
    // write-capability is not knowable from its mcp__server__tool name, so an
    // advisory (or forced-advisory review) agent may carry an outward/write
    // MCP tool (e.g. mcp__slack__send_message) that silently breaks "never
    // acts". Since read-only-ness cannot be verified, advisory agents may not
    // declare MCP tools at all — that is the only enforceable guarantee.
    if (effectiveAutonomy === "advisory" && Array.isArray(agent.tools?.mcp) && agent.tools.mcp.length > 0) {
      errors.push(`${where}.tools.mcp: advisory agents are read-only — MCP write-capability cannot be verified, so MCP tools are not allowed on advisory/review agents (remove ${agent.tools.mcp.join(", ")})`);
    }

    if (agent.platform !== undefined) {
      if (!isPlainObject(agent.platform)) {
        errors.push(`${where}.platform: must be an object`);
      } else {
        checkUnknownKeys(agent.platform, PLATFORM_KEYS, `${where}.platform`, errors);
        for (const strField of ["default_model", "context_profile", "safety_level"]) {
          if (agent.platform[strField] !== undefined && typeof agent.platform[strField] !== "string") {
            errors.push(`${where}.platform.${strField}: must be a string`);
          }
        }
        // Schema (schemas/company-os-fleet.schema.json) requires these to be
        // string arrays; validate here too so the CLI validator does not emit
        // a wrong-typed agent_spec draft that materialize_agent_runtime rejects.
        checkStringArray(agent.platform.rule_slugs, `${where}.platform.rule_slugs`, null, "", errors);
        checkStringArray(agent.platform.knowledge_items, `${where}.platform.knowledge_items`, null, "", errors);
        if (agent.platform.max_loops !== undefined &&
            (!Number.isInteger(agent.platform.max_loops) || agent.platform.max_loops < 1 || agent.platform.max_loops > 20)) {
          errors.push(`${where}.platform.max_loops: must be an integer 1–20`);
        }
      }
    }
  });

  if (reviewSlugs.length > 1) {
    errors.push(`manifest.agents: at most one review agent allowed (got: ${reviewSlugs.join(", ")})`);
  }
  if (reviewSlugs.length === 0) {
    warnings.push('manifest.agents: no agent with role "review" — the /…-ship gate will not be generated; the fleet has no ship-quality check');
  }

  if (opts.brainDir) {
    for (const f of [...brainRefs].sort()) {
      if (!existsSync(path.join(opts.brainDir, f))) {
        errors.push(`brain: referenced file missing on disk: ${BRAIN_DIR}/${f}`);
      }
    }
  }

  return { errors, warnings };
}

/**
 * Scan brain files for credential-looking content. Returns warning strings.
 * @param {string} brainDirAbs
 */
export function scanBrainForSecrets(brainDirAbs) {
  const warnings = [];
  if (!existsSync(brainDirAbs)) return warnings;
  for (const entry of readdirSync(brainDirAbs)) {
    if (!entry.endsWith(".md")) continue;
    const content = readFileSync(path.join(brainDirAbs, entry), "utf-8");
    for (const { re, label } of SECRET_PATTERNS) {
      if (re.test(content)) {
        warnings.push(`${BRAIN_DIR}/${entry}: looks like it contains a ${label} — secrets belong in env/secret managers, never in brain files`);
      }
    }
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// Resolution — defaults, slots, autonomy, tools
// ---------------------------------------------------------------------------

function collectDefaultBrain(manifest) {
  return Array.isArray(manifest.defaults?.brain) ? manifest.defaults.brain : [];
}

function resolveAutonomy(manifest, agent) {
  if (agent.role === "review") return "advisory";
  return agent.autonomy_level ?? manifest.defaults?.autonomy_level ?? DEFAULT_AUTONOMY;
}

/**
 * Resolve one agent against fleet defaults into the fully-expanded shape the
 * generators consume.
 */
export function resolveAgent(manifest, agent) {
  const prefix = manifest.prefix ?? DEFAULT_PREFIX;
  const slot = agent.slot ?? manifest.defaults?.slot ?? DEFAULT_SLOT;
  const autonomy = resolveAutonomy(manifest, agent);
  const slotModels = { ...DEFAULT_SLOT_MODELS, ...(manifest.slot_models ?? {}) };
  const claudeTools = agent.tools?.claude ?? [...AUTONOMY_TOOLS[autonomy]];
  const mcpTools = agent.tools?.mcp ?? [];
  const brain = [...new Set([...collectDefaultBrain(manifest), ...(agent.brain ?? [])])];

  return {
    slug: agent.slug,
    name: `${prefix}-${agent.slug}`,
    title: agent.title,
    purpose: agent.purpose,
    mission: agent.mission ?? "",
    bestFor: agent.best_for ?? "",
    tip: agent.tip ?? "",
    role: agent.role ?? "worker",
    slot,
    model: slotModels[slot],
    autonomy,
    brain,
    outputs: agent.outputs ?? "",
    tools: [...claudeTools, ...mcpTools],
    platform: agent.platform ?? {},
  };
}

/**
 * Deterministic JSON serialization with recursively sorted object keys.
 * JSON.stringify is key-insertion-order sensitive, so a semantically-null
 * reformat of fleet.json (a formatter or a merge that reorders keys) would
 * otherwise change the fingerprint and drift every artifact. Canonicalizing
 * makes the fingerprint depend only on the manifest's data, matching the rest
 * of the generator (resolveAgent reads named fields, so output is order-invariant).
 */
function canonicalJSON(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJSON(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Stable fingerprint of the manifest for header traceability (no timestamps). */
export function fleetFingerprint(manifest) {
  return createHash("sha256").update(canonicalJSON(manifest)).digest("hex").slice(0, 12);
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/** YAML plain scalars must not contain ": " — swap for an em-dash pause. */
function yamlSafe(text) {
  return text.replace(/: /g, " — ").replace(/\n/g, " ").trim();
}

function genHeader(fingerprint) {
  return [
    `> ${AUTO_GEN_MARKER}`,
    `> Source: ${FLEET_FILE} (AISHA Company OS) — regenerate via \`npm run gen:company-os\`. Do not edit manually.`,
    `> Fleet fingerprint: \`${fingerprint}\``,
  ].join("\n");
}

const DEFAULT_USER_SECTION_INNER =
  "\n<!--\n  Anything between these markers is preserved across regenerations.\n  Add agent-specific notes or constraints here.\n-->\n";

function withUserSection(content) {
  return injectUserSection(content, DEFAULT_USER_SECTION_INNER);
}

const AUTONOMY_RULES = {
  advisory: [
    "You are **read-only**: never Write, Edit, or run Bash. You return observations, options, and recommendations — the human (or a worker agent) acts on them.",
    "Never patch or produce ready-to-paste replacements for business artifacts; name the issue and the direction instead.",
  ],
  draft: [
    "You may **draft**: write and edit draft artifacts and `company-os/` proposals. You never publish, send, deploy, push, or otherwise act outward.",
    "Every outward-facing artifact you produce is a *candidate* — hand it to the human with the ship gate, never treat it as sent.",
  ],
  execute: [
    "You may **act** with your tools, including Bash, for inward operations (files, repo, local automation).",
    "Anything that leaves the company (publish, send, deploy, purchase) still requires the ship gate and an explicit human go — no exceptions.",
  ],
};

function agentMarkdown(resolved, manifest, fingerprint) {
  const prefix = manifest.prefix ?? DEFAULT_PREFIX;
  const descriptionParts = [
    resolved.purpose,
    resolved.bestFor ? `Best for — ${resolved.bestFor}` : "",
    resolved.mission ? `Mission — ${resolved.mission}.` : "",
    `Trigger words "${resolved.slug}", "${resolved.title}".`,
  ].filter(Boolean);
  const description = yamlSafe(descriptionParts.join(" "));

  const brainList = resolved.brain
    .map((f, i) => `${i + 1}. \`${BRAIN_DIR}/${f}\``)
    .join("\n");

  const rules = AUTONOMY_RULES[resolved.autonomy]
    .map((r) => `- ${r}`)
    .join("\n");

  const reviewSection = resolved.role === "review"
    ? [
        "",
        "## Review doctrine",
        "",
        "You are the ship-quality gate — the last check before anything leaves the",
        "company. Run the full checklist from `company-os/brain/review-prompt.md`",
        "(the \"anyone test\") and return the verdict in its format: `SHIP` or",
        "`FIX FIRST` with numbered issues. You never fix the artifact yourself.",
        "The human makes the final call — always.",
      ].join("\n")
    : "";

  const shipNote = resolved.role === "review"
    ? ""
    : `\n## Ship gate\n\nAnything outward-facing (posts, emails, offers, pricing, publications) goes\nthrough \`/${prefix}-ship\` (review agent) before the human ships it. Say so in\nyour report when an artifact is ship-gate-ready.\n`;

  return `---
name: ${resolved.name}
description: ${description}
tools: ${resolved.tools.join(", ")}
model: ${resolved.model}
---

${genHeader(fingerprint)}

# ${resolved.title} — AISHA Company OS

${resolved.mission ? `**Mission:** ${resolved.mission} — ` : ""}${resolved.purpose}

## Business brain — read before any work

Read these files first, in this order. They are the single source of truth for
voice, offers, and context:

${brainList}

Never invent business facts that are not in the brain. When a fact you need is
missing, say exactly which brain file should carry it and continue with what is
known.

## Operating rules (autonomy: ${resolved.autonomy})

- **The human decides. You execute.** Your output is input for a human decision,
  not an action taken on their behalf.
${rules}
- No secrets in brain files or outputs — credentials belong in env/secret
  managers (repo security rules apply).
${resolved.tip ? `\n## Playbook tip\n\n${resolved.tip}\n` : ""}
## Output contract

${resolved.outputs || "Return a concise, decision-ready result for the human."}

End every report with:
1. **Decision points** — what the human must decide now.
2. **Brain gaps** — facts you were missing, and which brain file should hold them.
${shipNote}${reviewSection}
`;
}

function commandMarkdown(resolved, manifest, fingerprint) {
  const prefix = manifest.prefix ?? DEFAULT_PREFIX;
  return `# ${resolved.title} — delegate to the \`${resolved.name}\` agent

${genHeader(fingerprint)}

${resolved.purpose}${resolved.mission ? ` (${resolved.mission})` : ""}

## Arguments: $ARGUMENTS

## Instructions

1. Treat \`$ARGUMENTS\` as the task for the **${resolved.title}**. If empty, ask
   the user what they need from this agent (best for: ${resolved.bestFor || resolved.purpose}).
2. Spawn the \`${resolved.name}\` subagent via the Agent tool with the task
   verbatim, plus any conversation context the agent needs.
3. The subagent reads its brain files itself (${resolved.brain.map((f) => `\`${f}\``).join(", ")});
   do not paste brain content into the prompt.
4. Relay the agent's result to the user **unchanged in substance**, keeping its
   two closing sections: *Decision points* and *Brain gaps*.
5. If the result is an outward-facing artifact, remind the user it must pass
   \`/${prefix}-ship\` before shipping.${resolved.role === "review" ? "\n6. This is the review agent — never let it (or yourself) modify the reviewed artifact; verdicts only." : ""}
`;
}

function shipCommandMarkdown(reviewResolved, manifest, fingerprint) {
  const prefix = manifest.prefix ?? DEFAULT_PREFIX;
  return `# Ship gate — the "anyone test" before anything leaves the company

${genHeader(fingerprint)}

Run the fleet's review agent (\`${reviewResolved.name}\`) on an artifact before
the human ships it. **The human decides. The agents execute.**

## Arguments: $ARGUMENTS

## Instructions

1. Resolve the artifact from \`$ARGUMENTS\`: a file path, a pasted draft, or —
   when empty — the most recent outward-facing artifact produced in this
   conversation. If nothing is identifiable, ask.
2. Spawn the \`${reviewResolved.name}\` subagent with the artifact and its
   destination channel/context.
3. Report the verdict verbatim: \`SHIP\` or \`FIX FIRST\` + numbered issues.
4. On \`FIX FIRST\`: offer to route the issues back to the producing agent
   (e.g. \`/${prefix}-content\`) — never silently fix and re-ship in one step.
5. On \`SHIP\`: hand back to the human for the actual send/publish. Never
   perform the outward action yourself.
`;
}

function weeklyCommandMarkdown(manifest, resolvedAgents, fingerprint) {
  const prefix = manifest.prefix ?? DEFAULT_PREFIX;
  const fleetLines = resolvedAgents
    .map((a) => `   - \`${a.name}\` — ${a.mission || a.purpose}`)
    .join("\n");
  return `# Weekly brief — plan the week with the fleet

${genHeader(fingerprint)}

The \`/${prefix}-weekly\` ritual keeps \`${BRAIN_DIR}/weekly-brief.md\` the live
source of this week's goals. The agents propose; the human confirms.

## Arguments: $ARGUMENTS

## Instructions

1. Read \`${BRAIN_DIR}/weekly-brief.md\` (current goals) and
   \`${BRAIN_DIR}/wins-log.md\` (what landed).
2. Summarize for the user: last week's goals vs. actual wins, carry-overs,
   and anything in \`$ARGUMENTS\` (new priorities, constraints).
3. Propose this week's **top 3 goals** and a per-agent focus table across the
   fleet:
${fleetLines}
4. Iterate with the user until confirmed. Only then update
   \`${BRAIN_DIR}/weekly-brief.md\` (move finished wins into
   \`${BRAIN_DIR}/wins-log.md\` with dates).
5. Close by suggesting the first delegation of the week (e.g.
   \`/${prefix}-leads\`, \`/${prefix}-content\`) based on goal #1.
`;
}

function agentMapMarkdown(manifest, resolvedAgents, fingerprint) {
  const prefix = manifest.prefix ?? DEFAULT_PREFIX;
  const rows = resolvedAgents
    .map((a, i) => {
      const n = String(i + 1).padStart(2, "0");
      return `| ${n} | \`/${a.name}\` | ${a.title} | ${a.mission || "—"} | ${a.slot} → ${a.model} | ${a.autonomy} | ${a.brain.map((f) => `\`${f}\``).join("<br>")} |`;
    })
    .join("\n");

  const owner = manifest.owner?.name ? `**${manifest.owner.name}**` : "the operator";

  return `# Agent map — ${manifest.preset ?? "custom"} fleet

${genHeader(fingerprint)}

One human in the decision seat: ${owner}. The fleet executes. Memory lives in
\`${BRAIN_DIR}/\` — versioned files, not chat history.

| # | Command | Agent | Mission | Slot → model | Autonomy | Brain |
|---|---------|-------|---------|--------------|----------|-------|
${rows}

## Rituals

- \`/${prefix}-weekly\` — plan the week; updates \`weekly-brief.md\` after human confirm.
- \`/${prefix}-ship\` — the "anyone test" review gate. Nothing outward ships without it.

## Doctrine

A one-person company is not one person doing everything. It is one person
directing agents that never forget — and every outward action stays a human
decision.
`;
}

/**
 * Generate the full artifact set for a validated manifest.
 *
 * @param {object} manifest
 * @returns {{ files: Array<{path: string, content: string}> }}  Multi-file
 *   output matching scripts/ide-adapters/multi-file.mjs conventions.
 */
export function generateFleet(manifest) {
  const prefix = manifest.prefix ?? DEFAULT_PREFIX;
  const fingerprint = fleetFingerprint(manifest);
  const resolvedAgents = manifest.agents.map((a) => resolveAgent(manifest, a));
  const files = [];

  for (const resolved of resolvedAgents) {
    files.push({
      path: `.claude/agents/${resolved.name}.md`,
      content: withUserSection(agentMarkdown(resolved, manifest, fingerprint)),
    });
    files.push({
      path: `.claude/commands/${resolved.name}.md`,
      content: withUserSection(commandMarkdown(resolved, manifest, fingerprint)),
    });
  }

  const review = resolvedAgents.find((a) => a.role === "review");
  if (review) {
    files.push({
      path: `.claude/commands/${prefix}-ship.md`,
      content: withUserSection(shipCommandMarkdown(review, manifest, fingerprint)),
    });
  }
  files.push({
    path: `.claude/commands/${prefix}-weekly.md`,
    content: withUserSection(weeklyCommandMarkdown(manifest, resolvedAgents, fingerprint)),
  });
  files.push({
    path: AGENT_MAP_FILE,
    content: withUserSection(agentMapMarkdown(manifest, resolvedAgents, fingerprint)),
  });

  // Defense-in-depth against the reserved-slug class: two files[] entries at
  // the same path would silently overwrite on write and permanently red the
  // drift check. validateManifest rejects the known ritual collisions (ship/
  // weekly), but fail loud here for any future ritual or unvalidated caller.
  const seenPaths = new Set();
  for (const f of files) {
    if (seenPaths.has(f.path)) {
      throw new Error(`generateFleet: duplicate output path "${f.path}" — an agent slug collides with a generated ritual command. Rename the agent slug (ship/weekly are reserved).`);
    }
    seenPaths.add(f.path);
  }

  return { files };
}

/**
 * What safeWriteSync would leave on disk for `generated` given the current
 * disk content: an existing non-empty user-section survives regeneration.
 * Used by `check` mode for a faithful drift comparison.
 */
export function expectedOnDisk(generated, existing) {
  if (existing !== null && existing !== undefined) {
    const inner = extractUserSection(existing);
    if (inner !== null && inner.trim().length > 0) {
      return injectUserSection(generated, inner);
    }
  }
  return generated;
}

/**
 * Detect stale artifacts: files in .claude/{agents,commands} that carry this
 * layer's provenance line but are no longer part of the generated set
 * (agent removed/renamed in the manifest). Reported, never auto-deleted.
 *
 * @param {string} rootDir
 * @param {Set<string>} generatedPaths  Relative paths of the fresh generation.
 * @returns {string[]}  Relative paths of stale files.
 */
export function findStaleArtifacts(rootDir, generatedPaths) {
  const stale = [];
  for (const dir of [".claude/agents", ".claude/commands"]) {
    const absDir = path.join(rootDir, dir);
    if (!existsSync(absDir)) continue;
    for (const entry of readdirSync(absDir)) {
      if (!entry.endsWith(".md")) continue;
      const rel = `${dir}/${entry}`;
      if (generatedPaths.has(rel)) continue;
      const content = readFileSync(path.join(absDir, entry), "utf-8");
      if (content.includes("(AISHA Company OS) — regenerate via")) {
        stale.push(rel);
      }
    }
  }
  return stale;
}

// ---------------------------------------------------------------------------
// Marketplace bridge — plugin_catalog.agent_spec draft
// ---------------------------------------------------------------------------

/**
 * Map a fleet agent to a plugin_catalog.agent_spec draft, the declarative
 * shape consumed by publish_agent → materialize_agent_runtime /
 * install_agent_as_story. Field names/defaults mirror
 * aisha/db/sql/functions/materialize_agent_runtime.sql.
 *
 * @param {object} manifest
 * @param {string} slug
 * @returns {object} agent_spec draft
 */
export function emitAgentSpec(manifest, slug) {
  const agent = manifest.agents.find((a) => a.slug === slug);
  if (!agent) {
    throw new Error(`No agent with slug "${slug}" in ${FLEET_FILE}`);
  }
  const resolved = resolveAgent(manifest, agent);
  const platform = resolved.platform;

  return {
    purpose: resolved.purpose,
    default_model: platform.default_model ?? "balanced",
    model_overrides: { company_os_slot: resolved.slot },
    allowed_tools: resolved.tools,
    denied_tools: [],
    context_profile: platform.context_profile ?? "repo_plus_rules",
    max_loops: platform.max_loops ?? 3,
    safety_level: platform.safety_level ?? "standard",
    // Local levels are stricter than runtime ones: only `execute` maps to
    // autonomous operation; advisory/draft stay semi (human-in-the-loop).
    autonomy_level: resolved.autonomy === "execute" ? "auto" : "semi",
    rule_slugs: platform.rule_slugs ?? [],
    knowledge_items: platform.knowledge_items ?? [],
  };
}

export { USER_SECTION_OPEN, USER_SECTION_CLOSE };
