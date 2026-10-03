#!/usr/bin/env node
/**
 * Guard: no developer / account codes in the repo.
 *
 * Blocks Apple Team IDs, App Store Connect key ids, the personal account email,
 * and real `AuthKey_<id>.p8` filenames from entering git. These must come from
 * the environment (e.g. `${env:APPLE_TEAM_ID}`, `$APPLE_TEAM_ID`) or use a
 * neutral placeholder (`XXXXXXXXXX`) — never a literal in a tracked file.
 *
 * The detection regexes are written so env-driven / placeholder forms do NOT
 * match, so there is no allowlist to maintain beyond the two files that contain
 * these patterns as detection strings (this script + its gate test).
 *
 * Usage:
 *   node scripts/verify-no-dev-codes.mjs            # scan all tracked files (CI / gate)
 *   node scripts/verify-no-dev-codes.mjs --staged   # scan staged files (pre-commit)
 *
 * Exit 0 = clean, 1 = offenders found (printed), 2 = git error.
 * Also exports { RULES, scanText, SELF_ALLOW } for the gate's unit tests.
 *
 * @module
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, statSync } from "node:fs";
import { isDirectRun } from "./lib/cli-entry.mjs";

// The only files that legitimately contain these literals (as detection strings).
export const SELF_ALLOW = new Set([
  "scripts/verify-no-dev-codes.mjs",
  "src/tests/gates/no-developer-account-codes.gate.test.ts",
]);

// Each regex is crafted to NOT match env refs (`${env:…}`, `$VAR`, `process.env`)
// or the `XXXXXXXXXX` placeholder.
export const RULES = [
  {
    // Personal / named account emails. NOT a blanket ban — functional service
    // addresses (admin@, ops@, dev@, pki@, dirigent@, security@, noreply@) and
    // the LEGAL DPO / privacy contact (a role address in the privacy policy) are kept.
    // The platform-admin identity is now env-driven (render-realm-and-start.sh),
    // so the personal accounts that used to be baked in can be enforced-out here.
    name: "personal account email",
    re: /\b(?:info|zdenek|zdenbe)@evymo\.com\b|\bpremma@gmail\.com\b/,
  },
  { name: "Apple Team ID (leaked literal)", re: /\b8N4327J6T3\b/ },
  { name: "App Store Connect key id (leaked literal)", re: /\b5PJ3Y2UVV9\b/ },
  {
    name: "hardcoded Apple Team ID",
    // `KEY = ABCDE12345` but not `KEY = ${env:…}` / `$VAR` (those aren't 10 upper-alnum).
    re: /(DEVELOPMENT_TEAM|APPLE_TEAM_ID|teamID|TEAM_ID)\s*[=:]\s*["']?[A-Z0-9]{10}\b/,
  },
  {
    name: "App Store Connect key filename",
    re: /AuthKey_(?!XXXXXXXXXX)[A-Z0-9]{8,}\.p8/,
  },
  {
    name: "absolute machine home path",
    // A real `/Users/<name>/…` leaks a developer's username + a non-portable path.
    // Use $HOME / ~ / ${workspaceFolder} / a repo-relative path / $(git rev-parse
    // --show-toplevel) instead. Placeholder/demo/CI usernames are allowed so test
    // fixtures + seed data don't trip (Shared, runner, dev, user, demo*, test*, …).
    re: /\/Users\/(?!(?:[Ss]hared|runner|dev|user|users|you|youruser|example|someone|name|demo[a-z0-9]*|test[a-z0-9]*)\b)[A-Za-z0-9._-]+\//,
  },
];

const BINARY =
  /\.(png|jpe?g|gif|webp|ico|svg|pdf|zip|gz|tgz|bz2|woff2?|ttf|otf|eot|mp[34]|wav|webm|p8|p12|pem|key|crt|jks|keystore|lockb?)$/i;

/** Return the rule names that match any line of `text`. */
export function scanText(text) {
  const hits = [];
  text.split("\n").forEach((line, i) => {
    for (const rule of RULES) {
      if (rule.re.test(line)) hits.push({ line: i + 1, rule: rule.name, text: line.trim() });
    }
  });
  return hits;
}

function listFiles(staged) {
  const args = staged
    ? ["diff", "--cached", "--name-only", "--diff-filter=ACM"]
    : ["ls-files"];
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\n")
    .filter(Boolean);
}

/**
 * Git mode každé sledované položky: `<mode> <sha> <stage>\t<path>`.
 *   160000 = gitlink (submodul) — obsah žije v JINÉM repu
 *   120000 = symlink — čtení symlinku na adresář dá EISDIR; jeho CÍL je
 *            sledovaný a skenuje se na vlastním řádku
 *
 * Bez tohohle rozlišení oba případy spadly do jednoho koše „unreadable",
 * vypsaly se jako varování — a verdikt přesto zněl ✓. Přeskočení vypadalo
 * jako měření.
 */
function trackedModes() {
  const modes = new Map();
  const out = execFileSync("git", ["ls-files", "-s"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  for (const line of out.split("\n")) {
    if (!line) continue;
    const m = /^(\d{6})\s+\S+\s+\d+\t(.*)$/.exec(line);
    if (m) modes.set(m[2], m[1]);
  }
  return modes;
}

/**
 * 32 MB: baseline.sql má ~6 MB a je to schema dump — tedy PRÁVĚ ten soubor,
 * do kterého se data nejsnáz protečou. Starý strop 2 MB ho tiše vynechával.
 * Binární přípony odfiltruje BINARY výš, takže tenhle strop se týká textu.
 */
const MAX_TEXT_BYTES = 32_000_000;

/**
 * Scan tracked (or staged) files.
 *
 * Vrací i POKRYTÍ, ne jen nálezy: „čisto" bez informace o tom, co se
 * neprohlédlo, odpovídá na jinou otázku, než jakou čtenář položil.
 */
export function scanRepoDetailed({ staged = false } = {}) {
  const offenders = [];
  const modes = trackedModes();
  const coverage = { scanned: 0, submodules: [], symlinks: [], oversize: [], unreadable: [] };

  for (const file of listFiles(staged)) {
    if (SELF_ALLOW.has(file) || BINARY.test(file)) continue;
    const mode = modes.get(file);
    if (mode === "160000") { coverage.submodules.push(file); continue; }
    if (!existsSync(file)) continue;
    let text;
    try {
      if (statSync(file).size > MAX_TEXT_BYTES) { coverage.oversize.push(file); continue; }
      text = readFileSync(file, "utf8");
    } catch (err) {
      if (mode === "120000") { coverage.symlinks.push(file); continue; }
      coverage.unreadable.push(`${file}: ${err?.message ?? err}`);
      continue;
    }
    coverage.scanned += 1;
    for (const hit of scanText(text)) {
      offenders.push(`  ${file}:${hit.line}  [${hit.rule}]  ${hit.text.slice(0, 100)}`);
    }
  }
  return { offenders, coverage };
}

/** Zpětně kompatibilní obal — brána i hook čtou jen nálezy. */
export function scanRepo(opts = {}) {
  return scanRepoDetailed(opts).offenders;
}

// ── CLI (only when run directly, not when imported by the gate) ──────────────
// „Spustili mě přímo?" má jeden domov: lib/cli-entry.mjs. Porovnává SKUTEČNÉ
// cesty (realpath), ne řetězce — jinak stačí symlink nebo git worktree, blok se
// TIŠE přeskočí a volající dostane prázdný výstup s kódem 0, který si vyloží
// jako měření.
if (isDirectRun(import.meta.url)) {
  const staged = process.argv.includes("--staged");
  let offenders, coverage;
  try {
    ({ offenders, coverage } = scanRepoDetailed({ staged }));
  } catch (err) {
    console.error(`verify-no-dev-codes: git failed: ${err.message}`);
    process.exit(2);
  }

  // Co se přeskočit NEMĚLO, je chyba — ne poznámka pod zeleným verdiktem.
  if (coverage.unreadable.length > 0) {
    console.error(
      `\n❌ verify-no-dev-codes: ${coverage.unreadable.length} sledovaný(ch) souborů NEŠLO přečíst.\n` +
        `   Nepřečtený soubor NENÍ „čistý" — verdikt by tvrdil něco, co se neměřilo:\n` +
        coverage.unreadable.map((u) => `     ${u}`).join("\n") + "\n",
    );
    process.exit(2);
  }
  if (offenders.length > 0) {
    console.error(
      `\n❌ Developer / account codes found in ${staged ? "staged" : "tracked"} files:\n` +
        offenders.join("\n") +
        `\n\n  These must NOT be committed. Pull them from the environment instead\n` +
        `  (e.g. \${env:APPLE_TEAM_ID} / $APPLE_TEAM_ID), use the XXXXXXXXXX placeholder,\n` +
        `  or remove them. Apple .p8 keys + .env* stay gitignored.\n`,
    );
    process.exit(1);
  }
  console.log(
    `✓ no developer/account codes in ${staged ? "staged" : "tracked"} files ` +
      `— prohlédnuto ${coverage.scanned}; přeskočeno ${coverage.submodules.length} submodul(ů) ` +
      `(obsah v jejich vlastních repech), ${coverage.symlinks.length} symlink(ů) ` +
      `(cíle skenovány zvlášť), ${coverage.oversize.length} nad ${MAX_TEXT_BYTES / 1e6} MB`,
  );
}
