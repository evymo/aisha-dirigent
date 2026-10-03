#!/usr/bin/env node

/**
 * @module adapter-agents
 * Generates AGENTS.md — comprehensive instructions for AI assistants and developers.
 * Includes: business domain, architecture, absolute rules, workflows, testing, security.
 */

import {
  autoGenHeader,
  CATEGORY_ORDER,
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
} from "./registry.mjs";
import { routerConfigurationFragment } from "./router-fragment.mjs";
import { bringupFragment } from "./bringup-fragment.mjs";
import { runtimeContractFragment } from "./runtime-contract-fragment.mjs";

export const meta = {
  id: "agents",
  outputPath: "AGENTS.md",
  description: "AGENTS.md for AI assistants (Codex, OpenAI agents)",
};

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

function renderProjectSection(payload) {
  const story = payload.story;
  const lines = ["## 🏢 Project Overview\n"];

  if (story && story.title) {
    lines.push(`**${story.title}**\n`);
  }

  if (story?.tech_stack?.length > 0) {
    lines.push(`**Tech Stack:** ${story.tech_stack.join(", ")}`);
  }
  if (story?.domain?.length > 0) {
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

function renderCategorySection(rules, category, sectionTitle, headingLevel = "##") {
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

function renderAbsoluteRules(rules) {
  const lawRule = findRuleBySlug(rules, CORE_LAWS_SLUG);

  if (lawRule) {
    const content = getRuleContent(lawRule);
    if (content) {
      return "## 🚨 Absolutní pravidla\n\n" + content + "\n\n";
    }
  }

  // Fallback: generate from coding_standard category
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

// Section titles (emoji prefix) per category — derived from CATEGORY_ORDER
const SECTION_EMOJI = {
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

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

export async function generate(payload) {
  const storyTitle = payload.story?.title || DEFAULT_PROJECT_TITLE;
  const fingerprint = payload.ruleset?.fingerprint || null;
  const rules = payload.rules || [];

  let md = "";

  // 1. Header
  md += autoGenHeader(
    `AGENTS.md — ${storyTitle}`,
    fingerprint,
    payload.generated_at,
  );

  // 2. Project overview
  md += renderProjectSection(payload);
  md += "---\n\n";

  // 3. Absolute rules (extracted summary)
  md += renderAbsoluteRules(rules);
  md += "---\n\n";

  // 4. Expert rules by category — use shared CATEGORY_ORDER
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

  // 5. Enterprise source onboarding (mandatory compliance section)
  const hasOnboardingRule = rules.some(
    (r) => (r.slug || r.title || "").toLowerCase().includes("enterprise-source-onboarding")
  );
  if (!hasOnboardingRule) {
    md += "## Enterprise Source Onboarding povinný\n\n";
    md += "Každý nový datový zdroj musí projít onboardingem podle:\n";
    md += "- [SOURCE_ONBOARDING_CONTRACT.md](docs/enterprise/SOURCE_ONBOARDING_CONTRACT.md)\n";
    md += "- [SOURCE_APPLICATION_ONBOARDING_HANDBOOK.md](docs/onboarding/SOURCE_APPLICATION_ONBOARDING_HANDBOOK.md)\n\n";
    md += "---\n\n";
  }

  // 6. PR Checklist
  md += "## 📋 PR Checklist\n\n";
  md += renderPrChecklist("full");
  md += "\n";

  // Runtime/API/env/plugin contract (shared across every IDE surface)
  md += "---\n\n" + runtimeContractFragment();

  // Local backend & bring-up (shared entry-point — always emitted)
  md += "---\n\n" + (await bringupFragment());

  // Router Configuration (gateway-aware; emits "" when not configured)
  const routerFragment = routerConfigurationFragment(payload);
  if (routerFragment) {
    md += routerFragment + "\n";
  }

  // Metadata footer
  md += metadataFooter(payload, meta.id, meta.outputPath);

  return md;
}
