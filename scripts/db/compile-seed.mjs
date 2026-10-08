#!/usr/bin/env node
/**
 * Seed Compiler — composes ordered seed layers into a single SQL file.
 *
 * Public OSS builds use the `platform` profile by default: schema runtime seed
 * and platform translations only. Concrete installations opt in to their own
 * implementation/private layers explicitly through AISHA_SEED_PROFILE and
 * AISHA_IMPLEMENTATION.
 *
 * @module
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";
import { porovnej } from "../lib/razeni.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const SEED_DIR = path.join(PROJECT_ROOT, "aisha/db/seed");
const DEFAULT_OUTPUT = path.join(PROJECT_ROOT, "aisha/db/seed.compiled.sql");

const args = process.argv.slice(2);

// 'dev' = platform core + the committed dev fixtures layer (aisha/db/seed/dev/),
// for local development + test stacks (warmup:local defaults to it). Distinct
// from 'demo' (public demo data) — the dev layer holds neutral test reference
// data (a few stories, a default spend policy) with no demo-partner FKs.
const VALID_PROFILES = ["platform", "empty", "template", "dev", "demo", "implementation", "instance", "full"];

function argValue(name) {
  const eq = args.find((arg) => arg.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const idx = args.indexOf(name);
  if (idx !== -1) return args[idx + 1];
  return undefined;
}

function normalizeProfile(value) {
  // `template` = lokální „šablona" (local-warmup --seed-profile template): čistá
  // platforma, obsah webu dodá šablona přes AISHA_SEED_DOMAIN.
  return value === "empty" || value === "template" ? "platform" : value;
}

const requestedProfile =
  argValue("--profile") || process.env.AISHA_SEED_PROFILE || "platform";
let profile = requestedProfile;

// Legacy alias: --no-demo historically meant "drop demo from full". Keep it
// compatible without making a public-safe profile include private data.
if (args.includes("--no-demo")) {
  if (profile === "full") profile = "instance";
  else if (profile === "demo") profile = "platform";
}

if (!VALID_PROFILES.includes(profile)) {
  console.error(
    `Invalid --profile/AISHA_SEED_PROFILE "${profile}" (expected: ${VALID_PROFILES.join(" | ")})`,
  );
  process.exit(1);
}

const canonicalProfile = normalizeProfile(profile);

const implementationArg = argValue("--implementation") || argValue("--story");
const implementationFromEnv =
  process.env.AISHA_IMPLEMENTATION || process.env.AISHA_STORY || process.env.STORY || "";
const implementation =
  implementationArg || implementationFromEnv || (includesImplementation(canonicalProfile) ? "aisha" : "");

function includesImplementation(currentProfile) {
  return ["implementation", "instance", "full"].includes(currentProfile);
}

const include = {
  platform: true,
  dev: canonicalProfile === "dev",
  implementation: includesImplementation(canonicalProfile),
  instance: canonicalProfile === "instance" || canonicalProfile === "full",
  demo: canonicalProfile === "demo" || canonicalProfile === "full",
};

const flags = {
  run: args.includes("--run"),
  dryRun: args.includes("--dry-run"),
  stdout: args.includes("--stdout"),
  demo: include.demo,
  verbose: args.includes("--verbose") || args.includes("-v"),
  help: args.includes("--help") || args.includes("-h"),
};

const outputFile = argValue("--output") || DEFAULT_OUTPUT;

// In --stdout mode the compiled SQL is the ONLY thing written to stdout (so a
// caller can capture it verbatim for byte-comparison) and NO files are touched.
// Route all human-facing progress to stderr so it never pollutes the payload.
// In every other mode this is a transparent alias for console.log.
const logProgress = (...parts) => (flags.stdout ? console.error(...parts) : console.log(...parts));

if (flags.help) {
  console.log(`
Seed Compiler — Compiles modular seed files into a single SQL file

Usage:
  node scripts/db/compile-seed.mjs [options]

Options:
  --profile P             Seed profile:
                            platform | empty | template = platform core + platform translations
                            dev        = platform + dev fixtures (local dev/test)
                            demo       = platform + public demo data
                            implementation = platform + selected implementation
                            instance   = platform + implementation + private overlay
                            full       = platform + implementation + private overlay + demo
                          Default: platform. Production deployments should set
                          AISHA_SEED_PROFILE=instance explicitly.
  --implementation NAME   Concrete implementation seed to include for
                          implementation|instance|full profiles.
                          Env: AISHA_IMPLEMENTATION. Legacy fallback:
                          AISHA_STORY/STORY. Default when needed: aisha.
  --story NAME            Legacy alias for --implementation.
  --run                   Compile and immediately run the seed.
  --dry-run               Show what would be compiled without writing.
  --stdout                Print the compiled SQL to stdout and write no files
                          (progress goes to stderr). Used by the drift gate.
  --no-demo               Legacy alias: full -> instance, demo -> platform.
  --output FILE           Output file path (default: aisha/db/seed.compiled.sql).
  --verbose, -v           Show detailed output.
  --help, -h              Show this help message.
`);
  process.exit(0);
}

function getSqlFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort((a, b) => porovnej(a, b))
    .map((file) => ({ name: file, path: path.join(dir, file) }));
}

function section(name, relDir, files) {
  return { name, relDir, files };
}

function implementationSection() {
  const safeImplementation = implementation.replace(/[^a-zA-Z0-9._-]/g, "");
  if (!safeImplementation || safeImplementation !== implementation) {
    throw new Error(`Invalid implementation name "${implementation}"`);
  }
  const relDir = `implementations/${safeImplementation}`;
  return section(`implementation:${safeImplementation}`, relDir, getSqlFiles(path.join(SEED_DIR, relDir)));
}

function instanceSection() {
  const instanceDir = path.join(SEED_DIR, "instance");
  const legacyInstanceFile = path.join(PROJECT_ROOT, "aisha/db/seed.instance.sql");
  const files = fs.existsSync(instanceDir)
    ? getSqlFiles(instanceDir)
    : fs.existsSync(legacyInstanceFile)
      ? [{ name: "seed.instance.sql", path: legacyInstanceFile }]
      : [];
  // The private overlay lives in a separate submodule (aisha/db/seed/instance →
  // aisha-instance-data). When it is unpopulated — a placeholder README and no
  // .sql — a profile that requests it (instance|full) must NOT silently ship an
  // "instance" build that lacks the instance data. Make the fallback to the
  // default layers explicit and loud (stderr, so it surfaces in deploy logs)
  // rather than a silent omission. Strict installs can promote this to a hard
  // failure via AISHA_SEED_REQUIRE_INSTANCE=1.
  if (files.length === 0) {
    const msg =
      "compile-seed: private instance overlay requested but absent — " +
      "aisha/db/seed/instance/ has no .sql (submodule not populated; only a README). " +
      "Compiling with the DEFAULT layers only; the seed will NOT include instance data.";
    if (process.env.AISHA_SEED_REQUIRE_INSTANCE === "1") {
      throw new Error(`${msg} (AISHA_SEED_REQUIRE_INSTANCE=1 → refusing to compile a degraded instance seed)`);
    }
    console.warn(`⚠️  ${msg}`);
  }
  return section("private-instance", "instance", files);
}

function buildSections() {
  const sections = [
    section("core", "core", getSqlFiles(path.join(SEED_DIR, "core"))),
    section("translations", "translations", getSqlFiles(path.join(SEED_DIR, "translations"))),
  ];

  if (include.dev) sections.push(section("dev", "dev", getSqlFiles(path.join(SEED_DIR, "dev"))));
  if (include.implementation) sections.push(implementationSection());
  if (include.instance) sections.push(instanceSection());
  if (include.demo) sections.push(section("demo", "demo", getSqlFiles(path.join(SEED_DIR, "demo"))));

  return sections;
}

function generateHeader(sections) {
  const sourceDirs = sections
    .filter((s) => s.files.length > 0)
    .map((s) => `--   - aisha/db/seed/${s.relDir}/`)
    .join("\n");
  const implementationLine = implementation ? implementation : "(none)";
  return `-- ==============================================================================
-- Compiled Seed File - Generated by compile-seed.mjs
-- ==============================================================================
-- Profile: ${canonicalProfile}
-- Requested profile: ${requestedProfile}
-- Implementation: ${implementationLine}
-- Source directories:
${sourceDirs || "--   (none)"}
--
-- DO NOT EDIT THIS FILE DIRECTLY.
-- Edit source files in aisha/db/seed/ and run:
--   npm run db:seed:compile
-- ==============================================================================

`;
}

function generateSectionHeader(sectionName, files) {
  return `
-- ==============================================================================
-- SECTION: ${sectionName.toUpperCase()}
-- Files: ${files.length}
-- ==============================================================================

`;
}

function compileSeed() {
  logProgress("Compiling seed files...\n");
  logProgress(
    `   profile: ${canonicalProfile}  implementation=${implementation || "(none)"} ` +
      `(dev=${include.dev}, implementation=${include.implementation}, private=${include.instance}, demo=${include.demo})\n`,
  );

  const sections = buildSections();
  let compiledContent = generateHeader(sections);
  let totalFiles = 0;
  let totalLines = 0;

  for (const currentSection of sections) {
    const files = currentSection.files || [];

    if (files.length === 0) {
      if (flags.verbose) console.log(`  ${currentSection.name}: no SQL files found`);
      continue;
    }

    compiledContent += generateSectionHeader(currentSection.name, files);
    logProgress(`📁 ${currentSection.name}/`);

    for (const file of files) {
      const content = fs.readFileSync(file.path, "utf-8");
      const lineCount = content.split("\n").length;

      compiledContent += `-- File: ${currentSection.relDir}/${file.name}\n`;
      compiledContent += `-- Lines: ${lineCount}\n`;
      compiledContent += `-- ==============================================================================\n`;
      compiledContent += content;
      compiledContent += "\n\n";

      totalFiles++;
      totalLines += lineCount;

      if (flags.verbose) logProgress(`   ✓ ${file.name} (${lineCount} lines)`);
      else logProgress(`   ✓ ${file.name}`);
    }
  }

  logProgress("\nSummary:");
  logProgress(`   Files: ${totalFiles}`);
  logProgress(`   Lines: ${totalLines.toLocaleString()}`);

  // --stdout: emit the compiled SQL verbatim and write nothing. The drift gate
  // captures this and byte-compares it against the committed mirrors, so it must
  // be the exact same bytes compileSeed() would otherwise persist to disk.
  if (flags.stdout) {
    process.stdout.write(compiledContent);
    return null;
  }

  if (flags.dryRun) {
    logProgress("\nDry run - no files written");
    return null;
  }

  fs.writeFileSync(outputFile, compiledContent);
  const fileSize = (fs.statSync(outputFile).size / 1024).toFixed(1);
  console.log(`   Output: ${path.relative(PROJECT_ROOT, outputFile)} (${fileSize} KB)`);

  // seed.sql je zrcadlo VÝCHOZÍHO výstupu. Explicitní --output (migrate v
  // kontejneru, kde je aisha/db jen pro čtení) zakommitovaný soubor nemění.
  if (path.resolve(outputFile) === path.resolve(DEFAULT_OUTPUT)) {
    const seedSqlPath = path.join(PROJECT_ROOT, "aisha/db/seed.sql");
    fs.writeFileSync(seedSqlPath, compiledContent);
    console.log(`   Synced: ${path.relative(PROJECT_ROOT, seedSqlPath)}`);
  }

  return outputFile;
}

function runSeed(seedFile) {
  console.log("\nRunning seed...\n");
  try {
    execFileSync("node", [path.join(__dirname, "seed.mjs"), "--local", "--file", seedFile], {
      stdio: "inherit",
      env: {
        ...process.env,
        SUPABASE_DB_ALLOW_INSECURE_SSL_FAILOVER: "true",
      },
    });
    console.log("\nSeed completed successfully");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("\nSeed failed:", message);
    process.exit(1);
  }
}

try {
  const outputPath = compileSeed();
  if (flags.run && outputPath) {
    runSeed(outputPath);
  } else if (!flags.dryRun && !flags.stdout) {
    console.log("\nCompilation complete");
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error("Error:", message);
  process.exit(1);
}
