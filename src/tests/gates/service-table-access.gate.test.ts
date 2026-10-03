/**
 * v2 Service Table-Access Gate Test
 *
 * Enforces RPC-only architecture in v2 microservices:
 *   1. NO direct .from(table) calls in services/svc-(star)/src/ —
 *      all data access goes through rpcService() / rpcUser() helpers.
 *   2. NO .select(star) — list explicit columns (also checked in SQL SoT).
 *
 * Replaces the legacy gate that audited trash/legacy-archive/edge-functions-reference/
 * against an allowlist of tables. In v2 there is NO allowlist — RPC-only is absolute.
 *
 * Run: npm run test:gates -- src/tests/gates/service-table-access.gate.test.ts
 *
 * @module
 */
import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import { isTrackedService } from "./lib/tracked-services";

const ROOT = path.resolve(__dirname, "../../..");
const SERVICES_DIR = path.join(ROOT, "services");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TableAccess {
  table: string;
  file: string;
  line: number;
}

/** Patterns that look like `.from()` but are NOT Supabase/DB table access. */
const FALSE_POSITIVE_PATTERNS = [
  /Array\.from/,
  /Uint8Array\.from/,
  /Buffer\.from/,
  /Object\.from/,
  /FormData\.from/,
  /Promise\.from/,
  /\.from\s*\(\s*\d/,     // numeric argument
  /\.from\s*\(\s*\[/,     // array literal
  /\.from\s*\(\s*new\s/,  // constructor argument
  /\.from\s*\(\s*\{/,     // object literal (e.g. Date)
];

function isStorageBucketAccess(line: string): boolean {
  // MinIO / S3 bucket access via `.storage.from("bucket")` is allowed.
  return /\.storage\.from\(/.test(line);
}

function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
}

function scanServicesTableAccess(): TableAccess[] {
  const accesses: TableAccess[] = [];

  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        walk(fullPath);
        continue;
      }
      if (!(entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) continue;

      const lines = fs.readFileSync(fullPath, "utf-8").split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (isCommentLine(line)) continue;
        if (FALSE_POSITIVE_PATTERNS.some((p) => p.test(line))) continue;
        if (isStorageBucketAccess(line)) continue;

        const match = line.match(/\.from\(\s*["']([a-z_][a-z0-9_]*)["']/);
        if (match) {
          accesses.push({
            table: match[1],
            file: path.relative(ROOT, fullPath),
            line: i + 1,
          });
        }
      }
    }
  };

  // Only scan services that have a src/ directory.
  if (fs.existsSync(SERVICES_DIR)) {
    for (const svc of fs.readdirSync(SERVICES_DIR, { withFileTypes: true })) {
      if (!svc.isDirectory() || svc.name.startsWith(".")) continue;
      // Untracked leftovers are residue, not services — see lib/tracked-services.ts.
      if (!isTrackedService(svc.name)) continue;
      const svcSrc = path.join(SERVICES_DIR, svc.name, "src");
      if (fs.existsSync(svcSrc)) walk(svcSrc);
    }
  }
  return accesses;
}

interface SelectStarViolation {
  file: string;
  line: number;
}

function findSelectStarViolations(): SelectStarViolation[] {
  const violations: SelectStarViolation[] = [];

  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        walk(fullPath);
        continue;
      }
      if (!(entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) continue;
      const lines = fs.readFileSync(fullPath, "utf-8").split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (isCommentLine(lines[i])) continue;
        if (/\.select\(\s*["']\*["']\s*\)/.test(lines[i])) {
          violations.push({ file: path.relative(ROOT, fullPath), line: i + 1 });
        }
      }
    }
  };

  if (fs.existsSync(SERVICES_DIR)) {
    for (const svc of fs.readdirSync(SERVICES_DIR, { withFileTypes: true })) {
      if (!svc.isDirectory() || svc.name.startsWith(".")) continue;
      // Untracked leftovers are residue, not services — see lib/tracked-services.ts.
      if (!isTrackedService(svc.name)) continue;
      const svcSrc = path.join(SERVICES_DIR, svc.name, "src");
      if (fs.existsSync(svcSrc)) walk(svcSrc);
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("v2 Service Table Access Governance (RPC-only)", () => {
  let tableAccesses: TableAccess[];

  beforeAll(() => {
    tableAccesses = scanServicesTableAccess();
  });

  it("services/ directory exists", () => {
    expect(fs.existsSync(SERVICES_DIR)).toBe(true);
  });

  it("no v2 service performs direct .from(table) access (RPC-only)", () => {
    const violations = tableAccesses.map(
      (a) => `${a.file}:${a.line} → .from("${a.table}")`,
    );
    expect(
      violations,
      `v2 services MUST use rpcService() / rpcUser() exclusively.\n` +
        `Direct .from("table") calls found:\n${violations.join("\n")}\n\n` +
        `Move the access to a PostgREST RPC function and call it via the helper.`,
    ).toHaveLength(0);
  });

  it("no v2 service uses .select('*')", () => {
    const violations = findSelectStarViolations();
    expect(
      violations,
      `v2 services using .select("*") (must list explicit columns):\n` +
        violations.map((v) => `  ${v.file}:${v.line}`).join("\n"),
    ).toHaveLength(0);
  });
});
