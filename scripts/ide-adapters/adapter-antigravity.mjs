#!/usr/bin/env node

/**
 * @module adapter-antigravity
 * Generates `.antigravity/rules.md` — flat rules format for Google Antigravity IDE.
 * Antigravity reads project-level rule files for the agent panel context, in
 * the same spirit as Cursor (.cursorrules) and Windsurf (.windsurfrules).
 *
 * The exact location/filename is configurable in Antigravity; we use
 * `.antigravity/rules.md` as the documented convention. Adapters use the
 * shared flat-rules factory so the format stays in sync.
 */

import { createFlatRulesAdapter } from "./adapter-flat-rules.mjs";

const { meta, generate } = createFlatRulesAdapter({
  id: "antigravity",
  outputPath: ".antigravity/rules.md",
  description: "Google Antigravity IDE rules",
  titlePrefix: "Antigravity Rules",
});

export { meta, generate };
