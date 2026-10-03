#!/usr/bin/env node

/**
 * @module adapter-claude
 * Generates CLAUDE.md — condensed instructions optimized for Claude Code.
 * Focuses on: absolute rules, MCP workflow, key patterns, file paths, NPM scripts.
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
  sortCategories,
} from "./registry.mjs";
import { routerConfigurationFragment } from "./router-fragment.mjs";
import { bringupFragment } from "./bringup-fragment.mjs";
import { runtimeContractFragment } from "./runtime-contract-fragment.mjs";

export const meta = {
  id: "claude",
  outputPath: "CLAUDE.md",
  description: "CLAUDE.md for Claude Code / Anthropic agents",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findRule(rules, slugOrTitle) {
  return findRuleBySlug(rules, slugOrTitle);
}

function renderCompactSection(rules, category, title) {
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

// Claude-specific category priority (most important first for context efficiency).
// Categories not listed here follow the shared CATEGORY_ORDER.
const CLAUDE_PRIORITY = [
  "ai_prompt_engineering",
  "coding_standard",
  "architecture_pattern",
  "api_design",
  "security_practice",
  "testing_strategy",
  "devops_pipeline",
];

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
    `CLAUDE.md — ${storyTitle}`,
    fingerprint,
    payload.generated_at,
  );

  // Stack summary
  if (payload.story?.tech_stack?.length > 0) {
    md += `> Stack: ${payload.story.tech_stack.join(" | ")}\n\n`;
  }

  md += "---\n\n";

  // 2. Absolute rules (condensed numbered list)
  const lawRule = findRule(rules, CORE_LAWS_SLUG);
  if (lawRule) {
    md += "## Absolutní pravidla\n\n";
    md += getRuleContent(lawRule) + "\n\n";
    md += "---\n\n";
  }

  // 3. Sections — Claude priority first, then remaining from CATEGORY_ORDER
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

  // 4. Enterprise source onboarding (mandatory compliance section)
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

  // 5. Runtime/API/env/plugin contract (shared across every IDE surface)
  md += runtimeContractFragment() + "---\n\n";

  // 6. Local backend & bring-up (shared entry-point — always emitted)
  md += (await bringupFragment()) + "---\n\n";

  // 7. Router Configuration (only when AISHA_LLM_GATEWAY_URL is set)
  const routerFragment = routerConfigurationFragment(payload);
  if (routerFragment) {
    md += routerFragment + "\n---\n\n";
  }

  // 8. Metadata footer
  md += metadataFooter(payload, meta.id, meta.outputPath);

  return md;
}
