#!/usr/bin/env node
/*
 * Generates a single "init" Supabase migration from file-based source-of-truth SQL.
 *
 * This intentionally avoids DB queries — everything is derived from aisha/db/sql/.
 *
 * Output: aisha/db/migrations/00000000000000_baseline.sql
 *
 * Adapted for the AISHA Platform.
 */

import fs from "fs";
import path from "path";
import { isDirectRun } from "../lib/cli-entry.mjs";
import { porovnej } from "../lib/razeni.mjs";

const repoRoot = process.cwd();
// Source-of-truth SQL location. Migrated from `supabase/sql/` → `aisha/db/sql/`
// during AISHA rebrand (commit 2272e5f2). baseline-meta.json declares
// `source: "aisha/db/sql/"` — keep this in sync with that contract.
const aishaSqlRoot = path.resolve(repoRoot, "aisha/db/sql");
const migrationsDir = path.resolve(repoRoot, "aisha/db/migrations");
const baselineMetaPath = path.resolve(repoRoot, "aisha/db/baseline-meta.json");

// Use fixed name for baseline migration to track changes in git
// Note: Supabase skips migrations named "_init", so we use "_baseline"
const outputFile = path.join(migrationsDir, "00000000000000_baseline.sql");

const cliArgs = new Set(process.argv.slice(2));
const LINT_WARN_ONLY = cliArgs.has("--warn-only");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readUtf8(filePath) {
  return fs.readFileSync(filePath, "utf-8");
}

function listSqlFiles(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs
    .readdirSync(dirPath)
    .filter((name) => name.toLowerCase().endsWith(".sql"))
    .map((name) => path.join(dirPath, name))
    .sort((a, b) => porovnej(a, b));
}



function hasHeaderMarker(sql, marker) {
  return sql.split("\n").slice(0, 8).some((line) => line.trim().startsWith(marker));
}

function sectionHeader(title, count) {
  return `\n-- =============================================================================\n-- ${title} (${count})\n-- =============================================================================\n`;
}

function fileHeader(relativePath) {
  return `\n-- -----------------------------------------------------------------------------\n-- File: ${relativePath}\n-- -----------------------------------------------------------------------------\n`;
}

function normalizeNewlines(sql) {
  return sql.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function dedupeListPreserveOrder(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = item.trim();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function normalizeConstraintColumnLists(sql) {
  const patterns = [
    { re: /\bUNIQUE\s*\(([^)]+)\)/gi },
    { re: /\bPRIMARY\s+KEY\s*\(([^)]+)\)/gi },
  ];

  let out = sql;
  for (const { re } of patterns) {
    out = out.replace(re, (full, inner) => {
      const parts = String(inner)
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
      const deduped = dedupeListPreserveOrder(parts);
      return full.replace(inner, deduped.join(", "));
    });
  }
  return out;
}

function normalizeTableSqlForInit(tableSql) {
  let sql = normalizeConstraintColumnLists(normalizeNewlines(tableSql));
  // Strip embedded CREATE TRIGGER statements — they belong in the TRIGGERS section
  // and reference functions that don't exist yet at table creation time.
  sql = sql.replace(/--\s*(?:Updated_at\s+)?[Tt]rigger[^\n]*\n(?:CREATE\s+TRIGGER[\s\S]*?;)/gi, "");
  return sql.trimEnd() + "\n";
}

function extractConstraintNames(tableSql) {
  const names = new Set();
  const constraintRegex = /CONSTRAINT\s+("[^"]+"|[a-zA-Z_][a-zA-Z0-9_]*)\s+(?:UNIQUE|PRIMARY\s+KEY)/gi;
  let match;
  while ((match = constraintRegex.exec(tableSql)) !== null) {
    const name = match[1].replace(/^"|"$/g, "");
    names.add(name.toLowerCase());
  }

  const tableNameMatch = tableSql.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?("[^"]+"|[a-zA-Z_][a-zA-Z0-9_]*)/i);
  if (tableNameMatch) {
    const tableName = tableNameMatch[1].replace(/^"|"$/g, "").toLowerCase();

    const inlineUniqueRegex = /(?<!\bCONSTRAINT\s+\S+\s+)UNIQUE\s*\(([^)]+)\)/gi;
    let uMatch;
    while ((uMatch = inlineUniqueRegex.exec(tableSql)) !== null) {
      const cols = uMatch[1].split(",").map((c) => c.trim().replace(/^"|"$/g, "").toLowerCase());
      const autoName = `${tableName}_${cols.join("_")}_key`;
      names.add(autoName);
    }

    const colUniqueRegex = /^\s+("[^"]+"|[a-zA-Z_][a-zA-Z0-9_]*)\s+[a-zA-Z][a-zA-Z0-9_() ]*?\bUNIQUE\b/gim;
    let cMatch;
    while ((cMatch = colUniqueRegex.exec(tableSql)) !== null) {
      const colName = cMatch[1].replace(/^"|"$/g, "").toLowerCase();
      const autoName = `${tableName}_${colName}_key`;
      names.add(autoName);
    }
  }

  return names;
}

function ensureTrailingNewline(sql) {
  return sql.endsWith("\n") ? sql : `${sql}\n`;
}

function listNonBaselineMigrationFiles() {
  if (!fs.existsSync(migrationsDir)) return [];
  return fs
    .readdirSync(migrationsDir)
    .filter((name) => name.toLowerCase().endsWith(".sql") && name !== path.basename(outputFile))
    .sort((a, b) => porovnej(a, b));
}

// ---------------------------------------------------------------------------
// baseline-meta `pending_migrations` semantics
// ---------------------------------------------------------------------------
//
// IMPORTANT: despite the field name, `pending_migrations` is the input that
// `scripts/db/migrate.mjs` reads (as `baselineSnapshotMigrations`) and
// interprets as "migrations covered by the regenerated baseline — mark them
// applied without re-running". See migrate.mjs §"baselineReady" branch.
//
// If a migration is in this list but its content (CREATE TABLE / INDEX / etc.)
// is NOT actually in the regenerated baseline.sql, the migrate runner marks
// it applied + skips it -> ghost-applied migration -> schema diverges from
// tracking -> tenant hook / downstream seeds fail looking up the missing
// table. We hit this exact failure mode on acme staging 2026-05-24:
// 15 acme/* migrations marked applied but tables never created.
//
// A migration is "absorbed" by baseline iff:
//   1. It declares at least one CREATE TABLE / CREATE INDEX / CREATE FUNCTION /
//      CREATE VIEW / CREATE TYPE / CREATE SEQUENCE (schema migration, not
//      pure data migration), AND
//   2. EVERY such created relation is present in baseline.sql.
//
// Migrations that only INSERT/UPDATE/ALTER (pure data or post-baseline
// alterations) are NEVER absorbed — baseline.sql is generated from
// `aisha/db/sql/` (source-of-truth DDL), which contains no DML. Data
// migrations must always be applied separately.
//
// This invariant is also enforced as a gate test:
//   src/tests/gates/baseline-meta-pending-migrations-truly-absorbed.gate.test.ts

function stripSqlCommentsForAnalysis(sql) {
  // Line comments + block comments. SQL strings containing `--` won't be
  // affected by the line-comment strip because we only strip on the OUTSIDE
  // of single-quoted strings, but for analysis purposes a coarse strip is
  // safe (we only look for CREATE keywords, not string content).
  return sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// Match top-level `CREATE [OR REPLACE] [UNIQUE] TABLE|INDEX|FUNCTION|VIEW|TYPE|SEQUENCE [IF NOT EXISTS] [schema.]name`.
// Returns lowercased relation names (schema prefix stripped).
function extractCreatedRelations(migrationSql) {
  const stripped = stripSqlCommentsForAnalysis(migrationSql);
  const re =
    /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:UNIQUE\s+)?(?:TABLE|INDEX|FUNCTION|VIEW|MATERIALIZED\s+VIEW|TYPE|SEQUENCE|TRIGGER)\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(?:"[^"]+"|[a-zA-Z_][a-zA-Z0-9_]*)\.)?("[^"]+"|[a-zA-Z_][a-zA-Z0-9_]*)/gi;
  const names = new Set();
  for (const m of stripped.matchAll(re)) {
    names.add(m[1].replace(/^"|"$/g, "").toLowerCase());
  }
  return [...names];
}

// True iff `relationName` (lowercased, unquoted) appears as a CREATE TABLE/...
// in baselineSql. We require a CREATE-side match to avoid false positives
// from REFERENCES / FROM / etc. usages.
function baselineDefinesRelation(baselineSql, relationName) {
  const escaped = relationName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `\\bCREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:UNIQUE\\s+)?(?:TABLE|INDEX|FUNCTION|VIEW|MATERIALIZED\\s+VIEW|TYPE|SEQUENCE|TRIGGER)\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:(?:"[^"]+"|[a-zA-Z_][a-zA-Z0-9_]*)\\.)?"?${escaped}"?\\b`,
    "i",
  );
  return re.test(baselineSql);
}

function isMigrationAbsorbedByBaseline(migrationAbsPath, baselineSql) {
  const sql = readUtf8(migrationAbsPath);
  const created = extractCreatedRelations(sql);
  if (created.length === 0) return false; // Pure data migration — never absorbed
  return created.every((rel) => baselineDefinesRelation(baselineSql, rel));
}

function classifyMigrationsAgainstBaseline(migrationsList, baselineSqlPath) {
  if (!fs.existsSync(baselineSqlPath)) {
    // No baseline file → can't reason about coverage. Conservatively treat
    // everything as not-absorbed so the migrate runner will apply each one.
    return { absorbed: [], notAbsorbed: migrationsList };
  }
  const baselineSql = readUtf8(baselineSqlPath);
  const absorbed = [];
  const notAbsorbed = [];
  for (const name of migrationsList) {
    const abs = path.join(migrationsDir, name);
    if (isMigrationAbsorbedByBaseline(abs, baselineSql)) {
      absorbed.push(name);
    } else {
      notAbsorbed.push(name);
    }
  }
  return { absorbed, notAbsorbed };
}

function syncBaselineMeta({ outputFile: builtOutputFile, sourceFileCount, contentChanged = true }) {
  // Razítko se posune JEN když se obsah opravdu změnil. Tikající razítko při
  // nulové změně dělá z meta pohyblivý cíl a vyrábí konflikty z ničeho —
  // přesně to, co refresh-baseline-from-main.mjs popisuje jako tichý rozpor.
  const previousMeta = fs.existsSync(baselineMetaPath)
    ? JSON.parse(readUtf8(baselineMetaPath))
    : {};
  const now = contentChanged
    ? new Date().toISOString()
    : (previousMeta?.baseline?.refreshed_at ?? new Date().toISOString());
  const existing = fs.existsSync(baselineMetaPath)
    ? JSON.parse(readUtf8(baselineMetaPath))
    : {};

  const allNonBaselineMigrations = listNonBaselineMigrationFiles();
  const { absorbed, notAbsorbed } = classifyMigrationsAgainstBaseline(
    allNonBaselineMigrations,
    builtOutputFile,
  );

  // `pending_migrations` keeps its existing contract with migrate.mjs:
  // migrations the runner can mark-applied without re-running because they
  // are already present in the regenerated baseline.sql.
  const pendingMigrations = absorbed;

  // `deferred_migrations` is informational — lists what the runner WILL apply
  // on top of baseline. Includes tenant-specific migrations (instance
  // overlays, e.g. acme/*, …) whose content lives only in aisha/db/migrations/ and is
  // never absorbed by the regenerated baseline.
  const deferredMigrations = notAbsorbed;

  const next = {
    ...existing,
    $schema: "./baseline-meta.schema.json",
    description:
      "Tracks baseline + seed version state. Updated by db:init:generate / refreshdb.sh. Do NOT edit manually.",
    baseline: {
      ...(existing.baseline ?? {}),
      refreshed_at: now,
      source: "aisha/db/sql/",
      output: path.relative(repoRoot, builtOutputFile),
      file_count: sourceFileCount,
      note:
        allNonBaselineMigrations.length === 0
          ? "Baseline refreshed — source-of-truth fully folded in and no non-baseline migrations remain on disk"
          : `Baseline refreshed — ${absorbed.length} absorbed (auto-skipped by runner), ${notAbsorbed.length} deferred (runner will apply on top)`,
    },
    seed:
      existing.seed ?? {
        refreshed_at: now,
        source_dirs: [],
        output: "aisha/db/seed.compiled.sql",
      },
    pending_migrations: pendingMigrations,
    deferred_migrations: deferredMigrations,
    compatibility_note:
      existing.compatibility_note ??
      "Seeds were written for baseline schema. When migrations alter table structure, regenerate baseline and resync seeds.",
  };

  fs.writeFileSync(baselineMetaPath, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
}

// ---------------------------------------------------------------------------
// Policy parsing helpers
// ---------------------------------------------------------------------------

function unescapeSqlIdentifier(identifier) {
  return identifier.replace(/""/g, '"');
}

function escapeSqlIdentifier(identifier) {
  return identifier.replace(/"/g, '""');
}

function parsePolicyCreateStatement(statement) {
  const re =
    /CREATE\s+POLICY\s+(?:"((?:[^"]|"")*)"|([a-zA-Z_][\w$]*))\s+ON\s+((?:(?:"[^"]+")|[a-zA-Z_][\w$]*)(?:\.(?:(?:"[^"]+")|[a-zA-Z_][\w$]*))?)/i;
  const m = statement.match(re);
  if (!m) return null;

  const quotedName = m[1];
  const bareName = m[2];
  const relationRaw = m[3];

  const name = quotedName != null ? unescapeSqlIdentifier(quotedName) : bareName;
  if (!name || !relationRaw) return null;

  const relation = relationRaw.includes(".") ? relationRaw : `public.${relationRaw}`;
  return { name, relation, escapedName: escapeSqlIdentifier(name) };
}

function addDropPolicyIfExists(statement) {
  const parsed = parsePolicyCreateStatement(statement);
  if (!parsed) return statement;
  const drop = `DROP POLICY IF EXISTS "${parsed.escapedName}" ON ${parsed.relation};`;
  return `${drop}\n${statement}`;
}

// ---------------------------------------------------------------------------
// Konec SQL příkazu — skenerem, NE regexem
// ---------------------------------------------------------------------------
//
// ⛔ NAMĚŘENO 2026-09-03. Tady stálo `/CREATE\s+POLICY[\s\S]*?;/gi`, tedy „ber
// znaky až k PRVNÍMU středníku". Středník ale žije i v komentáři, v řetězci a
// v dolarových uvozovkách. Policy `li_source_registry_read` má v těle český
// komentář končící „…jsou přitom na dokladu;" — a přesně tam ji generátor
// uřízl: do baseline prošlo 24 řádků z 92, včetně otevřené závorky `USING (`.
//
// Cold start pak spadl `syntax error at or near "DROP"` o 9 000 řádků DÁL, na
// posledním řádku souboru — parser hlásí, kde mu došlo, ne kde je vada. Nic
// mezitím nebylo červené: generátor doběhl, brány byly zelené, baseline vypadal
// hotově. Vada se projeví AŽ pokusem o přehrání do skutečné databáze.
//
// Konec příkazu se tedy musí HLEDAT SKENEREM, který ví, kde je text kódem:
// řádkové `--`, blokové `/* */` (v Postgresu se vnořují), `'…''…'`, `"…"`
// a `$tag$…$tag$`.
function findStatementEnd(sql, from) {
  let i = from;

  while (i < sql.length) {
    const ch = sql[i];

    if (ch === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i);
      if (nl === -1) return sql.length;
      i = nl + 1;
      continue;
    }

    if (ch === "/" && sql[i + 1] === "*") {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") { depth += 1; i += 2; continue; }
        if (sql[i] === "*" && sql[i + 1] === "/") { depth -= 1; i += 2; continue; }
        i += 1;
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      i += 1;
      while (i < sql.length) {
        if (sql[i] === ch) {
          if (sql[i + 1] === ch) { i += 2; continue; }  // zdvojený = escape
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    if (ch === "$") {
      const m = sql.slice(i).match(/^\$[A-Za-z_]\w*\$|^\$\$/);
      if (m) {
        const tag = m[0];
        const close = sql.indexOf(tag, i + tag.length);
        if (close === -1) return sql.length;
        i = close + tag.length;
        continue;
      }
    }

    if (ch === ";") return i + 1;
    i += 1;
  }

  // ⛔ NEUKONČENÝ PŘÍKAZ NENÍ PŘÍKAZ. Vracet konec vstupu by znamenalo vydat
  // půlku za celek — a přesně to je vada, kvůli které tenhle skener vznikl:
  // uříznutá policy prošla do baseline a psql spadl 9 000 řádků od příčiny.
  // Vada VSTUPU není důvod tvářit se, že jsme něco našli.
  //
  // ⭐ Tuhle přísnost má verze z větve `feat/narok-na-doklad-strukturalne`,
  // která tentýž problém řešila nezávisle (`statementEndIndex`). Moje původní
  // verze vracela `sql.length`; její test to odhalil. Sloučeno: implementace
  // odsud, tahle vlastnost odtamtud.
  return -1;
}

// Rozdělí SQL na příkazy. Každý úsek je SOUVISLÝ (nese i komentáře a mezery,
// které mu předcházejí), takže spojením úseků vznikne původní text beze změny.
function splitSqlStatements(sql) {
  const chunks = [];
  let i = 0;
  while (i < sql.length) {
    const end = findStatementEnd(sql, i);
    // ⛔ DVĚ VLASTNOSTI NARAZ, a musí platit OBĚ:
    //  · rozdělení je BEZEZTRÁTOVÉ — spojením úseků vznikne původní text,
    //    takže zbytek za posledním středníkem (komentáře, prázdné řádky)
    //    nesmí zmizet;
    //  · neukončený příkaz NENÍ příkaz — nesmí se vydat za celý.
    // Proto se zbytek zachová jako úsek, ale označí `ukonceny: false`;
    // konzument ho pak vědomě přeskočí místo aby ho tiše zpracoval.
    if (end === -1) {
      const zbytek = sql.slice(i);
      if (zbytek) chunks.push({ start: i, end: sql.length, text: zbytek, ukonceny: false });
      break;
    }
    if (end <= i) break;
    chunks.push({ start: i, end, text: sql.slice(i, end), ukonceny: true });
    i = end;
  }
  return chunks;
}

// Kde v úseku začíná samotný příkaz — tedy za vedoucími mezerami a komentáři.
function statementBodyStart(chunk) {
  let i = 0;
  while (i < chunk.length) {
    const ch = chunk[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") { i += 1; continue; }
    if (ch === "-" && chunk[i + 1] === "-") {
      const nl = chunk.indexOf("\n", i);
      if (nl === -1) return chunk.length;
      i = nl + 1;
      continue;
    }
    if (ch === "/" && chunk[i + 1] === "*") {
      let depth = 1;
      i += 2;
      while (i < chunk.length && depth > 0) {
        if (chunk[i] === "/" && chunk[i + 1] === "*") { depth += 1; i += 2; continue; }
        if (chunk[i] === "*" && chunk[i + 1] === "/") { depth -= 1; i += 2; continue; }
        i += 1;
      }
      continue;
    }
    return i;
  }
  return chunk.length;
}

const CREATE_POLICY_HEAD = /^CREATE\s+POLICY\b/i;

function extractPolicyStatements(sql) {
  const statements = [];

  for (const chunk of splitSqlStatements(sql)) {
    // Neukončený úsek se NEVYDÁVÁ za policy — právě tím vznikala uříznutá.
    if (chunk.ukonceny === false) continue;
    const body = chunk.text.slice(statementBodyStart(chunk.text));
    if (!CREATE_POLICY_HEAD.test(body.trim())) continue;
    const statement = body.trim();
    const parsed = parsePolicyCreateStatement(statement);
    statements.push({
      name: parsed?.name ?? null,
      relation: parsed?.relation ?? null,
      statement: addDropPolicyIfExists(statement),
    });
  }

  return statements;
}

function addDropPoliciesToSql(sql) {
  const normalized = normalizeNewlines(sql);

  return splitSqlStatements(normalized)
    .map((chunk) => {
      if (chunk.ukonceny === false) return chunk.text;
      const bodyAt = statementBodyStart(chunk.text);
      const body = chunk.text.slice(bodyAt);
      if (!CREATE_POLICY_HEAD.test(body.trim())) return chunk.text;
      const parsed = parsePolicyCreateStatement(body.trim());
      if (!parsed) return chunk.text;
      const drop = `DROP POLICY IF EXISTS "${parsed.escapedName}" ON ${parsed.relation};`;
      // DROP patří TĚSNĚ před příkaz, ne před jeho komentáře — ty zůstávají nahoře.
      return `${chunk.text.slice(0, bodyAt)}${drop}\n${body.trim()}\n`;
    })
    .join("");
}

// ---------------------------------------------------------------------------
// Parenthesized expression parsing (for function signature lint)
// ---------------------------------------------------------------------------

function findMatchingParenIndex(sql, openParenIndex) {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inDollar = false;
  let dollarTag = "";

  for (let i = openParenIndex; i < sql.length; i += 1) {
    const ch = sql[i];

    if (inDollar) {
      if (ch === "$" && dollarTag && sql.startsWith(dollarTag, i)) {
        inDollar = false;
        i += dollarTag.length - 1;
        dollarTag = "";
      }
      continue;
    }

    if (!inSingle && !inDouble && ch === "$") {
      const m = sql.slice(i).match(/^\$[a-zA-Z_][\w]*\$|^\$\$/);
      if (m?.[0]) {
        inDollar = true;
        dollarTag = m[0];
        i += dollarTag.length - 1;
        continue;
      }
    }

    if (!inDouble && ch === "'" && sql[i - 1] !== "\\") {
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle && ch === '"' && sql[i - 1] !== "\\") {
      inDouble = !inDouble;
      continue;
    }
    if (inSingle || inDouble) continue;

    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitTopLevelCommaList(input) {
  const parts = [];
  let current = "";
  let depthRound = 0;
  let depthSquare = 0;
  let depthCurly = 0;
  let inSingle = false;
  let inDouble = false;
  let inDollar = false;
  let dollarTag = "";

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];

    if (inDollar) {
      current += ch;
      if (ch === "$" && dollarTag && input.startsWith(dollarTag, i)) {
        inDollar = false;
        current += input.slice(i + 1, i + dollarTag.length);
        i += dollarTag.length - 1;
        dollarTag = "";
      }
      continue;
    }

    if (!inSingle && !inDouble && ch === "$") {
      const m = input.slice(i).match(/^\$[a-zA-Z_][\w]*\$|^\$\$/);
      if (m?.[0]) {
        inDollar = true;
        dollarTag = m[0];
        current += dollarTag;
        i += dollarTag.length - 1;
        continue;
      }
    }

    if (!inDouble && ch === "'" && input[i - 1] !== "\\") {
      inSingle = !inSingle;
      current += ch;
      continue;
    }
    if (!inSingle && ch === '"' && input[i - 1] !== "\\") {
      inDouble = !inDouble;
      current += ch;
      continue;
    }

    if (!inSingle && !inDouble) {
      if (ch === "(") depthRound += 1;
      else if (ch === ")") depthRound = Math.max(0, depthRound - 1);
      else if (ch === "[") depthSquare += 1;
      else if (ch === "]") depthSquare = Math.max(0, depthSquare - 1);
      else if (ch === "{") depthCurly += 1;
      else if (ch === "}") depthCurly = Math.max(0, depthCurly - 1);
      else if (ch === "," && depthRound === 0 && depthSquare === 0 && depthCurly === 0) {
        parts.push(current.trim());
        current = "";
        continue;
      }
    }

    current += ch;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

function countArgsFromParenContent(parenContent) {
  const trimmed = parenContent.trim();
  if (!trimmed) return 0;
  return splitTopLevelCommaList(trimmed).length;
}

function countRequiredArgsFromParenContent(parenContent) {
  const trimmed = parenContent.trim();
  if (!trimmed) return 0;

  const args = splitTopLevelCommaList(trimmed);
  let required = 0;

  for (const arg of args) {
    const a = arg.trim();
    if (!a) continue;
    const hasDefault = /\bdefault\b/i.test(a) || /=/.test(a);
    if (!hasDefault) required += 1;
  }

  return required;
}

function stripSqlIdentifierQuotes(identifier) {
  return identifier.replace(/^"|"$/g, "");
}

// ---------------------------------------------------------------------------
// Function signature index + lint
// ---------------------------------------------------------------------------

// Mask the CONTENT of SQL comments and single-quoted string literals so the
// grant/call regexes below only ever match real executable SQL. Without this a
// header line such as
//   -- Function: public.record_model_reliability  (L1 — REPLACE writer …)
// is parsed as a 1-arg CALL to record_model_reliability and trips
// `call-missing-overload` (a false positive), because the `(L1 …)` prose reads
// as a parenthesised argument list.
//
// Implementation notes:
//   • Masked characters are overwritten in place with spaces (newlines kept),
//     so the byte offsets that findMatchingParenIndex()/slice() rely on remain
//     valid. Callers MUST run their regexes against the masked text returned
//     here — not the raw source — for the offsets to line up.
//   • Dollar-quoted bodies ($$ … $$, $tag$ … $tag$) are intentionally left
//     intact: genuine schema-qualified calls live inside plpgsql/SQL function
//     bodies and must still be linted. Comments and single-quoted strings that
//     appear *inside* a body are still masked, which is exactly what we want
//     for executable-call analysis (e.g. a `public.foo(` mentioned in a RAISE
//     EXCEPTION message must not register as a call).
//   • A single combined pass (rather than sequential regex strips) ensures a
//     `--` inside a string literal, or a `'` inside a comment, is never
//     misread as opening the other construct.
function maskSqlForLint(sql) {
  const out = sql.split("");
  const blankRange = (start, end) => {
    for (let j = start; j < end && j < out.length; j += 1) {
      if (out[j] !== "\n") out[j] = " ";
    }
  };

  for (let i = 0; i < sql.length; ) {
    const ch = sql[i];
    const next = sql[i + 1];

    // `-- line comment` → end of line (the newline itself is preserved).
    if (ch === "-" && next === "-") {
      let j = i + 2;
      while (j < sql.length && sql[j] !== "\n") j += 1;
      blankRange(i, j);
      i = j;
      continue;
    }

    // `/* block comment */` — non-nested, matching stripSqlCommentsForAnalysis.
    if (ch === "/" && next === "*") {
      let j = i + 2;
      while (j < sql.length && !(sql[j] === "*" && sql[j + 1] === "/")) j += 1;
      const end = Math.min(sql.length, j + 2);
      blankRange(i, end);
      i = end;
      continue;
    }

    // `'single-quoted string'` — Postgres doubles '' to embed a literal quote.
    if (ch === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2; // escaped quote — stay inside the string
            continue;
          }
          break; // closing quote
        }
        j += 1;
      }
      blankRange(i + 1, j); // keep the delimiting quotes, blank the body
      i = j + 1;
      continue;
    }

    i += 1;
  }

  return out.join("");
}

function buildFunctionSignatureIndex(functionFilePaths) {
  const exactIndex = new Map();
  const rangeIndex = new Map();

  for (const filePath of functionFilePaths) {
    // Mask comments/strings so a commented-out or documented signature is never
    // registered as a real overload (see maskSqlForLint).
    const sql = maskSqlForLint(normalizeNewlines(readUtf8(filePath)));
    const re = /\bcreate\s+or\s+replace\s+function\s+((?:(?:"[^"]+")|[a-zA-Z_][\w$]*)(?:\.(?:(?:"[^"]+")|[a-zA-Z_][\w$]*))?)\s*\(/gi;

    for (const match of sql.matchAll(re)) {
      const rawName = match[1];
      if (!rawName) continue;

      const openParenIndex = match.index + match[0].lastIndexOf("(");
      const closeParenIndex = findMatchingParenIndex(sql, openParenIndex);
      if (closeParenIndex < 0) continue;

      const parenContent = sql.slice(openParenIndex + 1, closeParenIndex);
      const argCount = countArgsFromParenContent(parenContent);
      const requiredArgCount = countRequiredArgsFromParenContent(parenContent);

      const parts = rawName.split(".").map((p) => stripSqlIdentifierQuotes(p));
      const schema = parts.length === 2 ? parts[0] : "public";
      const name = parts.length === 2 ? parts[1] : parts[0];

      const key = `${schema}.${name}`;
      if (!exactIndex.has(key)) exactIndex.set(key, new Set());
      exactIndex.get(key).add(argCount);

      if (!rangeIndex.has(key)) rangeIndex.set(key, []);
      rangeIndex.get(key).push({ minArgs: requiredArgCount, maxArgs: argCount, filePath });
    }
  }

  for (const [key, ranges] of rangeIndex.entries()) {
    const unique = new Map();
    for (const r of ranges) {
      unique.set(`${r.minArgs}-${r.maxArgs}`, { minArgs: r.minArgs, maxArgs: r.maxArgs });
    }
    rangeIndex.set(key, Array.from(unique.values()));
  }

  return { exactIndex, rangeIndex };
}

// Pure collector: scans the given function SoT files and returns the list of
// lint issues (never prints, never throws). Split out from lintFunctions() so
// it is unit-testable against fixture files (see the regression test).
function collectFunctionLintIssues(functionFilePaths) {
  const { exactIndex, rangeIndex } = buildFunctionSignatureIndex(functionFilePaths);
  const issues = [];

  for (const filePath of functionFilePaths) {
    // Lint only real executable SQL: a `public.foo(` in a header comment or a
    // string body must not be parsed as a call/grant (see maskSqlForLint).
    const sql = maskSqlForLint(normalizeNewlines(readUtf8(filePath)));
    const rel = path.relative(repoRoot, filePath);

    // 1) Validate GRANT signatures exist in source-of-truth.
    const grantRe = /\bgrant\s+execute\s+on\s+function\s+((?:(?:"[^"]+")|[a-zA-Z_][\w$]*)(?:\.(?:(?:"[^"]+")|[a-zA-Z_][\w$]*))?)\s*\(/gi;
    for (const match of sql.matchAll(grantRe)) {
      const rawName = match[1];
      if (!rawName) continue;

      const openParenIndex = match.index + match[0].lastIndexOf("(");
      const closeParenIndex = findMatchingParenIndex(sql, openParenIndex);
      if (closeParenIndex < 0) continue;

      const parenContent = sql.slice(openParenIndex + 1, closeParenIndex);
      const argCount = countArgsFromParenContent(parenContent);

      const parts = rawName.split(".").map((p) => stripSqlIdentifierQuotes(p));
      const schema = parts.length === 2 ? parts[0] : "public";
      const name = parts.length === 2 ? parts[1] : parts[0];
      const key = `${schema}.${name}`;

      const known = exactIndex.get(key);
      if (!known || !known.has(argCount)) {
        issues.push({
          type: "grant-missing-signature",
          file: rel,
          message: `GRANT EXECUTE references missing signature: ${key}(${argCount} args)`,
        });
      }
    }

    // 2) Validate schema-qualified calls to known public functions.
    const callRe = /\bpublic\.([a-zA-Z_][\w$]*)\s*\(/gi;
    for (const match of sql.matchAll(callRe)) {
      const name = match[1];
      if (!name) continue;

      const key = `public.${name}`;
      const knownRanges = rangeIndex.get(key);
      if (!knownRanges) continue;

      const openParenIndex = match.index + match[0].lastIndexOf("(");
      const closeParenIndex = findMatchingParenIndex(sql, openParenIndex);
      if (closeParenIndex < 0) continue;

      const parenContent = sql.slice(openParenIndex + 1, closeParenIndex);
      const argCount = countArgsFromParenContent(parenContent);

      const ok = knownRanges.some((r) => argCount >= r.minArgs && argCount <= r.maxArgs);
      if (!ok) {
        issues.push({
          type: "call-missing-overload",
          file: rel,
          message: `Call references missing overload: ${key}(${argCount} args)`,
        });
      }
    }
  }

  return issues;
}

function lintFunctions(functionFilePaths) {
  const issues = collectFunctionLintIssues(functionFilePaths);
  if (issues.length === 0) return;

  const grouped = issues.reduce((acc, item) => {
    acc[item.type] = acc[item.type] ?? [];
    acc[item.type].push(item);
    return acc;
  }, /** @type {Record<string, Array<{type:string,file:string,message:string}>>} */ ({}));

  console.log("\n⚠️  Preflight SQL lint found issues:");
  for (const [type, items] of Object.entries(grouped)) {
    console.log(`- ${type}: ${items.length}`);
    for (const it of items.slice(0, 15)) {
      console.log(`  - ${it.file}: ${it.message}`);
    }
    if (items.length > 15) {
      console.log(`  ... +${items.length - 15} more`);
    }
  }

  if (!LINT_WARN_ONLY) {
    throw new Error(
      `Preflight SQL lint failed with ${issues.length} issue(s). Fix source-of-truth SQL or re-run with --warn-only.`
    );
  }
}

// ---------------------------------------------------------------------------
// Topological sorting — Tables (by FK references)
// ---------------------------------------------------------------------------

function extractTableNameFromSql(tableSql, fallbackName) {
  const sql = normalizeNewlines(tableSql);

  // Primary: the actual CREATE TABLE identifier. This is authoritative and —
  // crucially — matches the bare table names produced by
  // detectReferencedTablesFromCreateTableSql, so FK dependency edges resolve
  // and the topological sort orders referenced tables before their dependants.
  const createMatch = sql.match(
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?("[^"]+"|[a-zA-Z_][a-zA-Z0-9_$]*)/i
  );
  if (createMatch) {
    return stripSqlIdentifierQuotes(createMatch[1]);
  }

  // Fallback: the `-- Table: <name> — <description>` header. Take only the
  // leading identifier token (up to the first whitespace) so the human-readable
  // em-dash description is not folded into the table name — otherwise the name
  // would never match a bare FK reference and the dependency edge is dropped.
  const headerLine = sql
    .split("\n")
    .slice(0, 20)
    .find((line) => line.trim().toLowerCase().startsWith("-- table:"));

  if (headerLine) {
    const raw = headerLine.split(":").slice(1).join(":").trim();
    const firstToken = raw.split(/\s+/u)[0];
    if (firstToken) return stripSqlIdentifierQuotes(firstToken);
  }

  return fallbackName;
}

function detectReferencedTablesFromCreateTableSql(tableSql) {
  const sql = normalizeNewlines(tableSql);
  const results = [];

  const re = /\breferences\s+((?:"[^"]+"|[a-zA-Z_][\w$]*)(?:\.(?:"[^"]+"|[a-zA-Z_][\w$]*))?)/gi;
  for (const match of sql.matchAll(re)) {
    const raw = match[1];
    if (!raw) continue;

    const parts = raw.split(".").map((p) => stripSqlIdentifierQuotes(p));
    const schema = parts.length === 2 ? parts[0] : null;
    const table = parts.length === 2 ? parts[1] : parts[0];

    if (schema && schema !== "public") continue;
    if (!table) continue;

    results.push(table);
  }

  return Array.from(new Set(results));
}

function buildTableOrder(tableFilePaths) {
  const tables = tableFilePaths
    .map((filePath) => {
      const fallbackName = path.basename(filePath, ".sql");
      const sql = normalizeTableSqlForInit(readUtf8(filePath));
      const name = extractTableNameFromSql(sql, fallbackName);
      return { name, filePath, sql };
    })
    .sort((a, b) => porovnej(a.name, b.name));

  const tableNameSet = new Set(tables.map((t) => t.name));

  const depsByName = new Map();
  for (const table of tables) {
    const deps = detectReferencedTablesFromCreateTableSql(table.sql).filter((dep) => {
      if (dep === table.name) return false;
      return tableNameSet.has(dep);
    });
    depsByName.set(table.name, deps.sort((a, b) => porovnej(a, b)));
  }

  // Kahn's algorithm
  const inDegree = new Map();
  const outgoing = new Map();
  for (const table of tables) {
    inDegree.set(table.name, 0);
    outgoing.set(table.name, []);
  }

  for (const [from, deps] of depsByName.entries()) {
    for (const dep of deps) {
      outgoing.get(dep)?.push(from);
      inDegree.set(from, (inDegree.get(from) ?? 0) + 1);
    }
  }

  const queue = Array.from(inDegree.entries())
    .filter(([_, deg]) => deg === 0)
    .map(([name]) => name)
    .sort((a, b) => porovnej(a, b));

  const orderedNames = [];
  while (queue.length > 0) {
    const name = queue.shift();
    if (!name) break;
    orderedNames.push(name);

    const next = outgoing.get(name) ?? [];
    for (const to of next) {
      inDegree.set(to, (inDegree.get(to) ?? 0) - 1);
      if (inDegree.get(to) === 0) {
        queue.push(to);
      }
    }
    queue.sort((a, b) => porovnej(a, b));
  }

  const remaining = tables.map((t) => t.name).filter((n) => !orderedNames.includes(n));
  const finalNames = [...orderedNames, ...remaining];
  return finalNames.map((name) => tables.find((t) => t.name === name));
}

// ---------------------------------------------------------------------------
// Topological sorting — Views (a view may SELECT from another view)
// ---------------------------------------------------------------------------
/**
 * Rozdělí pohledy na ty, které smí vzniknout hned po tabulkách, a „pozdní",
 * které volají uživatelskou funkci ze SoT (nebo stojí na jiném pozdním pohledu).
 * Pořadí uvnitř obou skupin zůstává z buildViewOrder. LANGUAGE sql funkce, která
 * čte pozdní pohled, je nesplnitelná závislost → výjimka.
 */
function splitViewsByFunctionDeps(orderedViewPaths, functionFilePaths) {
  const escape = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const fnNames = [...new Set(functionFilePaths.map((fp) => {
    const sql = stripSqlCommentsForAnalysis(normalizeNewlines(readUtf8(fp)));
    const m = sql.match(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:[\w"]+\.)?"?(\w+)"?\s*\(/i);
    return m ? m[1] : path.basename(fp, ".sql");
  }))];
  const views = orderedViewPaths.map((fp) => {
    const body = stripSqlCommentsForAnalysis(normalizeNewlines(readUtf8(fp)));
    const m = body.match(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+([\w.]+)/i);
    const full = m ? m[1] : path.basename(fp, ".sql");
    return { fp, full, body: body.replace(/^[\s\S]*?\bAS\b/i, " ") };
  });
  const late = new Set();
  for (const v of views) {
    if (fnNames.some((n) => new RegExp(`\\b${escape(n)}\\s*\\(`, "i").test(v.body))) late.add(v.full);
  }
  for (let zmena = true; zmena; ) {
    zmena = false;
    for (const v of views) {
      if (late.has(v.full)) continue;
      if ([...late].some((l) => new RegExp(`(?:\\bFROM\\b|\\bJOIN\\b|,)\\s+${escape(l)}\\b`, "i").test(v.body))) {
        late.add(v.full);
        zmena = true;
      }
    }
  }
  if (late.size > 0) {
    for (const fp of functionFilePaths) {
      const sql = stripSqlCommentsForAnalysis(normalizeNewlines(readUtf8(fp)));
      if (!/LANGUAGE\s+sql\b/i.test(sql)) continue;
      for (const l of late) {
        if (new RegExp(`(?:\\bFROM\\b|\\bJOIN\\b)\\s+${escape(l)}\\b`, "i").test(sql)) {
          throw new Error(
            `${path.relative(repoRoot, fp)}: LANGUAGE sql funkce čte pohled ${l}, který volá uživatelskou funkci — ` +
              `pohled musí vzniknout po funkcích, ale sql funkce se ověřuje při CREATE. Přepiš ji na plpgsql, ` +
              `nebo odstraň volání funkce z pohledu.`,
          );
        }
      }
    }
  }
  return {
    earlyViews: views.filter((v) => !late.has(v.full)).map((v) => v.fp),
    lateViews: views.filter((v) => late.has(v.full)).map((v) => v.fp),
  };
}

function buildViewOrder(viewFilePaths) {
  const views = viewFilePaths
    .map((filePath) => ({
      name: path.basename(filePath, ".sql"),
      filePath,
      sql: normalizeNewlines(readUtf8(filePath)),
    }))
    .sort((a, b) => porovnej(a.name, b.name));
  const nameSet = new Set(views.map((v) => v.name));

  const depsByName = new Map();
  for (const v of views) {
    // Strip comments + the leading CREATE VIEW ... AS header so we only detect
    // references in the actual query body (avoids false deps from comments /
    // self-name / column aliases, which would create spurious cycles).
    const body = stripSqlCommentsForAnalysis(v.sql).replace(/^[\s\S]*?\bAS\b/i, " ");
    const deps = new Set();
    for (const other of nameSet) {
      if (other === v.name) continue;
      // Only count a dependency when the other view is referenced after
      // FROM / JOIN / a comma (a relation position) — optionally public.-qualified.
      const re = new RegExp(`(?:\\bFROM\\b|\\bJOIN\\b|,)\\s+(?:public\\.)?${other.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (re.test(body)) deps.add(other);
    }
    depsByName.set(v.name, [...deps].sort((a, b) => porovnej(a, b)));
  }

  const inDegree = new Map();
  const outgoing = new Map();
  for (const v of views) {
    inDegree.set(v.name, 0);
    outgoing.set(v.name, []);
  }
  for (const [from, deps] of depsByName.entries()) {
    for (const dep of deps) {
      outgoing.get(dep)?.push(from);
      inDegree.set(from, (inDegree.get(from) ?? 0) + 1);
    }
  }
  const queue = Array.from(inDegree.entries())
    .filter(([_, deg]) => deg === 0)
    .map(([name]) => name)
    .sort((a, b) => porovnej(a, b));
  const orderedNames = [];
  while (queue.length > 0) {
    const name = queue.shift();
    if (!name) break;
    orderedNames.push(name);
    for (const to of outgoing.get(name) ?? []) {
      inDegree.set(to, (inDegree.get(to) ?? 0) - 1);
      if (inDegree.get(to) === 0) queue.push(to);
    }
    queue.sort((a, b) => porovnej(a, b));
  }
  const remaining = views.map((v) => v.name).filter((n) => !orderedNames.includes(n));
  const finalNames = [...orderedNames, ...remaining];
  return finalNames.map((name) => views.find((v) => v.name === name).filePath);
}

// ---------------------------------------------------------------------------
// Topological sorting — Functions (by call dependencies)
// ---------------------------------------------------------------------------

function buildFunctionOrder(functionFilePaths) {
  const functions = functionFilePaths
    .map((filePath) => {
      const name = path.basename(filePath, ".sql");
      const sql = normalizeNewlines(readUtf8(filePath));
      return { name, filePath, sql };
    })
    .sort((a, b) => porovnej(a.name, b.name));

  const nameSet = new Set(functions.map((f) => f.name));

  function detectDependencies(func) {
    // Strip SQL comments BEFORE scanning for call dependencies. Prose in comments — e.g.
    // is_story_participant.sql's note "-- service_role: start_web_artifact_ingest (SECURITY
    // INVOKER) evaluates this …" — otherwise matches the `<ident>(` call regex and becomes a
    // FALSE dependency edge. That spurious edge created a cycle that dumped is_story_participant
    // (and its real dependent fn_user_can_read_run) into the alphabetical `remaining` bucket,
    // mis-ordering the baseline so a LANGUAGE sql function was CREATEd before its helper
    // (coldstart-db-gate: "function is_story_participant does not exist"). Only real code
    // (inside the $$ body / DDL) should produce dependency edges.
    const sqlNoComments = func.sql
      .replace(/\/\*[\s\S]*?\*\//g, " ") // /* block comments */
      .replace(/--[^\n]*/g, " ");        // -- line comments
    const sqlLower = sqlNoComments.toLowerCase();
    const candidates = new Set();
    const re = /\b([a-zA-Z_][\w]*)\s*\(/g;

    for (const match of sqlLower.matchAll(re)) {
      const ident = match[1];
      if (!ident) continue;
      if (ident === "function") continue;
      if (ident === func.name.toLowerCase()) continue;
      candidates.add(ident);
    }

    const deps = [];
    for (const ident of candidates) {
      for (const name of nameSet) {
        if (name.toLowerCase() === ident) {
          deps.push(name);
          break;
        }
      }
    }

    return Array.from(new Set(deps)).sort((a, b) => porovnej(a, b));
  }

  const depsByName = new Map();
  for (const func of functions) {
    depsByName.set(func.name, detectDependencies(func));
  }

  // Kahn's algorithm
  const inDegree = new Map();
  const outgoing = new Map();
  for (const func of functions) {
    inDegree.set(func.name, 0);
    outgoing.set(func.name, []);
  }

  for (const [from, deps] of depsByName.entries()) {
    for (const dep of deps) {
      outgoing.get(dep)?.push(from);
      inDegree.set(from, (inDegree.get(from) ?? 0) + 1);
    }
  }

  const queue = Array.from(inDegree.entries())
    .filter(([_, deg]) => deg === 0)
    .map(([name]) => name)
    .sort((a, b) => porovnej(a, b));

  const orderedNames = [];
  while (queue.length > 0) {
    const name = queue.shift();
    if (!name) break;
    orderedNames.push(name);

    const next = outgoing.get(name) ?? [];
    for (const to of next) {
      inDegree.set(to, (inDegree.get(to) ?? 0) - 1);
      if (inDegree.get(to) === 0) {
        queue.push(to);
      }
    }
    queue.sort((a, b) => porovnej(a, b));
  }

  const remaining = functions.map((f) => f.name).filter((n) => !orderedNames.includes(n));
  const finalNames = [...orderedNames, ...remaining];
  return finalNames.map((name) => functions.find((f) => f.name === name));
}

// ---------------------------------------------------------------------------
// Main build
// ---------------------------------------------------------------------------

function buildInit() {
  ensureDir(migrationsDir);

  const enumsDir = path.join(aishaSqlRoot, "enums");
  const tablesDir = path.join(aishaSqlRoot, "tables");
  const constraintsDir = path.join(aishaSqlRoot, "constraints");
  const functionsDir = path.join(aishaSqlRoot, "functions");
  const viewsDir = path.join(aishaSqlRoot, "views");
  const triggersDir = path.join(aishaSqlRoot, "triggers");
  const indexesDir = path.join(aishaSqlRoot, "indexes");
  const rlsDir = path.join(aishaSqlRoot, "rls");
  const policiesDir = path.join(aishaSqlRoot, "policies");
  const storageDir = path.join(aishaSqlRoot, "storage");
  const grantsDir = path.join(aishaSqlRoot, "grants");
  const materializedViewsDir = path.join(aishaSqlRoot, "materialized_views");

  const enumFiles = listSqlFiles(enumsDir);
  const tableFiles = listSqlFiles(tablesDir);
  const constraintFiles = listSqlFiles(constraintsDir);
  const functionFiles = listSqlFiles(functionsDir);
  const viewFiles = buildViewOrder(listSqlFiles(viewsDir));
  const triggerFiles = listSqlFiles(triggersDir);
  const indexFiles = listSqlFiles(indexesDir);
  const rlsFiles = listSqlFiles(rlsDir);
  const policyFiles = listSqlFiles(policiesDir);
  const storageFiles = listSqlFiles(storageDir);
  const grantFiles = listSqlFiles(grantsDir);
  const materializedViewFiles = listSqlFiles(materializedViewsDir);

  const parts = [];

  // ⛔ ŽÁDNÉ ČASOVÉ RAZÍTKO. Baseline je ODVOZENÝ artefakt — musí být ČISTOU
  // FUNKCÍ zdrojů, jinak dva běhy nad TÝMŽ stromem vyrobí různý soubor.
  // To byl kořen věčných konfliktů: každý PR baseline přegeneroval, změnil se
  // jen tenhle řádek, a git pak hlásil konflikt i tam, kde se schéma vůbec
  // nelišilo. Kdy artefakt vznikl, ví git; do obsahu to nepatří.
  parts.push(`-- AISHA Platform - Init Migration\n-- Generated from file-based source-of-truth SQL\n-- Nemodifikovat ručně: generuje npm run db:init:generate ze aisha/db/sql/**\n`);

  // Safety guard: prevent applying init onto an existing schema
  parts.push(`-- Safety guard: prevent applying init onto an existing schema\nDO $$\nBEGIN\n  IF EXISTS (\n    SELECT 1\n    FROM information_schema.tables\n    WHERE table_schema = 'public'\n      AND table_name = 'profiles'\n  ) THEN\n    RAISE EXCEPTION 'Init migration must be applied to a fresh database (use npm run db:reset:local).';\n  END IF;\nEND $$;\n`);

  // Extensions
  //
  // Required by SoT source files:
  //   - vector (pgvector): used by knowledge_embeddings + compose_context
  //   - pgcrypto: used by aisha_{en,de}crypt_column_audited
  //   - btree_gist: used by exclusion constraints + multi-column GiST indexes
  //   - pg_trgm: provides `gin_trgm_ops` operator class — used by GIN trigram
  //     indexes on graph_nodes.entity_label and other fuzzy-match columns.
  //     Was previously created only in infra/postgres/000_init_roles_schemas.sql
  //     (fresh PG init only) — so AISHA_DB_FORCE_BASELINE_RESET=1 paths
  //     would DROP public CASCADE (drops pg_trgm with it) and then baseline
  //     wouldn't recreate it → first GIN index using gin_trgm_ops blew up
  //     with `operator class "gin_trgm_ops" does not exist for access method
  //     "gin"`. Adding it here makes baseline self-contained for reset.
  parts.push(sectionHeader("EXTENSIONS", 4));
  // Extension placement mirrors infra/postgres/000_init_roles_schemas.sql (the image init
  // the running DBs are actually built from): `vector` lives in PUBLIC, pgcrypto in
  // `extensions`. vector MUST be in public so its type (halfvec), operator classes
  // (halfvec_cosine_ops) and OPERATORS (<=> cosine distance) resolve for the many
  // SECURITY DEFINER functions pinned to `search_path=public` (e.g.
  // mcp_search_knowledge_v3). A `WITH SCHEMA extensions` vector silently broke those —
  // masked until now only because AISHA_DB_FORCE_BASELINE_RESET errored earlier on
  // halfvec and never reached a from-zero state; now that the reset applies, vector
  // placement must match the deployed reality or vector search errors at runtime.
  // The session + DB-level search_path keeps unqualified extensions-resident objects
  // (pgcrypto) resolvable during this apply and on fresh DBs without the infra init.
  parts.push(`SET search_path TO public, extensions;
DO $$ BEGIN EXECUTE format('ALTER DATABASE %I SET search_path TO public, extensions', current_database()); END $$;
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "btree_gist";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
`);

  // Enums
  parts.push(sectionHeader("ENUMS", enumFiles.length));
  for (const filePath of enumFiles) {
    const rel = path.relative(repoRoot, filePath);
    parts.push(fileHeader(rel));
    parts.push(ensureTrailingNewline(normalizeNewlines(readUtf8(filePath))));
  }

  // Tables (topologically sorted by FK)
  const orderedTables = buildTableOrder(tableFiles).filter(Boolean);

  // Auto-detect sequences referenced by tables (nextval('seq_name'::regclass)).
  //
  // Source files may write either `nextval('foo_seq'::regclass)` (unqualified)
  // or `nextval('public.foo_seq'::regclass)` (schema-qualified). The captured
  // name is normalized by stripping a leading `public.` before we re-prefix
  // — without this, qualified inputs become `public.public.foo_seq`, which
  // PostgreSQL parses as `database.schema.relation` and rejects with
  // "cross-database references are not implemented". Hit acme staging
  // baseline apply when `workflow_status_transitions.sql` used the qualified
  // form (recently added in 20260520000000_workflow_statuses_foundation.sql).
  const seqNames = new Set();
  for (const table of orderedTables) {
    const matches = table.sql.matchAll(/nextval\('([^']+)'::regclass\)/gi);
    for (const m of matches) {
      const raw = m[1];
      const bare = raw.startsWith("public.") ? raw.slice("public.".length) : raw;
      seqNames.add(bare);
    }
  }
  if (seqNames.size > 0) {
    parts.push(sectionHeader("SEQUENCES", seqNames.size));
    for (const seqName of [...seqNames].sort()) {
      parts.push(`CREATE SEQUENCE IF NOT EXISTS public.${seqName};\n`);
    }
  }

  parts.push(sectionHeader("TABLES", orderedTables.length));
  for (const table of orderedTables) {
    const rel = path.relative(repoRoot, table.filePath);
    parts.push(fileHeader(rel));
    parts.push(ensureTrailingNewline(table.sql));
  }

  // NOTE: DEFERRED CONSTRAINTS are emitted LATER — after the INDEXES section —
  // not here. A deferred FK may reference a column whose uniqueness is provided
  // by a plain CREATE UNIQUE INDEX (e.g. agent_catalog.slug), and PostgreSQL
  // requires that unique index to exist at FK-creation time. Emitting the
  // constraints after indexes makes them truly deferred and satisfies both
  // circular table-FK deps (tables already exist) and index-backed FK targets.

  // Views (emitted BEFORE functions): SQL-language functions may reference a
  // view in their body (JOIN/FROM) and a LANGUAGE sql function is validated at
  // CREATE time, so the view must already exist. Views reference only
  // tables/enums — so creating views right after tables is safe and resolves
  // the function→view dependency.
  //
  // Výjimka: pohled, který VOLÁ uživatelskou funkci (vault.decrypted_secrets bere
  // klíč z aisha_vault_encryption_key(), 2026-09-25), by tu spadl na „function
  // does not exist". Takový pohled — i každý pohled, který na něj stojí — jde až
  // ZA funkce. Opačný směr (LANGUAGE sql funkce čte pozdní pohled) nejde splnit
  // v žádném pořadí, proto je to chyba generátoru, ne tiché přeskupení.
  const { earlyViews, lateViews } = splitViewsByFunctionDeps(viewFiles, functionFiles);
  parts.push(sectionHeader("VIEWS", earlyViews.length));
  for (const filePath of earlyViews) {
    const rel = path.relative(repoRoot, filePath);
    parts.push(fileHeader(rel));
    parts.push(ensureTrailingNewline(normalizeNewlines(readUtf8(filePath))));
  }

  // Functions (topologically sorted + lint)
  lintFunctions(functionFiles);
  const orderedFunctions = buildFunctionOrder(functionFiles).filter(Boolean);

  // Before creating functions, revoke default anon execute privilege
  parts.push(sectionHeader("DEFAULT PRIVILEGES", 1));
  parts.push(`-- Remove automatic anon EXECUTE grant for new functions
-- Each function explicitly declares its own grants (authenticated, anon, service_role)
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon;

`);

  parts.push(sectionHeader("FUNCTIONS", orderedFunctions.length));
  for (const func of orderedFunctions) {
    const rel = path.relative(repoRoot, func.filePath);
    parts.push(fileHeader(rel));
    parts.push(ensureTrailingNewline(func.sql));
  }

  // Pohledy, které volají uživatelské funkce (viz výjimka u VIEWS výše).
  parts.push(sectionHeader("VIEWS AFTER FUNCTIONS", lateViews.length));
  for (const filePath of lateViews) {
    const rel = path.relative(repoRoot, filePath);
    parts.push(fileHeader(rel));
    parts.push(ensureTrailingNewline(normalizeNewlines(readUtf8(filePath))));
  }

  // Materialized Views (must come after tables/views; they may reference base tables)
  parts.push(sectionHeader("MATERIALIZED VIEWS", materializedViewFiles.length));
  for (const filePath of materializedViewFiles) {
    const rel = path.relative(repoRoot, filePath);
    parts.push(fileHeader(rel));
    parts.push(ensureTrailingNewline(normalizeNewlines(readUtf8(filePath))));
  }

  // Triggers (only files with actual trigger definitions, deduplicated by trigger name)
  const allTriggerEntries = triggerFiles
    .map((filePath) => {
      const sql = normalizeNewlines(readUtf8(filePath));
      // Extract name/table from the CODE only — full-line SQL comments are
      // stripped first. Without this, a "-- Create trigger" header line makes
      // the case-insensitive regex match the comment and then capture "CREATE"
      // from the real statement on the next line as the trigger NAME. Every
      // such file collapsed onto the bogus key "create" and all but one were
      // dropped by the dedup below — silently losing on_auth_user_created (the
      // member provisioning trigger) and 9 others from the compiled baseline.
      const code = sql.replace(/^[ \t]*--.*$/gm, "");
      // Extract trigger name from CREATE TRIGGER statement
      const nameMatch = code.match(/CREATE\s+TRIGGER\s+("[^"]+"|[a-zA-Z_][a-zA-Z0-9_]*)/i);
      const triggerName = nameMatch ? nameMatch[1].replace(/^"|"$/g, "").toLowerCase() : null;
      // Extract target table from INSERT/UPDATE/DELETE/TRUNCATE ON [public.]TABLE
      const tableMatch = code.match(/(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+ON\s+(?:public\.)?(\w+)/i);
      const tableName = tableMatch ? tableMatch[1].toLowerCase() : null;
      return { filePath, sql, triggerName, tableName };
    })
    .filter(({ sql, triggerName }) => triggerName && sql.toLowerCase().includes("create trigger") && hasHeaderMarker(sql, "-- Trigger:"));

  // Deduplicate: prefer file whose basename matches the trigger name, otherwise last wins
  const triggerMap = new Map();
  for (const entry of allTriggerEntries) {
    const existing = triggerMap.get(entry.triggerName);
    if (!existing) {
      triggerMap.set(entry.triggerName, entry);
    } else {
      // Prefer file named after trigger
      const newBasename = path.basename(entry.filePath, ".sql").toLowerCase();
      const existBasename = path.basename(existing.filePath, ".sql").toLowerCase();
      if (newBasename === entry.triggerName && existBasename !== entry.triggerName) {
        triggerMap.set(entry.triggerName, entry);
      } else if (newBasename !== entry.triggerName && existBasename === entry.triggerName) {
        // keep existing
      } else {
        // both match or neither — keep newer (last in alphabetical order)
        triggerMap.set(entry.triggerName, entry);
      }
    }
  }
  const triggerFileEntries = [...triggerMap.values()];

  parts.push(sectionHeader("TRIGGERS", triggerFileEntries.length));
  for (const { filePath, sql, triggerName, tableName } of triggerFileEntries) {
    const rel = path.relative(repoRoot, filePath);
    parts.push(fileHeader(rel));
    // Add DROP IF EXISTS before CREATE to handle potential duplicates
    if (triggerName && tableName) {
      parts.push(`DROP TRIGGER IF EXISTS ${triggerName} ON public.${tableName};\n`);
    }
    parts.push(ensureTrailingNewline(sql));
  }

  // Collect constraint names AND inline index names from all tables to avoid duplicate indexes
  const tableConstraintNames = new Set();
  for (const table of orderedTables) {
    const names = extractConstraintNames(table.sql);
    for (const name of names) {
      tableConstraintNames.add(name);
    }
    // Also collect CREATE INDEX names embedded in table files
    const indexMatches = table.sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?("[^"]+"|[a-zA-Z_][a-zA-Z0-9_]*)/gi);
    for (const m of indexMatches) {
      tableConstraintNames.add(m[1].replace(/^"|"$/g, "").toLowerCase());
    }
  }

  // Indexes (excluding those that duplicate constraints)
  const duplicateIndexErrors = [];
  const indexFileEntries = indexFiles
    .map((filePath) => {
      const sql = normalizeNewlines(readUtf8(filePath));
      const indexNameMatch = sql.match(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+("[^"]+"|[a-zA-Z_][a-zA-Z0-9_]*)/i);
      const indexName = indexNameMatch ? indexNameMatch[1].replace(/^"|"$/g, "").toLowerCase() : null;
      return { filePath, sql, indexName };
    })
    .filter(({ sql, filePath, indexName }) => {
      if (!/create\s+(unique\s+)?index/i.test(sql)) return false;
      if (!hasHeaderMarker(sql, "-- Index:")) return false;
      if (indexName && tableConstraintNames.has(indexName)) {
        duplicateIndexErrors.push(`${path.basename(filePath)}: index "${indexName}" duplicates a CONSTRAINT in the table definition — remove the index file`);
        return false;
      }
      return true;
    });

  if (duplicateIndexErrors.length > 0) {
    console.warn(`\n⚠️  Skipped ${duplicateIndexErrors.length} duplicate index file(s) (already defined in table SQL):`);
    for (const err of duplicateIndexErrors) {
      console.warn(`   - ${err}`);
    }
  }

  parts.push(sectionHeader("INDEXES", indexFileEntries.length));
  for (const { filePath, sql } of indexFileEntries) {
    const rel = path.relative(repoRoot, filePath);
    parts.push(fileHeader(rel));
    parts.push(ensureTrailingNewline(sql));
  }

  // Deferred Constraints — emitted AFTER tables AND indexes so FKs can reference
  // either circular-table targets (tables exist) or columns made unique by a
  // CREATE UNIQUE INDEX (the unique index now exists). See the note above the
  // VIEWS section for why this is not emitted right after TABLES.
  if (constraintFiles.length > 0) {
    parts.push(sectionHeader("DEFERRED CONSTRAINTS", constraintFiles.length));
    for (const filePath of constraintFiles) {
      const rel = path.relative(repoRoot, filePath);
      parts.push(fileHeader(rel));
      parts.push(ensureTrailingNewline(normalizeNewlines(readUtf8(filePath))));
    }
  }

  // RLS (ENABLE ROW LEVEL SECURITY statements — aisha-specific)
  if (rlsFiles.length > 0) {
    parts.push(sectionHeader("ROW LEVEL SECURITY", rlsFiles.length));
    for (const filePath of rlsFiles) {
      const rel = path.relative(repoRoot, filePath);
      parts.push(fileHeader(rel));
      parts.push(ensureTrailingNewline(normalizeNewlines(readUtf8(filePath))));
    }
  }

  // Policies (with deduplication and DROP IF EXISTS injection)
  const policyFileEntries = [];
  const seenPolicies = new Set();
  let policyStatementCount = 0;

  for (const filePath of policyFiles) {
    const sql = normalizeNewlines(readUtf8(filePath));
    if (!sql.toLowerCase().includes("create policy")) continue;

    const statements = extractPolicyStatements(sql);
    const kept = [];

    for (const policy of statements) {
      const key = `${policy.relation ?? "unknown"}:${policy.name ?? policy.statement}`;
      if (seenPolicies.has(key)) continue;
      seenPolicies.add(key);
      kept.push(policy.statement);
    }

    if (kept.length) {
      policyStatementCount += kept.length;
      policyFileEntries.push({ filePath, statements: kept });
    }
  }

  parts.push(sectionHeader("POLICIES", policyStatementCount));
  for (const { filePath, statements } of policyFileEntries) {
    const rel = path.relative(repoRoot, filePath);
    parts.push(fileHeader(rel));
    parts.push(ensureTrailingNewline(statements.join("\n\n")));
  }

  // Storage
  parts.push(sectionHeader("STORAGE", storageFiles.length));
  for (const filePath of storageFiles) {
    const rel = path.relative(repoRoot, filePath);
    parts.push(fileHeader(rel));
    parts.push(ensureTrailingNewline(addDropPoliciesToSql(readUtf8(filePath))));
  }

  // Grants (security hardening — must be LAST to override any default privileges)
  parts.push(sectionHeader("GRANTS", grantFiles.length));
  for (const filePath of grantFiles) {
    const rel = path.relative(repoRoot, filePath);
    parts.push(fileHeader(rel));
    parts.push(ensureTrailingNewline(readUtf8(filePath)));
  }

  // Final security: Revoke anon access from functions that should NOT have it
  const functionsWithLegitimateAnon = new Set();
  for (const func of orderedFunctions) {
    if (/GRANT\s+EXECUTE\s+ON\s+FUNCTION[^;]*TO\s+(anon|public)/i.test(func.sql)) {
      const funcName = path.basename(func.filePath, ".sql");
      functionsWithLegitimateAnon.add(funcName);
    }
  }

  parts.push(sectionHeader("SECURITY - Revoke illegitimate anon access", 1));
  parts.push(`-- This block revokes anon EXECUTE from all functions that should NOT have it
-- Each function's SQL file is the source of truth for grants
-- Functions with legitimate anon access: ${functionsWithLegitimateAnon.size}
DO $$
DECLARE
  func_rec RECORD;
  legitimate_anon_funcs TEXT[] := ARRAY[${[...functionsWithLegitimateAnon].map((f) => `'${f}'`).join(", ")}];
  revoked_count INT := 0;
BEGIN
  FOR func_rec IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
    AND p.prokind = 'f'  -- functions only, not procedures
    AND has_function_privilege('anon', p.oid, 'EXECUTE')
    AND p.proname != ALL(legitimate_anon_funcs)
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM anon',
                   func_rec.proname, func_rec.args);
    revoked_count := revoked_count + 1;
  END LOOP;

  RAISE NOTICE 'Revoked illegitimate anon EXECUTE from % functions', revoked_count;
END $$;

`);

  const finalSql = parts.join("\n");
  // Změnil se OBSAH? Rozhoduje o tom, jestli se posune razítko v meta —
  // razítko, které tiká i při nulové změně, vyrábí konflikty z ničeho.
  const previousSql = fs.existsSync(outputFile) ? readUtf8(outputFile) : null;
  const contentChanged = previousSql !== finalSql;
  fs.writeFileSync(outputFile, finalSql, "utf-8");

  const sourceFileCount =
    enumFiles.length +
    tableFiles.length +
    constraintFiles.length +
    functionFiles.length +
    viewFiles.length +
    triggerFiles.length +
    indexFiles.length +
    rlsFiles.length +
    policyFiles.length +
    storageFiles.length +
    grantFiles.length +
    materializedViewFiles.length;

  return {
    outputFile,
    sourceFileCount,
    contentChanged,
    counts: {
      enums: enumFiles.length,
      tables: orderedTables.length,
      constraints: constraintFiles.length,
      functions: orderedFunctions.length,
      views: viewFiles.length,
      triggers: triggerFileEntries.length,
      indexes: indexFileEntries.length,
      rls: rlsFiles.length,
      policies: policyStatementCount,
      storage: storageFiles.length,
      grants: grantFiles.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Exports (for unit tests — the generator itself runs via the guard below)
// ---------------------------------------------------------------------------

// ⭐ `statementEndIndex` je ALIAS na `findStatementEnd`. Dvě větve řešily touž
// vadu nezávisle a každá si funkci pojmenovala jinak; alias drží testy z větve
// `feat/narok-na-doklad-strukturalne` v chodu, aniž by vznikla druhá
// implementace. Jedno chování, dvě jména — ne dva domovy.
const statementEndIndex = findStatementEnd;

export {
  statementEndIndex,
  // Exportováno kvůli testům z větve `feat/narok-na-doklad-strukturalne`:
  // ověřují, že policy se středníkem v komentáři zůstane CELÁ. Funkce tu byla
  // vždy, jen se nedala zvenčí zavolat — a test, který nemá jak měřit, mlčí.
  extractPolicyStatements,
  maskSqlForLint,
  buildFunctionSignatureIndex,
  collectFunctionLintIssues,
  findStatementEnd,
  splitSqlStatements,
  statementBodyStart,
};

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

// Only generate when invoked directly (`node …/generate-init-migration-from-sources.mjs`).
// When imported by a test the module must have no side effects — buildInit()
// would otherwise overwrite the real baseline.sql on disk.
// „Spustili mě přímo?" má jeden domov: lib/cli-entry.mjs. Porovnává SKUTEČNÉ
// cesty (realpath), ne řetězce — jinak stačí symlink nebo git worktree, blok se
// TIŠE přeskočí a volající dostane prázdný výstup s kódem 0, který si vyloží
// jako měření.
if (isDirectRun(import.meta.url)) {
  try {
    const result = buildInit();
    syncBaselineMeta(result);
    const relOut = path.relative(repoRoot, result.outputFile);
    console.log(`✅ Generated init migration: ${relOut}`);
    console.log(`   enums=${result.counts.enums}, tables=${result.counts.tables}, constraints=${result.counts.constraints}, functions=${result.counts.functions}, views=${result.counts.views}`);
    console.log(`   triggers=${result.counts.triggers}, indexes=${result.counts.indexes}, rls=${result.counts.rls}, policies=${result.counts.policies}, storage=${result.counts.storage}, grants=${result.counts.grants}`);
  } catch (error) {
    console.error("❌ Failed to generate init migration");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
