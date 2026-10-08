#!/usr/bin/env node
/**
 * Regenerate every committed build artifact, in dependency order.
 *
 * WHY THIS EXISTS
 * A dozen gates guard files that are GENERATED from a source of truth, and each
 * one fails with its own "run X" hint. Rediscovering that list — and the order,
 * and the one step that needs AISHA_SEED_PROFILE=demo — costs a debugging round
 * every time an upstream merge lands. This script is the single entry point:
 *
 *     npm run regen            # regenerate everything, in order
 *     npm run regen -- --check # verify only: fail if anything is stale
 *     npm run regen -- --only db,i18n
 *
 * ORDER IS LOAD-BEARING, and each edge below is a real dependency, not taste:
 *   1. i18n locales   — src/i18n/segments/**        -> src/i18n/locales/*.json
 *   2. i18n content   — src/i18n/content/**         -> aisha/db/seed/translations/*.sql
 *   3. knowledge seed — aisha/knowledge/*.md        -> aisha/db/seed/core/41_aisha_knowledge_from_experience.sql
 *        …an input of step 4, so it comes first.
 *   4. demo seed      — aisha/db/seed/**            -> aisha/db/seed.compiled.sql (+ seed.sql mirror)
 *        …so it MUST follow steps 2 and 3, whose outputs are its inputs. The
 *        committed artifact is the DEMO profile; compiling without
 *        AISHA_SEED_PROFILE=demo silently produces a different profile and the
 *        gate then fails against a file you just "regenerated".
 *   5. reflection graphs — seed-derived graph seed
 *   6. baseline       — aisha/db/sql/**             -> migrations/00000000000000_baseline.sql
 *   7. migration register — records absorbed migrations in baseline-meta.json
 *
 * NOT INCLUDED (deliberately): steps that need a live database
 * (db:types:refresh:local), a full build (gen:bridge, gen:static-defense), or
 * that rewrite a baseline of KNOWN DEBT rather than a derived artifact
 * (gen:*-typecheck:baseline, tanstack-staletime baseline). Those must stay a
 * conscious act — auto-running them would launder regressions into the ratchet.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

/** Every step: what it derives, from what, and how. */
const STEPS = [
  {
    group: "i18n",
    name: "i18n locales",
    from: "src/i18n/segments/",
    to: "src/i18n/locales/*.json",
    run: ["run", "i18n:segments:build"],
  },
  {
    group: "i18n",
    name: "content translations",
    from: "src/i18n/content/",
    to: "aisha/db/seed/translations/*.sql",
    run: ["run", "i18n:content:build"],
  },
  {
    // Vstup kroku „demo seed": generovaný 41_aisha_knowledge_from_experience.sql leží
    // v seed/core, takže musí vzniknout DŘÍV, než se seed zkompiluje.
    group: "db",
    name: "knowledge seed (from experience)",
    from: "aisha/knowledge/*.md",
    to: "aisha/db/seed/core/41_aisha_knowledge_from_experience.sql",
    run: ["run", "db:seed:knowledge"],
  },
  {
    group: "db",
    name: "demo seed (compiled + mirror)",
    from: "aisha/db/seed/",
    to: "aisha/db/seed.compiled.sql, aisha/db/seed.sql",
    run: ["run", "db:seed:compile"],
    // The committed artifact is the demo profile — see the header note.
    env: { AISHA_SEED_PROFILE: "demo" },
  },
  {
    group: "db",
    name: "reflection graph seed",
    from: "seed sources",
    to: "aisha/db/seed/**/reflection graph seed",
    run: ["run", "db:seed:reflection-graphs"],
    optional: true,
  },
  {
    group: "db",
    name: "baseline",
    from: "aisha/db/sql/",
    to: "aisha/db/migrations/00000000000000_baseline.sql",
    run: ["run", "db:init:generate"],
  },
  {
    group: "db",
    name: "migration register",
    from: "aisha/db/migrations/",
    to: "aisha/db/baseline-meta.json",
    run: ["run", "db:migration:register"],
    optional: true,
  },
];

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const onlyArg = args.find((a) => a.startsWith("--only"));
const only = onlyArg
  ? (onlyArg.includes("=") ? onlyArg.split("=")[1] : args[args.indexOf(onlyArg) + 1] || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  : null;

const steps = only ? STEPS.filter((s) => only.includes(s.group) || only.includes(s.name)) : STEPS;
if (steps.length === 0) {
  console.error(`No step matches --only ${only?.join(",")}. Groups: ${[...new Set(STEPS.map((s) => s.group))].join(", ")}`);
  process.exit(2);
}

function gitDirty() {
  try {
    // execFileSync with an argument array — no shell, nothing to interpolate.
    return execFileSync("git", ["status", "--porcelain"], { encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
}

const before = checkOnly ? gitDirty() : null;
let failed = 0;

console.log(`\n${checkOnly ? "Checking" : "Regenerating"} ${steps.length} artifact step(s)\n`);

for (const [i, step] of steps.entries()) {
  const label = `[${i + 1}/${steps.length}] ${step.name}`;
  process.stdout.write(`${label}\n    ${step.from} -> ${step.to}\n`);
  try {
    execFileSync(NPM, step.run, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...(step.env ?? {}) },
      encoding: "utf-8",
    });
    console.log("    ok\n");
  } catch (err) {
    if (step.optional) {
      console.log(`    skipped (${step.run.join(" ")} unavailable)\n`);
      continue;
    }
    failed += 1;
    const detail = [err?.stdout, err?.stderr].filter(Boolean).join("\n").trim().split("\n").slice(-8).join("\n");
    console.error(`    FAILED: npm ${step.run.join(" ")}\n${detail.replace(/^/gm, "      ")}\n`);
  }
}

if (failed > 0) {
  console.error(`${failed} step(s) failed — artifacts are NOT consistent.`);
  process.exit(1);
}

if (checkOnly) {
  const after = gitDirty();
  if (after !== before) {
    const changed = after
      .split("\n")
      .filter((l) => l && !before.includes(l.slice(3)))
      .map((l) => `      ${l}`)
      .join("\n");
    console.error(
      "Artifacts are STALE — regeneration changed committed files:\n" +
        `${changed}\n\n    Fix with: npm run regen\n`,
    );
    process.exit(1);
  }
  console.log("All artifacts are in sync with their sources.\n");
  process.exit(0);
}

// A regenerated baseline that cannot be parsed is worse than a stale one:
// baseline-meta.json is read by the migrate path at deploy time.
const metaPath = "aisha/db/baseline-meta.json";
if (existsSync(metaPath)) {
  try {
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    const pending = meta?.baseline?.pending_migrations ?? meta?.pending_migrations ?? [];
    if (Array.isArray(pending) && pending.length > 0) {
      console.warn(`WARNING: ${metaPath} still lists pending migrations: ${pending.join(", ")}`);
    }
  } catch (err) {
    console.error(`FATAL: ${metaPath} is not valid JSON after regeneration — ${err.message}`);
    console.error("A conflict marker from a merge is the usual cause. Fix the file, then re-run.");
    process.exit(1);
  }
}

const dirty = gitDirty();
console.log(dirty ? "Regenerated. Changed files:\n" + dirty.replace(/^/gm, "    ") + "\n" : "Regenerated — everything was already in sync.\n");
console.log("Next: npm run test:gates\n");
