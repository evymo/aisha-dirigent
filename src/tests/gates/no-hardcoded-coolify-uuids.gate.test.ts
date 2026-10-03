/**
 * No-Hardcoded-Coolify-UUIDs Gate Test
 *
 * Enforces AISHA's "nothing fixed, everything dynamic" invariant
 * (memory: feedback_bootstrap_creds_generator_pushes.md, feedback_cold_start.md):
 *
 *   Each --wipe rebuilds Coolify applications with fresh UUIDs. Storing
 *   UUIDs in committed code, fallback literals, or `secrets.COOLIFY_UUID_*`
 *   refs would break on every rebuild. UUIDs must be resolved at runtime
 *   from the Coolify API by application NAME via the shared resolver
 *   scripts/lib/coolify-resolve-uuid.{sh,mjs}.
 *
 * What this gate catches:
 *   1. References to `secrets.COOLIFY_UUID_*` in deploy workflows
 *      (.github/workflows/, .forgejo/workflows/).
 *   2. `process.env.COOLIFY_UUID_*` reads with hardcoded fallback literals.
 *   3. Missing shared resolver scripts.
 *
 * Files allowed to mention the legacy pattern (resolver itself + this test):
 *   - scripts/lib/coolify-resolve-uuid.sh
 *   - scripts/lib/coolify-resolve-uuid.mjs
 *   - src/tests/gates/no-hardcoded-coolify-uuids.gate.test.ts (self)
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");

const SECRETS_COOLIFY_UUID_RE = /secrets\.COOLIFY_UUID_[A-Z_]+/g;

const ALLOWED_FILES = new Set([
  "scripts/lib/coolify-resolve-uuid.sh",
  "scripts/lib/coolify-resolve-uuid.mjs",
  "src/tests/gates/no-hardcoded-coolify-uuids.gate.test.ts",
]);

const EXTS = new Set([".sh", ".mjs", ".js", ".ts", ".yml", ".yaml"]);

function walk(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    if (entry.name.startsWith(".") && entry.name !== ".github" && entry.name !== ".forgejo") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (EXTS.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

function readRel(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf-8");
}

function relPath(abs: string): string {
  return path.relative(ROOT, abs).replace(/\\/g, "/");
}

describe("No hardcoded Coolify UUIDs", () => {
  it("deploy workflows do NOT reference secrets.COOLIFY_UUID_*", () => {
    const offenders: string[] = [];
    for (const dir of [".github/workflows", ".forgejo/workflows"]) {
      const files = walk(path.join(ROOT, dir));
      for (const f of files) {
        const content = fs.readFileSync(f, "utf-8");
        const matches = content.match(SECRETS_COOLIFY_UUID_RE) ?? [];
        if (matches.length > 0) {
          offenders.push(`${relPath(f)} (${matches.length} refs)`);
        }
      }
    }
    expect(
      offenders,
      `Workflows must resolve UUIDs dynamically via scripts/lib/coolify-resolve-uuid.sh ` +
        `(by app NAME, not UUID secret). Found:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("no process.env.COOLIFY_UUID_* with hardcoded fallback literals", () => {
    const offenders: string[] = [];
    const files = walk(path.join(ROOT, "scripts"));
    for (const f of files) {
      const rel = relPath(f);
      if (ALLOWED_FILES.has(rel)) continue;
      const content = fs.readFileSync(f, "utf-8");
      const re =
        /process\.env\.COOLIFY_UUID_[A-Z_]+\s*\|\|\s*['"`]([a-z0-9]{20,})['"`]/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        const line = content.slice(0, m.index).split("\n").length;
        offenders.push(`${rel}:${line} fallback "${m[1].slice(0, 12)}..."`);
      }
    }
    expect(
      offenders,
      `Scripts must use resolveAllAishaUuids / resolveUuid from ` +
        `scripts/lib/coolify-resolve-uuid.mjs. Hardcoded UUID fallbacks break on --wipe:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("shared resolver scripts exist (bash + node)", () => {
    expect(fs.existsSync(path.join(ROOT, "scripts/lib/coolify-resolve-uuid.sh"))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, "scripts/lib/coolify-resolve-uuid.mjs"))).toBe(true);
  });

  it("bash resolver exposes coolify_resolve_uuid + --all-aisha CLI", () => {
    const shResolver = readRel("scripts/lib/coolify-resolve-uuid.sh");
    expect(shResolver).toMatch(/coolify_resolve_uuid\s*\(\s*\)/);
    expect(shResolver).toMatch(/--all-aisha/);
  });

  it("node resolver exports resolveUuid + resolveAllAishaUuids", () => {
    const mjsResolver = readRel("scripts/lib/coolify-resolve-uuid.mjs");
    expect(mjsResolver).toMatch(/export\s+async\s+function\s+resolveUuid\b/);
    expect(mjsResolver).toMatch(/export\s+async\s+function\s+resolveAllAishaUuids\b/);
  });

  it("deploy.yml invokes the shared resolver (GitHub mirror)", () => {
    const wf = ".github/workflows/deploy.yml";
    if (!fs.existsSync(path.join(ROOT, wf))) return;
    const content = readRel(wf);
    expect(content).toMatch(/scripts\/lib\/coolify-resolve-uuid\.sh/);
  });

  it("deploy.yml invokes the shared resolver (Forgejo primary)", () => {
    const wf = ".forgejo/workflows/deploy.yml";
    if (!fs.existsSync(path.join(ROOT, wf))) return;
    const content = readRel(wf);
    expect(content).toMatch(/scripts\/lib\/coolify-resolve-uuid\.sh/);
  });
});
