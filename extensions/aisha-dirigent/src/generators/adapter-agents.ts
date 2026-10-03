/**
 * Generates AGENTS.md — comprehensive instructions for AI assistants.
 * Ported from scripts/ide-adapters/adapter-agents.mjs.
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
  renderPrChecklist,
  sortCategories,
} from "./registry";

import type { IdeAdapter, InstructionPayload, ExpertRule } from "./registry";

const meta = {
  id: "agents",
  outputPath: "AGENTS.md",
  description: "AGENTS.md for AI assistants (Codex, OpenAI agents)",
} as const;

const SECTION_EMOJI: Record<string, string> = {
  domain_knowledge: "🏢",
  architecture_pattern: "🏗️",
  api_design: "🔌",
  coding_standard: "📝",
  data_modeling: "📊",
  security_practice: "🔐",
  testing_strategy: "🧪",
  devops_pipeline: "🚀",
  performance_optimization: "⚡",
  integration_pattern: "🔗",
  ai_prompt_engineering: "🧠",
  project_management: "📋",
  documentation_standard: "📁",
};

function renderProjectSection(payload: InstructionPayload): string {
  const story = payload.story;
  const lines = ["## 🏢 Project Overview\n"];

  if (story?.title) {
    lines.push(`**${story.title}**\n`);
  }
  if (story?.tech_stack && story.tech_stack.length > 0) {
    lines.push(`**Tech Stack:** ${story.tech_stack.join(", ")}`);
  }
  if (story?.domain && story.domain.length > 0) {
    lines.push(`**Domain:** ${story.domain.join(", ")}`);
  }
  if (story?.risk_profile) {
    lines.push(`**Risk Profile:** ${story.risk_profile}`);
  }
  if (payload.ruleset?.fingerprint) {
    lines.push(`**Ruleset Fingerprint:** \`${payload.ruleset.fingerprint}\``);
  }

  lines.push("");
  return lines.join("\n");
}

function renderCategorySection(rules: ExpertRule[], category: string, sectionTitle: string, headingLevel = "##"): string {
  const catRules = getRulesForCategory(rules, category);
  if (catRules.length === 0) return "";

  const lines = [`${headingLevel} ${sectionTitle}\n`];

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

function renderAbsoluteRules(rules: ExpertRule[]): string {
  const lawRule = findRuleBySlug(rules, CORE_LAWS_SLUG);

  if (lawRule) {
    const content = getRuleContent(lawRule);
    if (content) {
      return "## 🚨 Absolutní pravidla\n\n" + content + "\n\n";
    }
  }

  const codingRules = getRulesForCategory(rules, "coding_standard");
  if (codingRules.length === 0) return "";

  const lines = ["## 🚨 Absolutní pravidla\n"];
  let num = 1;
  for (const rule of codingRules) {
    if (rule.title && rule.summary) {
      lines.push(`${num}. **${rule.title}** — ${rule.summary}`);
      num++;
    }
  }
  lines.push("");
  return lines.join("\n");
}

function generate(payload: InstructionPayload): string {
  const storyTitle = payload.story?.title || DEFAULT_PROJECT_TITLE;
  const fingerprint = payload.ruleset?.fingerprint || null;
  const rules = payload.rules || [];

  let md = "";

  md += autoGenHeader(
    `AGENTS.md — ${storyTitle}`,
    fingerprint,
    payload.generated_at,
  );

  md += renderProjectSection(payload);
  md += "---\n\n";

  md += renderAbsoluteRules(rules);
  md += "---\n\n";

  const grouped = groupByCategory(rules);
  const allCategories = [...grouped.keys()];
  const sorted = sortCategories(allCategories);

  for (const category of sorted) {
    const emoji = SECTION_EMOJI[category] || "📌";
    const title = `${emoji} ${categoryLabel(category)}`;
    const section = renderCategorySection(rules, category, title);
    if (section) {
      md += section;
      md += "---\n\n";
    }
  }

  md += "## 📋 PR Checklist\n\n";
  md += renderPrChecklist("full");
  md += "\n";

  md += metadataFooter(payload, meta.id, meta.outputPath);

  return md;
}

export const adapterAgents: IdeAdapter = { meta, generate };
