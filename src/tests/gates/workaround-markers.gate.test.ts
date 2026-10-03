/**
 * Workaround Markers Gate
 *
 * Enforces AISHA rule: "Nepoužívat workaroundy ani nedořešené věci."
 *
 * Detects suspicious markers that indicate deferred/hacky solutions:
 *   - `workaround` (vendor bugs OK only if explicitly allowlisted with ref)
 *   - `HACK`, `XXX`, `FIXME` (unfinished work)
 *   - `@ts-ignore`, `@ts-nocheck` (type system bypass)
 *
 * Scope: src/, scripts/, services/, packages/, infra/ — excludes:
 *   - tests (legitimate to describe workarounds)
 *   - archive/, trash/ (legacy)
 *   - node_modules, dist, .aisha/, docs/
 *
 * Enforcement: baseline-driven. Existing debt is captured in
 * `workaround-markers.baseline.json`; new markers fail the gate.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../../..");
const BASELINE_FILE = path.join(__dirname, "workaround-markers.baseline.json");

const SCAN_DIRS = [
  path.join(ROOT, "src"),
  path.join(ROOT, "scripts"),
  path.join(ROOT, "services"),
  path.join(ROOT, "packages"),
  path.join(ROOT, "infra"),
  path.join(ROOT, "supabase"),
];

const FILE_EXT = /\.(ya?ml|sh|ts|tsx|js|jsx|mjs|cjs|sql|json)$/;

const SKIP_DIR_PARTS = new Set([
  "node_modules",
  "dist",
  "build",
  ".aisha",
  "archive",
  "trash",
  "__tests__",
  "tests",
  "test",
  "e2e",
  "fixtures",
  "mocks",
  "playwright-report",
  "test-results",
  "reports",
  ".git",
  "coverage",
  "offline-knowledge",
  "knowledge-extraction",
  "workbench",
]);

// Case-insensitive marker patterns. Each must match the full token with a
// non-alphanum boundary to avoid false positives (e.g. hackathon, fixmenow).
const MARKERS: Array<{ name: string; pattern: RegExp }> = [
  { name: "workaround", pattern: /\bworkaround\b/i },
  { name: "HACK", pattern: /\bHACK\b(?!ER|ATHON|INTOSH)/ },
  { name: "XXX", pattern: /\bXXX\b(?!X)/ },
  { name: "FIXME", pattern: /\bFIXME\b/ },
  { name: "ts-ignore", pattern: /@ts-ignore\b/ },
  { name: "ts-nocheck", pattern: /@ts-nocheck\b/ },
];

// Files that are themselves the gate (allowed to mention markers).
const SELF_REFS = new Set([
  "src/tests/gates/workaround-markers.gate.test.ts",
  "src/tests/gates/code-hygiene.gate.test.ts",
  "src/tests/gates/silent-degradation.gate.test.ts",
  "scripts/gen-workaround-markers-baseline.mjs",
]);

interface Baseline {
  totalMarkers: number;
  totalFiles: number;
  perFile: Record<string, number>;
}

function loadBaseline(): Baseline {
  if (!fs.existsSync(BASELINE_FILE)) {
    return { totalMarkers: 0, totalFiles: 0, perFile: {} };
  }
  return JSON.parse(fs.readFileSync(BASELINE_FILE, "utf-8")) as Baseline;
}

function shouldSkipPath(rel: string): boolean {
  const parts = rel.split(path.sep);
  for (const p of parts) {
    if (SKIP_DIR_PARTS.has(p)) return true;
  }
  // Skip test files by filename convention
  if (/\.(test|spec)\.[a-z]+$/.test(rel)) return true;
  // Skip baselines & generated JSON
  if (/\.baseline\.json$/.test(rel)) return true;
  if (/(package-lock|bun\.lockb)$/.test(rel)) return true;
  return false;
}

function collectFiles(): string[] {
  const out: string[] = [];
  for (const dir of SCAN_DIRS) {
    if (!fs.existsSync(dir)) continue;
    walk(dir, out);
  }
  return out;
}

function walk(dir: string, acc: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(ROOT, full);
    if (shouldSkipPath(rel)) continue;
    if (entry.isDirectory()) {
      walk(full, acc);
    } else if (entry.isFile() && FILE_EXT.test(entry.name)) {
      acc.push(full);
    }
  }
}

function countMarkersInFile(absPath: string): number {
  const rel = path.relative(ROOT, absPath);
  if (SELF_REFS.has(rel)) return 0;
  let content: string;
  try {
    content = fs.readFileSync(absPath, "utf-8");
  } catch {
    return 0;
  }
  let total = 0;
  const lines = content.split("\n");
  for (const line of lines) {
    for (const { pattern } of MARKERS) {
      // Global count per line
      const matches = line.match(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g"));
      if (matches) total += matches.length;
    }
  }
  return total;
}

describe("Workaround Markers Gate", () => {
  it("scans a non-trivial set of source files", () => {
    const files = collectFiles();
    expect(files.length).toBeGreaterThan(100);
  });

  it("no new workaround/HACK/FIXME/XXX/ts-ignore markers beyond baseline", () => {
    const files = collectFiles();
    const baseline = loadBaseline();

    const current: Record<string, number> = {};
    let totalCurrent = 0;
    for (const abs of files) {
      const count = countMarkersInFile(abs);
      if (count > 0) {
        const rel = path.relative(ROOT, abs);
        current[rel] = count;
        totalCurrent += count;
      }
    }

    const newFiles: string[] = [];
    const grownFiles: Array<{ file: string; was: number; now: number }> = [];
    for (const [rel, count] of Object.entries(current)) {
      const was = baseline.perFile[rel] ?? 0;
      if (was === 0) {
        newFiles.push(`${rel} (+${count})`);
      } else if (count > was) {
        grownFiles.push({ file: rel, was, now: count });
      }
    }

    const problems: string[] = [];
    if (newFiles.length) {
      problems.push(
        `Nové soubory s workaround markery (${newFiles.length}):\n` +
          newFiles.slice(0, 20).map((x) => `  - ${x}`).join("\n"),
      );
    }
    if (grownFiles.length) {
      problems.push(
        `Soubory s rostoucím počtem markerů (${grownFiles.length}):\n` +
          grownFiles
            .slice(0, 20)
            .map((x) => `  - ${x.file}: ${x.was} → ${x.now}`)
            .join("\n"),
      );
    }

    if (problems.length) {
      console.warn(
        `⚠️  Workaround baseline (current=${totalCurrent}/${Object.keys(current).length}, baseline=${baseline.totalMarkers}/${baseline.totalFiles}):\n${problems.join("\n\n")}`,
      );
    }

    expect(
      problems.join("\n\n") || "ok",
      `Workaroundy nejsou povoleny. Odstraň je, nebo pokud jde o nutný vendor bug, \n` +
        `přidej soubor + důvod do baseline + commit reference na vendor issue.\n\n` +
        problems.join("\n\n"),
    ).toBe("ok");

    // Monotonic decrease on total count.
    expect(
      totalCurrent,
      `Total worktree marker count (${totalCurrent}) exceeds baseline (${baseline.totalMarkers}).`,
    ).toBeLessThanOrEqual(baseline.totalMarkers);
  });
});
