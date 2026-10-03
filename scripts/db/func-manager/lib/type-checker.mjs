/**
 * SQL Function Type Consistency Checker
 *
 * Cross-references RETURNS TABLE column types in SQL functions against
 * actual table/view column definitions. Detects:
 *
 * 1. TYPE_MISMATCH  — function declares `col integer` but table has `col bigint`
 * 2. MISSING_RELATION — function FROM/JOINs a table/view that has no SQL definition
 * 3. MISSING_MATVIEW — function references a materialized view with no SQL definition
 *
 * Uses parser.mjs for function metadata extraction.
 *
 * @module scripts/db/func-manager/lib/type-checker
 */

import fs from 'fs';
import path from 'path';
import { extractMetadata, extractGrants } from './parser.mjs';

// ---------------------------------------------------------------------------
// Type normalization
// ---------------------------------------------------------------------------

/** Canonical type map — alias → normalized form */
const TYPE_ALIASES = {
  'int': 'integer',
  'int4': 'integer',
  'int8': 'bigint',
  'int2': 'smallint',
  'float4': 'real',
  'float8': 'double precision',
  'bool': 'boolean',
  'timestamptz': 'timestamp with time zone',
  'timetz': 'time with time zone',
  'serial': 'integer',
  'bigserial': 'bigint',
  'smallserial': 'smallint',
  'varchar': 'character varying',
  'timestamp': 'timestamp without time zone',
  'time': 'time without time zone',
};

/**
 * Normalize SQL type to canonical form for comparison.
 * Strips array suffix, precision spec, DEFAULT, NOT NULL, CHECK, and maps aliases.
 */
function normalizeType(raw) {
  if (!raw) return '';
  let t = raw.toLowerCase().trim();

  // Remove trailing DEFAULT ..., NOT NULL, CHECK (...), UNIQUE, PRIMARY KEY, REFERENCES
  t = t.replace(/\s+default\s+.*/i, '').trim();
  t = t.replace(/\s+not\s+null\b/i, '').trim();
  t = t.replace(/\s+check\s*\(.*/i, '').trim();
  t = t.replace(/\s+unique\b.*/i, '').trim();
  t = t.replace(/\s+primary\s+key\b.*/i, '').trim();
  t = t.replace(/\s+references\s+.*/i, '').trim();
  t = t.replace(/\s+generated\s+.*/i, '').trim();

  // Preserve array markers
  const isArray = t.endsWith('[]');
  if (isArray) t = t.slice(0, -2).trim();

  // Strip precision for comparison: numeric(10,2) → numeric
  t = t.replace(/\(\s*\d+(?:\s*,\s*\d+)?\s*\)/, '').trim();

  // Apply alias normalization
  if (TYPE_ALIASES[t]) t = TYPE_ALIASES[t];

  return isArray ? `${t}[]` : t;
}

/** Set of known enum type names (loaded lazily) */
let _enumTypes = null;

function getEnumTypes(rootDir) {
  if (_enumTypes) return _enumTypes;
  _enumTypes = new Set();
  const enumDir = rootDir
    ? require('path').join(rootDir, 'aisha/db/sql/enums')
    : null;
  return _enumTypes;
}

/**
 * Check if a return type is compatible with the table column type.
 * For RETURNS TABLE, PostgreSQL requires exact match (no implicit widening).
 *
 * integer ≠ bigint — PostgreSQL raises 42804 at runtime.
 * text vs enum — PostgreSQL implicitly casts enum→text, so this is compatible.
 */
function typesMatch(returnType, tableType) {
  const rNorm = normalizeType(returnType);
  const tNorm = normalizeType(tableType);
  if (rNorm === tNorm) return true;
  // PostgreSQL implicitly casts every scalar value to text — a function that
  // declares `column text` in its RETURNS TABLE will always produce text,
  // regardless of the source column's type (`inet`, `enum`, etc.). The gate
  // can't see the SELECT-body cast (`::text` etc.), so a `text` return is
  // compatible with any non-array scalar column. We exclude arrays because
  // `text` ≠ `inet[]` even after element-wise cast.
  if (rNorm === 'text' && !tNorm.endsWith('[]')) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Table schema parser
// ---------------------------------------------------------------------------

/**
 * Parse a CREATE TABLE SQL file and extract column definitions.
 *
 * @param {string} sql — full SQL of the table definition
 * @returns {{ name: string; columns: Map<string, string> } | null}
 */
function parseTableDef(sql) {
  // Match: CREATE TABLE [IF NOT EXISTS] [public.]name (
  const nameMatch = sql.match(
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(\w+)\s*\(/i,
  );
  if (!nameMatch) return null;

  const tableName = nameMatch[1].toLowerCase();

  // Extract everything between the outer ( ... )
  const startIdx = sql.indexOf('(', nameMatch.index + nameMatch[0].length - 1);
  if (startIdx < 0) return null;

  // Find matching closing paren (handle nested parens)
  let depth = 1;
  let endIdx = startIdx + 1;
  while (endIdx < sql.length && depth > 0) {
    if (sql[endIdx] === '(') depth++;
    else if (sql[endIdx] === ')') depth--;
    endIdx++;
  }

  // Strip `-- ...` line comments from the body BEFORE splitting on commas.
  // Otherwise comments preceding a column definition (a heavy AISHA convention)
  // get attached to the column "part" and the `startsWith('--')` check below
  // discards the whole column. Example bug: agent_knowledge_bindings.priority
  // was invisible to the type checker because its prior 2-line comment moved
  // the `priority int NOT NULL DEFAULT 100,` text down inside the same
  // comma-delimited part.
  const bodyRaw = sql.slice(startIdx + 1, endIdx - 1);
  const body = bodyRaw
    .split('\n')
    .map((line) => {
      const i = line.indexOf('--');
      return i === -1 ? line : line.slice(0, i);
    })
    .join('\n');
  const columns = new Map();

  // Split by top-level commas (respect parentheses depth)
  const parts = [];
  let partDepth = 0;
  let current = '';
  for (const ch of body) {
    if (ch === '(') partDepth++;
    else if (ch === ')') partDepth--;
    if (ch === ',' && partDepth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());

  for (const part of parts) {
    const trimmed = part.trim();
    // Skip constraints: PRIMARY KEY, CONSTRAINT, CHECK, UNIQUE, FOREIGN KEY
    if (/^\s*(?:PRIMARY\s+KEY|CONSTRAINT|CHECK|UNIQUE|FOREIGN\s+KEY)/i.test(trimmed)) continue;
    // Skip empty parts
    if (!trimmed) continue;

    // Column pattern: name type_token [array] [rest...]
    // Types can be: uuid, text, integer, timestamp with time zone, numeric(10,2), text[], etc.
    const colMatch = trimmed.match(
      /^(\w+)\s+((?:timestamp|time|double|character)\s+(?:with(?:out)?\s+time\s+zone|precision|varying(?:\(\d+\))?)|\w+(?:\(\s*\d+(?:\s*,\s*\d+)?\s*\))?(?:\s*\[\])?)/i,
    );
    if (colMatch) {
      const colName = colMatch[1].toLowerCase();
      const colType = colMatch[2].trim();
      columns.set(colName, colType);
    }
  }

  return { name: tableName, columns };
}

/**
 * Parse a CREATE VIEW SQL file and extract the view name.
 *
 * @param {string} sql
 * @returns {string | null} view name
 */
function parseViewName(sql) {
  const m = sql.match(
    /CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(\w+)/i,
  );
  return m ? m[1].toLowerCase() : null;
}

// ---------------------------------------------------------------------------
// Main analysis
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} TypeIssue
 * @property {string} severity — 'error' | 'warning'
 * @property {string} rule — issue rule code
 * @property {string} func — function name
 * @property {string} file — relative file path
 * @property {string} message — human-readable description
 * @property {Object} [details] — additional context
 */

/**
 * Build the full schema registry from SQL files.
 *
 * @param {string} rootDir — workspace root
 * @returns {{ tables: Map<string, Map<string, string>>; knownRelations: Set<string> }}
 */
export function buildSchemaRegistry(rootDir) {
  const tablesDir = path.join(rootDir, 'aisha/db/sql/tables');
  const viewsDir = path.join(rootDir, 'aisha/db/sql/views');

  /** @type {Map<string, Map<string, string>>} tableName → { colName → colType } */
  const tables = new Map();
  /** @type {Set<string>} all known relation names (tables + views + matviews + builtins) */
  const knownRelations = new Set();

  // SQL built-in pseudo-tables / functions that appear in FROM clauses
  const builtinFromTargets = new Set([
    'unnest', 'generate_series', 'jsonb_array_elements',
    'jsonb_array_elements_text', 'json_array_elements',
    'jsonb_each', 'jsonb_each_text', 'json_each', 'json_each_text',
    'jsonb_to_recordset', 'json_to_recordset', 'regexp_matches',
    'string_to_table', 'xmltable', 'jsonb_populate_recordset',
    'jsonb_object_keys', 'json_object_keys',
    'anon', // common alias in subqueries, not a table
    // Common CTE/subquery aliases and comment words that parser picks up
    'database', 'local', 'existing', 'user', 'story', 'status',
    'the', 'a', 'an', 'flag', 'edge', 'all', 'triggers', 'template',
    'baseline', 'vault', 'ai', 'body_markdown', 'ai_instructions',
    'membership', 'quantity', 'booking', 'specialist', 'protocol',
    'eval_status', 'payout_status', 'action_type', 'responses',
    'received', 'dispatched', 'inserted', 'v_user_id',
    'daily_activity', 'streak_groups', 'streak_lengths',
    'block_stats', 'time_buckets', 'response_data', 'registration',
    'all_nodes', '1',
    // PostgreSQL system catalogs/views
    'pg_extension', 'pg_tables', 'pg_timezone_names', 'pg_stat_activity',
    'pg_stat_user_tables', 'pg_stat_user_indexes', 'pg_class', 'pg_namespace',
    'pg_attribute', 'pg_type', 'pg_index', 'pg_proc', 'pg_views',
    'pg_indexes', 'pg_settings', 'pg_roles', 'pg_locks', 'pg_constraint',
    // Common variable/parameter prefixes that extractTables picks up
    'start_date', 'end_date', 'used_count', 'title_key', 'consent_key',
    'remaining_quantity', 'date_of_birth', 'context_type', 'question_type',
    'delivery_status', 'is_validated', 'content_metadata',
    'v_caller_id', 'v_current_status', 'p_date', 'p_user_id',
    'p_expected_updated_at',
  ]);

  for (const bn of builtinFromTargets) {
    knownRelations.add(bn);
  }

  // Parse tables
  if (fs.existsSync(tablesDir)) {
    for (const file of fs.readdirSync(tablesDir)) {
      if (!file.endsWith('.sql')) continue;
      const sql = fs.readFileSync(path.join(tablesDir, file), 'utf-8');
      const parsed = parseTableDef(sql);
      if (parsed) {
        tables.set(parsed.name, parsed.columns);
        knownRelations.add(parsed.name);
      }
    }
  }

  // Parse views
  if (fs.existsSync(viewsDir)) {
    for (const file of fs.readdirSync(viewsDir)) {
      if (!file.endsWith('.sql')) continue;
      const sql = fs.readFileSync(path.join(viewsDir, file), 'utf-8');
      const vName = parseViewName(sql);
      if (vName) knownRelations.add(vName);
    }
  }

  // Parse materialized views
  const matviewsDir = path.join(rootDir, 'aisha/db/sql/materialized_views');
  if (fs.existsSync(matviewsDir)) {
    for (const file of fs.readdirSync(matviewsDir)) {
      if (!file.endsWith('.sql')) continue;
      const sql = fs.readFileSync(path.join(matviewsDir, file), 'utf-8');
      const vName = parseViewName(sql);
      if (vName) knownRelations.add(vName);
    }
  }

  // Also add function names (since functions can appear in FROM)
  const funcDir = path.join(rootDir, 'aisha/db/sql/functions');
  if (fs.existsSync(funcDir)) {
    for (const file of fs.readdirSync(funcDir)) {
      if (!file.endsWith('.sql')) continue;
      const funcName = file.replace(/\.sql$/, '');
      knownRelations.add(funcName);
    }
  }

  return { tables, knownRelations };
}

/**
 * Run full type consistency check across all SQL functions.
 *
 * @param {string} rootDir — workspace root
 * @param {{ tables: Map<string, Map<string, string>>; knownRelations: Set<string> }} [registry]
 * @returns {TypeIssue[]}
 */
export function checkAllFunctions(rootDir, registry) {
  if (!registry) {
    registry = buildSchemaRegistry(rootDir);
  }

  const funcDir = path.join(rootDir, 'aisha/db/sql/functions');
  if (!fs.existsSync(funcDir)) return [];

  const issues = [];
  const funcFiles = fs.readdirSync(funcDir).filter((f) => f.endsWith('.sql'));

  for (const file of funcFiles) {
    const funcName = file.replace(/\.sql$/, '');
    const filePath = path.join(funcDir, file);
    const sql = fs.readFileSync(filePath, 'utf-8');

    const meta = extractMetadata(sql, funcName);
    const relPath = `aisha/db/sql/functions/${file}`;

    // Extract CTE names to exclude from MISSING_RELATION check
    const cteNames = new Set();
    const ctePattern = /\b(\w+)\s+AS\s*\(/gi;
    let cteMatch;
    while ((cteMatch = ctePattern.exec(sql)) !== null) {
      cteNames.add(cteMatch[1].toLowerCase());
    }
    // Also extract subquery aliases: ) alias, ) AS alias
    const subqPattern = /\)\s+(?:AS\s+)?(\w+)\s*(?:,|\)|ON|WHERE|LEFT|RIGHT|JOIN|INNER|CROSS|GROUP|ORDER|LIMIT|HAVING|\n)/gi;
    let subqMatch;
    while ((subqMatch = subqPattern.exec(sql)) !== null) {
      cteNames.add(subqMatch[1].toLowerCase());
    }

    // Filter tables: only check relations that look like real table/view names
    // (lowercase, contains underscore or is a known table, min 2 chars)
    const realTables = meta.tables.filter((t) => {
      if (t.length < 2) return false;
      if (cteNames.has(t)) return false;
      // Must contain underscore OR be a known relation to be considered a "real" table
      if (!t.includes('_') && !registry.knownRelations.has(t)) return false;
      return true;
    });

    // --- Check 1: RETURNS TABLE type mismatches ---
    if (meta.returnType.type === 'table' && meta.returnType.columns) {
      for (const retCol of meta.returnType.columns) {
        // Find every referenced table that has this column name. We accept
        // the RETURNS TABLE type when ANY referenced table matches — the
        // function's SELECT body chooses which table to source from, and
        // this gate doesn't parse SELECT bodies. Reporting a TYPE_MISMATCH
        // only when NO referenced table agrees with the declared return type
        // eliminates the false-positive that occurs when a function joins
        // multiple tables with same-named columns of different types
        // (e.g. `priority int` from agent_knowledge_bindings vs `priority
        // text` from partner_stories — both joined by list_agent_kb_bindings).
        const candidates = [];
        for (const tableName of realTables) {
          const tableCols = registry.tables.get(tableName);
          if (!tableCols) continue;
          const tableColType = tableCols.get(retCol.name.toLowerCase());
          if (!tableColType) continue;
          candidates.push({ tableName, tableColType });
        }

        if (candidates.length === 0) continue; // column not in any referenced table
        if (candidates.some((c) => typesMatch(retCol.type, c.tableColType))) {
          continue; // at least one referenced table matches → SELECT could source from there
        }

        // No candidate matches the declared return type → genuine mismatch.
        // Report against the first candidate; the message lists the column
        // and its mismatching type.
        const first = candidates[0];
        issues.push({
          severity: 'error',
          rule: 'TYPE_MISMATCH',
          func: funcName,
          file: relPath,
          message: `RETURNS TABLE declares "${retCol.name}" as ${retCol.type} but no referenced table matches (e.g. "${first.tableName}" has ${first.tableColType})`,
          details: {
            column: retCol.name,
            returnType: retCol.type,
            tableType: first.tableColType,
            table: first.tableName,
          },
        });
      }
    }

    // --- Check 2: Missing relations ---
    for (const tableName of realTables) {
      if (!registry.knownRelations.has(tableName)) {
        issues.push({
          severity: 'error',
          rule: 'MISSING_RELATION',
          func: funcName,
          file: relPath,
          message: `References "${tableName}" which has no SQL definition in tables/, views/, or functions/`,
          details: { relation: tableName },
        });
      }
    }

    // --- Check 3: REFRESH MATERIALIZED VIEW on non-existent matview ---
    const matviewRefresh = sql.match(
      /REFRESH\s+MATERIALIZED\s+VIEW\s+(?:CONCURRENTLY\s+)?(?:public\.)?(\w+)/i,
    );
    if (matviewRefresh) {
      const mvName = matviewRefresh[1].toLowerCase();
      if (!registry.knownRelations.has(mvName)) {
        issues.push({
          severity: 'error',
          rule: 'MISSING_MATVIEW',
          func: funcName,
          file: relPath,
          message: `REFRESH MATERIALIZED VIEW "${mvName}" but no SQL definition exists`,
          details: { matview: mvName },
        });
      }
    }

    // --- Check 4: SETOF references to non-existent table ---
    if (meta.returnType.type === 'setof' && meta.returnType.baseType) {
      const baseType = meta.returnType.baseType.toLowerCase();
      // Only check if it looks like a table name (not a primitive type)
      if (/^[a-z_]+$/.test(baseType) && !isPrimitiveType(baseType)) {
        if (!registry.knownRelations.has(baseType) && !registry.tables.has(baseType)) {
          issues.push({
            severity: 'error',
            rule: 'MISSING_SETOF_TARGET',
            func: funcName,
            file: relPath,
            message: `RETURNS SETOF "${baseType}" but no table/view definition exists`,
            details: { target: baseType },
          });
        }
      }
    }
  }

  return issues;
}

/** Check if a type name is a PostgreSQL primitive (not a table name) */
function isPrimitiveType(t) {
  const primitives = new Set([
    'void', 'boolean', 'bool', 'integer', 'int', 'int4', 'bigint', 'int8',
    'smallint', 'int2', 'real', 'float4', 'double', 'float8', 'numeric',
    'decimal', 'text', 'varchar', 'char', 'character', 'uuid', 'bytea',
    'json', 'jsonb', 'date', 'time', 'timetz', 'timestamp', 'timestamptz',
    'interval', 'inet', 'cidr', 'macaddr', 'oid', 'record', 'trigger',
    'event_trigger', 'regtype', 'regclass', 'regproc',
  ]);
  return primitives.has(t);
}

/**
 * Format issues for human-readable console output.
 *
 * @param {TypeIssue[]} issues
 * @returns {string}
 */
export function formatIssues(issues) {
  if (issues.length === 0) return 'No type consistency issues found.';

  const byRule = {};
  for (const issue of issues) {
    if (!byRule[issue.rule]) byRule[issue.rule] = [];
    byRule[issue.rule].push(issue);
  }

  const lines = [`Found ${issues.length} type consistency issue(s):\n`];

  for (const [rule, ruleIssues] of Object.entries(byRule)) {
    lines.push(`── ${rule} (${ruleIssues.length}) ──`);
    for (const i of ruleIssues) {
      lines.push(`  [${i.severity}] ${i.func}: ${i.message}`);
      lines.push(`    → ${i.file}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
