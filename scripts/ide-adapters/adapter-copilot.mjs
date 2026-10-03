#!/usr/bin/env node

/**
 * @module adapter-copilot
 * Generates .github/copilot-instructions.md from the instruction payload.
 * Replicates the output of the SQL generate_copilot_instructions() function.
 */

import {
  autoGenHeader,
  DEFAULT_PROJECT_TITLE,
  projectMetadata,
  renderPrChecklist,
  renderRulesByCategory,
  metadataFooter,
} from "./registry.mjs";
import { routerConfigurationFragment } from "./router-fragment.mjs";
import { runtimeContractFragment } from "./runtime-contract-fragment.mjs";

export const meta = {
  id: "copilot",
  outputPath: ".github/copilot-instructions.md",
  description: "GitHub Copilot instructions",
};

/**
 * Generate .github/copilot-instructions.md content from payload.
 */
export function generate(payload) {
  const storyTitle = payload.story?.title || DEFAULT_PROJECT_TITLE;
  const fingerprint = payload.ruleset?.fingerprint || null;

  let md = "";

  // Header
  md += autoGenHeader(
    `Copilot Instructions — ${storyTitle}`,
    fingerprint,
    payload.generated_at,
  );

  // Project metadata
  md += "## 🎯 Project\n\n";
  const meta = projectMetadata(payload);
  if (meta) {
    md += meta;
  } else {
    md += "**Scope:** Default rule set\n";
  }
  md += "\n---\n\n";

  md += runtimeContractFragment();
  md += "---\n\n";

  // Rules
  md += "## Expert Rules\n\n";
  if (!payload.rules || payload.rules.length === 0) {
    md += "_No rules found. ";
    if (payload.scope === "story") {
      md += "Pin rules via `create_story_ruleset(story_id, rule_ids[])`._\n";
    } else {
      md += "Seed the database with default expert rules._\n";
    }
  } else {
    md += renderRulesByCategory(payload.rules);
  }
  md += "\n\n---\n\n";

  // PR Checklist
  md += "## 📋 PR Checklist\n\n";
  md += renderPrChecklist("compact");
  md += "\n";

  // Router Configuration fragment (compact form)
  const routerFragment = routerConfigurationFragment(payload, { includeBatch: false });
  if (routerFragment) {
    md += routerFragment + "\n";
  }

  // Metadata footer (as HTML comment + JSON)
  md += "\n" + metadataFooter(payload, meta.id, meta.outputPath);

  return md;
}
