#!/usr/bin/env node
/**
 * AISHA → per-instance Rebrand Toolkit
 * ====================================
 *
 * Systematic, brand-PARAMETERIZED rebrand of the user-facing TEXTUAL brand from
 * the canonical "AISHA" base to a per-instance brand, driven by a reviewed brand
 * definition file. Reuses the original toolkit's walk/exclude/scan/apply skeleton;
 * the old one-way `evymo → aisha` migration transforms are gone (that migration is
 * complete — every rule had become a no-op).
 *
 * OWNER INVARIANT: core/business logic never changes, only presentation. So this
 * tool rewrites ONLY user-facing display text; it NEVER touches code identifiers
 * (`@aisha/` scope, `aisha_*` schemas, `AISHA_*` env, n8n `aishaXxx`), infra/service
 * names, the realm slug, CSS custom properties, or legal/owner text.
 *
 * SAFETY MODEL (why a blind `s/AISHA/<brand>/` is impossible):
 *   1. Only an EXPLICIT, ordered, multi-word phrase map is applied — there is NO
 *      bare-"AISHA" rule (bare AISHA is simultaneously the token currency, the
 *      persona, the ecosystem and a schema/env prefix — unsafe to sweep). Verified
 *      2026-07-17: member.json ships "Spend your AISHA", "Redeem {{amount}} AISHA"
 *      as the token currency; a bare rule would corrupt it.
 *   2. i18n JSON is transformed with a value-ONLY visitor (object keys, i.e. t()
 *      lookup paths like `tokens.types.aisha`, are structurally unreachable).
 *   3. A hard NEVER list short-circuits legal text, self-knowledge seed and the
 *      instance identity SQL regardless of category.
 *   4. `--report` prints every file:line hit + source→target so the map is
 *      reviewed before any write; `--apply` refuses without `--brand`.
 *
 * Brand file (see implementations-<instance>/aisha-config/brand.json):
 *   identity slice (consumed HERE): display_name, short_name, product_name,
 *   id_product_name, assistant_name?, token_name?, phrase_overrides?[].
 *   (operator + values slices are consumed by branding_profiles / the token
 *   pipeline, NOT this tool.)
 *
 * Usage:
 *   node scripts/rebrand/rebrand.mjs --brand <brand.json> [--root <dir>] --report
 *   node scripts/rebrand/rebrand.mjs --brand <brand.json> [--root <dir>] --scan
 *   node scripts/rebrand/rebrand.mjs --brand <brand.json> [--root <dir>] --apply <category|all>
 *
 * Categories: i18n · keycloak · web-shell · mobile.
 *
 * INTEGRATION: run as a BUILD-TIME OVERLAY on an ephemeral instance checkout,
 * BEFORE the downstream builds that bake the text (i18n:segments:build, the web
 * image, the Keycloak theme image). Never commit the branded tree back — the
 * shared source stays canonical AISHA so the codebase never diverges per client.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, relative, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { mode: null, category: null, brand: null, root: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--scan" || a === "-s") out.mode = "scan";
    else if (a === "--report" || a === "-r") out.mode = "report";
    else if (a === "--apply" || a === "-a") { out.mode = "apply"; out.category = argv[++i]; }
    else if (a === "--brand" || a === "-b") out.brand = argv[++i];
    else if (a === "--root") out.root = argv[++i];
    else if (a.startsWith("--brand=")) out.brand = a.slice("--brand=".length);
    else if (a.startsWith("--root=")) out.root = a.slice("--root=".length);
  }
  return out;
}

const DEFAULT_ROOT = fileURLToPath(new URL("../..", import.meta.url));

// ---------------------------------------------------------------------------
// Exclusions (reused skeleton)
// ---------------------------------------------------------------------------

const EXCLUDED_DIRS = new Set([
  "node_modules", "dist", "build", "coverage", ".git", ".turbo", ".next",
  ".cache", "workbench", "archive", "trash", "offline-knowledge",
  "test-results", "playwright-report", ".aisha-cache",
  // Expo / RN build output when --root points at the mobile tree
  "Pods", ".expo",
]);

const EXCLUDED_FILES = new Set([
  "package-lock.json", "bun.lockb", "yarn.lock", "pnpm-lock.yaml",
  ".env-prod-backup", "LICENSE", "LICENSE.md", "NOTICE",
]);

const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg",
  ".pdf", ".zip", ".tar", ".gz", ".tgz", ".bz2",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".mp3", ".mp4", ".webm", ".wav",
  ".lockb", ".lock", ".keystore", ".jks", ".p12", ".pem", ".p8", ".crt", ".key",
]);

// Hard NEVER — files whose brand-looking text is legally/semantically load-bearing
// and must never be swept, regardless of category. Matched on the path SUFFIX so
// it holds whether --root is the repo or an ephemeral checkout.
const NEVER_SUFFIXES = [
  "legal.json",                        // GDPR controller / ToS / disclaimer
  "_identity.sql",               // instance identity is DATA, seeded verbatim
  "_self_knowledge.sql",               // AISHA platform self-knowledge KB
];

function isNeverFile(rel) {
  const name = basename(rel);
  return NEVER_SUFFIXES.some((s) => name === s || rel.endsWith(s));
}

function isExcluded(absPath, root) {
  const parts = relative(root, absPath).split("/");
  for (const p of parts) if (EXCLUDED_DIRS.has(p)) return true;
  const name = basename(absPath);
  if (EXCLUDED_FILES.has(name)) return true;
  const ext = name.includes(".") ? "." + name.split(".").pop() : "";
  if (BINARY_EXT.has(ext.toLowerCase())) return true;
  return false;
}

function* walk(dir, root) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); }
  catch (err) {
    // Unreadable dir (permission, missing) — skip quietly, keep walking siblings.
    void err;
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (isExcluded(full, root)) continue;
    if (entry.isDirectory()) yield* walk(full, root);
    else if (entry.isFile()) yield full;
  }
}

function isTextFile(path) {
  try {
    const buf = readFileSync(path);
    for (let i = 0; i < Math.min(buf.length, 4096); i++) if (buf[i] === 0) return false;
    return true;
  } catch { return false; }
}

// ---------------------------------------------------------------------------
// Brand definition → reviewed phrase map
// ---------------------------------------------------------------------------

function loadBrand(path) {
  if (!path) throw new Error("--brand <brand.json> is required");
  const abs = resolve(path);
  if (!existsSync(abs)) throw new Error(`brand file not found: ${abs}`);
  const raw = JSON.parse(readFileSync(abs, "utf8"));
  // The brand file has THREE slices; the rebrand tool consumes ONLY `identity`.
  // Accept a flat file too (identity fields at top level) for simple callers.
  const brand = raw.identity && typeof raw.identity === "object" ? raw.identity : raw;
  for (const k of ["display_name", "short_name", "product_name", "id_product_name"]) {
    if (!brand[k] || typeof brand[k] !== "string") {
      throw new Error(`brand file identity slice missing required string field: ${k}`);
    }
  }
  return brand;
}

// escape a literal source phrase for use in a RegExp
function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

/**
 * Compile the ORDERED phrase map (longest source first). Every rule is a
 * multi-word, word-boundary-anchored display phrase — never a bare "AISHA".
 * Persona/token rules exist ONLY when the brand opts in via assistant_name /
 * token_name, so an instance without a token economy can never rewrite it.
 */
function buildPhraseMap(brand, opts = {}) {
  const rules = [];
  const add = (source, target, id) => {
    if (!source || !target) return;
    rules.push({ id, source, target, re: new RegExp(`\\b${esc(source)}\\b`, "g") });
  };

  // "AISHA Dirigent" is the product EDITION on the web (→ product_name, e.g. "Acme
  // Extranet") but the APP itself on mobile, where it must match the store/home
  // name the version.json overlay sets (→ display_name, e.g. "Acme Analytics").
  // Surface picks the target so the two never disagree.
  const appName = opts.appName || brand.product_name;

  // Core product / platform / SSO display names (always on).
  add("AISHA Dirigent", appName, "appname");
  add("AISHA Platform", brand.display_name, "platform");
  add("AISHA ID", brand.id_product_name, "id");

  // Opt-in persona (kept by default — leaving assistant_name unset preserves it).
  if (brand.assistant_name) add("Aisha", brand.assistant_name, "persona");

  // Opt-in token economy (kept by default — unset means the token surfaces stay).
  if (brand.token_name) {
    add("AISHA Tokens", `${brand.token_name} Tokens`, "token-plural");
    add("AISHA Token", `${brand.token_name} Token`, "token");
  }

  // Operator-reviewed one-off overrides (appended; longest-first re-sort keeps
  // built-in precedence correct).
  for (const o of brand.phrase_overrides || []) {
    if (o && o.source && o.target) add(o.source, o.target, "override");
  }

  // Longest source first so "AISHA Dirigent" wins over any shorter overlap.
  rules.sort((a, b) => b.source.length - a.source.length);
  return rules;
}

function applyRules(text, rules, onHit) {
  let out = text;
  for (const rule of rules) {
    rule.re.lastIndex = 0;
    out = out.replace(rule.re, () => { if (onHit) onHit(rule); return rule.target; });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Category scope + transform
// ---------------------------------------------------------------------------

const CATEGORIES = ["i18n", "keycloak", "web-shell", "mobile-i18n", "mobile-store"];

const SCOPE_FILTERS = {
  i18n: (rel) => /^src\/i18n\/segments\/[^/]+\/.+\.json$/.test(rel),
  keycloak: (rel) =>
    /^keycloak\/themes\/aisha\/.+messages.*\.properties$/.test(rel) ||
    /^keycloak\/themes\/aisha\/.+\.ftl$/.test(rel) ||
    // Theme CSS carries user-facing `content:` wordmarks (e.g. "Powered by AISHA
    // Dirigent"). Safe: rules are multi-word "AISHA <Word>", never the --aisha-*
    // custom properties (lowercase, hyphenated, no space) which stay structural.
    /^keycloak\/themes\/aisha\/.+\.css$/.test(rel) ||
    rel === "keycloak/aisha-realm.json",
  "web-shell": (rel) => rel === "index.html",
  // Run with --root mobile-app. The mobile i18n is FLAT (src/i18n/en.json), not
  // segments/. Store copy is the app-listing markdown. version.json / .env.build
  // are DELIBERATELY excluded: the app identity (name/bundleId/slug) is owned by
  // the version.json brand{} overlay (<instance>.version.json), so this tool must not
  // rewrite it — a product_name rewrite there would fight the overlay's display_name.
  "mobile-i18n": (rel) => /^src\/i18n\/[^/]+\.json$/.test(rel),
  "mobile-store": (rel) => /^store\/.+\.md$/.test(rel),
};

// Web surfaces map the "AISHA Dirigent" edition → product_name; mobile surfaces
// map it → display_name (the app brand, matching the store/home name).
const WEB_CATEGORIES = new Set(["i18n", "keycloak", "web-shell"]);
// Categories whose files are i18n JSON → transformed with the value-only visitor.
const JSON_CATEGORIES = new Set(["i18n", "mobile-i18n"]);

function rulesForCategory(brand, category) {
  const appName = WEB_CATEGORIES.has(category) ? brand.product_name : brand.display_name;
  return buildPhraseMap(brand, { appName });
}

/**
 * Transform one file for a category. i18n JSON is transformed with a value-ONLY
 * visitor (keys untouched); every other file is plain text. Returns {before,
 * after, rel, hits[]} or null when nothing changed / out of scope.
 */
function transformFile(path, category, rules, root) {
  const rel = relative(root, path);
  if (isNeverFile(rel)) return null;
  const filter = SCOPE_FILTERS[category];
  if (filter && !filter(rel)) return null;
  if (!isTextFile(path)) return null;

  const before = readFileSync(path, "utf8");
  const hits = [];
  const onHit = (rule) => hits.push(rule.id);

  let after;
  if (JSON_CATEGORIES.has(category)) {
    // Value-only JSON visitor: object KEYS (t() lookup paths) are never reached.
    let data;
    try { data = JSON.parse(before); } catch { return null; }
    const visit = (node) => {
      if (typeof node === "string") return applyRules(node, rules, onHit);
      if (Array.isArray(node)) return node.map(visit);
      if (node && typeof node === "object") {
        const out = {};
        for (const [k, v] of Object.entries(node)) out[k] = visit(v); // key kept verbatim
        return out;
      }
      return node;
    };
    const branded = visit(data);
    if (hits.length === 0) return null;
    after = JSON.stringify(branded, null, 2) + "\n";
  } else {
    after = applyRules(before, rules, onHit);
    if (before === after) return null;
  }

  return { before, after, rel, hits };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

function collect(categories, brand, root) {
  const rulesByCategory = {};
  for (const cat of categories) rulesByCategory[cat] = rulesForCategory(brand, cat);
  const results = [];
  for (const file of walk(root, root)) {
    for (const cat of categories) {
      const r = transformFile(file, cat, rulesByCategory[cat], root);
      if (r) results.push({ ...r, category: cat, rules: rulesByCategory[cat] });
    }
  }
  return results;
}

function scan(brand, root) {
  const results = collect(CATEGORIES, brand, root);
  const stats = {};
  for (const cat of CATEGORIES) stats[cat] = { files: 0, hits: 0 };
  for (const r of results) { stats[r.category].files++; stats[r.category].hits += r.hits.length; }
  console.log("Rebrand scan (dry-run):\n");
  for (const cat of CATEGORIES) {
    console.log(`  ${cat.padEnd(12)} files=${String(stats[cat].files).padStart(4)}  hits=${stats[cat].hits}`);
  }
}

function report(brand, root) {
  const results = collect(CATEGORIES, brand, root);
  console.log("Rebrand report — every hit (review BEFORE --apply):\n");
  let total = 0;
  for (const r of results) {
    const lines = r.before.split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const rule of r.rules) {
        rule.re.lastIndex = 0;
        if (rule.re.test(lines[i])) {
          console.log(`  ${r.rel}:${i + 1}  [${r.category}/${rule.id}] "${rule.source}" → "${rule.target}"`);
          total++;
        }
      }
    }
  }
  console.log(`\n  ${total} hit(s) across ${results.length} file(s).`);
}

function apply(category, brand, root) {
  const cats = category === "all" ? CATEGORIES : [category];
  for (const c of cats) if (!CATEGORIES.includes(c)) throw new Error(`Unknown category: ${c}`);
  const changed = [];
  for (const r of collect(cats, brand, root)) {
    writeFileSync(join(root, r.rel), r.after, "utf8");
    changed.push(`${r.rel}  (${r.hits.length} hit(s), ${r.category})`);
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = args.root ? resolve(args.root) : DEFAULT_ROOT;

  if (!args.mode) {
    console.error("Usage: rebrand.mjs --brand <brand.json> [--root <dir>] (--scan | --report | --apply <category|all>)");
    process.exit(1);
  }

  const brand = loadBrand(args.brand);
  if (buildPhraseMap(brand).length === 0) {
    console.error("No phrase rules compiled from brand file — nothing to do.");
    process.exit(1);
  }

  console.error(`brand=${brand.display_name} root=${root} (web appname=${brand.product_name}, mobile appname=${brand.display_name})\n`);

  if (args.mode === "scan") return scan(brand, root);
  if (args.mode === "report") return report(brand, root);
  if (args.mode === "apply") {
    if (!args.category) { console.error("--apply needs <category|all>"); process.exit(1); }
    const changed = apply(args.category, brand, root);
    console.log(`Rebrand applied — ${changed.length} file(s):`);
    for (const c of changed) console.log(`  ${c}`);
  }
}

main();
