/**
 * IDE adapter registry and shared formatting utilities.
 *
 * Each adapter exports:
 *   generate(payload) → string   — the formatted file content
 *   meta = { id, outputPath, description }
 *
 * Ported from scripts/ide-adapters/registry.mjs for self-contained extension bundling.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single expert rule from the instruction payload. */
export interface ExpertRule {
  id?: string;
  slug?: string;
  title?: string;
  category?: string;
  ai_instructions?: string;
  summary?: string;
}

/** Story metadata within the payload. */
export interface StoryMeta {
  id?: string;
  title?: string;
  tech_stack?: string[];
  domain?: string[];
  risk_profile?: string;
}

/** Ruleset metadata within the payload. */
export interface RulesetMeta {
  fingerprint?: string;
  context_profile?: string;
}

/** The instruction payload shape (matches the AISHA backend RPC get_instruction_payload). */
export interface InstructionPayload {
  story?: StoryMeta | null;
  rules?: ExpertRule[];
  ruleset?: RulesetMeta | null;
  scope?: string;
  payload_version?: number;
  generated_at?: string;
}

import type { MultiFileOutput } from "./multi-file";

/** Adapter metadata. */
export interface AdapterMeta {
  id: string;
  /** Single-file output path; for multi-file adapters this is a placeholder
   *  like "<multi>" because the adapter declares its own paths. */
  outputPath: string;
  description: string;
  /** If true, `generate()` returns a {@link MultiFileOutput}; the orchestrator
   *  iterates `files[]` instead of writing one file from a string. */
  multiFile?: boolean;
}

/** Adapter output: single string (one file at `meta.outputPath`) or
 *  {@link MultiFileOutput} (multiple files with per-file paths/modes/merge). */
export type AdapterOutput = string | MultiFileOutput;

/** Adapter interface. */
export interface IdeAdapter {
  meta: AdapterMeta;
  generate: (payload: InstructionPayload) => AdapterOutput | Promise<AdapterOutput>;
}

// ---------------------------------------------------------------------------
// Adapter registry
// ---------------------------------------------------------------------------

export const ADAPTER_REGISTRY: Record<string, { outputPath: string; description: string }> = {
  copilot: {
    outputPath: ".github/copilot-instructions.md",
    description: "GitHub Copilot instructions",
  },
  agents: {
    outputPath: "AGENTS.md",
    description: "AGENTS.md for AI assistants (Codex, OpenAI agents)",
  },
  claude: {
    outputPath: "CLAUDE.md",
    description: "CLAUDE.md for Claude Code / Anthropic agents",
  },
  cursorrules: {
    outputPath: ".cursorrules",
    description: "Cursor IDE rules",
  },
  windsurfrules: {
    outputPath: ".windsurfrules",
    description: "Windsurf IDE rules",
  },
  zedrules: {
    outputPath: ".rules",
    description: "Zed Agent Panel project rules",
  },
  "aisha-agent": {
    outputPath: ".github/agents/AISHA.agent.md",
    description: "VS Code Copilot Agent — AISHA Dirigent",
  },
  "codex-skill": {
    outputPath: "codex/skills/aisha-dirigent-autopilot/SKILL.md",
    description: "OpenAI Codex SKILL.md — AISHA Dirigent Autopilot",
  },
};

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const AUTO_GEN_MARKER = "Auto-generated from AISHA Expert Overlay ruleset.";

export const CORE_LAWS_SLUG = "aisha-development-laws";
export const DEFAULT_PROJECT_TITLE = "AI Platform";

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

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function renderPrChecklist(level: "compact" | "full" = "full"): string {
  const items = level === "compact"
    ? PR_CHECKLIST.filter((i) => i.compact)
    : PR_CHECKLIST;
  return items.map((i) => `- [ ] ${i.text}`).join("\n") + "\n";
}

export function autoGenHeader(title: string, fingerprint: string | null, generatedAt: string | undefined): string {
  const lines = [`# ${title}`, ""];
  lines.push(`> ${AUTO_GEN_MARKER}`);
  lines.push("> **Do not edit manually** — regenerate via AISHA Dirigent or `npm run gen:ide`.");
  if (fingerprint) {
    lines.push(`> Fingerprint: \`${fingerprint}\``);
  }
  if (generatedAt) {
    lines.push(`> Generated: ${generatedAt}`);
  }
  lines.push("");
  return lines.join("\n");
}

export function getAutoGenMarker(): string {
  return AUTO_GEN_MARKER;
}

export function groupByCategory(rules: ExpertRule[]): Map<string, ExpertRule[]> {
  const map = new Map<string, ExpertRule[]>();
  for (const rule of rules) {
    const cat = rule.category || "other";
    if (!map.has(cat)) {
      map.set(cat, []);
    }
    map.get(cat)!.push(rule);
  }
  return map;
}

export function getRulesForCategory(rules: ExpertRule[], category: string): ExpertRule[] {
  return rules.filter((r) => r.category === category);
}

export function getRuleContent(rule: ExpertRule): string {
  if (rule.ai_instructions && rule.ai_instructions.trim()) {
    return rule.ai_instructions.trim();
  }
  if (rule.summary && rule.summary.trim()) {
    return rule.summary.trim();
  }
  return "";
}

export function categoryLabel(category: string): string {
  return category
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function sortCategories(categoryKeys: string[]): string[] {
  const orderMap = new Map(CATEGORY_ORDER.map((c, i) => [c, i]));
  return [...categoryKeys].sort((a, b) => {
    const ia = orderMap.has(a) ? orderMap.get(a)! : CATEGORY_ORDER.length;
    const ib = orderMap.has(b) ? orderMap.get(b)! : CATEGORY_ORDER.length;
    if (ia !== ib) return ia - ib;
    return a.localeCompare(b);
  });
}

export function findRuleBySlug(rules: ExpertRule[], slug: string): ExpertRule | undefined {
  return rules.find(
    (r) => r.slug === slug || r.title?.toLowerCase().includes(slug.replace(/-/g, " ")),
  );
}

export function projectMetadata(payload: InstructionPayload): string {
  const story = payload.story;
  if (!story) {
    return "";
  }
  const lines: string[] = [];
  if (story.tech_stack && story.tech_stack.length > 0) {
    lines.push(`**Tech Stack:** ${story.tech_stack.join(", ")}`);
  }
  if (story.domain && story.domain.length > 0) {
    lines.push(`**Domain:** ${story.domain.join(", ")}`);
  }
  if (story.risk_profile) {
    lines.push(`**Risk Profile:** ${story.risk_profile}`);
  }
  if (payload.ruleset) {
    if (payload.ruleset.fingerprint) {
      lines.push(`**Ruleset Fingerprint:** \`${payload.ruleset.fingerprint}\``);
    }
    if (payload.ruleset.context_profile) {
      lines.push(`**Context Profile:** ${payload.ruleset.context_profile}`);
    }
  }
  if (lines.length === 0) return "";
  return lines.join("\n") + "\n";
}

export function renderRulesByCategory(rules: ExpertRule[]): string {
  const grouped = groupByCategory(rules);
  const sections: string[] = [];

  for (const [category, catRules] of grouped) {
    const label = categoryLabel(category);
    const ruleBlocks: string[] = [];

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

export function metadataFooter(payload: InstructionPayload, adapterId: string, outputPath: string): string {
  const meta = {
    story_id: payload.story?.id || null,
    output_path: outputPath,
    length_chars: null as number | null,
    adapter: adapterId,
    payload_version: payload.payload_version || 1,
    fingerprint: payload.ruleset?.fingerprint || null,
    generated_at: payload.generated_at || new Date().toISOString(),
  };
  return "\n<!-- gen:metadata " + JSON.stringify(meta) + " -->\n";
}

/**
 * Strip volatile fields (timestamps, generated_at) for content comparison.
 * Used to avoid unnecessary file rewrites on identical content.
 */
export function stripVolatile(content: string): string {
  return content
    .replace(/^> Generated: .+$/gm, "")
    .replace(/<!-- gen:metadata .+ -->/g, "")
    .replace(/"generated_at":"[^"]*"/g, "")
    .trim();
}
