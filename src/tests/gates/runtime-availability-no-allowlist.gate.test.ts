/**
 * E0 — capability-availability, NOT allow-list  (anti-allow-list guard gate).
 *
 * THE GATE IS THE SPEC. The owner stated it twice: there must be NO maintained
 * permit-list anywhere in code or seed. A capability (runtime / provider / tool /
 * CLI) is usable iff it is REGISTERED + ENABLED (its OWN `is_enabled` state) —
 * availability is DERIVED from a per-entity registry, mirroring how
 * `ai_provider_registry` already works (the resolver filters by `is_enabled AND
 * healthy`, never by membership in a list of names).
 *
 * A *per-entity* `is_enabled` column or a `supports_X` capability flag is fine —
 * the entity governs itself, and adding a new runtime is a self-registering
 * INSERT with nothing to maintain. What is FORBIDDEN is a separate table / row /
 * seed whose VALUE is a *list of permitted names* (e.g. a jsonb array of allowed
 * runtimes checked with `@>`, an `allowed_runtimes` column, an `allow_internet` /
 * `allow_tools` flag-set you must edit when adding a capability). Those are both
 * a security hole and a hardcoded thing that must live nowhere.
 *
 * This is a STATIC gate (reads files only, no DB / network — safe for pre-push).
 * It scans `aisha/db/` (SQL + seed) and `services/` for any maintained
 * permit-list, asserts the `governance_flags` allow-list subsystem does NOT
 * exist, and asserts the per-entity `ai_runtime_registry` seed inserts one row
 * per runtime (per-entity self-governance), never a single list value.
 *
 * Pairs with `execution-decision-sot.gate.test.ts` (the three-axis SoT) — that
 * gate locks WHAT a decision is; this gate locks that AVAILABILITY for that
 * decision is derived, not allow-listed.
 *
 * @module
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, relative, extname } from "node:path";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
// Scan real CODE, not comments. A comment legitimately DOCUMENTS the absence of
// the allow-list shape (e.g. "availability is derived, not an allow_runtime
// array"); penalising that prose would forbid explaining the design. Strip block
// comments (preserving line numbers) + ext-appropriate line comments first.
function stripComments(content: string, ext: string): string {
  let s = content.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const lineRe = ext === ".sql" ? /--.*$/ : /\/\/.*$/;
  s = s
    .split("\n")
    .map((l) => l.replace(lineRe, ""))
    .join("\n");
  return s;
}
const codeOf = (rel: string) => stripComments(read(rel), extname(rel));

// ───────────────────────────────────────────────────────────────────────────
// Scan surface
// ───────────────────────────────────────────────────────────────────────────

/** Trees that may NOT contain a maintained permit-list. */
const SCAN_DIRS = ["aisha/db", "services"];
const SCAN_EXTENSIONS = new Set([".sql", ".ts", ".tsx", ".mjs", ".js"]);

interface ScannedFile {
  relPath: string;
  content: string;
}

/** True for trees we never audit (deps, build output, this gate's own source). */
function isSkippable(relPath: string): boolean {
  return (
    relPath.includes("/node_modules/") ||
    relPath.includes("/dist/") ||
    relPath.includes("/.git/") ||
    // This gate file names the forbidden patterns as string literals; never
    // let the scanner flag its own spec. (Match by basename suffix so the path
    // separator is OS-agnostic.)
    relPath.endsWith("runtime-availability-no-allowlist.gate.test.ts")
  );
}

/** Recursively collect SQL + TS/JS files under a tree. Race-safe (parallel gates). */
function collectFiles(absDir: string, out: ScannedFile[] = []): ScannedFile[] {
  if (!existsSync(absDir)) return out;
  let entries: import("node:fs").Dirent<string>[];
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return out; // dir disappeared between stat and read (parallel gate race)
  }
  for (const entry of entries) {
    const full = join(absDir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        entry.name === ".git" ||
        entry.name.startsWith(".")
      )
        continue;
      collectFiles(full, out);
    } else if (SCAN_EXTENSIONS.has(extname(entry.name))) {
      const relPath = relative(ROOT, full);
      if (isSkippable(relPath)) continue;
      // Skip ephemeral chamber files created by parallel gate tests (race-safe).
      if (entry.name.startsWith("__aitg_") && entry.name.endsWith("__.ts")) continue;
      let content: string;
      try {
        content = stripComments(readFileSync(full, "utf-8"), extname(entry.name));
      } catch {
        continue; // file vanished between readdir and read — skip
      }
      out.push({ relPath, content });
    }
  }
  return out;
}

const SCANNED: ScannedFile[] = SCAN_DIRS.flatMap((d) =>
  collectFiles(join(ROOT, d)),
);

// ───────────────────────────────────────────────────────────────────────────
// Forbidden permit-list signatures.
//
// These are NOT an allow-list — they are the negative space: patterns that must
// NOT appear. Each describes a maintained LIST of permitted names (the thing the
// owner forbade), as opposed to a per-entity `is_enabled` / `supports_X` flag
// (which is allowed and not matched here).
// ───────────────────────────────────────────────────────────────────────────

interface ForbiddenPattern {
  /** Human-readable name of the anti-pattern (for the failure message). */
  label: string;
  /** Matches a maintained list of permitted names. */
  regex: RegExp;
  /** Why this is an allow-list and what the correct derived model is. */
  remedy: string;
}

const FORBIDDEN_PATTERNS: ForbiddenPattern[] = [
  {
    label: "allow_runtime / allowed_runtimes permit-list",
    // Column, flag_key string literal, jsonb key, or variable holding a list of
    // permitted runtime names. Catches `allow_runtime`, `allowed_runtimes`,
    // `v_allowed_runtimes`, `'allow_runtime'`, etc.
    regex: /\ballow(?:ed)?_runtimes?\b/i,
    remedy:
      "runtime availability must be DERIVED from ai_runtime_registry.is_enabled (per-entity), not a maintained list of permitted runtime names",
  },
  {
    label: "allowed_providers permit-list",
    regex: /\ballowed_providers?\b/i,
    remedy:
      "provider availability is already DERIVED from ai_provider_registry (is_enabled AND healthy) — do not add a separate list of permitted providers",
  },
  {
    label: "allow_internet / allow_tools / allow_write governance flag-set",
    // The env-toggle-as-row flag-set the governance_flags subsystem introduced.
    // Capability MATCH must be derived from the chosen runtime/provider's
    // declared capability (e.g. supports_tool_use) checked against the clow's
    // needs (needs_internet/needs_tools/needs_write) — not a permission flag-set.
    regex: /\ballow_(?:internet|tools|write)\b/i,
    remedy:
      "capability match is DERIVED: check the clow's needs_* against the chosen runtime/provider's declared capability (supports_tool_use, etc.); risk → threshold governs human approval, not an allow_* flag-set",
  },
  {
    label: "jsonb array of names used for permission (membership-test allow-list)",
    // e.g. allowed @> to_jsonb(v_runtime)  /  '["openclaw","workflow"]'::jsonb
    // used as a permit set. The `@>` containment check over a names-array is the
    // tell-tale of an allow-list (vs. a per-row is_enabled lookup).
    regex: /@>\s*to_jsonb\s*\(\s*\w*runtime\w*\s*\)/i,
    remedy:
      "membership-testing a jsonb array of permitted runtime names IS an allow-list; replace with a per-entity ai_runtime_registry lookup (registered + is_enabled + adapter present)",
  },
];

// ───────────────────────────────────────────────────────────────────────────
// The governance_flags allow-list subsystem — must NOT exist.
//
// This subsystem is the concrete embodiment of the forbidden pattern: a
// `governance_flags` table whose rows carry `allow_runtime` (a jsonb array of
// permitted runtimes) resolved by `fn_resolve_governance_flag` and membership-
// tested in `fn_admit_clow`. Governance is POLICY (spend thresholds in
// ai_spend_policies + computed risk → threshold), not a permit-list. Every
// artifact below must be deleted for this gate to pass.
// ───────────────────────────────────────────────────────────────────────────

const GOVERNANCE_FLAG_ARTIFACTS = [
  "aisha/db/sql/tables/governance_flags.sql",
  "aisha/db/seed/core/18_governance_flags.sql",
  "aisha/db/sql/functions/fn_resolve_governance_flag.sql",
  "aisha/db/sql/functions/set_governance_flag_audited.sql",
  "aisha/db/sql/policies/admin_staff_manage_governance_flags.sql",
  "aisha/db/sql/indexes/idx_governance_flags_lookup.sql",
];

// ───────────────────────────────────────────────────────────────────────────
// The per-entity runtime registry — the CORRECT model.
// ───────────────────────────────────────────────────────────────────────────

const RUNTIME_REGISTRY_TABLE = "aisha/db/sql/tables/ai_runtime_registry.sql";

/** Locate the ai_runtime_registry data seed wherever it lands under seed/core. */
function findRuntimeRegistrySeed(): string | null {
  const seedDir = join(ROOT, "aisha/db/seed/core");
  if (!existsSync(seedDir)) return null;
  let names: string[];
  try {
    names = readdirSync(seedDir);
  } catch {
    return null;
  }
  for (const name of names) {
    if (!name.endsWith(".sql")) continue;
    let content: string;
    try {
      content = readFileSync(join(seedDir, name), "utf-8");
    } catch {
      continue;
    }
    if (/INSERT\s+INTO\s+public\.ai_runtime_registry/i.test(content)) {
      return join("aisha/db/seed/core", name);
    }
  }
  return null;
}

/**
 * The canonical runtime set — DERIVED from the AishaRuntimeSchema source of truth
 * (reflection/decision.ts), never a hand-kept mirror. This gate's whole point is "no
 * maintained allow-list", so its own reference list must come from the source so it can
 * never drift behind it (it previously hard-coded 6 and silently missed 'workbench').
 */
const CANONICAL_RUNTIMES = (() => {
  const src = read("services/svc-ai-chat/src/reflection/decision.ts");
  const block = src.match(/AishaRuntimeSchema\s*=\s*z\.enum\(\[([\s\S]*?)\]\)/);
  if (!block) throw new Error("AishaRuntimeSchema z.enum([...]) not found in decision.ts");
  return [...block[1].matchAll(/^\s*['"]([a-z_]+)['"]/gm)].map((m) => m[1]);
})();

describe("E0 — capability-availability, not allow-list", () => {
  // ─────────────────────────────────────────────────────────────────────────
  // 1. No maintained permit-list anywhere in aisha/db/ or services/
  // ─────────────────────────────────────────────────────────────────────────
  describe("no maintained permit-list in aisha/db or services", () => {
    it("scans a non-trivial file set (sanity: the scan surface is wired)", () => {
      // Guards against a silently-empty scan (e.g. cwd drift) making the gate
      // vacuously pass.
      expect(
        SCANNED.length,
        "expected to scan SQL + TS files under aisha/db and services",
      ).toBeGreaterThan(0);
    });

    for (const pattern of FORBIDDEN_PATTERNS) {
      it(`contains no ${pattern.label}`, () => {
        const offenders: string[] = [];
        for (const file of SCANNED) {
          const lines = file.content.split("\n");
          lines.forEach((line, i) => {
            if (pattern.regex.test(line)) {
              offenders.push(`${file.relPath}:${i + 1}  ${line.trim()}`);
            }
          });
        }
        expect(
          offenders,
          `Found a maintained permit-list (${pattern.label}).\n` +
            `${pattern.remedy}.\n` +
            `Offending locations:\n  ${offenders.join("\n  ")}`,
        ).toEqual([]);
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. The governance_flags allow-list subsystem must NOT exist
  // ─────────────────────────────────────────────────────────────────────────
  describe("the governance_flags allow-list subsystem is absent", () => {
    for (const artifact of GOVERNANCE_FLAG_ARTIFACTS) {
      it(`${artifact} does not exist`, () => {
        expect(
          existsSync(join(ROOT, artifact)),
          `${artifact} embodies the forbidden allow-list (allow_runtime jsonb array + flag-set). ` +
            `Delete it: availability comes from per-entity is_enabled, governance comes from ` +
            `ai_spend_policies thresholds + computed risk.`,
        ).toBe(false);
      });
    }

    it("no SQL artifact creates a governance_flags table", () => {
      const offenders = SCANNED.filter(
        (f) =>
          f.relPath.startsWith("aisha/db") &&
          /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?governance_flags\b/i.test(
            f.content,
          ),
      ).map((f) => f.relPath);
      expect(
        offenders,
        `governance_flags table must not be (re)created: ${offenders.join(", ")}`,
      ).toEqual([]);
    });

    it("no SQL artifact defines fn_resolve_governance_flag", () => {
      const offenders = SCANNED.filter(
        (f) =>
          f.relPath.startsWith("aisha/db") &&
          /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?fn_resolve_governance_flag\b/i.test(
            f.content,
          ),
      ).map((f) => f.relPath);
      expect(
        offenders,
        `fn_resolve_governance_flag is the allow-list resolver and must not exist: ${offenders.join(", ")}`,
      ).toEqual([]);
    });

    it("no admission function membership-tests a runtime against fn_resolve_governance_flag", () => {
      const offenders: string[] = [];
      for (const file of SCANNED) {
        if (!file.relPath.startsWith("aisha/db")) continue;
        if (/fn_resolve_governance_flag\s*\(/i.test(file.content)) {
          offenders.push(file.relPath);
        }
      }
      expect(
        offenders,
        `No code may resolve governance via the flag allow-list: ${offenders.join(", ")}`,
      ).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. The CORRECT model — per-entity ai_runtime_registry (one row per runtime)
  // ─────────────────────────────────────────────────────────────────────────
  describe("ai_runtime_registry encodes availability per-entity (not a list value)", () => {
    it("the ai_runtime_registry table SoT exists", () => {
      expect(
        existsSync(join(ROOT, RUNTIME_REGISTRY_TABLE)),
        "capability-availability requires a per-entity ai_runtime_registry table " +
          "(self-registering runtimes, each governing its own is_enabled)",
      ).toBe(true);
    });

    it("the table carries a per-entity is_enabled column (self-governance, not a permit list)", () => {
      const sql = read(RUNTIME_REGISTRY_TABLE);
      expect(
        sql,
        "each runtime must govern itself via its own is_enabled — mirrors ai_provider_registry",
      ).toMatch(/\bis_enabled\b/);
      // The registry keys on a single runtime slug per row (one entity per row),
      // never a column holding a list of permitted names.
      expect(sql).toMatch(/\bslug\b/);
    });

    it("a seed inserts one row PER runtime (per-entity), not a single list value", () => {
      const seedRel = findRuntimeRegistrySeed();
      expect(
        seedRel,
        "expected a seed under aisha/db/seed/core that does INSERT INTO public.ai_runtime_registry",
      ).not.toBeNull();

      const seed = codeOf(seedRel as string);

      // Per-entity proof: every canonical runtime appears as its own seeded
      // slug literal. Adding a runtime = adding a row, nothing else to maintain.
      for (const runtime of CANONICAL_RUNTIMES) {
        expect(
          seed,
          `runtime '${runtime}' must self-register as its own ai_runtime_registry row`,
        ).toMatch(new RegExp(`['"]${runtime}['"]`));
      }

      // Anti-allow-list proof: the seed must NOT smuggle the list back in as a
      // single jsonb array of runtime names (the old allow_runtime shape).
      expect(
        seed,
        "ai_runtime_registry must hold one entity per row, never a jsonb array of permitted runtime names",
      ).not.toMatch(/\[\s*['"](?:direct_llm|openclaw|hermes|workflow|human|cli)['"]/);
      expect(seed).not.toMatch(/\ballow(?:ed)?_runtimes?\b/i);
    });
  });
});
