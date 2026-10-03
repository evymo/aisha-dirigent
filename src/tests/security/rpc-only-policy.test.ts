import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function walkFiles(dir: string, predicate: (p: string) => boolean): string[] {
  const out: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(p, predicate));
      continue;
    }

    if (entry.isFile() && predicate(p)) out.push(p);
  }

  return out;
}

function findMatchesWithLineNumbers(text: string, re: RegExp) {
  const matches: Array<{ index: number; match: string; line: number }> = [];
  const global = re.global ? re : new RegExp(re.source, `${re.flags}g`);

  for (;;) {
    const m = global.exec(text);
    if (!m) break;

    const index = m.index;
    const before = text.slice(0, index);
    const line = before.split("\n").length;

    matches.push({ index, match: m[0], line });
  }

  return matches;
}

function rel(p: string) {
  return path.relative(process.cwd(), p);
}

describe("Security policy: RPC-only + data minimization", () => {
  it("forbids direct .from() access to sensitive data tables in src/", () => {
    const srcDir = path.join(process.cwd(), "src");

    const appFiles = walkFiles(srcDir, (p) => {
      if (!/\.(ts|tsx|js|jsx)$/.test(p)) return false;
      if (p.includes(`${path.sep}src${path.sep}tests${path.sep}`)) return false;
      return true;
    });

    const directPhiFrom = /\.from\(\s*['"](health_check_ins|lab_results|member_health_documents)['"]\s*\)/g;

    const violations: Array<{ file: string; line: number; snippet: string }> = [];

    for (const file of appFiles) {
      const text = fs.readFileSync(file, "utf8");
      const matches = findMatchesWithLineNumbers(text, directPhiFrom);

      for (const m of matches) {
        violations.push({ file: rel(file), line: m.line, snippet: m.match });
      }
    }

    expect(
      violations,
      `Found direct sensitive data table access (must use audited supabase.rpc instead):\n${violations
        .map((v) => `- ${v.file}:${v.line}  ${v.snippet}`)
        .join("\n")}`
    ).toEqual([]);
  });

  it("forbids select-all (\"*\") and implicit select() in src/", () => {
    const srcDir = path.join(process.cwd(), "src");

    const appFiles = walkFiles(srcDir, (p) => {
      if (!/\.(ts|tsx|js|jsx)$/.test(p)) return false;
      if (p.includes(`${path.sep}src${path.sep}tests${path.sep}`)) return false;
      return true;
    });

    const selectStar = /\.select\(\s*['"]\*['"]\s*\)/g;
    const selectImplicit = /\.select\(\s*\)/g;

    /**
     * DOM APIs like textarea.select() or inputRef.select() are harmless —
     * GrapesJS layer API (layer.select()) is also safe.
     * Filter them out by checking the preceding context on the same line.
     */
    const isDomSelectCall = (text: string, matchIndex: number): boolean => {
      const lineStart = text.lastIndexOf("\n", matchIndex) + 1;
      const before = text.slice(lineStart, matchIndex);
      // DOM element.select()   — e.g. textarea.select(), inputRef.current.select()
      // GrapesJS layer.select() / component.select()
      return /\b(textarea|input|inputRef|el|element|ref|layer|component)(\.current)?\s*$/i.test(before);
    };

    const violations: Array<{ file: string; line: number; snippet: string }> = [];

    for (const file of appFiles) {
      const text = fs.readFileSync(file, "utf8");

      for (const m of findMatchesWithLineNumbers(text, selectStar)) {
        violations.push({ file: rel(file), line: m.line, snippet: m.match });
      }

      for (const m of findMatchesWithLineNumbers(text, selectImplicit)) {
        if (isDomSelectCall(text, m.index)) continue;
        violations.push({ file: rel(file), line: m.line, snippet: m.match });
      }
    }

    expect(
      violations,
      `Found select-all usage (must whitelist explicit columns):\n${violations
        .map((v) => `- ${v.file}:${v.line}  ${v.snippet}`)
        .join("\n")}`
    ).toEqual([]);
  });
});
