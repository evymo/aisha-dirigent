/**
 * Factory for flat-format IDE rule adapters (Cursor, Windsurf, etc.).
 * Ported from scripts/ide-adapters/adapter-flat-rules.mjs.
 * @module
 */

import {
  autoGenHeader,
  DEFAULT_PROJECT_TITLE,
  groupByCategory,
  categoryLabel,
  getRuleContent,
  metadataFooter,
  sortCategories,
} from "./registry";

import type { IdeAdapter, InstructionPayload } from "./registry";

interface FlatAdapterConfig {
  id: string;
  outputPath: string;
  description: string;
  titlePrefix: string;
}

export function createFlatRulesAdapter(config: FlatAdapterConfig): IdeAdapter {
  const meta = {
    id: config.id,
    outputPath: config.outputPath,
    description: config.description,
  };

  function generate(payload: InstructionPayload): string {
    const storyTitle = payload.story?.title || DEFAULT_PROJECT_TITLE;
    const fingerprint = payload.ruleset?.fingerprint || null;
    const rules = payload.rules || [];

    let md = "";

    md += autoGenHeader(
      `${config.titlePrefix} — ${storyTitle}`,
      fingerprint,
      payload.generated_at,
    );

    if (payload.story) {
      md += "## Project\n\n";
      if (payload.story.tech_stack && payload.story.tech_stack.length > 0) {
        md += `Tech Stack: ${payload.story.tech_stack.join(", ")}\n`;
      }
      if (payload.story.domain && payload.story.domain.length > 0) {
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
      const catRules = grouped.get(category)!;
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

    md += metadataFooter(payload, meta.id, meta.outputPath);

    return md;
  }

  return { meta, generate };
}
