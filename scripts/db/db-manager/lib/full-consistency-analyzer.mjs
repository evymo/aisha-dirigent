/**
 * Full Consistency Analyzer
 *
 * Parses the generated Supabase types file, extracts function/table metadata,
 * and detects unused database objects via transitive RPC call-graph analysis.
 *
 * @module scripts/db/db-manager/lib/full-consistency-analyzer
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';

const __dirname = typeof import.meta.url === 'string' && typeof globalThis.URL !== 'undefined'
  ? dirname(new URL(import.meta.url).pathname)
  : dirname(new URL(import.meta.url ?? 'file:///unknown', 'file://').pathname);
const PROJECT_ROOT = join(__dirname, '..', '..', '..', '..');

// ---------------------------------------------------------------------------
// Known infrastructure tables (always considered "used")
// ---------------------------------------------------------------------------

const INFRA_TABLES = new Set([
  'audit_journal',
  'schema_migrations',
  'supabase_migrations',
  'migration_registry',
  'auth_users',
  'buckets',
  'objects',
  'sessions',
  'refresh_tokens',
  'mfa_factors',
  'mfa_challenges',
  'mfa_amr_claims',
  'flow_state',
  'saml_providers',
  'saml_relay_states',
  'sso_providers',
  'sso_domains',
  'identities',
  'one_time_tokens',
]);

// ---------------------------------------------------------------------------
// parseSupabaseTypesContent
// ---------------------------------------------------------------------------

/**
 * Parse the content of `types.ts` and extract function/table metadata.
 *
 * @param {string} content — raw TypeScript source of the Database type file
 * @returns {{ functions: Record<string, { args: string; returns: string }>; tables: Record<string, { columns: string[] }> }}
 */
export function parseSupabaseTypesContent(content) {
  const functions = {};
  const tables = {};

  // Find the real Database type definition (skip aliases / re-exports)
  const dbMatch = content.match(/(?:export\s+)?type\s+Database\s*=\s*\{/);
  if (!dbMatch) return { functions, tables };

  const dbBlock = extractBraceBlock(content, dbMatch.index + dbMatch[0].length - 1);
  if (!dbBlock) return { functions, tables };

  // Find `public:` section
  const publicBlock = findNamedBlock(dbBlock, 'public');
  if (!publicBlock) return { functions, tables };

  // ----- Functions -----
  const functionsBlock = findNamedBlock(publicBlock, 'Functions');
  if (functionsBlock) {
    parseEntries(functionsBlock, (name, entryContent) => {
      // Args
      let args = 'never';
      const argsBlock = findNamedBlock(entryContent, 'Args');
      if (argsBlock !== null) {
        args = argsBlock.trim() || 'never';
      } else {
        const neverMatch = entryContent.match(/Args\s*:\s*never\b/);
        if (neverMatch) args = 'never';
      }

      // Returns
      let returns = 'void';
      const returnsBlock = findNamedBlock(entryContent, 'Returns');
      if (returnsBlock !== null) {
        returns = returnsBlock.trim();
      } else {
        const retMatch = entryContent.match(/Returns\s*:\s*(.+)/);
        if (retMatch) returns = retMatch[1].trim();
      }

      functions[name] = { args, returns };
    });
  }

  // ----- Tables -----
  const tablesBlock = findNamedBlock(publicBlock, 'Tables');
  if (tablesBlock) {
    parseEntries(tablesBlock, (name, entryContent) => {
      const rowBlock = findNamedBlock(entryContent, 'Row');
      const columns = [];
      if (rowBlock) {
        const colRe = /(\w+)\s*[?]?\s*:/g;
        let m;
        while ((m = colRe.exec(rowBlock)) !== null) {
          columns.push(m[1]);
        }
      }
      tables[name] = { columns };
    });
  }

  return { functions, tables };
}

// ---------------------------------------------------------------------------
// extractSupabaseTypes
// ---------------------------------------------------------------------------

/**
 * Read `src/integrations/db/types.ts` from disk and parse it.
 *
 * @returns {Promise<{ functions: Record<string, { args: string; returns: string }>; tables: Record<string, { columns: string[] }> }>}
 */
export async function extractSupabaseTypes() {
  const typesPath = join(PROJECT_ROOT, 'src', 'integrations', 'db', 'types.ts');
  const content = readFileSync(typesPath, 'utf-8');
  return parseSupabaseTypesContent(content);
}

// ---------------------------------------------------------------------------
// detectUnusedTables
// ---------------------------------------------------------------------------

/**
 * Detect database tables that are not reachable via any RPC call, direct
 * access, edge function, or structural database relation.
 *
 * Uses a transitive call-graph: RPC → function dependencies → tables.
 *
 * Accepts both plain objects / arrays AND Map / Set collections so that
 * callers can use whichever representation is convenient.
 *
 * @param {Array<string | { name: string }>} dbTables
 * @param {Array<string | { function: string }>} rpcCalls
 * @param {Array<string | { table: string }>} directAccesses
 * @param {Array<string | { rpcCalls?: string[]; tableAccess?: string[] }>} edgeFunctions
 * @param {Map<string,Set<string>> | Record<string,string[]>} [functionDeps]
 * @param {Map<string,Set<string>> | Record<string,string[]>} [functionTableDeps]
 * @param {string[]} [extraUsedFunctions]
 * @param {Map<string,object> | Record<string,object>} [relationUsageMetadata]
 * @returns {Promise<Array<{ entity: string; type: string }>>}
 */
export async function detectUnusedTables(
  dbTables,
  rpcCalls,
  directAccesses,
  edgeFunctions,
  functionDeps = new Map(),
  functionTableDeps = new Map(),
  extraUsedFunctions = [],
  relationUsageMetadata = new Map(),
) {
  const usedTables = new Set();

  // Normalize helpers — support both Map/Set and plain objects
  const getDeps = (map, key) => {
    if (map instanceof Map) return map.get(key) || [];
    return map[key] || [];
  };
  const iterateEntries = (mapOrObj) => {
    if (mapOrObj instanceof Map) return mapOrObj.entries();
    return Object.entries(mapOrObj);
  };
  const toTableName = (item) =>
    typeof item === 'string' ? item : item?.name ?? item?.table ?? '';
  const toFuncName = (item) =>
    typeof item === 'string' ? item : item?.function ?? '';

  // ---- 1. Walk transitive function graph from RPC entry points ----
  const visitedFuncs = new Set();
  const funcQueue = [
    ...rpcCalls.map(toFuncName),
    ...extraUsedFunctions,
  ];

  while (funcQueue.length > 0) {
    const fn = funcQueue.pop();
    if (!fn || visitedFuncs.has(fn)) continue;
    visitedFuncs.add(fn);

    // Tables directly used by this function
    for (const table of getDeps(functionTableDeps, fn)) {
      usedTables.add(table);
    }

    // Transitive dependencies
    for (const dep of getDeps(functionDeps, fn)) {
      if (!visitedFuncs.has(dep)) funcQueue.push(dep);
    }
  }

  // ---- 2. Direct accesses ----
  for (const item of directAccesses) {
    usedTables.add(toTableName(item));
  }

  // ---- 3. Edge functions ----
  for (const ef of edgeFunctions) {
    if (typeof ef === 'string') {
      usedTables.add(ef);
    } else {
      for (const t of ef.tableAccess || []) usedTables.add(t);
      // Edge function RPC calls also seed the function walk
      for (const fn of ef.rpcCalls || []) {
        if (!visitedFuncs.has(fn)) {
          visitedFuncs.add(fn);
          for (const table of getDeps(functionTableDeps, fn)) {
            usedTables.add(table);
          }
        }
      }
    }
  }

  // ---- 4. Structural metadata: tables integrated via FK + policies ----
  for (const [table, meta] of iterateEntries(relationUsageMetadata)) {
    const fk = (meta.inboundFkCount || 0) + (meta.outboundFkCount || 0);
    const structural =
      (meta.policyCount || 0) +
      (meta.triggerCount || 0) +
      (meta.referencedByViewsCount || 0);

    if (fk > 0 && structural > 0) {
      usedTables.add(table);
    }
  }

  // ---- 5. Filter unused tables ----
  const unused = [];
  for (const item of dbTables) {
    const name = toTableName(item);
    if (!name) continue;
    if (INFRA_TABLES.has(name)) continue;
    if (usedTables.has(name)) continue;
    unused.push({ entity: name, type: 'table' });
  }

  return unused;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extract a brace-delimited block starting at the given `{` position.
 * Returns the content BETWEEN the matching braces (exclusive).
 */
function extractBraceBlock(text, openBraceIdx) {
  let depth = 1;
  let i = openBraceIdx + 1;
  while (i < text.length && depth > 0) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') depth--;
    i++;
  }
  return text.slice(openBraceIdx + 1, i - 1);
}

/**
 * Find `keyName: {` in `text` and return the brace-block content,
 * or `null` if not found.
 */
function findNamedBlock(text, keyName) {
  const re = new RegExp(`\\b${keyName}\\s*:\\s*\\{`);
  const m = text.match(re);
  if (!m) return null;
  return extractBraceBlock(text, m.index + m[0].length - 1);
}

/**
 * Iterate over the top-level `name: { ... }` entries in a block,
 * skipping over nested content via brace counting.
 * Calls `callback(name, entryContent)` for each entry.
 */
function parseEntries(block, callback) {
  const skippedKeys = new Set([
    'Args', 'Returns', 'Row', 'Insert', 'Update',
    'Relationships', 'Enums', 'CompositeTypes', 'Views',
    'Functions', 'Tables',
  ]);

  let pos = 0;
  while (pos < block.length) {
    // Advance to next word
    while (pos < block.length && /\s/.test(block[pos])) pos++;
    if (pos >= block.length) break;

    // Read key name
    const keyStart = pos;
    while (pos < block.length && /[\w]/.test(block[pos])) pos++;
    const key = block.slice(keyStart, pos);
    if (!key) { pos++; continue; }

    // Find `: {`
    const colonIdx = block.indexOf(':', pos);
    if (colonIdx === -1) break;
    pos = colonIdx + 1;

    // Skip whitespace
    while (pos < block.length && /\s/.test(block[pos])) pos++;

    if (block[pos] === '{') {
      // Extract block
      let depth = 1;
      const start = pos + 1;
      pos++;
      while (pos < block.length && depth > 0) {
        if (block[pos] === '{') depth++;
        else if (block[pos] === '}') depth--;
        pos++;
      }

      if (!skippedKeys.has(key)) {
        const content = block.slice(start, pos - 1);
        callback(key, content);
      }
    } else {
      // Simple value — skip to end of line / next entry
      while (pos < block.length && block[pos] !== '\n') pos++;
    }
  }
}
