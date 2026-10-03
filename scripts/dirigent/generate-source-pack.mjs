#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { ROOT } from "./config.mjs";

const outputDir = path.join(ROOT, "docs", "generated", "dirigent-source-pack");
mkdirSync(outputDir, { recursive: true });

// Import adapter registry to get all managed IDE file paths
const { ADAPTERS } = await import("../ide-adapters/registry.mjs");

// Collect sources: adapter-managed files first, then .claude/commands
const sources = [
  ...Object.values(ADAPTERS).map((a) => a.outputPath),
  ...readdirSync(path.join(ROOT, ".claude", "commands"))
    .filter((file) => file.endsWith(".md"))
    .sort()
    .map((file) => path.join(".claude", "commands", file)),
].filter((relativePath) => existsSync(path.join(ROOT, relativePath)));

const manifest = {
  generated_at: new Date().toISOString(),
  source_count: sources.length,
  sources: [],
};

const readmeLines = [
  "# AISHA Dirigent Source Pack",
  "",
  "Generated from the current policy and assistant artifacts.",
  "",
  "## Included sources",
  "",
];

sources.forEach((relativePath, index) => {
  const absolutePath = path.join(ROOT, relativePath);
  const slug = relativePath.replace(/[\\/]/g, "__");
  const outputPath = path.join(outputDir, `${String(index + 1).padStart(2, "0")}-${slug}`);
  const content = readFileSync(absolutePath, "utf8");

  writeFileSync(outputPath, content);

  manifest.sources.push({
    source: relativePath,
    output: path.relative(ROOT, outputPath),
  });

  readmeLines.push(`- \`${relativePath}\` -> \`${path.relative(ROOT, outputPath)}\``);
});

writeFileSync(path.join(outputDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(path.join(outputDir, "README.md"), readmeLines.join("\n") + "\n");

process.stdout.write(`Generated source pack with ${sources.length} sources.\n`);
