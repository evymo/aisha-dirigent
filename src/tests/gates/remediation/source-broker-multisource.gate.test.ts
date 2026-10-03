/**
 * Gate (remediation ENT-01-multi-source): svc-source-broker batch sync must be
 * MULTI-SOURCE, not pinned to a single hardcoded data source.
 *
 * Contract (two parts):
 *  1. No source file under services/svc-source-broker/src may hardcode a single
 *     source identity as `const SOURCE_SLUG = '<literal>'`. The broker must
 *     enumerate approved sources at runtime (per-source granularity) instead of
 *     baking one slug into the scheduler. A hardcoded slug means every other
 *     approved source is silently never synced.
 *  2. The enumerating RPC that supplies the approved-source list MUST exist as a
 *     SQL function source-of-truth file:
 *       aisha/db/sql/functions/audience_list_approved_sources.sql
 *     A missing RPC file means the multi-source path cannot be wired at all
 *     (PostgREST would resolve the name to nothing → PGRST202 at runtime).
 *
 * KNOWN-RED at authoring time (branch feat/remediation): scheduler.ts:86
 * hardcodes `const SOURCE_SLUG = 'source-api';`, and
 * aisha/db/sql/functions/audience_list_approved_sources.sql does not exist.
 *
 * After the fix (drive sync from the approved-source list returned by
 * audience_list_approved_sources, remove the hardcoded constant, and add the SQL
 * function file) this gate goes green. Do NOT weaken the gate — remove the
 * hardcoded slug and add the RPC at the source of truth.
 *
 * Generalization: part 1 scans the ENTIRE svc-source-broker/src tree (not just
 * scheduler.ts), so any additional single-source-slug hardcode is also caught.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SRC_DIR = "services/svc-source-broker/src";
const RPC_FILE = "aisha/db/sql/functions/audience_list_approved_sources.sql";

/** Strip `//` and block comments so a commented-out mention doesn't count. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

/** Recursively list *.ts source files under a directory (skips *.d.ts). */
function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      out.push(...tsFiles(rel));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      out.push(rel);
    }
  }
  return out;
}

/**
 * Find every hardcoded single-source slug of the shape
 *   const SOURCE_SLUG = '<literal>'   (any string literal, single/double quote)
 * across the broker src tree, remembering file + line for the failure message.
 */
function findHardcodedSourceSlugs(): string[] {
  const re = /\bconst\s+SOURCE_SLUG\s*=\s*['"][^'"]+['"]/;
  const hits: string[] = [];
  for (const file of tsFiles(SRC_DIR)) {
    const lines = stripComments(readFileSync(join(ROOT, file), "utf-8")).split("\n");
    lines.forEach((line, i) => {
      if (re.test(line)) hits.push(`${file}:${i + 1}  ${line.trim()}`);
    });
  }
  return hits;
}

describe("svc-source-broker multi-source contract (ENT-01)", () => {
  test("no source file hardcodes a single `const SOURCE_SLUG = '…'`", () => {
    const hits = findHardcodedSourceSlugs();
    expect(
      hits,
      `svc-source-broker must enumerate approved sources, not hardcode one slug.\n` +
        `Hardcoded SOURCE_SLUG found:\n  ${hits.join("\n  ")}`,
    ).toEqual([]);
  });

  test("the enumerating RPC audience_list_approved_sources SQL function file exists", () => {
    expect(
      existsSync(join(ROOT, RPC_FILE)),
      `expected multi-source enumerating RPC source-of-truth file to exist: ${RPC_FILE}`,
    ).toBe(true);
  });
});
