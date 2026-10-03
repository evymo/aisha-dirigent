/**
 * Production Build Gate Tests
 *
 * Statické kontroly na SQL source of truth, migrace, funkce a konzistenci
 * kódu pro zajištění připravenosti na produkční build.
 *
 * Nespouští DB dotazy — pracuje POUZE se soubory.
 *
 * Spouští se přes vitest.gates.config.ts (node env, 2 min timeout).
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../../..");
const SQL_DIR = path.join(ROOT, "aisha/db/sql");
const FUNCTIONS_DIR = path.join(SQL_DIR, "functions");
const TABLES_DIR = path.join(SQL_DIR, "tables");
const INDEXES_DIR = path.join(SQL_DIR, "indexes");
const POLICIES_DIR = path.join(SQL_DIR, "policies");
const MIGRATIONS_DIR = path.join(ROOT, "aisha/db/migrations");
const SRC_DIR = path.join(ROOT, "src");

/* ---------- helpers ---------- */

function readSqlFiles(dir: string): Array<{ name: string; content: string }> {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => ({
      name: f.replace(".sql", ""),
      content: fs.readFileSync(path.join(dir, f), "utf-8"),
    }));
}

/** Strip SQL single-line comments to avoid false regex matches */
function stripSqlComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => (line.trimStart().startsWith("--") ? "" : line))
    .join("\n");
}

function scanTsFilesRecursive(
  dir: string,
  result: Array<{ path: string; content: string }> = []
): Array<{ path: string; content: string }> {
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (
      entry.isDirectory() &&
      !entry.name.startsWith(".") &&
      entry.name !== "node_modules"
    ) {
      scanTsFilesRecursive(full, result);
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
    ) {
      result.push({ path: full, content: fs.readFileSync(full, "utf-8") });
    }
  }
  return result;
}

/* ====================================================================
 * 1. MIGRACE — Hygiena
 * ==================================================================== */

describe("Migrace — hygiena", () => {
  /**
   * Sbíráme migrační soubory (plain files i podsložky).
   * Iterujeme rekurzivně.
   */
  function collectMigrationFiles(): Array<{
    relativePath: string;
    content: string;
  }> {
    const files: Array<{ relativePath: string; content: string }> = [];
    if (!fs.existsSync(MIGRATIONS_DIR)) return files;

    function walk(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && entry.name.endsWith(".sql")) {
          files.push({
            relativePath: path.relative(MIGRATIONS_DIR, full),
            content: fs.readFileSync(full, "utf-8"),
          });
        }
      }
    }
    walk(MIGRATIONS_DIR);
    return files;
  }

  it("žádné psql meta-příkazy v migracích", () => {
    const migrations = collectMigrationFiles();
    const forbidden = [
      /^\\connect\b/m,
      /^\\set\b/m,
      /^\\i\b/m,
      /^\\copy\b/m,
      /^\\gexec\b/m,
      /^\\\.\s*$/m, // data terminator
    ];
    const violations: string[] = [];

    for (const migration of migrations) {
      for (const pattern of forbidden) {
        if (pattern.test(migration.content)) {
          violations.push(
            `${migration.relativePath}: nalezen psql meta-příkaz (${pattern.source})`
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("žádné COPY FROM STDIN v migracích", () => {
    const migrations = collectMigrationFiles();
    const violations: string[] = [];

    for (const migration of migrations) {
      if (/COPY\s+\w+\s+FROM\s+STDIN/i.test(migration.content)) {
        violations.push(
          `${migration.relativePath}: obsahuje COPY FROM STDIN (vyžaduje psql)`
        );
      }
    }

    expect(violations).toEqual([]);
  });
});

/* ====================================================================
 * 2. FUNKCE — Kompletnost a bezpečnost
 * ==================================================================== */

describe("SQL funkce — kompletnost", () => {
  const functions = readSqlFiles(FUNCTIONS_DIR);

  it("SECURITY DEFINER funkce mají SET search_path", () => {
    const violations: string[] = [];

    for (const func of functions) {
      if (/SECURITY\s+DEFINER/i.test(func.content)) {
        if (!/SET\s+search_path/i.test(func.content)) {
          violations.push(func.name);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("SECURITY DEFINER funkce mají REVOKE FROM PUBLIC", () => {
    const violations: string[] = [];

    for (const func of functions) {
      if (/SECURITY\s+DEFINER/i.test(func.content)) {
        if (
          !/REVOKE\s+(?:ALL|EXECUTE)\s+ON\s+FUNCTION[\s\S]*?FROM\b[^;]*\bPUBLIC\b/i.test(
            func.content
          )
        ) {
          violations.push(func.name);
        }
      }
    }

    // HARD FAIL: Každá SECURITY DEFINER funkce MUSÍ mít REVOKE FROM PUBLIC
    expect(
      violations,
      `SECURITY DEFINER funkce bez REVOKE: ${violations.join(", ")}`
    ).toEqual([]);
  });

  it("každý function soubor má LANGUAGE deklaraci", () => {
    const violations: string[] = [];

    for (const func of functions) {
      if (!/LANGUAGE\s+(plpgsql|sql)/i.test(func.content)) {
        violations.push(func.name);
      }
    }

    expect(violations).toEqual([]);
  });

  it("žádný SELECT * FROM sensitive data tabulek ve function souborech", () => {
    const phiTables = [
      "health_check_ins",
      "lab_results",
      "dosing_logs",
      "profiles",
      "wearables_data",
      "chat_messages",
      "chat_conversations",
      "questionnaire_responses",
      "health_data_sync",
      "member_health_documents",
      "story_entries",
    ];

    // Known issues — existující SELECT * na sensitive data tabulkách (k opravě)
    const KNOWN_PHI_SELECT_STAR = new Set([
      "get_my_qualification_results: SELECT * FROM questionnaire_responses",
      "get_user_lab_results_audited: SELECT * FROM lab_results",
    ]);

    const violations: string[] = [];

    for (const func of functions) {
      for (const table of phiTables) {
        const regex = new RegExp(
          `SELECT\\s+\\*\\s+FROM\\s+(?:public\\.)?${table}\\b`,
          "gi"
        );
        if (regex.test(func.content)) {
          const violation = `${func.name}: SELECT * FROM ${table}`;
          if (!KNOWN_PHI_SELECT_STAR.has(violation)) {
            violations.push(violation);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("_audited suffix funkce mají audit_journal insert", () => {
    const violations: string[] = [];

    for (const func of functions) {
      if (/_audited$/i.test(func.name)) {
        const hasAudit =
          /INSERT\s+INTO\s+(?:public\.)?audit_journal/i.test(func.content) ||
          /write_audit_journal/i.test(func.content) ||
          // audience_log_event is a PURE audit wrapper (only statement is
          // INSERT INTO audit_journal — verified); calling it satisfies the
          // _audited contract via the audience module's canonical helper.
          /audience_log_event\s*\(/i.test(func.content);
        if (!hasAudit) {
          violations.push(func.name);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

/* ====================================================================
 * 3. TABULKY — RLS a struktura
 * ==================================================================== */

describe("SQL tabulky — RLS povinný", () => {
  const tables = readSqlFiles(TABLES_DIR);

  it("všechny tabulky mají ENABLE ROW LEVEL SECURITY", () => {
    const violations: string[] = [];

    for (const table of tables) {
      if (!/ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(table.content)) {
        violations.push(table.name);
      }
    }

    expect(violations).toEqual([]);
  });

  it("žádné broken FK (REFERENCES null(null))", () => {
    const violations: string[] = [];

    for (const table of tables) {
      if (/REFERENCES\s+null\s*\(\s*null\s*\)/i.test(table.content)) {
        violations.push(table.name);
      }
    }

    expect(violations).toEqual([]);
  });

  it("tabulky s updated_at mají odpovídající trigger nebo komentář", () => {
    const violations: string[] = [];

    // Pre-read all trigger files once to avoid O(n²) disk reads
    const triggerDir = path.join(SQL_DIR, "triggers");
    const triggerContents: string[] = [];
    if (fs.existsSync(triggerDir)) {
      for (const f of fs.readdirSync(triggerDir)) {
        if (!f.endsWith(".sql")) continue;
        triggerContents.push(
          fs.readFileSync(path.join(triggerDir, f), "utf-8")
        );
      }
    }

    for (const table of tables) {
      if (/updated_at\s+timestamp/i.test(table.content)) {
        // Trigger může být v souboru tabulky nebo v triggers/
        const hasTriggerInFile =
          /CREATE\s+TRIGGER.*updated_at/i.test(table.content);

        const hasTriggerFile = triggerContents.some(
          (content) =>
            new RegExp(`ON\\s+(?:public\\.)?${table.name}\\b`, "i").test(
              content
            ) && /updated_at|set_updated_at/i.test(content)
        );

        if (!hasTriggerInFile && !hasTriggerFile) {
          violations.push(table.name);
        }
      }
    }

    // HARD FAIL: Každá tabulka s updated_at MUSÍ mít trigger
    expect(
      violations,
      `Tabulky s updated_at bez trigger: ${violations.join(", ")}`
    ).toEqual([]);
  });
});

/* ====================================================================
 * 4. POLICY — Konzistence
 * ==================================================================== */

describe("SQL policies — konzistence", () => {
  it("každá policy cílí na existující tabulku (match podle OBSAHU, ne názvu souboru)", () => {
    // Identita tabulky = název z `CREATE TABLE`, NE z názvu souboru. Tabulkové
    // SoT soubory se z drtivé většiny jmenují po tabulce, ale autoritativní je
    // jméno uvnitř DDL (vůči abstrakčnímu driftu pojmenování).
    const tableNames = new Set<string>();
    for (const t of readSqlFiles(TABLES_DIR)) {
      tableNames.add(t.name.toLowerCase());
      const m = stripSqlComments(t.content).match(
        /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?("([^"]+)"|([a-zA-Z_][a-zA-Z0-9_]*))/i
      );
      if (m) tableNames.add((m[2] ?? m[3]).toLowerCase());
    }

    const policyFiles = readSqlFiles(POLICIES_DIR);
    const orphans: string[] = [];

    // Cílová tabulka policy je v OBSAHU: `CREATE POLICY <name> ON [public.]<table>`.
    // Policy soubory se jmenují po POLICY (729/783), ne po tabulce, takže
    // filename-matching produkoval ~697 falešných "orphan" varování — gate se
    // dříve díval na špatné místo. Match podle obsahu je správný a má zuby.
    // Policy název je quoted string (smí obsahovat 'ON') NEBO holý identifikátor;
    // pak `ON [public.]<table>`. Explicitní název zabrání záměně 'ON' uvnitř názvu.
    const createPolicyOnRe =
      /CREATE\s+POLICY\s+(?:"(?:[^"]|"")*"|[a-zA-Z_][a-zA-Z0-9_]*)\s+ON\s+(?:public\.)?("([^"]+)"|([a-zA-Z_][a-zA-Z0-9_]*))/gi;

    for (const policy of policyFiles) {
      const clean = stripSqlComments(policy.content);
      const targets = new Set<string>();
      let m: RegExpExecArray | null;
      createPolicyOnRe.lastIndex = 0;
      while ((m = createPolicyOnRe.exec(clean)) !== null) {
        targets.add((m[2] ?? m[3]).toLowerCase());
      }
      if (targets.size === 0) {
        orphans.push(`${policy.name}: žádný 'CREATE POLICY ... ON <table>'`);
        continue;
      }
      for (const tbl of targets) {
        if (!tableNames.has(tbl)) {
          orphans.push(`${policy.name} → ON ${tbl} (tabulka chybí v tables/)`);
        }
      }
    }

    // HARD FAIL: každá policy MUSÍ cílit na tabulku existující v SoT.
    expect(
      orphans,
      `Policy bez existující cílové tabulky:\n${orphans.slice(0, 20).join("\n")}`
    ).toEqual([]);
  });
});

/* ====================================================================
 * 5. RPC PARITA — src/ volá funkce které existují v SQL
 * ==================================================================== */

describe("RPC parita — src/ ↔ SQL funkce", () => {
  it("RPC volání ze src/ mají odpovídající SQL soubor", { timeout: 30_000 }, () => {
    const functionNames = new Set(
      readSqlFiles(FUNCTIONS_DIR).map((f) => f.name)
    );

    // Sken src/ pro supabase.rpc() volání (vynechat testy a gate testy)
    const srcFiles = scanTsFilesRecursive(SRC_DIR).filter(
      (f) =>
        !f.path.includes(".test.") &&
        !f.path.includes(".spec.") &&
        !f.path.includes(".gate.test.")
    );
    const rpcCalls = new Set<string>();

    for (const file of srcFiles) {
      const matches = file.content.matchAll(
        /supabase\.rpc\(\s*['"]([a-z_]+)['"]/g
      );
      for (const match of matches) {
        rpcCalls.add(match[1]);
      }
    }

    const missing: string[] = [];
    for (const rpc of rpcCalls) {
      if (!functionNames.has(rpc)) {
        missing.push(rpc);
      }
    }

    expect(missing).toEqual([]);
  });
});

/* ====================================================================
 * 6. HOOK CONVENTIONS — pattern dodržení
 * ==================================================================== */

describe("Hook konvence", () => {
  it("žádné přímé .from() volání na sensitive data tabulky v src/ (mimo testy)", () => {
    const phiTables = [
      "health_check_ins",
      "lab_results",
      "dosing_logs",
      "profiles",
      "wearables_data",
      "chat_messages",
      "questionnaire_responses",
      "health_data_sync",
      "member_health_documents",
      "story_entries",
      "consents",
      "data_sharing_consents",
    ];

    const srcFiles = scanTsFilesRecursive(SRC_DIR).filter(
      (f) =>
        !f.path.includes("/tests/") &&
        !f.path.includes("/__tests__/") &&
        !f.path.includes(".test.") &&
        !f.path.includes(".spec.")
    );

    const violations: string[] = [];

    for (const file of srcFiles) {
      for (const table of phiTables) {
        const regex = new RegExp(
          `\\.from\\s*\\(\\s*['"]${table}['"]\\s*\\)`,
          "g"
        );
        if (regex.test(file.content)) {
          const rel = path.relative(ROOT, file.path);
          violations.push(`${rel}: .from("${table}")`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

/* ====================================================================
 * 7. TYPY — Generované typy existují
 * ==================================================================== */

describe("Generované typy", () => {
  it("types.ts existuje a není prázdný", () => {
    const typesPath = path.join(
      ROOT,
      "src/integrations/db/types.ts"
    );
    expect(fs.existsSync(typesPath)).toBe(true);
    const stat = fs.statSync(typesPath);
    // Generovaný types.ts by měl mít alespoň 10KB
    expect(stat.size).toBeGreaterThan(10_000);
  });

  it("types.ts exportuje Database typ", () => {
    const typesPath = path.join(
      ROOT,
      "src/integrations/db/types.ts"
    );
    const content = fs.readFileSync(typesPath, "utf-8");
    expect(content).toContain("export type Database");
  });
});

/* ====================================================================
 * 8. I18N — Klíčová integrita (doplňuje i18n testy)
 * ==================================================================== */

describe("i18n — kompilované soubory", () => {
  const localesDir = path.join(ROOT, "src/i18n/locales");

  it("en.json a cs.json existují", () => {
    expect(fs.existsSync(path.join(localesDir, "en.json"))).toBe(true);
    expect(fs.existsSync(path.join(localesDir, "cs.json"))).toBe(true);
  });

  it("en.json a cs.json jsou validní JSON", () => {
    const en = JSON.parse(
      fs.readFileSync(path.join(localesDir, "en.json"), "utf-8")
    );
    const cs = JSON.parse(
      fs.readFileSync(path.join(localesDir, "cs.json"), "utf-8")
    );
    expect(typeof en).toBe("object");
    expect(typeof cs).toBe("object");
    expect(Object.keys(en).length).toBeGreaterThan(0);
    expect(Object.keys(cs).length).toBeGreaterThan(0);
  });
});

/* ====================================================================
 * 9. PACKAGE.JSON — Povinné skripty
 * ==================================================================== */

describe("package.json — povinné skripty", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(ROOT, "package.json"), "utf-8")
  );

  const requiredScripts = [
    "dev",
    "build",
    "test:run",
    "lint",
    "db-mgr",
    "db-mgr:lint",
    "db-mgr:source",
  ];

  for (const script of requiredScripts) {
    it(`script "${script}" existuje`, () => {
      expect(pkg.scripts).toHaveProperty(script);
    });
  }
});

/* ====================================================================
 * 10. KONFIGURACE — Build-related soubory
 * ==================================================================== */

describe("Build konfigurace", () => {
  const requiredFiles = [
    "tsconfig.json",
    "tsconfig.app.json",
    "vite.config.ts",
    "vitest.config.ts",
    "vitest.gates.config.ts",
    "tailwind.config.ts",
    "postcss.config.js",
    "index.html",
  ];

  for (const file of requiredFiles) {
    it(`${file} existuje`, () => {
      expect(fs.existsSync(path.join(ROOT, file))).toBe(true);
    });
  }

  it("tsconfig.app.json má strict: true", () => {
    // tsconfig soubory jsou JSONC — ruční čtení strict flagu
    const appContent = fs.readFileSync(
      path.join(ROOT, "tsconfig.app.json"),
      "utf-8"
    );
    // Jednoduché hledání "strict": true — spolehlivější než JSONC parsing
    expect(/"strict"\s*:\s*true/.test(appContent)).toBe(true);
  });
});

/* ====================================================================
 * 11. ENUM KONZISTENCE — enums v SQL odpovídají TypeScript
 * ==================================================================== */

describe("SQL enum — soubory", () => {
  const enumsDir = path.join(SQL_DIR, "enums");

  it("enum soubory mají CREATE TYPE ... AS ENUM", () => {
    if (!fs.existsSync(enumsDir)) return;

    const files = fs
      .readdirSync(enumsDir)
      .filter((f) => f.endsWith(".sql"));
    const violations: string[] = [];

    for (const file of files) {
      const content = fs.readFileSync(path.join(enumsDir, file), "utf-8");
      if (!/CREATE\s+TYPE.*AS\s+ENUM/i.test(content)) {
        violations.push(file);
      }
    }

    expect(violations).toEqual([]);
  });
});

/* ====================================================================
 * 12. SECURITY — Žádné hardcoded credentials
 * ==================================================================== */

describe("Security — žádné hardcoded secrets v src/", () => {
  it("žádné hardcoded API klíče v produkčním kódu", () => {
    const srcFiles = scanTsFilesRecursive(SRC_DIR).filter(
      (f) =>
        !f.path.includes("/tests/") &&
        !f.path.includes("/__tests__/") &&
        !f.path.includes(".test.") &&
        !f.path.includes(".spec.") &&
        !f.path.includes("devFallback") // dev fallback je OK
    );

    const secretPatterns = [
      // Supabase keys (eyJ... jsou JWT tokeny)
      /(?:supabase_key|anon_key|service_role_key)\s*[:=]\s*['"]eyJ[A-Za-z0-9_-]+/i,
      // Explicit passwords (ne placeholder)
      /(?:password|secret)\s*[:=]\s*['"][^'"]{8,}['"]/i,
    ];

    const violations: string[] = [];

    for (const file of srcFiles) {
      for (const pattern of secretPatterns) {
        if (pattern.test(file.content)) {
          const rel = path.relative(ROOT, file.path);
          violations.push(`${rel}: potenciální hardcoded secret`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

/* ====================================================================
 * 13. SQL INDEXES — source of truth integrita
 * ==================================================================== */

describe("SQL indexes — source of truth integrita", () => {
  const indexFiles = readSqlFiles(INDEXES_DIR);
  const tableFiles = readSqlFiles(TABLES_DIR);

  /**
   * Extract all constraint names PostgreSQL would auto-generate from a table definition.
   * Covers: explicit CONSTRAINT, inline UNIQUE(cols), and column-level UNIQUE.
   */
  function extractTableConstraintNames(
    tableName: string,
    sql: string
  ): Set<string> {
    const names = new Set<string>();

    // Explicit: CONSTRAINT name UNIQUE/PRIMARY KEY
    const explicitRe =
      /CONSTRAINT\s+("([^"]+)"|([a-zA-Z_][a-zA-Z0-9_]*))\s+(?:UNIQUE|PRIMARY\s+KEY)/gi;
    let m: RegExpExecArray | null;
    while ((m = explicitRe.exec(sql)) !== null) {
      names.add((m[2] ?? m[3]).toLowerCase());
    }

    // Inline table-level: UNIQUE(col1, col2, ...)
    const inlineRe = /(?<!\bCONSTRAINT\s+\S+\s+)UNIQUE\s*\(([^)]+)\)/gi;
    while ((m = inlineRe.exec(sql)) !== null) {
      const cols = m[1]
        .split(",")
        .map((c) =>
          c
            .trim()
            .replace(/^"|"$/g, "")
            .toLowerCase()
        );
      names.add(`${tableName}_${cols.join("_")}_key`);
    }

    // Column-level: colname type [...] UNIQUE
    const colRe =
      /^\s+("([^"]+)"|([a-zA-Z_][a-zA-Z0-9_]*))\s+[a-zA-Z][a-zA-Z0-9_() ]*?\bUNIQUE\b/gim;
    while ((m = colRe.exec(sql)) !== null) {
      const col = (m[2] ?? m[3]).toLowerCase();
      names.add(`${tableName}_${col}_key`);
    }

    return names;
  }

  // Build set of ALL constraint names across all tables
  const allConstraintNames = new Set<string>();
  for (const table of tableFiles) {
    const cleanSql = stripSqlComments(table.content);
    const tableNameMatch = cleanSql.match(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?("([^"]+)"|([a-zA-Z_][a-zA-Z0-9_]*))/i
    );
    if (!tableNameMatch) continue;
    const tableName = (
      tableNameMatch[2] ?? tableNameMatch[3]
    ).toLowerCase();
    const names = extractTableConstraintNames(tableName, cleanSql);
    for (const n of names) allConstraintNames.add(n);
  }

  it("žádné duplicitní index soubory (index = kopie tabulkového CONSTRAINT)", () => {
    const duplicates: string[] = [];

    for (const idx of indexFiles) {
      // Extract index name from CREATE [UNIQUE] INDEX [IF NOT EXISTS] name
      const nameMatch = idx.content.match(
        /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?("([^"]+)"|([a-zA-Z_][a-zA-Z0-9_]*))/i
      );
      if (!nameMatch) continue;
      const idxName = (nameMatch[2] ?? nameMatch[3]).toLowerCase();

      if (allConstraintNames.has(idxName)) {
        duplicates.push(
          `${idx.name}.sql: index "${idxName}" duplicates a CONSTRAINT already defined in the table — remove the index file`
        );
      }
    }

    expect(duplicates).toEqual([]);
  });

  it("index soubory mají povinný -- Index: header", () => {
    const missing: string[] = [];

    for (const idx of indexFiles) {
      const firstLines = idx.content.split("\n").slice(0, 8);
      const hasMarker = firstLines.some((line) =>
        line.trim().startsWith("-- Index:")
      );
      if (!hasMarker) {
        missing.push(`${idx.name}.sql: chybí "-- Index:" header marker`);
      }
    }

    expect(missing).toEqual([]);
  });

  it("index soubory obsahují CREATE INDEX příkaz", () => {
    const invalid: string[] = [];

    for (const idx of indexFiles) {
      if (!/create\s+(unique\s+)?index/i.test(idx.content)) {
        invalid.push(
          `${idx.name}.sql: neobsahuje CREATE [UNIQUE] INDEX příkaz`
        );
      }
    }

    expect(invalid).toEqual([]);
  });

  it("index soubory odkazují na existující tabulky", () => {
    const tableNames = new Set(
      tableFiles
        .map((t) => {
          const m = stripSqlComments(t.content).match(
            /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?("([^"]+)"|([a-zA-Z_][a-zA-Z0-9_]*))/i
          );
          return m ? (m[2] ?? m[3]).toLowerCase() : "";
        })
        .filter(Boolean)
    );

    const orphans: string[] = [];

    // Use CREATE INDEX ... ON tablename pattern to avoid matching comments
    const indexOnTableRe =
      /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?\S+\s+ON\s+(?:public\.)?("([^"]+)"|([a-zA-Z_][a-zA-Z0-9_]*))/gi;

    for (const idx of indexFiles) {
      const matches = [...idx.content.matchAll(indexOnTableRe)];
      const referencedTables = new Set(
        matches.map((m) => (m[2] ?? m[3]).toLowerCase())
      );

      for (const refTable of referencedTables) {
        if (!tableNames.has(refTable)) {
          orphans.push(
            `${idx.name}.sql: odkazuje na tabulku "${refTable}" která neexistuje v aisha/db/sql/tables/`
          );
        }
      }
    }

    expect(orphans).toEqual([]);
  });

  it("název souboru odpovídá názvu indexu uvnitř (1 soubor = 1 index, pojmenovaný po indexu)", () => {
    const mismatches: string[] = [];
    const multiIndex: string[] = [];

    const createIndexRe =
      /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?("([^"]+)"|([a-zA-Z_][a-zA-Z0-9_]*))/gi;

    for (const idx of indexFiles) {
      const matches = [...idx.content.matchAll(createIndexRe)];

      if (matches.length === 0) continue; // caught by other test

      if (matches.length > 1) {
        multiIndex.push(
          `${idx.name}.sql: obsahuje ${matches.length} CREATE INDEX příkazů — 1 soubor = 1 index`
        );
        continue;
      }

      const indexName = (
        matches[0][2] ?? matches[0][3]
      ).toLowerCase();
      const fileName = idx.name.toLowerCase();

      if (fileName !== indexName) {
        mismatches.push(
          `${idx.name}.sql: soubor "${fileName}" ≠ index "${indexName}" — soubor musí být pojmenován po indexu`
        );
      }
    }

    expect(
      [...multiIndex, ...mismatches],
      "Index soubory musí být pojmenovány po indexu (ne po tabulce)"
    ).toEqual([]);
  });
});
