import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * `capture` is the second closed axis of the surface contract, and it had none of
 * the protection the first one has.
 *
 * `block_type` names a renderer, so surface-renderer-parity pins that every client
 * can draw every entry. `ReviewAction.capture` names an INPUT the client must know
 * how to collect before a decision may be submitted — same kind of promise, same
 * failure mode if broken: a client that does not know 'signature' renders the action
 * as an ordinary one-tap button and records a handover with no signature on it. It
 * does not crash and it does not warn; it just quietly confirms less than the block
 * asked for.
 *
 * Measured 2026-07-28, before this gate existed: the contract had `capture`, the web
 * shell had a whole capture panel, and NO SQL ever emitted the key — so the panel
 * could not open at all. A closed enum with no producer and no parity check is a
 * feature that exists only in the type system.
 *
 * Three properties, in the order they break:
 *   1. the TS union and the JSON Schema enum are one vocabulary spelled twice
 *   2. every client that can SUBMIT a review collects every capture kind
 *   3. SQL only ever emits values the vocabulary contains
 */
const ROOT = join(__dirname, "../../..");

const TYPES = join(ROOT, "packages/surface-blocks/src/types.ts");
const SCHEMAS = join(ROOT, "packages/surface-blocks/src/schemas.ts");
const SQL_DIR = join(ROOT, "aisha/db/sql/functions");

/** The write RPC every surface client is required to route decisions through. */
const WRITE_RPC = "submit_evidence_review_audited";

/** Client sources that may hold a review submit path. */
const CLIENT_FILES = [
  "apps/workbench-shell/src/api.ts",
  "apps/workbench-shell/src/components/blocks.tsx",
  "mobile-app/src/extranet/BlockRenderer.tsx",
];

/** Every .ts/.tsx under a directory, recursively. An unreadable tree throws — a silent
 *  skip would turn this gate green by reading nothing. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(p));
    else if (/\.tsx?$/.test(entry.name)) out.push(readFileSync(p, "utf8"));
  }
  return out;
}

function vocabulary(): Set<string> {
  const src = readFileSync(TYPES, "utf8");
  const decl = /export type ReviewCapture =([^;]*);/.exec(src);
  expect(decl, "ReviewCapture union not found in the contract").toBeTruthy();
  const kinds = new Set([...decl![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
  // A vocabulary that parsed as empty would make every assertion below vacuous.
  expect(kinds.size).toBeGreaterThan(1);
  return kinds;
}

describe("review capture is a closed axis with a producer and full client coverage", () => {
  const kinds = vocabulary();

  it("the JSON Schema enum says exactly what the TS union says", () => {
    const src = readFileSync(SCHEMAS, "utf8");
    const decl = /capture:\s*\{[^}]*items:\s*\{\s*enum:\s*\[([^\]]*)\]/.exec(src);
    expect(decl, "capture enum not found in the block schema").toBeTruthy();
    const inSchema = [...decl![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(inSchema).toEqual([...kinds].sort());
  });

  it("every client that can submit a review collects every capture kind", () => {
    const submitters = CLIENT_FILES.filter((f) => {
      const src = readFileSync(join(ROOT, f), "utf8");
      return src.includes(WRITE_RPC);
    });
    // If nobody submits, this gate proves nothing — that is a finding, not a pass.
    expect(submitters.length, "no client references the review write RPC").toBeGreaterThan(0);

    for (const file of submitters) {
      // The submit path and the capture panel live in different files (api.ts vs
      // components/blocks.tsx), so the unit that has to keep the promise is the whole
      // app source tree, not the one directory the submit call happens to sit in.
      const dir = file.slice(0, file.indexOf("/src/") + 4);
      const src = sources(join(ROOT, dir)).join("\n");
      expect(src.length, `${dir} read as empty`).toBeGreaterThan(0);
      const missing = [...kinds].filter((k) => !src.includes(`'${k}'`) && !src.includes(`"${k}"`));
      expect(missing, `${dir} cannot collect: ${missing.join(", ")}`).toEqual([]);
    }
  });

  it("SQL emits capture, and only values the vocabulary contains", () => {
    const producers = readdirSync(SQL_DIR)
      .filter((n) => n.endsWith(".sql"))
      .map((n) => ({ name: n, src: readFileSync(join(SQL_DIR, n), "utf8") }))
      .filter((f) => /'capture'/.test(f.src));

    // The defect this gate was written for: a closed enum nothing ever produces.
    expect(
      producers.map((p) => p.name),
      "no SQL function emits 'capture' — the panel can never open",
    ).not.toEqual([]);

    for (const p of producers) {
      // Values appear in the allow-list the function filters config against.
      const emitted = [...p.src.matchAll(/in \((('[a-z_]+',?\s*)+)\)/g)]
        .flatMap((m) => [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]))
        .filter((v) => kinds.has(v) || /^(recipient|signature|note)$/.test(v));
      const strays = [...new Set(emitted)].filter((v) => !kinds.has(v));
      expect(strays, `${p.name} filters on non-vocabulary values: ${strays.join(", ")}`).toEqual([]);
    }
  });
});
