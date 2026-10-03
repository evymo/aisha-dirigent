/**
 * Gate (remediation E2E-01-dispatch-contract): the e2e-dirigent mock-backend
 * dispatch fixture must speak the SAME contract as the prod dispatch route.
 *
 * The mock backend under tests/e2e-dirigent/mock-backend serves canned
 * responses for POST /dirigent/dispatch. Its fixture is the executable spec
 * the e2e suite exercises the relay against — so if the fixture's event
 * vocabulary or decision enum drifts from what the prod edge fn
 * (services/svc-ai-chat/src/routes/dirigent-supervisor.ts) actually accepts /
 * emits, the e2e suite is green against a contract prod never honors.
 *
 * Prod is the source of truth:
 *   - VALID_EVENTS      — the Set of event names the route accepts (else 400).
 *   - SupervisorResponse.decision — the decision enum the route may return
 *     (`allow` | `block` | `ask`).
 *
 * This gate parses BOTH sides and asserts:
 *   1. every event key the fixture answers is a member of prod VALID_EVENTS
 *      (fixture events ⊆ prod events);
 *   2. every decision value the fixture can return is a member of prod's
 *      decision enum (fixture decisions ⊆ prod decisions).
 *
 * KNOWN-RED at authoring time (branch feat/remediation, HEAD 569c5ffd):
 *   - fixture keys include `pre_prompt` — prod calls that event `prompt_submit`;
 *   - fixture DispatchResponse.decision union is `"allow" | "continue"` —
 *     prod never emits `continue` (its enum is allow|block|ask).
 * After the fixture is realigned to the prod contract this gate goes green.
 *
 * The fixture CLASS is discovered by walking the mock-backend fixtures dir for
 * any *.ts that declares a dispatch-shaped response map, so an overlooked
 * sibling fixture that drifted the same way would be caught too.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const FIXTURES_DIR = "tests/e2e-dirigent/mock-backend/fixtures";
const PROD_ROUTE = "services/svc-ai-chat/src/routes/dirigent-supervisor.ts";

/** Strip `//` and block comments so a commented-out token can't count. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

/* ----------------------------- PROD (source of truth) ---------------------- */

/** Parse `const VALID_EVENTS = new Set([ 'a', 'b', ... ])` → Set<string>. */
function parseProdEvents(src: string): Set<string> {
  const m = src.match(/VALID_EVENTS\s*=\s*new Set\(\s*\[([\s\S]*?)\]\s*\)/);
  if (!m) return new Set();
  const events = [...m[1].matchAll(/['"`]([a-z_]+)['"`]/g)].map((x) => x[1]);
  return new Set(events);
}

/**
 * Parse the SupervisorResponse decision enum:
 *   decision?: 'allow' | 'block' | 'ask';
 * inside `interface SupervisorResponse { ... }`.
 */
function parseProdDecisions(src: string): Set<string> {
  const iface = src.match(/interface SupervisorResponse\s*\{([\s\S]*?)\}/);
  const scope = iface ? iface[1] : src;
  const line = scope.match(/decision\??\s*:\s*([^;\n]+)/);
  if (!line) return new Set();
  const vals = [...line[1].matchAll(/['"`]([a-z_]+)['"`]/g)].map((x) => x[1]);
  return new Set(vals);
}

/* ------------------------------ FIXTURE (under test) ----------------------- */

/**
 * A dispatch fixture module: a *.ts that declares a Record keyed by dispatch
 * event names and typed with a *Response shape carrying an optional decision.
 * Discovered by walk, not hardcoded to one filename.
 */
function isDispatchFixture(src: string): boolean {
  return (
    /Record<\s*string\s*,\s*\w*Response\s*>/.test(src) &&
    /decision\??\s*:/.test(src)
  );
}

/** Extract the event keys from every `Record<string, *Response>` object literal. */
function parseFixtureEvents(src: string): Set<string> {
  const events = new Set<string>();
  // Each exported map: `export const X: Record<string, Foo> = { ... };`
  const mapRe = /Record<\s*string\s*,\s*\w*Response\s*>\s*=\s*\{([\s\S]*?)\n\};/g;
  for (const m of src.matchAll(mapRe)) {
    const body = m[1];
    // Top-ish level keys: `session_start:` / `pre_prompt:` etc. Match an
    // identifier key immediately followed by a `:` and a `{` object value.
    for (const k of body.matchAll(/(^|\n)\s*([a-z_][a-z0-9_]*)\s*:\s*\{/g)) {
      events.add(k[2]);
    }
  }
  return events;
}

/**
 * Extract decision values the fixture can produce: both from the interface
 * union (`decision?: "allow" | "continue"`) and any inline `decision: "..."`
 * literals in the fixture objects.
 */
function parseFixtureDecisions(src: string): Set<string> {
  const vals = new Set<string>();
  for (const line of src.matchAll(/decision\??\s*:\s*([^;\n,}]+(?:\|[^;\n]+)*)/g)) {
    for (const lit of line[1].matchAll(/['"`]([a-z_]+)['"`]/g)) {
      vals.add(lit[1]);
    }
  }
  return vals;
}

function fixtureFiles(): string[] {
  const dir = join(ROOT, FIXTURES_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))
    .filter((f) =>
      isDispatchFixture(stripComments(readFileSync(join(dir, f), "utf-8"))),
    )
    .sort();
}

/* ---------------------------------- TESTS ---------------------------------- */

describe("e2e dispatch fixture ⊆ prod dispatch contract", () => {
  const prodSrc = stripComments(readFileSync(join(ROOT, PROD_ROUTE), "utf-8"));
  const prodEvents = parseProdEvents(prodSrc);
  const prodDecisions = parseProdDecisions(prodSrc);
  const files = fixtureFiles();

  test("prod contract parses (non-empty events + decision enum)", () => {
    expect(prodEvents.size, "failed to parse VALID_EVENTS").toBeGreaterThan(0);
    expect(
      prodDecisions.size,
      "failed to parse SupervisorResponse.decision enum",
    ).toBeGreaterThan(0);
  });

  test("at least one dispatch fixture is present", () => {
    expect(files, `no dispatch fixture found under ${FIXTURES_DIR}`).not.toEqual(
      [],
    );
  });

  test("every fixture event key is a member of prod VALID_EVENTS", () => {
    const violations: string[] = [];
    for (const f of files) {
      const src = stripComments(
        readFileSync(join(ROOT, FIXTURES_DIR, f), "utf-8"),
      );
      for (const ev of parseFixtureEvents(src)) {
        if (!prodEvents.has(ev)) {
          violations.push(
            `${f}: event '${ev}' ∉ prod VALID_EVENTS {${[...prodEvents].join(", ")}}`,
          );
        }
      }
    }
    expect(
      violations,
      `Fixture event(s) drift from the prod dispatch contract:\n  ${violations.join("\n  ")}`,
    ).toEqual([]);
  });

  test("every fixture decision value is a member of prod's decision enum", () => {
    const violations: string[] = [];
    for (const f of files) {
      const src = stripComments(
        readFileSync(join(ROOT, FIXTURES_DIR, f), "utf-8"),
      );
      for (const d of parseFixtureDecisions(src)) {
        if (!prodDecisions.has(d)) {
          violations.push(
            `${f}: decision '${d}' ∉ prod enum {${[...prodDecisions].join(", ")}}`,
          );
        }
      }
    }
    expect(
      violations,
      `Fixture decision value(s) drift from the prod dispatch contract:\n  ${violations.join("\n  ")}`,
    ).toEqual([]);
  });
});
