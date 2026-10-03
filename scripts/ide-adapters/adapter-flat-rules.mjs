#!/usr/bin/env node

/**
 * @module adapter-flat-rules
 * Factory for flat-format IDE rule adapters (Cursor, Windsurf, etc.).
 * No emoji in headers — clean, minimal structure.
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

/**
 * Create a flat-rules adapter with the given config.
 * @param {{ id: string, outputPath: string, description: string, titlePrefix: string }} config
 */
export function createFlatRulesAdapter(config) {
  const meta = {
    id: config.id,
    outputPath: config.outputPath,
    description: config.description,
  };

  function generate(payload) {
    const storyTitle = payload.story?.title || DEFAULT_PROJECT_TITLE;
    const fingerprint = payload.ruleset?.fingerprint || null;
    const rules = payload.rules || [];

    let md = "";

    md += autoGenHeader(
      `${config.titlePrefix} — ${storyTitle}`,
      fingerprint,
      payload.generated_at,
    );

    // Project metadata
    if (payload.story) {
      md += "## Project\n\n";
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

    md += runtimeContractFragment();

    // Rules — flat format, category as H2, rule title as H3
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

    // Router Configuration fragment — appears only when AISHA_LLM_GATEWAY_URL
    // is present in the payload env (degradation-safe).
    const routerFragment = routerConfigurationFragment(payload);
    if (routerFragment) {
      md += routerFragment + "\n";
    }

    md += metadataFooter(payload, meta.id, meta.outputPath);

    return md;
  }

  return { meta, generate };
}
