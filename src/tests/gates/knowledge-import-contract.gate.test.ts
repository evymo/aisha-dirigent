/**
 * Gate: the knowledge-extraction → expert_rules importer honours the DB contract.
 *
 * WHY THIS EXISTS — scripts/import-knowledge-to-expert-rules.ts was a silently-dead
 * wire. Every `category` it declared ("best_practice", "architecture", "code_pattern",
 * "process", "testing", "security") had drifted out of the `expert_rule_category`
 * enum — zero overlap, no mapping layer, no ALTER TYPE. So:
 *   - the --sql-only path emitted 'best_practice'::expert_rule_category and aborted
 *     the whole BEGIN/COMMIT transaction on the first row;
 *   - the direct-client path caught the same error PER DOCUMENT and carried on,
 *     ending with "0 imported, N skipped" and exit code 0 — success-looking failure.
 * Result: none of the knowledge documents ever reached expert_rules, and therefore
 * never reached knowledge_items (KB), the Ragnarok index (RAG), compose_context
 * (Dirigent ruleset layer) or the CLAUDE.md overlay.
 *
 * This gate binds the script to the enum so the drift cannot happen silently again,
 * and holds the importer to fail-loud: an import that imports nothing is a failure,
 * not a success.
 *
 * Reference for a correct expert_rules writer: aisha/db/seed/core/38_anthropic_operating_principles.sql
 */
import { describe, test, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf-8");

const IMPORTER = "scripts/import-knowledge-to-expert-rules.ts";
const ENUM = "aisha/db/sql/enums/expert_rule_category.sql";
const KNOWLEDGE_DIR = "knowledge-extraction";
// The seed bootstraps the same slugs as stubs; the importer only hydrates their
// body_markdown. Category is owned by the seed (gen:ide relies on it at cold start),
// so the importer's category MUST match the seed's for the same slug — otherwise the
// hydration UPDATE silently reclassifies the rule out from under the bootstrap.
const SEED_STUBS = "aisha/db/seed/demo/02_expert_rules.sql";

/** Parse the authoritative enum members from the SoT enum file. */
function enumMembers(): Set<string> {
  const src = read(ENUM);
  const block = src.slice(src.indexOf("CREATE TYPE"));
  return new Set([...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
}

/** Parse every declared (file, slug, category) triple from the importer's registry. */
function registry(): Array<{ file: string; slug: string; category: string }> {
  const src = read(IMPORTER);
  const body = src.slice(src.indexOf("= ["));
  return [
    ...body.matchAll(/file:\s*"([^"]+)"[\s\S]*?slug:\s*"([^"]+)"[\s\S]*?category:\s*"([^"]+)"/g),
  ].map((m) => ({ file: m[1], slug: m[2], category: m[3] }));
}

/** Parse the seed's authoritative slug → category for the bootstrapped stubs. */
function seedCategories(): Map<string, string> {
  const src = read(SEED_STUBS);
  const map = new Map<string, string>();
  for (const m of src.matchAll(
    /'(aisha-[a-z0-9-]+)',[\s\S]{0,600}?'([a-z_]+)'::expert_rule_category/g,
  )) {
    if (!map.has(m[1])) map.set(m[1], m[2]);
  }
  return map;
}

describe("knowledge importer — enum contract", () => {
  test("the enum SoT parses to a sane member set", () => {
    const members = enumMembers();
    expect(members.size, "failed to parse expert_rule_category").toBeGreaterThan(5);
    expect(members.has("other"), "expected the 'other' fallback member").toBe(true);
  });

  test("the importer declares a non-empty registry", () => {
    expect(registry().length, "no KNOWLEDGE_DOCUMENTS parsed").toBeGreaterThan(5);
  });

  test("every declared category is a real member of expert_rule_category", () => {
    // The exact drift that killed this wire. A category outside the enum makes the
    // cast `'<x>'::expert_rule_category` throw at runtime.
    const members = enumMembers();
    const offenders = registry()
      .filter((e) => !members.has(e.category))
      .map((e) => `${e.file} → "${e.category}"`);
    expect(
      offenders,
      `categories not in expert_rule_category:\n  ${offenders.join("\n  ")}\n` +
        `valid: ${[...members].join(", ")}`,
    ).toEqual([]);
  });

  test("every registered document exists on disk", () => {
    const missing = registry()
      .map((e) => e.file)
      .filter((f) => !existsSync(join(ROOT, KNOWLEDGE_DIR, f)));
    expect(missing, `registered but missing from ${KNOWLEDGE_DIR}/`).toEqual([]);
  });

  test("importer category matches the seed stub category for the same slug", () => {
    // Single source of truth for category is the seed (gen:ide reads it at cold
    // start). The importer only hydrates body_markdown; if its category disagrees,
    // the ON CONFLICT DO UPDATE reclassifies the rule out from under the bootstrap.
    const seed = seedCategories();
    const drift = registry()
      .filter((e) => seed.has(e.slug) && seed.get(e.slug) !== e.category)
      .map((e) => `${e.slug}: import="${e.category}" seed="${seed.get(e.slug)}"`);
    expect(drift, `importer/seed category drift:\n  ${drift.join("\n  ")}`).toEqual([]);
  });
});

describe("knowledge importer — fail-loud contract", () => {
  test("the importer resolves an explicit partner instead of an arbitrary row", () => {
    // `(SELECT id FROM partner_profiles LIMIT 1)` silently picks whichever row the
    // planner returns and yields NULL when the partner bootstrap has not run —
    // author_partner_id is NOT NULL, so every insert fails one-by-one.
    const src = read(IMPORTER);
    expect(
      /SELECT id FROM partner_profiles LIMIT 1/.test(src),
      "importer must resolve the partner deterministically, not with a bare LIMIT 1",
    ).toBe(false);
    expect(
      /TODO: use actual platform admin partner/.test(src),
      "the partner-resolution TODO must be resolved, not carried",
    ).toBe(false);
  });

  test("the importer exits non-zero when it imports nothing", () => {
    // An import that imports nothing must not look like success. The original
    // per-document try/catch swallowed every failure and still exited 0.
    const src = read(IMPORTER);
    expect(
      /process\.exitCode\s*=\s*1|process\.exit\(1\)/.test(src),
      "importer must be able to signal failure",
    ).toBe(true);
    expect(
      /imported === 0|imported < 1|!imported|skipped > 0/.test(src),
      "importer must detect the nothing-imported / partial-import case and fail loud",
    ).toBe(true);
  });
});
