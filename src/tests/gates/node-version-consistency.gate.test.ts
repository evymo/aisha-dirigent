/**
 * Node 22 consistency Gate
 *
 * The repo standardizes on Node 22 everywhere. This gate locks it so a stray
 * Node 18/20 pin — a Dockerfile base, a CI `setup-node`, a package `engines`
 * field — can't drift back in. The failure mode it prevents: silently running
 * the wrong Node and getting cryptic ABI/syntax errors deep in a build (e.g. an
 * old system default like Node 10).
 *
 * Spouští se přes: npm run test:gates
 * @module
 */
import { describe, test, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = process.cwd();
const read = (p: string): string => readFileSync(p, "utf8");

/** Recurse the repo, skipping node_modules, .git, .claude (gitignored session scratch), and the insight submodule. */
function walkFiles(dir: string, match: (name: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    // Skip non-repo-content dirs (all gitignored): node_modules*, .git, .claude (per-session
    // worktrees of OTHER branches), and trash/ (scratch + vendored node_modules_backup). Scanning
    // them produces false positives from third-party deps + stale checkouts, not this repo's files.
    if (name.startsWith("node_modules") || name === ".git" || name === ".claude" || name === "trash") continue;
    const p = join(dir, name);
    if (p.includes("/packages/insight")) continue; // separate submodule (own repo)
    const st = statSync(p);
    if (st.isDirectory()) walkFiles(p, match, out);
    else if (match(name)) out.push(p);
  }
  return out;
}

const rel = (p: string): string => p.replace(`${ROOT}/`, "");

describe("Node 22 everywhere", () => {
  test(".nvmrc pins 22", () => {
    const p = resolve(ROOT, ".nvmrc");
    expect(existsSync(p), "expected .nvmrc").toBe(true);
    expect(read(p).trim()).toMatch(/^22(?:\.|$)/);
  });

  test("root package.json requires Node >=22 and guards via preinstall", () => {
    const pkg = JSON.parse(read(resolve(ROOT, "package.json")));
    expect(String(pkg.engines?.node ?? "")).toMatch(/>=\s*22/);
    expect(String(pkg.scripts?.preinstall ?? "")).toContain("check-node");
  });

  test("the preinstall guard exists and rejects Node < 22", () => {
    const p = resolve(ROOT, "scripts/check-node.cjs");
    expect(existsSync(p), "expected scripts/check-node.cjs").toBe(true);
    const src = read(p);
    expect(src).toMatch(/<\s*22/);
    expect(src).toMatch(/process\.exit\(1\)/);
  });

  test("every Dockerfile node base is node:22", () => {
    const offenders: string[] = [];
    for (const f of walkFiles(ROOT, (n) => /^Dockerfile/.test(n))) {
      for (const m of read(f).matchAll(/node:(\d+)/g)) {
        if (m[1] !== "22") offenders.push(`${rel(f)}: node:${m[1]}`);
      }
    }
    expect(offenders, `Dockerfiles must use node:22:\n${offenders.join("\n")}`).toEqual([]);
  });

  test("every CI setup-node pins Node 22 (env refs + runner-base comments excluded)", () => {
    const offenders: string[] = [];
    for (const f of walkFiles(ROOT, (n) => /\.ya?ml$/.test(n))) {
      if (!/\.(forgejo|github)\/workflows\//.test(rel(f))) continue;
      read(f)
        .split("\n")
        .forEach((line, i) => {
          const m = line.match(/node-version:\s*'?\[?\s*(\d+)/);
          if (m && m[1] !== "22") offenders.push(`${rel(f)}:${i + 1} → node-version: ${m[1]}`);
        });
    }
    expect(offenders, `CI node-version must be 22:\n${offenders.join("\n")}`).toEqual([]);
  });

  test("no package.json pins engines.node below 22", () => {
    const offenders: string[] = [];
    for (const f of walkFiles(ROOT, (n) => n === "package.json")) {
      let pkg: { engines?: { node?: string } };
      try {
        pkg = JSON.parse(read(f));
      } catch {
        continue;
      }
      const e = pkg.engines?.node;
      if (typeof e === "string") {
        const m = e.match(/(\d+)/);
        if (m && Number(m[1]) < 22) offenders.push(`${rel(f)}: "${e}"`);
      }
    }
    expect(offenders, `engines.node must be >=22:\n${offenders.join("\n")}`).toEqual([]);
  });
});
