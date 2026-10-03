#!/usr/bin/env node

/**
 * @module adapter-windsurfrules
 * Generates .windsurfrules — rules for Windsurf IDE.
 * Uses the same flat rules format as Cursor.
 */

import { createFlatRulesAdapter } from "./adapter-flat-rules.mjs";

const { meta, generate } = createFlatRulesAdapter({
  id: "windsurfrules",
  outputPath: ".windsurfrules",
  description: "Windsurf IDE rules",
  titlePrefix: "Windsurf Rules",
});

export { meta, generate };
