/**
 * SQL Function Metadata Parser
 *
 * Pure-function parser for PostgreSQL function SQL files.
 * Extracts metadata, grants, parameters, return types, dependencies, and tables.
 *
 * @module scripts/db/func-manager/lib/parser
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SYSTEM_TABLES = new Set([
  'pg_class', 'pg_type', 'pg_namespace', 'pg_attribute', 'pg_proc',
  'pg_catalog', 'pg_stat_user_tables', 'pg_indexes', 'pg_enum',
  'pg_policies', 'pg_roles', 'pg_trigger', 'pg_constraint',
  'information_schema',
]);

const SYSTEM_SCHEMAS = new Set([
  'pg_catalog', 'information_schema', 'auth', 'storage', 'extensions',
  'supabase_migrations', 'graphql', 'graphql_public', 'realtime',
  'pgsodium', 'vault', 'supabase_functions',
]);

const SQL_KEYWORDS = new Set([
  'select', 'insert', 'update', 'delete', 'from', 'where', 'join',
  'left', 'right', 'inner', 'outer', 'cross', 'full', 'on', 'and',
  'or', 'not', 'in', 'exists', 'between', 'like', 'ilike', 'is',
  'null', 'true', 'false', 'case', 'when', 'then', 'else', 'end',
  'begin', 'returns', 'return', 'query', 'if', 'elsif', 'elseif',
  'loop', 'for', 'while', 'foreach', 'exit', 'continue',
  'raise', 'exception', 'notice', 'warning', 'info', 'debug', 'log',
  'perform', 'execute', 'using', 'into', 'strict', 'declare',
  'create', 'replace', 'function', 'procedure', 'language', 'as',
  'set', 'values', 'table', 'type', 'with', 'recursive',
  'grant', 'revoke', 'all', 'to', 'public', 'security', 'definer',
  'invoker', 'volatile', 'stable', 'immutable', 'parallel', 'safe',
  'count', 'sum', 'avg', 'min', 'max', 'coalesce', 'nullif',
  'greatest', 'least', 'abs', 'ceil', 'floor', 'round', 'trunc',
  'row_to_json', 'to_json', 'to_jsonb', 'jsonb_build_object',
  'jsonb_build_array', 'jsonb_agg', 'json_agg', 'array_agg',
  'string_agg', 'bool_and', 'bool_or', 'every',
  'gen_random_uuid', 'uuid_generate_v4', 'now', 'current_timestamp',
  'current_date', 'current_time', 'clock_timestamp', 'statement_timestamp',
  'lower', 'upper', 'trim', 'ltrim', 'rtrim', 'length', 'char_length',
  'substring', 'position', 'regexp_replace', 'regexp_match',
  'replace', 'split_part', 'concat', 'concat_ws', 'format', 'quote_literal',
  'to_char', 'to_date', 'to_timestamp', 'to_number',
  'date_trunc', 'date_part', 'extract', 'age', 'interval',
  'cast', 'text', 'integer', 'boolean', 'bigint', 'numeric',
  'real', 'float', 'double', 'varchar', 'char', 'smallint',
  'uuid', 'jsonb', 'json', 'timestamptz', 'timestamp', 'date',
  'time', 'bytea', 'inet', 'cidr', 'macaddr', 'oid', 'regtype',
  'void', 'record', 'trigger', 'event_trigger',
  'auth', 'uid', 'role', 'jwt', 'email',
  'found', 'new', 'old', 'tg_op', 'tg_name', 'tg_table_name',
  'row_number', 'rank', 'dense_rank', 'over', 'partition',
  'order', 'by', 'asc', 'desc', 'limit', 'offset', 'fetch',
  'first', 'next', 'rows', 'only', 'distinct', 'group', 'having',
  'union', 'intersect', 'except', 'lateral',
  'array', 'unnest', 'generate_series', 'any', 'some',
]);

// ---------------------------------------------------------------------------
// detectCategory
// ---------------------------------------------------------------------------

/**
 * Detect function category from its name using pattern matching.
 * Priority-ordered: first match wins.
 *
 * @param {string} funcName
 * @returns {string} Category label
 */
export function detectCategory(funcName) {
  if (/_audited$/.test(funcName)) return 'AUDITED';
  if (/admin/.test(funcName)) return 'ADMIN';
  if (/^get_my_/.test(funcName)) return 'MY_READ';
  if (/^(?:create|update|delete|upsert)_my_/.test(funcName)) return 'MY_WRITE';
  if (/partner/.test(funcName)) return 'PARTNER';
  if (/consultant/.test(funcName)) return 'CONSULTANT';
  if (/^get_(?:user|patient)_/.test(funcName)) return 'PATIENT';
  if (/public/.test(funcName)) return 'PUBLIC';
  if (/^(?:trigger|handle)_/.test(funcName)) return 'TRIGGER';
  if (/^update_updated_at|^set_/.test(funcName)) return 'SYSTEM';
  if (/^(?:log|write_audit)_/.test(funcName)) return 'LOGGING';
  if (/^(?:is|has|check)_/.test(funcName)) return 'HELPER';
  return 'OTHER';
}

// ---------------------------------------------------------------------------
// extractGrants
// ---------------------------------------------------------------------------

/**
 * Extract GRANT information from SQL source.
 *
 * Reads `GRANT EXECUTE|ALL ON FUNCTION <signature…> TO <roles…>;`. The signature
 * may contain whitespace (`f(uuid, uuid)`, `f(p_a uuid, p_b integer)`,
 * `double precision`) and may name several functions. Comments are dropped
 * first, so a commented-out GRANT is not a grant. Grantees are compared as
 * whole role names, not substrings.
 *
 * ⛔ NAMĚŘENO 2026-10-04: dřívější vzor `ON FUNCTION \S+ TO` signaturu s mezerou
 * neviděl — u 1005 z 1726 vydaných funkcí SoT nevrátil ŽÁDNÝ grant a brána
 * `db-types-cover-exposed-rpcs` pro ně byla slepá.
 *
 * REVOKE is NOT modelled: no SoT file revokes an API role after granting it. That
 * premise is pinned in `db-types-cover-exposed-rpcs` — if it stops holding, teach
 * this function the order of statements instead of trusting the result.
 *
 * @param {string} sql
 * @returns {{ anon: boolean; authenticated: boolean; service_role: boolean; public: boolean }}
 */
export function extractGrants(sql) {
  const grants = { anon: false, authenticated: false, service_role: false, public: false };

  const withoutComments = sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
  const pattern = /\bGRANT\s+(?:EXECUTE|ALL(?:\s+PRIVILEGES)?)\s+ON\s+FUNCTION\s+[^;]+?\s+TO\s+([^;]+)/gi;
  let m;
  while ((m = pattern.exec(withoutComments)) !== null) {
    const grantees = m[1].toLowerCase().split(/[\s,]+/).map((role) => role.replace(/"/g, '')).filter(Boolean);
    if (grantees.includes('anon')) grants.anon = true;
    if (grantees.includes('authenticated')) grants.authenticated = true;
    if (grantees.includes('service_role')) grants.service_role = true;
    if (grantees.includes('public')) grants.public = true;
  }

  return grants;
}

// ---------------------------------------------------------------------------
// extractTables
// ---------------------------------------------------------------------------

/**
 * Extract referenced table names from SQL.
 * Strips schema prefixes and filters system/pg tables.
 *
 * @param {string} sql
 * @returns {string[]}
 */
export function extractTables(sql) {
  const tables = new Set();

  const patterns = [
    /\bFROM\s+(?:(\w+)\.)?(\w+)/gi,
    /\bJOIN\s+(?:(\w+)\.)?(\w+)/gi,
    /\bINSERT\s+INTO\s+(?:(\w+)\.)?(\w+)/gi,
    /\bUPDATE\s+(?:(\w+)\.)?(\w+)\s+SET\b/gi,
    /\bDELETE\s+FROM\s+(?:(\w+)\.)?(\w+)/gi,
  ];

  for (const pattern of patterns) {
    let m;
    while ((m = pattern.exec(sql)) !== null) {
      const schema = (m[1] || '').toLowerCase();
      const table = m[2].toLowerCase();
      if (SYSTEM_SCHEMAS.has(schema) && schema !== '') continue;
      if (SYSTEM_TABLES.has(table)) continue;
      // skip keywords that look like table names
      if (SQL_KEYWORDS.has(table)) continue;
      tables.add(table);
    }
  }

  // Also catch simple UPDATE table (without SET in same line)
  const updateSimple = /\bUPDATE\s+(?:(\w+)\.)?(\w+)/gi;
  let m2;
  while ((m2 = updateSimple.exec(sql)) !== null) {
    const schema = (m2[1] || '').toLowerCase();
    const table = m2[2].toLowerCase();
    if (SYSTEM_SCHEMAS.has(schema) && schema !== '') continue;
    if (SYSTEM_TABLES.has(table)) continue;
    if (SQL_KEYWORDS.has(table)) continue;
    tables.add(table);
  }

  return [...tables];
}

// ---------------------------------------------------------------------------
// extractDependencies
// ---------------------------------------------------------------------------

/**
 * Extract function call dependencies from SQL body.
 * Excludes self-reference and known SQL built-ins.
 *
 * @param {string} sql
 * @param {string} funcName — current function name (excluded from results)
 * @returns {string[]}
 */
export function extractDependencies(sql, funcName) {
  const deps = new Set();
  const pattern = /\b([a-z_]\w*)\s*\(/gi;
  let m;

  while ((m = pattern.exec(sql)) !== null) {
    const name = m[1].toLowerCase();
    if (name === funcName) continue;
    if (SQL_KEYWORDS.has(name)) continue;
    // Accept if it contains an underscore (custom function convention) or is a known helper
    if (/^[a-z]+_[a-z]/.test(name)) {
      deps.add(name);
    }
  }

  return [...deps];
}

// ---------------------------------------------------------------------------
// extractReturnType (internal)
// ---------------------------------------------------------------------------

function extractReturnType(sql) {
  // Strip `-- ...` line comments FIRST: a descriptive comment that happens to
  // mention a "RETURNS TABLE (...)" / "RETURNS SETOF ..." shape must not be
  // mistaken for the real declaration. The regexes below match the FIRST
  // occurrence in the source, so an un-stripped comment would shadow the actual
  // signature — yielding phantom columns (false TYPE_MISMATCH) or, worse, masking
  // the real RETURNS TABLE (false negative). Mirrors the preflight SQL lint, which
  // also strips comments/strings before pattern-matching.
  sql = sql.replace(/--[^\n]*/g, '');
  // RETURNS TABLE (col1 type1, col2 type2, ...)
  const tableMatch = sql.match(/RETURNS\s+TABLE\s*\(([\s\S]*?)\)/i);
  if (tableMatch) {
    const columns = [];
    // Match: name type (handles multi-word types like "timestamp with time zone",
    // "double precision", "character varying(N)", array suffix "[]")
    const colPattern = /(\w+)\s+((?:timestamp|time)\s+with(?:out)?\s+time\s+zone|double\s+precision|character\s+varying(?:\s*\(\d+\))?|\w+)(\s*\([^)]*\))?(\s*\[\])?/gi;
    let m;
    while ((m = colPattern.exec(tableMatch[1])) !== null) {
      const typeParts = m[2].trim() + (m[3] || '') + (m[4] || '');
      columns.push({ name: m[1], type: typeParts.trim() });
    }
    return { type: 'table', columns };
  }

  // RETURNS SETOF type
  const setofMatch = sql.match(/RETURNS\s+SETOF\s+(\w+)/i);
  if (setofMatch) {
    return { type: 'setof', baseType: setofMatch[1] };
  }

  // RETURNS void
  if (/RETURNS\s+void\b/i.test(sql)) {
    return { type: 'void' };
  }

  // RETURNS scalar
  const scalarMatch = sql.match(/RETURNS\s+(\w+)/i);
  if (scalarMatch && scalarMatch[1].toLowerCase() !== 'table') {
    return { type: 'scalar', baseType: scalarMatch[1] };
  }

  // No RETURNS keyword → void
  return { type: 'void' };
}

// ---------------------------------------------------------------------------
// extractParameters (internal)
// ---------------------------------------------------------------------------

function extractParameters(sql) {
  // Try: FUNCTION name(params) RETURNS
  let sigMatch = sql.match(
    /FUNCTION\s+\w+\s*\(([\s\S]*?)\)\s*[\r\n]*\s*RETURNS/i,
  );

  if (!sigMatch) {
    // Fallback: FUNCTION name(params) LANGUAGE
    sigMatch = sql.match(
      /FUNCTION\s+\w+\s*\(([\s\S]*?)\)\s*[\r\n]*\s*LANGUAGE/i,
    );
  }

  if (!sigMatch) return [];
  const raw = sigMatch[1].trim();
  if (!raw) return [];

  return splitParams(raw).map(parseOneParam);
}

/** Split parameters respecting parentheses depth */
function splitParams(str) {
  const parts = [];
  let depth = 0;
  let current = '';

  for (const ch of str) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;

    if (ch === ',' && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Parse a single parameter definition */
function parseOneParam(paramStr) {
  // Strip IN/OUT/INOUT prefix
  const stripped = paramStr.replace(/^(?:IN|OUT|INOUT)\s+/i, '');

  // name type DEFAULT value
  const defMatch = stripped.match(
    /^(\w+)\s+(\w+(?:\s*\([^)]*\))?(?:\s*\[\])?)\s+DEFAULT\s+(.+)$/i,
  );
  if (defMatch) {
    return {
      name: defMatch[1],
      type: defMatch[2].trim(),
      hasDefault: true,
      defaultValue: defMatch[3].trim().replace(/::[\w.]+$/, ''),
    };
  }

  // name type
  const simpleMatch = stripped.match(
    /^(\w+)\s+(\w+(?:\s*\([^)]*\))?(?:\s*\[\])?)$/,
  );
  if (simpleMatch) {
    return { name: simpleMatch[1], type: simpleMatch[2].trim(), hasDefault: false };
  }

  // Fallback
  const parts = stripped.split(/\s+/);
  return { name: parts[0] || '', type: parts[1] || 'unknown', hasDefault: false };
}

// ---------------------------------------------------------------------------
// extractMetadata
// ---------------------------------------------------------------------------

/**
 * Extract comprehensive metadata from a SQL function definition.
 *
 * @param {string} sql  — full SQL source of the function file
 * @param {string} funcName — function name (used for self-ref exclusion & category)
 * @returns {object} Metadata object
 */
export function extractMetadata(sql, funcName) {
  const security = /SECURITY\s+DEFINER/i.test(sql) ? 'DEFINER' : 'INVOKER';
  const hasSearchPath = /SET\s+search_path/i.test(sql);

  const langMatch = sql.match(/LANGUAGE\s+(\w+)/i);
  const language = langMatch ? langMatch[1].toLowerCase() : 'plpgsql';

  const hasAuditInsert =
    /INSERT\s+INTO\s+audit_journal\b/i.test(sql) ||
    /write_audit_journal\s*\(/i.test(sql) ||
    /record_audit_log\s*\(/i.test(sql);

  const hasRoleCheck =
    /is_admin_or_staff\s*\(/i.test(sql) ||
    /has_role\s*\(/i.test(sql) ||
    /has_permission\s*\(/i.test(sql) ||
    /role_is_admin\s*\(/i.test(sql) ||
    /user_has_admin_role\s*\(/i.test(sql) ||
    /check_admin_section_permission\s*\(/i.test(sql);

  const hasConsentCheck =
    /has_data_sharing_consent\s*\(/i.test(sql) ||
    (/\bdata_sharing_consents\b/i.test(sql) &&
      /revoked_at\s+IS\s+NULL/i.test(sql));

  let category = detectCategory(funcName);

  // Content-based override: audit → AUDITED, consent → PATIENT
  if (hasAuditInsert && category !== 'AUDITED' && /_audited/.test(funcName)) {
    category = 'AUDITED';
  }
  if (
    hasConsentCheck &&
    !['AUDITED', 'ADMIN'].includes(category) &&
    (/user|patient/i.test(funcName) || category === 'OTHER')
  ) {
    category = 'PATIENT';
  }

  return {
    security,
    hasSearchPath,
    language,
    hasAuditInsert,
    hasRoleCheck,
    hasConsentCheck,
    category,
    returnType: extractReturnType(sql),
    parameters: extractParameters(sql),
    dependencies: extractDependencies(sql, funcName),
    tables: extractTables(sql),
  };
}
