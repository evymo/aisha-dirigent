/**
 * Gate (remediation SVC-01): services must not each carry a divergent, hand-rolled
 * PostgREST client. There is ONE PostgREST call contract (rpcService / rpcUser) and
 * every service must consume the SAME implementation.
 *
 * Why this exists:
 *   Each service's `postgrest.ts` (under services/<svc>/src) re-implements the same job — POST to
 *   `${postgrestUrl}/rpc/<fn>` with a service/user bearer token, timeout, error
 *   handling. When every service copies its own variant, the copies DRIFT: some use
 *   a 5s timeout, some 30s, some AbortSignal.timeout(), some a manual combined
 *   AbortController, some set `Accept`, some don't, some return `T` vs `T | null`,
 *   some pass `opts`/budget signals and some can't. That is a DRY / single-source-of-
 *   truth violation (CLAUDE.md "DRY", "Service-Oriented Design": communicate through
 *   ONE well-defined interface) AND a latent correctness/security surface: a fix to
 *   the client (auth header, timeout, error swallowing) has to be applied N times and
 *   is guaranteed to be missed somewhere.
 *
 * CONTRACT (post-fix — this gate is green when EITHER holds):
 *   (a) A shared client exists and every `postgrest.ts` is a THIN RE-EXPORT of it
 *       (no hand-rolled `fetch(...)`, just import/export from a shared module), OR
 *   (b) The number of DISTINCT hand-rolled implementations — each file's content
 *       hashed after normalizing away comments and whitespace — is <= 1 (a single
 *       canonical implementation, byte-for-byte, copied everywhere).
 *
 * Both collapse to the same assertion: the count of DISTINCT non-re-export
 * implementations must be <= 1.
 *   - Fix path (a): every file becomes a re-export -> 0 distinct impls -> green.
 *   - Fix path (b): one canonical impl copied verbatim -> 1 distinct impl -> green.
 *
 * KNOWN-RED at authoring time (branch feat/remediation):
 *   18 `postgrest.ts` files under services/, all hand-rolled (each calls `fetch`),
 *   collapsing to 10 DISTINCT normalized implementations, and NO shared client
 *   package/module exists. instancesFlagged = 10 (the distinct-implementation count).
 *
 * Do NOT resolve this by allowlisting the divergent files — extract ONE shared
 * client (e.g. a workspace package) and make each service re-export it, or converge
 * every copy on a single canonical file.
 */
import { describe, test, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const ROOT = process.cwd();
const SERVICES_DIR = join(ROOT, "services");

/** Recursively collect every file named `postgrest.ts` under services/. */
function findPostgrestFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === "dist" || entry === "build") continue;
      findPostgrestFiles(full, acc);
    } else if (entry === "postgrest.ts") {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Normalize a source file so two implementations that differ only in comments and
 * whitespace hash identically. Strips block + line comments, collapses all runs of
 * whitespace to a single space, and trims.
 */
function normalize(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedHash(src: string): string {
  return createHash("sha256").update(normalize(src)).digest("hex").slice(0, 12);
}

/**
 * A file is a THIN RE-EXPORT of a shared client if it does NOT hand-roll the client
 * (no `fetch(` call) and its normalized body is only import/export plumbing that
 * pulls the client in from another module. Such files carry no implementation of
 * their own, so they never count toward implementation divergence.
 */
function isThinReExport(src: string): boolean {
  const norm = normalize(src);
  if (/\bfetch\s*\(/.test(norm)) return false; // hand-rolls the request -> not thin
  // Must actually re-export / import the client surface from somewhere.
  return /\b(import|export)\b[\s\S]*\bfrom\b/.test(norm);
}

const postgrestFiles = existsSync(SERVICES_DIR) ? findPostgrestFiles(SERVICES_DIR) : [];

interface Impl {
  file: string; // repo-relative
  hash: string;
  thin: boolean;
}

function classify(): Impl[] {
  return postgrestFiles.map((f) => {
    const src = readFileSync(f, "utf-8");
    return {
      file: f.slice(ROOT.length + 1),
      hash: normalizedHash(src),
      thin: isThinReExport(src),
    };
  });
}

describe("SVC-01: services consume ONE PostgREST client (no divergent hand-rolled copies)", () => {
  test("<= 1 distinct hand-rolled postgrest.ts implementation across services", () => {
    // Sanity: the walk must find the files it is meant to police.
    expect(
      postgrestFiles.length,
      "expected to find services/**/postgrest.ts files to police",
    ).toBeGreaterThan(0);

    const impls = classify();

    // Hand-rolled (non-re-export) implementations, grouped by normalized-content hash.
    const byHash = new Map<string, string[]>();
    for (const impl of impls) {
      if (impl.thin) continue; // thin re-exports carry no implementation
      const arr = byHash.get(impl.hash) ?? [];
      arr.push(impl.file);
      byHash.set(impl.hash, arr);
    }

    const distinctImplementations = byHash.size;

    const report = [...byHash.entries()]
      .map(
        ([hash, files]) =>
          `  [${hash}] x${files.length}: ${files.join(", ")}`,
      )
      .join("\n");

    expect(
      distinctImplementations,
      `Found ${distinctImplementations} DISTINCT hand-rolled PostgREST client ` +
        `implementations across ${postgrestFiles.length} services/**/postgrest.ts ` +
        `files. Services must share ONE client: extract a shared module and make ` +
        `each postgrest.ts a thin re-export, or converge every copy on a single ` +
        `canonical implementation (<= 1 distinct).\nDistinct implementations:\n${report}`,
    ).toBeLessThanOrEqual(1);
  });
});
