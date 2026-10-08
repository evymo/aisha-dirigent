#!/usr/bin/env node
/**
 * Guard: no developer / account codes in the repo.
 *
 * Blocks Apple Team IDs, App Store Connect key ids, personal account emails,
 * and real `AuthKey_<id>.p8` filenames from entering git. These must come from
 * the environment (e.g. `${env:APPLE_TEAM_ID}`, `$APPLE_TEAM_ID`) or use a
 * neutral placeholder (`XXXXXXXXXX`) — never a literal in a tracked file.
 *
 * The detection regexes are written so env-driven / placeholder forms do NOT
 * match. The rules are STRUCTURAL — this file names no real identifier; exact
 * values live outside the tree (see RULES below and config/dev-codes.json.example).
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

// The guard and its gate test describe the SHAPES (with fictional values), so the structural rules do
// not apply to them. The EXACT layer does: until 2026-10-03 a blanket skip of these two files was the
// very place where the real values lived — the guard never read itself.
export const SELF_ALLOW = new Set([
  "scripts/verify-no-dev-codes.mjs",
  "src/tests/gates/no-developer-account-codes.gate.test.ts",
]);

// Each regex is crafted to NOT match env refs (`${env:…}`, `$VAR`, `process.env`)
// or the `XXXXXXXXXX` placeholder.
//
// ⛔ ŽÁDNÁ SKUTEČNÁ HODNOTA V TOMHLE SOUBORU (2026-10-03). Do té doby tu jako detekční
// řetězce stály přesně ty hodnoty, které má stráž držet mimo git: Apple Team ID, id klíče
// App Store Connect a osobní adresy — a soubor šel do veřejného snímku. Seznam zakázaných
// hodnot ve veřejném repu je sám únikem (táž třída, jakou `tenant-leak-detect` řeší
// u jmen nájemců). Proto dvě vrstvy:
//   1. STRUKTURÁLNÍ (vždy, veřejně bezpečná): pravidla níž poznají TVAR — nejmenují nikoho.
//   2. PŘESNÁ (volitelná, soukromá): doslovné hodnoty z `AISHA_DEV_CODE_SENTINELS`
//      (oddělené čárkou) nebo z gitignorovaného `config/dev-codes.json` — viz
//      `config/dev-codes.json.example`. Ve veřejném repu a ve forcích chybí; že chybí,
//      stráž řekne ve výpisu (žádné tiché přeskočení).

/** Adresy rolí na doméně dodavatele — funkce, ne člověk. Cokoli jiného na té doméně je osobní účet. */
const ROLE_ALIASES = ["admin", "ops", "dev", "pki", "dirigent", "security", "noreply", "legal"];

export const RULES = [
  {
    // Personal / named account emails. NOT a blanket ban — functional service
    // addresses (admin@, ops@, dev@, pki@, dirigent@, security@, noreply@, legal@) and
    // the LEGAL DPO / privacy contact (a role address in the privacy policy) are kept.
    // Structural: any local part at the vendor domain that is not a role alias —
    // the rule names the roles, never the people.
    name: "personal account email",
    re: new RegExp(`\\b(?!(?:${ROLE_ALIASES.join("|")})@)[A-Za-z0-9._-]+@evymo\\.com\\b`),
  },
  {
    // A personal mailbox at a free-mail provider — also when written inside a regex
    // (escaped dot), which is how the previous version of this very file carried one.
    name: "personal free-mail address",
    re: /\b[A-Za-z0-9._%+-]+@(?:gmail|googlemail|seznam|centrum|yahoo|hotmail|outlook|icloud|protonmail)\\?\.(?:com|cz|net)\b/,
  },
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

/**
 * PŘESNÁ vrstva: doslovné hodnoty, které drží provozovatel MIMO strom. Vrací pole řetězců
 * (prázdné, když vrstva není nastavená). Krátké hodnoty se odmítnou — sentinel o třech
 * znacích by hlásil půl repa a někdo by ho „pro klid" smazal.
 */
export function loadSentinels(env = process.env, root = process.cwd()) {
  const out = [];
  for (const v of String(env.AISHA_DEV_CODE_SENTINELS ?? "").split(/[,\n]/)) if (v.trim()) out.push(v.trim());
  const soubor = `${root}/config/dev-codes.json`;
  if (existsSync(soubor)) {
    const data = JSON.parse(readFileSync(soubor, "utf8"));
    for (const v of data.sentinels ?? []) if (typeof v === "string" && v.trim()) out.push(v.trim());
  }
  const kratke = out.filter((v) => v.length < 8);
  if (kratke.length) throw new Error(`dev-code sentinel kratší než 8 znaků (${kratke.length}×) — příliš obecný, hlásil by všude`);
  return [...new Set(out)];
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Sentinely → pravidla. Hodnota se hledá jako celé slovo; jméno pravidla ji NEVYPISUJE. */
export function sentinelRules(sentinels) {
  return sentinels.map((v, i) => ({ name: `private dev-code sentinel #${i + 1}`, re: new RegExp(`(?<![A-Za-z0-9])${escapeRe(v)}(?![A-Za-z0-9])`) }));
}

const BINARY =
  /\.(png|jpe?g|gif|webp|ico|svg|pdf|zip|gz|tgz|bz2|woff2?|ttf|otf|eot|mp[34]|wav|webm|p8|p12|pem|key|crt|jks|keystore|lockb?)$/i;

let nacteneSentinely = null;
/** Pravidla pro tenhle běh: strukturální (pokud platí) + přesná vrstva (načtená jednou). */
function pravidla(sentinels, structural) {
  if (!sentinels && nacteneSentinely === null) nacteneSentinely = loadSentinels();
  return [...(structural ? RULES : []), ...sentinelRules(sentinels ?? nacteneSentinely)];
}

/**
 * Return the rule names that match any line of `text`. `sentinels` overrides the private layer (tests);
 * `structural: false` applies the exact layer alone.
 */
export function scanText(text, { sentinels, structural = true } = {}) {
  const hits = [];
  const rules = pravidla(sentinels, structural);
  text.split("\n").forEach((line, i) => {
    for (const rule of rules) {
      if (rule.re.test(line)) hits.push({ line: i + 1, rule: rule.name, text: line.trim() });
    }
  });
  return hits;
}

/** Scan one tracked file: every file gets the exact layer; SELF_ALLOW is exempt from the shapes only. */
export function scanFile(file, text, opts = {}) {
  return scanText(text, { ...opts, structural: !SELF_ALLOW.has(file) });
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
  if (nacteneSentinely === null) nacteneSentinely = loadSentinels();
  const modes = trackedModes();
  const coverage = { scanned: 0, submodules: [], symlinks: [], oversize: [], unreadable: [], sentinels: nacteneSentinely.length };

  for (const file of listFiles(staged)) {
    if (BINARY.test(file)) continue;
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
    for (const hit of scanFile(file, text)) {
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
      `(cíle skenovány zvlášť), ${coverage.oversize.length} nad ${MAX_TEXT_BYTES / 1e6} MB; ` +
      (coverage.sentinels
        ? `přesná vrstva: ${coverage.sentinels} soukromých sentinelů`
        : `přesná vrstva NENASTAVENA — měřila jen strukturální pravidla (config/dev-codes.json.example)`),
  );
}
