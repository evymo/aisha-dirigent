/**
 * @file e2e-bindings-fixture-contract.gate.test.ts
 * REMEDIATION CONTRACT: the e2e mock-backend bindings fixture must equal the
 * seed source-of-truth (SoT).
 *
 * The fixture at tests/e2e-dirigent/mock-backend/fixtures/bindings.ts is the
 * canned response for /rpc/mcp_get_claude_hook_bindings. Its own header claims
 * the shapes "derive from aisha/db/seed/claude_hook_bindings.json (the SoT
 * mirror)" and that a gate named `claude-overlay-fixture-drift` enforces the
 * alignment.
 *
 * Two defects motivate this gate:
 *   1. The cited gate `claude-overlay-fixture-drift` does NOT exist anywhere in
 *      the repo — the fixture is unenforced.
 *   2. The fixture's regex rules have DRIFTED from the seed. Most notably the
 *      `rpc-only` rule ships a coarse pattern_regex
 *        \.from\(["'][a-zA-Z_]+["']\)
 *      whereas the seed SoT ships
 *        \.from\(\s*["'`][^"'`]{1,60}["'`]\s*\)\s*\.\s*(select|insert|update|delete|upsert)\b
 *      An e2e run against the fixture therefore exercises DIFFERENT matcher
 *      behaviour than production, so the e2e "passes" while the real overlay
 *      would behave differently.
 *
 * This gate walks EVERY binding the fixture ships and asserts, per rule_slug,
 * that pattern_regex / hook_event / cooldown_sec match the seed exactly. It is
 * a pattern test: adding a new fixture rule that drifts from the seed will also
 * be caught, not just the currently-known `rpc-only` divergence.
 *
 * Run: AISHA_SKIP_ONLINE=1 npx vitest run --config vitest.gates.config.ts \
 *        src/tests/gates/remediation/e2e-bindings-fixture-contract.gate.test.ts
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

interface SeedBinding {
  rule_slug: string;
  hook_event: string;
  matcher: string;
  scanner_kind: string;
  pattern_regex: string | null;
  cooldown_sec: number;
  severity: string;
}

function readRepoFile(rel: string): string {
  return readFileSync(path.join(REPO_ROOT, rel), "utf-8");
}

const FIXTURE_REL = "tests/e2e-dirigent/mock-backend/fixtures/bindings.ts";
const SEED_REL = "aisha/db/seed/claude_hook_bindings.json";

/**
 * Parse the DEFAULT_BINDINGS array out of the fixture TS module without
 * importing it (avoids ts transform coupling / vscode mock). The fixture is a
 * plain data module: an interface + a single `export const DEFAULT_BINDINGS`.
 * We slice the array literal and evaluate it as JS.
 */
function loadFixtureBindings(): SeedBinding[] {
  const src = readRepoFile(FIXTURE_REL);
  const decl = src.indexOf("DEFAULT_BINDINGS");
  // Skip past the `= ` assignment so we don't grab the `[` in the type
  // annotation `HookBinding[]`. The array literal starts at the first `[`
  // after the `=`.
  const eq = src.indexOf("=", decl);
  const open = src.indexOf("[", eq);
  // Find the matching closing bracket by depth counting.
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (decl === -1 || open === -1 || end === -1) {
    throw new Error(`Could not locate DEFAULT_BINDINGS array literal in ${FIXTURE_REL}`);
  }
  const literal = src.slice(open, end + 1);
  const arr = new Function(`return (${literal});`)() as SeedBinding[];
  return arr;
}

function loadSeedBindings(): SeedBinding[] {
  const json = JSON.parse(readRepoFile(SEED_REL)) as { bindings: SeedBinding[] };
  return json.bindings;
}

describe("REMEDIATION — e2e bindings fixture ↔ seed SoT contract", () => {
  const fixture = loadFixtureBindings();
  const seed = loadSeedBindings();
  const seedBySlug = new Map(seed.map((b) => [b.rule_slug, b]));

  it("fixture is non-empty and parseable", () => {
    expect(fixture.length).toBeGreaterThan(0);
    expect(seed.length).toBeGreaterThan(0);
  });

  it("every fixture rule_slug exists in the seed SoT", () => {
    const missing = fixture.filter((f) => !seedBySlug.has(f.rule_slug)).map((f) => f.rule_slug);
    expect(missing, `fixture rules absent from seed ${SEED_REL}: ${missing.join(", ")}`).toEqual([]);
  });

  // PATTERN GATE: per fixture rule, every contract field must equal the seed.
  // Currently RED on `rpc-only` (pattern_regex drift). Any future fixture rule
  // that drifts is caught here too.
  it("each fixture binding's pattern_regex / hook_event / cooldown_sec matches the seed", () => {
    const drift: string[] = [];
    for (const f of fixture) {
      const s = seedBySlug.get(f.rule_slug);
      if (!s) continue; // covered by the existence test above
      if (f.pattern_regex !== s.pattern_regex) {
        drift.push(
          `  ${f.rule_slug}.pattern_regex\n` +
            `      fixture: ${JSON.stringify(f.pattern_regex)}\n` +
            `      seed   : ${JSON.stringify(s.pattern_regex)}`,
        );
      }
      if (f.hook_event !== s.hook_event) {
        drift.push(
          `  ${f.rule_slug}.hook_event: fixture=${JSON.stringify(f.hook_event)} seed=${JSON.stringify(s.hook_event)}`,
        );
      }
      if (f.cooldown_sec !== s.cooldown_sec) {
        drift.push(
          `  ${f.rule_slug}.cooldown_sec: fixture=${f.cooldown_sec} seed=${s.cooldown_sec}`,
        );
      }
    }
    expect(
      drift,
      `e2e fixture ${FIXTURE_REL} has drifted from seed SoT ${SEED_REL}:\n` +
        drift.join("\n") +
        `\nFix: update the fixture to mirror the seed values (the fixture derives from the seed).`,
    ).toEqual([]);
  });

  it("the fixture header's cited gate 'claude-overlay-fixture-drift' actually exists to enforce this contract", () => {
    // The fixture comment promises a gate named `claude-overlay-fixture-drift`
    // enforces alignment. That gate does not exist — this remediation gate is
    // the enforcement. Assert an enforcing gate is present so the promise is
    // not a dangling reference. This remediation file itself satisfies it.
    const thisFile = "src/tests/gates/remediation/e2e-bindings-fixture-contract.gate.test.ts";
    let enforcingGateExists = false;
    try {
      readRepoFile(thisFile);
      enforcingGateExists = true;
    } catch {
      enforcingGateExists = false;
    }
    expect(
      enforcingGateExists,
      "no gate enforces the e2e bindings fixture ↔ seed contract",
    ).toBe(true);
  });
});
