/**
 * Generates .github/copilot-instructions.md from the instruction payload.
 * Ported from scripts/ide-adapters/adapter-copilot.mjs.
 * @module
 */

import {
  autoGenHeader,
  DEFAULT_PROJECT_TITLE,
  projectMetadata,
  renderPrChecklist,
  renderRulesByCategory,
  metadataFooter,
} from "./registry";

import type { IdeAdapter, InstructionPayload } from "./registry";

const meta = {
  id: "copilot",
  outputPath: ".github/copilot-instructions.md",
  description: "GitHub Copilot instructions",
} as const;

function generate(payload: InstructionPayload): string {
  const storyTitle = payload.story?.title || DEFAULT_PROJECT_TITLE;
  const fingerprint = payload.ruleset?.fingerprint || null;

  let md = "";

  md += autoGenHeader(
    `Copilot Instructions — ${storyTitle}`,
    fingerprint,
    payload.generated_at,
  );

  md += "## 🎯 Project\n\n";
  const metaStr = projectMetadata(payload);
  if (metaStr) {
    md += metaStr;
  } else {
    md += "**Scope:** Default rule set\n";
  }
  md += "\n---\n\n";

  if (!payload.rules || payload.rules.length === 0) {
    md += "_No rules found. ";
    if (payload.scope === "story") {
      md += "Pin rules via `create_story_ruleset(story_id, rule_ids[])`._\n";
    } else {
      md += "Seed the database with default expert rules._\n";
    }
    return md;
  }

  md += "## ⚠️ Expert Rules\n\n";
  md += renderRulesByCategory(payload.rules);
  md += "\n\n---\n\n";

  md += "## 📋 PR Checklist\n\n";
  md += renderPrChecklist("compact");
  md += "\n";

  md += "\n" + metadataFooter(payload, meta.id, meta.outputPath);

  return md;
}

export const adapterCopilot: IdeAdapter = { meta, generate };
