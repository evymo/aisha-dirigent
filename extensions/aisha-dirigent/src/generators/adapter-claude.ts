/**
 * Generates CLAUDE.md — condensed instructions optimized for Claude Code.
 * Ported from scripts/ide-adapters/adapter-claude.mjs.
 * @module
 */

import {
  autoGenHeader,
  CORE_LAWS_SLUG,
  DEFAULT_PROJECT_TITLE,
  categoryLabel,
  findRuleBySlug,
  getRuleContent,
  getRulesForCategory,
  groupByCategory,
  metadataFooter,
  sortCategories,
} from "./registry";

import type { IdeAdapter, InstructionPayload, ExpertRule } from "./registry";

const meta = {
  id: "claude",
  outputPath: "CLAUDE.md",
  description: "CLAUDE.md for Claude Code / Anthropic agents",
} as const;

const CLAUDE_PRIORITY = [
  "ai_prompt_engineering",
  "coding_standard",
  "architecture_pattern",
  "api_design",
  "security_practice",
  "testing_strategy",
  "devops_pipeline",
];

function renderCompactSection(rules: ExpertRule[], category: string, title: string): string {
  const catRules = getRulesForCategory(rules, category);
  if (catRules.length === 0) return "";

  const lines = [`## ${title}\n`];
  for (const rule of catRules) {
    const content = getRuleContent(rule);
    if (content) {
      lines.push(`### ${rule.title}\n`);
      lines.push(content);
      lines.push("");
    }
  }
  return lines.join("\n");
}

function generate(payload: InstructionPayload): string {
  const storyTitle = payload.story?.title || DEFAULT_PROJECT_TITLE;
  const fingerprint = payload.ruleset?.fingerprint || null;
  const rules = payload.rules || [];

  let md = "";

  md += autoGenHeader(
    `CLAUDE.md — ${storyTitle}`,
    fingerprint,
    payload.generated_at,
  );

  if (payload.story?.tech_stack && payload.story.tech_stack.length > 0) {
    md += `> Stack: ${payload.story.tech_stack.join(" | ")}\n\n`;
  }

  md += "---\n\n";

  const lawRule = findRuleBySlug(rules, CORE_LAWS_SLUG);
  if (lawRule) {
    md += "## Absolutní pravidla\n\n";
    md += getRuleContent(lawRule) + "\n\n";
    md += "---\n\n";
  }

  const grouped = groupByCategory(rules);
  const allCategories = [...grouped.keys()];
  const prioritySet = new Set(CLAUDE_PRIORITY);
  const remaining = allCategories.filter((c) => !prioritySet.has(c));
  const sortedRemaining = sortCategories(remaining);
  const orderedCategories = [
    ...CLAUDE_PRIORITY.filter((c) => grouped.has(c)),
    ...sortedRemaining,
  ];

  for (const category of orderedCategories) {
    const section = renderCompactSection(rules, category, categoryLabel(category));
    if (section) {
      md += section;
      md += "---\n\n";
    }
  }

  md += metadataFooter(payload, meta.id, meta.outputPath);

  return md;
}

export const adapterClaude: IdeAdapter = { meta, generate };
