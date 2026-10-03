/**
 * Duplicate Object Keys Gate
 *
 * Locks out the silent-override class found in config/local-presets.mjs:
 * a JS object literal with a REPEATED key ("later wins") silently shadows the
 * earlier value. In topology/preset SoT files those objects are materialized
 * into .env.local.dev / compose env, so a duplicate key is not a style issue —
 * it swaps a designed value for whatever was pasted last. Concrete incident
 * (NG-9): `RAGNAROK_URL` was defined twice in devEnvDefaults; the later
 * host-facing `http://localhost:9696` overrode the container-facing
 * `http://backend--integration--ragnarok:9696`, so svc-mcp-knowledge's local
 * /ragnarok/* proxy dialed its own loopback and 502'd. Twelve more keys
 * (RABBITMQ_* creds, LANGFUSE_HOST, KEYCLOAK_URL, …) were shadowed the same way.
 *
 * Scope: config/ and scripts/ — the untyped .mjs/.cjs/.js SoT surface.
 * TypeScript files are excluded because tsc already rejects duplicate literal
 * keys (ts1117); plain JS has no such guard, which is exactly why this gate
 * exists. No baseline, no allowlist: the repo is clean and must stay clean.
 *
 * Detection: real AST parse (acorn — already a transitive dev dependency),
 * not regex, so spreads/computed keys/getters are handled correctly:
 *   - computed keys ([expr]) are skipped (not statically comparable)
 *   - spread elements are skipped (merging via spread is legitimate)
 *   - getter/setter pairs for the same name are NOT duplicates
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import * as acorn from "acorn";

const ROOT = path.resolve(__dirname, "../../..");

const SCAN_DIRS = [path.join(ROOT, "config"), path.join(ROOT, "scripts")];

const FILE_EXT = /\.(mjs|cjs|js)$/;

const SKIP_DIR_PARTS = new Set(["node_modules", "dist", "build", "coverage"]);

function collectFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIP_DIR_PARTS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, out);
    else if (FILE_EXT.test(entry.name)) out.push(full);
  }
  return out;
}

interface DuplicateKeyFinding {
  file: string;
  key: string;
  firstLine: number;
  duplicateLine: number;
}

type AcornNode = acorn.Node & Record<string, unknown>;

function walk(node: unknown, visit: (n: AcornNode) => void): void {
  if (!node || typeof (node as AcornNode).type !== "string") return;
  const n = node as AcornNode;
  visit(n);
  for (const key of Object.keys(n)) {
    const value = n[key];
    if (Array.isArray(value)) {
      for (const child of value) walk(child, visit);
    } else if (value && typeof (value as AcornNode).type === "string") {
      walk(value, visit);
    }
  }
}

function lineOf(source: string, offset: number): number {
  return source.slice(0, offset).split("\n").length;
}

function findDuplicateObjectKeys(file: string): DuplicateKeyFinding[] {
  const source = fs.readFileSync(file, "utf8");
  const ast = acorn.parse(source, {
    ecmaVersion: "latest",
    sourceType: "module",
    allowHashBang: true,
  });

  const findings: DuplicateKeyFinding[] = [];

  walk(ast, (node) => {
    if (node.type !== "ObjectExpression") return;
    const properties = node.properties as AcornNode[];
    // key name → { line, kinds } — accessor pairs (get+set) are legal, so track kind.
    const seen = new Map<string, { line: number; kinds: Set<string> }>();

    for (const prop of properties) {
      if (prop.type !== "Property" || prop.computed) continue; // spreads / computed: skip
      const keyNode = prop.key as AcornNode;
      const name =
        keyNode.type === "Identifier"
          ? String(keyNode.name)
          : keyNode.type === "Literal"
            ? String(keyNode.value)
            : null;
      if (name === null) continue;

      const kind = String(prop.kind ?? "init"); // "init" | "get" | "set"
      const existing = seen.get(name);
      if (!existing) {
        seen.set(name, { line: lineOf(source, prop.start), kinds: new Set([kind]) });
        continue;
      }
      // A get+set pair for the same name is valid; any repeat of the SAME kind
      // (or any repeat involving a plain "init") is a silent override.
      const isAccessorPair =
        kind !== "init" && !existing.kinds.has(kind) && !existing.kinds.has("init");
      if (isAccessorPair) {
        existing.kinds.add(kind);
        continue;
      }
      findings.push({
        file: path.relative(ROOT, file),
        key: name,
        firstLine: existing.line,
        duplicateLine: lineOf(source, prop.start),
      });
    }
  });

  return findings;
}

describe("duplicate-object-keys gate", () => {
  const files = SCAN_DIRS.flatMap((dir) => collectFiles(dir));

  it("scans a non-empty JS SoT surface (config/ + scripts/)", () => {
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((f) => f.endsWith(path.join("config", "local-presets.mjs")))).toBe(true);
  });

  it("no object literal in config/ or scripts/ has a duplicate key (silent override)", () => {
    const allFindings: DuplicateKeyFinding[] = [];
    const parseFailures: string[] = [];

    for (const file of files) {
      try {
        allFindings.push(...findDuplicateObjectKeys(file));
      } catch (err) {
        parseFailures.push(
          `${path.relative(ROOT, file)}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Fail loud on unparseable files — a syntax error in a SoT script is never OK,
    // and silently skipping it would blind the gate.
    expect(parseFailures, `Files acorn could not parse:\n${parseFailures.join("\n")}`).toEqual([]);

    const report = allFindings
      .map(
        (f) =>
          `${f.file}:${f.duplicateLine} duplicate key "${f.key}" silently overrides the value from line ${f.firstLine}`,
      )
      .join("\n");

    expect(
      allFindings,
      `Duplicate object keys found (later value silently wins — fix at the SoT, do not allowlist):\n${report}`,
    ).toEqual([]);
  });

  it("detector catches the RAGNAROK_URL incident shape (self-test)", () => {
    // Prove the detector actually detects: the pre-fix local-presets.mjs shape.
    const tmp = path.join(ROOT, "node_modules", ".cache");
    fs.mkdirSync(tmp, { recursive: true });
    const fixture = path.join(tmp, "dup-key-gate-selftest.mjs");
    fs.writeFileSync(
      fixture,
      [
        "export const devEnvDefaults = {",
        '  RAGNAROK_URL: "http://backend--integration--ragnarok:9696",',
        '  OTHER: "x",',
        '  RAGNAROK_URL: "http://localhost:9696",',
        "};",
        // and a legitimate accessor pair + spread that must NOT be flagged:
        "export const ok = { get a() { return 1; }, set a(_v) {}, ...devEnvDefaults };",
        "",
      ].join("\n"),
    );
    try {
      const findings = findDuplicateObjectKeys(fixture);
      expect(findings).toHaveLength(1);
      expect(findings[0].key).toBe("RAGNAROK_URL");
    } finally {
      fs.rmSync(fixture, { force: true });
    }
  });
});
