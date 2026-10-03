#!/usr/bin/env node

/**
 * @module adapter-cursorrules
 * Generates .cursorrules — flat rules format for Cursor IDE.
 * Cursor reads this file from the project root for inline AI assistant context.
 */

import { createFlatRulesAdapter } from "./adapter-flat-rules.mjs";

const { meta, generate } = createFlatRulesAdapter({
  id: "cursorrules",
  outputPath: ".cursorrules",
  description: "Cursor IDE rules",
  titlePrefix: "Cursor Rules",
});

export { meta, generate };
