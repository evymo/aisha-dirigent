#!/usr/bin/env node
/**
 * fix-sot-function-signatures.mjs
 *
 * Reads every *.sql in aisha/db/sql/functions/,
 * extracts CREATE [OR REPLACE] FUNCTION signature (arg types in order),
 * then rewrites any COMMENT / REVOKE / GRANT ON FUNCTION statements
 * that lack an argument-type list to include one.
 *
 * This prevents "function name is not unique" errors in PostgreSQL
 * when function overloads exist.
 *
 * Dry-run: node scripts/db/fix-sot-function-signatures.mjs --dry-run
 * Apply :  node scripts/db/fix-sot-function-signatures.mjs
 */
import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const DRY_RUN = process.argv.includes("--dry-run");
const DIR = "aisha/db/sql/functions";

/**
 * Parse a CREATE FUNCTION header and extract:
 *  - schemaQualifiedName  e.g. "public.get_audit_journal"
 *  - bareName             e.g. "get_audit_journal"
 *  - argTypeList          e.g. "(INTEGER, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT)"
 *
 * Handles multi-line CREATE FUNCTION ... ) RETURNS blocks.
 */
function extractFunctionSignatures(sql) {
  // Match all CREATE [OR REPLACE] FUNCTION blocks
  // We need to handle multi-line: find CREATE ... FUNCTION ... ( ... ) RETURNS
  const sigs = [];

  // Strategy: find each CREATE [OR REPLACE] FUNCTION, then parse args until RETURNS or )
  const createRegex =
    /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w.]+)\s*\(/gi;
  let match;

  while ((match = createRegex.exec(sql)) !== null) {
    const fullName = match[1]; // e.g. "public.get_audit_journal"
    const bareName = fullName.includes(".")
      ? fullName.split(".").pop()
      : fullName;
    const startIdx = match.index + match[0].length; // right after "("

    // Now find the matching closing paren, handling nested parens
    let depth = 1;
    let i = startIdx;
    while (i < sql.length && depth > 0) {
      if (sql[i] === "(") depth++;
      else if (sql[i] === ")") depth--;
      i++;
    }

    const argsBlock = sql.substring(startIdx, i - 1); // everything inside ( ... )

    // Parse individual args to extract types
    const argTypes = parseArgTypes(argsBlock);
    const argTypeList = `(${argTypes.join(", ")})`;

    sigs.push({ fullName, bareName, argTypes, argTypeList });
  }

  return sigs;
}

/**
 * Parse the arguments block of a CREATE FUNCTION and return an array of type names.
 * Handles DEFAULT values, composite types, array types, etc.
 *
 * Example input:
 *   "p_limit INTEGER DEFAULT 100, p_action_type TEXT DEFAULT NULL"
 * Output:
 *   ["INTEGER", "TEXT"]
 */
function parseArgTypes(argsBlock) {
  if (!argsBlock.trim()) return [];

  const types = [];
  // Split by commas that are NOT inside parentheses
  const args = splitTopLevelCommas(argsBlock);

  for (const arg of args) {
    const trimmed = arg.trim();
    if (!trimmed) continue;

    // Remove DEFAULT ... clause (but careful with nested parens)
    const withoutDefault = removeDefault(trimmed);

    // Parse: [mode] [name] type
    // mode = IN | OUT | INOUT | VARIADIC (optional)
    // name = identifier (optional for some)
    // type = the rest

    const tokens = tokenizeArg(withoutDefault);
    if (tokens.length === 0) continue;

    // Skip OUT parameters — they don't count in the function signature for overload resolution
    if (tokens[0].toUpperCase() === "OUT") continue;

    // Skip mode keywords
    let idx = 0;
    if (["IN", "INOUT", "VARIADIC"].includes(tokens[idx].toUpperCase())) {
      idx++;
    }

    // Now we have [name] type
    // If there are 2+ tokens left, first is name, rest is type
    // If there's 1 token, it IS the type
    if (tokens.length - idx >= 2) {
      // name + type
      const typeTokens = tokens.slice(idx + 1);
      types.push(normalizeType(typeTokens.join(" ")));
    } else if (tokens.length - idx === 1) {
      types.push(normalizeType(tokens[idx]));
    }
  }

  return types;
}

/**
 * Split a string by commas, but only at the top level (not inside parens).
 */
function splitTopLevelCommas(s) {
  const parts = [];
  let depth = 0;
  let current = "";

  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/**
 * Remove DEFAULT ... clause from an argument definition.
 * Handles nested parentheses in default values.
 */
function removeDefault(arg) {
  const defaultIdx = arg.search(/\bDEFAULT\b/i);
  if (defaultIdx === -1) return arg;
  return arg.substring(0, defaultIdx).trim();
}

/**
 * Tokenize an argument definition into words, respecting quoted identifiers
 * and multi-word types like "timestamp with time zone", "character varying".
 */
function tokenizeArg(s) {
  // Simple split by whitespace, then rejoin known multi-word types
  const raw = s
    .trim()
    .split(/\s+/)
    .filter((t) => t);
  return raw;
}

/**
 * Normalize a PostgreSQL type name to its canonical short form.
 * This ensures REVOKE/GRANT arg lists match what PostgreSQL expects.
 */
function normalizeType(t) {
  const upper = t.toUpperCase().trim();

  // Map common aliases
  const map = {
    INT: "integer",
    INT4: "integer",
    INT8: "bigint",
    FLOAT4: "real",
    FLOAT8: "double precision",
    BOOL: "boolean",
    TIMESTAMPTZ: "timestamptz",
    TIMESTAMP: "timestamp",
    "TIMESTAMP WITH TIME ZONE": "timestamptz",
    "TIMESTAMP WITHOUT TIME ZONE": "timestamp",
    VARCHAR: "character varying",
  };

  // Check for array suffix
  const isArray = upper.endsWith("[]");
  const baseUpper = isArray ? upper.slice(0, -2) : upper;
  const base = map[baseUpper] || t.trim().toLowerCase();

  return isArray ? `${base}[]` : base;
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── Main ────────────────────────────────────────────────────────────────────

const files = readdirSync(DIR).filter((f) => f.endsWith(".sql"));
let totalFixed = 0;
let filesModified = 0;

for (const f of files) {
  const filePath = join(DIR, f);
  let content = readFileSync(filePath, "utf8");
  const original = content;

  // Extract all CREATE FUNCTION signatures from this file
  const sigs = extractFunctionSignatures(content);
  if (sigs.length === 0) continue;

  // For each signature, fix COMMENT / REVOKE / GRANT that reference this function
  // without arg types
  for (const sig of sigs) {
    const { fullName, bareName, argTypeList } = sig;

    // Build regex patterns for the function name (with or without schema prefix)
    const namePatterns = [
      escapeRegex(fullName),
      escapeRegex(bareName),
      // Also match with "public." prefix even if CREATE used bare name
      fullName.includes(".")
        ? escapeRegex(bareName)
        : `(?:public\\.)?${escapeRegex(bareName)}`,
    ];
    const namePattern = [...new Set(namePatterns)].join("|");

    // Fix COMMENT ON FUNCTION name IS → COMMENT ON FUNCTION name(args) IS
    const commentRegex = new RegExp(
      `(COMMENT\\s+ON\\s+FUNCTION\\s+)(${namePattern})(\\s+IS)`,
      "gi"
    );
    content = content.replace(commentRegex, (match, prefix, name, suffix) => {
      // Don't replace if already has args
      // Check: is there a ( between name and IS?
      // Since our regex captures name without parens, we know it doesn't have them
      totalFixed++;
      return `${prefix}${name}${argTypeList}${suffix}`;
    });

    // Fix REVOKE ... ON FUNCTION name FROM → REVOKE ... ON FUNCTION name(args) FROM
    const revokeRegex = new RegExp(
      `(REVOKE[^;]*ON\\s+FUNCTION\\s+)(${namePattern})(\\s+FROM)`,
      "gi"
    );
    content = content.replace(revokeRegex, (match, prefix, name, suffix) => {
      totalFixed++;
      return `${prefix}${name}${argTypeList}${suffix}`;
    });

    // Fix GRANT ... ON FUNCTION name TO → GRANT ... ON FUNCTION name(args) TO
    const grantRegex = new RegExp(
      `(GRANT[^;]*ON\\s+FUNCTION\\s+)(${namePattern})(\\s+TO)`,
      "gi"
    );
    content = content.replace(grantRegex, (match, prefix, name, suffix) => {
      totalFixed++;
      return `${prefix}${name}${argTypeList}${suffix}`;
    });
  }

  if (content !== original) {
    filesModified++;
    if (DRY_RUN) {
      console.log(`[DRY-RUN] Would fix: ${f}`);
    } else {
      writeFileSync(filePath, content);
      console.log(`Fixed: ${f}`);
    }
  }
}

console.log(
  `\n${DRY_RUN ? "[DRY-RUN] " : ""}Done: ${totalFixed} statements fixed in ${filesModified} files`
);
