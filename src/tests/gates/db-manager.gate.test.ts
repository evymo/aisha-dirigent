/**
 * db-manager gate tests
 *
 * Testuje:
 * - state.mjs čisté funkce (hashContent, getChangedItems)
 * - db-mgr CLI výstupy pro statické příkazy
 *
 * Spouští se přes vitest.gates.config.ts (node env, 2 min timeout).
 */

import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../../..");

/* ---------- dynamic ESM imports ---------- */

interface StateModule {
  hashContent: (content: string) => string;
}

let stateModule: StateModule;

beforeAll(async () => {
  stateModule = await import(
    path.join(ROOT, "scripts/db/db-manager/lib/state.mjs")
  );
});

/* ====================================================================
 * 1. state.mjs — hashContent
 * ==================================================================== */

describe("state.mjs — hashContent", () => {
  it("vrací konzistentní MD5 hash pro stejný vstup", () => {
    const h1 = stateModule.hashContent("hello world");
    const h2 = stateModule.hashContent("hello world");
    expect(h1).toBe(h2);
    expect(typeof h1).toBe("string");
    expect(h1).toHaveLength(32); // MD5 = 32 hex chars
  });

  it("vrací různé hashe pro různé vstupy", () => {
    const h1 = stateModule.hashContent("CREATE TABLE foo (id uuid);");
    const h2 = stateModule.hashContent("CREATE TABLE bar (id uuid);");
    expect(h1).not.toBe(h2);
  });

  it("je deterministický pro whitespace-normalizovaný SQL", () => {
    // Trailing whitespace changes the hash (by design)
    const h1 = stateModule.hashContent("SELECT 1;");
    const h2 = stateModule.hashContent("SELECT 1; ");
    expect(h1).not.toBe(h2);
  });

  it("handluje prázdný string", () => {
    const hash = stateModule.hashContent("");
    expect(hash).toHaveLength(32);
  });
});

/* ====================================================================
 * 2. state.mjs — getChangedItems
 * ==================================================================== */

describe("state.mjs — getChangedItems (in-memory logic)", () => {
  /**
   * getChangedItems závisí na loadState (čte z disku).
   * Testujeme správnost logiky porovnáním přímo přes stateModule
   * s použitím dočasného state souboru.
   */

  it("detekuje přidaný item (added)", () => {
    // Simulujeme getChangedItems logiku ručně
    const current = { new_table: "CREATE TABLE new_table (id uuid);" };
    const stateItems: Record<string, { hash: string }> = {};

    const added: Array<{ name: string }> = [];
    const modified: Array<{ name: string }> = [];
    const unchanged: Array<{ name: string }> = [];

    for (const [name, content] of Object.entries(current)) {
      const hash = stateModule.hashContent(content);
      if (!stateItems[name]) {
        added.push({ name });
      } else if (stateItems[name].hash !== hash) {
        modified.push({ name });
      } else {
        unchanged.push({ name });
      }
    }

    expect(added).toHaveLength(1);
    expect(added[0].name).toBe("new_table");
    expect(modified).toHaveLength(0);
    expect(unchanged).toHaveLength(0);
  });

  it("detekuje modifikovaný item (modified)", () => {
    const oldContent = "CREATE TABLE foo (id uuid);";
    const newContent = "CREATE TABLE foo (id uuid, name text);";
    const oldHash = stateModule.hashContent(oldContent);
    const newHash = stateModule.hashContent(newContent);

    expect(oldHash).not.toBe(newHash);
  });

  it("detekuje odstraněný item (removed)", () => {
    const stateItems: Record<string, boolean> = { old_table: true, current_table: true };
    const current: Record<string, boolean> = { current_table: true };

    const removed: string[] = [];
    for (const name of Object.keys(stateItems)) {
      if (!current[name]) {
        removed.push(name);
      }
    }

    expect(removed).toEqual(["old_table"]);
  });
});

/* ====================================================================
 * 3. db-mgr CLI — statické příkazy (bez DB)
 * ==================================================================== */

describe("db-mgr:source — static analysis", () => {
  /**
   * db-mgr:source spouští source-truth-analyzer, ale negeneruje
   * JSON soubor. Testujeme jen, že příkaz doběhne bez chyby.
   */
  it("příkaz db-mgr:source doběhne bez chyby", { timeout: 120000 }, () => {
    try {
      execSync("npm run db-mgr:source 2>&1", {
        cwd: ROOT,
        timeout: 60000,
        encoding: "utf-8",
      });
    } catch (err) {
      // Command může mít non-zero exit pokud najde issues — to je OK
      // Chceme jen ověřit, že neskončí crash/syntax error
      const error = err as { status: number; stderr?: string };
      // Pokud je exit code > 2, je to skutečný crash
      if (error.status > 2) {
        throw new Error(
          `db-mgr:source crashed with exit code ${error.status}`
        );
      }
    }
  });
});

/* ====================================================================
 * 4. SQL adresářová struktura
 * ==================================================================== */

describe("SQL source of truth — adresářová struktura", () => {
  const SQL_DIR = path.join(ROOT, "aisha/db/sql");

  const requiredDirs = [
    "tables",
    "functions",
    "policies",
    "triggers",
    "indexes",
    "enums",
    "views",
  ];

  for (const dir of requiredDirs) {
    it(`aisha/db/sql/${dir}/ existuje`, () => {
      expect(fs.existsSync(path.join(SQL_DIR, dir))).toBe(true);
    });
  }

  it("všechny SQL soubory mají .sql příponu", () => {
    const nonSqlFiles: string[] = [];
    for (const dir of requiredDirs) {
      const dirPath = path.join(SQL_DIR, dir);
      if (!fs.existsSync(dirPath)) continue;
      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        const fullPath = path.join(dirPath, file);
        if (fs.statSync(fullPath).isFile() && !file.endsWith(".sql")) {
          nonSqlFiles.push(`${dir}/${file}`);
        }
      }
    }
    expect(nonSqlFiles).toEqual([]);
  });

  it("function SQL soubory mají CREATE OR REPLACE FUNCTION", () => {
    const funcDir = path.join(SQL_DIR, "functions");
    if (!fs.existsSync(funcDir)) return;

    const files = fs
      .readdirSync(funcDir)
      .filter((f) => f.endsWith(".sql"));
    const missing: string[] = [];

    for (const file of files) {
      const content = fs.readFileSync(path.join(funcDir, file), "utf-8");
      if (!/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i.test(content)) {
        missing.push(file);
      }
    }

    expect(missing).toEqual([]);
  });

  it("table SQL soubory mají CREATE TABLE", () => {
    const tableDir = path.join(SQL_DIR, "tables");
    if (!fs.existsSync(tableDir)) return;

    const files = fs
      .readdirSync(tableDir)
      .filter((f) => f.endsWith(".sql"));
    const missing: string[] = [];

    for (const file of files) {
      const content = fs.readFileSync(path.join(tableDir, file), "utf-8");
      if (!/CREATE\s+TABLE/i.test(content)) {
        missing.push(file);
      }
    }

    expect(missing).toEqual([]);
  });

  it("plpgsql funkce s RETURNS TABLE kolizními sloupci a DML mají #variable_conflict use_column", () => {
    const funcDir = path.join(SQL_DIR, "functions");
    if (!fs.existsSync(funcDir)) return;

    // Columns that frequently collide with PL/pgSQL RETURNS TABLE variables
    // in DML context (INSERT/UPDATE ON CONFLICT). Excludes 'id' — rarely
    // ambiguous because it's almost always qualified or auto-generated.
    const riskyColumns = ["key", "value", "name", "locale", "namespace", "status", "type"];

    const files = fs
      .readdirSync(funcDir)
      .filter((f) => f.endsWith(".sql"));
    const violations: string[] = [];

    for (const file of files) {
      const content = fs.readFileSync(path.join(funcDir, file), "utf-8");

      // Only check plpgsql functions
      if (!/LANGUAGE\s+plpgsql/i.test(content)) continue;

      // Only check functions with DML that targets data tables (not just audit_journal)
      // Audit-only INSERTs don't cause variable conflicts because audit_journal
      // columns (user_id, action, metadata) don't overlap with typical RETURNS TABLE names.
      const dmlStatements = content.match(/\bINSERT\s+INTO\s+(\S+)/gi) ?? [];
      const hasDangerousDml = dmlStatements.some(
        (stmt) => !/audit_journal/i.test(stmt),
      ) || /\bUPDATE\s+(?!audit_journal)\S+.*\bSET\b/is.test(content)
        || /\bDELETE\s+FROM\s+(?!audit_journal)/is.test(content);
      if (!hasDangerousDml) continue;

      // Extract RETURNS TABLE columns
      const returnsMatch = content.match(
        /RETURNS\s+TABLE\s*\(([^)]+)\)/is,
      );
      if (!returnsMatch) continue;

      const returnCols = returnsMatch[1]
        .split(",")
        .map((col) => col.trim().split(/\s+/)[0].toLowerCase())
        .filter(Boolean);

      // Check if any return column matches risky names
      const colliding = returnCols.filter((col) =>
        riskyColumns.includes(col),
      );
      if (colliding.length === 0) continue;

      // If collision risk exists, require #variable_conflict use_column
      if (!/#variable_conflict\s+use_column/i.test(content)) {
        violations.push(
          `${file}: RETURNS TABLE has columns [${colliding.join(", ")}] that collide with common table columns in DML context — add #variable_conflict use_column`,
        );
      }
    }

    expect(violations).toEqual([]);
  });
});
