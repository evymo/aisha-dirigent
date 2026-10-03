/**
 * Gate (remediation forkability -- currency is per-instance config, never baked):
 * the fiat currency an AISHA instance transacts in MUST be resolvable as data
 * (the `currencies` / `currency_rates` registry + the `commerce_base_currency`
 * app_config setting + convert_currency_amount), NEVER baked into the schema as a
 * column-name suffix, nor hardcoded as a DEFAULT/FALLBACK literal in the SoT.
 *
 * WHY (verified leaks -- a fork in EUR/USD inherits CZK today):
 *  - payout_ledger.amount_czk bakes the fiat currency into the COLUMN NAME. A
 *    EUR/USD fork stores foreign amounts in a column literally named `_czk`.
 *  - The base-currency resolvers hardcode a CZK fallback --
 *    `v_base_currency text := 'CZK'` and `COALESCE(v_rates->>'base_currency','CZK')`
 *    -- so a fork silently defaults to CZK instead of reading its own config.
 *  - The dynamic system already exists (currency_rates registry, the
 *    commerce_base_currency app_config key, convert_currency_amount). So the
 *    correct post-fix state is: money columns are currency-NEUTRAL (an `amount`
 *    plus a `currency` / `currency_code` reference column, the currency being
 *    data), and the base currency is READ FROM CONFIG, not a baked literal.
 *
 * CONTRACT asserted (the CORRECT post-fix state -- a fix turns this green; this
 * gate does NOT assert the buggy present state):
 *
 *  (A) No table column under aisha/db/sql/tables/ carries a fiat-currency-code
 *      SUFFIX that bakes the currency into the schema -- column names matching
 *      _(czk|eur|usd|gbp|pln|chf) at a word boundary (e.g. `amount_czk`,
 *      `price`) are rejected. Money columns must be currency-neutral so the
 *      currency is DATA, not schema. Each offender is reported as table.column.
 *
 *  (B) No SoT statement under aisha/db/sql/ (functions, tables, views, ... --
 *      the whole tree; seed + baseline live OUTSIDE this tree and are not
 *      scanned) hardcodes a fiat ISO currency literal in a DEFAULT / FALLBACK
 *      position: an assignment default (`:= 'CZK'`), a COALESCE fallback
 *      (`COALESCE(currency, 'CZK')`), or a parameter/column DEFAULT
 *      (`DEFAULT 'CZK'`), for ISO in {CZK,EUR,USD,GBP,PLN,CHF}. The base
 *      currency must come from config, not a baked literal. Each offender is
 *      reported as file:line.
 *
 * PRECISION (avoid false positives):
 *  - Only aisha/db/sql/ is scanned. Seed files and the generated baseline live
 *    under aisha/db/seed/ and aisha/db/migrations/ -- OUTSIDE this tree -- so the
 *    `currencies` registry DATA ROW containing 'CZK' is never scanned. A path
 *    guard also skips anything that looks like seed / baseline / migrations.
 *  - Comments are stripped before scanning, so a currency code in prose (e.g. a
 *    `-- Amount in CZK` comment) never triggers.
 *  - (A) parses actual CREATE TABLE column identifiers, so a currency code in a
 *    COMMENT ON COLUMN string, a CHECK constraint reference, or a comment is not
 *    mistaken for a column.
 *  - (B) matches the ISO literal only in the three DEFAULT/FALLBACK positions.
 *    A json key access such as `(cost_json->>'usd')::numeric, 0)` (fallback 0)
 *    and a currency code used as a convert TARGET argument inside a nested call
 *    are intentionally NOT flagged by (B) -- they are not DEFAULT/FALLBACK slots.
 *
 * SANITY: passing assertions confirm the scan is not empty (payout_ledger.sql
 * parses to columns; the sql tree yields files; the dynamic currency registry
 * exists) so a green result can never come from scanning nothing.
 *
 * KNOWN-RED at authoring time (branch feat/remediation, HEAD-era): (A) flags 25
 * currency-suffixed columns (payout_ledger.amount_czk, revenue_splits.amount_czk,
 * project_revenue.total_amount_czk, subscription_packages.price_czk/price,
 * currency_rates.rate_to_czk, ...) — including the ai_* cost/budget columns,
 * now stored currency-neutral (the provider's USD is carried as data, not the
 * column name), so NO fiat suffix is allowlisted anywhere; (B)
 * flags 30 baked ISO literals (the CZK base-currency resolvers plus the
 * `DEFAULT 'CZK'` currency columns). After the forkability fix -- currency-neutral
 * money columns + config-sourced base currency -- both parts go green.
 *
 * STATIC / OFFLINE / deterministic: walks the aisha/db/sql SoT only. No DB, no
 * network, no new deps.
 * Run: AISHA_SKIP_ONLINE=1 npx vitest run --config vitest.gates.config.ts \
 *   src/tests/gates/remediation/currency-dynamic-no-hardcode.gate.test.ts
 */
import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SQL_DIR = join(ROOT, "aisha/db/sql");
const TBL_DIR = join(SQL_DIR, "tables");

/** Fixed set of fiat ISO currency codes the forkability contract governs. */
const FIAT = "czk|eur|usd|gbp|pln|chf";

/** (A) A column name that bakes a fiat currency into the schema as a suffix. */
const SUFFIX = new RegExp(`_(${FIAT})\\b`, "i");

/** (B) The three DEFAULT / FALLBACK positions that bake a base-currency literal. */
const RE_ASSIGN = new RegExp(`:=\\s*'(${FIAT})'`, "i"); // v_base_currency := 'CZK'
const RE_COALESCE = new RegExp(`COALESCE\\s*\\(\\s*[^()]*,\\s*'(${FIAT})'\\s*\\)`, "i"); // COALESCE(x,'CZK')
const RE_DEFAULT = new RegExp(`DEFAULT\\s+'(${FIAT})'`, "i"); // DEFAULT 'CZK'

/** Leading tokens inside a CREATE TABLE body that are NOT column names. */
const NON_COLUMN = new Set([
  "constraint",
  "primary",
  "foreign",
  "unique",
  "check",
  "exclude",
  "like",
]);

/** Remove line + block comments (content only) so prose never matches. */
function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

/** Collapse single-quoted string literals so their parens/commas do not skew
 *  the CREATE TABLE paren-depth walk. Column names are identifiers, never in
 *  strings, so nothing of interest to (A) is lost. */
function stripStrings(sql: string): string {
  return sql.replace(/'(?:[^']|'')*'/g, "''");
}

/** Extract the parenthesised CREATE TABLE body (depth-balanced), comment- and
 *  string-stripped so the walk is robust. */
function tableBody(sql: string): string {
  const cleaned = stripStrings(stripComments(sql));
  const m = /CREATE\s+TABLE/i.exec(cleaned);
  if (!m) return "";
  const open = cleaned.indexOf("(", m.index);
  if (open === -1) return "";
  let depth = 0;
  for (let i = open; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return cleaned.slice(open + 1, i);
    }
  }
  return "";
}

/** Split a table body into top-level elements and return the leading identifier
 *  of each real column definition (constraint clauses skipped). */
function columnNames(body: string): string[] {
  const names: string[] = [];
  let depth = 0;
  let cur = "";
  const flush = () => {
    const t = cur.trim();
    cur = "";
    if (!t) return;
    const m = /^"?([A-Za-z_][A-Za-z0-9_]*)"?/.exec(t);
    if (!m) return;
    const id = m[1].toLowerCase();
    if (NON_COLUMN.has(id)) return;
    names.push(id);
  };
  for (const ch of body) {
    if (ch === "(") {
      depth++;
      cur += ch;
    } else if (ch === ")") {
      depth--;
      cur += ch;
    } else if (ch === "," && depth === 0) {
      flush();
    } else {
      cur += ch;
    }
  }
  flush();
  return names;
}

/** Recursively list every .sql file beneath a directory. */
function walkSql(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walkSql(p));
    else if (entry.endsWith(".sql")) out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------
// (A) currency-suffixed column names under aisha/db/sql/tables/
// ---------------------------------------------------------------------------
const tableFiles = readdirSync(TBL_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const payoutColumns = columnNames(
  tableBody(readFileSync(join(TBL_DIR, "payout_ledger.sql"), "utf8")),
);

// No allowlist: money is currency-neutral EVERYWHERE. AI provider-billing
// columns (cost/budget) are stored currency-neutral too (the provider's USD is
// carried as data, not baked into the column NAME) — so no `_usd` suffix is
// permitted on any table.
const offendingColumns: string[] = [];
for (const file of tableFiles) {
  const table = file.replace(/\.sql$/, "");
  const cols = columnNames(tableBody(readFileSync(join(TBL_DIR, file), "utf8")));
  for (const c of cols) if (SUFFIX.test(c)) offendingColumns.push(`${table}.${c}`);
}

// ---------------------------------------------------------------------------
// (B) baked ISO currency literals in DEFAULT / FALLBACK positions in the SoT
// ---------------------------------------------------------------------------
const offendingLiterals: string[] = [];
for (const path of walkSql(SQL_DIR)) {
  const rel = path.slice(ROOT.length + 1);
  // Belt-and-braces: never scan seed / baseline / migrations even if a stray
  // copy lands under the sql tree -- registry DATA rows legitimately hold 'CZK'.
  if (/(^|\/)seed|baseline|\/migrations\//i.test(rel)) continue;
  // Strip block comments but keep newlines so reported line numbers stay true.
  const text = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, (m) =>
    m.replace(/[^\n]/g, " "),
  );
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/--.*$/, ""); // drop trailing line comment
    let kind = "";
    if (RE_ASSIGN.test(line)) kind = ":=";
    else if (RE_COALESCE.test(line)) kind = "COALESCE";
    else if (RE_DEFAULT.test(line)) kind = "DEFAULT";
    if (kind) offendingLiterals.push(`${rel}:${i + 1} [${kind}] ${line.trim()}`);
  }
}

describe("forkability -- currency is dynamic config, never baked into the SoT", () => {
  // -- Sanity: the scan is live (a green must not come from scanning nothing) --
  describe("sanity (these pass today -- prove the detector has real input)", () => {
    test("payout_ledger.sql exists and parses to real columns", () => {
      expect(existsSync(join(TBL_DIR, "payout_ledger.sql"))).toBe(true);
      expect(payoutColumns.length).toBeGreaterThan(0);
      expect(payoutColumns).toContain("user_id"); // proves the parser works
    });

    test("the aisha/db/sql tree yields SoT files to scan", () => {
      expect(tableFiles.length).toBeGreaterThan(0);
      expect(walkSql(SQL_DIR).length).toBeGreaterThan(0);
    });

    test("the dynamic currency registry exists (currency is data, not schema)", () => {
      expect(existsSync(join(TBL_DIR, "currency_rates.sql"))).toBe(true);
    });
  });

  // -- (A) no fiat-currency-code column-name suffixes ------------------------
  test("(A) no table column bakes a fiat currency into its NAME (currency-neutral schema)", () => {
    expect(
      offendingColumns,
      `Currency-suffixed money columns bake the currency into the schema. Make ` +
        `them currency-neutral (amount + a currency/currency_code reference). ` +
        `Offenders (${offendingColumns.length}):\n  ` +
        offendingColumns.join("\n  "),
    ).toEqual([]);
  });

  // -- (B) no baked ISO base-currency literals ------------------------------
  test("(B) no SoT statement hardcodes a fiat ISO currency in a DEFAULT/FALLBACK slot", () => {
    expect(
      offendingLiterals,
      `Base currency must be read from config (commerce_base_currency / the ` +
        `currency registry), not baked as a literal. Offenders ` +
        `(${offendingLiterals.length}):\n  ` +
        offendingLiterals.join("\n  "),
    ).toEqual([]);
  });
});
