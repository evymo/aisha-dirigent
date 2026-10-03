/**
 * REMEDIATION GATE — W4-02: the workbench execution rail must be wired END-TO-END.
 *
 * CONTRACT
 * --------
 * W4-02 was decided as WIRE-UP (not doc-only): the "workbench" RuntimeAdapter runs a
 * clow on a LOCAL model living in the developer's editor extension, via a POLL+BLOCK
 * rail — svc-ai-chat ENQUEUES a request, then block-polls for the result while the
 * aisha-dirigent extension CLAIMS it, runs it locally, and COMPLETES it. For that rail
 * to actually execute anything, THREE things must be true:
 *
 *   (a) ENQUEUE SIDE — services/svc-ai-chat production code puts a request on the queue
 *       (workbenchAdapter → enqueue_workbench_request). This leg already exists; it is
 *       asserted here so a regression that deletes the producer also trips this gate.
 *
 *   (b) CONSUMER / DRAINER — something CLAIMS the queued request and runs it. The
 *       decided owner is the aisha-dirigent editor extension (extensions/aisha-dirigent*)
 *       via the workbench claim path: a poller/loop that calls
 *       `claim_pending_workbench_requests` (claim) and `complete_workbench_request`
 *       (complete). Without a drainer, every enqueued request sits 'pending' until
 *       workbenchAdapter times out — the rail is DORMANT and fails closed (a 'down'
 *       workbench is excluded by fn_resolve_runtime, so requests are never even minted).
 *       A claim reference that lives ONLY in *.test.ts / a generated PostgREST types
 *       barrel is NOT a runtime consumer.
 *
 *   (c) IN-REPO USE OF workbench-core — packages/workbench-core is the platform-agnostic
 *       core the extension + workbench fork are meant to build on. At least one file
 *       OUTSIDE the package must `import … from "@aisha/workbench-core"`. Zero in-repo
 *       importers means the package is an orphan and the rail's shared core is unused.
 *
 * KNOWN-RED (the reason this gate exists):
 *   • Leg (a) PASSES — services/svc-ai-chat/src/reflection/runtime/workbench-adapter.ts
 *     calls enqueue_workbench_request.
 *   • Leg (b) FAILS — no consumer drains the queue. grep of extensions/ for
 *     claim_pending_workbench_requests returns nothing; the only claim references are a
 *     svc-ai-chat integration TEST and the generated mobile-app types barrel. The rail
 *     is enqueue-only / dormant.
 *   • Leg (c) FAILS — no file outside packages/workbench-core imports "@aisha/workbench-core";
 *     the package has 0 in-repo consumers.
 *
 * Wiring a claim/run/complete loop into the aisha-dirigent extension AND consuming
 * workbench-core from in-repo code turns this GREEN.
 *
 * Run:
 *   AISHA_SKIP_ONLINE=1 npx vitest run --config vitest.gates.config.ts \
 *     src/tests/gates/remediation/workbench-execution-rail-wired.gate.test.ts
 *
 * @module
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SVC_AI_CHAT_SRC = path.resolve(ROOT, "services/svc-ai-chat/src");
const WORKBENCH_CORE_DIR = path.resolve(ROOT, "packages/workbench-core");

/**
 * Bounded set of first-party source roots to scan — every place a workbench-queue
 * drainer or a workbench-core consumer could plausibly live. Bounded (not the whole
 * repo) so the gate stays fast and deterministic; add a root here if the rail's
 * consumer is legitimately wired somewhere new.
 */
const SCAN_ROOTS = [
  "extensions",
  "services",
  "packages",
  "src",
  "apps",
  "scripts",
  "mobile-app",
].map((d) => path.resolve(ROOT, d));

/** Collect source files across all SCAN_ROOTS. */
function collectAll(): string[] {
  return SCAN_ROOTS.flatMap((root) => collectCode(root));
}

const CODE_EXT = new Set([".ts", ".tsx", ".mjs", ".cjs", ".js"]);

/** Recursively collect source files under a dir (skips node_modules / dist / build). */
function collectCode(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name === "node_modules" ||
      entry.name === "dist" ||
      entry.name === "build" ||
      entry.name === "target" ||
      entry.name === "out"
    )
      continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectCode(full));
    else if (CODE_EXT.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

/** A test/spec file — a reference here is NOT a production runtime consumer. */
function isTestFile(file: string): boolean {
  return /\.(test|spec|it\.test|integration\.test|unit\.test)\.[cm]?[jt]sx?$/.test(
    path.basename(file),
  );
}

/**
 * A generated PostgREST/Supabase types barrel (mentions every RPC name as a *type*,
 * never calls it). Identified by path — these are code-gen output, not consumers.
 */
function isGeneratedTypesBarrel(file: string): boolean {
  const rel = path.relative(ROOT, file).replace(/\\/g, "/");
  return (
    rel.endsWith("mobile-app/src/types/database.ts") ||
    rel.endsWith("src/integrations/db/types.ts") ||
    /\/types\/database\.ts$/.test(rel)
  );
}

/** True if any non-comment line references the identifier as code (call/import). */
function referencesIdentifier(src: string, ident: RegExp): boolean {
  return src
    .split("\n")
    .some((line) => {
      const t = line.trimStart();
      if (t.startsWith("*") || t.startsWith("//") || t.startsWith("/*")) return false;
      return ident.test(line);
    });
}

describe("W4-02 — workbench execution rail is wired end-to-end", () => {
  it("(a) svc-ai-chat ENQUEUES a workbench request (producer exists)", () => {
    const producers = collectCode(SVC_AI_CHAT_SRC)
      .filter((f) => !isTestFile(f))
      .filter((f) =>
        referencesIdentifier(
          fs.readFileSync(f, "utf8"),
          /\benqueue_workbench_request\b/,
        ),
      )
      .map((f) => path.relative(ROOT, f));

    expect(
      producers,
      `services/svc-ai-chat production code must enqueue a workbench request ` +
        `(workbenchAdapter → enqueue_workbench_request). Found no non-test ` +
        `producer — the enqueue side of the rail is missing.`,
    ).not.toHaveLength(0);
  });

  it("(b) a CONSUMER drains the queue — the aisha-dirigent extension claims AND completes queued requests", () => {
    // A real drainer both CLAIMS and COMPLETES. Scan the whole repo for a runtime
    // (non-test, non-generated-types) file that calls the claim RPC; the decided
    // owner is the aisha-dirigent extension, but a server-side poller would also
    // satisfy the rail, so the scan is repo-wide.
    const claimRe = /\bclaim_(pending_workbench_requests|workbench_request)\b/;
    const completeRe = /\bcomplete_workbench_request\b/;

    const consumers = collectAll()
      .filter((f) => !f.startsWith(WORKBENCH_CORE_DIR)) // core is the SoT, not a drainer
      .filter((f) => !isTestFile(f))
      .filter((f) => !isGeneratedTypesBarrel(f))
      .filter((f) => {
        const src = fs.readFileSync(f, "utf8");
        // A genuine claim/run/complete loop references both the claim and the
        // completion RPC — a lone claim reference is not a drain loop.
        return referencesIdentifier(src, claimRe) && referencesIdentifier(src, completeRe);
      })
      .map((f) => path.relative(ROOT, f));

    // Surface whether the decided owner (the extension) is the one wired.
    const extensionDrains = consumers.some((rel) =>
      rel.replace(/\\/g, "/").startsWith("extensions/aisha-dirigent"),
    );

    expect(
      consumers,
      `No runtime consumer drains the workbench queue. Expected a claim/run/complete ` +
        `loop (calls claim_pending_workbench_requests AND complete_workbench_request) ` +
        `in the aisha-dirigent extension (extensions/aisha-dirigent*) or the workbench ` +
        `claim path. The only claim references today are a svc-ai-chat integration test ` +
        `and the generated types barrel — the rail is enqueue-only and dormant, so every ` +
        `enqueued request sits 'pending' until workbenchAdapter times out. ` +
        `extensionDrains=${extensionDrains}.`,
    ).not.toHaveLength(0);
  });

  it("(c) packages/workbench-core has at least one IN-REPO consumer (a file outside the package imports it)", () => {
    const importRe = /\bfrom\s+['"]@aisha\/workbench-core(?:\/[^'"]*)?['"]/;

    const importers = collectAll()
      .filter((f) => !f.startsWith(WORKBENCH_CORE_DIR))
      // A test importing the package is a weak signal; the contract is a PRODUCTION
      // in-repo consumer. Excluding tests also stops this gate matching its own
      // assertion message, which mentions the "@aisha/workbench-core" specifier.
      .filter((f) => !isTestFile(f))
      .filter((f) => referencesIdentifier(fs.readFileSync(f, "utf8"), importRe))
      .map((f) => path.relative(ROOT, f));

    expect(
      importers,
      `packages/workbench-core (@aisha/workbench-core) has NO in-repo consumer — no ` +
        `file outside the package imports it. The shared core the workbench rail is ` +
        `meant to build on is an orphan. Wire the aisha-dirigent extension (or another ` +
        `in-repo module) to import from "@aisha/workbench-core".`,
    ).not.toHaveLength(0);
  });
});
