/**
 * Source of Truth — Uniqueness & Balast Detection
 *
 * Validates that the SQL source of truth (aisha/db/sql/) is free of:
 *   - Duplicate function definitions (same function name in multiple files)
 *   - Filename ↔ function name mismatches
 *   - Multiple CREATE OR REPLACE in a single file
 *   - Duplicate table/view/enum/trigger definitions
 *   - Orphan/temp files (tmp_, old_, backup_, test_, etc.)
 *   - Duplicate index names across files
 *   - Duplicate policy names across files
 *   - Empty or near-empty SQL files (< 10 bytes, pure-comment)
 *   - Duplicate seed translation keys within the same file
 *   - Function overloads that share a file name but define different signatures
 *
 * Run: npm run test:run src/tests/db/source-truth-uniqueness.test.ts
 *
 * @packageDocumentation
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// =============================================================================
// Configuration
// =============================================================================

const ROOT = path.resolve(__dirname, "../../..");
const SQL_DIR = path.join(ROOT, "aisha/db/sql");
const SEED_DIR = path.join(ROOT, "aisha/db/seed");

/**
 * All source-of-truth subdirectories and the regex to extract the
 * canonical identifier from each file's SQL content.
 */
const SQL_CATEGORIES: Array<{
  name: string;
  dir: string;
  /**
   * Regex applied to each file to extract the canonical DB object name.
   * First capture group = object name.  If null, only file-level checks run.
   */
  identifierPattern: RegExp | null;
  /**
   * Regex to count creation statements (applied to comment-stripped SQL).
   * Used for multi-definition detection. If null, multi-def check is skipped.
   */
  creationRegex: RegExp | null;
  /**
   * Whether filename ↔ object name matching should be enforced.
   * Triggers use purpose-based naming (table name), not the DB trigger name.
   */
  enforceFilenameMatch: boolean;
  /**
   * Whether to allow same-name overloads (different signatures) in the same file.
   * Functions support this via PostgreSQL overloading.
   */
  allowOverloads: boolean;
}> = [
  {
    name: "functions",
    dir: path.join(SQL_DIR, "functions"),
    identifierPattern:
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(?:(\w+)\.)?(\w+)\s*\(/i,
    creationRegex: /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+/gi,
    enforceFilenameMatch: true,
    allowOverloads: true,
  },
  {
    name: "tables",
    dir: path.join(SQL_DIR, "tables"),
    identifierPattern: /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(\w+)\s*\(/i,
    creationRegex: /CREATE\s+TABLE\s+/gi,
    enforceFilenameMatch: true,
    allowOverloads: false,
  },
  {
    name: "views",
    dir: path.join(SQL_DIR, "views"),
    identifierPattern:
      /CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:(\w+)\.)?(\w+)/i,
    creationRegex: /CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+/gi,
    enforceFilenameMatch: true,
    allowOverloads: false,
  },
  {
    name: "enums",
    dir: path.join(SQL_DIR, "enums"),
    identifierPattern: /CREATE\s+TYPE\s+(?:public\.)?(\w+)\s+AS\s+ENUM/i,
    creationRegex: /CREATE\s+TYPE\s+\w+\s+AS\s+ENUM/gi,
    enforceFilenameMatch: true,
    allowOverloads: false,
  },
  {
    name: "triggers",
    dir: path.join(SQL_DIR, "triggers"),
    identifierPattern:
      /CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+(\w+)/i,
    creationRegex: /CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+/gi,
    enforceFilenameMatch: false, // triggers use purpose-based naming (table name), not trigger name
    allowOverloads: false,
  },
];

// Patterns to detect temp/orphan files at any nesting level
// NOTE: "test_" is NOT included — it's a domain term (test_attempts, test_questions, etc.)
const ORPHAN_FILE_PATTERNS = [
  /^tmp_/i,
  /^old_/i,
  /^backup_/i,
  /^copy_/i,
  /^unused_/i,
  /^deprecated_/i,
  /\.bak$/i,
  /\.old$/i,
  /\.tmp$/i,
  /~$/,
];

// =============================================================================
// Helpers
// =============================================================================

function listSqlFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => path.join(dir, f));
}

function listAllSqlFilesRecursive(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listAllSqlFilesRecursive(full));
    } else if (entry.name.endsWith(".sql")) {
      results.push(full);
    }
  }
  return results;
}

function readFile(fp: string): string {
  return fs.readFileSync(fp, "utf-8");
}

function stripComments(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim();
}

// =============================================================================
// Tests
// =============================================================================

/**
 * Jméno objektu pro porovnání se jménem souboru. Vzory funkcí a pohledů mají dvě skupiny
 * (schéma, jméno): objekt mimo `public` má soubor `<schéma>_<jméno>` (vault.decrypted_secrets →
 * vault_decrypted_secrets.sql). Dřív vzor bral jen `public.` — `vault.x` se u pohledu přečetl jako
 * „vault" a u funkce vůbec nenašel, takže kontrola objekty mimo public tiše míjela.
 */
function jmenoObjektu(m: RegExpMatchArray | RegExpExecArray): string {
  if (m.length > 2 && m[2] !== undefined) {
    const schema = m[1];
    return schema && schema.toLowerCase() !== "public" ? `${schema}_${m[2]}` : m[2];
  }
  return m[1];
}

describe("Source of Truth — Uniqueness & Balast Detection", () => {
  // ---------------------------------------------------------------------------
  // 1. Per-category uniqueness
  // ---------------------------------------------------------------------------
  for (const cat of SQL_CATEGORIES) {
    describe(`${cat.name}/ — uniqueness`, () => {
      const files = listSqlFiles(cat.dir);

      it("should have no duplicate file names within the directory", () => {
        const basenames = files.map((f) => path.basename(f));
        const seen = new Map<string, number>();
        const dupes: string[] = [];
        for (const b of basenames) {
          seen.set(b, (seen.get(b) || 0) + 1);
        }
        for (const [name, count] of seen) {
          if (count > 1) dupes.push(`${name} (×${count})`);
        }
        expect(dupes, `Duplicate filenames in ${cat.name}/`).toEqual([]);
      });

      if (cat.identifierPattern) {
        it("should have no duplicate DB object names across files", () => {
          const nameToFiles = new Map<string, string[]>();
          for (const fp of files) {
            const content = stripComments(readFile(fp));
            const match = content.match(cat.identifierPattern!);
            if (match) {
              const objName = jmenoObjektu(match).toLowerCase();
              const existing = nameToFiles.get(objName) || [];
              existing.push(path.basename(fp));
              nameToFiles.set(objName, existing);
            }
          }
          const dupes: string[] = [];
          for (const [name, owners] of nameToFiles) {
            if (owners.length > 1) {
              dupes.push(`${name} → [${owners.join(", ")}]`);
            }
          }
          expect(
            dupes,
            `Duplicate ${cat.name} object names in different files`
          ).toEqual([]);
        });

        if (cat.enforceFilenameMatch) {
          it("should have filename matching the DB object name inside", () => {
            const mismatches: string[] = [];
            for (const fp of files) {
              const basename = path.basename(fp, ".sql");
              const content = stripComments(readFile(fp));
              const match = content.match(cat.identifierPattern!);
              if (match) {
                const objName = jmenoObjektu(match).toLowerCase();
                if (objName !== basename.toLowerCase()) {
                  mismatches.push(
                    `file=${basename}.sql defines ${cat.name.slice(0, -1)}=${objName}`
                  );
                }
              }
            }
            expect(
              mismatches,
              `Filename ↔ object name mismatches in ${cat.name}/`
            ).toEqual([]);
          });
        }
      }

      if (cat.creationRegex) {
        it("should have at most one creation statement per file", () => {
          const multiDef: string[] = [];
          for (const fp of files) {
            const raw = readFile(fp);
            // Strip comments to avoid false positives from "-- CREATE TABLE" etc.
            const content = stripComments(raw);
            const regex = new RegExp(cat.creationRegex!.source, cat.creationRegex!.flags);
            const matches = content.match(regex) || [];
            const count = matches.length;
            // Allow overloads (same function name, different signatures) in one file
            if (count > 1 && !cat.allowOverloads) {
              multiDef.push(`${path.basename(fp)}: ${count}× ${cat.name} creation statement`);
            } else if (count > 1 && cat.allowOverloads) {
              // For overloads: extract all names, if multiple DIFFERENT names → error
              const nameRegex = new RegExp(cat.identifierPattern!.source, "gi");
              const names = new Set<string>();
              let m: RegExpExecArray | null;
              while ((m = nameRegex.exec(content)) !== null) {
                names.add(jmenoObjektu(m).toLowerCase());
              }
              if (names.size > 1) {
                multiDef.push(
                  `${path.basename(fp)}: defines ${names.size} different ${cat.name}: [${[...names].join(", ")}]`
                );
              }
            }
          }
          expect(
            multiDef,
            `Files with multiple creation statements in ${cat.name}/`
          ).toEqual([]);
        });
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 2. Indexes — unique index names
  // ---------------------------------------------------------------------------
  describe("indexes/ — uniqueness", () => {
    const indexDir = path.join(SQL_DIR, "indexes");
    const files = listSqlFiles(indexDir);

    it("should have no duplicate index names across files", () => {
      const indexNameToFiles = new Map<string, string[]>();
      const indexRe = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi;
      for (const fp of files) {
        const content = readFile(fp);
        let m: RegExpExecArray | null;
        while ((m = indexRe.exec(content)) !== null) {
          const idxName = m[1].toLowerCase();
          const existing = indexNameToFiles.get(idxName) || [];
          existing.push(path.basename(fp));
          indexNameToFiles.set(idxName, existing);
        }
      }
      const dupes: string[] = [];
      for (const [name, owners] of indexNameToFiles) {
        if (owners.length > 1) {
          dupes.push(`${name} → [${owners.join(", ")}]`);
        }
      }
      expect(dupes, "Duplicate index names").toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Policies — unique policy names per table
  // ---------------------------------------------------------------------------
  describe("policies/ — uniqueness per table", () => {
    const policyDir = path.join(SQL_DIR, "policies");
    const files = listSqlFiles(policyDir);

    it("should have no duplicate policy names for the same table", () => {
      const tablePolicyToFiles = new Map<string, string[]>();
      const policyRe =
        /CREATE\s+POLICY\s+"?([^"\s]+)"?\s+ON\s+(?:public\.)?(\w+)/gi;

      for (const fp of files) {
        const content = readFile(fp);
        let m: RegExpExecArray | null;
        while ((m = policyRe.exec(content)) !== null) {
          const policyName = m[1].toLowerCase();
          const tableName = m[2].toLowerCase();
          const key = `${tableName}::${policyName}`;
          const existing = tablePolicyToFiles.get(key) || [];
          existing.push(path.basename(fp));
          tablePolicyToFiles.set(key, existing);
        }
      }
      const dupes: string[] = [];
      for (const [key, owners] of tablePolicyToFiles) {
        if (owners.length > 1) {
          dupes.push(`${key} → [${owners.join(", ")}]`);
        }
      }
      expect(dupes, "Duplicate policy names for the same table").toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Orphan / temp files across entire aisha/db/sql/
  // ---------------------------------------------------------------------------
  describe("aisha/db/sql/ — no orphan or temp files", () => {
    it("should not contain tmp/test/old/backup files", () => {
      const allFiles = listAllSqlFilesRecursive(SQL_DIR);
      const orphans: string[] = [];
      for (const fp of allFiles) {
        const basename = path.basename(fp);
        for (const pattern of ORPHAN_FILE_PATTERNS) {
          if (pattern.test(basename)) {
            orphans.push(path.relative(ROOT, fp));
            break;
          }
        }
      }
      expect(
        orphans,
        "Orphan/temp SQL files found in aisha/db/sql/ — clean up or move to archive/"
      ).toEqual([]);
    });

    it("should not have loose SQL files in aisha/db/sql/ root (only subdirs)", () => {
      if (!fs.existsSync(SQL_DIR)) return;
      const rootFiles = fs
        .readdirSync(SQL_DIR)
        .filter((f) => f.endsWith(".sql"));
      expect(
        rootFiles,
        "Loose SQL files in aisha/db/sql/ root — move to proper subdirectory or archive/"
      ).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Empty / dead files
  // ---------------------------------------------------------------------------
  describe("aisha/db/sql/ — no empty or dead files", () => {
    it("should not contain empty SQL files (< 10 bytes)", () => {
      const allFiles = listAllSqlFilesRecursive(SQL_DIR);
      const empties: string[] = [];
      for (const fp of allFiles) {
        const stat = fs.statSync(fp);
        if (stat.size < 10) {
          empties.push(`${path.relative(ROOT, fp)} (${stat.size}B)`);
        }
      }
      expect(empties, "Empty SQL files found").toEqual([]);
    });

    it("should not contain SQL files with only comments and no actual SQL", () => {
      const allFiles = listAllSqlFilesRecursive(SQL_DIR);
      const commentOnly: string[] = [];
      for (const fp of allFiles) {
        const content = readFile(fp);
        const stripped = stripComments(content);
        if (stripped.length === 0 && content.length > 0) {
          commentOnly.push(path.relative(ROOT, fp));
        }
      }
      expect(
        commentOnly,
        "Comment-only SQL files (no actual SQL) — remove or add content"
      ).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Seed translation uniqueness
  // ---------------------------------------------------------------------------
  describe("seed translations — key uniqueness within files", () => {
    const translationsDir = path.join(SEED_DIR, "translations");

    it("should not have duplicate (key, locale, namespace) tuples within a single file", () => {
      const files = listSqlFiles(translationsDir);
      const dupes: string[] = [];

      // Match: ('key', 'locale', 'namespace', 'value')
      const insertRe =
        /\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'[^']*'/g;

      for (const fp of files) {
        const content = readFile(fp);
        const seen = new Set<string>();
        let m: RegExpExecArray | null;
        while ((m = insertRe.exec(content)) !== null) {
          const compositeKey = `${m[1]}|${m[2]}|${m[3]}`;
          if (seen.has(compositeKey)) {
            dupes.push(
              `${path.basename(fp)}: duplicate key=(${m[1]}) locale=(${m[2]}) ns=(${m[3]})`
            );
          }
          seen.add(compositeKey);
        }
      }
      expect(dupes, "Duplicate translation keys within seed files").toEqual([]);
    });

    it("should not have duplicate keys across translation seed files", () => {
      const files = listSqlFiles(translationsDir);
      const globalKeys = new Map<string, string[]>();

      const insertRe =
        /\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'[^']*'/g;

      for (const fp of files) {
        const content = readFile(fp);
        let m: RegExpExecArray | null;
        while ((m = insertRe.exec(content)) !== null) {
          const compositeKey = `${m[1]}|${m[2]}|${m[3]}`;
          const existing = globalKeys.get(compositeKey) || [];
          existing.push(path.basename(fp));
          globalKeys.set(compositeKey, existing);
        }
      }

      const crossFileDupes: string[] = [];
      for (const [key, owners] of globalKeys) {
        const uniqueOwners = [...new Set(owners)];
        if (uniqueOwners.length > 1) {
          const [k, locale, ns] = key.split("|");
          crossFileDupes.push(
            `key=(${k}) locale=(${locale}) ns=(${ns}) → [${uniqueOwners.join(", ")}]`
          );
        }
      }
      expect(
        crossFileDupes,
        "Translation keys duplicated across seed files"
      ).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Core seed files — no duplicate INSERT targets within a single step file
  // ---------------------------------------------------------------------------
  describe("seed core — no redundant INSERT blocks", () => {
    const coreDir = path.join(SEED_DIR, "core");

    it("should not have the same INSERT INTO target+columns repeated as multi-row VALUES blocks", () => {
      const files = listSqlFiles(coreDir);
      const issues: string[] = [];

      // Match multi-row VALUES blocks and capture both the target table
      // AND the column list. Multiple blocks for the same (table, columns)
      // are flagged ONLY if they are not separated by an `ON CONFLICT`
      // clause — that pattern signals an intentional upsert section break.
      const multiRowRe =
        /INSERT\s+INTO\s+(?:public\.)?(\w+)\s*\(([^)]+)\)\s+VALUES\s+\([^)]*\)\s*,\s*\(/gi;

      for (const fp of files) {
        const content = readFile(fp);
        const blockMatches: Array<{ key: string; index: number }> = [];
        let m: RegExpExecArray | null;
        while ((m = multiRowRe.exec(content)) !== null) {
          const table = m[1].toLowerCase();
          const cols = m[2]
            .split(",")
            .map((c) => c.trim().toLowerCase())
            .sort()
            .join(",");
          blockMatches.push({ key: `${table}#${cols}`, index: m.index });
        }

        const grouped = new Map<string, number[]>();
        for (const { key, index } of blockMatches) {
          const arr = grouped.get(key) ?? [];
          arr.push(index);
          grouped.set(key, arr);
        }

        for (const [key, indices] of grouped) {
          if (indices.length <= 1) continue;
          // Count adjacent pairs that look like real duplicates: NOT
          // separated by an `ON CONFLICT` clause AND NOT preceded by a
          // section header comment (a `-- something` line right above the
          // second INSERT, which signals an intentional logical split,
          // e.g. one block per production batch).
          let trueDupes = 0;
          for (let i = 1; i < indices.length; i++) {
            const segment = content.slice(indices[i - 1], indices[i]);
            if (/ON\s+CONFLICT/i.test(segment)) continue;
            const before = content.slice(Math.max(0, indices[i] - 200), indices[i]);
            // Look for a `-- ...` line immediately before the INSERT (no
            // blank line of explanatory text in the way).
            if (/--[^\n]+\s*\n\s*$/.test(before)) continue;
            trueDupes++;
          }
          if (trueDupes > 0) {
            const [table] = key.split("#");
            issues.push(
              `${path.basename(fp)}: INSERT INTO ${table} multi-row VALUES block (same columns) repeats ${trueDupes}× without ON CONFLICT separator`,
            );
          }
        }
      }

      if (issues.length > 0) {
        console.warn(
          "⚠️ Seed files with potentially redundant multi-row INSERT blocks:\n  " +
            issues.join("\n  "),
        );
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 8. Grant files — each function/table should appear at most once
  // ---------------------------------------------------------------------------
  describe("grants/ — no duplicate GRANT targets", () => {
    const grantDir = path.join(SQL_DIR, "grants");
    const files = listSqlFiles(grantDir);

    it("should not have duplicate GRANT statements for the same object+role", () => {
      const grantRe =
        /GRANT\s+(\w+)\s+ON\s+(?:FUNCTION|TABLE)\s+(?:public\.)?([^\s(]+).*?\s+TO\s+(\w+)/gi;
      const seen = new Map<string, string[]>();

      for (const fp of files) {
        const content = readFile(fp);
        let m: RegExpExecArray | null;
        while ((m = grantRe.exec(content)) !== null) {
          const key = `${m[1].toLowerCase()}:${m[2].toLowerCase()}:${m[3].toLowerCase()}`;
          const existing = seen.get(key) || [];
          existing.push(path.basename(fp));
          seen.set(key, existing);
        }
      }
      const dupes: string[] = [];
      for (const [key, owners] of seen) {
        if (owners.length > 1) {
          dupes.push(`${key} → [${owners.join(", ")}]`);
        }
      }
      expect(dupes, "Duplicate GRANT statements").toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // 9. RLS files — each table should appear at most once
  // ---------------------------------------------------------------------------
  describe("rls/ — no duplicate ALTER TABLE ENABLE RLS", () => {
    const rlsDir = path.join(SQL_DIR, "rls");
    const files = listSqlFiles(rlsDir);

    it("should not have duplicate ENABLE ROW LEVEL SECURITY for the same table", () => {
      const rlsRe =
        /ALTER\s+TABLE\s+(?:public\.)?(\w+)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi;
      const seen = new Map<string, string[]>();

      for (const fp of files) {
        const content = readFile(fp);
        let m: RegExpExecArray | null;
        while ((m = rlsRe.exec(content)) !== null) {
          const table = m[1].toLowerCase();
          const existing = seen.get(table) || [];
          existing.push(path.basename(fp));
          seen.set(table, existing);
        }
      }
      const dupes: string[] = [];
      for (const [table, owners] of seen) {
        if (owners.length > 1) {
          dupes.push(`${table} → [${owners.join(", ")}]`);
        }
      }
      expect(dupes, "Duplicate ENABLE RLS statements").toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // 10. Constraints — unique constraint names
  // ---------------------------------------------------------------------------
  describe("constraints/ — unique names", () => {
    const constraintDir = path.join(SQL_DIR, "constraints");
    const files = listSqlFiles(constraintDir);

    it("should have unique constraint names across files", () => {
      const constraintRe =
        /ADD\s+CONSTRAINT\s+(\w+)/gi;
      const seen = new Map<string, string[]>();

      for (const fp of files) {
        const content = readFile(fp);
        let m: RegExpExecArray | null;
        while ((m = constraintRe.exec(content)) !== null) {
          const name = m[1].toLowerCase();
          const existing = seen.get(name) || [];
          existing.push(path.basename(fp));
          seen.set(name, existing);
        }
      }
      const dupes: string[] = [];
      for (const [name, owners] of seen) {
        if (owners.length > 1) {
          dupes.push(`${name} → [${owners.join(", ")}]`);
        }
      }
      expect(dupes, "Duplicate constraint names").toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // 11. Summary statistics (informational, always passes)
  // ---------------------------------------------------------------------------
  describe("source-of-truth — summary statistics", () => {
    it("should report file counts per category", () => {
      const stats: Record<string, number> = {};
      for (const cat of SQL_CATEGORIES) {
        stats[cat.name] = listSqlFiles(cat.dir).length;
      }
      stats.indexes = listSqlFiles(path.join(SQL_DIR, "indexes")).length;
      stats.policies = listSqlFiles(path.join(SQL_DIR, "policies")).length;
      stats.constraints = listSqlFiles(path.join(SQL_DIR, "constraints")).length;
      stats.grants = listSqlFiles(path.join(SQL_DIR, "grants")).length;
      stats.rls = listSqlFiles(path.join(SQL_DIR, "rls")).length;
      stats.storage = listSqlFiles(path.join(SQL_DIR, "storage")).length;
      stats["seed/core"] = listSqlFiles(path.join(SEED_DIR, "core")).length;
      stats["seed/translations"] = listSqlFiles(
        path.join(SEED_DIR, "translations")
      ).length;

      const total = Object.values(stats).reduce((a, b) => a + b, 0);
      console.log(
        `\n📊 SQL Source of Truth: ${total} files\n` +
          Object.entries(stats)
            .map(([k, v]) => `   ${k.padEnd(20)} ${v}`)
            .join("\n")
      );

      expect(total).toBeGreaterThan(0);
    });
  });
});
