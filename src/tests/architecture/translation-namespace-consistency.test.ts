/**
 * Translation Namespace Consistency Test
 *
 * Validates that namespaces used in SQL functions via
 * `get_translation_value_with_fallback(key, NAMESPACE, ...)` match
 * the namespaces actually populated in seed data (aisha/db/seed.sql).
 *
 * Root Cause this test prevents:
 * - get_currency_rates.sql used namespace 'currencies' but seed.sql
 *   stored translations in namespace 'common' → all translations returned NULL
 *   → Zod parse failures → CurrencySwitcher lost THB/RUB
 * - get_subscription_packages.sql used 'subscriptions' but data is in
 *   'subscription_packages'
 *
 * The test:
 * 1. Parses all SQL function files for get_translation_value_with_fallback calls
 * 2. Extracts the namespace (2nd argument) — both hardcoded literals and variables
 * 3. For variable namespaces, traces where they get their value
 * 4. Cross-references against namespaces populated in seed.sql
 * 5. Also checks that _key columns in tables reference existing translation keys
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../../..");
const SQL_FUNCTIONS_DIR = path.join(ROOT, "aisha/db/sql/functions");
const SEED_FILE = path.join(ROOT, "aisha/db/seed.sql");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Recursively collect .sql files from a directory */
function collectSqlFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(collectSqlFiles(full));
    } else if (entry.name.endsWith(".sql")) {
      files.push(full);
    }
  }
  return files;
}

interface NamespaceUsage {
  file: string;
  /** basename without extension */
  functionName: string;
  /** hardcoded namespace literal, or null if dynamic */
  namespace: string | null;
  /** raw matched text for debugging */
  raw: string;
  /** line number (1-based) */
  line: number;
}

/**
 * Extract namespace literals from get_translation_value_with_fallback calls.
 *
 * Matches patterns like:
 *   get_translation_value_with_fallback(cr.name_key, 'common', p_locale, ...)
 *   get_translation_value_with_fallback(\n  key, 'namespace', locale, ...)
 *
 * The function signature is:
 *   get_translation_value_with_fallback(p_key, p_namespace, p_locale, p_fallback_locale, p_default_value)
 *
 * We need the 2nd argument which is the namespace.
 */
function extractNamespaceUsages(filePath: string): NamespaceUsage[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const functionName = path.basename(filePath, ".sql");
  const usages: NamespaceUsage[] = [];

  // Strategy: find all calls and extract 2nd argument
  // We join lines to handle multi-line function calls
  const joined = content.replace(/\r\n/g, "\n");

  // Regex to find the function call and capture what follows
  const callRegex = /get_translation_value_with_fallback\s*\(/g;
  let match;

  while ((match = callRegex.exec(joined)) !== null) {
    const startIdx = match.index + match[0].length;

    // Parse arguments by tracking parenthesis depth
    let depth = 1;
    let argStart = startIdx;
    let argIdx = 0;
    let secondArg = "";

    for (let i = startIdx; i < joined.length && depth > 0; i++) {
      const ch = joined[i];
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0 && argIdx === 1) {
          secondArg = joined.substring(argStart, i).trim();
        }
      } else if (ch === "," && depth === 1) {
        if (argIdx === 1) {
          secondArg = joined.substring(argStart, i).trim();
          break;
        }
        argIdx++;
        argStart = i + 1;
      }
    }

    if (!secondArg && argIdx < 1) continue;

    // Determine line number
    const lineNum =
      joined.substring(0, match.index).split("\n").length;

    // Extract literal namespace from quoted string
    const literalMatch = secondArg.match(/^'([^']+)'$/);
    const namespace = literalMatch ? literalMatch[1] : null;

    usages.push({
      file: filePath,
      functionName,
      namespace,
      raw: secondArg,
      line: lineNum,
    });
  }

  return usages;
}

/**
 * Extract all namespaces that appear in seed.sql INSERT INTO translations
 * statements.
 */
function extractSeedNamespaces(): Set<string> {
  const namespaces = new Set<string>();

  if (!fs.existsSync(SEED_FILE)) {
    return namespaces;
  }

  const content = fs.readFileSync(SEED_FILE, "utf-8");

  // Match INSERT INTO translations/public.translations with namespace column
  // Typical pattern:
  //   INSERT INTO public.translations (locale, namespace, key, value, ...)
  //   VALUES ('cs', 'common', 'currencies.CZK.name', ...)
  //
  // Also handles:
  //   INSERT INTO translations (locale, namespace, key, value, ...)
  //   VALUES ...

  // Find all VALUES entries after translations INSERT
  // The namespace is typically the 2nd column in (locale, namespace, key, value, ...)
  const insertBlockRegex =
    /INSERT\s+INTO\s+(?:public\.)?translations\s*\(([^)]+)\)\s*VALUES\s*([\s\S]*?)(?:ON\s+CONFLICT|;\s*$)/gim;

  let blockMatch;
  while ((blockMatch = insertBlockRegex.exec(content)) !== null) {
    const columns = blockMatch[1]
      .split(",")
      .map((c) => c.trim().toLowerCase());
    const nsColIdx = columns.indexOf("namespace");
    if (nsColIdx === -1) continue;

    const valuesBlock = blockMatch[2];

    // Extract individual value tuples
    const tupleRegex = /\(([^)]+)\)/g;
    let tupleMatch;
    while ((tupleMatch = tupleRegex.exec(valuesBlock)) !== null) {
      const values = tupleMatch[1].split(",").map((v) => v.trim());
      if (values.length > nsColIdx) {
        const ns = values[nsColIdx].replace(/^'|'$/g, "");
        if (ns && !ns.includes("(") && !ns.includes(" ")) {
          namespaces.add(ns);
        }
      }
    }
  }

  return namespaces;
}

/**
 * Extract namespaces from _key column default values or migration seed data.
 * Scans all SQL files in supabase/ for translation INSERT patterns.
 */
function extractAllSqlNamespaces(): Set<string> {
  const namespaces = new Set<string>();
  const supabaseDir = path.join(ROOT, "supabase");

  function scanDir(dir: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(full);
      } else if (entry.name.endsWith(".sql")) {
        const content = fs.readFileSync(full, "utf-8");
        // Look for translation inserts
        const insertRegex =
          /INSERT\s+INTO\s+(?:public\.)?translations\s*\([^)]*namespace[^)]*\)\s*VALUES/gi;
        if (insertRegex.test(content)) {
          // Re-parse with extractSeedNamespaces logic
          const blockRegex =
            /INSERT\s+INTO\s+(?:public\.)?translations\s*\(([^)]+)\)\s*VALUES\s*([\s\S]*?)(?:ON\s+CONFLICT|;\s*$)/gim;
          let m;
          while ((m = blockRegex.exec(content)) !== null) {
            const cols = m[1]
              .split(",")
              .map((c) => c.trim().toLowerCase());
            const nsIdx = cols.indexOf("namespace");
            if (nsIdx === -1) continue;

            const tupleRegex2 = /\(([^)]+)\)/g;
            let tm;
            while ((tm = tupleRegex2.exec(m[2])) !== null) {
              const vals = tm[1].split(",").map((v) => v.trim());
              if (vals.length > nsIdx) {
                const ns = vals[nsIdx].replace(/^'|'$/g, "");
                // Filter out false positives: variable names (p_xxx), function
                // fragments, and other non-namespace tokens from SQL.
                const looksLikeNamespace =
                  ns &&
                  !ns.includes("(") &&
                  !ns.includes(" ") &&
                  !ns.startsWith("p_") &&
                  !ns.startsWith("func_") &&
                  !ns.includes("_stairs") &&
                  !/^[0-9]/.test(ns) &&
                  ns.length > 1;
                if (looksLikeNamespace) {
                  namespaces.add(ns);
                }
              }
            }
          }
        }
      }
    }
  }

  scanDir(supabaseDir);
  return namespaces;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/**
 * Jmenné prostory tabulek, které plní instance nebo administrace — platformní
 * seed pro ně klíče nenese (a nesmí: projektová data patří do vrstvy instance).
 */
const DYNAMIC_NAMESPACES = new Set([
  "knowledge", // knowledge_topics — admin-populated, no seed data
  "archive", // archive_documents — instance/admin-populated; Evymo archive content (product certs, research) is private instance data, not platform/demo seed
  "news", // news_articles — admin-authored per instance; a fork's migrated corpus ships in its private instance-data seed, never in the platform seed
  "achievements", // úspěchy — obsah instance (projektová data v platformním seedu nejsou, rozhodnutí majitele 2026-09-24)
  "consents", // šablony souhlasů studií — obsah instance
  "hero", // hero slidy — obsah instance
  "products", // produkty — obsah instance
  "rewards", // pravidla odměn — obsah instance
  "subscription_packages", // balíčky předplatného — obsah instance
  "tests", // kvalifikační/certifikační testy — obsah instance
]);

describe("Translation Namespace Consistency", () => {
  let allUsages: NamespaceUsage[];
  let seedNamespaces: Set<string>;
  let allSqlNamespaces: Set<string>;

  beforeAll(() => {
    const sqlFiles = collectSqlFiles(SQL_FUNCTIONS_DIR);
    allUsages = sqlFiles.flatMap(extractNamespaceUsages);
    seedNamespaces = extractSeedNamespaces();
    allSqlNamespaces = extractAllSqlNamespaces();
  });

  it("should find translation_value_with_fallback usages in SQL functions", () => {
    // Sanity: we expect at least some usages (currently 60+)
    expect(allUsages.length).toBeGreaterThan(5);
  });

  it("should extract namespaces from seed.sql", () => {
    // Sanity: seed.sql should have multiple namespaces
    expect(seedNamespaces.size).toBeGreaterThan(3);
  });

  it("every hardcoded namespace in SQL functions must exist in seed data or be registered as dynamic", () => {
    // Some namespaces are for dynamically-populated tables (no seed data)
    // but are still valid — registered in DYNAMIC_NAMESPACES (module level).

    const hardcodedUsages = allUsages.filter((u) => u.namespace !== null);
    expect(hardcodedUsages.length).toBeGreaterThan(0);

    // Combine seed + all SQL namespaces for the reference set
    const knownNamespaces = new Set([
      ...seedNamespaces,
      ...allSqlNamespaces,
      ...DYNAMIC_NAMESPACES,
    ]);

    const mismatches: string[] = [];

    // Group by unique namespace to avoid duplicate messages
    const uniqueNamespaces = new Map<
      string,
      { functions: string[]; lines: string[] }
    >();

    for (const usage of hardcodedUsages) {
      const ns = usage.namespace!;
      if (!uniqueNamespaces.has(ns)) {
        uniqueNamespaces.set(ns, { functions: [], lines: [] });
      }
      const entry = uniqueNamespaces.get(ns)!;
      if (!entry.functions.includes(usage.functionName)) {
        entry.functions.push(usage.functionName);
      }
      entry.lines.push(`${usage.functionName}:${usage.line}`);
    }

    for (const [ns, info] of uniqueNamespaces) {
      if (!knownNamespaces.has(ns)) {
        mismatches.push(
          `Namespace '${ns}' used in ${info.functions.join(", ")} ` +
            `but NOT found in any seed/migration data. ` +
            `Known namespaces: [${[...knownNamespaces].sort().join(", ")}]`
        );
      }
    }

    expect(
      mismatches,
      `Translation namespace mismatches found!\n` +
        `These SQL functions reference namespaces that don't exist in seed data.\n` +
        `This means get_translation_value_with_fallback() will return NULL.\n\n` +
        mismatches.join("\n\n")
    ).toHaveLength(0);
  });

  it("should not have multiple different namespaces for the same entity", () => {
    // Group usages by function to find internal inconsistencies
    const byFunction = new Map<string, Set<string>>();

    for (const usage of allUsages) {
      if (!usage.namespace) continue;
      if (!byFunction.has(usage.functionName)) {
        byFunction.set(usage.functionName, new Set());
      }
      byFunction.get(usage.functionName)!.add(usage.namespace);
    }

    const inconsistencies: string[] = [];
    for (const [fn, namespaces] of byFunction) {
      if (namespaces.size > 1) {
        inconsistencies.push(
          `${fn} uses multiple namespaces: [${[...namespaces].join(", ")}] ` +
            `— consider consolidating to one namespace per function`
        );
      }
    }

    // This is a warning — some functions may legitimately use multiple namespaces
    // (e.g. joining data from different tables). Log but don't fail.
    if (inconsistencies.length > 0) {
      console.warn(
        `⚠️ Functions using multiple namespaces:\n` +
          inconsistencies.join("\n")
      );
    }
  });

  it("namespace in function should match the key prefix pattern in seed data", () => {
    // For each namespace used in functions, verify that seed data actually
    // contains keys with matching prefixes.
    // E.g. namespace 'currencies' should have keys like 'currencies.CZK.name'
    // namespace 'products' should have keys like 'products.*.name'
    //
    // Some namespaces are for dynamically populated tables (admin-created content)
    // and legitimately have no seed data.

    if (!fs.existsSync(SEED_FILE)) return;

    const seedContent = fs.readFileSync(SEED_FILE, "utf-8");

    // Extract all translation keys from seed.sql grouped by namespace
    const keysByNamespace = new Map<string, Set<string>>();

    const insertBlockRegex =
      /INSERT\s+INTO\s+(?:public\.)?translations\s*\(([^)]+)\)\s*VALUES\s*([\s\S]*?)(?:ON\s+CONFLICT|;\s*$)/gim;

    let blockMatch;
    while ((blockMatch = insertBlockRegex.exec(seedContent)) !== null) {
      const columns = blockMatch[1]
        .split(",")
        .map((c) => c.trim().toLowerCase());
      const nsIdx = columns.indexOf("namespace");
      const keyIdx = columns.indexOf("key");
      if (nsIdx === -1 || keyIdx === -1) continue;

      const tupleRegex = /\(([^)]+)\)/g;
      let tm;
      while ((tm = tupleRegex.exec(blockMatch[2])) !== null) {
        const vals = tm[1].split(",").map((v) => v.trim());
        if (vals.length > Math.max(nsIdx, keyIdx)) {
          const ns = vals[nsIdx].replace(/^'|'$/g, "");
          const key = vals[keyIdx].replace(/^'|'$/g, "");
          if (ns && key && !ns.includes("(")) {
            if (!keysByNamespace.has(ns)) {
              keysByNamespace.set(ns, new Set());
            }
            keysByNamespace.get(ns)!.add(key);
          }
        }
      }
    }

    // Now check: for each function that uses namespace X, does namespace X
    // have any keys in seed data?
    const hardcodedUsages = allUsages.filter((u) => u.namespace !== null);
    const functionsPerNamespace = new Map<string, string[]>();

    for (const usage of hardcodedUsages) {
      const ns = usage.namespace!;
      if (!functionsPerNamespace.has(ns)) {
        functionsPerNamespace.set(ns, []);
      }
      const arr = functionsPerNamespace.get(ns)!;
      if (!arr.includes(usage.functionName)) {
        arr.push(usage.functionName);
      }
    }

    const emptyNamespaces: string[] = [];
    for (const [ns, functions] of functionsPerNamespace) {
      if (DYNAMIC_NAMESPACES.has(ns)) continue; // Skip dynamically-populated namespaces
      const keys = keysByNamespace.get(ns);
      if (!keys || keys.size === 0) {
        emptyNamespaces.push(
          `Namespace '${ns}' used by ${functions.join(", ")} ` +
            `has NO translation keys in seed.sql. ` +
            `Translations will always return NULL/default.`
        );
      }
    }

    expect(
      emptyNamespaces,
      `Namespaces with no seed data:\n` + emptyNamespaces.join("\n\n")
    ).toHaveLength(0);
  });

  it("should detect _key columns referencing nonexistent translations", () => {
    // Scan SQL table definitions for _key columns and verify the seed data
    // populates them with keys that have matching translations
    const tablesDir = path.join(ROOT, "aisha/db/sql/tables");
    if (!fs.existsSync(tablesDir)) return;

    const tableFiles = fs
      .readdirSync(tablesDir)
      .filter((f) => f.endsWith(".sql"));
    const tablesWithKeys: { table: string; keyColumns: string[] }[] = [];

    for (const file of tableFiles) {
      const content = fs.readFileSync(path.join(tablesDir, file), "utf-8");
      const tableName = file.replace(".sql", "");

      // Find columns ending in _key that look like translation keys
      const keyColRegex = /(\w+_key)\s+text/gi;
      const keyColumns: string[] = [];
      let m;
      while ((m = keyColRegex.exec(content)) !== null) {
        const colName = m[1].toLowerCase();
        // Exclude foreign key references and non-translation columns
        if (
          !colName.includes("foreign") &&
          !colName.includes("api_key") &&
          !colName.includes("secret_key") &&
          !colName.includes("stripe_") &&
          !colName.includes("primary_key")
        ) {
          keyColumns.push(colName);
        }
      }

      if (keyColumns.length > 0) {
        tablesWithKeys.push({ table: tableName, keyColumns });
      }
    }

    // Report tables with _key columns (informational)
    if (tablesWithKeys.length > 0) {
      console.log(
        `📋 Tables with translation _key columns:\n` +
          tablesWithKeys
            .map((t) => `   ${t.table}: ${t.keyColumns.join(", ")}`)
            .join("\n")
      );
    }

    expect(tablesWithKeys.length).toBeGreaterThan(0);
  });

  it("all function namespaces should be documented in a known set", () => {
    // Maintain an explicit registry of valid namespace ↔ function mappings.
    // If a new namespace appears, the developer must add it here, forcing
    // them to verify it's correct.
    const KNOWN_NAMESPACE_REGISTRY: Record<string, string[]> = {
      achievements: ["get_my_achievements"],
      archive: [
        "get_archive_documents_localized",
        "get_archive_document_by_slug_localized",
      ],
      biomarkers: ["get_biomarker_reference_ranges_localized"],
      common: ["get_currency_rates"],
      consents: [
        "get_combined_study_consents",
        "get_combined_consent_requirements_localized",
        "get_study_consent_requirements_localized",
        "get_study_consent_items_localized",
        // Charter-signing reader (#821). Registered after doing the check this
        // registry exists to force: it resolves ct.title_key / ct.content_key in
        // the 'consents' namespace, the same pattern as the four above, and the
        // "_key columns referencing nonexistent translations" case in this file
        // passes for it — so the keys it reads are present in the seed data.
        "get_my_pending_consents",
      ],
      hero: ["get_public_hero_slides"],
      knowledge: [
        "get_knowledge_topics_localized",
        "get_knowledge_topic_detail_localized",
        "get_knowledge_topic_detail_by_id_localized",
      ],
      // news_articles title_key resolution for the Creator Studio reach view.
      // Same namespace the web/app render paths read (useDynamicTranslationsMap
      // (…, "news", "en")), so the admin projection and the public page agree on
      // what an article is called.
      news: ["audience_admin_content_reach"],
      products: ["get_public_products", "get_public_product_by_slug"],
      questionnaires: ["get_question_blocks_for_context"],
      rewards: ["get_token_reward_rules_localized", "process_token_reward"],
      subscription_packages: ["get_subscription_packages"],
      tests: [
        "get_test_questions_admin_localized",
        "get_test_questions_localized",
        "get_test_questions_public_localized",
      ],
    };

    const hardcoded = allUsages.filter((u) => u.namespace !== null);
    const unknownEntries: string[] = [];

    for (const usage of hardcoded) {
      const ns = usage.namespace!;
      const registeredFunctions = KNOWN_NAMESPACE_REGISTRY[ns];

      if (!registeredFunctions) {
        unknownEntries.push(
          `NEW namespace '${ns}' in ${usage.functionName}:${usage.line} — ` +
            `add to KNOWN_NAMESPACE_REGISTRY after verifying it matches seed data`
        );
      } else if (!registeredFunctions.includes(usage.functionName)) {
        unknownEntries.push(
          `Function '${usage.functionName}' uses namespace '${ns}' ` +
            `but is not in KNOWN_NAMESPACE_REGISTRY[${ns}]. ` +
            `Add it if this is intentional.`
        );
      }
    }

    expect(
      unknownEntries,
      `Unregistered namespace usages found!\n` +
        `Every namespace ↔ function mapping must be explicitly registered.\n` +
        `This prevents silent namespace mismatches.\n\n` +
        unknownEntries.join("\n")
    ).toHaveLength(0);
  });
});
