/**
 * Generates .windsurfrules — rules for Windsurf IDE.
 * Ported from scripts/ide-adapters/adapter-windsurfrules.mjs.
 * @module
 */

import { createFlatRulesAdapter } from "./adapter-flat-rules";

export const adapterWindsurfrules = createFlatRulesAdapter({
  id: "windsurfrules",
  outputPath: ".windsurfrules",
  description: "Windsurf IDE rules",
  titlePrefix: "Windsurf Rules",
});
