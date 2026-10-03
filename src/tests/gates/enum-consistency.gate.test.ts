/**
 * Enum Consistency Gate Tests
 *
 * Ensures every enum literal cast in SQL functions and migrations references
 * a value that actually exists in the enum definition.  This prevents runtime
 * 22P02 errors such as:
 *   "invalid input value for enum journal_area: \"shop\""
 *
 * The test parses:
 *   1. Enum definitions from `aisha/db/sql/enums/*.sql`     (source of truth)
 *   2. Generated TypeScript types from `src/integrations/db/types.ts`
 *   3. All SQL functions from `aisha/db/sql/functions/*.sql`
 *   4. All migration files from `aisha/db/migrations/*.sql`
 *
 * Besides explicit casts (`'x'::journal_area`) it checks bare literals passed
 * to enum-typed NAMED arguments (`p_area := 'x'`), resolving each parameter's
 * type from the callee's signature in `aisha/db/sql/functions` (section 6).
 *
 * Run with:
 *   npm run test:run -- src/tests/gates/enum-consistency.gate.test.ts
 *
 * @packageDocumentation
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// =============================================================================
// Configuration
// =============================================================================

const WORKSPACE_ROOT = path.resolve(__dirname, "../../..");

const PATHS = {
  sqlRoot: path.join(WORKSPACE_ROOT, "aisha/db/sql"),
  sqlEnums: path.join(WORKSPACE_ROOT, "aisha/db/sql/enums"),
  sqlFunctions: path.join(WORKSPACE_ROOT, "aisha/db/sql/functions"),
  migrations: path.join(WORKSPACE_ROOT, "aisha/db/migrations"),
  types: path.join(WORKSPACE_ROOT, "src/integrations/db/types.ts"),
};

// =============================================================================
// Parsing Utilities
// =============================================================================

/**
 * Extract enum values from a CREATE TYPE ... AS ENUM (...) SQL file.
 * Handles the DO $$ ... IF NOT EXISTS wrapper pattern used in our codebase.
 */
function extractEnumValuesFromSql(content: string): string[] {
  // Strip SQL line comments FIRST. Inline `-- …` comments can contain commas
  // and parens (e.g. `'agent_supervisor' -- … (bindings, hippocampus)`) which
  // otherwise (a) truncate the non-greedy `)` match at a comment's paren and
  // (b) survive the comma-split as bogus "values". Enum literals never contain
  // `--`, so removing comment tails is safe and makes the parser see only the
  // real value list.
  const withoutComments = content.replace(/--[^\n]*/g, "");

  const enumMatch = withoutComments.match(/AS\s+ENUM\s*\(\s*([\s\S]*?)\)/i);
  if (!enumMatch) return [];

  // Strip `-- ...` line comments BEFORE the comma-split. Enum definitions
  // routinely annotate each value with an inline comment whose prose may
  // itself contain commas (e.g. "read + comment, no destructive actions" or
  // "(bindings, hippocampus)"). Leaving them in shatters the split and yields
  // garbage pseudo-values — the actual enum values are only the quoted tokens.
  const body = enumMatch[1].replace(/--[^\n]*/g, "");

  return body
    .split(",")
    .map((v) => v.trim().replace(/^['"]|['"]$/g, "").trim())
    .filter((v) => v.length > 0 && !v.startsWith("--"));
}

/**
 * Extract all enum value casts from SQL content.
 * Matches patterns like:
 *   'value'::enum_name
 *   'value'::public.enum_name
 *
 * Returns array of { value, enumName, line } objects.
 */
function extractEnumCasts(
  content: string
): Array<{ value: string; enumName: string; line: number }> {
  const results: Array<{ value: string; enumName: string; line: number }> = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip comments
    if (line.trimStart().startsWith("--")) continue;

    // Match 'value'::public.enum_name or 'value'::enum_name
    const castRegex = /'([^']+)'::(?:public\.)?(\w+)/g;
    let match: RegExpExecArray | null;
    while ((match = castRegex.exec(line)) !== null) {
      results.push({
        value: match[1],
        enumName: match[2],
        line: i + 1,
      });
    }
  }

  return results;
}

/**
 * Extract enum type-literal values from TypeScript types.ts file.
 * Matches the block:
 *   enum_name:
 *     | "value1"
 *     | "value2"
 */
function extractTsEnumValues(
  typesContent: string,
  enumName: string
): string[] {
  // Match the block starting with `enum_name:` and collecting all `| "value"` lines
  const blockRegex = new RegExp(
    `${enumName}:\\s*\\n((?:\\s*\\|\\s*"[^"]*"\\s*\\n?)+)`,
    "m"
  );
  const blockMatch = typesContent.match(blockRegex);
  if (!blockMatch) return [];

  const valueRegex = /"([^"]+)"/g;
  const values: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = valueRegex.exec(blockMatch[1])) !== null) {
    values.push(m[1]);
  }
  return values;
}

/**
 * Read all .sql files from a directory (non-recursive, skips .backup/).
 */
function readSqlFiles(
  dir: string,
  recursive = false
): Map<string, string> {
  const result = new Map<string, string>();
  if (!fs.existsSync(dir)) return result;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue; // skip .backup etc.
    const fullPath = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith(".sql")) {
      result.set(entry.name, fs.readFileSync(fullPath, "utf-8"));
    } else if (recursive && entry.isDirectory()) {
      const subFiles = readSqlFiles(fullPath, true);
      for (const [subName, subContent] of subFiles) {
        result.set(path.join(entry.name, subName), subContent);
      }
    }
  }

  return result;
}

/**
 * Load all known enum definitions from SQL source files.
 * Returns Map<enumName, Set<validValues>>.
 */
function loadEnumDefinitions(): Map<string, Set<string>> {
  const enums = new Map<string, Set<string>>();
  const files = readSqlFiles(PATHS.sqlEnums);

  for (const [fileName, content] of files) {
    const nameMatch = content.match(
      /CREATE\s+TYPE\s+(?:public\.)?(\w+)\s+AS\s+ENUM/i
    );
    if (!nameMatch) continue;

    const values = extractEnumValuesFromSql(content);
    enums.set(nameMatch[1], new Set(values));
  }

  return enums;
}

// Known enum names from our DB — used to filter casts to only relevant enum types
const KNOWN_ENUM_NAMES = new Set([
  "account_deletion_status",
  "admin_section",
  "app_role",
  "archive_tag_category",
  "assessment_status",
  "batch_purpose",
  "batch_status",
  "blockchain_event_type",
  "check_in_type",
  "operational_dimension",
  "consent_type",
  "consultant_role_enum",
  "consultant_status_enum",
  "contribution_status_enum",
  "contribution_type_enum",
  "document_processing_status",
  "registration_status",
  "health_document_category",
  "journal_action_type",
  "journal_area",
  "journal_severity",
  "lab_result_status",
  "membership_status",
  "membership_tier",
  "order_status",
  "partner_certification_level",
  "payment_type",
  "permission_type",
  "product_access_type",
  "request_status",
  "shipping_method",
  "study_status",
  "study_type",
  "subscription_period",
  "vial_content_type",
  "vial_status",
  "workflow_step_status",
]);

// =============================================================================
// Named-argument literals (`p_area := 'x'` passed to an enum-typed parameter)
// =============================================================================

/**
 * Blank out SQL comments — and, in the skeleton, string-literal contents —
 * keeping every offset and newline, so a position found in one view indexes
 * the same text in the other and in the original.
 *
 *   code     — comments blanked, string literals intact (to read argument values)
 *   skeleton — comments AND string contents blanked (to find calls and balance
 *              parens without tripping over `(`, `,` or a function name that
 *              only appears inside a string)
 *
 * Dollar quotes are deliberately transparent: our function bodies are
 * `$function$ … $function$`, and the calls we look for live inside them.
 */
function maskSql(content: string): { code: string; skeleton: string } {
  const code = content.split("");
  const skeleton = content.split("");
  const blank = (target: string[], i: number) => {
    if (i < target.length && target[i] !== "\n") target[i] = " ";
  };
  const blankBoth = (i: number) => {
    blank(code, i);
    blank(skeleton, i);
  };

  let i = 0;
  while (i < content.length) {
    const ch = content[i];
    const next = content[i + 1];

    if (ch === "-" && next === "-") {
      while (i < content.length && content[i] !== "\n") blankBoth(i++);
      continue;
    }

    if (ch === "/" && next === "*") {
      // PostgreSQL block comments nest.
      let depth = 0;
      while (i < content.length) {
        if (content[i] === "/" && content[i + 1] === "*") {
          depth++;
          blankBoth(i++);
          blankBoth(i++);
        } else if (content[i] === "*" && content[i + 1] === "/") {
          depth--;
          blankBoth(i++);
          blankBoth(i++);
          if (depth === 0) break;
        } else {
          blankBoth(i++);
        }
      }
      continue;
    }

    if (ch === "'") {
      // E'…' strings honour backslash escapes; standard strings only ''.
      const isEscapeString =
        /[eE]/.test(content[i - 1] ?? "") && !/[\w$]/.test(content[i - 2] ?? "");
      i++;
      while (i < content.length) {
        if (isEscapeString && content[i] === "\\") {
          blank(skeleton, i++);
          blank(skeleton, i++);
        } else if (content[i] === "'" && content[i + 1] === "'") {
          blank(skeleton, i++);
          blank(skeleton, i++);
        } else if (content[i] === "'") {
          break;
        } else {
          blank(skeleton, i++);
        }
      }
      i++; // closing quote
      continue;
    }

    if (ch === '"') {
      // Quoted identifier: skip it so a `--` or `'` inside is not misread.
      i++;
      while (i < content.length && content[i] !== '"') i++;
      i++;
      continue;
    }

    i++;
  }

  return { code: code.join(""), skeleton: skeleton.join("") };
}

/**
 * From the `(` at `open` in a skeleton, return the spans of the top-level
 * arguments, or null when the parens never balance (truncated input).
 */
function splitArguments(
  skeleton: string,
  open: number
): Array<[number, number]> | null {
  const spans: Array<[number, number]> = [];
  let depth = 0;
  let start = open + 1;

  for (let i = open; i < skeleton.length; i++) {
    const ch = skeleton[i];
    if (ch === "(" || ch === "[") {
      depth++;
    } else if (ch === ")" || ch === "]") {
      depth--;
      if (depth === 0) {
        spans.push([start, i]);
        return spans;
      }
    } else if (ch === "," && depth === 1) {
      spans.push([start, i]);
      start = i + 1;
    }
  }

  return null;
}

const normalizeSqlName = (name: string): string =>
  name.replace(/"/g, "").replace(/^public\./i, "").toLowerCase();

/**
 * Parse `CREATE [OR REPLACE] FUNCTION public.f(p_x type DEFAULT …, …)` headers.
 * Returns Map<function, Map<parameter, Set<declared type>>>, merged across
 * overloads — a parameter declared with different types in different
 * overloads keeps all of them.
 */
function extractFunctionSignatures(
  files: Map<string, string>
): Map<string, Map<string, Set<string>>> {
  const signatures = new Map<string, Map<string, Set<string>>>();
  const createRegex =
    /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+((?:"?public"?\.)?"?\w+"?)\s*\(/gi;

  for (const content of files.values()) {
    const { skeleton } = maskSql(content);
    let match: RegExpExecArray | null;

    while ((match = createRegex.exec(skeleton)) !== null) {
      const spans = splitArguments(skeleton, match.index + match[0].length - 1);
      if (!spans) continue;

      const fn = normalizeSqlName(match[1]);
      const params = signatures.get(fn) ?? new Map<string, Set<string>>();
      signatures.set(fn, params);

      for (const [start, end] of spans) {
        const declaration = skeleton
          .slice(start, end)
          .replace(/(?:\s+DEFAULT\b|\s*=)[\s\S]*$/i, "")
          .trim();
        const tokens = declaration.split(/\s+/).filter(Boolean);

        // OUT parameters are not passed by the caller; VARIADIC takes an array.
        if (/^(?:OUT|VARIADIC)$/i.test(tokens[0] ?? "")) continue;
        if (/^(?:IN|INOUT)$/i.test(tokens[0] ?? "")) tokens.shift();
        // A lone type is an unnamed parameter — unreachable by named notation.
        if (tokens.length < 2) continue;

        const name = normalizeSqlName(tokens[0]);
        const type = normalizeSqlName(tokens.slice(1).join(" "));
        const types = params.get(name) ?? new Set<string>();
        types.add(type);
        params.set(name, types);
      }
    }
  }

  return signatures;
}

/**
 * Keep only parameters whose type is an enum in EVERY overload that declares
 * them. If one overload takes the same name as text, the call may resolve
 * there, and a literal that is not an enum value is not provably wrong.
 */
function enumTypedParameters(
  signatures: Map<string, Map<string, Set<string>>>,
  enumDefs: Map<string, Set<string>>
): Map<string, Map<string, string[]>> {
  const result = new Map<string, Map<string, string[]>>();

  for (const [fn, params] of signatures) {
    for (const [param, types] of params) {
      const declared = Array.from(types);
      if (!declared.every((t) => enumDefs.has(t))) continue;
      if (!result.has(fn)) result.set(fn, new Map());
      result.get(fn)!.set(param, declared.sort());
    }
  }

  return result;
}

interface NamedEnumLiteral {
  fn: string;
  param: string;
  value: string;
  enumNames: string[];
  line: number;
}

/**
 * Find calls to functions with enum-typed parameters and return every
 * argument of the exact shape `p_x := 'literal'` (or `=>`) whose parameter
 * is enum-typed. Casts (`'x'::t`) and expressions are left to the cast scan —
 * only a WHOLE bare literal matches.
 */
function extractNamedEnumLiterals(
  content: string,
  enumParams: Map<string, Map<string, string[]>>
): NamedEnumLiteral[] {
  const results: NamedEnumLiteral[] = [];
  const { code, skeleton } = maskSql(content);
  const callRegex = /(?<![\w.$"])((?:public\.)?\w+)\s*\(/gi;
  const lineAt = (offset: number) => content.slice(0, offset).split("\n").length;
  let match: RegExpExecArray | null;

  while ((match = callRegex.exec(skeleton)) !== null) {
    const fn = normalizeSqlName(match[1]);
    const params = enumParams.get(fn);
    if (!params) continue;

    // CREATE/DROP/GRANT/COMMENT … FUNCTION f(…) lists types, not arguments.
    if (/\bFUNCTION\s+$/i.test(skeleton.slice(Math.max(0, match.index - 40), match.index))) {
      continue;
    }

    const spans = splitArguments(skeleton, match.index + match[0].length - 1);
    if (!spans) continue;

    for (const [start, end] of spans) {
      const argument = code
        .slice(start, end)
        .match(/^(\s*)"?(\w+)"?\s*(?::=|=>)\s*'((?:[^']|'')*)'\s*$/);
      if (!argument) continue;

      const param = argument[2].toLowerCase();
      const enumNames = params.get(param);
      if (!enumNames) continue;

      results.push({
        fn,
        param,
        value: argument[3].replace(/''/g, "'"),
        enumNames,
        line: lineAt(start + argument[1].length),
      });
    }
  }

  return results;
}

const isValidEnumLiteral = (
  literal: NamedEnumLiteral,
  enumDefs: Map<string, Set<string>>
): boolean => literal.enumNames.some((e) => enumDefs.get(e)?.has(literal.value));

// =============================================================================
// Tests
// =============================================================================

describe("Enum Consistency Gate", () => {
  const enumDefs = loadEnumDefinitions();
  const typesContent = fs.existsSync(PATHS.types)
    ? fs.readFileSync(PATHS.types, "utf-8")
    : "";

  // -------------------------------------------------------------------------
  // 1. SQL Functions → Enum Definitions (source of truth)
  // -------------------------------------------------------------------------
  describe("SQL Functions: all enum casts reference valid values", () => {
    const functionFiles = readSqlFiles(PATHS.sqlFunctions);

    it("every 'value'::enum_type in SQL functions exists in enum definition", () => {
      const errors: string[] = [];

      for (const [fileName, content] of functionFiles) {
        const casts = extractEnumCasts(content);

        for (const cast of casts) {
          // Only check casts for known enum types
          if (!KNOWN_ENUM_NAMES.has(cast.enumName)) continue;

          const validValues = enumDefs.get(cast.enumName);

          if (!validValues) {
            errors.push(
              `${fileName}:${cast.line} — cast '${cast.value}'::${cast.enumName}` +
                ` but no enum definition found in ${PATHS.sqlEnums}/${cast.enumName}.sql`
            );
            continue;
          }

          if (!validValues.has(cast.value)) {
            errors.push(
              `${fileName}:${cast.line} — '${cast.value}' is NOT a valid value of ${cast.enumName}. ` +
                `Valid: [${Array.from(validValues).sort().join(", ")}]`
            );
          }
        }
      }

      if (errors.length > 0) {
        console.error("\n❌ Invalid enum casts in SQL functions:");
        errors.forEach((e) => console.error(`   - ${e}`));
      }

      expect(
        errors,
        `Found ${errors.length} invalid enum casts in SQL functions`
      ).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Migrations → Enum Definitions (source of truth)
  //    Only checks non-baseline migrations. Baseline is too large and may
  //    contain historical enum values that have since been added.
  // -------------------------------------------------------------------------
  describe("Migrations: enum casts reference valid values", () => {
    const migrationFiles = readSqlFiles(PATHS.migrations);

    it("every 'value'::enum_type in non-baseline migrations exists in enum definition", () => {
      const errors: string[] = [];

      for (const [fileName, content] of migrationFiles) {
        // Skip baseline — it's a full DB dump and may not reflect latest enum state
        if (fileName.includes("baseline")) continue;

        // Skip enum-adding migrations (they create new values, not reference them)
        if (/ADD\s+VALUE/i.test(content)) continue;

        const casts = extractEnumCasts(content);

        for (const cast of casts) {
          if (!KNOWN_ENUM_NAMES.has(cast.enumName)) continue;

          const validValues = enumDefs.get(cast.enumName);
          if (!validValues) continue; // Enum file may not exist in source yet

          if (!validValues.has(cast.value)) {
            errors.push(
              `${fileName}:${cast.line} — '${cast.value}' is NOT a valid value of ${cast.enumName}`
            );
          }
        }
      }

      if (errors.length > 0) {
        console.error("\n❌ Invalid enum casts in migrations:");
        errors.forEach((e) => console.error(`   - ${e}`));
      }

      expect(
        errors,
        `Found ${errors.length} invalid enum casts in migrations`
      ).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // 3. TypeScript types ↔ SQL Enum Definitions
  // -------------------------------------------------------------------------
  describe("TypeScript types include all SQL enum values", () => {
    it("every value in SQL enum definition exists in TypeScript types.ts", () => {
      if (!typesContent) {
        console.warn("⚠️  types.ts not found, skipping TS enum checks");
        return;
      }

      const errors: string[] = [];

      for (const [enumName, sqlValues] of enumDefs) {
        const tsValues = extractTsEnumValues(typesContent, enumName);

        // If enum is not in types.ts at all, only warn (not all enums are exposed)
        if (tsValues.length === 0) continue;

        const tsSet = new Set(tsValues);

        for (const sqlVal of sqlValues) {
          if (!tsSet.has(sqlVal)) {
            errors.push(
              `Enum ${enumName}: SQL has '${sqlVal}' but TypeScript types.ts does not`
            );
          }
        }
      }

      if (errors.length > 0) {
        console.error("\n❌ SQL → TypeScript enum mismatches:");
        errors.forEach((e) => console.error(`   - ${e}`));
      }

      expect(
        errors,
        `Found ${errors.length} SQL enum values missing from TypeScript types`
      ).toHaveLength(0);
    });

    it("every value in TypeScript types.ts exists in SQL enum definition", () => {
      if (!typesContent) return;

      const errors: string[] = [];

      for (const [enumName, sqlValues] of enumDefs) {
        const tsValues = extractTsEnumValues(typesContent, enumName);
        if (tsValues.length === 0) continue;

        for (const tsVal of tsValues) {
          if (!sqlValues.has(tsVal)) {
            errors.push(
              `Enum ${enumName}: TypeScript has '${tsVal}' but SQL definition does not ` +
                `(may need migration or source of truth update)`
            );
          }
        }
      }

      if (errors.length > 0) {
        console.error("\n⚠️  TypeScript → SQL enum mismatches (informational):");
        errors.forEach((e) => console.error(`   - ${e}`));
      }

      // This is a warning — TS types are generated from live DB, not source files.
      // Source of truth updates lag behind migrations.
      // Only fail if there are many mismatches (indicates systemic problem).
      if (errors.length > 10) {
        expect.fail(
          `Too many TS→SQL enum mismatches (${errors.length}). ` +
            `Source of truth may need refresh.`
        );
      }
    });
  });

  // -------------------------------------------------------------------------
  // 4. Enum definition files exist for all known enum types
  // -------------------------------------------------------------------------
  describe("Enum definition coverage", () => {
    it("critical enums have SQL definition files", () => {
      const criticalEnums = [
        "app_role",
        "consent_type",
        "journal_action_type",
        "journal_area",
        "journal_severity",
        "membership_status",
        "membership_tier",
        "order_status",
        "study_status",
        "study_type",
      ];

      const missing: string[] = [];

      for (const enumName of criticalEnums) {
        const filePath = path.join(PATHS.sqlEnums, `${enumName}.sql`);
        if (!fs.existsSync(filePath)) {
          missing.push(enumName);
        }
      }

      expect(
        missing,
        `Missing SQL enum definitions: [${missing.join(", ")}]`
      ).toHaveLength(0);
    });

    it("enum definition files contain valid SQL", () => {
      const files = readSqlFiles(PATHS.sqlEnums);
      const invalid: string[] = [];

      for (const [fileName, content] of files) {
        const hasCreateType = /CREATE\s+TYPE/i.test(content);
        const hasEnum = /AS\s+ENUM/i.test(content);
        const values = extractEnumValuesFromSql(content);

        if (!hasCreateType || !hasEnum || values.length === 0) {
          invalid.push(`${fileName}: missing CREATE TYPE ... AS ENUM or has no values`);
        }
      }

      expect(
        invalid,
        `Invalid enum files: [${invalid.join("; ")}]`
      ).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Completeness: SQL functions don't use enum values missing from source
  //    This is the key test that would have caught the 'shop' bug.
  // -------------------------------------------------------------------------
  describe("Function → Enum completeness (prevents 22P02 errors)", () => {
    const functionFiles = readSqlFiles(PATHS.sqlFunctions);

    it("comprehensive: all unique enum values used across all SQL functions are defined", () => {
      // Collect all unique (enumName, value) pairs used in functions
      const usedValues = new Map<string, Set<string>>();

      for (const [, content] of functionFiles) {
        const casts = extractEnumCasts(content);
        for (const cast of casts) {
          if (!KNOWN_ENUM_NAMES.has(cast.enumName)) continue;
          if (!usedValues.has(cast.enumName)) {
            usedValues.set(cast.enumName, new Set());
          }
          usedValues.get(cast.enumName)!.add(cast.value);
        }
      }

      const missingReport: string[] = [];

      for (const [enumName, usedValuesSet] of usedValues) {
        const defined = enumDefs.get(enumName);
        if (!defined) {
          missingReport.push(
            `${enumName}: no definition file found but used in functions with values: ` +
              `[${Array.from(usedValuesSet).sort().join(", ")}]`
          );
          continue;
        }

        const missing = Array.from(usedValuesSet).filter(
          (v) => !defined.has(v)
        );
        if (missing.length > 0) {
          missingReport.push(
            `${enumName}: values [${missing.join(", ")}] used in SQL functions ` +
              `but NOT in enum definition. ` +
              `This WILL cause 22P02 runtime errors!`
          );
        }
      }

      if (missingReport.length > 0) {
        console.error("\n🚨 CRITICAL: Enum values used in functions but missing from definitions:");
        missingReport.forEach((r) => console.error(`   - ${r}`));
        console.error("\nFix: Add missing values via migration (ALTER TYPE ... ADD VALUE IF NOT EXISTS ...)");
        console.error("Then update source of truth via ./refreshdb.sh\n");
      }

      expect(
        missingReport,
        `Found ${missingReport.length} enum consistency issues that would cause runtime 22P02 errors`
      ).toHaveLength(0);
    });

    it("summary: list all enum usages across SQL functions", () => {
      const summary = new Map<string, Set<string>>();

      for (const [, content] of functionFiles) {
        const casts = extractEnumCasts(content);
        for (const cast of casts) {
          if (!KNOWN_ENUM_NAMES.has(cast.enumName)) continue;
          if (!summary.has(cast.enumName)) {
            summary.set(cast.enumName, new Set());
          }
          summary.get(cast.enumName)!.add(cast.value);
        }
      }

      console.log("\n📊 Enum usage summary across SQL functions:");
      for (const [enumName, values] of Array.from(summary.entries()).sort()) {
        const defined = enumDefs.get(enumName);
        const definedCount = defined ? defined.size : 0;
        const usedCount = values.size;
        console.log(
          `   ${enumName}: ${usedCount} used / ${definedCount} defined — ` +
            `[${Array.from(values).sort().join(", ")}]`
        );
      }

      // This test always passes — it's informational
      expect(summary.size).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // 6. Named arguments: bare literals passed to enum-typed parameters
  //    `p_area := 'x'` is not a cast, so sections 1 and 5 never see it. The
  //    literal stays `unknown` until PL/pgSQL plans the call at run time:
  //    CREATE FUNCTION succeeds and EVERY call fails with 22P02. That is how
  //    create_entity_evidence_preflight_audited shipped `p_area := 'evidence'`
  //    (42af539b2, 2026-08-05 → cba0c2f9e, 2026-09-29) — each field-photo
  //    preflight rolled back on its own audit write.
  //    Parameter types come from the callee's signature in sql/functions, so
  //    any function with an enum parameter is covered, not just the journal.
  // -------------------------------------------------------------------------
  describe("Named arguments: bare literals passed to enum-typed parameters", () => {
    const enumParams = enumTypedParameters(
      extractFunctionSignatures(readSqlFiles(PATHS.sqlFunctions)),
      enumDefs
    );

    it("signature parser resolves write_audit_journal's enum parameters", () => {
      const params = enumParams.get("write_audit_journal");

      expect(params?.get("p_action_type")).toEqual(["journal_action_type"]);
      expect(params?.get("p_area")).toEqual(["journal_area"]);
      expect(params?.get("p_severity")).toEqual(["journal_severity"]);
      // Non-enum parameters stay out — their literals are free text.
      expect(params?.has("p_summary")).toBe(false);
      expect(params?.has("p_entity_type")).toBe(false);
    });

    // The detector must prove it can say NO before its silence on the real
    // tree means anything. The first call is the exact shape of the bug.
    it("control sample: an invalid bare literal is caught; casts, expressions, strings and comments are not", () => {
      const sample = [
        "CREATE OR REPLACE FUNCTION public.control_sample() RETURNS void",
        "LANGUAGE plpgsql AS $function$",
        "BEGIN",
        "  PERFORM public.write_audit_journal(",
        "    p_action_type := 'create',",
        "    p_area        := 'evidence',",
        "    p_details     := jsonb_build_object('area', 'not_an_area'),",
        "    p_summary     := 'free text, (not) an enum',",
        "    p_severity    => 'loud'",
        "  );",
        "  PERFORM write_audit_journal(p_action_type := 'update', p_area := 'operational_data', p_severity := 'info');",
        "  PERFORM write_audit_journal(p_action_type := 'create'::journal_action_type, p_area := v_area);",
        "  -- PERFORM write_audit_journal(p_area := 'in_a_comment');",
        "  RAISE NOTICE 'write_audit_journal(p_area := ''in_a_string'')';",
        "  PERFORM unknown_function(p_area := 'evidence');",
        "END;",
        "$function$;",
      ].join("\n");

      const literals = extractNamedEnumLiterals(sample, enumParams);

      expect(literals.map((l) => `${l.line}:${l.param}=${l.value}`)).toEqual([
        "5:p_action_type=create",
        "6:p_area=evidence",
        "9:p_severity=loud",
        "11:p_action_type=update",
        "11:p_area=operational_data",
        "11:p_severity=info",
      ]);
      expect(
        literals
          .filter((l) => !isValidEnumLiteral(l, enumDefs))
          .map((l) => `${l.line}:${l.param}=${l.value}`)
      ).toEqual(["6:p_area=evidence", "9:p_severity=loud"]);
    });

    it("every bare literal passed to an enum-typed named parameter is a valid enum value", () => {
      const callSiteFiles = new Map<string, string>();
      for (const [name, content] of readSqlFiles(PATHS.sqlRoot, true)) {
        callSiteFiles.set(path.join("aisha/db/sql", name), content);
      }
      for (const [name, content] of readSqlFiles(PATHS.migrations)) {
        if (name.includes("baseline")) continue; // generated from aisha/db/sql
        callSiteFiles.set(path.join("aisha/db/migrations", name), content);
      }

      const errors: string[] = [];
      let checked = 0;

      for (const [fileName, content] of callSiteFiles) {
        for (const literal of extractNamedEnumLiterals(content, enumParams)) {
          checked++;
          if (isValidEnumLiteral(literal, enumDefs)) continue;

          const valid = literal.enumNames.flatMap((e) => Array.from(enumDefs.get(e) ?? []));
          errors.push(
            `${fileName}:${literal.line} — ${literal.fn}(${literal.param} := '${literal.value}'): ` +
              `'${literal.value}' is NOT a valid value of ${literal.enumNames.join(" | ")}. ` +
              `Valid: [${valid.sort().join(", ")}]`
          );
        }
      }

      if (errors.length > 0) {
        console.error("\n❌ Invalid bare enum literals in named arguments (fail at run time with 22P02):");
        errors.forEach((e) => console.error(`   - ${e}`));
        console.error("\nFix: use an existing value, written as an explicit cast ('value'::enum_type).\n");
      }

      // Zero would mean the call scanner is blind, not that the tree is clean.
      expect(checked, "no bare enum literal in any named argument — scanner is not reading call sites").toBeGreaterThan(0);
      expect(
        errors,
        `Found ${errors.length} invalid bare enum literals in named arguments`
      ).toHaveLength(0);
    });
  });
});
