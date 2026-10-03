#!/usr/bin/env node

/**
 * @module adapter-zedrules
 * Generates .rules — project-level instructions for Zed Agent Panel.
 * Zed loads .rules before compatibility files such as .cursorrules,
 * AGENTS.md, or CLAUDE.md, so this file is the Zed-native baseline.
 */

import {
  autoGenHeader,
  DEFAULT_PROJECT_TITLE,
  groupByCategory,
  categoryLabel,
  getRuleContent,
  metadataFooter,
  sortCategories,
} from "./registry.mjs";
import { routerConfigurationFragment } from "./router-fragment.mjs";
import { runtimeContractFragment } from "./runtime-contract-fragment.mjs";

export const meta = {
  id: "zedrules",
  outputPath: ".rules",
  description: "Zed Agent Panel project rules",
};

function renderZedbenchPreamble() {
  return [
    "## AISHA ZEDBENCH Runtime Contract",
    "",
    "You are working in Zed with AISHA ZEDBENCH context.",
    "",
    "AISHA Dirigent is the authority for story context, delivery flow, compliance, quality gates, model routing, and high-risk decisions. Prefer AISHA MCP tools before making project-level decisions.",
    "",
    "Use AISHA MCP tools for these intents:",
    "",
    "- next step: `suggest_next_step`",
    "- code quality: `assess_quality`",
    "- test strategy: `evaluate_tests`",
    "- compliance: `check_pr_compliance`",
    "- effort/risk: `estimate_effort` and `moderate_flow`",
    "- story context: `get_story_context`",
    "- knowledge lookup: `search_knowledge`",
    "- model/task routing: `route_task`",
    "",
    "Do not perform irreversible or high-risk actions without AISHA Dirigent approval. Do not expose or rely on Postgres, Supabase, service-role keys, or database table internals in Zed-facing workflows; use AISHA Runtime API and MCP contracts instead.",
    "",
  ].join("\n");
}

export function generate(payload) {
  const storyTitle = payload.story?.title || DEFAULT_PROJECT_TITLE;
  const fingerprint = payload.ruleset?.fingerprint || null;
  const rules = payload.rules || [];

  let md = "";

  md += autoGenHeader(
    `Zed Rules — ${storyTitle}`,
    fingerprint,
    payload.generated_at,
  );
  md += "\n";

  md += renderZedbenchPreamble();
  md += runtimeContractFragment();

  if (payload.story) {
    md += "## Project Context\n\n";
    if (payload.story.tech_stack?.length > 0) {
      md += `Tech Stack: ${payload.story.tech_stack.join(", ")}\n`;
    }
    if (payload.story.domain?.length > 0) {
      md += `Domain: ${payload.story.domain.join(", ")}\n`;
    }
    if (payload.story.risk_profile) {
      md += `Risk: ${payload.story.risk_profile}\n`;
    }
    md += "\n";
  }

  const grouped = groupByCategory(rules);
  const sorted = sortCategories([...grouped.keys()]);

  for (const category of sorted) {
    const catRules = grouped.get(category);
    const label = categoryLabel(category);
    md += `## ${label}\n\n`;

    for (const rule of catRules) {
      const content = getRuleContent(rule);
      if (content) {
        md += `### ${rule.title}\n\n`;
        md += content + "\n\n";
      }
    }
  }

  const routerFragment = routerConfigurationFragment(payload);
  if (routerFragment) {
    md += routerFragment + "\n";
  }

  md += metadataFooter(payload, meta.id, meta.outputPath);

  return md;
}
