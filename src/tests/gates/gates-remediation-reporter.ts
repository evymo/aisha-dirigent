/**
 * Custom Vitest reporter — actionable remediation footer for gate failures.
 *
 * Every gate that goes red prints, once per failing file, a uniform block:
 *   - the gate file path,
 *   - the exact command to re-run THAT gate in isolation,
 *   - the fix — extracted from the gate's own top-of-file docstring when it
 *     documents one (lines mentioning fix / repair / regenerate / `npm run …`),
 *     else a pointer to read that docstring.
 *
 * Why a reporter and not 276 hand-edited messages: the goal ("a failing test
 * should say what to do, so nobody re-derives it") is a cross-cutting concern.
 * One reporter delivers it for every current and future gate at zero per-gate
 * cost and zero risk to gate logic. Gates that ALSO embed a tailored message in
 * the assertion (e.g. aitg-inf-01-supply-chain) still show it — this footer is
 * the universal baseline, not a replacement.
 *
 * Wired in vitest.gates.config.ts — `reporters: ["default", "./…/gates-json-reporter.ts", "./…/gates-remediation-reporter.ts"]`
 *
 * @module
 */

import fs from "fs";
import path from "path";
import type { Reporter, File, Task } from "vitest";

/** Recursively flatten the vitest Task tree into leaf test nodes. */
function flattenTasks(tasks: Task[]): Task[] {
  const result: Task[] = [];
  for (const task of tasks) {
    if (task.type === "suite" && "tasks" in task) {
      result.push(...flattenTasks(task.tasks));
    } else {
      result.push(task);
    }
  }
  return result;
}

/**
 * Pull the leading block comment (`/** … *\/`) from a gate's source and surface
 * any line that reads like remediation. Falls back to the first prose lines.
 */
function extractFix(filepath: string): string[] {
  let src = "";
  try {
    src = fs.readFileSync(filepath, "utf8");
  } catch {
    return [];
  }
  const block = src.match(/\/\*\*([\s\S]*?)\*\//);
  if (!block) return [];
  const lines = block[1]
    .split("\n")
    .map((l) => l.replace(/^\s*\*\s?/, "").trimEnd())
    .filter((l) => l.trim().length > 0);

  const FIX_RE = /(how to fix|to fix|repair|regenerate|re-?run|baseline|npm run |node scripts\/|fix a failure)/i;
  const hits: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (FIX_RE.test(lines[i])) {
      // include the matching line plus a couple of continuation lines (steps)
      for (let j = i; j < Math.min(i + 4, lines.length); j++) {
        if (!hits.includes(lines[j])) hits.push(lines[j]);
      }
    }
    if (hits.length >= 8) break;
  }
  if (hits.length) return hits;
  // no explicit remediation keyword — show the first few docstring lines as context
  return lines.slice(0, 3);
}

const RULE = "─".repeat(72);

export default class GatesRemediationReporter implements Reporter {
  onFinished(files?: File[]): void {
    if (!files?.length) return;

    // Collect failing tests grouped by file (dedupe — one footer per gate file).
    const byFile = new Map<string, { rel: string; tests: string[] }>();
    for (const file of files) {
      for (const task of flattenTasks(file.tasks)) {
        if (task.type !== "test" || task.result?.state !== "fail") continue;
        const key = file.filepath;
        if (!byFile.has(key)) {
          byFile.set(key, {
            rel: path.relative(process.cwd(), file.filepath),
            tests: [],
          });
        }
        byFile.get(key)!.tests.push(task.name);
      }
    }
    if (byFile.size === 0) return;

    const out: string[] = ["", RULE, " ❌ GATE FAILED — how to fix", RULE];
    for (const [filepath, { rel, tests }] of byFile) {
      const fix = extractFix(filepath);
      out.push(` Gate:    ${rel}`);
      out.push(` Failed:  ${tests.slice(0, 5).join(" · ")}${tests.length > 5 ? ` (+${tests.length - 5} more)` : ""}`);
      // ⛔ PŘES RUNNER, NE PŘES `npx`. Doporučený příkaz musí nést tytéž
      // pojistky jako sada: podlahu verze Node, stráž ticha a override
      // falešného RPC timeoutu. Naměřeno 2026-08-31: `npx` se na zastaralém
      // PATH přeložil na 6.13.4 a tenhle doslovný příkaz odpověděl
      // „Unexpected string" — návod k opravě sám nešel spustit.
      // Filtr na jeden soubor funguje od zavedení `--default-dir`.
      out.push(
        ` Re-run:  node scripts/test/run-vitest.mjs --config vitest.gates.config.ts --default-dir src/tests/gates/ "${rel}"`,
      );
      if (fix.length) {
        out.push(` Fix:     ${fix[0]}`);
        for (const line of fix.slice(1)) out.push(`          ${line}`);
      } else {
        out.push(` Fix:     read the top-of-file docstring in ${rel} — it documents the invariant + repair.`);
      }
      out.push(` Detail:  the assertion message above lists the specific offenders.`);
      out.push(RULE);
    }
    console.error(out.join("\n"));
  }
}
