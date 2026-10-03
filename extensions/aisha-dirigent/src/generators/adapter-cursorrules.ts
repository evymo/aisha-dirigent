/**
 * Generates .cursorrules — flat rules format for Cursor IDE.
 * Ported from scripts/ide-adapters/adapter-cursorrules.mjs.
 * @module
 */

import { createFlatRulesAdapter } from "./adapter-flat-rules";

export const adapterCursorrules = createFlatRulesAdapter({
  id: "cursorrules",
  outputPath: ".cursorrules",
  description: "Cursor IDE rules",
  titlePrefix: "Cursor Rules",
});
