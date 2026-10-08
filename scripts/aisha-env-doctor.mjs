#!/usr/bin/env node
/**
 * aisha-env-doctor.mjs — Idempotent env contract enforcer for .env.coolify
 *
 * Goal: ensure every env key required by docker-compose.coolify*.yml is present
 *       and non-empty in .env.coolify. Existing values are PRESERVED (no
 *       rotation of JWT_SECRET, ANON_KEY, etc.). Missing keys get auto-filled
 *       from the contract:
 *         - secret(N)    → openssl-equivalent random base64url (N bytes)
 *         - hex(N)       → random hex (N bytes)
 *         - static       → fixed default value
 *         - alias        → copy from another already-resolved key
 *         - external     → left empty + WARN (must come from .env-prod-backup
 *                          or be filled manually; e.g. OPENAI_API_KEY)
 *         - placeholder  → empty string with INFO note (filled by separate
 *                          tool, e.g. NETBIRD_STACK_KEY_* via
 *                          netbird-bootstrap.sh)
 *
 * Usage:
 *   node scripts/aisha-env-doctor.mjs              # apply changes
 *   node scripts/aisha-env-doctor.mjs --dry-run    # show what would change
 *   node scripts/aisha-env-doctor.mjs --report     # only report missing
 *   node scripts/aisha-env-doctor.mjs --strict     # fail if external keys missing
 *
 * Exit codes:
 *   0 — OK (all required keys present after run)
 *   1 — required keys still missing (only in --strict or --report mode)
 *   2 — IO error, nebo topologii nejde odvodit (důvod na 1. řádku stderr)
 *
 * This script is the SINGLE SOURCE OF TRUTH for the .env.coolify contract.
 * If you add a new ${VAR} reference to docker-compose.coolify*.yml, add it
 * to CONTRACT below or it will be reported as missing.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { nahradObsahAtomicky } from "./lib/zapis-env-atomicky.mjs";
import { resolve, dirname, join } from "node:path";
import { deklarovanyOverlayRepo, overlayDirOrRequired, OVERLAY_ENV } from "./lib/instance-overlay.mjs";
import { verejniKlientiRealmu } from "./lib/povoleni-klienti.mjs";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { buildTopology, formatShellExports, RESOLVER_ENV_INPUTS } from "./lib/derive-domains.mjs";
import { rozbalDomainsEnv, bezUrlBezHostu, nesmiDoTrezoru } from "./lib/domeny-rozbal.mjs";
import { assertCookieSecret, assertJwtShape } from "./lib/local-env-assertions.mjs";
import { kliceCookieSecretu } from "./lib/cookie-secrety.mjs";
import { odUvozovkuj, potrebujeUvozovky, srovnejUvozovani } from "./lib/env-hodnota.mjs";
import { hlaskyPovinnychKlicu, jeHlaskaMistoHodnoty } from "./lib/hlasky-z-compose.mjs";
import { resolveProjectName } from "./lib/coolify-project-scope.mjs";
import { execFileSync } from "node:child_process";
import { readConfigKey } from "./lib/config-env-files.mjs";
import { NETBIRD_PEER_CIDR, gatewayTrustedProxies, srovnaniTrustedProxies } from "./lib/derive-subnets.mjs";
import { pkiBundleRequiredForInstance } from "./lib/derive-pki-bundle-required.mjs";
import { domovRegistryProxy, rozlisRegistryProxy } from "./lib/registry-proxy.mjs";
import { posudVapidPar } from "./lib/vapid-par.mjs";
import { pbEnvSoubor, pbJeProd, pbZdrojDoplneni } from "./lib/prostredi-behu.mjs";
import { jeLaneZapnuta, podminkaSplnena } from "./lib/provision-gate.mjs";
import { posudAccel } from "./lib/accel-deklarace.mjs";
import { hodnotaVrstvyNeboPrazdno, kliceVrstvy } from "./lib/derive-accel-uzel.mjs";
import { isDirectRun } from "./lib/cli-entry.mjs";
import { KOD_ENV_DOKTORA_WEB_NEVIM, deklaraceWebFqdns } from "./lib/domenovy-overlay.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// Důvod pádu patří na PRVNÍ řádek stderr. Volající (aisha-redeploy
// `srovnejOdvozeneKlice`, cold-start) z výstupu ukazují jen začátek — a výchozí
// výpis nezachycené výjimky tam má `file:///…:115`, `throw new Error(` a `^`.
// Naměřeno 2026-09-13: redeploy by tak zastavil nasazení bez jediného slova
// o tom, že chybí cesta k instančnímu overlayi. Stack jde až pod důvod.
process.on("uncaughtException", (e) => {
  console.error(`[env-doctor] ✗ ${e?.message ?? e}\n${e?.stack ?? ""}`);
  process.exit(2);
});
// ENV_FILE musí platit i pro ZÁPIS, nejen pro čtení.
//
// Dokud byla cesta napevno, `ENV_FILE=/tmp/zkouska node aisha-env-doctor.mjs --heal`
// tiše psal do produkčního .env.coolify a zkušební soubor nechal netknutý —
// takže sonda ukazovala „oprava nezabrala", zatímco ve skutečnosti zabrala
// jinde. Nedá se tím nic nasucho ověřit a omyl míří na produkci.
//
// ⛔ IZOLACE PROSTŘEDÍ (PR2, incident 2026-09-24): cíl i zdroj doplnění určuje
// jeden domov (scripts/lib/prostredi-behu.mjs). Ne-produkční běh (AISHA_ENV)
// píše do `.env.<env>` a doplňuje JEN ze zálohy svého prostředí
// (ENV_PROD_BACKUP — obal ji nastaví na zálohu prostředí). Produkční zálohu ani
// produkční env soubor nepřijme: dřív heal ve stagingu tiše dotáhl produkční
// externí klíče. Kontrola padá až v main() — `--print-contract-keys` soubory nečte.
const AISHA_ENV_BEHU = process.env.AISHA_ENV || "";
const ENV_PATH = process.env.ENV_FILE
  ? resolve(process.env.ENV_FILE)
  : pbEnvSoubor(ROOT, AISHA_ENV_BEHU) ?? resolve(ROOT, ".env.coolify");
const EXTERNAL_SOURCE =
  pbZdrojDoplneni(ROOT, AISHA_ENV_BEHU, process.env.ENV_PROD_BACKUP || "") ?? resolve(ROOT, ".env-prod-backup");
const IZOLACE_CHYBA = (() => {
  if (pbJeProd(AISHA_ENV_BEHU)) return null;
  if (pbEnvSoubor(ROOT, AISHA_ENV_BEHU) === null) return `AISHA_ENV=${AISHA_ENV_BEHU} není známý tvar prostředí.`;
  if (ENV_PATH === resolve(ROOT, ".env.coolify"))
    return `ne-produkční běh AISHA_ENV=${AISHA_ENV_BEHU} míří na PRODUKČNÍ env soubor ${ENV_PATH}.`;
  if (pbZdrojDoplneni(ROOT, AISHA_ENV_BEHU, process.env.ENV_PROD_BACKUP || "") === null)
    return (
      `ne-produkční běh AISHA_ENV=${AISHA_ENV_BEHU} nemá zálohu SVÉHO prostředí ` +
      `(ENV_PROD_BACKUP=${JSON.stringify(process.env.ENV_PROD_BACKUP || "")}) — z produkční zálohy se nedoplňuje. ` +
      `Spusť přes scripts/aisha-cold-start-env.sh, nebo nastav ENV_PROD_BACKUP na zálohu prostředí.`
    );
  return null;
})();

// ── CLI ──────────────────────────────────────────────────────────────────────
const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const REPORT_ONLY = args.has("--report");
const STRICT = args.has("--strict");
const NO_EXTERNAL = args.has("--no-external");
// --omni-mode: also validate the Omni gateway (svc-ai-chat /v1) env. Gated so the
// static prod 11-app contract is unchanged for operators not running the omni surface.
const OMNI_MODE = args.has("--omni-mode") || process.env.AISHA_PROFILE === "omni";

// ── Neznámý přepínač je STOP, ne apply ───────────────────────────────────────
//
// ⛔ NAMĚŘENO 2026-09-03 NA SOBĚ, PŘI MĚŘENÍ TOHOTO NÁSTROJE.
// Volání `node aisha-env-doctor.mjs $M`, kde `$M` drží "--report --strict",
// předá pod **zsh** JEDEN argument — zsh neuvozovkovanou expanzi na slova
// NEDĚLÍ, na rozdíl od bashe. Doktor nerozpoznal žádný přepínač a spustil se
// v APPLY: zapsal do SoT v běhu, který měl být čistě měřicí. Hlásil přitom
// `Mode: apply`, takže nelhal — jen se nikdo neptal.
//
// Nejistota o tom, co po mně volající chce, se NESMÍ rozhodnout tím nejvíc
// destruktivním výkladem. Táž třída už jednou zapsala 36 klíčů a odvozeninou
// z prázdného prostředí smazala alias `corp`; tehdy chyběl `--help`, takže
// `--help` samo bylo tím neznámým přepínačem, který spustil zápis.
//
// Univerzum se NEPÍŠE RUKOU: brána `env-doktor-zna-sve-prepinace` porovnává
// tenhle seznam s výskyty `args.has("--…")` ve zdrojáku, takže nový přepínač
// bez zápisu sem zčervená.
const ZNAME_PREPINACE = new Set([
  "--dry-run",
  "--report",
  "--strict",
  "--no-external",
  "--omni-mode",
  "--print-contract-keys",
  "--help",
  "-h",
]);
// Stráž visí na entry-pointu: `process.exit` v modulovém rozsahu by zabil
// IMPORT, a testovací běžec předává vlastní argv (`--run`, cesty k souborům),
// který by tuhle kontrolu spustil při pouhém načtení.
const JSEM_SPOUSTENY = isDirectRun(import.meta.url); // cli-entry.mjs — přes symlink se stráž dřív tiše přeskočila
if (JSEM_SPOUSTENY) {
  const nezname = process.argv.slice(2).filter((a) => !ZNAME_PREPINACE.has(a));
  if (nezname.length > 0) {
    console.error(`aisha-env-doctor: neznámý přepínač: ${nezname.map((a) => JSON.stringify(a)).join(", ")}`);
    console.error(`  známé: ${[...ZNAME_PREPINACE].join(" ")}`);
    console.error(`  ⛔ NEPOKRAČUJU — bez jasného režimu bych ZAPISOVAL do ${ENV_PATH}.`);
    console.error(`  Pozor na zsh: \`node ... $VAR\` předá vše jako JEDEN argument; piš přepínače přímo.`);
    process.exit(2);
  }
  if (args.has("--help") || args.has("-h")) {
    console.log("aisha-env-doctor — env contract enforcement");
    console.log(`  bez přepínače  APPLY: zapíše chybějící a srovná odvozené klíče v ${ENV_PATH}`);
    console.log("  --dry-run      ukáže, co by apply udělal; NEZAPISUJE");
    console.log("  --report       jen hlášení; NEZAPISUJE");
    console.log("  --strict       s --report/--dry-run: končí 1 při chybějícím nebo NESROVNANÉM klíči");
    console.log("  --no-external  nečte .env-prod-backup");
    console.log("  --omni-mode    validuje i Omni bránu");
    console.log("  --print-contract-keys  vypíše KLÍČ\\tdruh a patičku __CONTRACT_END__");
    process.exit(0);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const C = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  blue: (s) => `\x1b[34m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};
const log = (...a) => console.log(...a);
const info = (s) => log(`  ${C.blue("ℹ")} ${s}`);
const ok = (s) => log(`  ${C.green("✓")} ${s}`);
const warn = (s) => log(`  ${C.yellow("⚠")} ${s}`);
const err = (s) => log(`  ${C.red("✗")} ${s}`);

function genSecret(bytes = 32) {
  // base64url, no padding — equivalent to: openssl rand -base64 N | tr -d '=' | tr '/+' '_-'
  return randomBytes(bytes).toString("base64").replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-");
}
function genHex(bytes = 32) {
  return randomBytes(bytes).toString("hex");
}

// Canonical chain, not process.env alone: the operator's real Forgejo URL lives
// in .env.coolify, and reading only the shell meant the heal pass wrote an EMPTY
// value OVER the good one — after which deploy-init fell through to deriving
// repo.<internal_tld>, a host that does not exist.
// Order: shell -> canonical chain -> the git remote we actually push to.
// The remote is the most honest source: it is the host this checkout provably
// talks to. Needed as a real fallback, not decoration — a heal pass can rewrite
// .env.coolify with an EMPTY FORGEJO_URL, and once that happens the chain has
// nothing left to offer while the correct host is sitting in `git remote`.
// Remotes to interrogate, discovered rather than named. An earlier version hard-coded
// one adoption's remote name ahead of `origin`, which only works in that fork's
// checkout — every other install fell through to the empty string. `origin` first
// (the conventional upstream), then whatever else this checkout has.
const GIT_REMOTES = (() => {
  try {
    return execFileSync("git", ["remote"], {
      cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    })
      .split(/\r?\n/)
      .map((r) => r.trim())
      .filter(Boolean)
      .sort((a, b) => Number(b === "origin") - Number(a === "origin"));
  } catch (err) {
    console.warn(`[env-doctor] cannot list git remotes: ${err?.message ?? err}`);
    return [];
  }
})();

const remoteUrl = (remote) => {
  try {
    return execFileSync("git", ["remote", "get-url", remote], {
      cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (err) {
    // Not fatal: the next remote may answer, and both callers fall back to "".
    // Logged rather than swallowed so a misconfigured checkout is visible.
    console.warn(`[env-doctor] git remote get-url ${remote} failed: ${err?.message ?? err}`);
    return "";
  }
};

const FORGEJO_URL_DEFAULT = (() => {
  const direct = process.env.FORGEJO_URL || readConfigKey("FORGEJO_URL");
  if (direct) return direct;
  for (const remote of GIT_REMOTES) {
    const m = remoteUrl(remote).match(/^(https?:\/\/[^/]+)/);
    if (m) return m[1];
  }
  return "";
})();
// <owner>/<repo> of the remote this checkout actually pushes to.
const FORGEJO_REPO_DEFAULT = (() => {
  if (process.env.FORGEJO_REPO) return process.env.FORGEJO_REPO;
  const fromFile = readConfigKey("FORGEJO_REPO");
  if (fromFile) return fromFile;
  for (const remote of GIT_REMOTES) {
    const m = remoteUrl(remote).match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
    if (m) return m[1];
  }
  return "";
})();
const COOLIFY_URL_VALUE = process.env.COOLIFY_URL || "";

let externalEnvCache = null;
function cleanEnvValue(value) {
  // Hodnota jako po `source` — odříznuté uvozovky by nechaly escapy (AISHA_OPERATORS).
  return odUvozovkuj(String(value ?? "").trim());
}

function prodEnvMap() {
  if (NO_EXTERNAL || !existsSync(EXTERNAL_SOURCE)) return new Map();
  if (!externalEnvCache) externalEnvCache = parseEnvFile(EXTERNAL_SOURCE).values;
  return externalEnvCache;
}

function prodEnv(key) {
  return cleanEnvValue(prodEnvMap().get(key) || "");
}

function hydrateProcessEnvFromProdBackup() {
  for (const [key, value] of prodEnvMap()) {
    if (!process.env[key] && value !== "") process.env[key] = cleanEnvValue(value);
  }
}

// Výslovný požadavek na doménový overlay smí přijít JEN od cold-startu (export
// před spuštěním doktora) — ne z trezoru, kterým se prostředí hned níž doplní:
// hodnota uložená v trezoru by jinak z dopočteného požadavku udělala „výslovný"
// a ten smí seznam značek zúžit (revize 27d6f3f5e). Zachytí se proto PŘED hydratací.
const VYSLOVNY_POZADAVEK_OVERLAYE = process.env.DOMAINS_OVERLAY_REQUESTED;

hydrateProcessEnvFromProdBackup();

// ── Domain contract loader (config/domains.env is the single source of truth)
//
// ⛔ NAMĚŘENO 2026-09-24 (<fork>): doktor puštěný SAMOSTATNĚ zapsal do
// trezoru doslovné `https://${API_DOMAIN_PUBLIC:-}/storage/v1` a
// `https://${APP_DOMAIN:-}`. domains.env nese sebeodkazy `X=${X:-}`; starý
// rozbalovač bez cold-startu vrátil syrovou šablonu téhož klíče. A běžel PŘED
// loadTopologyEnv(), takže derivaci, kterou cold-start sourcuje jako první,
// vůbec neviděl. Rozbaluje se proto AŽ PO derivaci, stejně jako
// `set -a; . domains.env` v cold-startu — pravidla viz lib/domeny-rozbal.mjs.
// Hledání odkazu: prodEnv → process.env → derivace → cílový trezor.
function loadDomains(derivace = {}, cilovyTrezor = new Map()) {
  const file = resolve(ROOT, "config/domains.env");
  if (!existsSync(file)) {
    return { hodnoty: {}, sablony: {}, nerozbalene: new Map(), volitelnePrazdne: new Set(), odkazyDopredu: [] };
  }
  const zTrezoru = (n) => {
    const v = cleanEnvValue(cilovyTrezor.get(n) || "");
    return v.includes("${") ? "" : v; // doslovný odkaz v trezoru není hodnota
  };
  return rozbalDomainsEnv(
    readFileSync(file, "utf8"),
    (n) => prodEnv(n) || process.env[n] || cleanEnvValue(derivace[n] ?? "") || zTrezoru(n),
  );
}

// Identita instance. Kanonický pravopis je APP_NAME_PREFIX, `AISHA_STORY` je ten
// starší — deklarované je to na JEDNOM místě (lib/coolify-project-scope.mjs:47),
// a proto se sem pořadí NEOPISUJE: rozhodne o něm resolveProjectName(). Tenhle
// nástroj má vlastní vrstvení hodnot (.env-prod-backup → process.env), takže
// helperu podává hodnoty přes identitaZ(), ne holé process.env.
//
// ⛔ Identita NIKDY z derivace ani z domains.env (ten ji nedeklaruje): bez
// identity vydá derive-domains referenční `APP_NAME_PREFIX=aisha`
// z `<profil>.json.example` (naměřeno 2026-09-28) — cizí jméno. Proto se počítá
// TADY, před topologií a před dom(), který na ní závisí.
//
// Rozejít se ta dvě jména smí: `APP_NAME_PREFIX || AISHA_STORY` má 9 z 10 míst
// v repu včetně generate-secrets.mjs:560, které je fail-closed.
const identitaZ = (key) => prodEnv(key) || process.env[key] || "";
const IDENTITY = resolveProjectName({
  APP_NAME_PREFIX: identitaZ("APP_NAME_PREFIX"),
  AISHA_STORY: identitaZ("AISHA_STORY"),
});

// TLDs that derive-domains reads from `process.env` DIRECTLY (derive-domains.mjs:282,
// "operator env overrides win over profile JSON"). This tool already loads
// .env-prod-backup as the operator's source of truth for `external` keys — but it never
// EXPORTED it, so the override could not see it and buildTopology fell back to the
// cloud-multi.json.example reference profile.
//
// The failure is silent-by-construction: the fallback WARNs and continues, so a
// regeneration run by anyone whose shell had not sourced .env-prod-backup rewrote ~55
// production domain keys to *.aisha.example.com and reported success. Measured on a
// live deployment: 07-26 the real `cache.<node>.<internal-tld>` → 07-28
// cache.aisha.example.com, after which every image build failed with an x509 error
// against a host that does not exist.
//
// Reading the operator file is not enough; the override reads process.env, so put it there.
const TOPOLOGY_ENV_KEYS = [
  // AISHA_PROFILE decides WHICH profile buildTopology loads, and the profile
  // carries server_bindings — so it decides every co-location branch in
  // derive-domains (PKI_BRIDGE_URL, AUTH_UPSTREAM_*, KEYCLOAK_INTERNAL_URL).
  // ⛔ Tady stálo, že bez něj `buildTopology({})` spadne na "cloud-multi" —
  // jenže resolver dosazoval "cloud-single". KOMENTÁŘ se s kódem rozešel, což
  // je typický doprovod vymyšlené hodnoty: nikdo ji nečte, tak si ji každý
  // pamatuje jinak. Od 2026-08-22 nedosazuje ani jeden: bez deklarovaného
  // AISHA_PROFILE `buildTopology` VYHODÍ, protože jinak by se každý z těch
  // klíčů odvodil pro cizí tvar fleety a nic by přitom nespadlo.
  //
  // Measured 2026-07-28: env-doctor derived
  //   PKI_BRIDGE_URL=https://pki-bridge.backend.internal.example.com
  //   AUTH_UPSTREAM_PUBLIC=https://auth.backend.internal.example.com
  // for a one-node deployment whose own profile emits
  //   http://pki-bridge:3040 / http://aisha-keycloak:80.
  // Consequence: pki-init exit 1 (nothing listens on :443 internally) → no CA
  // bundle → mesh down four days; and edge 502 on the public auth face →
  // netbird-management crash-loop on OIDC discovery.
  //
  // Same class as the TLD entries below — the fallback WARNs about TLDs but is
  // SILENT about the profile, which is the variable the branches actually hinge on.
  // AISHA_INSTANCE_CONFIG_DIR je druhá půlka téhož: profil instance žije
  // v privátním overlay (config/profiles/ veze jen ŠABLONY), a bez téhle
  // cesty se pojmenovaný profil NENAJDE — takže i správně nastavený
  // AISHA_PROFILE skončí zpátky u cloud-multi. Obě proměnné, nebo ani jedna.
  "AISHA_PROFILE", "AISHA_INSTANCE_CONFIG_DIR",
  "PUBLIC_TLD", "INTERNAL_TLD", "MESH_TLD",
  "OAUTH2_COOKIE_DOMAINS", "OAUTH2_COOKIE_DOMAINS_FRONTEND", "OAUTH2_WHITELIST_DOMAINS",
  // Příznaky `provision_when_env` — ODVOZENÉ Z KATALOGU, ne dopsané sem.
  //
  // Rozhodují, jestli služba v topologii vůbec JE, takže rozhodují i o tom,
  // které domény derivace vydá. Bez nich derivace uvnitř doktora vidí jinou
  // topologii než ta venku: EXTRANET_ENABLED=true leželo v .env.coolify,
  // derivace pouštěná ručně vydala EXTRANET_DOMAIN, ale doktor ho nedoručil —
  // a compose preflight padal na `required variable EXTRANET_DOMAIN`, čímž
  // blokoval CELÝ cold-start (2026-07-30).
  //
  // Vypsat je ručně by znamenalo přidat další seznam, který se s katalogem
  // rozejde — táž třída, kterou tenhle soubor jinde odmítá. Čtou se proto
  // odtud, kde jsou deklarované.
  ...provisionFlagKeys(),
  // Vstupy, které resolver čte NEPŘÍMO (z katalogu přes `substitute()`).
  //
  // ⛔ NAMĚŘENO 2026-08-21: `AISHA_WEB_PUBLIC_ALIASES` sem nepatřil, takže
  // doktor spuštěný v holém shellu spočítal `WEB_ALIAS_ORIGINS` bez aliasu
  // `corp` a tou hodnotou PŘEPSAL SoT. Odvozenina počítaná z prázdna vypadá
  // jako oprava driftu — je to ztráta veřejného jména.
  //
  // Seznam má jediný domov (RESOLVER_ENV_INPUTS v derive-domains); druhá kopie
  // by se rozešla přesně tak, jak se rozešly kopie téhož seznamu v bránách
  // (8 ze 14 položek, viz resolver-env-inputs-complete.gate).
  ...RESOLVER_ENV_INPUTS,
];

/** Jména příznaků z `provision_when_env` v katalogu (string i pole). */
function provisionFlagKeys() {
  try {
    const { services } = JSON.parse(readFileSync(resolve(ROOT, "config/services.json"), "utf8"));
    const flags = new Set();
    for (const svc of Object.values(services ?? {})) {
      const when = svc.provision_when_env;
      if (!when) continue;
      for (const key of Array.isArray(when) ? when : [when]) if (key) flags.add(key);
    }
    return [...flags].sort();
  } catch (e) {
    // Hlasitě: prázdný seznam by vypadal jako „žádné příznaky nejsou",
    // a doktor by zase tiše doručoval jinou topologii.
    console.error(`[env-doctor] provision_when_env se nepodařilo přečíst z katalogu: ${e.message}`);
    return [];
  }
}

function exportTopologyOverrides() {
  // Druhý zdroj: CÍLOVÝ env soubor. Opt-in příznaky (`provision_when_env`) i
  // profil zapisuje operátor právě sem, ne do zálohy secrets — EXTRANET_ENABLED
  // leželo v .env.coolify, doktor četl jen .env-prod-backup, a derivace uvnitř
  // něj proto viděla instanci BEZ extranetu. Vydal tedy jinou topologii než
  // tatáž derivace spuštěná ručně.
  //
  // Čtou se jen VSTUPY (profil, TLD, příznaky), nikdy odvozené hodnoty — ty se
  // z cílového souboru brát nesmí, jinak by drift sám sebe potvrzoval. Proto
  // TOPOLOGY_ENV_KEYS, ne celý soubor.
  const targetEnv = existsSync(ENV_PATH) ? parseEnvFile(ENV_PATH).values : new Map();
  for (const key of TOPOLOGY_ENV_KEYS) {
    if (process.env[key]) continue;               // an explicit shell value still wins
    const value = prodEnv(key) || cleanEnvValue(targetEnv.get(key) || "");
    if (value) process.env[key] = value;
  }
}

// Které domény vzala derivace z REFERENČNÍHO `<profil>.json.example`, ne od
// instance (topo.referencni_domeny). Plní loadTopologyEnv(), čte DERIVACE_INSTANCE.
let REFERENCNI_DOMENY = [];

function loadTopologyEnv() {
  exportTopologyOverrides();
  const topo = buildTopology({});
  REFERENCNI_DOMENY = topo.referencni_domeny ?? [];
  const out = {};
  for (const raw of formatShellExports(topo).split("\n")) {
    const match = raw.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match) out[match[1]] = match[2];
  }
  return out;
}

const TOPOLOGY_ENV = loadTopologyEnv();
const topo = (key) => prodEnv(key) || process.env[key] || TOPOLOGY_ENV[key] || "";

// Derivace, kterou smí číst dom() — jen ta, která PATŘÍ TÉTO instanci.
// ⛔ NAMĚŘENO 2026-09-28: bez identity vydá derive-domains `APP_NAME_PREFIX=aisha`
// a bez PUBLIC_TLD `APP_DOMAIN=web.aisha.example.com` — obojí z referenčního
// `.json.example`. Věrohodně vypadající cizí hodnota, kterou by dom() rozeslal
// jako doménu instance (třída výpadku 2026-07-28: ~55 domén na *.aisha.example.com).
// Bez identity nebo s referenční doménou tedy dom() derivaci nečte vůbec —
// složeniny zůstanou nerozvinuté a stráž zápisu je jmenuje.
const DERIVACE_INSTANCE = IDENTITY && REFERENCNI_DOMENY.length === 0 ? TOPOLOGY_ENV : {};

// Domény AŽ PO derivaci (viz loadDomains). Cílový trezor je poslední zdroj
// odkazů — sebeodkaz `X=${X:-}` tak vezme hodnotu, kterou instance už nese.
const DOMENY = loadDomains(
  DERIVACE_INSTANCE,
  existsSync(ENV_PATH) ? parseEnvFile(ENV_PATH).values : new Map(),
);
const DOMAINS = DOMENY.hodnoty;

// ── Deklarace domén webu (WEB_FQDNS) — odvozený klíč s rozlišením „nevím" ─────
//
// ⛔ NAMĚŘENO 2026-10-05: redeploy srovnává domény doktorem domén s prostředím
// z `.env.coolify` — a WEB_FQDNS (seznam značek webu) žil jen v doménovém
// overlayi instance, který tenhle doktor nečetl a do `.env.coolify` ho nepsal
// nikdo. Doktor domén v redeployi proto „nevěděl" a edge nezapsal u KAŽDÉHO forku.
// Overlay se teď najde TÝMŽ rozkladem jako v obalu cold-startu a v cold-startu
// (lib/domenovy-overlay.mjs) a hodnota se při každém běhu odvodí ZNOVU — stará
// hodnota v souboru se tak neudrží (srovná se jako každý derived klíč, i na prázdno).
//
// ⛔ „NEVÍM" SE NEZAPISUJE. Prázdná hodnota = instance víc značek nedeklaruje;
// nevím (overlay vyžádaný a nenalezený, deklarovaný overlay nejde získat,
// dopočtený požadavek by ubral uložené značky…) se nezapíše VŮBEC a doktor
// skončí vlastním kódem KOD_ENV_DOKTORA_WEB_NEVIM s příčinou — prázdné by
// doktoru domén řeklo „jedna značka" a ten by routy značek smazal. Ostatní
// odvozené klíče se zapíšou, takže redeploy aplikace nasadí.
const WEB_DEKLARACE = (() => {
  try {
    return deklaraceWebFqdns({
      repo: ROOT,
      env: AISHA_ENV_BEHU,
      prostredi: (() => {
        const p = { ...process.env };
        if (VYSLOVNY_POZADAVEK_OVERLAYE === undefined) delete p.DOMAINS_OVERLAY_REQUESTED;
        else p.DOMAINS_OVERLAY_REQUESTED = VYSLOVNY_POZADAVEK_OVERLAYE;
        return p;
      })(),
      ziskejOverlayDir: () => overlayDirOrRequired("env-doktor: deklarace domén webu (WEB_FQDNS)"),
      trezor: prodEnvMap(),
      najdi: (jmeno) => prodEnv(jmeno) || cleanEnvValue(DERIVACE_INSTANCE[jmeno] ?? "") || "",
      // Uložený seznam: dopočtený požadavek (redeploy) ho smí jen rozšířit, ne zúžit —
      // a CHYBĚJÍCÍ klíč (undefined) nezaloží (není s čím porovnat).
      ulozena: (() => {
        const ulozene = existsSync(ENV_PATH) ? parseEnvFile(ENV_PATH).values : new Map();
        return ulozene.has("WEB_FQDNS") ? cleanEnvValue(ulozene.get("WEB_FQDNS") ?? "") : undefined;
      })(),
    });
  } catch (e) {
    return { znamo: false, duvod: String(e?.message ?? e).split("\n")[0] };
  }
})();
// Nerozbalitelné odkazy, které kontrakt OPRAVDU čte — jen pro výpis u stráže
// (NEROZVINUTÁ ŠABLONA), rozhodnutí „nezapsat" dělá stráž sama.
const domenyNerozbalenePouzite = new Map();
// dom("KEY") — pořadí jako cold-start: operátor (prodEnv) → process.env →
// derivace instance → rozbalené domains.env. Derivace stojí NAD domains.env,
// protože cold-start ji po sourcování domains.env nahraje ZNOVU s přepisem
// (`load_env_file_keys "$TOPOLOGY_ENV" overwrite`) — jinak by natvrdo psané
// příznaky v šabloně (MESH_ENABLED=true) přebily odvozenou topologii.
// Klíče, které dodává JEN derivace (PLUGIN_SYSTEM_URL…), samostatný běh dřív
// neviděl vůbec; pod cold-startem je měl z process.env. Prázdné = není.
const dom = (key) => {
  // Pod cold-startem nese process.env hodnoty, které rozbalil SHELL — a ten ze
  // složeniny s volitelně prázdnou doménou udělá holé schéma. Normalizuje se
  // stejně jako vlastní rozbalení, jinak by samostatný běh a běh pod
  // cold-startem vydaly různé hodnoty.
  const zProstredi = bezUrlBezHostu(
    prodEnv(key) || process.env[key] || cleanEnvValue(DERIVACE_INSTANCE[key] ?? "") || "",
  );
  if (zProstredi) return zProstredi;
  if (DOMENY.nerozbalene.has(key)) {
    // Odkaz bez hodnoty a bez deklarované volitelnosti vrací DOSLOVNOU šablonu:
    // zápis zastaví jediná stráž (NEROZVINUTÁ ŠABLONA v main), ne druhá vedle.
    domenyNerozbalenePouzite.set(key, DOMENY.nerozbalene.get(key));
    return DOMENY.sablony[key];
  }
  return DOMAINS[key] || "";
};

// derivedTopo — jako topo(), ale BEZ process.env uprostřed.
//
// process.env je v tomhle procesu hydratované z operátorského souboru, jenže
// volající (cold-start, deploy skript, shell) běžně sourcuje i CÍLOVÝ .env.coolify.
// Pak driftlá hodnota v cílovém souboru proteče zpátky jako „operátorská" a
// PŘEBIJE derivaci — hodnota se stane vlastním zdůvodněním a smíření nikdy
// neproběhne. Měřeno 2026-07-28: PKI_BRIDGE_URL i AUTH_UPSTREAM_* se takhle
// „opravily" na tutéž špatnou hodnotu.
//
// Operátor má pořád poslední slovo — prodEnv() zůstává první. Jen cílový
// soubor už nemluví do toho, čím sám má být.
const derivedTopo = (key) => prodEnv(key) || TOPOLOGY_ENV[key] || "";

// Model pro běhy claude_cli_task (svc-agent-runner) — veřejná tvář „AISHA jako model“
// (`GATEWAY_DOMAIN_PUBLIC` = ask.<public_tld>, derive-domains; core gateway /v1).
// ⛔ 2026-10-07 (revize D6, majitel „síť zavřít“ = volba A): síť běhů je uzavřená,
// běh smí ven jen přes broker-proxy runneru na VEŘEJNÉ https adresy z konfigurace — bez
// adresy modelu se claude běh nespustí (fail-closed). Hodnota se ODVOZUJE (žádná doména
// v kódu); instance bez veřejné tváře modelu dostane prázdno a claude běhy hlasitě odmítne.
// Jiné rozhodnutí operátora (jiný model / vlastní endpoint) patří do .env-prod-backup.
const modelBehuAgenta = () => {
  const deklarace = prodEnv("ANTHROPIC_BASE_URL");
  if (deklarace) return deklarace;
  const tvar = derivedTopo("GATEWAY_DOMAIN_PUBLIC");
  return tvar ? `https://${tvar}` : "";
};

// domZTopologie — složenina z config/domains.env rozvinutá proti TOPOLOGII.
//
// `dom()` rozvíjí šablonu jen proti process.env a souboru samotnému. Když volající
// topologii do prostředí neexportuje (běžný `aisha-redeploy`), zůstane z
// `STORAGE_PUBLIC_URL=https://${API_DOMAIN_PUBLIC}/storage/v1` doslovné `${…}` —
// naměřeno 2026-09-25 dry-runem nad trezorem instance: doktor chtěl zapsat
// `https://${API_DOMAIN_PUBLIC:-}/storage/v1`. Tady se proměnné berou z deklarace
// operátora, pak z topologie; chybí-li kterákoli, výsledek je PRÁZDNÝ (nezměřeno),
// nikdy šablona. Šablona sama zůstává v domains.env (jediný zdroj tvaru).
function domZTopologie(key) {
  const deklarace = prodEnv(key);
  if (deklarace) return deklarace;
  const soubor = resolve(ROOT, "config/domains.env");
  if (!existsSync(soubor)) return "";
  const radek = readFileSync(soubor, "utf8").split("\n").find((l) => l.startsWith(`${key}=`));
  if (!radek) return "";
  let chybi = false;
  const hodnota = radek.slice(key.length + 1).trim().replace(
    /\$\{([A-Z_][A-Z0-9_]*)(?::?-[^}]*)?\}/g,
    (_, n) => {
      const v = derivedTopo(n) || process.env[n] || "";
      if (!v || v.includes("${")) chybi = true;
      return v;
    },
  );
  return chybi ? "" : hodnota;
}

/**
 * PKI_BUNDLE_REQUIRED z manifestu TÉTO instance — týmiž dveřmi jako cold-start
 * (`coolify-instance-scope.mjs --manifest-path`: overlay → repo). Když manifest
 * nejde najít (strom bez deklarované identity, typicky CI), vrací PRÁZDNO:
 * dosadit cizí inventář by odpovědělo za jinou instanci, a to je přesně to,
 * co resolver odmítá. Prázdný derived klíč doktor VYPÍŠE, nezamlčí.
 *
 * VÝSLOVNÝ inventář (`MANIFEST_FILE`) má přednost — týmiž dveřmi jako
 * aisha-redeploy (`mapaInstance`) a cold-start (`export MANIFEST_FILE`), jejichž
 * dítětem doktor na cestě redeploye je (prostředí dědí). Naměřeno 2026-09-27
 * nad trezorem <fork>: manifest instance leží v jejích datech mimo overlay
 * `manifests/`, redeploy ho dostal výslovně, ale doktor `MANIFEST_FILE`
 * nečetl — klíč hlásil „manifest nenalezen“ a radil `--manifest`, přepínač,
 * který doktor odmítne.
 */
function pkiBundleRequiredNeboPrazdno() {
  try {
    return pkiBundleRequiredForInstance({
      manifestPath: (process.env.MANIFEST_FILE ?? "").trim() || undefined,
      explicitHint: "MANIFEST_FILE=<path>",
    });
  } catch (err) {
    // Prázdno se NEVYDÁVÁ mlčky: kdo doktora spustil, musí vidět PROČ je klíč
    // prázdný — jinak by prázdný `${PKI_BUNDLE_REQUIRED:?}` v compose vypadal
    // jako vada doručení, ne jako nenalezený manifest.
    console.error(`aisha-env-doctor: PKI_BUNDLE_REQUIRED se neodvodil (manifest instance nenalezen): ${err.message.split("\n")[0]}`);
    return "";
  }
}

// meshPeerIps — adresy NAŠICH peerů, jak je doručilo discovery.
//
// ⭐ ČTE SE CÍLOVÝ SOUBOR, a je to v souladu s pravidlem o pár řádků výš:
// z `.env.coolify` se smí brát VSTUPY, ne odvozeniny. Seznam peerů je naměřený
// fakt (netbird-peer-discover -> aisha-redeploy), ne derivace, takže se jím
// derivace krmit SMÍ. Naopak `GATEWAY_TRUSTED_PROXIES`, který z něj vzniká, se
// z cílového souboru brát nesmí — jinak by drift potvrzoval sám sebe.
//
// ⛔ TREZOR SE NEPTÁ, a to je odchylka od `topo()` schválně. `.env-prod-backup`
// je snapshot pořízený PŘED wipem; u peerů by tedy držel adresy, které už
// nikomu nepatří, a důvěřovalo by se jim dál. Táž třída jako
// AISHA_BOOTSTRAP_CLIENT_SECRET ve fázi D2 cold-startu (2026-08-26), kde měl
// snapshot vyšší přednost a 90 minut vydával mrtvou hodnotu za platnou.
function meshPeerIps() {
  const cil = existsSync(ENV_PATH) ? parseEnvFile(ENV_PATH).values : new Map();
  return cleanEnvValue(cil.get("MESH_PEER_IPS") || "");
}

// ── Prefix pull-through cache: rozhoduje deklarace operátora, jinak domov ─────
// Jediná odpověď pro celý doktor — rozvinutí IMAGE_* i klíč REGISTRY_PROXY. Dřív
// se `${REGISTRY_PROXY}` v pinech rozvíjelo z process.env, které tu v naprosté
// většině běhů NENÍ, takže každý Docker Hub pin se uložil BEZ prefixu a jako
// required-static v .env.coolify zkameněl (naměřeno 2026-09-14 na instanci <fork>: 23/23).
// Proč deklarace a ne uložená hodnota: prázdné `REGISTRY_PROXY=` v .env.coolify
// nikdo nerozhodl — zapsal ho cold-start, když ho sourcování nastavilo na prázdno.
// Výslovné vypnutí cache pro nouzi je naopak rozhodnutí a smí žít JEN v
// .env-prod-backup (rozhodnutí majitele 2026-09-14).
const REGISTRY_PROXY_ROZLISENI = (() => {
  const soubor = resolve(ROOT, "config/image-versions.env");
  const domov = domovRegistryProxy(readFileSync(soubor, "utf8"));
  // --no-external (preflight syncu) deklaraci NEVIDÍ. Soudit piny proti domovu by
  // znamenalo hádat — a instance s výslovně vypnutou cache by preflight --strict
  // shodila na „driftu" IMAGE_*, takže nouzová cesta by zablokovala sync. Bez
  // deklarace proto platí prefix, který soubor sám nese: preflight měří jeho
  // vnitřní soudržnost, rozhodnutí patří běhu S .env-prod-backup.
  if (NO_EXTERNAL) {
    const ulozeno = existsSync(ENV_PATH) ? parseEnvFile(ENV_PATH).values : new Map();
    if (ulozeno.has("REGISTRY_PROXY")) {
      return { hodnota: String(ulozeno.get("REGISTRY_PROXY") ?? ""), zdroj: "uloženo (bez .env-prod-backup)" };
    }
  }
  const mapa = prodEnvMap();
  const deklarace = mapa.has("REGISTRY_PROXY")
    ? { ma: true, hodnota: mapa.get("REGISTRY_PROXY") }
    : { ma: false };
  return rozlisRegistryProxy({ deklarace, domov });
})();

function expandEnvRefs(value, scope) {
  // `(?::?-…)`: soubor používá i holou pomlčku (`${REGISTRY_PROXY-<domov>}`).
  return value.replace(/\$\{([A-Z_][A-Z0-9_]*)(?::?-[^}]*)?\}/g, (_, name) => {
    if (name === "REGISTRY_PROXY") return REGISTRY_PROXY_ROZLISENI.hodnota;
    return process.env[name] ?? scope[name] ?? "";
  });
}

function loadImageVersions() {
  const file = resolve(ROOT, "config/image-versions.env");
  const out = {};
  if (!existsSync(file)) return out;
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!match) continue;
    out[match[1]] = expandEnvRefs(match[2], out);
  }
  return out;
}

const IMAGE_VERSIONS = loadImageVersions();
const image = (key, fallback) => process.env[key] || IMAGE_VERSIONS[key] || fallback;

// ── ENV CONTRACT ─────────────────────────────────────────────────────────────
// Each entry: [key, kind, ...args, comment?]
// kinds:
//   ["secret", N]            — base64url random of N bytes
//   ["secret", VAPID_PAR]    — half of a key PAIR, resolved together with its
//                              partner by lib/vapid-par.mjs (never random)
//   ["hex", N]               — hex random of N bytes
//   ["b64std", N]            — standard base64 (Go StdEncoding-compatible) of N bytes
//   ["static", value]        — fixed default
//   ["required-static", value] — fixed/generated value that must be non-empty
//   ["alias", otherKey]      — copy from another key (resolved at runtime)
//   ["alias-prefix", prefix, otherKey] — `${prefix}${other}` (e.g. "sk-lf-" + hex)
//   ["external"]             — must come from .env-prod-backup or manual
//   ["placeholder"]          — empty, filled by separate tool
//   ["template", str]        — interpolate ${KEY} from already-resolved values
//   ["template-default", str] — same interpolation, but the operator's own
//                              declaration in .env-prod-backup WINS, including
//                              an explicitly EMPTY one. For values where empty
//                              is a meaningful choice rather than "unset".
/**
 * Komu brána věří při výměně Keycloak tokenu za PostgREST JWT — a od 2026-10-04 i komu
 * věří koncový bod MCP (svc-mcp-knowledge `/mcp`): táž hodnota, jeden domov.
 *
 * ⛔ PROČ SE TO ODVOZUJE. `services/gateway/src/config.ts` měl výčet
 * `?? 'aisha-app,aisha-dirigent-device'` — dosazený literál, který HÁDÁ fakt
 * o světě: kdo se v TÉHLE instanci smí ověřovat. Naměřeno 2026-09-01: nasazená
 * instance deklaruje tři vlastní klienty a na seznamu nebyl ANI JEDEN —
 * zatímco tam byli dva platformní, které ta instance vůbec nemá.
 * Projeví se to jako `keycloak_client_not_allowed`, tedy „přihlášení
 * nefunguje" bez souvislosti s příčinou.
 *
 * ⭐ ZDROJ JE DEKLARACE, NE VÝČET. Klienty zakládá `configure-realms.sh` ze
 * dvou míst: platformní z `keycloak/aisha-realm.json`, instanční z overlaye
 * (`keycloak/NN_*-client.json`). Seznam se skládá z týchž souborů, takže
 * pokrývá každou implementaci sám a nepotřebuje ruční údržbu.
 *
 * ⛔ SERVISNÍ ÚČTY SEM NEPATŘÍ. Výměna za PostgREST JWT nese identitu ČLOVĚKA
 * (`sub` → `auth.uid()`); klient se service accountem by tudy propašoval
 * stroj. Publikace pluginu má zůstat činem s autorem.
 */
function kcAllowedClients() {
  const out = new Set();

  // Pravidlo pro platformní realm má jeden domov (lib/povoleni-klienti.mjs) — týmž
  // skládají hodnotu místní presety, takže se místní stack a nasazení nerozejdou.
  const realm = join(ROOT, "keycloak", "aisha-realm.json");
  if (existsSync(realm)) {
    for (const id of verejniKlientiRealmu(JSON.parse(readFileSync(realm, "utf8")))) out.add(id);
  }

  // Overlay je nepovinný (fork bez instance je platný stav), ale když je
  // DEKLAROVANÝ a nejde přečíst, je to vada — ne důvod tiše vynechat klienty.
  // Deklarací je i `AISHA_INSTANCE_DATA_GIT_URL` bez exportované cesty: rozhodují
  // o tom dveře (overlayDirOrRequired), ne tahle funkce. Naměřeno 2026-09-13:
  // redeploy bez cesty odvodil KC_ALLOWED_CLIENTS bez klientů instance.
  const dir = overlayDirOrRequired("env-doctor: KC_ALLOWED_CLIENTS");
  if (dir) {
    const kc = join(dir, "keycloak");
    if (!existsSync(kc)) {
      throw new Error(
        `${OVERLAY_ENV} je deklarovaný, ale ${kc} neexistuje — ` +
        "seznam povolených klientů by vyšel neúplný a přihlášení by selhalo až v provozu.",
      );
    }
    for (const f of readdirSync(kc).filter((f) => f.endsWith("-client.json"))) {
      const c = JSON.parse(readFileSync(join(kc, f), "utf8"));
      if (c?.clientId && c.serviceAccountsEnabled !== true) out.add(c.clientId);
    }
  }

  return [...out].sort().join(",");
}

/**
 * Popis KLÍČOVÉHO PÁRU u druhu `secret`: obě poloviny nesou týž objekt a doktor
 * je řeší NARAZ podle `lib/vapid-par.mjs`, ne jako dvě nezávislé náhody.
 *
 * Druh zůstává `secret` ZÁMĚRNĚ — podle něj cold-start tajemství zachovává,
 * `coolify-sync-envs` ověřuje jejich doručení a `vault-drift-doctor` je bere za
 * vyráběné. Nový druh by je všem třem tiše vzal. Mění se jen to, JAK se
 * hodnota vyrábí a posuzuje.
 */
const VAPID_PAR = Object.freeze({
  par: "vapid",
  verejny: "WEB_PUSH_VAPID_PUBLIC_KEY",
  soukromy: "WEB_PUSH_VAPID_PRIVATE_KEY",
});
const jeParKlicu = (arg) => typeof arg === "object" && arg !== null && arg.par === "vapid";

/**
 * Klíč, který patří OPT-IN službě katalogu: dokud je její lane (`provision_when_env`)
 * zavřená, doktor ho nevyrábí (secret) ani nehlásí jako chybějící (external) —
 * instance, která službu nenasazuje, ho nenese a nemá ho nést. Vypíše se zvlášť
 * („za zavřenou lane"), takže mlčení není tiché.
 *
 * Lane se NEOPISUJE: čte se z katalogu té služby (jeden domov `provision_when_env`),
 * výklad „zapnuto?" z lib/provision-gate.mjs. Neznámá služba je chyba kontraktu.
 *
 * Druhý argument a dál = DALŠÍ přepínače, které musí být zapnuté taky (klíč smí
 * žádat jen ta část služby, která se opravdu nasazuje). Funguje pro
 * každý druh klíče (i `derived`): rozhoduje se dřív, než se větví podle druhu.
 * Hodnoty: prostředí procesu, pak trezor (.env-prod-backup).
 */
const zaLaneSluzby = (id, ...dalsiPrepinace) => Object.freeze({ zaLaneSluzby: id, dalsiPrepinace });
const podminkaZaLane = (rest) => rest.find((x) => x && typeof x === "object" && typeof x.zaLaneSluzby === "string");
const ctiLane = (k) => process.env[k] || prodEnv(k);
function laneSluzbyOtevrena({ zaLaneSluzby: id, dalsiPrepinace = [] }) {
  const svc = JSON.parse(readFileSync(resolve(ROOT, "config/services.json"), "utf8")).services?.[id];
  if (!svc) throw new Error(`kontrakt váže klíč na lane služby '${id}', kterou config/services.json nezná`);
  return podminkaSplnena(svc.provision_when_env, ctiLane) && dalsiPrepinace.every((k) => jeLaneZapnuta(ctiLane(k)));
}

const CONTRACT = [
  // ── Core secrets (preserve if exist) ──────────────────────────────────────
  ["POSTGRES_PASSWORD", "secret", 32],
  ["JWT_SECRET", "secret", 48],
  ["JWT_EXP", "static", "3600"],
  ["VAULT_ENCRYPTION_KEY", "hex", 32],
  ["COLUMN_ENCRYPTION_KEY", "hex", 32],
  // Trezor relací federovaného zdroje (ADR-004) — klíč jen pro broker, nikdy do DB.
  ["FEDERATION_VAULT_KEY", "hex", 32],

  // Note: ANON_KEY and SERVICE_ROLE_KEY are JWTs signed with JWT_SECRET.
  // If missing here, the doctor cannot synthesize them safely (would invalidate
  // existing tokens on next sync). Mark as external — cold-start regenerates them.
  ["ANON_KEY", "external"],
  ["SERVICE_ROLE_KEY", "external"],

  // ── Aliases over the above ────────────────────────────────────────────────
  ["AISHA_SERVICE_KEY", "alias", "SERVICE_ROLE_KEY"],
  ["AISHA_ANON_KEY", "alias", "ANON_KEY"],
  ["AISHA_API_URL", "static", dom("AISHA_API_URL")],
  ["AISHA_BACKEND_URL", "static", dom("AISHA_BACKEND_URL")],
  ["AISHA_BACKEND_ANON_KEY", "alias", "ANON_KEY"],
  ["AISHA_BACKEND_SERVICE_KEY", "alias", "SERVICE_ROLE_KEY"],
  // ⛔ NAMĚŘENO 2026-08-16: hostitel tu byl natvrdo `aisha-db`. To je identita
  // PLATFORMY zapečená do kontraktu — fork, který kontrakt použije, míří na
  // aplikace upstreamu (týž kořen jako výchozí „aisha" v serviceAliasPrefix()).
  // Na sdíleném hostiteli navíc to jméno nárokuje víc nájemníků naráz a DNS
  // mezi nimi round-robinuje. Adresa se proto skládá z IDENTITY, stejně jako
  // ji skládá compose přes `${APP_NAME_PREFIX:?identita instance}`.
  //
  // Prázdnou identitu tu NEHLÍDÁME podruhé: `APP_NAME_PREFIX` je níž jako
  // `required-static`, což je fail-closed. Druhá pojistka na totéž by udělala
  // dva domovy pro jednu otázku.
  ["AISHA_DB_URL", "template", IDENTITY ? `postgresql://aisha_admin:\${POSTGRES_PASSWORD}@${IDENTITY}-db:5432/postgres` : ""],
  ["AISHA_AS_TOKEN", "secret", 32],
  ["AISHA_HS_TOKEN", "secret", 32],
  ["AISHA_MIGRATE_DEBUG_HOLD", "static", "false"],
  // Private instance overlay clone URL (migrate hook + KC instance clients).
  // Cold-start derives it (generate-secrets.mjs: vault > process env > existing
  // > FORGEJO_API_TOKEN+FORGEJO_URL > empty); the doctor cannot derive it but
  // keeps the key PRESENT so the per-app sync intersection (.env.coolify ∩
  // compose ${VAR} refs) still carries it to aisha-core. Empty = community
  // install → instance-data-hook.sh no-ops (valid, not an error).
  ["AISHA_INSTANCE_DATA_GIT_URL", "placeholder"],

  // ── svc-source-broker — zdrojové adaptéry z instančního overlaye ───────────
  // Build brokeru klonuje overlay a staví adaptéry z `source-adapters/<jméno>/`
  // (Dockerfile.svc-source-broker, stage source-adapters). Repo JE deklarovaný
  // overlay instance, takže se URL i ref ODVOZUJÍ — žádná druhá deklarace téhož,
  // která by se s první rozešla. URL bez přihlašovacích údajů: jde do build ARGu
  // a ten se zapisuje do metadat obrazu; token nese BuildKit secret.
  // Prázdno = instance overlay nedeklaruje → obraz adaptéry nenese (/source 501).
  ["SOURCE_ADAPTER_OVERLAY_GIT_URL", "derived", deklarovanyOverlayRepo()?.url ?? ""],
  ["SOURCE_ADAPTER_OVERLAY_REF", "derived", deklarovanyOverlayRepo()?.ref ?? ""],

  // ── svc-web-artifact — branded design overlay (private aisha-guru-web) ─────
  // CLEAN url (no token; the svc-web-artifact build adds FORGEJO_TOKEN at clone,
  // #425). generate-secrets derives it from FORGEJO_URL; .env-prod-backup
  // override wins; empty = OSS install → committed placeholder + domains/default.
  // On aisha-core all envs normalize to build-time, so it reaches the build ARG
  // that drives the overlay into domains/templates/<AISHA_SEED_DOMAIN>/.
  ["AISHA_WEB_DESIGN_GIT_URL", "placeholder"],

  // ── mobile + cockpit brand — the DESIGN SYSTEM repo (tokens, not a website) ─
  // Sibling of AISHA_WEB_DESIGN_GIT_URL, and deliberately a SEPARATE key: that
  // one points at the public WEB (a site), this one at the design language —
  // the repo that owns tokens.json and emits the per-platform fan-out (CSS,
  // shadcn, RN/Expo, Swift). One instance can re-skin its app without touching
  // its website, and the two move on different release cycles.
  //
  // PROČ TO PŘIBYLO (naměřeno 2026-08-09): mobilní motiv
  // `mobile-app/src/theme/index.ts` je GENEROVANÝ ze značky, a dokud ta značka
  // nebyla vyhlášená jako kanál, musela se ZRCADLIT do tohohle repa — jinak
  // `design-tokens.gate` mlčky přeskočila. Kopie tedy nevznikla kvůli nasazení
  // (to bere overlay z instančního repa), ale kvůli měřidlu. Vyhlášený kanál
  // tu kopii dělá zbytečnou a vrací zdroj tam, kam patří.
  //
  // Prázdné = OSS instalace → motiv se staví z `packages/design-tokens/tokens.json`
  // a brána ho ve stromu ověří. Prázdno tu tedy NENÍ vada, je to jiný svět.
  ["AISHA_DESIGN_GIT_URL", "placeholder"],

  // ── svc-web-artifact — public-site seed (folder-name == domain) ───────────
  // /seed-default auto-imports domains/templates/<AISHA_SEED_DOMAIN>/ at boot
  // when that folder exists (e.g. the ${PUBLIC_TLD} design submodule), else the
  // neutral domains/default/. Defaults to the public domain (PUBLIC_TLD);
  // override in .env-prod-backup to seed a differently-named template folder.
  // Optional — empty resolves to the neutral default (no failure).
  ["AISHA_SEED_DOMAIN", "static", dom("PUBLIC_TLD")],

  // ── Internal cross-stack tokens ───────────────────────────────────────────
  ["INTERNAL_API_KEY", "secret", 32],
  ["BROKER_TOKEN_SECRET", "alias", "INTERNAL_API_KEY"],
  // Shared intranet key (gateway /token-exchange + intranet routes ↔ Appsmith
  // datasource ↔ source broker). Distinct from INTERNAL_API_KEY (admin bearer).
  ["INTRANET_API_KEY", "secret", 32],
  ["POSTGREST_SERVICE_TOKEN", "alias", "SERVICE_ROLE_KEY"],
  ["POSTGREST_URL", "derived", derivedTopo("POSTGREST_URL") || dom("POSTGREST_URL")],

  // ── Keycloak ──────────────────────────────────────────────────────────────
  ["KEYCLOAK_ADMIN", "static", "admin"],
  ["KEYCLOAK_ADMIN_PASSWORD", "secret", 24],
  ["KEYCLOAK_DB_PASSWORD", "secret", 32],
  ["KEYCLOAK_CLIENT_ID", "static", "aisha-app"],
  ["KEYCLOAK_CLIENT_SECRET", "secret", 32],
  // Servisní účet, kterým gateway zakládá uživatele v KC (POST /admin/users/invite).
  // Musí dorazit do OBOU stacků — realm si ho dosazuje, gateway ho posílá.
  ["KC_ADMIN_CLIENT_SECRET", "secret", 32],
  // ── Identita instance — klíč, na kterém stojí izolace nájemníků ───────────
  // V kontraktu CHYBĚLA, přestože compose ji vyžadují tvrdě: 30+ míst tvaru
  // `${APP_NAME_PREFIX:?identita instance}` pojmenovává volumes, sítě a hlavně
  // aliasy na sdílené síti — tedy přesně tu hranici, kterou #859/#862 zavedly,
  // aby se dvě instance na jednom hostu neviděly do talíře.
  //
  // Zapisuje ji dneska JEDINÝ producent: heredoc v aisha-cold-start.sh ř. 2313.
  // Kdo `.env.coolify` opraví jinou cestou — a doctor --apply TAKOVOU cestou je —
  // klíč mlčky ZTRATÍ, protože co není v kontraktu, to se ani nezachová, ani
  // nedoplní. Doctor pak dohlásí „env contract complete“ nad souborem, který
  // nemá identitu, a teprve compose na hostu spadne na `:?`. Dvě brány nad týmž
  // souborem si protiřečí a ta pozdější mluví o volume, ne o příčině.
  // (Naměřeno na jedné instanci 2026-08-11: .env.coolify po doctor --apply
  // mělo AISHA_STORY vyplněné, ale APP_NAME_PREFIX vůbec.)
  //
  // required-static, ne static: prázdná identita je fail-closed stav. Dosazené
  // „aisha“ by fork namířilo na upstreamové aplikace — týž důvod, proč se
  // nedosazuje v generate-secrets.mjs ř. 566 ani v cold-startu.
  ["APP_NAME_PREFIX", "required-static", IDENTITY],
  // ⛔ NEREGISTROVANÝ KLÍČ NEJDE POSOUDIT (naměřeno 2026-09-16 na konci studeného
  // startu). `vault-drift-doctor` porovnává trezor s .env.coolify a u klíče, který
  // v tomhle registru není, neumí říct, jestli je rozchod vada, nebo záměr — a
  // skončí nenulou. Studený start tak doběhl celý a přesto ohlásil selhání kvůli
  // DVĚMA jménům, která nikdy nikdo nezapsal.
  //
  // Obojí vydává generate-secrets (`preservedEmail`, `secret(24)`), tedy platforma;
  // po wipe je heslo platné to nové (starý realm zmizel s daty). `placeholder`
  // proto, že hodnotu doktor nedrží — jen ví, že klíč do kontraktu patří.
  ["PLATFORM_ADMIN_EMAIL", "placeholder"],
  ["PLATFORM_ADMIN_PASSWORD", "placeholder"],
  // Klienti realmu — ID ke dvěma tajemstvím výše. Konstanty žijí v
  // keycloak/aisha-realm.json a generate-secrets je vydává (`OIDC_APP_CLIENT_ID`
  // ř. 632, `KC_ADMIN_CLIENT_ID` ř. 634), ale v TOMHLE kontraktu chyběly — takže
  // se nezapsaly do .env.coolify, zatímco core compose je vyžaduje jako povinné
  // (`${KC_ADMIN_CLIENT_ID:?}`, `${OIDC_APP_CLIENT_ID:?}`). Doctor pak hlásil
  // „env contract complete“ a preflight hned nato spadl na chybějící proměnnou —
  // rozpor mezi dvěma branami nad týmž souborem (změřeno na jedné instanci 2026-08-11).
  // Hodnoty jsou tytéž defaulty, jaké generate-secrets používá, takže se
  // preservedValue nemá s čím rozejít.
  ["KC_ADMIN_CLIENT_ID", "static", "aisha-user-admin"],
  ["OIDC_APP_CLIENT_ID", "static", "aisha-app"],
  // `aud` ws-gateway ověřuje proti TÉMUŽ klientovi realmu (generate-secrets
  // ř. 633 to má okomentované jako „aud = týž klient"). Patří sem i když
  // instance realtime nenasazuje: preflight validuje VŠECHNY compose v repu,
  // ne jen ty z manifestu, takže chybějící klíč shodí doctor i profilu,
  // kterého se ta služba netýká.
  ["WS_JWT_AUDIENCE", "static", "aisha-app"],
  // n8n bootstrap owner — generate-secrets ř. 641 ho skládá z PUBLIC_TLD;
  // stejná mezera, stejný důsledek (n8n compose ho žádá povinně).
  // Hodnota jde přes topo(), ne přes holé process.env — tenhle nástroj má vlastní
  // vrstvení (prodEnv → process.env → TOPOLOGY), a obcházet ho zrovna tady by
  // odporovalo tomu, proč IDENTITY výš dostává hodnoty přes dom(). Fallback je
  // MESH_TLD stejně jako u zdroje (generate-secrets ř. 642 padá na meshTld);
  // "localhost" by se jako `static` zapsal NATRVALO a e-mail vlastníka n8n by
  // navždy ukazoval mimo instanci.
  ["N8N_BOOTSTRAP_OWNER_EMAIL", "static", `n8n-owner@${topo("PUBLIC_TLD") || topo("MESH_TLD")}`],
  // Hostitelská cesta běhů exec stacku — instančně odvozená (generate-secrets), aby se
  // dvě instance na jednom hostu nepřetahovaly o týž adresář (runner ji dává dětem
  // v Binds, sám pracuje v pevném /var/lib/agent-runs). AGENT_REPO_PATH (sdílený
  // base-repo) je pryč: běh si repo klonuje sám z AGENT_GIT_REMOTE (fix/exec-klon-per-beh).
  // required-static, ne static: zdroj je fail-closed (generate-secrets při prázdné
  // identitě odmítne emitovat). Jako "static" by prázdné IDENTITY tiše zapsalo
  // `/var/lib//agent-runs` — TÝŽ adresář pro každou instanci.
  // ⛔ A NEPRÁZDNOST MUSÍ MĚŘIT IDENTITU, NE ŘETĚZEC (naměřeno 2026-09-27 dry-runem nad
  // trezorem <fork>, který identitu neukládá): `/var/lib/${""}/…` je `/var/lib//…` —
  // NEPRÁZDNÝ řetězec, takže kontrola required-static prošla a doktor chtěl zapsat
  // cestu s dírou. Bez identity je hodnota PRÁZDNÁ → required-static ji ohlásí jako
  // chybějící (týž vzor jako INGEST_ALLOWED_HOSTS níž).
  ["AGENT_RUNS_DIR", "required-static", IDENTITY ? `/var/lib/${IDENTITY}/agent-runs` : ""],
  // Předrender po síti (d-ii, 2026-10-02): tajemství jen pro dvojici web → web-render
  // (PUT /shell). Dřívější WEB_RENDER_*_HOST_DIR zmizely se sdíleným diskem.
  ["WEB_RENDER_SHELL_TOKEN", "secret", 32],
  ["KEYCLOAK_URL", "static", dom("KEYCLOAK_URL")],
  ["KEYCLOAK_REALM", "static", "aisha"],
  ["KEYCLOAK_DOMAIN", "static", dom("KEYCLOAK_DOMAIN")],
  ["AUTH_DOMAIN", "required-static", topo("AUTH_DOMAIN")],
  ["KEYCLOAK_PUBLIC_DOMAIN", "required-static", topo("KEYCLOAK_PUBLIC_DOMAIN")],
  ["AUTH_PUBLIC_DOMAIN", "required-static", topo("AUTH_PUBLIC_DOMAIN")],
  ["KEYCLOAK_DOMAIN_PUBLIC", "required-static", topo("KEYCLOAK_DOMAIN_PUBLIC")],
  // Mesh-independent KC host (edge auth upstream + KC Traefik direct router);
  // equals KEYCLOAK_DOMAIN when mesh is off. See derive-domains.mjs.
  ["KEYCLOAK_DOMAIN_DIRECT", "derived", derivedTopo("KEYCLOAK_DOMAIN_DIRECT")],
  // Komu brána věří při výměně KC tokenu za PostgREST JWT — složeno z deklarací
  // klientů (platformní realm + instanční overlay), ne z výčtu v kódu.
  ["KC_ALLOWED_CLIENTS", "derived", kcAllowedClients()],
  ["AUTH_DOMAIN_PUBLIC", "required-static", topo("AUTH_DOMAIN_PUBLIC")],
  ["KC_CLIENT_SECRET", "alias", "KEYCLOAK_CLIENT_SECRET"],
  ["KC_JWKS_JSON", "placeholder"], // populated by provision-sso.sh

  // ── Langfuse ──────────────────────────────────────────────────────────────
  ["LANGFUSE_DB_PASSWORD", "secret", 32],
  ["LANGFUSE_OIDC_SECRET", "secret", 32],
  ["LANGFUSE_NEXTAUTH_SECRET", "secret", 32],
  ["LANGFUSE_SALT", "secret", 32],
  ["LANGFUSE_ENCRYPTION_KEY", "hex", 32],
  ["LANGFUSE_PUBLIC_KEY", "static", "pk-lf-aisha-prod"],
  ["LANGFUSE_SECRET_KEY", "alias-prefix", "sk-lf-", "INTERNAL_API_KEY"],
  ["LANGFUSE_ADMIN_EMAIL", "static", "admin@example.com"],
  ["LANGFUSE_ADMIN_PASSWORD", "secret", 24],
  ["LANGFUSE_DOMAIN", "static", dom("LANGFUSE_DOMAIN")],
  ["LANGFUSE_HOST", "static", `https://${dom("LANGFUSE_DOMAIN")}`],

  // ── n8n ───────────────────────────────────────────────────────────────────
  ["N8N_ENCRYPTION_KEY", "secret", 32],
  ["N8N_OIDC_SECRET", "secret", 32],
  ["N8N_BASIC_AUTH_PASSWORD", "secret", 24],
  ["N8N_DB_PASSWORD", "secret", 32],
  ["N8N_WEBHOOK_AUTH_TOKEN", "secret", 32],
  ["N8N_BOOTSTRAP_OWNER_PASSWORD", "secret", 32],
  // ⛔ IDENTITA, ne alias implementace (naměřeno 2026-08-26). Stálo tu
  // `"static", "aisha-db"` — jenže na SDÍLENÉ síti o to jméno soupeří každý
  // nájemník a vyhraje ten, kdo nasadí první. Přesně to je incident, kvůli
  // kterému vznikla brána `hostitel-nesmi-nest-jmeno-instance-natvrdo`
  // (`getaddrinfo EAI_AGAIN aisha-db`, riq). Nasazení už správnou hodnotu
  // mělo — rozešla se jen DEKLARACE, takže čerstvá instance by dostala cizí.
  //
  // SERVICE_ALIAS_PREFIX se tu použít NEDÁ: je to jméno IMPLEMENTACE stacku
  // (stejné pro každou instanci, viz komentář u LOCAL_INGEST_OUT_VOLUME výš).
  ["N8N_DB_HOST", "template", "${APP_NAME_PREFIX}-db"],
  ["N8N_DB_PORT", "static", "5432"],
  ["N8N_DB_NAME", "static", "postgres"],
  ["N8N_DB_USER", "static", "n8n_app"],
  ["N8N_DOMAIN", "static", dom("N8N_DOMAIN")],
  ["N8N_WEBHOOK_URL", "static", `https://${dom("N8N_DOMAIN")}`],
  ["N8N_COOKIE_SECRET", "hex", 16],
  // NENÍ operátorský: klíč si RAZÍ sama platforma. `n8n-deploy-entrypoint.sh`
  // volá `n8n-bootstrap-apikey.mjs` uvnitř clusteru a výsledek ukládá do
  // /run/n8n/apikey. Žádat ho po operátorovi znamená blokovat nasazení kvůli
  // hodnotě, kterou si nasazení vyrobí samo.
  // POZOR — druhá půlka zatím chybí: `coolify-deploy-init.sh:1530` rozesílá
  // `${N8N_API_KEY}` z operátorského prostředí, takže vyražený klíč z kontejneru
  // nikam neodteče a konzumenti (ai-chat, appsmith) dostanou prázdno. Doručení
  // je vedeno jako samostatná úloha; tady se jen přestává lhát o tom, ČÍ ta
  // hodnota je.
  ["N8N_API_KEY", "placeholder"],
  ["N8N_EXECUTIONS_MODE", "static", "queue"],
  ["N8N_COMMUNITY_PACKAGES_REGISTRY", "static", "https://registry.npmjs.org"],

  // ── Redis cluster ─────────────────────────────────────────────────────────
  // Hostitel sdíleného Redisu — ODVOZENÝ, ne zapsaný. `derive-domains.mjs` ho
  // skládá ze SERVICE_ALIAS_PREFIX, tedy z téhož zdroje, jakým si shared-redis
  // dává alias. Doctor ho tím zná: dodá ho při cold-startu i doplní, když se
  // ztratí — a compose ho vyžaduje `:?`, takže prázdná hodnota deploy ZASTAVÍ
  // místo aby vyrobila `redis://core:heslo@:6379`, což vypadá zdravě a nefunguje.
  ["SHARED_REDIS_HOST", "derived", derivedTopo("SHARED_REDIS_HOST")],
  ["REDIS_PASSWORD", "secret", 32],
  ["REDIS_PASSWORD_CORE", "secret", 32],
  ["REDIS_PASSWORD_LANGFUSE", "secret", 32],
  ["REDIS_PASSWORD_N8N", "secret", 32],
  ["REDIS_PASSWORD_ADMIN", "secret", 32],

  // ── Zaťukání na dveře (svc-knock, edge) ───────────────────────────────────
  // Registrované tady, aby je `--wipe` cold-start EMITOVAL a instance naběhla
  // autonomně. Bez zápisu by měly v compose jen tvar `${VAR:-default}`, tedy
  // by je nikdo nevydal a dveře by se musely zapínat rukou — přesně to, co
  // „vše přes waves a cold start" vylučuje.
  //
  // ⭐ SPA_DIAGNOSE=1 je BEZPEČNÝ VÝCHOZÍ STAV: v měřicím režimu služba odmítne
  // start s operátory, takže strukturálně nemůže nic otevřít. Čerstvá instance
  // tak má dveře, které MĚŘÍ, ne dveře, které pouštějí.
  ["SPA_DIAGNOSE", "derived", derivedTopo("SPA_DIAGNOSE")],
  // ⛔ VEŘEJNÝ UDP PORT JE RUČNÍ DEKLARACE OPERÁTORA, NE LITERÁL (rozhodnutí
  // majitele 2026-09-15). Na sdíleném serveru má každá instance jiný port a
  // forward na firewallu nastavuje člověk — literál tu byl tichým nárokem na port,
  // o který se dvě instance přetahují. Deklarace žije v `.env-prod-backup`
  // (cold-start ji přenese průchodem; deklarace u pevného klíče viz
  // lib/deklarace-operatora.mjs). Prázdný literál: instance BEZ dveří dostane
  // klíč prázdný — compose ho nese jako `${SPA_KNOCK_PUBLIC_PORT?…}` (přítomný,
  // prázdno smí jen bez profilu knock, protože compose interpoluje i službu
  // za vypnutým profilem). Prázdný port U DEKLAROVANÝCH dveří je vada, kterou
  // hlásí lib/dvere-soulad.mjs (cold-start, deploy-init, sync, doktor).
  // Proč ne `external`: ten prázdný klíč NEZAPÍŠE, takže by compose instance
  // bez dveří nešel ani interpolovat (viz poznámka u OAUTH2_COOKIE_DOMAINS).
  ["SPA_KNOCK_PUBLIC_PORT", "static", ""],
  // Režim dveří: `off` | `measure` | `enforce`. POLITIKA, ne tajemství —
  // prázdno znamená „nic nad rámec výchozího", tedy zavřeno není nic.
  // Doctor o ní musí vědět, jinak ji hlásí jako překlep a po přestavbě
  // prostředí se ztratí bez varování.
  ["SPA_DOOR_MODE", "placeholder"],
  ["SPA_REDIS_DB", "static", "4"],
  // Jak dlouho zůstane zaťukaná adresa otevřená.
  //
  // ⛔ NAMĚŘENO 2026-09-01: nikdo tuhle hodnotu NEDORUČOVAL. Compose měl
  // `${SPA_PINHOLE_TTL:-120}` a brána `?? '120'` — dvě kopie téhož čísla, a
  // shoda byla NÁHODA DVOU DEFAULTŮ, ne kontrakt. Přesně ten tvar, na kterém
  // nás dnes chytila brána u `RAGNAROK_URL`: fallback, který JE hodnotou ve
  // 100 % běhů. Stačilo změnit default v jednom ze dvou míst a rozešlo by se to.
  //
  // 120 s bylo navíc PRAKTICKY málo: „zaklepu a pak se přihlásím" znamená projít
  // celý tok Keycloaku (přesměrování, heslo, druhý faktor) — a uprostřed by se
  // dveře zavřely. Hodnota je POLITIKA majitele, ne konstanta kódu; tady má
  // jediný domov a mění se tady.
  ["SPA_PINHOLE_TTL", "static", "3600"],
  // Dveře na EDGE: `off` (výchozí) | `enforce`. Zavírá CELÝ edge — kdo neťukal,
  // nedostane se ani k přihlašovací stránce.
  //
  // `placeholder` schválně, stejně jako `SPA_DOOR_MODE`: je to POLITIKA, ne
  // odvozená hodnota. Doctor o ní musí vědět (jinak ji hlásí jako překlep a po
  // přestavbě prostředí zmizí bez varování), ale nesmí ji přepisovat — jinak by
  // každý běh doktora dveře zase otevřel.
  ["EDGE_DOOR_MODE", "placeholder"],
  // Lhůta evidence adres (dveře observe), JEDINÝ domov výchozí hodnoty. `static`
  // doplní jen CHYBĚJÍCÍ klíč; operátorem zkrácenou lhůtu nepřepíše (změřeno:
  // chybí → 30, 14 → 14). Výslovně prázdná zůstane prázdná a compose `:?`
  // nasazení zastaví nahlas — lhůta s právním dosahem se nedosazuje.
  ["EDGE_ACCESS_RETENTION_DAYS", "static", "30"],
  // Kdo dává verdikt edge dveřím (`forward_auth`). Je to TÝŽ `svc-knock`, který
  // mapu zaťukaných PÍŠE — jeden vlastník zápisu i verdiktu.
  //
  // ⛔ ODVOZENÝ, NE ZACHOVANÝ (2026-09-15). Do té doby `placeholder` s hodnotou
  // z `generate-secrets` (`preservedValue`, výchozí `http://svc-knock:3017`) —
  // tedy HOLÉ jméno služby: na sdíleném hostiteli nárok bez vlastníka, a po
  // přesunu svc-knock do netns držitele se nepřeloží vůbec (změřeno lokálně).
  // Adresu dnes vydává derivace z deklarace dveří a identity instance
  // (lib/dvere-soulad.mjs knockUpstream). Bez `prodEnv`: zálohu drží ozvěnu staré
  // výchozí hodnoty a ta by derivaci přebila (táž třída jako GATEWAY_TRUSTED_PROXIES
  // výš — hodnota, která není rozhodnutí operátora, se ze zálohy nebere).
  ["KNOCK_UPSTREAM", "derived", TOPOLOGY_ENV.KNOCK_UPSTREAM ?? ""],
  // Roster SCHVÁLENÝCH tabletů pro dveře (2026-09-28, „zařízení musí umět samo
  // klepat, když je schválené"). Adresy odvozuje derivace z deklarace dveří:
  // jen OSTRÉ dveře (`knock.mode: live`) — měřicí režim roster z adresy odmítne
  // (svc-knock config.ts). Bez `prodEnv` ze stejného důvodu jako KNOCK_UPSTREAM.
  ["SPA_OPERATORS_URL", "derived", TOPOLOGY_ENV.SPA_OPERATORS_URL ?? ""],
  ["SPA_OPERATORS_VERSION_URL", "derived", TOPOLOGY_ENV.SPA_OPERATORS_VERSION_URL ?? ""],
  // Token dvojice dveře ↔ brána pro ten roster. Vlastní, ne INTERNAL_API_KEY.
  ["KNOCK_ROSTER_TOKEN", "secret", 32],
  // Zda se vrátný vůbec nasadí, ODVOZUJE profil instance (`edge_profiles`).
  // Není to tajemství ani volba operátora u konzole: je to vlastnost instance,
  // takže patří do derivace vedle domén — a doctor ji tím umí doplnit, když se
  // z .env.coolify ztratí. Platformní šablony ji nemají ⇒ prázdno ⇒ dveře se
  // nenasadí.
  ["EDGE_COMPOSE_PROFILES", "derived", derivedTopo("EDGE_COMPOSE_PROFILES")],
  // Rezidence dat AI — deklaruje ji profil instance (`ai.execution_mode`),
  // derivace ji vydá. Není to tajemství ani volba u konzole: je to vlastnost
  // instance. Prázdná = profil ji nedeklaroval → ai-chat compose odmítne start.
  ["AISHA_EXECUTION_MODE", "derived", derivedTopo("AISHA_EXECUTION_MODE")],
  // Token JEN pro čtení balíčků registru, ze kterého si storage-auth doplní APK
  // (deklarace `zdroj`, 2026-09-24). Vydává ho správce registru, ne generátor —
  // `external`. Prázdný = doplnění ze zdroje, který token chce, selže nahlas.
  ["ZARIZENI_ZDROJ_TOKEN", "external"],
  // Roster operátorů je PII a vydává ho správa uživatelů, ne generátor tajemství.
  // `external` = doctor ho očekává, ale nevymýšlí; prázdný znamená, že dveře
  // nenastartují a řeknou, co chybí.
  // SPA_* jsou POLITIKY, ne tajemství. Compose je bere jako `${VAR:-}` —
  // prázdno je výslovně povolené a znamená „nic nad rámec výchozího", což je
  // bezpečná strana. Kontrakt je vyžadoval jako operátorský vstup a tím
  // blokoval nasazení instancí, které žádnou výjimku nechtějí.
  ["SPA_OPERATORS_B64", "placeholder"],
  // Záchranná cesta (K4): adresy, které platí i bez mapy. Prázdné je legitimní
  // — ale pak neexistuje cesta dovnitř, když je úložiště dole.
  ["SPA_STATIC_ALLOW", "placeholder"],
  ["SPA_BLACKLIST", "placeholder"],

  // ── RabbitMQ ──────────────────────────────────────────────────────────────
  ["RABBITMQ_DEFAULT_USER", "static", "aisha"],
  ["RABBITMQ_DEFAULT_PASS", "secret", 32],
  ["RABBITMQ_USER", "alias", "RABBITMQ_DEFAULT_USER"],
  ["RABBITMQ_PASS", "alias", "RABBITMQ_DEFAULT_PASS"],
  // Adresa i port ODVOZENÉ z katalogu (integration.internal_tcp_endpoints) —
  // ⛔ do 2026-09-17 `static`: RABBITMQ_HOST=backend.<mesh> (jméno bez peeru) a
  // RABBITMQ_PORT=5673 (host port). Host port na sdíleném hostiteli kolidoval
  // s jinou instancí a vedl mimo edge; `static` navíc drift neopraví nikdy.
  ["RABBITMQ_HOST", "derived", derivedTopo("RABBITMQ_HOST")],
  ["RABBITMQ_PORT", "derived", derivedTopo("RABBITMQ_PORT")],

  // ── LiveKit ───────────────────────────────────────────────────────────────
  ["LIVEKIT_API_KEY", "alias-prefix", "API", "INTERNAL_API_KEY"],
  ["LIVEKIT_API_SECRET", "secret", 48],
  ["LIVEKIT_TURN_PASSWORD", "secret", 24],
  ["LIVEKIT_TURN_USER", "static", "aisha"],
  ["LIVEKIT_DOMAIN", "static", dom("LIVEKIT_DOMAIN")],
  ["LIVEKIT_LOG_LEVEL", "static", "info"],
  ["LIVEKIT_WEBHOOK_URL", "static", dom("LIVEKIT_WEBHOOK_URL")],
  // Veřejné porty RTC a TURN — TÁŽ TŘÍDA jako SPA_KNOCK_PUBLIC_PORT: ruční
  // deklarace operátora, žádný literál. Compose livekitu je nese `:?`, takže
  // instance s livekitem bez deklarace spadne HLASITĚ při interpolaci (dřív
  // tiše obsadila 7882/3478/5349 — naměřeno 2026-08-12, sdílený server).
  ["LIVEKIT_RTC_PORT", "static", ""],
  ["TURN_PORT", "static", ""],
  ["TURN_TLS_PORT", "static", ""],
  // Forwarder mesh DNS — resolver SÍTĚ SERVERŮ, ruční deklarace operátora (lib/dns-forwarder.mjs).
  // Dřív se bral z /etc/resolv.conf stroje, odkud se nasazuje (naměřeno 2026-09-16:
  // notebook na hotspotu = fe80::…%en0); žádný literál, žádné odvození ze stanice.
  ["NETBIRD_DNS_FORWARD_IP", "static", ""],
  // Veřejné tváře aplikací mimo katalog — ruční deklarace operátora
  // (`<subdomain>=<container>:<port>@<via>, …`, viz deriveExternalFaces).
  // Prázdno = žádné; derivace z ní skládá trasu, edge i mesh DNS.
  ["EXTERNAL_FACES", "static", ""],

  // ── Matrix / Synapse ──────────────────────────────────────────────────────
  ["MATRIX_REGISTRATION_SHARED_SECRET", "secret", 32],
  // HMAC nahrávacích tokenů storage-auth (lib/nahravaci-token.ts).
  ["STORAGE_UPLOAD_TOKEN_SECRET", "secret", 48],
  ["MATRIX_MACAROON_SECRET_KEY", "secret", 32],
  ["MATRIX_FORM_SECRET", "secret", 32],
  ["MATRIX_WEBHOOK_URL", "static", dom("MATRIX_WEBHOOK_URL")],
  ["SYNAPSE_DB_PASSWORD", "secret", 32],
  ["SYNAPSE_OIDC_CLIENT_SECRET", "secret", 32],
  ["SYNAPSE_SERVER_NAME", "static", dom("SYNAPSE_SERVER_NAME")],
  ["SYNAPSE_FORM_SECRET", "alias", "MATRIX_FORM_SECRET"],
  ["SYNAPSE_MACAROON_SECRET", "alias", "MATRIX_MACAROON_SECRET_KEY"],
  ["SYNAPSE_REGISTRATION_SECRET", "alias", "MATRIX_REGISTRATION_SHARED_SECRET"],

  // ── Realtime / Logflare ───────────────────────────────────────────────────
  ["REALTIME_SECRET_KEY_BASE", "hex", 64],
  ["LOGFLARE_API_KEY", "secret", 24],

  // ── Ragnarok / Elasticsearch / Insight (Maestro + kronos-shim) ────────────
  ["RAGNAROK_API_KEY", "secret", 32],
  // ⛔ Bylo `["RAGNAROK_URL", "static", dom("RAGNAROK_URL")]` — hodnota se brala
  // ze ŠABLONY. Ta ji ale skládala z `${INTEGRATION_MESH_HOST}`, který se NIKDY
  // nedoručoval, takže jeho fallback BYL hodnotou ve 100 % běhů — a měl špatný
  // tvar (bez prefixu instance). Nasazení proto u KAŽDÉHO běhu hlásilo rozpor
  // mezi šablonou a SoT; rada z toho varování („doplň do OWNED_COMPOSITES") by
  // správnou hodnotu PŘEPSALA tou špatnou.
  //
  // Odvodit ji nelze: derivace staví mesh jména z VEŘEJNÉ TVÁŘE služby
  // (`edgeMeshHost`), a Ragnarok je vnitřní — veřejnou tvář nemá. Je to
  // vlastnost NASAZENÍ. Hodnotu drží `emit(preservedValue(...))`, aby přežila
  // wipe; doctor ji jen ZNÁ, aby ji nehlásil jako překlep.
  ["RAGNAROK_URL", "placeholder"],
  ["ELASTIC_PASSWORD", "secret", 32],
  // KRONOS_API_KEY = shared secret mezi Maestro a aisha-kronos-shim (oba in-stack).
  // Shim emuluje upstream Kronos; tento klíč autentikuje. Self-contained, on-site ready.
  ["KRONOS_API_KEY", "secret", 32],
  // Insight default jazyk — cs-CZ je AISHA primary; přepiš v .env-prod-backup pro multi-locale.
  ["INSIGHT_DEFAULT_LANG", "static", "cs-CZ"],
  // Insight → LLM brána. Compose má `${INSIGHT_OPENAI_ENDPOINT:?}`, takže PRÁZDNÁ
  // hodnota shodí interpolaci celého integration stacku — a přesně to se stalo
  // 2026-08-08 při from-zero nasazení: klíč v CONTRACTu nebyl, .env.coolify ho
  // nenesl a `docker compose config` skončil na „required variable … is missing".
  // Odvozuje se z AISHA_LLM_GATEWAY_URL (adresa brány je instanční, proto se
  // NESKLÁDÁ tady z aliasu, ale PŘEBÍRÁ z už odvozené hodnoty) + cesta /v1,
  // kterou OpenAI-kompatibilní klient očekává.
  ["INSIGHT_OPENAI_ENDPOINT", "template", "${AISHA_LLM_GATEWAY_URL}/v1"],
  // Cohere rerank — optional external. Bez klíče reranking off (vector-only retrieval).
  ["COHERE_API_KEY", "external"],

  // ── Cosmos / chain ────────────────────────────────────────────────────────
  ["COSMOS_VALIDATOR_PASSWORD", "secret", 24],
  ["CHAIN_ID", "static", "aisha-1"],
  ["MONIKER", "static", "aisha-validator"],

  // ── S3 / MinIO ────────────────────────────────────────────────────────────
  ["MINIO_ROOT_USER", "static", "aisha-minio-admin"],
  ["MINIO_ROOT_PASSWORD", "secret", 32],
  ["S3_ACCESS_KEY", "alias", "MINIO_ROOT_USER"],
  ["S3_SECRET_KEY", "alias", "MINIO_ROOT_PASSWORD"],
  // Holé `minio` je na sdílené síti `coolify` globální nárok — živě tam sedí
  // víc kontejnerů téhož jména od různých nájemníků. Adresa nese identitu.
  // Bez identity se NEODVODÍ — `http://-minio:9000` je hostitel, který neexistuje.
  ["S3_ENDPOINT", "static", IDENTITY ? `http://${IDENTITY}-minio:9000` : ""],
  ["S3_REGION", "static", "eu-central"],
  ["S3_PLUGIN_BUCKET", "static", "aisha-plugins"],

  // ── ClickHouse (Langfuse analytics) ───────────────────────────────────────
  ["CLICKHOUSE_USER", "static", "clickhouse"],
  ["CLICKHOUSE_PASSWORD", "secret", 32],

  // ── Grafana + Postgres Exporter (Phase 12 WP 0.2 / WP 2.4) ──────────────
  // GRAFANA_ADMIN_PASSWORD: Grafana UI admin login (GF_SECURITY_ADMIN_PASSWORD).
  // POSTGRES_EXPORTER_PASSWORD: login for the postgres_exporter DB role created
  //   in migration 20260521010000_pg_extensions_audit_and_perf.sql.
  //   Applied to the DB role via infra/postgres/set-passwords.sh at first boot.
  ["GRAFANA_ADMIN_PASSWORD", "secret", 24],
  ["POSTGRES_EXPORTER_PASSWORD", "secret", 32],

  // ── NocoDB ────────────────────────────────────────────────────────────────
  ["NOCODB_DB_PASSWORD", "alias", "POSTGRES_PASSWORD"],
  ["NOCODB_JWT_SECRET", "secret", 48],
  ["NOCODB_OIDC_SECRET", "secret", 32],
  // Super-admin bootstrap: NC_ADMIN_EMAIL + NC_ADMIN_PASSWORD pre-creates the
  // NocoDB super admin so the public setup page (which would let any
  // OIDC-auth'd admin/staff user become super admin) is never reachable.
  ["NOCODB_ADMIN_EMAIL", "static", "admin@example.com"],
  ["NOCODB_ADMIN_PASSWORD", "secret", 24],
  ["NOCODB_DOMAIN", "static", dom("NOCODB_DOMAIN")],

  // ── Appsmith ──────────────────────────────────────────────────────────────
  ["APPSMITH_OIDC_SECRET", "secret", 32],
  // Intranet uses same Appsmith CE via second OAuth2 Proxy (different KC client
  // appsmith-intranet-proxy with broader allowed groups). Without this,
  // intranet-auth container fails: "missing setting: client-secret".
  ["APPSMITH_INTRANET_OIDC_SECRET", "secret", 32],
  ["APPSMITH_ENCRYPTION_PASSWORD", "secret", 32],
  ["APPSMITH_ENCRYPTION_SALT", "hex", 16],
  // Admin login for the Appsmith CE instance — required (fail-fast) by
  // provision-appsmith.sh + provision-intranet.sh; generated by generate-secrets.
  ["APPSMITH_ADMIN_EMAIL", "alias", "LANGFUSE_ADMIN_EMAIL"],
  ["APPSMITH_ADMIN_PASSWORD", "secret", 24],
  ["APPSMITH_DOMAIN", "static", dom("APPSMITH_DOMAIN")],
  ["INTRANET_DOMAIN", "static", dom("INTRANET_DOMAIN")],

  // ── PKI (OpenXPKI) ────────────────────────────────────────────────────────
  ["PKI_DB_ROOT_PASSWORD", "secret", 24],
  ["PKI_DB_PASSWORD", "secret", 24],
  ["PKI_SVAULT_KEY", "hex", 32],
  // PKI_DEFAULT_SECRET — OpenXPKI keystore wrap key (must be hex 32). Compose
  // FATAL-exits if missing. Added 2026-05-26 after iter 22 cold-start traced
  // a heredoc-truncation bug that dropped this key from .env.coolify (root
  // cause was an unset INSIGHT_OPENAI_ENDPOINT — kept this in env-doctor as
  // a defense-in-depth re-add path so any future heredoc breakage doesn't
  // silently break OpenXPKI deploy).
  ["PKI_DEFAULT_SECRET", "hex", 32],
  ["PKI_OIDC_SECRET", "secret", 32],
  ["PKI_COOKIE_SECRET", "hex", 16],
  ["PKI_CLIENT_KEY_B64", "placeholder"], // generated by openxpki init
  ["PKI_DOMAIN", "static", dom("PKI_DOMAIN")],
  // PKI RPC HMAC — shared secret between OpenXPKI RPC and pki-bridge.
  // The compose FATAL-exits if this is missing (explicitly checked in entrypoint).
  ["OPENXPKI_RPC_HMAC", "secret", 32],
  // OpenXPKI WebUI/operator login. We generate the PLAINTEXT here (portable);
  // pki-init hashes it in-container (openssl passwd -5) into the handler.yaml
  // digest. Registering it makes --wipe fully automatic — no manual hash push,
  // no host-side crypt (closes the 2026-07-13 pki-init "digest unset" FATAL).
  ["OPENXPKI_OPERATOR_PASSWORD", "secret", 24],
  // PKI bootstrap service account (Keycloak client for cert issuance flow).
  // Client is created by aisha-bootstrap-user-init.sh; these are its creds.
  ["PKI_BOOTSTRAP_CLIENT_ID", "static", "aisha-pki-bootstrap"],
  ["PKI_BOOTSTRAP_USERNAME", "static", "aisha-pki-bootstrap"],
  ["PKI_BOOTSTRAP_CLIENT_SECRET", "alias", "AISHA_PKI_BOOTSTRAP_CLIENT_SECRET"],
  ["PKI_BOOTSTRAP_PASSWORD", "alias", "AISHA_PKI_BOOTSTRAP_PASSWORD"],
  // ⛔ NAMĚŘENO 2026-08-26: dvojče `AISHA_PKI_BOOTSTRAP_*` v registru BYLO,
  // původní `AISHA_BOOTSTRAP_*` NE — a právě proto ho `vault-drift-doctor`
  // neuměl posoudit, když si trezor držel mrtvý secret a `netbird-peer-discover`
  // dostával 401 unauthorized_client. Registr je univerzum té brány; klíč,
  // který v něm chybí, není „v pořádku", jen NEVIDITELNÝ.
  //
  // ⛔ ZMĚNA SMĚRU TOKU 2026-09-05: `secret` (dřív `placeholder`).
  //
  // Do teď hodnotu VYDÁVAL Keycloak a `aisha-bootstrap-user-init.sh` si ji
  // chodil VYZVEDNOUT — a právě proto potřeboval na Keycloak dosáhnout dřív,
  // než existuje mesh i edge. Na instanci za NAT to nejde: veřejná trasa vede
  // přes edge, edge čeká na CORE_MESH_IP, ten na discovery a discovery právě
  // na tenhle secret. Kruh se zavíral a cold-start ho lámal SSH tunelem do
  // hostitele (`AISHA_KC_SSH_HOST`) — tedy tím, že STACK lezl na cizí stroj.
  //
  // Nově hodnotu PŘEDGENERUJEME a realm si ji při importu PŘEVEZME
  // (`"secret": "${AISHA_BOOTSTRAP_CLIENT_SECRET}"` v keycloak/aisha-realm.json).
  // Není to nový vzor: jedenáct klientů realmu ho už používá (netbird-backend,
  // aisha-pki-issuer, všechny *-proxy). Bootstrap dvojice byla poslední, která
  // ho neměla — dokončuje se tím migrace z 2026-08-30 („realm se dorodí uvnitř,
  // operátorský krok se mění z PODMÍNKY na ověření").
  //
  // Obava „dva zapisovatelé" tím MIZÍ, ne roste: zapisovatel je nově jeden
  // (my), kdežto dřív psal KC a přepisoval skript.
  ["AISHA_BOOTSTRAP_CLIENT_SECRET", "secret", 32],
  // Heslo naopak vyrábíme MY (skript: „32-char random if not already set"),
  // takže stejný model jako u PKI dvojčete o řádek níž.
  ["AISHA_BOOTSTRAP_PASSWORD", "secret", 32],
  ["AISHA_PKI_BOOTSTRAP_CLIENT_SECRET", "secret", 32],
  ["AISHA_PKI_BOOTSTRAP_PASSWORD", "secret", 24],
  // aisha-pki-issuer service-account client secret — real value is fetched from
  // Keycloak by aisha-bootstrap-user-init.sh and PATCHed onto aisha-pki; this
  // registration keeps it contract-covered (the renewer consumes it).
  ["AISHA_PKI_ISSUER_CLIENT_SECRET", "secret", 32],
  // PKI bridge internal URL — topology-aware. derive-domains emits
  // PKI_BRIDGE_URL=http://pki-bridge:3040 ONLY when netbird+pki are co-located
  // (same resolved node), so topo() wins there; on a split fleet it emits nothing
  // and we fall through to domains.env's https://${PKI_BRIDGE_DOMAIN} (public
  // Backend Traefik). Was dom()-only, which forced the internal-TLD https host
  // even co-located — unresolvable + cert-less during bootstrap (the netbird
  // mesh-cert deadlock).
  // svc-source-broker's public face (traefik Host rule in its compose). NOT
  // "required-static": the broker is opt-in, so the resolver emits this only
  // when one of its lanes is armed and every other instance would fail a hard
  // requirement for a service it never asked for. Presence IS enforced where it
  // belongs — the per-app validator demands a compose's ${VAR} refs only for
  // apps this deployment actually provisions (_unprovisioned_services() in
  // scripts/lib/coolify-app-vars.sh). Until 2026-07-20 the key was in neither
  // place: the resolver derived it, nothing carried it to .env.coolify, and it
  // surfaced only when the broker was first genuinely provisioned.
  ["BROKER_DOMAIN", "static", topo("BROKER_DOMAIN")],
  ["PKI_BRIDGE_DOMAIN", "required-static", topo("PKI_BRIDGE_DOMAIN")],
  ["PKI_BRIDGE_URL", "derived", derivedTopo("PKI_BRIDGE_URL") || dom("PKI_BRIDGE_URL")],
  // PKI_BUNDLE_REQUIRED — 18 compose čte `${PKI_BUNDLE_REQUIRED:?}` (pki-init:
  // bez nasazené PKI se POŽADAVEK na CA bundle vypíná, jinak čeká 600 s a shodí
  // core). ⛔ NAMĚŘENO 2026-09-12: hodnotu odvozoval a zapisoval JEN heredoc
  // cold-startu; instance nasazené z base fcd9156c1 (compose `:-true`, heredoc
  // klíč nepsal) ho v Coolify env nemají a `npm run redeploy` ho nedoručí —
  // env-sync posílá jen to, co v .env.coolify leží, a na cestě redeploye do SoT
  // zapisuje jedině tenhle doktor (aisha-redeploy.mjs `srovnejOdvozeneKlice`).
  // Odvození má JEDEN domov (scripts/lib/derive-pki-bundle-required.mjs), volá
  // ho cold-start i tohle místo; operátorský pin v .env-prod-backup vyhrává
  // jako u každého derived. Bez nalezitelného manifestu (CI bez identity) je
  // odpověď PRÁZDNO — „nevím", ne dosazené `false`; doktor to vypíše mezi
  // „Odvozené a PRÁZDNÉ", tj. viditelně, ne tiše.
  ["PKI_BUNDLE_REQUIRED", "derived", prodEnv("PKI_BUNDLE_REQUIRED") || pkiBundleRequiredNeboPrazdno()],
  // KEYCLOAK_INTERNAL_URL — derivace ho vydává s kolokační větví od 2026-07-20,
  // ale NIKDO ho nedoručoval: chyběl v tomhle kontraktu, takže se nedostal do
  // .env.coolify ani na apky. Pět compose souborů proto drželo literál
  // http://aisha-keycloak:80 — na jednom uzlu správně, na rozdělené farmě
  // NEDOSAŽITELNÉ (`aisha-keycloak` je alias sdílené docker sítě jednoho hostu).
  // Registrací se z odvozené hodnoty stane doručená.
  ["KEYCLOAK_INTERNAL_URL", "derived", derivedTopo("KEYCLOAK_INTERNAL_URL")],

  // ── NetBird control plane ─────────────────────────────────────────────────
  ["NETBIRD_DOMAIN", "static", dom("NETBIRD_DOMAIN")],
  ["NETBIRD_OIDC_CLIENT_ID", "static", "netbird"],
  ["NETBIRD_OIDC_SECRET", "secret", 32],
  ["NETBIRD_MGMT_SECRET", "secret", 32],
  ["NETBIRD_RELAY_SECRET", "secret", 32],
  // NETBIRD_DATASTORE_ENC_KEY — Go-StdEncoding base64 (24-byte key → 32 chars).
  // Required for management.json datastore encryption. Added 2026-05-26 after
  // iter 22 heredoc-truncation bug (see PKI_DEFAULT_SECRET note above).
  ["NETBIRD_DATASTORE_ENC_KEY", "b64std", 24],
  ["NETBIRD_DB_PASSWORD", "secret", 32],
  ["NETBIRD_TURN_USERNAME", "static", "netbird-turn"],
  ["NETBIRD_TURN_PASSWORD", "secret", 24],
  ["NETBIRD_API_URL", "static", dom("NETBIRD_API_URL")],
  ["NETBIRD_AUTH_SCHEME", "static", "Bearer"],
  ["NETBIRD_SANDBOX_GROUP", "static", "sandbox-run"],
  ["NETBIRD_DNS_IP", "static", "127.0.0.11"],

  // ── Modelový mesh forku (varianta C) ──────────────────────────────────────
  // Druhá instance stacku NetBird (docker-compose.coolify-netbird-model.yml).
  // Tajemství vydává generate-secrets (cold-start) i doktor: řídicí rovina
  // modelového meshe přibývá i k EXISTUJÍCÍ instanci (model přesunutý na GPU slot)
  // a na cestě redeploye do .env.coolify zapisuje jen doktor. Svazky nového stacku
  // v té chvíli neexistují, takže vyrobit chybějící hodnotu je bezpečné; jednou
  // zapsanou hodnotu doktor (jako každé `secret`) už nepřepíše a konvergence ji
  // pak jen zachová.
  // Bez STUN/TURN (v1 jen relay TCP 443) — TURN klíče proto nemá.
  ["NETBIRD_MODEL_OIDC_CLIENT_ID", "static", "netbird-model"],
  ["NETBIRD_MODEL_OIDC_SECRET", "secret", 32],
  ["NETBIRD_MODEL_MGMT_SECRET", "secret", 32],
  ["NETBIRD_MODEL_RELAY_SECRET", "secret", 32],
  ["NETBIRD_MODEL_DATASTORE_ENC_KEY", "b64std", 24],
  ["NETBIRD_MODEL_DB_PASSWORD", "secret", 32],
  // Tajemství KC klienta `netbird-model-bootstrap` (token jen s audiencí modelového meshe).
  ["NETBIRD_MODEL_BOOTSTRAP_SECRET", "secret", 32],
  // Rozsah peerů — edge-proxy si přes něj staví routu do mesh. Jediný domov
  // hodnoty je derive-subnets; tady se jen deklaruje, že se doručuje.
  ["NETBIRD_PEER_CIDR", "static", NETBIRD_PEER_CIDR],
  // Adresy NAŠICH peerů. Plní je jiný nástroj (`aisha-redeploy.mjs` po volání
  // netbird-peer-discover), proto `placeholder` a ne `external`: než mesh vůbec
  // vznikne, je prázdno ČEKANÝ stav, ne vada. Kdyby to bylo `external`, strict
  // preflight by odmítl každý cold-start před vlnou mesh warmupu.
  ["MESH_PEER_IPS", "placeholder"],
  // Seznam našich prvků pro chůzi `x-forwarded-for`. ODVOZUJE se z peerů výš —
  // nesmí to být konstanta: rozsah, ve kterém peeři LEŽÍ (100.64.0.0/10), je
  // CGNAT operátorů, takže by se důvěřovalo i mobilům. Viz derive-subnets.
  ["GATEWAY_TRUSTED_PROXIES", "derived", gatewayTrustedProxies(meshPeerIps())],
  // NETBIRD_ENABLED FOLLOWS the mesh switch — it is not an independent flag.
  // A hardcoded `true` deployed the netbird stack even on MESH_ENABLED=false
  // installs, where its agents have no control plane to enrol into: they come up
  // and stay `unhealthy` forever, dragging every app that carries a netbird
  // sidecar to `running:unhealthy` (verified 2026-07-19 — the whole stack read
  // as broken while every real service was healthy). Derived from the same
  // topology value MESH_ENABLED itself uses below, so the two can never drift.
  // Fail-safe default: no topology ⇒ no mesh ⇒ do not deploy netbird.
  ["NETBIRD_ENABLED", "static", topo("MESH_ENABLED") ?? "false"],
  // Frontend host address — used by extra_hosts in cosmos + integration
  // composes for `netbird.mesh.aisha.internal` resolution from Backend/Experimental
  // before mesh is up. Cold-start preflight (cold-start-doctor.sh) fails
  // without this. Default = Docker's `host-gateway` magic value (single-host);
  // multi-server operators override NETBIRD_MGMT_HOST with the Frontend host's
  // LAN IP in their environment (never committed — no infra addresses in repo).
  ["NETBIRD_MGMT_HOST", "static", "host-gateway"],
  // Most modelového meshe (C4): kam z hostitele forku míří VEŘEJNÉ jméno řídicí
  // roviny modelového meshe — uzel edge (slot s has_traefik). Jednouzlová instalace
  // = host-gateway; cold-start dosadí zjištěnou adresu (PUBLIC_EDGE_HOST_ADDR) jako
  // u NETBIRD_MGMT_HOST. Bez ní by agent mostu spoléhal na hairpin routeru.
  ["MODEL_MESH_VSTUP_ADDR", "static", "host-gateway"],
  ["NETBIRD_MESH_HOST", "static", dom("NETBIRD_MESH_HOST")],
  ["NETBIRD_API_TOKEN", "external"], // PAT from netbird dashboard
  // Setup keys: filled by netbird-bootstrap.sh after netbird control plane is up.
  ["NETBIRD_STACK_KEY_FRONTEND", "placeholder"],
  ["NETBIRD_STACK_KEY_BACKEND", "placeholder"],
  // Modelový mesh: jednorázový klíč mostu a IP uzlu na GPU slotu — zapisuje
  // netbird-bootstrap.sh (NETBIRD_INSTANCE=model), doručuje se jen aplikaci mostu.
  ["MODEL_MESH_MOST_SETUP_KEY", "placeholder"],
  ["MODEL_MESH_GPU_PEER_IP", "placeholder"],
  ["NETBIRD_STACK_KEY_INTEGRATION", "placeholder"],
  ["NETBIRD_STACK_KEY_EXPERIMENTAL", "placeholder"],
  // Identifikátor patří ke klíči; deklaruje se stejně, aby ho kontrakt
  // nepovažoval za cizí a nezahodil při doplňování.
  ["NETBIRD_STACK_KEY_FRONTEND_ID", "placeholder"],
  ["NETBIRD_STACK_KEY_BACKEND_ID", "placeholder"],
  ["NETBIRD_STACK_KEY_INTEGRATION_ID", "placeholder"],
  ["NETBIRD_STACK_KEY_EXPERIMENTAL_ID", "placeholder"],

  // ── TURN ──────────────────────────────────────────────────────────────────
  ["TURN_REALM", "static", dom("TURN_REALM")],
  ["TURN_DOMAIN", "static", dom("TURN_DOMAIN")],

  // ── Extranet (oauth2-proxy před povrchem) ────────────────────────────────
  // Bez těchhle dvou se sidecar ani nespustí, a tím pádem se extranet vůbec
  // nezveřejní — compose je proto má bez `:-` výchozí hodnoty. Tvary jsou
  // stejné jako u ostatních proxy: secret(32) pro klienta, hex(16) na cookie.
  ["EXTRANET_OIDC_SECRET", "secret", 32],
  ["EXTRANET_COOKIE_SECRET", "hex", 16],
  // Vlajka brány. Cold-start ji zapisuje, ale to pokrývá jen ČERSTVÉ
  // instalace — běžící instance by ji neměla, compose by spadl na
  // `${EXTRANET_AUTH_GATE:-0}` a brána by zůstala vypnutá. Nasazení by pak
  // proběhlo zeleně a neudělalo nic. Doktor je kanál pro už běžící instalaci.
  // Hodnota 1 shodná s výchozí hodnotou cold-startu: otevřený povrch nemá být
  // tichá výchozí hodnota.
  ["EXTRANET_AUTH_GATE", "static", "1"],

  // ── Studio (pgAdmin) ──────────────────────────────────────────────────────
  ["STUDIO_OIDC_SECRET", "secret", 32],
  ["STUDIO_COOKIE_SECRET", "hex", 16],
  ["STUDIO_DOMAIN", "static", dom("STUDIO_DOMAIN")],
  // Direct Studio domain (no edge proxy) — set by operator for stacks that
  // expose pgadmin/Studio behind a dedicated DNS record.
  ["STUDIO_DOMAIN_DIRECT", "external", ""],
  ["PGADMIN_EMAIL", "external", ""],
  ["PGADMIN_PASSWORD", "secret", 24],

  // ── OAuth2 proxy cookies ──────────────────────────────────────────────────
  ["OAUTH2_PROXY_COOKIE_SECRET", "hex", 16],
  // Cookie/whitelist domains are topology-derived. Operator env still wins in
  // derive-domains, but env-doctor must not classify these as external because
  // external entries are not written as placeholders and compose validation
  // requires the keys to exist in .env.coolify.
  ["OAUTH2_COOKIE_DOMAINS_FRONTEND", "required-static", topo("OAUTH2_COOKIE_DOMAINS_FRONTEND")],
  ["OAUTH2_COOKIE_DOMAINS", "required-static", topo("OAUTH2_COOKIE_DOMAINS")],
  ["OAUTH2_WHITELIST_DOMAINS", "required-static", topo("OAUTH2_WHITELIST_DOMAINS")],

  // ── Domains (${PUBLIC_TLD}) ──────────────────────────────────────────────────
  ["APP_DOMAIN", "static", dom("APP_DOMAIN")],
  ["API_DOMAIN", "static", dom("API_DOMAIN")],
  ["API_DOMAIN_PUBLIC", "required-static", topo("API_DOMAIN_PUBLIC")],
  ["MCP_DOMAIN", "required-static", topo("MCP_DOMAIN")],
  ["DIRIGENT_DOMAIN", "required-static", topo("DIRIGENT_DOMAIN")],
  // Apex routing mode is topology-derived. redirect = edge-proxy 308 →
  // APP_DOMAIN; serve = apex is assigned to the web app and DB
  // branding_hostname_mapping resolves the GrapesJS page.
  ["AISHA_WEB_APEX_MODE", "required-static", topo("AISHA_WEB_APEX_MODE")],
  // Optional public web aliases under PUBLIC_TLD (for example "corp"). Values
  // are operator data, not open-code brand routes; if supplied in env /
  // .env-prod-backup they must survive into .env.coolify so domain-doctor and
  // coolify-deploy-init can bind those hosts to the web container.
  [
    "AISHA_WEB_PUBLIC_ALIASES",
    "static",
    process.env.AISHA_WEB_PUBLIC_ALIASES || prodEnv("AISHA_WEB_PUBLIC_ALIASES"),
  ],
  // Seznam značek webu z doménového overlaye instance (viz WEB_DEKLARACE výš).
  // Čte ho doktor domén a deploy-init přes lib/domeny-webu.mjs; „nevím" se nezapíše.
  ["WEB_FQDNS", "derived", WEB_DEKLARACE.znamo ? WEB_DEKLARACE.hodnota : ""],
  // Apex routed by edge-proxy only in redirect mode. Resolver-derived:
  // PUBLIC_TLD when the apex redirect applies, else the unroutable sentinel
  // apex-redirect-disabled.invalid (router exists, never matches).
  ["EDGE_APEX_DOMAIN", "required-static", topo("EDGE_APEX_DOMAIN")],
  ["PUBLIC_TLD", "required-static", topo("PUBLIC_TLD")],
  ["INTERNAL_TLD", "required-static", topo("INTERNAL_TLD")],
  ["MESH_TLD", "required-static", topo("MESH_TLD")],
  ["MESH_ENABLED", "required-static", topo("MESH_ENABLED")],
  ["API_UPSTREAM", "placeholder"],
  ["MCP_UPSTREAM", "placeholder"],
  ["DIRIGENT_UPSTREAM", "placeholder"],
  ["AUTH_UPSTREAM", "placeholder"],
  ["MCP_UPSTREAM_PUBLIC", "derived", derivedTopo("MCP_UPSTREAM_PUBLIC")],
  ["API_UPSTREAM_PUBLIC", "derived", derivedTopo("API_UPSTREAM_PUBLIC")],
  ["DIRIGENT_UPSTREAM_PUBLIC", "derived", derivedTopo("DIRIGENT_UPSTREAM_PUBLIC")],
  ["AUTH_UPSTREAM_PUBLIC", "derived", derivedTopo("AUTH_UPSTREAM_PUBLIC")],
  ["MCP_UPSTREAM_MESH", "derived", derivedTopo("MCP_UPSTREAM_MESH")],
  ["API_UPSTREAM_MESH", "derived", derivedTopo("API_UPSTREAM_MESH")],
  ["DIRIGENT_UPSTREAM_MESH", "derived", derivedTopo("DIRIGENT_UPSTREAM_MESH")],
  ["AUTH_UPSTREAM_MESH", "derived", derivedTopo("AUTH_UPSTREAM_MESH")],
  // Doplněno 2026-08-31: broker tudy TLAČÍ doklady do ingestu (push lane).
  // derive-domains ho vydává od začátku (`INGEST_UPSTREAM_MESH`), ale
  // v kontraktu chyběl — a compose s `:?` ho vyžaduje, takže brána
  // env-doctor-contract-coverage právem zastavila push.
  ["INGEST_UPSTREAM_MESH", "derived", derivedTopo("INGEST_UPSTREAM_MESH")],
  // Mesh cíl web-renderu pro web (předrender po síti, d-ii — web má vlastní routu).
  ["WEB_RENDER_UPSTREAM_MESH", "derived", derivedTopo("WEB_RENDER_UPSTREAM_MESH")],
  ["MATRIX_DOMAIN", "static", dom("MATRIX_DOMAIN")],
  ["ELEMENT_DOMAIN", "static", dom("ELEMENT_DOMAIN")],
  ["ELEMENT_CALL_DOMAIN", "static", dom("ELEMENT_CALL_DOMAIN")],
  ["REGISTRY_DOMAIN", "static", dom("REGISTRY_DOMAIN")],
  ["DOZZLE_DOMAIN", "static", dom("DOZZLE_DOMAIN")],
  ["PUBLIC_SITE_URL", "static", dom("PUBLIC_SITE_URL")],
  ["VITE_PUBLIC_SITE_URL", "static", dom("VITE_PUBLIC_SITE_URL")],

  // ── VITE (build-time, web bundle) ─────────────────────────────────────────
  ["VITE_API_URL", "static", `https://${dom("API_DOMAIN_PUBLIC")}`],
  ["VITE_AISHA_BACKEND_URL", "static", `https://${dom("API_DOMAIN_PUBLIC")}`],
  ["VITE_AISHA_BACKEND_ANON_KEY", "alias", "ANON_KEY"],
  ["VITE_AISHA_BACKEND_PUBLISHABLE_KEY", "alias", "ANON_KEY"],
  ["VITE_AISHA_GATEWAY_URL", "static", `https://${dom("API_DOMAIN_PUBLIC")}`],
  ["VITE_AISHA_GATEWAY_KEY", "alias", "ANON_KEY"],
  ["VITE_REQUIRE_AISHA_BACKEND_ENV", "static", "true"],
  ["VITE_KC_URL", "static", `https://${dom("AUTH_DOMAIN_PUBLIC")}`],
  ["VITE_KC_AUTHORITY", "static", `https://${dom("AUTH_DOMAIN_PUBLIC")}/realms/${process.env.KEYCLOAK_REALM ?? DOMAINS.KEYCLOAK_REALM ?? "aisha"}`],
  ["VITE_KC_CLIENT_ID", "static", "aisha-app"],
  ["VITE_AUTH_REDIRECT_URI", "static", dom("VITE_AUTH_REDIRECT_URI")],
  ["VITE_AUTH_POST_LOGOUT_URI", "static", dom("VITE_AUTH_POST_LOGOUT_URI")],
  ["VITE_SENTRY_DSN", "external"],
  // Web push (VAPID). RFC 8292: veřejný je nekomprimovaný bod 0x04||X||Y,
  // soukromý skalár d — a patří K SOBĚ. Proto nesou `VAPID_PAR` a doktor je
  // řeší naraz (`resolveVapidPar`), stejným posudkem jako generate-secrets.
  // ⛔ NAMĚŘENO 2026-09-23: dokud tu stálo `"secret", 65` / `"secret", 32`,
  // doktor u chybějícího klíče vyrobil NÁHODU — 65 bajtů, které nejsou bodem
  // křivky, a soukromý klíč, ke kterému nepatří. Prohlížeč se takovým klíčem
  // k odběru nepřihlásí a svc-push web push při startu vypne. Doktor to dnes
  // pozná a svou dřívější náhodu u veřejného klíče opraví odvozením.
  ["WEB_PUSH_VAPID_PUBLIC_KEY", "secret", VAPID_PAR],
  ["WEB_PUSH_VAPID_PRIVATE_KEY", "secret", VAPID_PAR],
  // Podle RFC 8292 musí být `mailto:` nebo https URL — poskytovatel podle něj
  // ví, komu se ozvat, když odesílatel zlobí.
  // Z VYŘEŠENÉ APP_DOMAIN (hodnota, kterou tenhle běh pro instanci má), ne z vlastní
  // složeniny: bez domény se výchozí hodnota nesloží a stráž ji jmenuje. Naměřeno
  // 2026-09-27 dry-runem nad trezorem instance: static `https://${dom("APP_DOMAIN")}`
  // chtěl zapsat `https://${APP_DOMAIN:-}` — dom() tehdy do derivace nesahal a sebeodkaz
  // v domains.env vracel syrovou šablonu (kořen opraven 2026-09-28, viz loadDomains/dom).
  // Deklarace operátora v .env-prod-backup (třeba `mailto:`) vyhrává.
  ["WEB_PUSH_VAPID_SUBJECT", "template-default", "https://${APP_DOMAIN}"],
  // JEDNA hodnota, JEDEN domov: plocha musí odebírat týmž veřejným klíčem, kterým
  // svc-push podepisuje. Vlastní kopie by se rozešla a push by tiše přestal chodit.
  ["VITE_WEB_PUSH_VAPID_PUBLIC_KEY", "alias", "WEB_PUSH_VAPID_PUBLIC_KEY"],

  // ── PostgREST / Storage / Auth env defaults ──────────────────────────────
  // kept so backend default-value pipelines stay consistent; auth itself is
  // Keycloak OIDC, no legacy auth runtime in the stack)
  ["PGRST_DB_SCHEMAS", "static", "public,storage,graphql_public"],
  ["PGRST_DB_POOL", "static", "20"],
  ["PGRST_DB_MAX_ROWS", "static", "1000"],
  ["STORAGE_FILE_SIZE_LIMIT", "static", "52428800"],
  ["STORAGE_REGION", "static", "eu-central"],
  ["IMGPROXY_ENABLE_WEBP_DETECTION", "static", "true"],
  ["IMGPROXY_KEY", "hex", 32],
  ["IMGPROXY_SALT", "hex", 32],
  ["DISABLE_SIGNUP", "static", "false"],
  ["ENABLE_EMAIL_SIGNUP", "static", "true"],
  ["ENABLE_EMAIL_AUTOCONFIRM", "static", "false"],
  ["ENABLE_ANONYMOUS_SIGN_INS", "static", "false"],
  ["ENABLE_PHONE_SIGNUP", "static", "false"],
  ["ENABLE_KEYCLOAK", "static", "true"],
  ["ENABLE_GOOGLE_OAUTH", "static", "true"],
  ["ENABLE_APPLE_OAUTH", "static", "true"],
  ["RATE_LIMIT_EMAIL_SENT", "static", "10"],
  ["ADDITIONAL_REDIRECT_URLS", "static", dom("ADDITIONAL_REDIRECT_URLS")],

  // ── Mailer subjects ───────────────────────────────────────────────────────
  ["MAILER_SUBJECTS_CONFIRMATION", "static", "Potvrďte registraci na AISHA"],
  ["MAILER_SUBJECTS_RECOVERY", "static", "Obnovení hesla AISHA"],
  ["MAILER_SUBJECTS_MAGIC_LINK", "static", "Přihlášení do AISHA"],
  ["MAILER_SUBJECTS_EMAIL_CHANGE", "static", "Změna emailu AISHA"],
  ["MAILER_SUBJECTS_INVITE", "static", "Pozvánka do AISHA"],

  // ── Studio defaults ───────────────────────────────────────────────────────
  // Identita provozovatele, ne konstanta: alias na AISHA_OPERATOR_ORG,
  // který emituje generate-secrets z operator-inputs (nebo odvodí ze
  // jmenného prostoru instance). Dřív tu stálo natvrdo "AISHA".
  ["STUDIO_DEFAULT_ORG", "alias", "AISHA_OPERATOR_ORG"],
  ["STUDIO_DEFAULT_PROJECT", "static", "production"],

  // ── Edge runtime ──────────────────────────────────────────────────────────
  ["EDGE_RUNTIME_MODE", "static", "oneshot"],
  ["EDGE_VERIFY_JWT", "static", "true"],
  ["ALLOWED_ORIGINS", "static", dom("ALLOWED_ORIGINS")],
  // Kam klient posílá obsah souboru: storage NA API (domains.env z API_DOMAIN_PUBLIC).
  // Presigned URL MinIA nese mesh host, na který telefon z terénu nedosáhne.
  // `derived`, ne `static` (2026-09-25): hodnota je čistá FUNKCE API_DOMAIN_PUBLIC.
  // Jako `static` ji apply zachoval i PRÁZDNOU — naměřeno na instanci, kde prázdný
  // řádek v trezoru přežil každý běh doktora a nahrávání z prohlížeče mířilo na
  // mesh host. Jiné rozhodnutí operátora patří do .env-prod-backup (dom() ho čte první).
  ["STORAGE_PUBLIC_URL", "derived", domZTopologie("STORAGE_PUBLIC_URL")],

  // ── Plugin / exec runtime ─────────────────────────────────────────────────
  // `derived`, ne `static` (2026-10-01): adresa je jméno v meshi z derivace topologie.
  // Jako `static` ji apply zachoval ZASTARALOU — naměřeno na instanci: uloženo
  // `backend.mesh…` (jméno před 2026-08-25), derivace `<prefix>-plugin-system.mesh…`;
  // runner pak brokeru nedosáhl a každý běh pluginu skončil exit 255. Jiné rozhodnutí
  // operátora patří do .env-prod-backup (derivedTopo() ho čte první). ⛔ derivedTopo,
  // ne holé dom(): dom() bere process.env dřív než derivaci, a ten nese hodnotu
  // z cílového souboru — drift by potvrdil sám sebe (naměřeno: apply nezměnil nic).
  ["PLUGIN_SYSTEM_URL", "derived", derivedTopo("PLUGIN_SYSTEM_URL") || dom("PLUGIN_SYSTEM_URL")],
  ["PLUGIN_BROKER_URL", "derived", derivedTopo("PLUGIN_BROKER_URL") || dom("PLUGIN_BROKER_URL")],
  ["AGENT_RUNNER_URL", "static", dom("AGENT_RUNNER_URL")],
  // Model claude_cli_task — viz modelBehuAgenta() (veřejná tvář ask.<tld> z topologie).
  ["ANTHROPIC_BASE_URL", "derived", modelBehuAgenta()],
  ["AGENT_RUNNER_ENABLED", "static", "true"],
  ["RUNNER_BACKEND", "static", "docker"],
  ["KATA_DEFAULT_RUNTIME", "static", "kata-dragonball"],
  ["DOCKER_API_VERSION", "static", "1.45"],
  ["EXEC_CPU_PERIOD", "static", "100000"],
  ["EXEC_CPU_QUOTA", "static", "50000"],
  ["EXEC_MEMORY_LIMIT", "static", "512m"],
  ["DEFAULT_TIMEOUT_MS", "static", "30000"],
  ["MAX_TIMEOUT_MS", "static", "300000"],
  ["LOG_LEVEL", "static", "info"],

  // Klíč modelu forku (VLLM_GENERATION_URL): lane na GPU ho vyžaduje u každého požadavku
  // a ověřuje proti otisku (sha256) v deklaraci uzlu. Vzniká TADY (secret — přibývá i
  // k existující instanci), doručuje se JEN volajícím modelu (svc-ai-chat, svc-mcp-knowledge;
  // K1). Jednou zapsaný se nepřepisuje: rotace = vědomý krok s novým otiskem u uzlu.
  // Compose ho nese jako `${VLLM_API_KEY:-}` — `:?` by ho vtáhl do build-time množiny
  // (zapečení do obrazu); chybějící klíč hlásí nahlas llm-dispatch a lane (KLIC_CHYBI).
  ["VLLM_API_KEY", "secret", 32],

  // ── External (3rd-party API keys; populate from .env-prod-backup) ─────────
  ["OPENAI_API_KEY", "external"],
  ["ANTHROPIC_API_KEY", "external"],
  ["GOOGLE_AI_API_KEY", "external"],
  ["RESEND_API_KEY", "external"],
  ["SENTRY_AUTH_TOKEN", "external"],
  ["SENTRY_ORG", "external"],
  ["SENTRY_PROJECT", "external"],
  ["SENTRY_URL", "external"],
  ["TELEGRAM_API_ID", "external"],
  ["TELEGRAM_API_HASH", "external"],
  ["TELEGRAM_BOT_TOKEN", "external"],
  ["FORGEJO_URL", "static", FORGEJO_URL_DEFAULT],
  // DERIVED from this checkout's own remote, never a literal. A hardcoded donor
  // path is indistinguishable from correct on the donor and silently wrong on
  // every fork: Coolify clones whatever this says, so a fork would have deployed
  // the DONOR's source. Same blind spot as a hardcoded `aisha-` app prefix.
  ["FORGEJO_REPO", "static", FORGEJO_REPO_DEFAULT],
  ["FORGEJO_TOKEN", "external"],
  ["COOLIFY_URL", "required-static", COOLIFY_URL_VALUE],
  ["COOLIFY_BASE_URL", "alias", "COOLIFY_URL"],
  ["COOLIFY_API_KEY", "external"],
  ["NPM_REGISTRY_URL", "static", "https://registry.npmjs.org"],
  ["REGISTRY_PROXY_USERNAME", "external"],
  ["REGISTRY_PROXY_PASSWORD", "external"],
  ["GIT_SHA", "static", "main"],
  ["COSMOS_SIGNER_MNEMONIC", "external"],

  // ── LLM Gateway (aisha-llm-gateway stack) ─────────────────────────────────
  // AISHA_LLM_GATEWAY_KEY: shared API key between aisha-core/openclaw and
  //   the llm-gateway container (LLM_GATEWAY_API_KEY inside container).
  // LLM_GATEWAY_SECRET: JWT signing secret for the gateway's own token checks.
  // LLM_GATEWAY_DB_PASSWORD: dedicated llm_gateway_app PG role password.
  // LLM_GATEWAY_DOMAIN: Traefik hostname for the gateway service.
  ["AISHA_LLM_GATEWAY_KEY", "secret", 32],
  ["LLM_GATEWAY_SECRET", "secret", 32],
  ["LLM_GATEWAY_DB_PASSWORD", "secret", 32],
  ["LLM_GATEWAY_DOMAIN", "static", dom("LLM_GATEWAY_DOMAIN")],
  // Traefik Host() in docker-compose.coolify-llm-gateway.yml — canonical subdomain
  // alias; resolver emits GATEWAY_DOMAIN alongside legacy LLM_GATEWAY_DOMAIN.
  // NOT "required-static" (stejná třída jako BROKER_DOMAIN výš): llm-gateway je tier
  // optional a profil ho smí vyloučit — resolver pak klíč NEVYDÁ a tvrdá povinnost by
  // shodila preflight i studený start instance, která o gateway nikdy nežádala
  // (naměřeno 2026-10-06 na profilu s tier_filter required+important). Kde gateway běží,
  // vynutí klíč validátor aplikace z ${VAR} jejího compose (_unprovisioned_services()).
  ["GATEWAY_DOMAIN", "static", topo("GATEWAY_DOMAIN")],
  // LLM_GW_UPSTREAM_URL: upstream OpenAI-compatible endpoint the gateway
  // forwards to (own SaaS, vLLM, Ollama, etc.). Empty means no managed
  // upstream configured; the key still has to exist for compose validation.
  ["LLM_GW_UPSTREAM_URL", "placeholder"],

  // ── Omni gateway (svc-ai-chat /v1 surface) ────────────────────────────────
  // Auth reuses JWT_SECRET (above) and the canonical AISHA_POSTGREST_* fall back to
  // AISHA_API_URL / AISHA_SERVICE_KEY / AISHA_ANON_KEY (already in this contract), so
  // no new auth secret is introduced. The only omni-NEW vars are the local inference
  // backend (Docker Model Runner): empty ⇒ tier1/2 SSE returns 502 no_backend but
  // auth/routing/governance stay verifiable. Gated by --omni-mode (see OMNI_MODE).
  ...(OMNI_MODE
    ? [
        ["DOCKER_MODEL_RUNNER_URL", "placeholder"],
        ["DOCKER_MODEL", "static", "ai/smollm2"],
      ]
    : []),

  // ── Piny obrazů ───────────────────────────────────────────────────────────
  //
  // ⛔ NASAZENÍ CORE PADALO NA CHYBĚJÍCÍM `AISHA_DB_IMAGE` (změřeno 2026-08-09).
  // Compose má od #f90e4580c tvrdý guard `${AISHA_DB_IMAGE:?…}` bez fallbacku —
  // správně, protože dosazená hodnota je neviditelný drift. Doručení ale přibylo
  // JEN do `aisha-cold-start.sh`, a ten běží jednou. Instance založená dřív tu
  // proměnnou v `.env.coolify` nikdy nedostala, `coolify-sync-envs.sh` posílá
  // průnik (klíče v .env.coolify) ∩ (klíče v compose) — a co v .env.coolify není,
  // nemá čím doručit. Výsledek: každý redeploy core padl na interpolaci.
  //
  // ⭐ TŘÍDA: klíč doručovaný jen cold-startem je pro EXISTUJÍCÍ instalaci
  // nedoručitelný. Doplňovat mezery ve smlouvě je práce doktora, takže sem patří
  // každý klíč, který compose vyžaduje — ne jen ty, na které se přišlo při
  // zakládání instance.
  //
  // `required-static` a NE `static`: domovem hodnoty je `config/image-versions.env`
  // (helper `image()` ho čte). Prázdný fallback je záměr — když pin ve zdroji
  // chybí, má doktor selhat nahlas, ne vymyslet tag a nechat drift na později.
  ["AISHA_DB_IMAGE", "required-static", image("AISHA_DB_IMAGE", "")],
  // Major verze PostgreSQL — build-arg `PG_MAJOR` obrazu infra/postgres, compose ji
  // čte jako `${POSTGRES_MAJOR:?…}`. Týž tvar jako AISHA_DB_IMAGE: domov je
  // config/image-versions.env, zapisuje se jen tam, kde klíč chybí, a instance si
  // ho pak DRŽÍ. To je tu podstatné víc než kde jinde: změna domova nesmí
  // přepnout běžící instanci, protože obraz jiné major verze na jejích datech
  // nenastartuje (entrypoint-wrapper to odmítne). Přepnutí = dump/restore.
  ["POSTGRES_MAJOR", "required-static", image("POSTGRES_MAJOR", "")],

  // ── Grafana (aisha-observability stack) ───────────────────────────────────
  ["GRAFANA_DOMAIN", "static", dom("GRAFANA_DOMAIN")],
  ["IMAGE_OAUTH2_PROXY", "static", image("IMAGE_OAUTH2_PROXY", "quay.io/oauth2-proxy/oauth2-proxy:v7.6.0")],

  // ── Image piny: CELÝ config/image-versions.env, ne jen vybrané ────────────
  // Soubor je jediný zdroj pravdy pro IMAGE_* (36 pinů) a cold-start ho sourcuje,
  // takže hodnoty MÁ — jenže do .env.coolify se dostaly jen ty, které stály
  // v tomhle kontraktu jmenovitě (jediná: IMAGE_OAUTH2_PROXY výše). Compose je
  // přitom čtou většinou jako holé `${IMAGE_X}`, což preflight považuje za
  // povinné. Důsledek naměřený na jedné instanci 2026-08-11: po přegenerování env
  // padlo 19 z 31 compose na `service "core-mesh-ingress" has neither an image
  // nor a build context` — prázdný pin, ne chybějící služba. Hláška míří úplně
  // jinam než příčina, což stálo hodiny.
  //
  // Odvozeno ze souboru, ne vypsáno ručně: 36 řádků by se rozešlo s SoT při
  // prvním přidání image. loadImageVersions() hodnoty rozvíjí (${REGISTRY_PROXY}),
  // takže sem padá hotový tag. Prázdný pin = "static" s prázdnou hodnotou by
  // maskoval chybu, proto required-static: chybějící řádek v SoT má spadnout tady,
  // ne až na hostu.
  // Filtr je POZITIVNÍ (`IMAGE_*`), ne výčet výjimek. Soubor totiž nenese jen
  // image piny: má i `REGISTRY_PROXY` (ř. 35) a `AISHA_DB_IMAGE` (ř. 146), a oba
  // už kontrakt deklaruje jinde — REGISTRY_PROXY jako "template" o 118 řádků níž,
  // AISHA_DB_IMAGE výš. Výčet výjimek to musí uhlídat ručně a při každém novém
  // ne-image klíči v SoT znovu selže; `startsWith` to řeší tvarem.
  // Proč na tom záleží: resolveOne() přeskakuje podle `existing.has(key)` (soubor),
  // ne podle `resolved.has(key)` (kontrakt) — dvě položky téhož klíče tedy obě
  // projdou a zapíšou se jako DVA řádky do .env.coolify. Ten soubor čte celé
  // nasazení a duplicita v něm je nedefinované chování (viz ř. 1225-1237).
  // ⛔ 2026-09-14: `derived`, ne `required-static`. Pin je FUNKCE repa a prefixu
  // cache — uložená hodnota, která se liší, je zastaralá, ne rozhodnutí instance.
  // Jako required-static se pin uložený bez prefixu už nikdy nesrovnal (<fork> 23/23
  // z Docker Hubu přímo). Prázdný pin zůstává required-static: chybějící řádek
  // v SoT má dál spadnout tady, ne se tiše tolerovat jako prázdná derivace.
  ...Object.keys(IMAGE_VERSIONS)
    .filter((k) => k.startsWith("IMAGE_") && k !== "IMAGE_OAUTH2_PROXY")
    .map((k) => {
      const pin = image(k, "");
      return [k, pin ? "derived" : "required-static", pin];
    }),

  // ── Openclaw (aisha-openclaw stack) ───────────────────────────────────────
  // Self-hosted agent orchestration platform; separate DB schema + API keys.
  // svc-local-ingest + svc-potok (tier=optional, opt-in via INGEST_BUNDLE_GIT_URL /
  // POTOK_ENABLED): cockpit auth tokens are generated; ALLOWED_HOSTS = the public
  // edge face (templated from derive-domains output; sentinel *-disabled.invalid
  // when the edge face is off — the container then only answers loopback).
  // Nextcloud — dokumentové zdroje (druhá vstupní dráha ingestu).
  // Adresa a uživatel jsou NEVEŘEJNÁ KONFIGURACE, ne tajemství; heslo ano a drží
  // se v rclone obfuskovaném tvaru (čitelné rclone nebere). Prázdná hodnota je
  // legitimní stav — lane zůstane vypnutá a nasazení tím nespadne.
  ["NEXTCLOUD_URL", "external"],
  ["NEXTCLOUD_USER", "external"],
  ["NEXTCLOUD_APP_PASSWORD_OBSCURED", "external"],
  // Dokumenty instance jsou pojmenovaný svazek v compose local-ingest (jméno z identity),
  // žádná proměnná. INGEST_DOCS_MOUNT zanikla: holé `${VAR}` ve zdroji svazku Coolify
  // 4.3.16 tiše převede na svazek `<uuid>_<slug>` (naměřeno 2026-09-28).
  ["DOCS_SYNC_INTERVAL", "static", "300"],
  ["DOCS_SYNC_OFFSET", "static", "100"],
  // Vzory GENERUJE <fork>-instance-data/scripts/nextcloud-sync-env.py z deklarací
  // zdrojů (sources/nextcloud-*.json) — sem se jen doručují. Ruční editace by
  // založila druhý domov téhož seznamu.
  ["DOCS_SYNC_INCLUDE_SMLOUVY", "external"],
  ["DOCS_SYNC_INCLUDE_DOKUMENTY", "external"],
  ["INGEST_TOKEN", "secret", 32],
  ["INGEST_DROP_ACCESS_KEY", "secret", 20],
  ["INGEST_DROP_SECRET_KEY", "secret", 32],
  // Jméno sdíleného svazku drop lane. Compose ho drží POVINNÝM (`:?`), protože
  // tichý rozchod obou stran (local-ingest zapisuje, source-broker čte) by se
  // projevil až prázdnou frontou. Dodává se TUDY, ne defaultem v compose:
  // prefix je SERVICE_ALIAS_PREFIX = jméno IMPLEMENTACE stacku (stejné pro
  // každou instanci; instance odděluje Coolify vlastním uuid), takže v souboru
  // nesmí být zadrátované jméno.
  // DATOVÝ volume (výstup ingestu) → nese IDENTITU (APP_NAME_PREFIX), ne alias.
  // SERVICE_ALIAS_PREFIX je 'aisha' pro každou instanci, takže dvě instance na
  // jednom hostu by sdílely týž volume s daty. Předchozí oprava (z natvrdo
  // `aisha_`) šla jen na alias — půlkrok; identita je to jediné jednoznačné jméno.
  ["LOCAL_INGEST_OUT_VOLUME", "template", "${APP_NAME_PREFIX}_local-ingest-out"],
  // Host allowlist ingestu (ochrana proti DNS rebindingu — server jinak vrací 421).
  //
  // ⛔ NAMĚŘENO 2026-08-29: hodnota nesla JEN veřejnou doménu, a ta je
  // `ingest-disabled.invalid` (ingest se ven nevystavuje). Ingest tedy přijímal
  // request jedině s `Host: 127.0.0.1` — tedy zevnitř vlastního kontejneru.
  // Volání z brokeru přes mesh skončilo `421 Misdirected Request`: jméno se
  // přeložilo, TCP prošlo, token sedl, a zastavil ho až Host header.
  //
  // Vstupní cesta ingestu přitom neměla ŽÁDNÉHO zapisovatele (`documents: 0`,
  // `ingest-input` připojený :ro a nikdo jiný ho nemontuje), takže se do něj
  // nikdy nic nedostalo. Rozhodnutí majitele 2026-08-29: doklady tlačí broker
  // přes API ingestu, „jen v rámci stacku, meshe" — ven se nic neotevírá.
  //
  // Proto se k veřejné doméně přidává VNITŘNÍ jméno služby (obě podoby: server
  // porovnává celý Host header, takže s portem i bez něj). Odvozuje se
  // z identity instance — zadrátované jméno by se rozšířilo do cizích instancí.
  //
  // ⛔ NAMĚŘENO 2026-09-14 na nasazeném forku: jako `template` se opravil jen
  // čistý cold start. Instance, která hodnotu už měla (`ingest-disabled.invalid`),
  // ji držela dál — šablona plní jen prázdné — a broker dostával 421 i po opravě.
  // Hodnota je přitom celá FUNKCE veřejné domény a identity; veřejné vystavení
  // se rozhoduje přes INGEST_DOMAIN_PUBLIC, ne tady. Proto `derived`: rozdíl se
  // srovná při každém běhu doktora (redeploy ho pouští před syncem).
  // Bez identity se NEODVODÍ — `-svc-local-ingest` by přepsalo platnou hodnotu.
  ["INGEST_ALLOWED_HOSTS", "derived",
    IDENTITY
      ? [derivedTopo("INGEST_DOMAIN_PUBLIC"), `${IDENTITY}-svc-local-ingest:8765`, `${IDENTITY}-svc-local-ingest`]
        .filter(Boolean).join(",")
      : ""],
  // Adresa ingestu pro PUSH z brokeru. OPERÁTORSKÁ, protože závisí na tom,
  // jestli je broker v meshi (dnes NENÍ — viz komentář ve compose brokeru).
  // Prázdná = push lane vypnutá, což je poctivější než nefunkční jméno.
  ["INGEST_API_URL", "external"],
  // ⛔ Adresa svc-money se do registru ZÁMĚRNĚ NEDÁVÁ. Odvozovaly
  // by se z IDENTITY složené při načtení modulu z `.env-prod-backup`, který je
  // pod `--no-external` (a to používá i preflight v coolify-sync-envs) PRÁZDNÝ
  // — vyšlo `http://-svc-money:3016`. Odvozují se proto ve compose z
  // `${APP_NAME_PREFIX:?}`, kde identitu dodává Coolify a chybějící hodnota
  // službu NESPUSTÍ místo aby ji nasměrovala nikam.
  // Jméno clamd je INSTANČNÍ a doručuje se TUDY, ne defaultem ve compose.
  //
  // PROČ (změřeno 2026-08-10): na sdílené síti `coolify` si holý alias `clamd`
  // nárokoval i CIZÍ nájemník a Docker DNS mezi nimi střídal. U clamd je to
  // horší než u databází — protokol NEMÁ ŽÁDNOU autentizaci, takže `INSTREAM`
  // pošle OBSAH skenovaného souboru tomu, kdo zrovna odpoví. Únik dat mezi
  // nájemníky, ne jen výpadek.
  //
  // Doručuje se jako HODNOTA, ne jako `${CLAMD_HOST:-${APP_NAME_PREFIX}-clamd}`
  // ve compose: Coolify vnořenou interpolaci neumí (ověřeno — vyrenderovalo se
  // „?-clamd}") a brána coolify-compose-compliance ji zakazuje.
  ["CLAMD_HOST", "template", "${APP_NAME_PREFIX}-clamav"],
  // Vnitřní URL služeb — INSTANČNÍ jméno, doručované, bez fallbacku.
  // Holé `http://svc-ai-chat:3011` v compose defaultu ukazovalo na alias, který
  // si na sdílené síti nárokuje i cizí nájemník (změřeno 2026-08-10).
  ["AI_CHAT_SERVICE_URL", "template", "http://${APP_NAME_PREFIX}-svc-ai-chat:3011"],
  ["AITG_PROBES_SERVICE_URL", "template", "http://${APP_NAME_PREFIX}-svc-aitg-probes:3041"],
  ["POTOK_TOKEN", "secret", 32],
  ["POTOK_ALLOWED_HOSTS", "template", "${POTOK_DOMAIN_PUBLIC}"],
  // svc-model weights — OPERATOR-SUPPLIED, and optional by construction:
  // config/services.json declares `"provision_when_env": "CHAT_GGUF_URL"`, so the
  // service is only provisioned when the operator pins weights. They are neither
  // generated nor derived (a model URL + its sha cannot be computed from the
  // deployment), which is exactly what "external" means here.
  //
  // Undeclared, they failed the contract-coverage check and blocked cold-start —
  // correctly: the gate demands that every compose-referenced key be classified.
  // The classification is DERIVED from services.json's own opt-in gate, not
  // asserted, so an install that supplies no weights stays valid.
  // Plugin sandbox reach — OPT-IN, and empty is the correct default: the
  // sandbox refuses every outbound call when the list is empty, so an instance
  // that installs no plugin needs no value. Declared here because the code reads
  // them and the contract-coverage check demands every compose key be classified
  // (they were read but never delivered, so no plugin could reach anything).
  // Totéž jako SPA_*: allowlist, který compose čte jako `${VAR:-}`. Prázdný
  // allowlist = nic nepovoleno = nejpřísnější stav. Vyžadovat ho znamená nutit
  // operátora něco povolit, aby vůbec mohl nasadit.
  ["PLUGIN_NETWORK_ALLOWLIST", "placeholder"],
  ["PLUGIN_RPC_WHITELIST", "placeholder"],
  // ── Vendor connectors (opt-in, one block per vendor) ────────────────────
  // Every one of these is OPERATOR-SUPPLIED and must never reach git: they live
  // in .env-prod-backup, which is only ever stored in the age-encrypted vault.
  // "external" is deliberate — an install that does not talk to a vendor leaves
  // them empty and cold-start warns rather than fails.
  //
  // Endpoint + credentials are not the whole contract: HOW the connector reaches
  // the vendor is configuration too. A system reachable only through a tunnel
  // needs to say WHICH egress path to take, otherwise the choice ends up hidden
  // in a compose file or, worse, in code.
  ["EW_API_URL", "external"],
  ["EW_TOKEN_URL", "external"],
  ["EW_CLIENT_ID", "external"],
  ["EW_API_KEY", "external"],
  ["EW_USERNAME", "external"],
  ["EW_PASSWORD", "external"],
  // T-cars: SOAP WebService v2. The contract number is part of the login
  // struct, not a separate account id, so all three are credentials.
  ["TC_API_URL", "external"],
  ["TC_CISLO_SMLOUVY", "external"],
  ["TC_JMENO", "external"],
  ["TC_HESLO", "external"],
  // Money: endpoint + credentials + the egress path to use. Empty egress means
  // "direct"; a named profile routes the connector through that tunnel.
  ["MONEY_API_URL", "external"],
  ["MONEY_CLIENT_ID", "external"],
  ["MONEY_CLIENT_SECRET", "external"],
  ["MONEY_USERNAME", "external"],
  ["MONEY_PASSWORD", "external"],
  ["MONEY_EGRESS_PROFILE", "external"],
  ["CHAT_GGUF_URL", "external"],
  ["CHAT_GGUF_SHA256", "external"],
  ["EMBED_GGUF_URL", "external"],
  ["EMBED_GGUF_SHA256", "external"],
  // ⛔ NAMĚŘENO 2026-09-13: jména lan a druhá embedding lane v kontraktu CHYBĚLY.
  // Instance je deklaruje v .env-prod-backup, ale doktor klíč mimo CONTRACT do
  // .env.coolify nepřenese a coolify-sync-envs posílá jen (klíče .env.coolify) ∩
  // (reference compose) — v .env.coolify hlavního checkoutu nebyl ani jeden z nich.
  // Nasazený svc-model tak běžel pod DOSAZENÝMI aliasy compose, ne pod deklarací
  // instance. Třída a důvod „external" jsou tytéž jako u vah výš: jméno modelu ani
  // jeho pin se z nasazení odvodit nedají. Kontrakt, který alias musí splnit, ověřuje
  // entrypoint (scripts/deploy/svc-model-aliasy.sh) před stažením vah.
  ["MODEL_ALIAS", "external"],
  ["EMBED_ALIAS", "external"],
  ["EMBED2_GGUF_URL", "external"],
  ["EMBED2_GGUF_SHA256", "external"],
  ["EMBED2_ALIAS", "external"],
  // Táž mezera, sourozenec: compose čte `MODEL_N_THREADS=${MODEL_N_THREADS:-}` a dokumentace
  // ji vede jako deklaraci instance, ale bez řádku tady by výslovná hodnota k aplikaci
  // nikdy nedošla. Prázdná je platný stav (vlákna se odvodí z CPU kvóty).
  ["MODEL_N_THREADS", "external"],
  // svc-local-ingest bundle — OPERATOR-SUPPLIED, same class and same reason as the
  // svc-model weights above: config/services.json declares
  // `"provision_when_env": "INGEST_BUNDLE_GIT_URL"`, so the service exists only when
  // the operator points it at a bundle repo. A git URL + subdir cannot be generated
  // or derived from the deployment.
  //
  // They were referenced by docker-compose.coolify-local-ingest.yml (BUNDLE_GIT_URL /
  // BUNDLE_GIT_PATH / BUNDLE_GIT_REF) but declared NOWHERE, so env-doctor never carried
  // the operator's values from .env-prod-backup into .env.coolify — and coolify-sync-envs
  // therefore never shipped them. The gate could not be armed through the pipeline at all;
  // the only way in was hand-editing .env.coolify, which the next regeneration would drop.
  // Measured 2026-07-28: all four ingest/potok gates empty in .env.coolify while
  // svc-potok and svc-source-broker were running — i.e. live apps whose env this tool
  // silently never synced (the exact failure coolify-app-vars.sh:208 warns about).
  //
  // ⚠️ GIT_PATH is not optional in practice: without it the container silently runs the
  // BAKED example bundle instead of the instance one (verified live 2026-07-17).
  ["INGEST_BUNDLE_GIT_URL", "external"],
  ["INGEST_BUNDLE_GIT_PATH", "external"],
  // Ref má smysl jen tehdy, když je nastavená URL bundlu — a na TÉ katalog
  // podmiňuje celou službu (`provision_when_env: INGEST_BUNDLE_GIT_URL`).
  // Bez URL je ref bezpředmětný, takže ho nelze vyžadovat samostatně.
  ["INGEST_BUNDLE_GIT_REF", "placeholder"],
  // ── Akcelerační vrstva (GPU uzel, slot `gpu`) ────────────────────────────
  // Všechno ACCEL_* je odvozené z deklarace GPU uzlu v datech instance vlastníka vrstvy
  // (overlay accel/uzel.json) — JEDEN domov: lib/derive-accel-uzel.mjs, týž, který volá
  // cold-start (heredoc přes lib/accel-vrstva-env.sh). `derived` = drift se přepíše, takže
  // změna deklarace dojde i redeployem. Instance bez deklarace: prázdné (lane vrstvy
  // zavřené). Vadná deklarace: prázdné + důvod na stderr (cold-start na ní STOPne).
  // Výklad a ověření deklarace: lib/accel-uzel.mjs; tvar proměnných firewallu posuzuje
  // posudAccel (lib/accel-deklarace.mjs) níž v malformedValues.
  ...kliceVrstvy().map((k) => [k, "derived", hodnotaVrstvyNeboPrazdno(k)]),
  // Port SSH do CI VM na hostiteli uzlu (DNAT správy), nebo výslovné `zadna` =
  // žádná CI VM. Čte ho vnější sonda doktora (lib/vnejsi-expozice.mjs), žádný
  // compose. Hodnotu dodává OBSLUHA instance: doktor ji jen přenese z trezoru,
  // výchozí není a port se nehádá (výklad: lib/accel-deklarace.mjs portCiVm;
  // bez deklarace sonda hlásí NEZMĚŘENO).
  ["ACCEL_CI_VM_SSH_PORT", "external", zaLaneSluzby("accel-hostfw")],
  // Interní klíč operátora mezi vstupem lane a enginy (VLLM_API_KEY enginu, obrana do
  // hloubky na síti jádra; nájemci ho nikdy nedostanou). Vyrábí ho doktor se zapnutou lane
  // vstupu, cold-start ho zachová (carry-over tajemství): nový klíč by rozpojil VB a enginy
  // do příštího nasazení obou. Compose ho čte HOLÝ (`${ACCEL_JADRO_API_KEY}`), nikdy `:?`.
  ["ACCEL_JADRO_API_KEY", "secret", 32, zaLaneSluzby("accel-vstup")],
  // Čtecí token Hugging Face (repozitáře za licencí, kterou účet přijal). V trezoru
  // pod jménem HF_READ_TOKEN; compose vstupu ho předá JEN stahovači vah (accel-vahy)
  // jako HF_TOKEN HOLÝM `${HF_READ_TOKEN}` — `${…:?}` by z tajemství udělal build-time
  // hodnotu zapsanou do historie obrazu (rohatka build-time-mnozina-vsech-compose).
  // Povinný jen pro bázi za licencí (pozná až stažení u Hugging Face) — proto
  // deklarace obsluhy, ne povinný vstup.
  ["HF_READ_TOKEN", "template-default", "", zaLaneSluzby("accel-vstup")],
  // Build-time pull-through cache prefix. cold-start's heredoc derives it
  // (`REGISTRY_PROXY=${REGISTRY_DOMAIN:+${REGISTRY_DOMAIN}/}`) but this tool did not know
  // it at all, so when REGISTRY_DOMAIN was repaired here the prefix kept the stale host —
  // and EVERY image build kept failing on a TLS error against a domain that does not exist.
  // Declared so env-doctor can repair the pair together; the trailing slash is part of the
  // contract (Dockerfiles interpolate `${REGISTRY_PROXY}library/alpine:3.20`).
  // template-DEFAULT, not template: an explicitly empty REGISTRY_PROXY in
  // .env-prod-backup is the documented "pull direct from upstream" escape hatch
  // (config/image-versions.env), and cold-start honours it with a bare-dash
  // default. A plain template silently undid that on every run.
  // ⛔ 2026-09-14: CENTRÁLNÍ cache (domov config/image-versions.env), ne odvození
  // z REGISTRY_DOMAIN instance. `derived` = uložená hodnota, která se liší od
  // deklarace/domova, se SROVNÁ — prázdné `REGISTRY_PROXY=` bez deklarace je
  // zapomenutý stav (<fork>). Výslovné vypnutí v .env-prod-backup platí dál
  // (viz REGISTRY_PROXY_ROZLISENI a zvláštní větev v resolveOne).
  ["REGISTRY_PROXY", "derived", REGISTRY_PROXY_ROZLISENI.hodnota],
  ["OPENCLAW_DB_PASSWORD", "secret", 32],
  ["OPENCLAW_API_KEY", "secret", 32],
  // OPENCLAW_URL: internal topology URL (derive-domains http://aisha-openclaw:5210).
  // PLACEHOLDER — openclaw is tier:optional; absent URL ⇒ svc-ai-chat's adapter
  // self-disables (no fail-loud). cold-start-doctor Phase I reports reachability.
  ["OPENCLAW_URL", "placeholder"],
  ["OPENCLAW_SECRET", "secret", 32],
  ["OPENCLAW_DOMAIN", "static", dom("OPENCLAW_DOMAIN")],
  // Traefik Host() in docker-compose.coolify-openclaw.yml — canonical subdomain
  // alias; resolver emits COMPANION_DOMAIN alongside legacy OPENCLAW_DOMAIN.
  // NOT "required-static" — openclaw je tier optional (viz GATEWAY_DOMAIN výš, táž třída).
  ["COMPANION_DOMAIN", "static", topo("COMPANION_DOMAIN")],

  // ── Maestro / integration (aisha-integration stack) ───────────────────────
  // MAESTRO_API_KEY: auth token for internal Maestro REST API calls.
  ["MAESTRO_API_KEY", "secret", 32],

  // ── Misc ──────────────────────────────────────────────────────────────────
  ["LOGFLARE_RELEASE_COOKIE", "alias", "JWT_SECRET"],
  ["REALTIME_DB_ENC_KEY", "alias", "LOGFLARE_API_KEY"],
];

// --print-contract-keys: vypíše `KLÍČ\tdruh` za každou položku kontraktu a skončí,
// PŘED jakýmkoli čtením či zápisem .env souborů. Existuje proto, aby šel kontrakt
// MĚŘIT zvenčí. Bez toho by brána na duplicitu musela kontrakt číst staticky —
// jenže ten se z části skládá spreadem (`...Object.keys(IMAGE_VERSIONS)`), takže
// statická analýza nikdy neuvidí to, co za běhu vznikne. Sonda, která nevidí
// polovinu měřeného, mlčí i tehdy, když je vada uvnitř.
//
// ⛔ NAMĚŘENO 2026-08-12 (tři červené běhy CI na PR #885/#889): tady stálo
//    `for (…) console.log(…); process.exit(0);` — a v CI z 405 řádků dorazilo
//    jen 179. console.log do ROURY je při zaplněném bufferu asynchronní a
//    process.exit() nevylité bajty ZAHODÍ; kolik projde, rozhoduje plánovač.
//    Lokálně se to netrefilo nikdy, v CI občas — brána pak padala hláškou
//    o kontraktu („0 IMAGE_ pinů"), ačkoli kontrakt byl celý a jen nedoletěl.
//    Důkaz: histogram druhů prvních 179 řádků plného výstupu == přesně to,
//    co CI viděla; IMAGE_ piny začínají až na řádku 327.
//
//    Proto: JEDEN zápis s callbackem (exit až po vylití) + PATIČKA s počtem
//    řádků, aby si konzument uměl úplnost VYMOci, ne ji předpokládat.
/**
 * Hodnota přidaného klíče ve výpisu: ukáže se jen to, co je funkcí repa a
 * topologie (static, derived) — NIKDY tajemství, alias (nese hodnotu jiného
 * klíče), šablona (může ji skládat z tajemství) ani externí hodnota ze zálohy.
 *
 * ⛔ NAMĚŘENO 2026-09-16 v logu cold-startu v APPLY: `v.slice(0, 27)` vypsal
 * celý přístupový klíč k úložišti a prvních 27 znaků dalších 14 nasazených
 * tajemství. Brána doktor-nevypise-tajemstvi to měří spuštěním.
 */
const DRUHY_S_VIDITELNOU_HODNOTOU = new Set(["static", "required-static", "derived"]);
function zobrazitPridanouHodnotu(hodnota, druh) {
  if (!hodnota) return "(empty)";
  if (!DRUHY_S_VIDITELNOU_HODNOTOU.has(druh)) return `‹skryto, ${hodnota.length} znaků›`;
  return hodnota.length > 30 ? `${hodnota.slice(0, 27)}...` : hodnota;
}

if (args.has("--print-contract-keys")) {
  const text =
    CONTRACT.map(([key, kind]) => `${key}\t${kind}`).join("\n") +
    `\n__CONTRACT_END__\t${CONTRACT.length}\n`;
  await new Promise((resolve) => process.stdout.write(text, resolve));
  process.exit(0);
}

/**
 * KONEC AŽ PO VYLITÍ VÝSTUPU.
 *
 * ⛔ NAMĚŘENO 2026-08-16 v CI (PR #921, běh 3421): výstup doktora skončil
 * uprostřed sekce „Keys to add" u `STUDIO_DEFAULT_ORG` — souhrn `✗ external: 30`
 * dorazil, ale sekce s jejich výpisem už ne. Brána z toho usoudila, že si
 * doktor protiřečí. Neprotiřečil si. NEDOLETĚL.
 *
 * Je to TÁŽ VADA, která je v tomhle souboru zapsaná u `--print-contract-keys`
 * (naměřeno 2026-08-12: z 405 řádků dorazilo 179): `console.log` do ROURY je
 * při zaplněném bufferu asynchronní a `process.exit()` nevylité bajty ZAHODÍ.
 * Tehdy se opravilo jen to jedno místo, ne třída — hlavní hlásicí cesta
 * zůstala. Lokálně se to netrefí, protože výstup je kratší; v CI je delší
 * (30 chybějících externals místo 21) a přeteče.
 *
 * Prázdný zápis s callbackem se dokončí, až je fronta vylitá — teprve pak exit.
 */
async function konec(code) {
  await new Promise((resolve) => process.stdout.write("", resolve));
  process.exit(code);
}

// ── Parser / writer ──────────────────────────────────────────────────────────
function parseEnvFile(path) {
  if (!existsSync(path)) return { lines: [], values: new Map() };
  return parseEnvText(readFileSync(path, "utf8"));
}

function parseEnvText(text) {
  const lines = text.split(/\r?\n/);
  const values = new Map();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1);
    values.set(k, v);
  }
  return { lines, values };
}

// Klíč definovaný v souboru VÍCKRÁT nemá jednu hodnotu — má tolik hodnot, kolik
// je parserů. Shell `source` i parseEnvFile() berou POSLEDNÍ, jq-ová cesta v
// coolify-sync-envs bere podle pořadí v payloadu. V jediném souboru, který čte
// celé nasazení, je to nedefinované chování.
//
// Měřeno 2026-07-28 na živé instanci: 22 duplicitních klíčů, mezi nimi
// OAUTH2_PROXY_COOKIE_SECRET, NETBIRD_DATASTORE_ENC_KEY, OPENXPKI_RPC_HMAC,
// KRONOS_API_KEY, PKI_DEFAULT_SECRET. Vzniká to append-only zápisem: doktor
// dřív uměl doplnit klíč jen na PRÁZDNÝ řádek, takže neprázdný duplikoval.
//
// Sesbírání drží POSLEDNÍ hodnotu — to je ta, kterou dnes dostane shell i
// parser, takže se sesbíráním se NIC nemění; jen se to přestane rozcházet
// mezi nástroji. Hlásí se nahlas: tichá oprava tajemství je horší než nález.
function collapseDuplicateKeys(text) {
  const lines = text.split(/\r?\n/);
  const lastIdx = new Map();
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^([A-Z_][A-Z0-9_]*)=/);
    if (m) lastIdx.set(m[1], i);
  }
  const collapsed = [];
  const keep = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^([A-Z_][A-Z0-9_]*)=/);
    if (m && lastIdx.get(m[1]) !== i) {
      collapsed.push(m[1]);
      continue; // dřívější výskyt — zahazuje ho i shell, jen mlčky
    }
    keep.push(lines[i]);
  }
  return { text: collapsed.length ? keep.join("\n") : text, collapsed };
}

function appendKeysToText(text, additions) {
  // additions: array of [key, value, source, kind, nahradit?]
  if (additions.length === 0) return text;
  let existing = text;

  // A key we are filling may ALREADY be in the file as an empty line (cold-start's
  // heredoc emits `KEY=${KEY:-}`, which lands blank when the operator's shell had no
  // value). Appending then leaves the key TWICE — and which one wins is up to whoever
  // parses the file, i.e. undefined behaviour in the one file the whole deploy reads.
  // Fill in place instead; only genuinely new keys get appended.
  // A `derived` key may already be present with a NON-empty (stale) value — that
  // is the whole point of reconciling it. Appending would leave the key twice and
  // the stale line first, so the drift would survive its own repair. Replace any
  // value for those; keep the empty-only rule for everything else, where a
  // non-empty existing value is authoritative and must never be rewritten.
  // Kromě derived smí neprázdnou hodnotu přepsat jen doplnění, které to VÝSLOVNĚ
  // nese (5. prvek `nahradit`): veřejný VAPID klíč, který není bodem křivky,
  // a alias, který byl kopií právě nahrazené hodnoty. Rozhoduje ten, kdo
  // doplnění vyrobil a zná důvod — ne tahle funkce podle štítku.
  const appended = [];
  for (const [k, v, source, , nahradit] of additions) {
    const isDerived = typeof source === "string" && source.startsWith("derived");
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // `g` je nutné: klíč může být v souboru VÍCKRÁT (viz collapseDuplicateKeys).
    // Nahradit jen první výskyt znamená opravit hodnotu, kterou parser stejně
    // zahodí — oprava by vypadala hotová a nic by nezměnila.
    const line = new RegExp(`^${esc}=${isDerived || nahradit === true ? ".*" : "[ \t]*"}$`, "gm");
    if (line.test(existing)) {
      line.lastIndex = 0;
      existing = existing.replace(line, `${k}=${v}`);
    } else appended.push([k, v]);
  }

  if (appended.length) {
    const stamp = new Date().toISOString();
    let block = `\n# ── Added by aisha-env-doctor.mjs at ${stamp} ──\n`;
    for (const [k, v] of appended) block += `${k}=${v}\n`;
    const sep = existing.endsWith("\n") || existing === "" ? "" : "\n";
    existing = existing + sep + block;
  }
  return existing;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (IZOLACE_CHYBA) {
    console.error(`[env-doctor] ✗ IZOLACE: ${IZOLACE_CHYBA}`);
    process.exit(2);
  }
  log(C.bold("\n🔧 aisha-env-doctor — env contract enforcement\n"));
  log(`  ${C.dim("Target:")}   ${ENV_PATH}`);
  log(`  ${C.dim("Mode:")}     ${REPORT_ONLY ? "report-only" : DRY_RUN ? "dry-run" : "apply"}${STRICT ? " +strict" : ""}`);
  log(`  ${C.dim("Contract:")} ${CONTRACT.length} keys\n`);

  // Obsah SoT se čte JEDNOU a z téhož textu se rozhoduje i zapisuje — viz
  // „souběh zapisovatelů" u zápisu na konci main().
  const puvodniText = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : null;
  const { values: existing } = parseEnvText(puvodniText ?? "");

  // Load external source (.env-prod-backup) for `external` kind fallback.
  let externalSrc = new Map();
  if (!NO_EXTERNAL && existsSync(EXTERNAL_SOURCE)) {
    externalSrc = parseEnvFile(EXTERNAL_SOURCE).values;
    info(`External source loaded: ${EXTERNAL_SOURCE} (${externalSrc.size} keys)`);
  } else if (NO_EXTERNAL) {
    info("External source disabled (--no-external)");
  } else {
    warn(`External source not found: ${EXTERNAL_SOURCE}`);
  }

  // Resolve in two passes: first pass fills primitives, second pass resolves
  // aliases / templates that depend on first-pass values.
  const resolved = new Map(existing); // start with what's already there
  const additions = []; // [key, value, source, kind, nahradit?]
  const externalMissing = [];
  const externalNekonzumovane = [];
  const zaZavrenouLane = []; // klíče opt-in služby, jejíž lane je zavřená — nevyrábí se ani nehlásí
  // Klíč → NEPRÁZDNÁ hodnota, kterou tenhle běh přepsal (ne doplnil). Alias,
  // který byl kopií té staré hodnoty, ji musí následovat — jinak by po opravě
  // cíle nesl dál starý svět (plocha by odebírala jiným klíčem, než svc-push
  // podepisuje).
  const nahrazeno = new Map();
  const prepsaneHodnoty = []; // mimo derived: nesrovnané v nasazení → --strict
  const vyresenePary = new Set();
  const vadnePary = []; // pár, který bez člověka opravit nejde — nic se nezapíše

  /**
   * Klíčový pár (`VAPID_PAR`) naraz, jednou za běh — posudek z `lib/vapid-par.mjs`.
   * Neprázdná hodnota se přepíše JEN tam, kde posudek dokáže, že nic nenesla
   * (veřejný klíč, který není bodem křivky). Všechno nejisté je STOP.
   */
  function resolveVapidPar(popis) {
    const id = `${popis.verejny}|${popis.soukromy}`;
    if (vyresenePary.has(id)) return;
    vyresenePary.add(id);
    const ulozeny = (k) => existing.get(k) ?? "";
    const posudek = posudVapidPar({ verejny: ulozeny(popis.verejny), soukromy: ulozeny(popis.soukromy) });
    const zapis = (key, value, nahradit) => {
      resolved.set(key, value);
      additions.push([key, value, `secret (VAPID pár: ${posudek.duvod})`, "secret", nahradit]);
    };
    switch (posudek.akce) {
      case "ponechat":
        return;
      case "vyrobit":
        zapis(popis.verejny, posudek.verejny, false);
        zapis(popis.soukromy, posudek.soukromy, false);
        return;
      case "doplnit-verejny":
        zapis(popis.verejny, posudek.verejny, false);
        return;
      case "nahradit-verejny":
        nahrazeno.set(popis.verejny, ulozeny(popis.verejny));
        prepsaneHodnoty.push(popis.verejny);
        zapis(popis.verejny, posudek.verejny, true);
        return;
      default: // "stop"
        vadnePary.push(`${popis.verejny} + ${popis.soukromy}: ${posudek.duvod}`);
    }
  }

  /**
   * Klíče, které v TOMHLE nasazení někdo konzumuje.
   *
   * Kontrakt je ručně udržovaný seznam; nasazení je skutečnost. Když se
   * rozejdou, preflight blokuje nasazení kvůli údajům, které nikdo nechce.
   * Naměřeno 2026-08-14: z 51 klíčů druhu `external` jich 23 patřilo volitelným
   * konektorům a `MONEY_*`, `TC_*`, `EW_*` neměly v celém stromu ANI JEDEN
   * výskyt — ani v compose, ani v katalogu, ani v kódu. Přesto stavěly
   * `coolify-sync-envs` a s ním celý cold-start.
   *
   * Povinnost se proto ODVOZUJE: klíč je povinný, jen když ho něco spotřebuje.
   * Volitelné schopnosti (svc-model, local-ingest bundle, federace) tím dostanou
   * totéž, co katalog už umí přes `provision_when_env` — prázdno je u nich
   * legitimní stav, ne vada.
   */
  const konzumovaneKlice = (() => {
    const set = new Set();
    let soubory = [];
    try {
      // CELÝ sledovaný strom, ne výčet adresářů. Dva důvody:
      //  1. Výčet stárne — každý nový adresář se službami by tiše vypadl
      //     z měření a jeho klíče by se staly „bez konzumenta".
      //  2. Globy s `**` tu nefungují, jak by čekal: git rozvíjí `*` PŘES
      //     lomítka, takže `scripts/**/*.mjs` vyžaduje ještě jedno lomítko
      //     navíc — naměřeno 173 souborů, z toho 0 v kořeni `scripts/`, tedy
      //     ani `coolify-deploy-init.sh`, ani `aisha-cold-start.sh`.
      soubory = execFileSync("git", ["ls-files", "-z"],
        { cwd: ROOT, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 })
        .split("\0").filter(Boolean);
    } catch {
      return null; // git nedostupný → NEZMĚŘENO, chová se jako dřív
    }
    const text = soubory
      // Vlastní soubor NE: kontrakt je DEKLARACE, ne spotřeba. Kdyby se počítal,
      // každý klíč by měl konzumenta sám v sobě a odvození by nikdy nic neřeklo.
      .filter((f) => !f.endsWith("scripts/aisha-env-doctor.mjs"))
      // `*.example`/`*.sample` jsou také jen deklarace — ukazují, CO by se dalo
      // nastavit, ne že to něco čte. Próza (.md) ze stejného důvodu vypadává
      // rozsahem přípon níž.
      .filter((f) => !/\.(example|sample|template)$/.test(f))
      .filter((f) => /\.(ts|tsx|mjs|js|cjs|sh|py|yml|yaml|json|sql|conf|toml)$/.test(f)
        || /(^|\/)Dockerfile/.test(f) || f.startsWith("coolify/manifests/"))
      .map((f) => {
        try { return readFileSync(join(ROOT, f), "utf-8"); } catch { return ""; }
      }).join("\n");
    for (const m of text.matchAll(/\b([A-Z][A-Z0-9_]{3,})\b/g)) set.add(m[1]);
    return set;
  })();

  const placeholders = [];
  const derivedNeoveritelne = []; // derived klíč, jehož vstup chybí — ponechán, ne ověřen
  const nerozvinute = []; // hodnota by nesla `${…}` nebo prázdný vstup `template-default` — NEZAPSÁNO
  const sablonaBezVstupu = []; // `template` s prázdným vstupem — zapsáno PRÁZDNĚ, ne složeninou s dírou

  function resolveOne(entry) {
    const [key, kind, ...rest] = entry;
    const zaLane = podminkaZaLane(rest);
    if (zaLane && !laneSluzbyOtevrena(zaLane)) {
      zaZavrenouLane.push(key);
      return;
    }
    if (kind === "secret" && jeParKlicu(rest[0])) return resolveVapidPar(rest[0]);
    // ⛔ ODVOZENÁ HODNOTA BEZ VSTUPU NENÍ DRIFT (naměřeno 2026-09-13).
    //
    // Obecná úvaha níž („srovnat odvozený klíč je bezpečné, operátor by hodnotu
    // deklaroval jinde") platí jen tehdy, když derivace vidí VŠECHNY své vstupy.
    // `GATEWAY_TRUSTED_PROXIES` je funkcí `MESH_PEER_IPS`, a to je placeholder,
    // který plní až discovery. Bez něj `gatewayTrustedProxies('')` vrátí jen
    // dockerové CIDR — neprázdně, takže pojistka `odvozeno !== ""` nezabere —
    // a doktor přepsal seznam s 23 peery seznamem bez nich se štítkem
    // „drift opraven". Na core a edge by tím přestala jít spočítat klientská
    // adresa za mesh skokem, tedy právě to, podle čeho dveře pouštějí dovnitř.
    //
    // Rozhodnutí žije u derivace (`srovnaniTrustedProxies`), ne tady: tady se
    // jen ptá. Je to jediná odvozená hodnota, která čte placeholder z cílového
    // souboru — proto konkrétní klíč, ne obecný mechanismus pro jeden případ.
    let duvodOdvozeni = null;
    let vynutitZapis = false;
    if (kind === "derived" && key === "REGISTRY_PROXY") {
      // Bez .env-prod-backup (--no-external) nejde poznat výslovné vypnutí cache
      // — soudit by znamenalo hádat. Stejně jako u trusted proxies: neposuzovat.
      if (NO_EXTERNAL) {
        info(`${key}: bez .env-prod-backup nejde poznat výslovné vypnutí cache — neposuzuji`);
        return;
      }
      if (existing.has(key) && existing.get(key) === String(rest[0] ?? "")) return;
      // Výslovně PRÁZDNÁ deklarace musí přepsat i neprázdnou uloženou hodnotu;
      // obecná pojistka `odvozeno !== ""` níž by ji jinak spolkla.
      vynutitZapis = true;
      duvodOdvozeni = REGISTRY_PROXY_ROZLISENI.zdroj === "deklarace"
        ? (rest[0] ? "deklarace operátora" : "cache výslovně vypnutá operátorem")
        : "centrální cache z domova";
    }
    if (kind === "derived" && key === "WEB_FQDNS") {
      // Nevím = nezapsat nic (ani prázdno) a skončit nenulou — viz WEB_DEKLARACE.
      if (!WEB_DEKLARACE.znamo) return;
      if (existing.has(key) && existing.get(key) === String(rest[0] ?? "")) return;
      // Známá PRÁZDNÁ deklarace musí přepsat i neprázdnou uloženou hodnotu (značky
      // z overlaye zmizely); obecná pojistka `odvozeno !== ""` níž by ji spolkla.
      vynutitZapis = true;
      duvodOdvozeni = WEB_DEKLARACE.zdroj;
    }
    if (kind === "derived" && key === "GATEWAY_TRUSTED_PROXIES") {
      const r = srovnaniTrustedProxies({ existujici: existing.get(key), meshPeerIps: meshPeerIps() });
      if (r.akce === "ponechat") {
        // Nepřepsat NENÍ „v pořádku": hodnota je jen neověřitelná. Preflight
        // `--strict` na tomhle stavu padal i dřív (hodnota se lišila od derivace)
        // a má padat dál — jen teď z pravdivého důvodu.
        info(`${key}: ${r.duvod}`);
        derivedNeoveritelne.push(key);
        return;
      }
      rest[0] = r.hodnota;
      duvodOdvozeni = r.duvod;
    }
    // Rules for skipping vs. regenerating:
    // - auto-gen types (secret/hex/b64std): regenerate if value is empty —
    //   an empty secret is never valid.
    // - all other types (alias, template, static, …): preserve existing value
    //   even if empty. Rationale:
    //   • alias/template: env-doctor uses append-only writes; re-resolving an
    //     existing (even empty) alias would create a duplicate line. Instead,
    //     alias keys are kept in sync by the tool that writes the canonical key
    //     (e.g. aisha-bootstrap-user-init.sh calls upsert_env for both keys).
    //     On a fresh cold-start the alias is simply absent → added correctly.
    //   • placeholder/static: intentionally left blank for other tools to fill.
    if (existing.has(key)) {
      const autoGenTypes = new Set(["secret", "hex", "b64std"]);
      // An EXTERNAL key that exists but is EMPTY, while .env-prod-backup holds a real
      // value, must be filled — not "preserved". Preserving is about never rotating a
      // value that already carries meaning (JWT_SECRET, ANON_KEY); an empty string
      // carries none. Without this the operator's supplied value can NEVER reach
      // .env.coolify: cold-start's heredoc writes the key blank on every run, this
      // branch then preserves the blank, and coolify-sync-envs ships the blank on.
      // Measured 2026-07-28 on INGEST_BUNDLE_GIT_URL/PATH — set in .env-prod-backup,
      // blank in .env.coolify, and svc-local-ingest therefore never provisioned.
      const externalFill = kind === "external" && existing.get(key) === "" &&
        (externalSrc.get(key) ?? "").length > 0;
      // A DERIVED key is not the operator's to hold. Its value is a FUNCTION of
      // the topology (server_bindings + placement + TLDs), so a stored value that
      // disagrees with the derivation is not "a value that carries meaning" — it
      // is the answer to a question the deployment no longer asks. Preserving it
      // makes the drift PERMANENT: no cold-start, no redeploy, no doctor run can
      // ever correct it, because every one of them goes through this branch.
      //
      // Measured 2026-07-28 on this instance, twice in one day, same shape:
      //   PKI_BRIDGE_URL   held https://pki-bridge.backend.<internal> (the
      //     SPLIT-FLEET branch) on a single-node instance, where nothing listens
      //     on :443 → pki-init exit 1 → no CA bundle → mesh dead for four days.
      //   AUTH_UPSTREAM_*  held https://auth.backend.<internal>, which resolves
      //     NOWHERE inside a container → edge 502 on the public auth face →
      //     netbird-management crash-looped on OIDC discovery.
      // In BOTH cases derive-domains emitted the correct value the whole time,
      // repo/gates/CI all agreed, and only the deployed env disagreed.
      //
      // Reconciling is safe precisely because the value is derived: if the
      // operator wants a different one, they declare it in .env-prod-backup,
      // which topo() already reads FIRST (prodEnv → process.env → derivation).
      // So this cannot overwrite an operator's decision — only a stale answer.
      // Nerozvinutá šablona (`${…}`) není odvozená hodnota — zapsat ji by rozeslalo
      // doslovný text do Coolify (naměřeno 2026-09-25 u STORAGE_PUBLIC_URL).
      const derivedDrift = kind === "derived" &&
        String(rest[0] ?? "") !== "" && !String(rest[0] ?? "").includes("${") &&
        existing.get(key) !== String(rest[0] ?? "");
      // ⭐ TÁŽ ÚVAHA JAKO U `externalFill`, TŘETÍ DRUH KLÍČE.
      //
      // Šablona NENÍ hodnota operátora — je to FUNKCE už vyřešených hodnot
      // (`${AISHA_LLM_GATEWAY_URL}/v1`). Prázdný řetězec u ní tedy nic „nenese",
      // stejně jako u prázdného externího klíče, a zachovat ho znamená zachovat
      // ho NAVŽDY: cold-start napíše klíč prázdný, tahle větev prázdno uchová
      // a `coolify-sync-envs` prázdno pošle dál. Žádný běh doktora to nespraví,
      // protože všechny jdou tudy.
      //
      // Změřeno 2026-08-09: `INSIGHT_OPENAI_ENDPOINT` byl v `.env.coolify`
      // PŘÍTOMNÝ a PRÁZDNÝ, zatímco `AISHA_LLM_GATEWAY_URL` měl správnou hodnotu
      // celou dobu. Preflight `--strict` proto padal na jediném klíči a shodil
      // `coolify-sync-envs.sh` úplně — takže nešlo doručit ANI nesouvisející
      // opravy. „Přítomný a prázdný" ≠ „chybějící", a healer léčil jen to druhé.
      const templateEmpty = kind === "template" && existing.get(key) === "";
      // Alias je KOPIE. Přepsal-li tenhle běh jeho cíl a alias nesl starou
      // hodnotu cíle, následuje ho. Alias s JINOU hodnotou se nechá — o té nic
      // nevíme a hádat by znamenalo přepsat cizí rozhodnutí.
      const aliasNasleduje = kind === "alias" && nahrazeno.has(rest[0]) &&
        existing.get(key) === nahrazeno.get(rest[0]);
      // ⭐ TÁŽ ÚVAHA JAKO U `templateEmpty`, U ALIASU (naměřeno 2026-09-27 nad
      // trezorem instance): VAPID pár v trezoru chyběl celý, doktor ho vyrobil,
      // ale `VITE_WEB_PUSH_VAPID_PUBLIC_KEY` tam ležel PŘÍTOMNÝ a PRÁZDNÝ — a
      // prázdný alias se „zachovával“. Preflight `--strict` v coolify-sync-envs
      // na něm padal (Empty required), takže nešlo doručit ANI nesouvisející
      // klíče (Edge). Prázdný alias nenese rozhodnutí, je to nevyplněná kopie:
      // má-li cíl hodnotu, alias ji převezme. Řádek se doplní na místě
      // (appendKeysToText plní prázdný řádek), duplicita nevznikne.
      const aliasPrazdny = kind === "alias" && existing.get(key) === "" &&
        (resolved.get(rest[0]) ?? "") !== "";
      if (!vynutitZapis && !externalFill && !derivedDrift && !templateEmpty && !aliasNasleduje && !aliasPrazdny &&
          (!autoGenTypes.has(kind) || existing.get(key) !== "")) return;
      if (aliasNasleduje) prepsaneHodnoty.push(key);
      // auto-gen type with empty value, fillable external, drifted derived,
      // or empty template → fall through
    }

    let value = "";
    let source = kind;
    switch (kind) {
      case "secret":
        value = genSecret(rest[0] ?? 32);
        break;
      case "hex":
        value = genHex(rest[0] ?? 32);
        break;
      case "b64std":
        // Standard base64 (no URL-safe substitutions, no padding strip).
        // For consumers expecting Go StdEncoding (e.g. NETBIRD_DATASTORE_ENC_KEY).
        value = randomBytes(rest[0] ?? 24).toString("base64");
        break;
      case "static":
        value = String(rest[0] ?? "");
        break;
      case "required-static":
        value = String(rest[0] ?? "");
        source = "static";
        break;
      // derived — value is a FUNCTION of the topology, so a stored value that
      // disagrees is stale, not authoritative. Required like required-static
      // (an empty derivation is a resolver bug, and shipping empty silently is
      // exactly how these keys break), but ALSO reconciled when present-and-
      // different. See the derivedDrift note in resolveOne() for the two
      // measured incidents this exists to prevent.
      case "derived":
        value = String(rest[0] ?? "");
        // Štítek musí říct, CO se stalo — „drift opraven" u hodnoty, jejíž vstup
        // chyběl, byla přesně ta věta, která vadu zakryla. Prefix „derived" musí
        // zůstat: `appendKeysToText` podle něj řádek NAHRAZUJE místo připsání.
        source = duvodOdvozeni
          ? `derived (${duvodOdvozeni})`
          : existing.has(key) ? "derived (drift opraven)" : "derived";
        break;
      case "alias": {
        const other = resolved.get(rest[0]) ?? "";
        value = other;
        source = `alias→${rest[0]}`;
        break;
      }
      case "alias-prefix": {
        const other = resolved.get(rest[1]) ?? "";
        value = `${rest[0]}${other}`;
        source = `alias-prefix→${rest[1]}`;
        break;
      }
      case "template": {
        // ⛔ Složenina z PRÁZDNÉHO vstupu není hodnota (naměřeno 2026-09-27 nad
        // trezorem bez identity: `http://${APP_NAME_PREFIX}-svc-ai-chat:3011` →
        // `http://-svc-ai-chat:3011`, `${APP_NAME_PREFIX}-db` → `-db`) — neprázdná,
        // takže projde každou kontrolou na prázdnotu i interpolací `:?` v compose.
        // Zapíše se PRÁZDNĚ (ne vynechá, jako `template-default` níž): u šablony
        // prázdno nic nenese — `templateEmpty` ho příští běh se vstupem doplní
        // a neprázdnou hodnotu tahle cesta nepřepíše nikdy. Prázdný `KEY=` shodí
        // `:?` nahlas; vynechaný klíč by brána zapisovatelů četla jako „nikdo
        // ho nezapisuje" (deklarace-v-compose-ma-zapisovatele). Chybějící vstup
        // doktor ohlásí sám, tvarem, který brány čtou ze stderr.
        const chybi = new Set();
        value = String(rest[0]).replace(/\$\{([A-Z][A-Z0-9_]+)\}/g, (_, k) => {
          const v = resolved.get(k) ?? "";
          if (!v) chybi.add(k);
          return v;
        });
        if (chybi.size > 0) {
          value = "";
          source = `template (prázdný vstup: ${[...chybi].join(", ")})`;
          sablonaBezVstupu.push(key);
          console.error(`aisha-env-doctor: ${key} se neodvodil (prázdný vstup šablony): ${[...chybi].join(", ")}`);
          break;
        }
        source = "template";
        break;
      }
      case "template-default": {
        // The template is a DEFAULT, not an owner. An explicit operator
        // declaration wins — and `has()` rather than a truthiness test is the
        // whole point: for these keys EMPTY is a decision, not an absence.
        //
        // Why this kind exists (measured 2026-08-12): REGISTRY_PROXY was a
        // plain "template" of ${REGISTRY_DOMAIN}/, so this tool rewrote it on
        // every run. cold-start deliberately resolves the same key with a
        // BARE-dash default (`${REGISTRY_PROXY-…}`) so that an explicitly empty
        // value survives — that empty value is the documented escape hatch for
        // "the pull-through cache is unreachable, pull from upstream instead".
        // Two owners of one value, and the later one did not know about the
        // exception: the operator set REGISTRY_PROXY="" in .env-prod-backup,
        // this tool put the unreachable host back, and wave 0 of every deploy
        // died on `failed to resolve reference "<cache>/library/docker:27-cli"`
        // with no way to bypass it.
        if (externalSrc.has(key)) {
          value = odUvozovkuj(externalSrc.get(key) ?? "");
          source = "operator←env-prod-backup (overrides template default)";
          break;
        }
        // Výchozí hodnota složená z PRÁZDNÉHO vstupu není výchozí hodnota —
        // `https://${APP_DOMAIN}` bez domény by zapsal `https://`, neprázdné
        // a projde každou kontrolou na prázdnotu. Nezapsat a vypsat.
        let chybiVstup = false;
        value = String(rest[0]).replace(/\$\{([A-Z][A-Z0-9_]+)\}/g, (_, k) => {
          const v = resolved.get(k) ?? "";
          if (!v) chybiVstup = true;
          return v;
        });
        if (chybiVstup) {
          nerozvinute.push(key);
          return;
        }
        source = "template-default";
        break;
      }
      case "external": {
        const fromSrc = externalSrc.get(key);
        if (fromSrc && fromSrc.length > 0) {
          // Hodnota jako po `source` (.env-prod-backup píše týž tvar jako .env.coolify).
          value = odUvozovkuj(fromSrc);
          source = "external←env-prod-backup";
          break;
        }
        // Chybí — ale je to vada jen tehdy, když ho v tomhle nasazení někdo
        // konzumuje. Kontrakt bez konzumenta je zbytek po jiné instalaci.
        if (konzumovaneKlice && !konzumovaneKlice.has(key)) {
          externalNekonzumovane.push(key);
          return;
        }
        externalMissing.push(key);
        return; // don't add empty external
      }
      case "placeholder":
        placeholders.push(key);
        // Add empty placeholder so file has the key (Coolify env contract complete)
        value = "";
        break;
      default:
        warn(`unknown contract kind: ${kind} for ${key}`);
        return;
    }

    // ⛔ NEROZVINUTÁ ŠABLONA NENÍ HODNOTA — pro KAŽDÝ druh (naměřeno 2026-09-27
    // dry-runem nad trezorem instance). `dom()` vrací doslovný řádek
    // z config/domains.env, když klíč neleží v trezoru ani v prostředí; kontrakt
    // má osm složenin `https://${dom(X)}`, a kterákoli z nich by na novém klíči
    // zapsala `https://${X:-}`. coolify-sync-envs by text rozeslal doslovně.
    // Nezapíše se, vypíše se a `--strict` na tom padá: doplnit ho musí deklarace
    // operátora nebo topologie, ne tenhle nástroj hádáním.
    //
    // TÁŽ TŘÍDA: URL bez hostitele (`https://`, `https:///storage/v1`) — složenina
    // z PRÁZDNÉ domény. Neprázdná, takže projde každou kontrolou na prázdnotu;
    // pod cold-startem ji tak vydal shell (`NETBIRD_API_URL=https://`, naměřeno
    // 2026-09-25). Rozhodnutí „nezapsat" má jediný domov: nesmiDoTrezoru().
    if (nesmiDoTrezoru(value)) {
      nerozvinute.push(key);
      return;
    }

    const stara = existing.get(key);
    const prepisujeNeprazdnou = stara !== undefined && stara !== "" && stara !== value;
    if (prepisujeNeprazdnou && kind === "derived") nahrazeno.set(key, stara);
    resolved.set(key, value);
    // Neprázdný alias sem dojde JEN jako `aliasNasleduje` — tehdy se přepisuje.
    additions.push([key, value, source, kind, kind === "alias" && prepisujeNeprazdnou]);
  }

  // Pass 0: KAŽDÝ klíč, který derivace vydá, se doručí — i když ho CONTRACT
  // nevyjmenovává.
  //
  // CONTRACT je ručně udržovaný seznam. Derivace je druhý seznam téhož. Když
  // se rozejdou, hodnota se sice ODVODÍ, ale nikam nedoteče — a projeví se to
  // až tím, že konzument spadne na svůj fallback. Změřeno 2026-07-29 třikrát
  // po sobě: KEYCLOAK_INTERNAL_URL, pak celá rodina *_SERVICE_URL, a nakonec
  // GATEWAY_URL / MINIO_URL, které v .env.coolify vůbec nebyly.
  //
  // Doručuje se jako `derived`, takže platí totéž co pro ostatní odvozené:
  // hodnota je funkcí topologie, drift se smíří, operátorský pin v
  // .env-prod-backup má pořád přednost (derivedTopo čte prodEnv první).
  //
  // Klíče, které CONTRACT zná, se přeskočí — ten má u nich vlastní druh
  // (secret, alias, external…), který se tímhle nesmí přebít.
  const contractKeys = new Set(CONTRACT.map((e) => e[0]));
  for (const key of Object.keys(TOPOLOGY_ENV)) {
    if (contractKeys.has(key)) continue;
    resolveOne([key, "derived", derivedTopo(key)]);
  }

  // Pass 1: non-aliases (so aliases resolve correctly in pass 2)
  for (const entry of CONTRACT) {
    if (entry[1] === "alias" || entry[1] === "alias-prefix" || entry[1] === "template") continue;
    resolveOne(entry);
  }
  // Pass 2: aliases / templates
  for (const entry of CONTRACT) {
    if (entry[1] !== "alias" && entry[1] !== "alias-prefix" && entry[1] !== "template") continue;
    resolveOne(entry);
  }

  // ── Strict empty-value validation ───────────────────────────────────────
  // Required secrets must be non-empty in the resolved file. Placeholders and
  // external keys are explicitly allowed to be empty (filled by other tools or
  // pulled from .env-prod-backup at deploy time).
  const REQUIRED_NON_EMPTY = new Set();
  // ⛔ NAMĚŘENO 2026-08-16: `derived` znamená „vydává to topologie", NE „a proto
  // je to neprázdné". To jsou dvě různá tvrzení a doktor je slil v jedno.
  // Důsledek byl vážný: `EDGE_COMPOSE_PROFILES` je derived, jeho derivace pro
  // tuhle instanci legitimně vydá PRÁZDNO (`derive-domains --shell` ověřeno) a
  // spotřebitel prázdno výslovně připouští (`${EDGE_COMPOSE_PROFILES:-}` v
  // coolify-deploy-init.sh). Doktor to přesto hlásil jako prázdnou povinnou →
  // `--strict` selhal → preflight v `coolify-sync-envs.sh` zavřel CELOU cestu
  // doručení env. Fail-closed na podmínku, kterou nejde splnit.
  //
  // Rozhoduje proto DERIVACE SAMA (třetí prvek kontraktu je odvozená hodnota),
  // ne druh klíče. Žádný jmenný seznam výjimek — vyhodnotí se to pro každý
  // derived klíč stejně.
  const derivedPrazdne = [];
  for (const e of CONTRACT) {
    const [key, kind] = e;
    // Klíč za zavřenou lane se nevyrábí — vyžadovat ho by byl fail-closed na
    // podmínku, kterou instance bez té služby nemůže a nemá splnit.
    if (zaZavrenouLane.includes(key)) continue;
    if (kind === "secret" || kind === "hex") REQUIRED_NON_EMPTY.add(key);
    if (kind === "required-static") REQUIRED_NON_EMPTY.add(key);
    if (kind === "derived") {
      const odvozeno = e[2];
      if (odvozeno === "" || odvozeno === null || odvozeno === undefined) {
        derivedPrazdne.push(key);
      } else {
        REQUIRED_NON_EMPTY.add(key);
      }
    }
    if (kind === "alias" || kind === "alias-prefix" || kind === "template") REQUIRED_NON_EMPTY.add(key);
  }
  // Critical keys that absolutely must not be empty even if user wiped them.
  const CRITICAL_KEYS = [
    "POSTGRES_PASSWORD", "JWT_SECRET", "VAULT_ENCRYPTION_KEY", "COLUMN_ENCRYPTION_KEY", "FEDERATION_VAULT_KEY",
    "KEYCLOAK_DB_PASSWORD", "KEYCLOAK_ADMIN_PASSWORD", "KEYCLOAK_CLIENT_SECRET",
    "N8N_DB_PASSWORD", "NETBIRD_DB_PASSWORD", "SYNAPSE_DB_PASSWORD",
    "LANGFUSE_DB_PASSWORD", "PKI_DB_PASSWORD", "PKI_DB_ROOT_PASSWORD",
    "PKI_OIDC_SECRET", "PKI_SVAULT_KEY", "PKI_COOKIE_SECRET",
    "NETBIRD_OIDC_SECRET", "NETBIRD_MGMT_SECRET", "NETBIRD_RELAY_SECRET",
    "NETBIRD_MODEL_DB_PASSWORD", "NETBIRD_MODEL_MGMT_SECRET", "NETBIRD_MODEL_RELAY_SECRET",
    "RABBITMQ_DEFAULT_PASS", "MINIO_ROOT_PASSWORD", "REDIS_PASSWORD",
  ];
  const emptyRequired = [];
  for (const key of REQUIRED_NON_EMPTY) {
    const v = resolved.get(key);
    if (v === undefined) continue; // already counted as missing/added
    if (v === "" || v === null) emptyRequired.push(key);
  }
  const emptyCritical = CRITICAL_KEYS.filter((k) => {
    const v = resolved.get(k);
    return v === "" || v === null;
  });
  // Vynechání z povinných se NESMÍ dít mlčky. Prázdná derivace je legitimní
  // výsledek, ale taky první příznak rozbité topologie — operátor to musí
  // VIDĚT. Kdyby se derivace pokazila plošně, bude tenhle seznam dlouhý.
  if (derivedPrazdne.length > 0) {
    log(C.bold("Odvozené a PRÁZDNÉ (derivace to tak vydala — není to chybějící hodnota):"));
    for (const k of derivedPrazdne) log(`  ${C.dim("○")} ${k}`);
    log(
      C.dim(
        `  (${derivedPrazdne.length} z ${CONTRACT.filter((e) => e[1] === "derived").length} derived klíčů; ` +
          "dlouhý seznam = podezření na rozbitou topologii, ne na záměr)",
      ),
    );
    log("");
  }
  if (sablonaBezVstupu.length > 0) {
    log(C.bold("ŠABLONA S PRÁZDNÝM VSTUPEM — ZAPSÁNO PRÁZDNĚ (složenina by nesla díru, např. `http://-svc-…`):"));
    for (const k of sablonaBezVstupu) log(`  ${C.red("✗")} ${k}`);
    log(C.dim("  (chybí identita instance nebo vstup topologie — doplnit vstup, doktor klíč příště složí)"));
    log("");
  }
  if (nerozvinute.length > 0) {
    log(C.bold("NEROZVINUTÁ ŠABLONA — NEZAPSÁNO (hodnota by nesla `${…}`, URL bez hostitele nebo prázdný vstup):"));
    for (const k of nerozvinute) log(`  ${C.red("✗")} ${k}`);
    // Odkud to je: odkaz v config/domains.env bez hodnoty a bez deklarované volitelnosti.
    for (const [k, chybi] of [...domenyNerozbalenePouzite].sort(([a], [b]) => a.localeCompare(b, "en"))) {
      log(C.dim(`  config/domains.env ${k} ← chybí ${chybi.join(", ")}`));
    }
    log(
      C.dim(
        "  (doplň deklaraci v .env-prod-backup nebo vstup topologie; doslovný text by coolify-sync-envs rozeslal dál)",
      ),
    );
    log("");
  }
  if (emptyRequired.length > 0 || emptyCritical.length > 0) {
    log(C.bold("Empty required values (must be non-empty for production):"));
    for (const k of emptyRequired) log(`  ${C.red("✗")} ${k} (empty)`);
    for (const k of emptyCritical) {
      if (!emptyRequired.includes(k)) log(`  ${C.red("✗")} ${k} (empty, CRITICAL)`);
    }
    log("");
  }

  // ── Shape validation (byte length / JWT) for preserved & overridden values ──
  // The generator always emits valid values, but a value PRESERVED from a prior
  // run or supplied by the operator (e.g. via .env-prod-backup) can be the wrong
  // byte length (oauth2-proxy cookie secret → crash-loop "cookie_secret must be
  // 16, 24, or 32 bytes") or not a JWT at all (service token → PostgREST /
  // verifyServiceRole reject every request). The emptiness check above misses
  // both. Fail loud in --strict preflight here, reusing the local stack's
  // unit-tested assertions (one SoT for the rules, no duplicated logic).
  // ⛔ VÝČET SE NEUDRŽUJE, MĚŘÍ SE (naměřeno 2026-09-16). Tady stál ruční seznam
  // čtyř klíčů; `EXTRANET_COOKIE_SECRET` a `OPENCLAW_COOKIE_SECRET` v něm nebyly.
  // Do nasazení tak odešla zkamenělá hodnota o 69 bajtech, `extranet-auth` odmítl
  // start („must be 16, 24, or 32 bytes"), spadl s ním celý edge a veřejné adresy
  // instance vracely 404. Kdo tu hodnotu oauth2-proxy podává, říká compose.
  const COOKIE_SECRET_KEYS = kliceCookieSecretu(ROOT);
  const JWT_SHAPE_KEYS = ["POSTGREST_SERVICE_TOKEN", "SERVICE_ROLE_KEY", "ANON_KEY"];
  const malformedValues = [];
  const checkShape = (key, assertFn) => {
    const v = resolved.get(key);
    if (v === undefined || v === "" || v === null) return; // emptiness handled above
    try {
      assertFn(key, v);
    } catch (err) {
      malformedValues.push(err.message);
    }
  };
  for (const key of COOKIE_SECRET_KEYS) checkShape(key, assertCookieSecret);

  // ⛔ HLÁŠKA NENÍ HODNOTA (naměřeno 2026-09-16). Trezor živé instance nesl u tří
  // klíčů doslovně text z `${KLIC:?…}` v compose — mimo jiné jako ID klienta
  // Keycloaku. `preservedValue` to přenášelo přes každý běh včetně wipe, takže
  // konfigurace realmu, zakládání operátorů i JWKS sync padaly a vypadalo to
  // na výpadek Keycloaku.
  const hlasky = hlaskyPovinnychKlicu(ROOT);
  for (const [key, val] of existing) {
    if (jeHlaskaMistoHodnoty(key, val, hlasky)) {
      malformedValues.push(`${key}: hodnotou je HLÁŠKA z \`\${${key}:?…}\` v compose, ne hodnota — někdo zapsal text o chybějící hodnotě a generátor ho od té doby zachovává`);
    }
  }

  // ⛔ HODNOTA MUSÍ PŘEŽÍT `source` (naměřeno 2026-09-16 na dvou instancích).
  // Půl nasazovací cesty čte trezor shellem; víceslovná hodnota bez uvozovek
  // se buď rozpadne na příkaz (a `source` skončí — zbytek souboru je pro
  // skripty neviditelný), nebo se UŘÍZNE na první slovo. Viz lib/env-hodnota.mjs.
  for (const [key, val] of existing) {
    if (potrebujeUvozovky(val)) {
      malformedValues.push(`${key}: hodnota potřebuje uvozovky — bez nich se v \`source\` rozpadne nebo uřízne (apply je srovná)`);
    }
  }
  for (const key of JWT_SHAPE_KEYS) checkShape(key, assertJwtShape);
  // Firewall hostitele GPU uzlu: tvar každé VYPLNĚNÉ hodnoty, povinnost s otevřenou lane
  // accel-hostfw (deklarace uzlu). Bez lane a bez hodnot žádný nález. Výklad sdílí
  // s firewallem v kontejneru (lib/accel-deklarace.mjs).
  for (const c of posudAccel((k) => resolved.get(k) ?? process.env[k])) malformedValues.push(c);
  if (malformedValues.length > 0) {
    log(C.bold("Malformed values (wrong byte length / not a JWT — would crash at deploy):"));
    for (const m of malformedValues) log(`  ${C.red("✗")} ${m}`);
    log("");
  }
  if (vadnePary.length > 0) {
    log(C.bold("Klíčový pár, který NEOPRAVUJU — rozhodne člověk (nic z páru se nezapíše):"));
    for (const m of vadnePary) log(`  ${C.red("✗")} ${m}`);
    log("");
  }

  // ── Report ──────────────────────────────────────────────────────────────
  log(`${C.bold("Summary")}`);
  log(`  ${C.green("✓")} preserved:    ${existing.size}`);
  log(`  ${C.green("+")} would add:    ${additions.length}`);
  log(`  ${C.yellow("~")} placeholders: ${placeholders.length} (filled by other tools)`);
  log(`  ${C.red("✗")} external:     ${externalMissing.length} (need .env-prod-backup or manual)`);
  log("");

  if (additions.length > 0) {
    log(C.bold("Keys to add:"));
    const groups = { secret: [], hex: [], static: [], alias: [], placeholder: [] };
    for (const [k, v, src, kind] of additions) {
      const g = src.startsWith("alias") || src === "template" ? "alias"
        : src === "placeholder" ? "placeholder"
        : src.startsWith("secret") ? "secret" : src;
      (groups[g] ?? groups.static).push([k, v, src, kind]);
    }
    for (const [g, items] of Object.entries(groups)) {
      if (items.length === 0) continue;
      log(`  ${C.dim(`[${g}] (${items.length})`)}`);
      for (const [k, v, src, kind] of items.slice(0, 50)) {
        log(`    ${C.green("+")} ${k.padEnd(40)} = ${C.dim(zobrazitPridanouHodnotu(v, kind))} ${C.dim(`[${src}]`)}`);
      }
      if (items.length > 50) log(`    ${C.dim(`... and ${items.length - 50} more`)}`);
    }
    log("");
  }

  if (placeholders.length > 0) {
    log(C.bold("Placeholders (empty, filled by other tools):"));
    for (const k of placeholders) log(`  ${C.yellow("~")} ${k}`);
    log("");
  }

  if (zaZavrenouLane.length > 0) {
    log(C.bold("Klíče opt-in služeb za ZAVŘENOU lane (služba se nenasazuje — nic se nevyrábí ani nevyžaduje):"));
    for (const k of zaZavrenouLane) log(`  ${C.dim ? C.dim("·") : "·"} ${k}`);
    log("");
  }

  if (externalNekonzumovane.length > 0) {
    log(C.bold("External keys bez konzumenta v tomhle nasazení (prázdno je v pořádku):"));
    for (const k of externalNekonzumovane) log(`  ${C.dim ? C.dim("○") : "○"} ${k}`);
    log("");
  }

  if (externalMissing.length > 0) {
    log(C.bold("External keys still missing (manual or .env-prod-backup):"));
    for (const k of externalMissing) log(`  ${C.red("✗")} ${k}`);
    log("");
  }

  // ── Apply ───────────────────────────────────────────────────────────────
  // Compute strict failure: missing externals, empty required secrets, empty
  // critical keys all count.
  // ⛔ NAMĚŘENO 2026-09-01 V PROVOZU. `KC_ALLOWED_CLIENTS` je `derived` — doctor
  // ho umí spočítat z deklarací klientů (projekt + overlay instance). V SoT ale
  // NEBYL, protože ho tam nikdo nikdy nezapsal, a preflight to nepoznal: padá
  // jen na chybějících EXTERNAL, prázdných REQUIRED a CRITICAL. Odvozený klíč
  // propadl všemi třemi síty.
  //
  // Následek byl řetězový: brána má na tu hodnotu fail-closed kontrolu, takže
  // NENASTARTOVALA → `<fork>-core` skončil `exited` → zmizela databáze → Keycloak
  // s ní spadl a přihlášení přestalo fungovat úplně.
  //
  // `derived` znamená „UMÍM to spočítat", ne „JE to tam". Odvození bez zápisu
  // je schopnost, ne hodnota — a nasazení posílá SoT, ne schopnost.
  // ⛔ NAMĚŘENO 2026-09-02 V PROVOZU — DRUHÁ POLOVINA TÉŽE VADY.
  // Tenhle filtr porovnával PŘESNOU ROVNOSTÍ řetězec, který si `case "derived"`
  // o ~270 řádků výš sám ZDOBÍ:
  //     source = existing.has(key) ? "derived (drift opraven)" : "derived";
  // Chybějící odvozený klíč tedy `--strict` chytil, ZASTARALÝ ne. A propadal
  // ten NEBEZPEČNĚJŠÍ ze dvou stavů: chybějící klíč shodí fail-closed
  // spotřebitele hned a je vidět, kdežto zastaralý má hodnotu, je syntakticky
  // v pořádku, projde `${VAR:?}` i všemi třemi síty preflightu — a mlčky nese
  // starý svět.
  //
  // Konkrétně: `GATEWAY_TRUSTED_PROXIES` zůstal s `100.64.0.0/10` (CGNAT
  // rozsah operátorů) i poté, co ho oprava z důvěry odstranila. Oprava byla
  // v gitu a v `derive-subnets.mjs`, do provozu se NEDOSTALA — a nic
  // nezčervenalo, protože jediné měřidlo, které to mělo chytit, se dívalo na
  // vypsanou podobu místo na druh.
  //
  // Rozhoduje proto DRUH z kontraktu (`kind`). Štítek slouží výpisu; nikdy
  // nesmí být tím, podle čeho se klasifikuje.
  const derivedNesrovnane = additions
    .filter(([, , , kind]) => kind === "derived")
    .map(([k]) => k);

  const strictFailures = [
    ...(STRICT && !NO_EXTERNAL ? externalMissing : []),
    ...emptyRequired,
    ...emptyCritical.filter((k) => !emptyRequired.includes(k)),
    ...malformedValues,
    ...vadnePary,
    ...(STRICT ? derivedNesrovnane : []),
    ...(STRICT ? derivedNeoveritelne : []),
    ...(STRICT ? nerozvinute : []),
    // Přepsaná neprázdná hodnota (veřejný VAPID mimo křivku, alias za ním) je
    // v nasazení ŠPATNĚ, dokud apply neproběhne — stejně jako nesrovnaný derived.
    ...(STRICT ? prepsaneHodnoty : []),
  ];
  const strictFail = strictFailures.length > 0;
  if (!WEB_DEKLARACE.znamo) {
    const duvod =
      `WEB_FQDNS (domény webu) NEZNÁM: ${WEB_DEKLARACE.duvod} — klíč NEZAPSÁN (ani prázdný: ` +
      `„jedna značka" by doktor domén zapsal a routy značek smazal). Zpřístupni doménový overlay instance ` +
      `(AISHA_INSTANCE_CONFIG_DIR / AISHA_INSTANCE_DATA_GIT_URL, COOLIFY_<ENV>_DOMAINS_FILE) a spusť znovu.`;
    err(duvod);
    console.error(duvod);
  }
  // Kód „WEB_FQDNS nevím" jen tam, kde by se klíč ZAPISOVAL (apply). Kontrolní
  // běhy (--report / --dry-run — preflight syncu prostředí, doktor cold-startu)
  // se ptají na úplnost prostředí aplikací, ne na domény webu: nevím vypíšou
  // (výš), ale kód řídí jejich vlastní otázka.
  const webNevimKod = !WEB_DEKLARACE.znamo && !REPORT_ONLY && !DRY_RUN;
  const kodKonce = strictFail && STRICT ? 1 : webNevimKod ? KOD_ENV_DOKTORA_WEB_NEVIM : 0;
  if (REPORT_ONLY) {
    log(C.dim("(report-only mode — no changes written)\n"));
    await konec(kodKonce);
  }
  if (DRY_RUN) {
    log(C.dim("(dry-run — no changes written; rerun without --dry-run to apply)\n"));
    await konec(kodKonce);
  }
  if (additions.length === 0) {
    ok("Nothing to add — env file is complete.\n");
    await konec(kodKonce);
  }

  // ⛔ SOUBĚH ZAPISOVATELŮ (naměřeno 2026-09-15 ve vlně redeploye). Doktor
  // zapisoval holým `writeFileSync` (soubor nejdřív ZKRÁTÍ, pak plní) a rodič
  // `aisha-redeploy` v té chvíli přečetl PRÁZDNÝ soubor, přidal do něj své
  // složeniny a zapsal ho zpět. Z trezoru zbylo pár řádků; další běhy doktora
  // pak „chybějící" tajemství VYGENEROVALY NANOVO a sync je roznesl do Coolify
  // (201 klíčů v 18 aplikacích, mezi nimi hesla databází a šifrovací klíč n8n).
  //
  // Tři pojistky, každá na jinou polovinu vady:
  //   1. prázdný SoT se nedoplňuje — existující soubor bez jediného klíče je
  //      rozepsaný cizí zápis, ne čistý start (ten soubor NEMÁ vůbec);
  //   2. zapisuje se jen nad TÍMTÉŽ obsahem, ze kterého se rozhodovalo — změnil-li
  //      ho mezitím kdokoli jiný, doplnění by přepsalo jeho práci nebo vyrobilo
  //      tajemství, které už existuje;
  //   3. zápis je atomický (dočasný soubor + rename přes skutečnou cestu), takže
  //      žádný čtenář nikdy neuvidí zkrácený soubor.
  if (puvodniText !== null && existing.size === 0) {
    const duvod =
      `${ENV_PATH} existuje, ale nenese jediný klíč — je to rozepsaný nebo zkrácený zápis jiného procesu, ` +
      `ne čistý start. NEDOPLŇUJU: vyrobil bych nová tajemství místo těch, která už běží. ` +
      `Obnov SoT ze zálohy (.backup/, .env-prod-backup) a spusť znovu.`;
    err(duvod);
    console.error(duvod);
    await konec(2);
  }
  const textPredZapisem = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : null;
  if (textPredZapisem !== puvodniText) {
    const duvod =
      `${ENV_PATH} se během běhu doktora změnil (jiný zapisovatel). NEZAPISUJU: doplnění spočtené ` +
      `nad starším obsahem by jeho změnu smazalo nebo vyrobilo tajemství, které už existuje. Spusť znovu.`;
    err(duvod);
    console.error(duvod);
    await konec(2);
  }
  // Backup
  if (puvodniText !== null) {
    const backupDir = resolve(ROOT, ".backup");
    mkdirSync(backupDir, { recursive: true });
    const bk = resolve(backupDir, `env.coolify.bak-${Date.now()}`);
    writeFileSync(bk, puvodniText, { mode: 0o600 });
    info(`Backup: ${bk}`);
  }
  // Sesbírat duplicity PŘED zápisem: jinak by replace-in-place opravil hodnotu,
  // kterou parser stejně zahodí, a oprava by vypadala hotová bez účinku.
  const { text: sesbirany, collapsed } = collapseDuplicateKeys(puvodniText ?? "");
  const { text: uvozeny, srovnane } = srovnejUvozovani(sesbirany);
  if (srovnane.length) {
    warn(`Srovnáno uvozování u ${srovnane.length} hodnot (bez uvozovek by je \`source\` rozpadl nebo uřízl):`);
    for (const k of [...new Set(srovnane)].sort()) warn(`    ${k}`);
  }
  if (collapsed.length) {
    warn(`Sesbíráno ${collapsed.length} duplicitních klíčů (ponechána POSLEDNÍ hodnota — ta, kterou dnes bere shell i parser):`);
    for (const k of [...new Set(collapsed)].sort()) warn(`    ${k}`);
  }
  nahradObsahAtomicky(ENV_PATH, appendKeysToText(uvozeny, additions), { mode: 0o600 });
  ok(`Wrote ${additions.length} new keys to ${ENV_PATH}\n`);
  await konec(kodKonce);
}

// `main` je asynchronní kvůli `konec()` — vylití výstupu před ukončením.
// Proto se chyba chytá i z odmítnutého slibu; `try/catch` kolem volání by
// asynchronní pád minul a nástroj by spadl tiše.
main().catch((e) => {
  err(`Fatal: ${e.message}`);
  if (process.env.DEBUG) console.error(e);
  process.exit(2);
});
