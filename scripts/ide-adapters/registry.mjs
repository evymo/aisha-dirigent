#!/usr/bin/env node

/**
 * @module registry
 * IDE adapter registry and shared formatting utilities.
 *
 * Each adapter exports:
 *   generate(payload) → string   — the formatted file content
 *   meta = { id, outputPath, description }
 *
 * Rule-bearing adapters embed the shared runtime contract
 * (scripts/ide-adapters/runtime-contract-fragment.mjs). Full-file adapters also
 * embed the shared bring-up fragment (scripts/ide-adapters/bringup-fragment.mjs)
 * so generated IDE instruction files point users at the single
 * `npm run stack:bringup` entry-point when no AISHA backend is reachable.
 * Keep this registry the staleness anchor: re-save it whenever those adapters
 * change.
 */

import { porovnej } from "../lib/razeni.mjs";

// ---------------------------------------------------------------------------
// Adapter registry
// ---------------------------------------------------------------------------

export const ADAPTERS = {
  copilot: {
    module: "./adapter-copilot.mjs",
    outputPath: ".github/copilot-instructions.md",
    description: "GitHub Copilot instructions",
  },
  agents: {
    module: "./adapter-agents.mjs",
    outputPath: "AGENTS.md",
    description: "AGENTS.md for AI assistants (Codex, OpenAI agents)",
  },
  claude: {
    module: "./adapter-claude.mjs",
    outputPath: "CLAUDE.md",
    description: "CLAUDE.md for Claude Code / Anthropic agents",
  },
  cursorrules: {
    module: "./adapter-cursorrules.mjs",
    outputPath: ".cursorrules",
    description: "Cursor IDE rules",
  },
  windsurfrules: {
    module: "./adapter-windsurfrules.mjs",
    outputPath: ".windsurfrules",
    description: "Windsurf IDE rules",
  },
  antigravity: {
    module: "./adapter-antigravity.mjs",
    outputPath: ".antigravity/rules.md",
    description: "Google Antigravity IDE rules",
  },
  zedrules: {
    module: "./adapter-zedrules.mjs",
    outputPath: ".rules",
    description: "Zed Agent Panel project rules",
  },
  "aisha-agent": {
    module: "./adapter-aisha-agent.mjs",
    outputPath: ".github/agents/AISHA.agent.md",
    description: "VS Code Copilot Agent — AISHA Dirigent",
  },
  "codex-skill": {
    module: "./adapter-codex-skill.mjs",
    outputPath: "codex/skills/aisha-dirigent-autopilot/SKILL.md",
    description: "OpenAI Codex SKILL.md — AISHA Dirigent Autopilot",
  },
  "claude-overlay": {
    module: "./adapter-claude-overlay.mjs",
    outputPath: "<multi>",
    description: "Claude Code supervision overlay (hooks + agent + skill + commands + statusline + settings merge)",
    multiFile: true,
  },
  "claude-app": {
    module: "./adapter-claude-app.mjs",
    outputPath: "<multi>",
    description: "Claude app package — Claude Code plugin + Claude Desktop Extension (MCPB) for AISHA Dirigent",
    multiFile: true,
  },
};

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const AUTO_GEN_MARKER = "Auto-generated from AISHA Expert Overlay ruleset.";

/** Slug used to look up core development laws across adapters. */
export const CORE_LAWS_SLUG = "aisha-development-laws";

/** Default project title when no story is loaded. */
export const DEFAULT_PROJECT_TITLE = "AI Platform";

/** Fetch timeout for Supabase RPC calls (ms). */
export const FETCH_TIMEOUT_MS = 15_000;

/**
 * Canonical category ordering used by multi-section adapters.
 * New categories not listed here appear at the end in alphabetic order.
 */
export const CATEGORY_ORDER = [
  "domain_knowledge",
  "architecture_pattern",
  "api_design",
  "coding_standard",
  "data_modeling",
  "security_practice",
  "testing_strategy",
  "devops_pipeline",
  "performance_optimization",
  "integration_pattern",
  "ai_prompt_engineering",
  "project_management",
  "documentation_standard",
];

/**
 * Staleness tolerance for adapter mtime comparison (ms).
 * Allows 60s between registry and adapter writes during batch generation.
 */
export const STALENESS_TOLERANCE_MS = 60_000;

/**
 * PR Checklist items — comprehensive list used by AGENTS.md adapter.
 * Copilot adapter uses the compact subset (items with `compact: true`).
 */
export const PR_CHECKLIST = [
  { text: "All expert rules followed", compact: true },
  { text: "`npm run test:run` — all tests passing", compact: true },
  { text: "`npm run build` — successful", compact: true },
  { text: "`npm run lint` — no errors", compact: true },
  { text: "`npm run test:gates` — gate tests passing", compact: false },
  { text: "`npm run i18n:check` — translation parity", compact: false },
  { text: "No hardcoded text in JSX (use i18n)", compact: true },
  { text: "No `any` types", compact: true },
  { text: "No `console.log` in production code", compact: true },
  { text: 'No `.select("*")` or direct `.from()` for sensitive data', compact: false },
  { text: "RLS on new tables + policies", compact: false },
  { text: "Audit journal for sensitive operations", compact: false },
];

/**
 * Render PR checklist as markdown.
 * @param {"compact"|"full"} level
 */
export function renderPrChecklist(level = "full") {
  const items = level === "compact"
    ? PR_CHECKLIST.filter((i) => i.compact)
    : PR_CHECKLIST;
  return items.map((i) => `- [ ] ${i.text}`).join("\n") + "\n";
}

/**
 * Standard auto-generated header for all IDE instruction files.
 */
export function autoGenHeader(title, fingerprint, generatedAt) {
  const lines = [`# ${title}`, ""];
  lines.push(`> ${AUTO_GEN_MARKER}`);
  lines.push("> **Do not edit manually** — regenerate via `npm run gen:ide`.");
  if (fingerprint) {
    lines.push(`> Fingerprint: \`${fingerprint}\``);
  }
  if (generatedAt) {
    lines.push(`> Generated: ${generatedAt}`);
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * Return the auto-gen marker string for gate test verification.
 */
export function getAutoGenMarker() {
  return AUTO_GEN_MARKER;
}

/**
 * Group rules by category from payload.
 * Returns Map<category, rule[]>.
 */
export function groupByCategory(rules) {
  const map = new Map();
  for (const rule of rules) {
    const cat = rule.category || "other";
    if (!map.has(cat)) {
      map.set(cat, []);
    }
    map.get(cat).push(rule);
  }
  return map;
}

/**
 * Get rules for a specific category.
 */
export function getRulesForCategory(rules, category) {
  return rules.filter((r) => r.category === category);
}

/**
 * Get content for a rule: prefer ai_instructions, fallback to summary.
 */
export function getRuleContent(rule) {
  if (rule.ai_instructions && rule.ai_instructions.trim()) {
    return rule.ai_instructions.trim();
  }
  if (rule.summary && rule.summary.trim()) {
    return rule.summary.trim();
  }
  return "";
}

/**
 * Convert snake_case category to Title Case label.
 */
export function categoryLabel(category) {
  return category
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Sort categories: CATEGORY_ORDER first, then alphabetic remainder.
 */
export function sortCategories(categoryKeys) {
  const orderMap = new Map(CATEGORY_ORDER.map((c, i) => [c, i]));
  return [...categoryKeys].sort((a, b) => {
    const ia = orderMap.has(a) ? orderMap.get(a) : CATEGORY_ORDER.length;
    const ib = orderMap.has(b) ? orderMap.get(b) : CATEGORY_ORDER.length;
    if (ia !== ib) return ia - ib;
    return porovnej(a, b);
  });
}

/**
 * Find a rule by slug. Falls back to title search.
 */
export function findRuleBySlug(rules, slug) {
  return rules.find(
    (r) => r.slug === slug || r.title?.toLowerCase().includes(slug.replace(/-/g, " ")),
  );
}

/**
 * Build project metadata section from payload.
 */
export function projectMetadata(payload) {
  const story = payload.story;
  if (!story || story === null) {
    return "";
  }
  const lines = [];
  if (story.tech_stack && story.tech_stack.length > 0) {
    lines.push(`**Tech Stack:** ${story.tech_stack.join(", ")}`);
  }
  if (story.domain && story.domain.length > 0) {
    lines.push(`**Domain:** ${story.domain.join(", ")}`);
  }
  if (story.risk_profile) {
    lines.push(`**Risk Profile:** ${story.risk_profile}`);
  }
  if (payload.ruleset && payload.ruleset !== null) {
    if (payload.ruleset.fingerprint) {
      lines.push(`**Ruleset Fingerprint:** \`${payload.ruleset.fingerprint}\``);
    }
    if (payload.ruleset.context_profile) {
      lines.push(`**Context Profile:** ${payload.ruleset.context_profile}`);
    }
  }
  return lines.join("\n") + "\n";
}

/**
 * Render all rules grouped by category with ### / #### headers.
 */
export function renderRulesByCategory(rules) {
  const grouped = groupByCategory(rules);
  const sections = [];

  for (const [category, catRules] of grouped) {
    const label = categoryLabel(category);
    const ruleBlocks = [];

    for (const rule of catRules) {
      const content = getRuleContent(rule);
      if (content) {
        ruleBlocks.push(`#### ${rule.title}\n\n${content}`);
      }
    }

    if (ruleBlocks.length > 0) {
      sections.push(`### ${label}\n\n${ruleBlocks.join("\n\n")}`);
    }
  }

  return sections.join("\n\n");
}

/**
 * Build a JSON metadata footer for the file.
 */
export function metadataFooter(payload, adapterId, outputPath) {
  const meta = {
    story_id: payload.story?.id || null,
    output_path: outputPath,
    length_chars: null, // filled by CLI after generation
    adapter: adapterId,
    payload_version: payload.payload_version || 1,
    fingerprint: payload.ruleset?.fingerprint || null,
    generated_at: payload.generated_at || new Date().toISOString(),
  };
  return "\n<!-- gen:metadata " + JSON.stringify(meta) + " -->\n";
}
