#!/usr/bin/env node
/**
 * aisha-redeploy.mjs — Stateful Coolify redeploy orchestrator
 *
 * Inspects Coolify for current state of all aisha-* apps and redeploys them
 * in dependency order (waves). Between waves, waits for health so dependent
 * services start with their dependencies up.
 *
 * Wave order (dependency graph, verified from compose files 2026-06-12):
 *   wave 1: aisha-registry,                         (Docker Hub pull-through cache;
 *           aisha-shared-redis                        ACL Redis, pure infra no deps —
 *                                                     up before core/realtime consumers)
 *   wave 2: aisha-core, aisha-pki, aisha-edge,      (self-contained, parallel;
 *           aisha-clamav                              clamd needs only the registry cache)
 *   wave 3: aisha-keycloak                          (KC_DB_URL_HOST=aisha-db)
 *   wave 4: aisha-netbird, aisha-observability,     (use aisha-db + KC OIDC)
 *           aisha-orchestration, aisha-admin,
 *           aisha-ai-chat, aisha-realtime,          (aisha-db + redis via cross-stack alias,
 *           aisha-llm-gateway, aisha-openclaw         KC JWKS; llm-gw/openclaw tier=optional)
 *   wave 5: aisha-edge                              (MESH WARMUP — re-enroll agent
 *                                                     after management is ready)
 *   wave 6: aisha-integration, aisha-ledger,        (self-contained main +
 *           aisha-exec, aisha-observability-stack     netbird-agent sidecar; obs-stack
 *                                                     needs langfuse MinIO from wave 4)
 *   wave 7: aisha-messaging                         (Synapse + Matrix bridges)
 *
 * Coverage contract: every app in coolify/manifests/aisha.manifest MUST appear
 * in WAVES (gate: src/tests/gates/redeploy-wave-coverage.gate.test.ts). Apps
 * that are conditional (tier=optional — created by story-init only when their
 * provider keys/config exist) are skipped naturally: filterWaveApps() only
 * targets apps that actually exist in Coolify. A manifest app missing from
 * WAVES is a wave orphan — it cold-starts to exited:unhealthy with zero
 * deployments and even --only=<app> cannot reach it (incident 2026-06-12:
 * ai-chat, realtime, clamav).
 *
 * Usage:
 *   node scripts/aisha-redeploy.mjs                  # full waves with health waits
 *   node scripts/aisha-redeploy.mjs --status         # only show state, exit
 *   node scripts/aisha-redeploy.mjs --plan           # show plan, no API calls
 *   node scripts/aisha-redeploy.mjs --only=netbird   # only one app
 *   node scripts/aisha-redeploy.mjs --from=wave3     # start at wave 3
 *   node scripts/aisha-redeploy.mjs --skip-healthy   # skip apps already healthy
 *   node scripts/aisha-redeploy.mjs --no-wait        # fire-and-forget (no health waits)
 *   node scripts/aisha-redeploy.mjs --wave-timeout=300  # seconds per wave (default 300)
 *   node scripts/aisha-redeploy.mjs --restart-validate  # restart po vlnách + čekání na návrat zdraví
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { nahradObsahAtomicky } from "./lib/zapis-env-atomicky.mjs";
import { meshIpKlice, mnozinaPeerIps } from "./lib/mesh-peers.mjs";
import { vytvorDiscoveryVBehu } from "./lib/mesh-discovery-v-behu.mjs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createProjectScope } from "./lib/coolify-project-scope.mjs";
import { rozdelOnlyCile, dosazitelneVeVlnach } from "./lib/only-filter.mjs";
import { toStoryApp, appPrefix } from "./lib/story-app.mjs";
import { readConfigKey } from "./lib/config-env-files.mjs";
import { createCoolifyClient, waitForDeploymentSlot } from "./lib/coolify-http.mjs";
import { odvozeneKlice, otiskOdvozenych } from "./lib/otisk-odvozenych.mjs";
import { resolveManifestPath } from "./lib/coolify-instance-scope.mjs";
import { ctenarHodnot, klicePodminky, nactiKatalog, podminkaSplnena } from "./lib/provision-gate.mjs";
import { spustSOmezenim, pockejNaDobehnuti } from "./lib/nasazeni-s-omezenim.mjs";
import { nactiMapuUzlu, vytvorDiskovouBranu, gib } from "./lib/diskova-brana.mjs";
import { obrazyZCompose, sluzbySeStavbou } from "./lib/obrazy-stacku.mjs";
import { loadProfile } from "./lib/derive-domains.mjs";
const execFileP = promisify(execFile);
// Prometheus metrics jsou volitelné (opt-in). Lib zůstává pro buducí use, ale
// aktivní propsování metric do .metrics/ jsme odstranili — primary observability
// je Langfuse (LLM ops) + ClickHouse (events). Re-aktivace: import + metric
// calls níže pokud je to třeba (např. pro CI artifact analysis).
// import { metrics } from "./lib/metrics.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ── CLI ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);

// ⛔ NEZNÁMÝ PŘEPÍNAČ JE STOP, NE VÝCHOZÍ CHOVÁNÍ.
//
// Výchozí režim tohoto nástroje je `execute` — NASAZUJE. Neznámý přepínač se
// dřív jen mlčky ignoroval, takže dotaz na nápovědu spadl do nasazování:
//
//     node scripts/aisha-redeploy.mjs --help
//     → Mode: execute ; ✓ Found 33 <prefix>-* applications
//
// Naměřeno 2026-09-05: zachránila mě jen roura do `head`, která proces zabila
// nad výpisem stavu. Táž třída už jednou zapsala 36 klíčů do `.env.coolify` a
// odvozeninou z prázdného prostředí smazala alias — tam byl neznámým
// přepínačem rovněž `--help`.
//
// Registr se drží U PARSOVÁNÍ, ne v dokumentaci: přepínač, který někdo přidá
// níž a sem ho nezapíše, tuhle stráž shodí na první použití.
const ZNAME_PREPINACE = new Set([
  "--status", "--plan", "--skip-healthy", "--no-wait", "--auto-rollback",
  "--restart-validate", "--print-phases", "--print-waves",
  "--only", "--from", "--until", "--canary", "--wave-timeout",
]);
const NAPOVEDA = `aisha-redeploy — nasazení stacku po vlnách

  bez přepínače  APPLY: NASADÍ (výchozí režim je execute)
  --plan         ukáže plán vln a cíle; NENASAZUJE
  --status       jen výpis stavu aplikací
  --only=a,b     jen vyjmenované krátké názvy (např. core,exec)
  --from=N       začni vlnou N (výchozí 0)
  --until=N      skonči vlnou N
  --canary=app   jediná aplikace + rozšířené ověření
  --skip-healthy přeskoč aplikace, které jsou zdravé
  --no-wait      nečekej na zdraví (na doběhnutí nasazení se čeká vždy)
  --auto-rollback při selhání zkus nasadit poslední známý dobrý stav
  --restart-validate  restartuje NASAZENÝ stav po vlnách a měří návrat do zdraví
  --wave-timeout=S    strop čekání na vlnu (výchozí 300)
  --print-phases fáze pro cold-start, bez identity
  --print-waves  pořadí nasazení „vlna<TAB>role[<TAB>strop práce s]" pro CI, bez identity`;
{
  const nezname = argv.filter((a) => a.startsWith("-") && !ZNAME_PREPINACE.has(a.split("=")[0]));
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(NAPOVEDA);
    process.exit(0);
  }
  if (nezname.length) {
    console.error(`aisha-redeploy: neznámý přepínač: ${nezname.join(" ")}\n`);
    console.error(NAPOVEDA);
    process.exit(2);
  }
}

const flag = (name) => argv.includes(name);
const arg = (name) => {
  const m = argv.find((a) => a.startsWith(`${name}=`));
  return m ? m.slice(name.length + 1) : null;
};
const STATUS_ONLY = flag("--status");
const PLAN_ONLY = flag("--plan");
const SKIP_HEALTHY = flag("--skip-healthy");
const NO_WAIT = flag("--no-wait");
const ONLY = arg("--only"); // comma-separated short names: netbird,core
// VÝCHOZÍ 0, ne 1 (opraveno 2026-08-11). Vlna 0 (warmup — hostitelské sítě)
// se přidala do WAVES, ale výchozí `--from=1` ji TICHE PŘESKAKOVAL: log šel
// rovnou na "Wave 1", na hostech nevznikl jediný netinit kontejner a varra
// zůstala bez sítí. Přidat vlnu do pole ještě neznamená, že se provede —
// brány kontrolovaly, že vlna existuje v manifestu, ne že běží.
const FROM_WAVE = parseInt(arg("--from")?.replace(/^wave/, "") || "0", 10);
const UNTIL_WAVE = parseInt(arg("--until")?.replace(/^wave/, "") || "999", 10);
const CANARY = arg("--canary");  // single short app name (e.g. "keycloak"); deploys 1 app + extended verify
const AUTO_ROLLBACK = flag("--auto-rollback");  // try Coolify API to redeploy last-known-good deployment on failure
// Restart validace: NEROZDÁVÁ nový kód ani env — restartuje nasazený stav po
// vlnách a měří, že se sám vrátí do zdraví. Odpovídá na jinou otázku než deploy:
// ne "jde to postavit?", ale "vrátí se to po restartu?" (rodina from-zero zelené /
// restart rozbitý). Cold-start ji volá na konci wipu, po úklidu warmupů — tím se
// zároveň prokazuje, že nic za běhu nezávisí na netinit hlídce a že hostitelské
// sítě přežily její smazání.
const RESTART_VALIDATE = flag("--restart-validate");
if (RESTART_VALIDATE) {
  // Kombinace, které popírají smysl měření, jsou chyba — ne tichá volba.
  const conflict = [SKIP_HEALTHY && "--skip-healthy (restartujeme právě zdravé)",
                    NO_WAIT && "--no-wait (restart bez měření návratu nic nevaliduje)",
                    CANARY && "--canary (kanárek je deploy režim)"].filter(Boolean);
  if (conflict.length) {
    console.error(`--restart-validate nelze kombinovat s: ${conflict.join("; ")}`);
    process.exit(2);
  }
}

// Tunable timeouts — precedence: --flag > env (config/cold-start-timeouts.env) > default
// Source-uj `config/cold-start-timeouts.env` před spuštěním pro per-env override.
const WAVE_TIMEOUT_S = parseInt(arg("--wave-timeout") || process.env.AISHA_WAVE_TIMEOUT_S || "300", 10);
const HEALTH_POLL_S = parseInt(process.env.AISHA_HEALTH_POLL_S || "10", 10);
// Strop čekání na doběhnutí JEDNOHO nasazení při hlídaném spouštění — týž
// strop, jaký má čekání vlny (`HARD_CAP_MS` ve waitForHealthyOrFailedDeploy).
const STROP_NASAZENI_S = Math.max(WAVE_TIMEOUT_S * 6, 1800);

// Snapshot directory — captures pre-wave deployment state for rollback recipes.
// Coolify v4 nemá API endpoint pro "redeploy specific past deployment", takže
// rollback je manuální (přes UI). Snapshoty slouží jako zdroj pro rollback
// recipe v error reportu.
const SNAPSHOT_DIR = process.env.AISHA_SNAPSHOT_DIR || join(ROOT, ".coolify-deploy-snapshots");

// Story/app name prefix: a fork/story deploy names its Coolify apps <prefix>-*
// (APP_NAME_PREFIX, #600); default "aisha" = the upstream stack (unchanged). The
// wave DAG + discovery below are authored with aisha- literals — parametrise them
// so the orchestrator finds the fork's own apps, not the upstream namespace.
//
// appPrefix() reads APP_NAME_PREFIX from process.env ONLY and silently defaults
// to "aisha" (the upstream stack) when it is absent. Running this tool STANDALONE
// in a fork worktree — the env var not exported, but the deploy artifact
// (.env.coolify) carrying APP_NAME_PREFIX=<prefix> — would therefore target the
// UPSTREAM aisha-* apps, not the fork's own. Resolve the identity from the shared
// canonical config chain (.env.coolify → .env-prod-backup, same chain the Coolify
// URL/token/project are read from just below) into process.env BEFORE appPrefix()
// so the orchestrator self-identifies from the deploy artifact rather than a
// manual export. Cold-start still exports it (fast path); this only fills the gap.
if (!process.env.APP_NAME_PREFIX) {
  const prefixFromChain = readConfigKey("APP_NAME_PREFIX");
  if (prefixFromChain) {
    process.env.APP_NAME_PREFIX = prefixFromChain.replace(/^["']|["']$/g, "");
  }
}
// `--print-phases` vypisuje STATICKOU strukturu vln — čísla, která na instanci
// nezávisí. Nesmí proto chtít ani pověření (viz COOLIFY_BASE níž), ani IDENTITU:
// v CI checkoutu žádný `.env.coolify` není, takže by `appPrefix()` vyhodil a
// brána `cislo-vlny-ma-jeden-domov` by se nespustila. Do 2026-08-24 to bylo
// skryté tím, že `appPrefix()` tiše dosazoval „aisha" — což byl přesně ten
// fallback, kvůli kterému běh mohl mířit na CIZÍ instanci.
// Totéž platí pro `--print-waves`: pořadí rolí je vlastnost repa a čte ho CI,
// které identitu instance ani pověření k Coolify nemá.
const IDENTITA_NENI_TREBA = process.argv.includes("--print-phases") || process.argv.includes("--print-waves");
const APP_PREFIX = IDENTITA_NENI_TREBA ? "" : appPrefix();
// Přemapování jmen na TUTO instanci se dělá jen tam, kde jména VYUŽIJEME.
// Při `--print-phases` se tisknou čísla vln, ne aplikace — a trvat tam na
// identitě znamená, že brána v CI (kde `.env.coolify` není) nástroj vůbec
// nespustí. Do 2026-08-24 to bylo skryté tichým dosazením „aisha".
const remapNaInstanci = (n) => (IDENTITA_NENI_TREBA ? n : toStoryApp(n));
const APP_PREFIX_DASH = `${APP_PREFIX}-`;
// toStoryApp is imported from lib/story-app.mjs (shared prefix-remap abstraction).
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");

// ── Config ───────────────────────────────────────────────────────────────────
const ENV_BACKUP = resolve(ROOT, ".env-prod-backup");

// Read a single KEY=value from .env-prod-backup (durable operator config).
// Used as the last-resort source so this tool resolves the same way the rest of
// the cold-start toolchain does — nothing is hardcoded; all infra config flows
// from env or .env-prod-backup.
function readBackupKey(key) {
  if (!existsSync(ENV_BACKUP)) return "";
  for (const line of readFileSync(ENV_BACKUP, "utf8").split(/\r?\n/)) {
    if (line.startsWith(`${key}=`)) {
      return line.slice(key.length + 1).trim().replace(/^["']|["']$/g, "");
    }
  }
  return "";
}

const COOLIFY_BASE = (() => {
  // Name drift across the toolchain: doctor + cold-start use COOLIFY_URL,
  // this tool historically required COOLIFY_BASE_URL. Resolve both, from env
  // first then .env-prod-backup, so `npm run redeploy:status` works out of the
  // box without the operator having to re-export an alias.
  const v = (
    process.env.COOLIFY_BASE_URL ||
    process.env.COOLIFY_URL ||
    readBackupKey("COOLIFY_BASE_URL") ||
    readBackupKey("COOLIFY_URL") ||
    ""
  ).replace(/^["']|["']$/g, "").replace(/\/+$/, "");
  if (!v) {
    // `--print-phases` vypisuje STATICKOU strukturu vln — žádné volání API.
    // Kdyby si vyžádalo přihlašovací údaje, nespustí ho brána v CI ani fork,
    // který Coolify nepoužívá, a hranice fází by se opsaly ručně. Přesně ten
    // druhý domov, kvůli kterému tenhle kanál vzniká.
    if (IDENTITA_NENI_TREBA) return "";
    process.stderr.write(
      "FATAL: Coolify base URL required — set COOLIFY_BASE_URL or COOLIFY_URL (env or .env-prod-backup)\n",
    );
    process.exit(2);
  }
  return v;
})();

function loadToken() {
  // Viz COOLIFY_BASE výš: statický výpis hranic fází nesmí chtít tajemství.
  if (IDENTITA_NENI_TREBA) return "";
  if (process.env.COOLIFY_API_TOKEN) {
    return process.env.COOLIFY_API_TOKEN.replace(/^["']|["']$/g, "");
  }
  if (!existsSync(ENV_BACKUP)) {
    throw new Error(`COOLIFY_API_TOKEN not set and ${ENV_BACKUP} missing`);
  }
  for (const line of readFileSync(ENV_BACKUP, "utf8").split(/\r?\n/)) {
    if (line.startsWith("COOLIFY_API_TOKEN=")) {
      return line.slice("COOLIFY_API_TOKEN=".length).trim().replace(/^["']|["']$/g, "");
    }
  }
  throw new Error("COOLIFY_API_TOKEN not found");
}
const TOKEN = loadToken();

// ── Color helpers ────────────────────────────────────────────────────────────
const C = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  blue: (s) => `\x1b[34m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};
const log = (...a) => console.log(...a);
const info = (s) => log(`  ${C.blue("ℹ")} ${s}`);
const ok = (s) => log(`  ${C.green("✓")} ${s}`);
const warn = (s) => log(`  ${C.yellow("⚠")} ${s}`);
const errLog = (s) => log(`  ${C.red("✗")} ${s}`);

// ── Coolify HTTP client ──────────────────────────────────────────────────────
// ⛔ TENHLE SKRIPT SI DO 2026-08-25 VOZIL VLASTNÍ KOPII KLIENTA — jednu z devíti.
// `scripts/lib/coolify-http.mjs` se v vlastní hlavičce jmenuje „single source of
// truth for the retry/timeout behavior", a devět skriptů ho obcházelo. Kopie se
// rozešly přesně tam, kde to bolí: ŽÁDNÁ z devíti nectila `Retry-After` a šest
// z nich neumělo 429 vůbec. Držet dvě těla téhož klienta znamená opravovat
// pokaždé jen to, na které zrovna koukám.
//
// Jediný důvod, proč kopie existovala, byl per-volání `timeoutMs` — ten sdílený
// klient teď umí, takže kopie ztratila i tu poslední záminku.
// ⛔ KLIENT SE STAVÍ AŽ PŘI PRVNÍM POUŽITÍ. `createCoolifyClient` ověřuje
// pověření HNED při stavbě, kdežto původní lokální `async function coolify`
// se o token opřela až ve chvíli volání. Postavit ho v modulovém rozsahu proto
// shodilo `--print-phases`, který MÁ odpovídat bez pověření (hranice fází jsou
// vlastnost repa, ne stacku) — chytila to brána `cislo-vlny-ma-jeden-domov`.
let _coolifyKlient = null;
const coolify = (path, options) => {
  if (!_coolifyKlient) {
    _coolifyKlient = createCoolifyClient({
      baseUrl: COOLIFY_BASE,
      token: TOKEN,
      // Coolify v4 má úseky ~20–40s pomalosti (zakládání aplikací, cold-start);
      // 10s jednorázový fetch z toho dělal falešné AbortError.
      timeoutMs: 60_000,
      maxRetries: 3,
    });
  }
  return _coolifyKlient(path, options);
};

// ── Wave plan ────────────────────────────────────────────────────────────────
// Gate definition:
//   app   — name of required app
//   hard  — true:  app must be running:healthy or running:*  (fully up, e.g. Keycloak OIDC)
//           false: app just must not be "exited" (e.g. PKI — may lack HTTP healthcheck)
//   url   — public/internal HTTP endpoint that must return one of `statuses`
//
// Dependency map (verified from docker-compose.coolify-*.yml, 2026-04-26):
//   aisha-core (= aisha-db) ← keycloak, netbird, observability, orchestration,
//                              admin, messaging  (HARD: all use aisha-db host)
//   aisha-keycloak          ← netbird (HARD: IDP discovery at boot),
//                              observability/orchestration/admin (SOFT: OAuth2-proxy runtime),
//                              exec (SOFT: KEYCLOAK_URL runtime)
//   aisha-pki               ← only OAuth2-proxy UI (runtime, not startup)
//   aisha-netbird (mgmt)    ← integration/ledger/exec (SOFT: sidecar agent,
//                              failure does not block main container)

// pki-bridge readiness is gated via the aisha-pki app's aggregate CONTAINER
// health (Coolify API), NOT an HTTP fetch — see the wave-4 gate below for why an
// HTTP gate cannot work for an operator running cold-start off the mesh.

// Strop PRÁCE nasazení (od opuštění fronty Coolify) pro aplikace, které se do
// výchozích 1800 s `deploy-and-verify.sh` DOLOŽENĚ nevejdou. Jen z MĚŘENÍ, ne
// z odhadu; ostatní appky mají výchozí strop skriptu. `--print-waves` ho vydá
// jako třetí sloupec a `nasad-podle-vln.sh` ho předá jako `--timeout-s`.
// Jeden domov: vedle pořadí vln, ze kterého CI nasazuje.
//   aisha-domain-services — NAMĚŘENO 2026-09-26 (<fork>, vlna 7): stavba 13 obrazů
//   na build serveru + přenos na cíl + start = 37 min (fronta zvlášť 10 min);
//   už 2026-09-24 přetáhla 1800 s. Strop 3600 s ≈ 1,6× naměřeného.
const STROP_PRACE_S = { "aisha-domain-services": 3600 };

const WAVES = [
  {
    num: 0, name: "Warmup — hostitelské sítě instance",
    // PROČ VLNA 0: síť je zdroj HOSTITELE, ne aplikace, a všechny ostatní stacky
    // ji berou jako `external: true` — tedy jako slib, že už existuje.
    //
    // Nemůže si ji založit stack sám: compose ověřuje externí sítě PŘED spuštěním
    // prvního kontejneru (změřeno 2026-08-11 — s neexistující sítí nevznikl ani
    // init kontejner s `network_mode: none`). A kdyby ji stack VLASTNIL
    // (ne-external), mazal by ji při teardownu a nasazení by spadlo, jakmile na
    // ní visí kontejner jiného projektu — přesně tak umřel aisha-clamav
    // ("network ... has active endpoints").
    //
    // Warmup je proto samostatná aplikace: nedeklaruje žádnou externí síť, přes
    // docker.sock sítě idempotentně založí a skončí. Jedna na každé placement,
    // protože Coolify aplikace běží na JEDNOM serveru. Cold-start ji po dokončení
    // rolloutu smaže, takže přístup k socketu není stálý.
    apps: ["aisha-netinit-frontend", "aisha-netinit-backend", "aisha-netinit-experimental"],
    gates: [],
    // DŮKAZ ODVEDENÉ PRÁCE: netinit po založení sítí NEskončí — drží hlídku a
    // jeho healthcheck je `docker network inspect` obou sítí na hostiteli.
    // running:healthy tedy PŘÍMO znamená "sítě existují" a vlna 0 je obyčejná
    // vlna bez speciálních větví. Proč ne jednorázový kontejner: "deployment
    // finished" říká jen "compose up -d vrátil nulu" (kontejner se SPUSTIL),
    // a Coolify u exited aplikace odmítá i logy (změřeno 2026-08-11: GET /logs
    // → 400 "Application is not running"), takže by úspěch nešel ověřit vůbec.
    // Hlídku po dokončení rolloutu smaže cold-start (remove_warmup_apps).
  },
  {
    num: 1, name: "Registry cache + shared Redis",
    // aisha-shared-redis: ACL Redis instance (docker-compose.coolify-shared-redis.yml),
    // pure infra with zero container deps — like the registry it only needs to be
    // reachable. It MUST be healthy before its consumers come up: the WS db_changes
    // fabric (event-worker/ws-gateway in wave 4) and core's svc-mcp-knowledge (wave 2).
    //
    // ⛔ POZOR NA JMÉNO VLNY (2026-08-24): shared-redis se tu UŽ NENASAZUJE.
    // Je to mesh peer, takže musí přijít AŽ ZA vznikem meshe (vlna 7) — jinak
    // se jeho agent nemá kam zapojit (naměřeno 2026-08-22). Text výš popisuje
    // původní pořadí; ponechán, protože vysvětluje, PROČ na Redisu konzumenti
    // stojí. Jméno vlny zůstává historické.
    apps: ["aisha-registry"],
    gates: [],
  },
  {
    num: 2, name: "Kořen důvěry + skutečně samostatné",
    // ⛔ ROZDĚLENO 2026-08-13. Tahle vlna se dřív jmenovala „Core infra
    // (parallel, self-contained)" a vezla core+edge SPOLU s pki. Jenže
    // self-contained nebyly: `pki-init` v nich volá pki-bridge, tedy službu,
    // která startuje VEDLE nich. Změřeno: pki-init spouští 16 compose souborů,
    // z toho dva (core, edge) byly v téže vlně jako jejich závislost.
    //
    // Ta závislost existovala, jen NEBYLA VYJÁDŘENA POŘADÍM — degradovala se na
    // 600 s opakování uvnitř assemble-ca-bundle.sh, jehož vlastní komentář ten
    // závod popisuje („RACE — wave 2 starts aisha-core, aisha-pki and aisha-edge
    // in PARALLEL"). Čekání na náhodu není závislost. Vlny ji vyjádřit umí,
    // tak ji vyjadřujeme.
    //
    // PKI je tu samo, protože fáze „samorodá důvěra" (OpenXPKI si při prvním
    // bootu vyrobí realm CA z náhodného klíče) nezávisí na NIČEM — ani na
    // Keycloaku, ten je potřeba až pro VYDÁVÁNÍ certů (vlna 5+).
    //
    // livekit: LiveKit SFU + coturn (docker-compose.coolify-livekit.yml). Self-contained
    // — z cizích stacků nepotřebuje NIC: v compose jsou jen `TURN_*` a
    // `NETBIRD_DNS_IP` (žádný Keycloak, Redis ani Postgres). Veřejně je za
    // edge-proxy (`live.${PUBLIC_TLD}`), takže vrstva je backend.
    // Musí být PŘED svým konzumentem: Matrix RTC / element-call v poslední vlně.
    // ZŮSTÁVÁ tady: na pki opravdu nezávisí (ověřeno v compose).
    //
    // ⛔ clamav ODSUD ODEŠEL 2026-08-21 (konverze na mesh). Dostal netbird-agent,
    // a ten závisí na `pki-init`, který volá pki-bridge — tedy přesně ta
    // závislost, kvůli které se tahle vlna rozdělila. Nechat ho vedle pki by
    // znamenalo vrátit závod, který komentář výš popisuje. Teď je ve vlně 3.
    apps: ["aisha-pki"],
    gates: [
      // Fresh cold-start pulls Docker Hub images through ${REGISTRY_DOMAIN}.
      { app: "aisha-registry", hard: true },
    ],
  },
  {
    num: 3, name: "Konzumenti důvěry (core)",
    // Oddělené z původní vlny 2 — viz komentář výš. Tyhle stacky spouštějí
    // `pki-init`, který si vyzvedne CA bundle; kolokovaní jdou přímo po warmup
    // síti (http://pki-bridge:3040), cross-host přes bootstrap výjimku.
    //
    // Upload-path scanning consumers (storage-auth / svc-web-artifact v core)
    // fail-closed dokud neběží clamd. clamav sem PŘIŠEL z vlny 2 (2026-08-21,
    // konverze na mesh): jeho netbird-agent závisí na pki-init → pki-bridge,
    // takže patří mezi konzumenty důvěry, vedle core. Paralelně s core je to
    // v pořádku — core na clamd čeká fail-closed až za běhu, ne při startu.
    apps: ["aisha-core", "aisha-clamav"],
    gates: [
      // TVRDÁ brána: tohle je ta závislost, která se dřív řešila 600sekundovým
      // opakováním. Bez běžícího pki nemá `pki-init` koho se zeptat.
      { app: "aisha-pki", hard: true },
      { app: "aisha-registry", hard: true },
    ],
  },
  {
    num: 4, name: "Auth (Keycloak)",
    // ⛔ EDGE JE TU ZÁMĚRNĚ (naměřeno při wipu 2026-08-24). Fáze B cold-startu
    // (import realmu, provision-sso, bootstrap uživatel) sahá na Keycloak
    // ZVENČÍ — operátor je mimo mesh, takže vnitřní jméno nepřeloží. Jediná
    // cesta je VEŘEJNÁ tvář auth, a tu obsluhuje edge.
    //
    // Když edge zůstal až na konci (vlna 10), fáze B narazila na:
    //     /health/ready: 000 (url=https://<fork>-auth.backend.<internal>)
    //     auth.<public>: 503        ← edge nenasazený
    // a bootstrap se zastavil s BĚŽÍCÍM, ZDRAVÝM Keycloakem o jeden skok dál.
    //
    // Není to výjimka z pravidla „vše meshem" — je to TA ZAPSANÁ výjimka:
    // auth musí být dosažitelný dřív, než mesh vůbec vznikne, protože na něm
    // stojí i přihlášení netbirdu samotného. Po vzniku meshe se edge znovu
    // nasadí ve vlně 6 a zapojí se do něj.
    // ⛔ EDGE TU BYL PŮL DNE (2026-08-24) A BYLA TO CHYBA. Přidal jsem ho jako
    // „dveře pro bootstrap" — jenže tím se veřejná plocha otevírala PŘED meshem,
    // přesně proti pravidlu „nikdo dovnitř jinak než přes mesh". Operátorský šev
    // (KC admin API mimo mesh) řeší SSH kanál ve fázi B cold-startu, ne edge.
    // Viz docs/architecture/NASAZOVACI_TOK_A_MESH_MAPA.md.
    apps: ["aisha-keycloak"],
    gates: [
      // KC only needs aisha-db (inside core stack). SOFT because cold-start
      // core stays "restarting" until KC is up (svc-plugin-system/svc-mcp-knowledge
      // need KC_JWKS_URL). Hard gate would deadlock.
      { app: "aisha-core", hard: false },
    ],
  },
  {
    num: 5, name: "Vznik meshe (netbird)",
    // ⭐ FÁZE 1 KONČÍ TADY. Do téhle chvíle mesh NEEXISTUJE, takže všechno výš
    // nutně běží na interní síti — ne z volby, ale protože není kam se připojit.
    //
    // ⛔ MUSÍ BÝT AŽ ZA KEYCLOAKEM — doloženo PÁDEM 2026-08-22. `netbird-management`
    // si při bootu tahá OIDC konfiguraci z IdP endpointu (management.go:252) a bez
    // ní KONČÍ s exit 1: `OIDC configuration request returned status 503`.
    // Krátce jsem ho posunul PŘED auth s odůvodněním, že compose nemá ANI JEDNO
    // aktivní čekání a agenti se enrollují setup klíčem. Obojí platí — a ani jedno
    // neměří, co dělá SAMA BINÁRKA při startu. Nedeklarovaná závislost není
    // neexistující závislost, jen nezapsaná.
    //
    // ⛔ SEM PŘIŠEL Z VLNY „DB+OIDC apps" (2026-08-22). Ležel mezi aplikacemi,
    // které OIDC potřebují, jako by ho potřeboval taky. NEPOTŘEBUJE:
    //   · má VLASTNÍ `netbird-db` (depends_on: netbird-db, netbird-init) — na
    //     `core` tedy nečeká vůbec;
    //   · na Keycloak nemá ANI JEDNO aktivní čekání (změřeno: 0). KC potřebuje
    //     až k ověřování tokenů, tedy když se přihlašuje ČLOVĚK;
    //   · agenti se enrollují SETUP KLÍČEM (`NB_SETUP_KEY`, `--setup-key`)
    //     a v konfiguraci agenta je NULA zmínek o OIDC.
    // Mesh tedy může vzniknout dřív než auth — a musí, protože všechno za ním
    // má startovat rovnou v meshi místo aby se do něj přepojovalo dodatečně.
    //
    // Na `pki` závisí doopravdy: `netbird-internal-tls → pki-init`.
    apps: ["aisha-netbird"],
    gates: [
      // ⛔ `pki` JE ZÁMĚRNĚ MĚKKÁ — doloženo DEADLOCKEM 2026-08-23 (dvakrát).
      // Tvrdá brána tu byla s odůvodněním „bez BĚŽÍCÍHO pki nemá pki-init koho
      // se zeptat". Záměr je správný, měřidlo ne: brána se ptá na zdraví CELÉ
      // aplikace, a to zahrnuje i `netbird-agent`, jehož healthcheck testuje
      // ČLENSTVÍ V MESHI (`wt0` má adresu 100.x). Ve fázi 1 mesh neexistuje,
      // takže ta podmínka nemůže platit — a vznikl uzavřený kruh:
      //   vlna 5 čeká na zdravé pki → pki je nezdravé kvůli agentovi
      //   → agent čeká na management → management se nenasadí, protože vlna čeká
      // Následek: netbird 0 kontejnerů, 29 aplikací přeskočeno, DVA běhy zahozené.
      //
      // ⭐ Že je ta otázka v téhle fázi neaplikovatelná, říká sonda sama:
      // `if [ -z "$NB_SETUP_KEY" ]; then exit 0; fi` — agent, který do meshe
      // nepatří, je zdravý. Ve fázi 1 tam nepatří NIKDO.
      //
      // Ochrana se neztrácí, jen se posouvá o krok: co netbird od PKI opravdu
      // potřebuje, jsou certifikáty z `pki-bridge`. Když ten neběží, selže
      // netbirdu jeho VLASTNÍ `pki-init` a stack spadne s jasnou hláškou —
      // místo aby se čekalo na zdraví, které v téhle fázi nastat nemůže.
      { app: "aisha-pki", hard: false },
      // Keycloak TVRDĚ zůstává: bez OIDC konfigurace management končí exit 1
      // (management.go:252) — to je pád binárky, ne nedostupný sousední kontejner.
      { app: "aisha-keycloak", hard: true },
    ],
  },
  {
    // ── Mesh warmup ──────────────────────────────────────────────────
    // Edge and core deploy in wave 2 (before netbird management). Their
    // netbird-agent sidecars fail to connect because management isn't up
    // yet. After wave 4 brings management online, we re-deploy edge so
    // netbird-edge gets a fresh `netbird up` against a live management
    // plane. This is the key to making mesh self-healing on cold-start.
    //
    // Core's netbird sidecar uses the internal TLS path (via PKI cert)
    // and reconnects automatically on its own schedule — re-deploying
    // core here would restart aisha-db which is disruptive. Edge is safe
    // to re-deploy because it's a stateless proxy layer.
    num: 6, name: "Přepnutí do meshe",
    // ⭐ TADY SE FÁZE 1 PŘEPÍNÁ DOVNITŘ. Stacky, které musely nastartovat na
    // interní síti (mesh tehdy neexistoval), se teď do meshe zapojí — a od téhle
    // chvíle je zbytek platformy výhradně v meshi.
    //
    // ⛔ DŘÍV TO BYL ZVLÁŠTNÍ PŘÍPAD PRO EDGE, a to až za polovinou startu.
    // Zobecněno 2026-08-22: přepnutí není vlastnost jedné aplikace, ale KONEC
    // jedné fáze — pustí se na každý stack, který fázi 1 tvořil.
    // ⛔ `aisha-edge` PŘIBYL 2026-08-24: vstává už ve vlně 4 (dveře pro bootstrap),
    // takže jeho netbird-agent tehdy neměl kam se zapsat — mesh ještě nebyl.
    // Tady se přenasadí PROTI ŽIVÉMU management plane a do meshe se zapojí.
    // Přesně ten self-healing vzor, který popisuje komentář výš.
    apps: ["aisha-registry", "aisha-pki", "aisha-core", "aisha-keycloak", "aisha-edge",
    // ⛔ MESH RESOLVER PATŘÍ SEM, NE DO EDGE (naměřeno 2026-09-06).
    // Do teď byl resolver JEDINÝ a bydlel uvnitř `edge`, tedy na jediném
    // serveru (placement frontend). Síť mesh-dns si přitom netinit zakládá na
    // KAŽDÉM stroji, takže pinovaná adresa .250 vypadala platně všude — a na
    // ostatních strojích ji nedržel nikdo. 48 kontejnerů mělo `dns:` do prázdna,
    // mesh jména odtud nešla přeložit a `live.` vracelo 502, protože ws-gateway
    // nenašel sdílenou redis (EAI_AGAIN). Resolver je zdroj HOSTITELE: jeden na
    // stroj, stejně jako netinit ve vlně 0.
    // Musí být hotový PŘED vlnou 7, kde nabíhají mesh peeři (shared-redis,
    // realtime a spol.) — ti už jméno překládat potřebují.
      "aisha-mesh-router-backend", "aisha-mesh-router-experimental",
    ],
    gates: [
      // NetBird management must be at least "not exited" (SOFT).
      // It reports restarting:unknown due to init containers, but
      // the management server itself is functional.
      { app: "aisha-netbird", hard: false },
    ],
  },
  {
    num: 7, name: "DB+OIDC apps",
    // llm-gateway + openclaw (Phase 2 autopilot, tier=optional) join this
    // wave because deps overlap exactly with admin/observability/
    // orchestration: aisha-db (in core) + aisha-keycloak (OIDC). Both are
    // advisory-tier services off the autonomous AISHA hot path; safe to
    // fail without blocking later waves (SOFT semantics naturally).
    //
    // ai-chat + realtime (sibling stacks extracted from core at the ARG_MAX
    // ceiling) also land here: both need aisha-db + redis via the cross-stack
    // coolify-net aliases (core, SOFT below) and KC JWKS (HARD below). The
    // core gateway routes /functions/v1/ai-* → svc-ai-chat:3011 and proxies
    // ws-gateway:3002, so they must be up before the platform is usable —
    // but nothing container-level depends on them, hence SOFT_DEPLOY_APPS.
    //
    // local-ingest + potok (verified ingestion + flow-runtime loop, tier=
    // optional, provision_when_env-gated) join here too: local-ingest is
    // self-contained (writes files only — no DB), potok needs KC JWKS for
    // its oauth2 front + the Omni /v1 (svc-ai-chat, SOFT via core). Both
    // absent unless opted in — SOFT_DEPLOY_APPS keeps their failure isolated.
    //
    // pgadmin (extracted from core, 2026-07-15) rides here with aisha-admin:
    // it reaches db over the shared internal network and needs KC (wave 3).
    //
    apps: ["aisha-shared-redis", "aisha-observability", "aisha-orchestration", "aisha-admin", "aisha-pgadmin", "aisha-ai-chat", "aisha-realtime", "aisha-llm-gateway", "aisha-openclaw", "aisha-source-broker", "aisha-domain-services", "aisha-local-ingest", "aisha-potok", "aisha-extranet"],
    gates: [
      // aisha-core SOFT: these apps only need aisha-db (healthy inside core
      // stack). Core stays "restarting" during cold-start because auxiliary
      // containers (svc-plugin-system etc.) cycle until all deps stabilize.
      // stabilize: Phase B's operator re-migrate redeploys core RIGHT before
      // this wave, so core is legitimately mid-flap here — but triggering 11
      // OIDC apps against a half-up core crashed 8 of them (tenant 2026-07-18;
      // gate saw running:unhealthy, soft passed instantly, apps exited and
      // stayed down until a manual --from=4). Give core a bounded window to
      // reach running:healthy first; after it elapses, plain soft semantics
      // apply (proceed anyway — degraded is better than never).
      { app: "aisha-core", hard: false, stabilize: 360 },
      // KC HARD: netbird IDP discovery, OAuth2-proxy for admin/obs/orch.
      { app: "aisha-keycloak", hard: true },
      // aisha-pki (OpenXPKI CA + pki-bridge) must be DEPLOYED and running before
      // NetBird's pki-init requests the internal TLS cert. We gate on the
      // aisha-pki app's Coolify CONTAINER status, NOT an HTTP fetch:
      //   - Post mesh cutover the bridge lives at pki-bridge.mesh.<MESH_TLD>,
      //     resolvable ONLY from inside the NetBird mesh. The operator running
      //     cold-start is off-mesh, so an HTTP health gate can NEVER pass locally
      //     — this is exactly what aborted wave 4 ("fetch failed" on
      //     https://pki-bridge.mesh.aisha.internal/health).
      //   - SOFT (not hard): a multi-container PKI stack legitimately reports
      //     `starting:unknown` in Coolify (init container + healthcheck timing;
      //     cf. the "stable starting" note above), so a hard running:healthy gate
      //     would FALSE-BLOCK the whole cold-start. Soft = "pki deployed and not
      //     exited", which is the real prerequisite: pki-bridge is serving on
      //     :3040 for netbird's pki-init. If the cert isn't ready in time,
      //     netbird's caddy self-signs (fallback) and aisha-pki-renewer delivers
      //     the real mesh cert on its next short-poll cycle — self-healing.
      { app: "aisha-pki", hard: false },
    ],
  },
  {
    num: 8, name: "Self-contained services + sidecar agents",
    // observability-stack (Phase 12, tier=optional opt-in: Loki + Prometheus
    // + Grafana + OAuth2 Proxy) joins this wave because it needs MinIO from
    // the langfuse stack (aisha-observability, deployed in wave 4) to be
    // healthy. By wave 6, langfuse minio-init has run and provisioned the
    // aisha-loki-chunks + aisha-loki-ruler buckets via shared coolify net.
    // ⛔ `aisha-model` PŘIBYLO 2026-08-20. Manifest ho deklaruje
    // (`model:experimental`), `CHAT_GGUF_URL` bývá nastaven, takže ho
    // story-init v Coolify ZALOŽÍ — a přesto ho nevlastnila žádná vlna.
    // Následek: cold-start ho nechal `exited:unhealthy` s nula nasazeními
    // a `--only=model` na něj NEDOSÁHLO (filtruje uvnitř `wave.apps`).
    // Přesně ten „wave orphan", který popisuje hlavička nahoře i docstring
    // brány `redeploy-wave-coverage` — brána ho směla propustit escape
    // hatchem (b) `tier=optional`, jenže tenhle escape hatch jen DOKUMENTUJE
    // rozhodnutí, neopravuje ho. Docstring té brány říká rovnou, že volba
    // (a) je VŽDY bezpečná a preferovaná: `filterWaveApps()` cílí jen na
    // appky, které v Coolify opravdu existují, takže instalace bez
    // `CHAT_GGUF_URL` tenhle řádek prostě přeskočí.
    //
    // Vlna 7, protože `svc-model` je samostatný (vlastní obraz + GGUF váhy)
    // a má sidecar `netbird-agent` — táž třída jako zbytek téhle vlny.
    //
    // `aisha-playwright` PŘIBYLO 2026-08-21: konverze na mesh mu dala pki-init
    // (`build:`) a brána stack-bez-deploy-ulohy správně chtěla manifest I vlnu.
    // Samostatný E2E runner se sidecar agentem — táž třída jako zbytek vlny.
    apps: ["aisha-livekit", "aisha-integration", "aisha-ledger", "aisha-exec", "aisha-observability-stack", "aisha-monitoring", "aisha-model", "aisha-playwright"],
    gates: [
      // integration: own ES+RMQ, no aisha-db
      // ledger: cosmos validator, self-contained
      // exec: agent-runner, in-memory state
      // observability-stack: needs MinIO at minio:9000 via coolify net
      // All have netbird-agent SIDECAR (failure does not block main container).
      // SOFT gates — main containers boot regardless of dep state.
      { app: "aisha-core", hard: false },
      { app: "aisha-keycloak", hard: false },
      { app: "aisha-netbird", hard: false },
      // langfuse SOFT: provides MinIO for obs-stack Loki backend. If minio
      // isn't healthy yet, obs-stack's loki crashes but obs-stack overall
      // still boots (prometheus + grafana don't depend on minio).
      { app: "aisha-observability", hard: false },
    ],
  },
  {
    num: 9, name: "Messaging (Synapse)",
    apps: ["aisha-messaging"],
    gates: [
      // Core SOFT: only aisha-db needed, stack may be "restarting" during cold-start.
      { app: "aisha-core", hard: false },
      { app: "aisha-keycloak", hard: true },
    ],
    // Heavy stack (Synapse + Matrix bridges + appservices). If it stalls we
    // can re-issue with `--only=messaging` to retry just this wave.
  },
  {
    num: 10, name: "Edge — otevření dveří",
    // ⭐ FÁZE 3. Jediná vlna, po které je zvenku něco vidět.
    //
    // ⛔ EDGE BYL DŘÍV VE VLNĚ 3, tedy UPROSTŘED startu. Veřejné dveře se
    // otevíraly ve chvíli, kdy vnitřek teprve naskakoval — a co za nimi zrovna
    // nestálo, vracelo 502. Tady je až za VŠÍM: dokud se platforma zvedá, není
    // zvenku vidět nic, protože dveře nikdo neotevřel.
    //
    // Zároveň tím zmizel zvláštní případ: edge se dřív nasazoval DVAKRÁT (vlna 3
    // a pak „Mesh warmup"), protože se po vzniku meshe musel přeenrollovat.
    // Když mesh existuje dřív než on, stačí jednou.
    apps: ["aisha-edge",
        // Generátor statických stránek. ZA edge, protože čte skořápku,
        // kterou `web` zapisuje při svém startu do hostitelského adresáře instance
        // (WEB_RENDER_SHELL_HOST_DIR), a píše do WEB_RENDER_STATIC_HOST_DIR, který
        // tentýž `web` servíruje. Vlastní aplikace
        // (tier: optional) ZÁMĚRNĚ — jako kontejner uvnitř edge by po limitu
        // restartů shodil přes StopApplication celou veřejnou tvář.
        "aisha-web-render"],
    gates: [],
  },
];

/**
 * FÁZOVÉ HRANICE — jediný domov čísel vln.
 *
 * ⛔ NAMĚŘENO 2026-08-13: cold-start volal vlny doslovnými čísly (`--until=3`,
 * `--from=4 --until=4`, `--from=5`) na OSMI místech. Rozdělení vlny 2 by tedy
 * znamenalo přepsat osm nezávislých literálů — a jedno minout znamená TIŠE
 * PŘESKOČENOU VLNU, tedy nenasazený stack bez jediné chybové hlášky. Táž třída
 * „dvou domovů jedné hodnoty", jakou dnes zavíráme u aliasů a adres.
 *
 * Hranice se proto pojmenovávají podle TOHO, CO ODDĚLUJÍ, a odvozují se ze
 * `WAVES` — ne z čísel opsaných do jiného souboru. Přidání vlny je od teď
 * změna na JEDNOM místě.
 *
 * Význam fází (drží orchestraci cold-startu):
 *   A  všechno, co jde PŘED Keycloakem — kořen důvěry a jeho konzumenti
 *   B  Keycloak sám (cold-start mezi A a B provisionuje realm)
 *   C  aplikace, které potřebují KC realm (OIDC klienti)
 *   D  mesh a všechno za ním
 */
export const PHASE_BOUNDARIES = (() => {
  const numFor = (needle) => {
    const w = WAVES.find((x) => x.name.includes(needle));
    if (!w) {
      throw new Error(
        `PHASE_BOUNDARIES: ve WAVES není vlna obsahující "${needle}". ` +
          "Hranice fází se odvozují ze jmen vln — přejmenování vlny MUSÍ projít i sem, " +
          "jinak by cold-start spouštěl jiný rozsah, než si myslí.",
      );
    }
    return w.num;
  };
  const keycloak = numFor("Auth (Keycloak)");
  const oidcApps = numFor("DB+OIDC apps");
  const zbytek = numFor("Self-contained services");
  return {
    // ── OSA 1: realm hook (drží orchestraci cold-startu) ───────────────────
    A_UNTIL: keycloak,          // včetně Keycloaku: A dojede po vlnu s KC
    B_KEYCLOAK: keycloak,
    // ⛔ C ZAČÍNÁ U VZNIKU MESHE, ne u OIDC aplikací — naměřeno 2026-08-23.
    // Když jsem mezi Keycloak (A) a OIDC apps vložil vlny „Vznik meshe" a
    // „Přepnutí do meshe", spadly MIMO VŠECHNY FÁZE: A šlo 0–4, C bylo 7–7,
    // D od 8. Cold-start by tedy mesh NIKDY NEPOSTAVIL a tiše by ho přeskočil —
    // všechny brány přitom byly zelené, protože pokrytí vln fázemi NIKDO NEMĚŘIL.
    //
    // Patří do C (a ne do A), protože `netbird-management` si při bootu tahá
    // OIDC konfiguraci — realm tedy musí existovat, a ten se provisionuje
    // právě mezi A a C.
    // ⭐ C = JEN vznik meshe. Mezi C a D běží `netbird-bootstrap.sh`, který
    // vyrábí skupiny a SETUP KLÍČE — a ty potřebuje KAŽDÝ mesh peer, aby se
    // mohl zaenrollovat. Kdyby C sahalo dál, peery by startovaly DŘÍV, než
    // klíče existují, a skončily by na `setup key is invalid`.
    // (Naměřeno 2026-08-23 ručně: 4 stacky přesně takhle uvízly.)
    //
    // ⛔ V PŮVODNÍM pořadí tenhle problém nebyl, protože `netbird` ležel UVNITŘ
    // vlny „DB+OIDC apps“. Když jsem mu dal vlastní vlnu, hranice C zůstala na
    // OIDC aplikacích a mesh peery se tím ocitly PŘED bootstrapem. Přeskládat
    // vlny znamená přepojit i všechno, co na tom pořadí visí.
    C_FROM: numFor("Vznik meshe"),
    C_UNTIL: numFor("Vznik meshe"),
    D_FROM: numFor("Přepnutí do meshe"),
    LAST: Math.max(...WAVES.map((w) => w.num)),

    // ── OSA 2: mesh (kdy vůbec existuje síť, do které se lze připojit) ─────
    // Tohle NENÍ jiné dělení téhož — je to druhá, nezávislá otázka. Osa 1 se
    // ptá „má už Keycloak realm?", osa 2 „existuje už mesh?". Splynuly by jen
    // náhodou a jejich smíchání je přesně to, co drželo netbird mezi OIDC
    // aplikacemi, jako by na auth čekal (2026-08-22 změřeno: nečeká).
    MESH_GENESIS_UNTIL: numFor("Vznik meshe"),   // do sem mesh NEEXISTUJE
    MESH_SWITCH: numFor("Přepnutí do meshe"),    // fáze 1 se zapojuje dovnitř
    EDGE: numFor("Edge — otevření dveří"),       // teprve teď je zvenku vidět
  };
})();

// Story-scope the wave DAG: rewrite the hardcoded aisha- app names to the
// story's prefix so a fork deploy targets ITS apps (no-op for the upstream stack).
//
// The arrow wrapper is load-bearing, NOT style: `.map(toStoryApp)` passes map's
// (element, INDEX, array) into toStoryApp(name, env = process.env), so `env`
// became the array index — appPrefix(0) reads APP_NAME_PREFIX off a NUMBER,
// gets undefined, and falls back to "aisha". The remap silently no-op'd, wave
// apps stayed aisha-*, and filterWaveApps intersected them against a <prefix>-* map:
// "(no targets)" for EVERY wave → not one container ever deployed, while the
// downstream KC/NetBird smokes then failed on services nothing had brought up.
// Invisible upstream (prefix IS "aisha", so the no-op is indistinguishable from
// correct); breaks every fork. Diagnosed 2026-07-16.
// Prázdný APP_PREFIX znamená „identitu jsme NEPOTŘEBOVALI" (`--print-phases`),
// ne „instance je aisha". Bez téhle podmínky by se přemapování spustilo
// i tam, kde jméno instance nikdo nedeklaroval — a `toStoryApp` by vyhodil.
if (APP_PREFIX && APP_PREFIX !== "aisha") {
  for (const wave of WAVES) {
    if (Array.isArray(wave.apps)) wave.apps = wave.apps.map((n) => remapNaInstanci(n));
    if (Array.isArray(wave.gates)) wave.gates = wave.gates.map((g) => ({ ...g, app: remapNaInstanci(g.app) }));
  }
}

// Apps treated as healthy when status indicates running/healthy.
function classifyStatus(s = "") {
  if (s.startsWith("running:healthy")) return "healthy";
  if (s.startsWith("running:unhealthy")) return "unhealthy";
  if (s.startsWith("running")) return "running";
  if (s.startsWith("starting")) return "starting";
  if (s.startsWith("restarting")) return "restarting";
  if (s.startsWith("exited")) return "exited";
  if (s.startsWith("degraded")) return "degraded";
  return "unknown";
}
function statusColor(cls) {
  return (
    {
      healthy: C.green,
      running: C.green,
      starting: C.cyan,
      unhealthy: C.yellow,
      restarting: C.yellow,
      degraded: C.yellow,
      exited: C.red,
      unknown: C.dim,
    }[cls] || C.dim
  );
}

// ── State inspection ─────────────────────────────────────────────────────────
async function fetchApps() {
  const all = await fetchProjectApps();
  // Confine to OUR project's environments. fetchProjectApps prefers the
  // project-env endpoint (already scoped) but FALLS BACK to the global
  // /applications list — that fallback would let redeploy touch another
  // tenant's same-named aisha-* app, so re-scope here. Fail-loud without
  // COOLIFY_PROJECT_UUID (no global fallback).
  const scope = await createProjectScope(coolify);
  const map = new Map();
  for (const a of all) {
    if (scope.inProject(a) && a.name?.startsWith(APP_PREFIX_DASH)) map.set(a.name, a);
  }
  return map;
}

// Project-scoped application list. Prefers the project-environment endpoint
// `GET /projects/{uuid}/{env}` (only THIS project's apps → ~32s) over the
// GLOBAL `GET /applications`, whose body grows past the request timeout once
// the full stack exists (timeouts mid-body — incident 2026-06-03). Falls back
// to the global list when the project/env identity is unknown.
const COOLIFY_PROJECT_UUID = (
  process.env.COOLIFY_PROJECT_UUID ||
  readBackupKey("COOLIFY_PROJECT_UUID") ||
  ""
).replace(/^["']|["']$/g, "");
const COOLIFY_ENVIRONMENT = (
  process.env.COOLIFY_ENVIRONMENT ||
  readBackupKey("COOLIFY_ENVIRONMENT") ||
  "production"
).replace(/^["']|["']$/g, "");
async function fetchProjectApps() {
  if (COOLIFY_PROJECT_UUID) {
    try {
      const env = await coolify(
        `/projects/${COOLIFY_PROJECT_UUID}/${COOLIFY_ENVIRONMENT}`,
      );
      if (Array.isArray(env?.applications)) return env.applications;
    } catch {
      // fall through to global list
    }
  }
  return coolify("/applications");
}

// ── Stuck-restart log capture ────────────────────────────────────────────────
// Když je app v `restarting:*` přes STUCK_RESTART_THRESHOLD_MS, fetch logs
// z Coolify API a uloží do snapshot dir. Pomáhá s diagnostikou outage —
// stuck:restarting obvykle znamená failed init container (např. migrate).
//
// Reference: docs/reports/INCIDENT_2026-04-29_FRONTEND_OUTAGE.md
const STUCK_RESTART_THRESHOLD_MS = parseInt(
  process.env.AISHA_STUCK_RESTART_MS || "120000",
  10,
); // 2 min default

async function fetchAppLogs(uuid, lines = 500) {
  try {
    const res = await coolify(`/applications/${uuid}/logs?lines=${lines}`, {
      timeoutMs: 15_000,
    });
    // Coolify response shape varies; try common keys
    return res?.logs || res?.body || (typeof res === "string" ? res : JSON.stringify(res));
  } catch (err) {
    return `(failed to fetch logs: ${err.message})`;
  }
}

async function captureStuckLogs(name, uuid, stuckMs) {
  if (NO_WAIT) return; // skip in fast-path mode
  if (!existsSync(SNAPSHOT_DIR)) {
    try {
      mkdirSync(SNAPSHOT_DIR, { recursive: true });
    } catch (err) {
      // Snapshot dir creation is best-effort diagnostics — failure here
      // (e.g. read-only fs in CI) must NOT abort the deploy wave.
      console.warn(`[redeploy] could not create snapshot dir ${SNAPSHOT_DIR}, skipping stuck-log capture:`, err);
      return;
    }
  }
  const logs = await fetchAppLogs(uuid, 500);
  const logPath = `${SNAPSHOT_DIR}/${RUN_ID}-${name}-stuck-restarting.log`;
  try {
    writeFileSync(
      logPath,
      `# ${name} stuck in restarting:* for ${Math.round(stuckMs / 1000)}s\n` +
      `# Captured: ${new Date().toISOString()}\n` +
      `# UUID: ${uuid}\n` +
      `# ────────────────────────────────────────────────────────\n\n` +
      logs,
    );
    warn(`  ⚠ ${name} stuck restarting ${Math.round(stuckMs / 1000)}s — logs: ${logPath}`);
  } catch (err) {
    warn(`  ⚠ failed to write stuck-restarting log for ${name}: ${err.message}`);
  }
}

function printStatusTable(apps) {
  log("");
  log(`${"NAME".padEnd(22)} ${"STATUS".padEnd(20)} LAST ONLINE`);
  log("─".repeat(70));
  for (const name of [...apps.keys()].sort()) {
    const a = apps.get(name);
    const cls = classifyStatus(a.status);
    const colored = statusColor(cls)((a.status || "?").slice(0, 19).padEnd(20));
    log(`${name.padEnd(22)} ${colored} ${a.last_online_at || "-"}`);
  }
  log("");
}

// ── Health waits ─────────────────────────────────────────────────────────────
// Apps known to be broken / config-pending — log warning but don't block waves.
//
// History note (kept as breadcrumb):
//   - aisha-messaging: was skipped pending host-level Docker pool extension
//     (`fix-docker-network-pools.sh`). Pool extended 2026-05-10; re-promoted.
//   - aisha-pki: OpenXPKI first-boot bootstrap was missing → "datasafe token"
//     / unhealthy pki-server. Resolved by 8fb646fc + 07e7f394 (compose-native
//     inline bootstrap in pki-server startup wrapper). Re-promoted 2026-05-11
//     because keeping it skipped silently broke netbird cert acquisition
//     (pki-bridge unreachable → caddy-internal-tls self-signed → mesh TLS
//     verify failures).
//   - aisha-observability: Langfuse stayed unhealthy due to authenticated
//     ClickHouse healthcheck timing out vs. /ping. Resolved by 8dfae9d4
//     (auth-free HTTP /ping). Re-promoted 2026-05-11.
const KNOWN_BROKEN = new Set([
  // History note (kept as breadcrumb):
  //   - aisha-openclaw: was skipped 2026-05-24 → 2026-05-25 because the
  //     placeholder image `${REGISTRY_DOMAIN}/openclaw/openclaw:v0.3.0`
  //     never existed on Docker Hub (PR #196 reverted PR #192's attempt).
  //     Re-promoted 2026-05-25: the daemon now lives in
  //     services/svc-openclaw/ (Fastify, builds from local Dockerfile,
  //     wires to AISHA llm-gateway + PostgREST via existing capabilities).
  //     If openclaw starts failing again, file a follow-up PR with the
  //     diagnostic — do NOT re-add it here without root-cause analysis.
].map((n) => remapNaInstanci(n))); // prefix-generic: match THIS deploy's APP_NAME_PREFIX, not only aisha-
// (arrow wrapper required — .map(toStoryApp) would feed map's index in as `env`; see WAVES remap)

// Apps whose deployment failure must NOT cascade-halt later waves.
//
// These are tier=optional / self-contained services: a deploy failure is
// isolated (no other stack depends on them at the container level) so it
// should be logged + surfaced in the summary, but the wave loop must still
// proceed to subsequent waves. Without this, a single optional service
// failing (e.g. aisha-ledger losing the cosmos RPC host port to a co-located
// tenant fork) would `break` the loop and silently skip everything after it
// (notably aisha-messaging in wave 7) — the cascade seen in the 2026-05-30
// cold-start --wipe. Critical apps (registry/core/keycloak/pki/edge/netbird/
// integration/messaging) are intentionally absent — their failure still halts,
// because later waves genuinely depend on them.
// Kolikrát smí vlna počkat na uvolnění fronty, než to vzdá. Každé kolo čeká
// `waitForDeploymentSlot` (výchozí rozpočet 40 min), takže tři kola pokrývají
// i cold-start, kde se do fronty nacpou všechny stacky najednou.
const ZPETNY_TLAK_KOL = Number(process.env.AISHA_BACKPRESSURE_ROUNDS || 3);

const SOFT_DEPLOY_APPS = new Set([
  "aisha-ledger",                // Cosmos validator — self-contained chain
  "aisha-exec",                  // agent-runner — in-memory state
  "aisha-observability-stack",   // Phase 12 opt-in (Loki/Prometheus/Grafana)
  "aisha-monitoring",            // Dozzle log viewer — tier=optional ops surface,
                                 //   self-contained (reads docker socket), nothing
                                 //   depends on it, so its failure must not skip waves
  "aisha-llm-gateway",           // Phase 2D autopilot — tier=optional
  "aisha-openclaw",              // Phase 2B autopilot — tier=optional
  "aisha-source-broker",         // federation broker — tier=optional, opt-in; absent
                                 //   unless SOURCE_API_URL set, so it must not block waves
  "aisha-extranet",              // customer surface — own container/compose; edge only
                                 //   routes its host. tier=optional, opt-in, so it
                                 //   must not block waves
  "aisha-local-ingest",          // verified document ingestion — tier=optional, opt-in;
                                 //   absent unless INGEST_BUNDLE_GIT_URL set, so it
                                 //   must not block waves
  "aisha-potok",                 // flow-definition runtime — tier=optional, opt-in;
                                 //   absent unless POTOK_ENABLED set, so it must
                                 //   not block waves
  "aisha-clamav",                // standalone clamd — consumers fail-closed, isolated
  "aisha-playwright",            // E2E runner — tier=optional, nic na něm nestojí;
                                 //   do manifestu i vln přibyl 2026-08-21 (mesh)
  "aisha-ai-chat",               // sibling stack — core gateway routes TO it; nothing
                                 //   container-level depends on it, so its failure must
                                 //   not skip waves 5-7 (still exits 1 via summary)
  "aisha-realtime",              // sibling stack — same isolation as ai-chat
  "aisha-domain-services",       // sibling stack — the domain svc-* fleet + storage-auth;
                                 //   core gateway routes TO them (cross-stack alias), nothing
                                 //   container-level depends on them, so their failure must
                                 //   not skip waves 5-7 (still exits 1 via summary)
  // Prefix-generic: remap the aisha-* literals above to THIS deploy's own prefix
  // (APP_NAME_PREFIX, e.g. acme-*). The wave app names are toStoryApp'd (see WAVES),
  // and failedNames therefore carry the story prefix — so an optional-app failure on
  // a story/fork deploy is recognised as SOFT here too, not mis-classified as a
  // critical failure that would halt the whole downstream cascade.
  // (arrow wrapper required — .map(toStoryApp) would feed map's index in as `env`; see WAVES remap)
].map((n) => remapNaInstanci(n)));

// Acceptable "deployed" states per app:
//   - healthy / running:*  → fully OK
//   - starting:*           → accept after STABLE_POLLS consecutive same-status polls
//                            (Coolify shows starting:unknown for stacks with healthcheck:disable)
//   - unhealthy            → accept after STABLE_POLLS (container is up, app-level
//                            healthcheck may fail e.g. NetBird agent without setup key)
//   - restarting / exited  → never OK
const STABLE_POLLS = parseInt(process.env.AISHA_STABLE_POLLS || "3", 10);
function isAcceptable(cls) {
  return cls === "healthy" || cls === "running" || cls === "starting" || cls === "unhealthy";
}
function isFullyHealthy(cls) {
  return cls === "healthy" || cls === "running";
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchDeploymentStatus(deploymentId) {
  if (!deploymentId) return null;
  const deployment = await coolify(`/deployments/${deploymentId}`, { timeoutMs: 20_000 });
  return deployment?.status || deployment?.deployment_status || deployment?.state || "unknown";
}

/**
 * Běží pro TUHLE aplikaci nasazení? Vrátí jeho uuid, jinak null.
 *
 * Univerzum je jedna aplikace — ne celá fronta. Čekat na „prázdnou frontu" je
 * globální podmínka pro lokální cíl: na sdíleném Coolify (10 projektů, 184
 * aplikací) prázdná skoro nikdy není, a nasazení cizího nájemníka s tímhle
 * spuštěním nekoliduje. Táž oprava jako u coolify-deploy-watch.mjs 2026-08-26:
 * univerzum měřidla musí být totéž jako univerzum jeho verdiktu.
 *
 * ⛔ ENDPOINT: `/deployments/applications/{uuid}`. Tvar
 * `/applications/{uuid}/deployments` (použitý v snapshotu níž) vrací 404 —
 * ověřeno 2026-09-02 proti živému API.
 *
 * Fail-OPEN schválně: když se stav nepodaří přečíst, spustíme nasazení jako
 * dosud. Nepřečtená odpověď nesmí zablokovat nasazení — to by z pojistky proti
 * duplicitě udělalo pojistku proti nasazení vůbec.
 */
async function bezicíNasazeniAplikace(uuid) {
  try {
    const odpoved = await coolify(`/deployments/applications/${uuid}?take=5`, { timeoutMs: 15_000 });
    const seznam = Array.isArray(odpoved?.deployments) ? odpoved.deployments
                 : Array.isArray(odpoved?.data) ? odpoved.data
                 : Array.isArray(odpoved) ? odpoved : [];
    for (const d of seznam) {
      const stav = String(d?.status || "").trim().toLowerCase();
      // Koncové stavy měříme PREFIXEM a bez ohledu na velikost písmen: Coolify
      // vedle `cancelled` používá i `cancelled-by-user` (ověřeno v DB: jediné
      // tři koncové hodnoty jsou finished/failed/cancelled-by-user), a rovnost
      // by ten druhý přečetla jako běžící.
      if (/^(finished|failed|cancelled)/.test(stav)) continue;
      // ⛔ PRÁZDNÝ STAV NENÍ „BĚŽÍ" (chyceno vlastním testem 2026-09-02).
      // Bez téhle řádky by záznam bez stavu vypadal jako rozdělané nasazení a
      // spuštění by se PŘESKOČILO — z pojistky proti duplicitě by se stala
      // pojistka proti nasazení vůbec. Nepřečtený stav se řeší fail-OPEN,
      // stejně jako výjimka níž.
      if (!stav) continue;
      const id = d?.deployment_uuid || d?.uuid || "";
      if (id) return id;
    }
    return null;
  } catch {
    return null;
  }
}

// Grace period (s) — když se deploy_uuid status stane "finished", Coolify
// app-level `last_online_at` může být zpožděně updated o desítky sekund. Bez
// grace period by jsme apps označili jako "exited:unhealthy" (= stale status
// z předchozího deploye/cold-startu) a wave by hlásilo false positive.
// 90s pokrývá většinu post-build → container-running → healthcheck-pass přechodů.
const FINISHED_GRACE_S = parseInt(process.env.AISHA_FINISHED_GRACE_S || "90", 10);

async function waitForHealthyOrFailedDeploy(appNames, { timeoutS, deployments = new Map(), wave, retryTrigger = triggerDeploy }) {
  // `wave` je POVINNÁ: auto-retry uvnitř volá triggerDeploy, a ten musí znát
  // pozici, aby mesh pojistka nerozhodovala z opomenutí. Bez fallbacku.
  if (!Number.isInteger(wave)) {
    throw new Error(`waitForHealthyOrFailedDeploy: chybí pozice ve vlně (dostal jsem ${String(wave)}).`);
  }
  if (NO_WAIT) {
    info(`(--no-wait) skipping health/deployment wait for: ${appNames.join(", ")}`);
    return { ok: true, statuses: {} };
  }

  // IDLE timeout, not TOTAL timeout. The wave fails only after `timeoutS` of NO
  // observable progress — no deployment-status change, no app-status change, and
  // no deployment still actively building. This distinguishes a slow-but-advancing
  // Coolify build queue (build-heavy apps deployed in parallel exceed Coolify's
  // serial build capacity — orchestration/domain-services carry 10–12 `build:`
  // blocks; wave-4 buildqueue incident 2026-07-19) from a genuine crash-loop
  // (deployment finished / no movement → fail-fast). Raising a FIXED total timeout
  // was rejected (coldstart-deploy-timing-2026-07-18): it also waits on real
  // crash-loops. A hard cap still bounds the run so it can never hang forever.
  const IDLE_TIMEOUT_MS = timeoutS * 1000;
  const HARD_CAP_MS = Math.max(timeoutS * 6, 1800) * 1000;
  const startMs = Date.now();
  let lastProgressMs = startMs;
  const markProgress = () => { lastProgressMs = Date.now(); };
  const seen = new Set();
  const seenDeploy = new Set();
  const stableCount = new Map(appNames.map((n) => [n, 0]));
  const lastStatus = new Map();
  // Track terminal deployment states per app — once finished/failed, stop
  // polling deploy status, but use it to inform app-level classification.
  const deploymentTerminal = new Map(); // name → { status, atMs }
  const deploymentFailures = [];
  // Track when each app first entered `restarting:*` — pro stuck-detection +
  // automatic log capture (viz captureStuckLogs).
  const restartingSince = new Map(); // name → { atMs, captured: bool }

  while (Date.now() - lastProgressMs < IDLE_TIMEOUT_MS && Date.now() - startMs < HARD_CAP_MS) {
    let apps;
    try {
      apps = await fetchApps();
    } catch (error) {
      warn(`fetchApps transient error: ${error.message} — retrying in ${HEALTH_POLL_S}s`);
      await sleep(HEALTH_POLL_S * 1000);
      continue;
    }

    const statuses = {};
    // Resolved classification per app — captures the in-loop grace reclassification
    // (e.g. exited:unhealthy → starting when deployment is finished < FINISHED_GRACE_S).
    // Returned alongside `statuses` so the caller's summary uses the same semantics
    // the polling loop did when it decided to terminate. Without this, a wave that
    // ended via "stable starting" can still be reported as unhealthy in the summary
    // because the raw `exited:unhealthy` status string was unchanged.
    const resolvedClasses = {};
    for (const name of appNames) {
      statuses[name] = apps.get(name)?.status || "missing";
    }

    for (const [name, deploymentId] of deployments.entries()) {
      if (deploymentTerminal.has(name)) continue; // already terminal — stop polling
      try {
        const deploymentStatus = await fetchDeploymentStatus(deploymentId);
        const deployKey = `${name}:${deploymentStatus}`;
        if (!seenDeploy.has(deployKey)) {
          seenDeploy.add(deployKey);
          log(`    ${C.dim("[deploy]")} ${name.padEnd(22)} ${deploymentStatus || "unknown"} ${C.dim(deploymentId)}`);
          markProgress(); // a new deployment-status transition is progress
        }
        // A deployment that is still queued/building/in_progress means Coolify is
        // actively working (its serial build queue is draining) — keep waiting.
        if (deploymentStatus && !["failed", "cancelled", "finished"].includes(deploymentStatus)) {
          markProgress();
        }
        if (deploymentStatus === "failed" || deploymentStatus === "cancelled") {
          // Iter 22j (May 2026): docker-compose v2 has a known race during
          // fresh pg17 init where db reports "Error" briefly (~2s) during the
          // entrypoint-wrapper.sh init sequence, then recovers to "Healthy"
          // ~5s later. But compose has already failed dep containers'
          // depends_on → up command aborts with "dependency failed". This is
          // a one-shot transient — second `restart` succeeds because db's
          // sentinel file (/tmp/.db-passwords-ready) persists.
          //
          // To make cold-start "samo" (autonomous), retry-once-on-failure
          // before declaring wave failure. Opt out via AISHA_NO_DEPLOY_RETRY=1.
          const retryEnabled = process.env.AISHA_NO_DEPLOY_RETRY !== "1";
          const retryKey = `${name}:retried`;
          if (retryEnabled && !seenDeploy.has(retryKey)) {
            seenDeploy.add(retryKey);
            log(`    ${C.dim("[deploy]")} ${name.padEnd(22)} ${C.yellow("retrying")} (iter 22j auto-retry on race) ${C.dim(deploymentId)}`);
            // Look up app uuid from apps map (already fetched at loop top)
            const appUuid = apps.get(name)?.uuid;
            if (appUuid) {
              try {
                // Retry TOUTÉŽ operací, kterou vlna spustila: restart validace
                // nesmí selhaný restart tiše nahradit redeployem — to by měřilo
                // jinou otázku a maskovalo právě tu vadu, kterou hledáme.
                const retryResult = await retryTrigger(appUuid, name, wave);
                if (retryResult?.ok && retryResult.deployment) {
                  deployments.set(name, retryResult.deployment);
                  // Hlídaný retry čeká na DOBĚHNUTÍ (spustHlidane) — ta doba
                  // je práce Coolify, ne nečinnost; bez toho by idle-timeout
                  // vypršel hned za dlouhým opakovaným nasazením.
                  markProgress();
                  continue; // next inner loop iteration polls the new uuid
                }
                warn(`auto-retry trigger for ${name} returned no deployment_uuid`);
              } catch (e) {
                warn(`auto-retry trigger for ${name} failed: ${e.message}`);
              }
            } else {
              warn(`auto-retry for ${name}: uuid not in apps map — falling through to failure`);
            }
          }
          deploymentTerminal.set(name, { status: deploymentStatus, atMs: Date.now() });
          deploymentFailures.push({ name, deploymentId, status: deploymentStatus });
          return { ok: false, statuses, resolvedClasses, deploymentFailures };
        } else if (deploymentStatus === "finished") {
          deploymentTerminal.set(name, { status: "finished", atMs: Date.now() });
        }
      } catch (error) {
        warn(`deployment status error for ${name}: ${error.message} — retrying in ${HEALTH_POLL_S}s`);
      }
    }

    let allOk = true;
    for (const name of appNames) {
      const app = apps.get(name);
      const rawCls = classifyStatus(app?.status);
      const term = deploymentTerminal.get(name);

      // False-positive guard: pokud deploy_uuid je `finished` ale app status
      // ještě hlásí stale `exited:*` (Coolify app-level cache lag), dáme
      // containeru FINISHED_GRACE_S na přechod exited(stale) → running:healthy.
      //
      // GRACE ODKLÁDÁ ROZSUDEK, NEVYNÁŠÍ HO (opraveno 2026-08-11). Dřív se
      // `exited` po dobu grace přepisovalo na `starting`, jenže `starting` je
      // v isAcceptable() — po třech stabilních dotazech se aplikace PŘIJALA
      // jako v pořádku. Naměřeno na aisha-netinit-experimental: kontejner
      // skončil s kódem 1 (subnet kolize), Coolify hlásil exited:unhealthy a
      // vlna přesto vypsala "healthy after: 3". Deployment přitom doběhl
      // korektně — `compose up -d` uspěl, kontejner nastartoval a AŽ POTOM
      // umřel — takže ani pojistka deployPending to nechytila.
      //
      // Nově je aplikace v grace `pending`: nesmí projít jako úspěch a nesmí
      // sbírat stabilitu. Po vypršení grace platí syrová třída, takže skutečné
      // `exited` vlnu poctivě položí.
      let cls = rawCls;
      let inGrace = false;
      if (term?.status === "finished" && (rawCls === "exited" || rawCls === "unknown")) {
        const ageMs = Date.now() - term.atMs;
        if (ageMs < FINISHED_GRACE_S * 1000) {
          cls = "starting";
          inGrace = true;
        }
      }

      const key = `${name}:${cls}`;
      if (!seen.has(key)) {
        seen.add(key);
        const colored = statusColor(cls)(app?.status || "missing");
        log(`    ${C.dim("[" + new Date().toISOString().slice(11, 19) + "]")} ${name.padEnd(22)} → ${colored}`);
      }

      if (inGrace) {
        // V grace se stabilita NESBÍRÁ — jinak by odklad rozsudku sám rozsudek
        // vynesl: tři dotazy uvnitř grace = "stable starting" = přijato.
        lastStatus.set(name, cls);
        stableCount.set(name, 0);
      } else if (lastStatus.get(name) === cls) {
        stableCount.set(name, stableCount.get(name) + 1);
      } else {
        lastStatus.set(name, cls);
        stableCount.set(name, 1);
        markProgress(); // an app-status class transition (e.g. starting→running) is progress
      }

      // Stuck-restart detection: track first time app entered `restarting`,
      // capture logs once threshold exceeded (best-effort, only once per wait).
      if (cls === "restarting") {
        const tracked = restartingSince.get(name);
        if (!tracked) {
          restartingSince.set(name, { atMs: Date.now(), captured: false });
        } else if (!tracked.captured) {
          const stuckMs = Date.now() - tracked.atMs;
          if (stuckMs >= STUCK_RESTART_THRESHOLD_MS) {
            tracked.captured = true; // mark before async to prevent duplicate
            // Fire-and-forget: don't block polling; logs go to snapshot dir
            captureStuckLogs(name, app?.uuid, stuckMs).catch((err) => {
              warn(`  ⚠ captureStuckLogs(${name}) failed: ${err.message || err}`);
            });
          }
        }
      } else if (restartingSince.has(name)) {
        // App recovered from restarting — clear tracking
        restartingSince.delete(name);
      }

      const stable = stableCount.get(name) >= STABLE_POLLS;
      // FALSE-GREEN POJISTKA (#104, změřeno 2026-08-11 na restartu clamav):
      // dokud SLEDOVANÝ deployment neskončil, zdraví aplikace je zdraví STARÉHO
      // kontejneru — Coolify hlásilo running:healthy celé minuty, zatímco restart
      // teprve stál ve frontě (queued, started_at=None). Bez téhle podmínky by
      // vlna prošla na první dotaz a vůbec nezměřila výsledek spuštěné akce.
      const deployPending = deployments.has(name) && !deploymentTerminal.has(name);
      const ok = !deployPending && !inGrace && (isFullyHealthy(cls) || (isAcceptable(cls) && stable));
      if (!ok) allOk = false;

      // Record the resolved classification — caller will use this for the
      // summary so semantics match. V grace zapisujeme SYROVOU třídu: souhrn
      // nesmí vidět zdvořilé "starting" u kontejneru, který skutečně skončil.
      // (Kdyby vlna vypršela uvnitř grace, verdikt patří realitě, ne odkladu.)
      resolvedClasses[name] = inGrace ? rawCls : cls;
    }
    // ⛔ ZDRAVÁ APPKA NENÍ HOTOVÉ NASAZENÍ. NAMĚŘENO 2026-08-10.
    //
    // `allOk` je splněné OKAMŽITĚ, když běží STARÝ kontejner — a ten je zdravý
    // právě proto, že ho nový nenahradil. Tahle podmínka proto vracela úspěch
    // dřív, než sledované nasazení vůbec doběhlo:
    //
    //   07:16:20  --only=edge  → „triggered: 2, healthy after: 2, deploy failed: 0"
    //   07:30:39  totéž nasazení v Coolify → status=failed
    //
    // Čtrnáct minut mezi „hotovo" a skutečným pádem. Web pak tři dny servíroval
    // starý bundle a nástroj o tom tvrdil opak.
    //
    // ⭐ Když pro appku ZNÁME `deployment_uuid`, je autorita ON, ne zdraví
    // kontejneru. Čeká se, až dosáhne terminálního stavu; `failed`/`cancelled`
    // řeší větev výš (`deploymentFailures`). Bez známého uuid se chováme jako
    // dřív — jiné měřidlo nemáme a mlčet o tom by bylo horší než měřit hrubě.
    const cekaSeNaNasazeni = appNames.some(
      (name) => deployments.has(name) && !deploymentTerminal.has(name),
    );
    if (allOk && deploymentFailures.length === 0 && !cekaSeNaNasazeni) {
      return { ok: true, statuses, resolvedClasses };
    }

    await sleep(HEALTH_POLL_S * 1000);
  }

  // Final fallback path (timeout). Resolve classification using the
  // same grace logic so the summary doesn't penalize an app whose
  // deployment finished but Coolify status cache is still lagging.
  const final = await fetchApps().catch(() => new Map());
  const finalStatuses = Object.fromEntries(appNames.map((n) => [n, final.get(n)?.status || "missing"]));
  const finalResolved = {};
  for (const name of appNames) {
    const rawCls = classifyStatus(finalStatuses[name]);
    const term = deploymentTerminal.get(name);
    let cls = rawCls;
    if (term?.status === "finished" && (rawCls === "exited" || rawCls === "unknown")) {
      const ageMs = Date.now() - term.atMs;
      if (ageMs < FINISHED_GRACE_S * 1000) {
        cls = "starting";
      }
    }
    finalResolved[name] = cls;
  }
  // Reaching the idle/hard deadline is never success. In particular, a known
  // deployment_uuid that never reached a terminal state used to disappear
  // here: no explicit `failed` status meant `ok: true`, even though Coolify was
  // still queued/building at the hard cap. Preserve those as explicit timeout
  // failures so the caller halts critical waves and reports the deployment id.
  const timedOutDeployments = [...deployments.entries()]
    .filter(([name]) => !deploymentTerminal.has(name))
    .map(([name, deploymentId]) => ({ name, deploymentId, status: "timeout" }));
  const finalDeploymentFailures = [...deploymentFailures, ...timedOutDeployments];
  return {
    ok: false,
    statuses: finalStatuses,
    resolvedClasses: finalResolved,
    ...(finalDeploymentFailures.length > 0 ? { deploymentFailures: finalDeploymentFailures } : {}),
  };
}

// ── Gate checks ──────────────────────────────────────────────────────────────
// Before triggering a wave, verify all declared gates (dependency apps) are
// in the required state. If not, wait — up to WAVE_TIMEOUT_S. If timeout is
// reached, abort the wave (and all subsequent waves) rather than deploying
// services whose dependencies are not up.
//
//   hard: true  → require isFullyHealthy (running:healthy or running:*)
//   hard: false → require NOT exited (starting/unhealthy/running all pass)
//
// ⛔ BOOTSTRAP OKNO (naměřeno při wipu 2026-08-24, TŘETÍ výskyt téže třídy).
// Vlna 3 měla tvrdou bránu na `pki` a ta neprošla, protože `pki` bylo
// `running:unhealthy` — jeho netbird-agent se nemá kam zapsat, mesh vzniká až
// ve vlně 5. Následek: vlna 3 zrušena a kaskáda 32 zastavených aplikací.
//
// Přesně tenhle deadlock je u vlny 5 ZAPSANÝ (a `pki` je tam kvůli němu měkké),
// jen se to nikdy nezobecnilo — takže táž vada obešla opravu jinou vlnou.
// Zobecněno sem: PŘED vznikem meshe je `running:unhealthy` u KAŽDÉ aplikace
// s mesh sidecarem očekávaný stav, ne selhání.
//
// Třída `unhealthy` znamená PRÁVĚ JEN `running:unhealthy` (viz classifyStatus),
// tedy kontejnery BĚŽÍ a neprošla app-level sonda. `exited` a `restarting` jsou
// jiné třídy a přijatelné nejsou ani tady.
function gatePass(cls, hard, waveNum) {
  if (hard) {
    if (isFullyHealthy(cls)) return true;
    const predMeshGenezi = typeof waveNum === "number" && waveNum < MESH_WARMUP_WAVE;
    return predMeshGenezi && cls === "unhealthy";
  }
  // Soft: any state except exited/unknown (missing from API)
  return cls === "healthy" || cls === "running" || cls === "starting" ||
         cls === "unhealthy" || cls === "restarting";
}

async function probeHttpGate(gate) {
  const statuses = Array.isArray(gate.statuses) && gate.statuses.length > 0 ? gate.statuses : [200];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), gate.timeoutMs || 15_000);
  try {
    const res = await fetch(gate.url, {
      method: gate.method || "GET",
      redirect: "manual",
      signal: controller.signal,
    });
    return {
      pass: statuses.includes(res.status),
      status: `HTTP ${res.status}`,
    };
  } catch (err) {
    const message = err?.name === "AbortError" ? "timeout" : String(err?.message || err);
    return {
      pass: false,
      status: message.slice(0, 80),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForGates(wave) {
  if (!wave.gates?.length || NO_WAIT) return { ok: true };

  const gateApps = wave.gates.map((g) => g.app || g.name || g.url);
  info(`Gate check before wave ${wave.num}: ${gateApps.join(", ")}`);

  const deadline = Date.now() + WAVE_TIMEOUT_S * 1000;
  const gatesStart = Date.now();
  const seen = new Set();

  while (Date.now() < deadline) {
    let apps = new Map();
    if (wave.gates.some((gate) => gate.app)) {
      try {
        apps = await fetchApps();
      } catch (err) {
        warn(`gate fetchApps error: ${err.message} — retrying in ${HEALTH_POLL_S}s`);
        await sleep(HEALTH_POLL_S * 1000);
        continue;
      }
    }

    const failed = [];
    for (const gate of wave.gates) {
      // A gate app the STORY does not deploy (excluded by its profile — e.g. a
      // shared/external Keycloak, or pki on a lean tier) is absent from Coolify
      // entirely. That is not "the dependency is not ready yet": there is nothing
      // to wait for, and blocking on it aborts every later wave forever. Same
      // authority filterWaveApps() already uses for TARGETS (apps.has), applied to
      // gates. A creation failure is caught separately by cold-start step 3, which
      // verifies each manifest app exists before the waves run.
      if (gate.app && !apps.has(gate.app)) {
        const key = `${gate.app}:not-deployed`;
        if (!seen.has(key)) {
          seen.add(key);
          log(`    ${C.dim("[gate]")} ${gate.app.padEnd(22)} ${C.dim("skipped — not deployed by this story")}`);
        }
        continue;
      }
      if (gate.url) {
        const name = gate.name || gate.url;
        const result = await probeHttpGate(gate);
        const key = `${name}:${result.status}:${result.pass}`;
        if (!seen.has(key)) {
          seen.add(key);
          const colored = result.pass ? C.green(result.status) : C.red(result.status);
          log(`    ${C.dim("[gate]")} ${name.padEnd(22)} ${colored} ${C.dim(`(http ${gate.url})`)}`);
        }
        if (!result.pass) failed.push({ app: name, cls: result.status, hard: true, url: gate.url });
        continue;
      }

      const a = apps.get(gate.app);
      const cls = classifyStatus(a?.status);
      let pass = gatePass(cls, gate.hard, wave.num);
      // stabilize: a SOFT gate may declare a stabilization window (seconds).
      // Within it, anything short of running:healthy keeps the wave WAITING —
      // the dep exists and is booting, but deploying against it mid-flap is
      // exactly what crashed 8 wave-4 apps on tenant 2026-07-18. Capped below the
      // wave deadline so an elapsed window degrades to plain soft semantics
      // (waitForGates' timeout path must stay reachable only for REAL blocks).
      let stabilizing = false;
      if (pass && !gate.hard && gate.stabilize && cls !== "healthy") {
        const stabUntil = Math.min(
          gatesStart + gate.stabilize * 1000,
          deadline - 30 * 1000,
        );
        if (Date.now() < stabUntil) {
          pass = false;
          stabilizing = true;
        }
      }
      const key = `${gate.app}:${cls}:${pass}`;
      if (!seen.has(key)) {
        seen.add(key);
        const label = gate.hard
          ? "(hard gate)"
          : stabilizing
            ? `(soft gate — stabilizing, waiting ≤${gate.stabilize}s for healthy)`
            : "(soft gate)";
        const colored = statusColor(cls)(a?.status || "missing");
        log(`    ${C.dim("[gate]")} ${gate.app.padEnd(22)} ${colored} ${C.dim(label)}`);
      }
      if (!pass) failed.push({ app: gate.app, cls, hard: gate.hard });
    }

    if (failed.length === 0) {
      ok(`  All gates passed for wave ${wave.num}`);
      return { ok: true };
    }
    await sleep(HEALTH_POLL_S * 1000);
  }

  // Gate timeout — report which deps are still blocking
  const apps = wave.gates.some((gate) => gate.app) ? await fetchApps().catch(() => new Map()) : new Map();
  const blocking = wave.gates
    .filter((gate) => {
      if (gate.url) return true;
      // Not deployed by this story → never blocking (mirrors the loop above).
      if (!apps.has(gate.app)) return false;
      return !gatePass(classifyStatus(apps.get(gate.app)?.status), gate.hard, wave.num);
    })
    .map((gate) => {
      if (gate.url) return `${gate.name || gate.url} (http: ${gate.url})`;
      return `${gate.app} (${gate.hard ? "hard" : "soft"}: ${apps.get(gate.app)?.status || "missing"})`;
    });
  return { ok: false, blocking };
}

// ── Mesh IP refresh (discovery → env SoT, PŘED env-syncem) ──────────────────
// Třetí výskyt téže třídy výpadku (07-29, 07-30, 07-31) měl teprve napotřetí
// úplný kořen: mesh-sync umí zapsat CORE_MESH_IP na Coolify appku, ale
// env-sync — který běží při KAŽDÉM triggeru tady o pár řádků níž — tlačí
// hodnoty z .env.coolify, kde klíč zůstal PRÁZDNÝ. Oba nástroje se přetahují
// a env-sync vždy vyhraje, protože běží později: edge se nasadí s prázdným
// CORE_MESH_IP, mesh-router vyrobí DNAT bez cíle a api.<tld> je 502.
//
// Oprava proto míří na ZDROJ: před env-syncem se prázdné *_MESH_IP klíče
// v .env.coolify doplní z NetBird discovery (scripts/netbird-peer-discover.mjs
// — týž nástroj, který používá cold-start). Hodnota nikdy není v kódu; je to
// discovery → SoT → env-sync, jedna cesta pro cold-start i redeploy.
//
// Fail-loud kontrakt: když je CORE_MESH_IP po pokusu o refresh dál prázdné
// a nasazuje se app, jejíž compose ho vyžaduje (edge — jediný veřejný datový
// vstup instance), deploy se ODMÍTNE. Nasadit „zeleně" rozbitý routing je
// přesně to, co ty tři incidenty způsobilo.
const ENV_COOLIFY = join(ROOT, ".env.coolify");

// ── CO TAHLE INSTANCE NASAZUJE: manifest × brány opt-in služeb ──────────────
//
// ⛔ NAMĚŘENO 2026-09-13 (audit cesty cold-startu nad guru). Vlny jsou seznam
// PLATFORMY a `filterWaveApps()` z nich brala jen to, co v Coolify zrovna je.
// Dvě otázky tím splynuly v jednu a obě se odpovídaly mlčením:
//   · aplikace, kterou manifest instance nasazuje, v Coolify CHYBÍ (story-init ji
//     nezaložil) → z vlny tiše zmizela a běh skončil nulou;
//   · aplikace EXISTUJE, ale její opt-in lane je vypnutá (`provision_when_env`) →
//     nasadila se stejně a spadla (guru: `model` bez `CHAT_GGUF_URL`).
// Obě odpovědi dává manifest instance a katalog — tatáž autorita, podle které
// story-init zakládá a resolver vydává adresy (lib/provision-gate.mjs).
let mapaInstanceCache = null;
function mapaInstance() {
  if (mapaInstanceCache) return mapaInstanceCache;
  let manifest;
  try {
    // Cold-start předává svůj inventář výslovně (story ≠ prefix aplikací);
    // samostatný běh si ho odvodí z identity instance.
    manifest = readFileSync(resolveManifestPath({ explicit: process.env.MANIFEST_FILE || undefined, explicitHint: "MANIFEST_FILE=<path>" }), "utf8");
  } catch (e) {
    errLog(`Manifest instance nejde přečíst (${e.message.split("\n")[0]}) — nevím, co tahle instance nasazuje.`);
    process.exit(2);
  }
  let katalog;
  try {
    katalog = nactiKatalog();
  } catch (e) {
    errLog(`Katalog služeb nejde přečíst (${e.message.split("\n")[0]}) — brány opt-in služeb NEMĚŘENY.`);
    process.exit(2);
  }
  const cti = ctenarHodnot(existsSync(ENV_COOLIFY) ? ENV_COOLIFY : undefined);
  const ocekavane = new Set();
  const vypnute = new Map(); // jméno aplikace → podmínky, které nejsou splněné
  const compose = new Map(); // jméno aplikace → compose soubor (relativně k repu)
  for (const radek of manifest.split(/\r?\n/)) {
    const m = /^app:\s*([a-z0-9-]+):/.exec(radek.trim());
    if (!m) continue;
    const jmeno = `${APP_PREFIX_DASH}${m[1]}`;
    // Řádek manifestu: `app: <jméno>:<slot>:<compose>[:<volba>=…]` — compose je
    // pro diskovou bránu (stažené obrazy stacku); řádek bez něj se nevyřazuje.
    const c = /^app:\s*[a-z0-9-]+:[^:]*:([^:\s]+)/.exec(radek.trim());
    if (c) compose.set(jmeno, c[1]);
    const podminka = katalog[m[1]]?.provision_when_env;
    if (podminkaSplnena(podminka, cti)) ocekavane.add(jmeno);
    else vypnute.set(jmeno, klicePodminky(podminka).join(" | "));
  }
  mapaInstanceCache = { ocekavane, vypnute, compose, cti };
  return mapaInstanceCache;
}
// ⛔ PŘEPSÁNO 2026-09-06: pojistka měřila RIZIKO, KTERÉ UŽ NEEXISTUJE.
//
// Komentář tu zněl „compose: mesh-router DNAT na CORE_MESH_IP" a hláška níž
// citovala incidenty 07-29/30/31. Jenže DNAT byl z edge compose ODSTRANĚN
// 2026-08-21 (docker-compose.coolify-prebuilt.yml: „⛔ ŽÁDNÝ DNAT … Pravidlo se
// sem nesmí vrátit"). Dnes je `CORE_MESH_IP` v tom compose jen MĚŘIDLO — při
// prázdné hodnotě mesh-router zaloguje varování a BĚŽÍ DÁL (žádný exit).
//
// Premisa „app, jejíž compose ho VYŽADUJE" tedy přestala platit — a pojistka
// přesto blokovala `edge`, JEDINÝ veřejný vstup instance. Na produkci <fork>
// (stroj za NAT) z toho vznikl deadlock, ze kterého není cesty ven:
//
//     edge      ← blokován, protože CORE_MESH_IP je prázdné
//     CORE_MESH_IP ← plní netbird discovery
//     discovery ← potřebuje VEŘEJNOU tvář auth.<tld>
//     auth      ← vede přes edge
//
// Sedmý výskyt téhož vzorce: NĚCO STATICKÉHO PŘEŽILO ZMĚNU OKOLO SEBE. Guard
// zůstal, hazard zmizel, a nikdo ty dvě věci neporovnal.
//
// Ochrana se NERUŠÍ, jen se zužuje na stav, kde dnes skutečně dává smysl —
// viz `meshIpRegrese()` níž: panenská instance × regrese ustáleného stavu.
const MESH_IP_REQUIRED_BY = new Set(["edge"]);

// ── Od které vlny smí ta pojistka pálit ──────────────────────────────────────
// MESH JE ARCHITEKTURA, NE FÁZE. Celá instance je izolované prostředí, kde spolu
// služby mluví přes mesh — bezpečně a odděleně. Vlny tenhle záměr nezpochybňují.
//
// Vlna 5 = "Mesh warmup". Do té doby mesh ještě NEBĚŽÍ — ne proto, že by tam
// nepatřil, ale protože se teprve zapíná: management plane jde nahoru ve vlně 4,
// takže dřív se do něj nemá kdo přihlásit. Je to bootstrap okno, ne výjimka:
// WAVES[5] to říká doslova — „Edge and core deploy in wave 2 (before netbird
// management). Their netbird-agent sidecars fail to connect because management
// isn't up yet. After wave 4 brings management online, we re-deploy edge …
// This is the key to making mesh self-healing on cold-start."
//
// Bez tohoto rozlišení pojistka (přidaná po incidentech 07-29/30/31) odmítla
// edge už ve vlně 2, běh skončil chybou, a vlna 5 — tedy právě ta, která mesh
// zavádí a pojistku uspokojí — se nikdy nespustila. Kruh: fail-closed zrušil
// vlnu, která nesla opravu. Naměřeno na --wipe deployi 2026-08-09
// (Phase A: 5 zdravých, 1 trigger failed → celý cold-start abort).
//
// Wave 0 = ad-hoc běh (`--only edge`, `npm run redeploy`). Tam pojistka pálit
// MUSÍ: operátor, který sahá na edge mimo cold-start, mesh očekává — a přesně
// tenhle scénář ty tři incidenty způsobil.
const MESH_WARMUP_WAVE = 5;
/** Ad-hoc běh mimo vlnovou smyčku (`--only`, retry). Deklaruje se, neodvozuje. */
// ⛔ NEČÍSELNÝ ZÁMĚRNĚ (naměřeno 2026-08-19). Dřív `= 0`, jenže 0 JE platná vlna
// („Warmup — hostitelské sítě instance"), takže guard nerozlišil dvě opačné
// situace: ad-hoc nasazení (mesh dávno stojí → chybějící IP je vada) od PRVNÍ
// vlny studeného startu (netbird jde až ve vlně 4 → chybějící IP je normální).
// Vlna 0 pak hlásila „a jsme ve vlně 0, kde už mesh STÁT MÁ" — přesný opak
// pravdy. Značka „nejsem vlna" nesmí být hodnota, která v rozsahu vln leží.
const WAVE_ADHOC = "adhoc";
function meshGuardApplies(wave) {
  // Žádný fallback: neuvedená pozice není "asi ad-hoc", je to chyba volajícího.
  // Kdyby se undefined tiše bralo jako ad-hoc, nové volání by chování dostalo
  // opomenutím místo deklarace — a tichá volba je přesně to, co tahle pojistka
  // po incidentech 07-29/30/31 nesmí dělat.
  if (wave !== WAVE_ADHOC && !Number.isInteger(wave)) {
    throw new Error(
      `meshGuardApplies: pozice ve vlně nebyla předána (dostal jsem ${String(wave)}). ` +
        `Volající musí deklarovat vlnu, nebo WAVE_ADHOC pro běh mimo vlnovou smyčku.`,
    );
  }
  return wave === WAVE_ADHOC || wave >= MESH_WARMUP_WAVE;
}

function readEnvCoolify() {
  if (!existsSync(ENV_COOLIFY)) return null;
  return readFileSync(ENV_COOLIFY, "utf-8");
}

// ⛔ NAMĚŘENO 2026-08-27: vlna spouštěla aplikace SOUBĚŽNĚ (tehdy `Promise.all`;
// dnes jen při `deploy_concurrency` > 1, viz spustHlidane — zámek tedy zůstává)
// a tři různé kroky přitom mutují TÝŽ soubor postupem přečti-uprav-zapiš. Každý
// si ho přečetl dřív, než ho ten druhý změnil, takže poslední zápis cizí práci
// smazal. Konkrétně: `mesh refresh` zapsal CORE_MESH_IP, přepočet složenin ho
// vzápětí přepsal svou starší kopií — a edge pak odmítl deploy s
// „CORE_MESH_IP je prázdné". Vlastní zálohy těch kroků to prozradily: ANI JEDNA
// tu hodnotu neobsahovala, ač první krok hlásil úspěch.
//
// Soubor je sdílený mutovaný stav; přístup k němu musí být VÝLUČNÝ a čtení
// patří AŽ DOVNITŘ zámku — jinak se serializuje jen zápis, ne rozhodnutí.
// Všechny mutace běží v jednom procesu, takže stačí fronta příslibů.
let _envZamek = Promise.resolve();

// ⛔ KLÍČE SoT BĚHEM BĚHU JEN PŘIBÝVAJÍ (naměřeno 2026-09-15). Doktor-dítě
// zapsal soubor holým `writeFileSync` (zkrátí, pak plní), rodič v tu chvíli
// přečetl PRÁZDNÝ obsah, přidal do něj složeniny a zapsal zpět. Trezor přišel
// o stovky klíčů, další běhy doktora je vygenerovaly NANOVO a sync nová
// tajemství roznesl do Coolify. Žádný krok redeploye klíč neodebírá (mesh IP,
// složeniny, cachebust i doktor jen doplňují nebo nahrazují hodnotu), takže
// úbytek klíče proti startu běhu je vždy vada — a zápis ani sync nad takovým
// SoT neprojde.
let _kliceNaStartu = null;

/** Množina klíčů v obsahu SoT. */
function kliceSoT(text) {
  const klice = new Set();
  for (const radek of text.split(/\r?\n/)) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(radek);
    if (m) klice.add(m[1]);
  }
  return klice;
}

/** Klíče, které byly v SoT při startu běhu a v `text` chybí. */
function ztraceneKliceProtiStartu(text) {
  if (!_kliceNaStartu) return [];
  const ted = kliceSoT(text);
  return [..._kliceNaStartu].filter((k) => !ted.has(k));
}

function popisZtraty(ztracene) {
  const ukazka = ztracene.slice(0, 5).join(", ");
  return `SoT přišel o ${ztracene.length} z ${_kliceNaStartu.size} klíčů proti startu běhu (${ukazka}${ztracene.length > 5 ? ", …" : ""})`;
}

/**
 * Přečte .env.coolify, nechá `uprav` vyrobit nový obsah a zapíše ho — celé
 * pod výlučným přístupem, a VÝSLEDEK OVĚŘÍ zpětným čtením.
 *
 * ⛔ Ověření není opatrnictví: hlášení „zapsáno" se dřív vypisovalo podle
 * ZÁMĚRU (klíč se přidal do seznamu bez ohledu na to, jestli náhrada zabrala).
 * Úspěch, který netvrdí nic o skutečnosti, je horší než mlčení — vede
 * vyšetřování opačným směrem.
 *
 * @param {(src: string) => string} uprav
 * @param {{zaloha?: string}} [opts]
 * @returns {Promise<{zapsano: boolean, duvod: string}>}
 */
async function upravEnvCoolify(uprav, { zaloha } = {}) {
  const beh = _envZamek.then(async () => {
    const src = readEnvCoolify();
    if (src === null) return { zapsano: false, duvod: ".env.coolify není" };
    const ztraceneVSrc = ztraceneKliceProtiStartu(src);
    if (ztraceneVSrc.length) {
      return { zapsano: false, duvod: `${popisZtraty(ztraceneVSrc)} — NEZAPISUJU nad poškozeným SoT` };
    }
    const out = uprav(src);
    if (typeof out !== "string") return { zapsano: false, duvod: "úprava nevydala obsah" };
    if (out === src) return { zapsano: false, duvod: "beze změny" };
    const ztraceneVOut = ztraceneKliceProtiStartu(out);
    if (ztraceneVOut.length) {
      return { zapsano: false, duvod: `úprava by klíče odebrala: ${popisZtraty(ztraceneVOut)} — NEZAPISUJU` };
    }
    if (zaloha) writeFileSync(`${ENV_COOLIFY}.${zaloha}`, src);
    // ⛔ ATOMICKY, NE `writeFileSync` PŘÍMO. Zámek výš serializuje jen zapisovatele
    // v TOMHLE procesu; `.env.coolify` ale současně čtou POTOMCI —
    // `netbird-peer-discover.mjs` si z něj přes readConfigKey bere NETBIRD_DOMAIN
    // a KEYCLOAK_DOMAIN_PUBLIC. Přímý zápis soubor nejdřív zkrátí a pak plní,
    // takže potomek může přečíst ROZEPSANÝ obsah, dostat prázdnou adresu a
    // spadnout na „fetch failed" — což vypadá jako výpadek sítě.
    //
    // ⚠ POZOR NA VÝKLAD ČÍSLA: 2026-08-27 ZÁTĚŽOVÁ zkouška (dítě četlo v těsné
    // smyčce ~16 500×/s, rodič zapisoval nepřetržitě) dala 1219 neúplných čtení
    // z 33 067, tedy 3,7 %. To dokazuje, že jev EXISTUJE — NENÍ to jeho
    // pravděpodobnost v provozu. Tam se zapisuje řádově čtyřikrát za vlnu a
    // okno zranitelnosti je pár milisekund, takže skutečná šance je o řády
    // menší. Tahle pojistka tedy NEVYSVĚTLUJE hromadné pády discovery ve
    // vlně 7; ty měly jinou příčinu. `rename` je na POSIXu atomický a nestojí
    // nic, tak ať je riziko pryč — ale nevydávat ho za diagnózu.
    //
    // ⛔ A PŘES SKUTEČNOU CESTU (naměřeno 2026-09-15): v worktree bývá
    // `.env.coolify` symlink na hlavní trezor a rename na cestu symlinku ho
    // nahradí souborem — trezor se tiše rozštěpí. Viz lib/zapis-env-atomicky.mjs.
    nahradObsahAtomicky(ENV_COOLIFY, out);
    const zpet = readEnvCoolify();
    return zpet === out
      ? { zapsano: true, duvod: "" }
      : { zapsano: false, duvod: "zpětné čtení nesouhlasí se zapsaným obsahem" };
  });
  // Řetěz nesmí přetrhnout výjimka jedné úpravy, jinak by se všechny další
  // odmítly a vypadalo by to jako by soubor nešel číst.
  _envZamek = beh.then(() => {}, () => {});
  return beh;
}

/**
 * Discovery v tomhle běhu: jeden souběžný dotaz, úspěch i odmítnuté pověření se
 * pamatují (proč: lib/mesh-discovery-v-behu.mjs — souběžné ROPC pokusy zamkly
 * uživatele aisha-bootstrap, 2026-09-17).
 */
const discoveryVBehu = vytvorDiscoveryVBehu();

async function refreshMeshIps(short, wave) {
  const src = readEnvCoolify();
  if (src === null) return { ok: true, note: ".env.coolify není (CI/cizí stroj) — refresh přeskočen" };

  // ⛔ NAMĚŘENO 2026-09-04 na produkci <fork>: bez meshe není co objevovat.
  // Kontrakt níž je správný — prázdné CORE_MESH_IP vyrobí mesh-router s DNAT bez
  // cíle a api.<tld> je 502 (incidenty 07-29/30/31). Jenže mesh-routa se staví
  // POUZE když MESH_ENABLED=true (docker-compose.coolify-prebuilt.yml ř. 454–470:
  // „routa do mesh se nestaví (veřejná lane)"). Na profilu bez meshe jsou tedy
  // *_MESH_IP prázdné PRÁVEM, discovery nemá koho se ptát (netbird se nenasazuje),
  // a fail-loud zastaví vlnu 6 — čímž vezme i vlny 7, 8 a 10, tedy 7 aplikací.
  // Šestý výskyt téhož vzorce za den: profil službu vyloučí, ale něco statického
  // ji dál vyžaduje. Pojistka se proto ptá NEJDŘÍV, jestli je mesh vůbec zapnutý.
  const meshEnabled = /^MESH_ENABLED=\s*true\s*$/im.test(src);
  if (!meshEnabled) {
    return { ok: true, note: "MESH_ENABLED != true — *_MESH_IP jsou prázdné právem, discovery přeskočeno" };
  }

  const emptyKeys = [...src.matchAll(/^([A-Z0-9_]+_MESH_IP)=\s*$/gm)].map((m) => m[1]);
  const coreEmpty = emptyKeys.includes("CORE_MESH_IP");

  // ⛔ NAMĚŘENO 2026-09-03 V PROVOZU. Tady stálo `if (emptyKeys.length === 0)
  // return`, takže discovery běželo JEN tehdy, když byl nějaký `*_MESH_IP`
  // placeholder prázdný. Ty se ale vyplní při PRVNÍM úspěšném běhu a zůstanou
  // vyplněné — od té chvíle se discovery nespustilo NIKDY.
  //
  // Následek: `MESH_PEER_IPS` zůstalo prázdné navždy, a protože z něj vzniká
  // `GATEWAY_TRUSTED_PROXIES`, nesl nasazený seznam důvěry samé ROZSAHY
  // a loopback — ani jednu adresu peera. Chůze zprava se pak zastaví na mesh
  // skoku. V `measure` je to špatné měření, v `enforce` špatné řízení přístupu.
  // (Do 2026-09-02 to maskoval `100.64.0.0/10`, který mesh peery pokrýval —
  // spolu s CGNATem operátorů. Odebrání toho rozsahu tuhle díru odkrylo.)
  //
  // ⭐ TŘÍDA VADY: obnova hodnoty jako VEDLEJŠÍ EFEKT nesouvisející podmínky.
  // Seznam peerů se neobnovuje proto, že „je co vyplnit", ale proto, že se
  // peeři MĚNÍ — odejitý peer musí z důvěry zmizet. Podmínka proto míří na
  // fázi: běží se tam, kde mesh STÁT MÁ (`meshGuardApplies`), plus vždy, když
  // je co vyplnit. Před vlnou warmupu se stále přeskakuje, aby nevznikla
  // podmínka, která v té fázi nemůže platit.
  if (emptyKeys.length === 0 && !meshGuardApplies(wave)) return { ok: true };

  /**
   * Má prázdné CORE_MESH_IP blokovat nasazení?
   *
   * NE na PANENSKÉ instanci — tam ještě nikdy žádný peer nebyl, takže není co
   * rozbít, a `edge` je JEDINÝ veřejný vstup: bez něj se nerozběhne ani auth,
   * bez auth neprojde discovery a mesh nevznikne nikdy. Blokovat tady znamená
   * zamknout instanci napořád.
   *
   * ANO při REGRESI — když nějaký peer mesh IP MÁ a zrovna `CORE` ji ztratil,
   * je to nesoulad ustáleného stavu a nasadit „zeleně" rozbitý routing je právě
   * to, co ty tři incidenty způsobilo.
   *
   * Rozdíl je měřitelný: existuje v .env.coolify aspoň jedna NEPRÁZDNÁ *_MESH_IP?
   */
  const nejakaMeshIpVyplnena = /^[A-Z0-9_]+_MESH_IP=\s*\S/m.test(src);

  // Env pro discovery se skládá z .env.coolify — POZOR na past z 07-31:
  // existuje NETBIRD_DOMAIN, nikoli NETBIRD_DOMAIN_PUBLIC; špatné jméno tady
  // vyrobí NETBIRD_API_URL="https://" a discovery padá na "fetch failed",
  // což vypadá jako výpadek sítě, ne jako překlep.
  const val = (k) => {
    const m = src.match(new RegExp(`^${k}=(.*)$`, "m"));
    return m ? m[1].trim() : "";
  };
  const discoveryEnv = {
    ...process.env,
    NETBIRD_API_URL: val("NETBIRD_API_URL") || (val("NETBIRD_DOMAIN") ? `https://${val("NETBIRD_DOMAIN")}` : ""),
    KEYCLOAK_URL: process.env.KEYCLOAK_URL || (val("KEYCLOAK_DOMAIN_PUBLIC") ? `https://${val("KEYCLOAK_DOMAIN_PUBLIC")}` : ""),
    KEYCLOAK_REALM: process.env.KEYCLOAK_REALM || val("KEYCLOAK_REALM"),
    NETBIRD_MGMT_SECRET: process.env.NETBIRD_MGMT_SECRET || val("NETBIRD_MGMT_SECRET"),
    AISHA_BOOTSTRAP_PASSWORD: process.env.AISHA_BOOTSTRAP_PASSWORD || val("AISHA_BOOTSTRAP_PASSWORD"),
    AISHA_BOOTSTRAP_CLIENT_SECRET: process.env.AISHA_BOOTSTRAP_CLIENT_SECRET || val("AISHA_BOOTSTRAP_CLIENT_SECRET"),
  };

  let discovered = new Map();
  let meshPeerIps = [];
  try {
    // Discovery je síťový dotaz na netbird. Nově běží v každé vlně od warmupu
    // dál, takže bez tohohle by se ve full běhu volalo desítkykrát. Cachuje se
    // JEN ÚSPĚCH: neúspěch ve vlně 3 (mesh ještě nestojí) nesmí zabránit
    // pokusu ve vlně 6, kde už stát má.
    const { stdout, zPameti } = await discoveryVBehu(() =>
      execFileP(process.execPath, [join(ROOT, "scripts/netbird-peer-discover.mjs"), "--json"], {
        cwd: ROOT,
        env: discoveryEnv,
        maxBuffer: 4 * 1024 * 1024,
      }),
    );
    // ⛔ NAMĚŘENO 2026-09-15: tady se řádky `KEY=ip` skládaly do Map a
    // MESH_PEER_IPS vznikalo z jejích hodnot. Kolize prefixů (backend- a
    // experimental-mesh-router → MESH_ROUTER_MESH_IP) jeden peer z důvěry
    // vyhodila a u duplicitního jména po re-enrollmentu rozhodovalo pořadí
    // z API — 29 peerů dalo 21 adres a dvě měření dvě různé hodnoty. Výčet se
    // teď čte celý (JSON) a vykládá JEDNÍM místem: lib/mesh-peers.mjs.
    const peery = JSON.parse(stdout);
    const vyklad = meshIpKlice(peery);
    discovered = vyklad.klice;
    for (const [klic, jmena] of vyklad.nejednoznacne) {
      if (!zPameti) info(`mesh: ${klic} se nevydává — nejednoznačný (${jmena.join(", ")})`);
    }
    // ⛔ NAMĚŘENO 2026-09-02: discovery vypisuje KAŽDÉHO peera, ale níž se z mapy
    // bere jen to, co někdo předem napsal do .env.coolify jako prázdný klíč.
    // V souboru byl JEDINÝ (`CORE_MESH_IP`) — kdežto skok, který se objevuje
    // v `x-forwarded-for`, je peer EDGE. Univerzum psané rukou.
    //
    // Seznam peerů je vstup pro chůzi zprava (GATEWAY_TRUSTED_PROXIES). Do
    // dneška se místo něj důvěřovalo CELÉMU rozsahu 100.64.0.0/10, tedy
    // i operátorskému CGNATu — mobil si mohl adresu nadiktovat.
    meshPeerIps = mnozinaPeerIps(peery);
  } catch (e) {
    if (coreEmpty && MESH_IP_REQUIRED_BY.has(short) && meshGuardApplies(wave) && nejakaMeshIpVyplnena) {
      return {
        ok: false,
        error:
          `CORE_MESH_IP je prázdné, ALE jiné *_MESH_IP vyplněné jsou — mesh tedy STOJÍ ` +
          `a zrovna core z něj vypadl (discovery: ${e.message.split("\n")[0]}). ` +
          `To je nesoulad ustáleného stavu, ne první bring-up: nasadit '${short}' by ` +
          `znamenalo pustit provoz na mesh, kde jádro nemá adresu (incidenty 07-29/30/31). ` +
          `Oprav discovery (NETBIRD_API_URL/NETBIRD_MGMT_SECRET v .env.coolify) a spusť znovu.`,
      };
    }
    if (coreEmpty && MESH_IP_REQUIRED_BY.has(short) && meshGuardApplies(wave)) {
      // Panenská instance: PUSTÍME, ale hlasitě. Bez edge nevznikne veřejná tvář,
      // bez ní discovery a bez discovery mesh — blokovat by znamenalo zamknout
      // instanci napořád. Riziko DNAT bez cíle zmizelo 2026-08-21, mesh-router
      // dnes prázdnou hodnotu jen loguje.
      console.warn(
        `  ⚠ ${short}: CORE_MESH_IP prázdné a ŽÁDNÁ *_MESH_IP vyplněná není — ` +
          `panenská instance, mesh teprve vzniká. Nasazuji (edge je jediný vstup; ` +
          `bez něj se discovery nemá kam zeptat). Mesh adresy doplní ` +
          `coolify-mesh-sync.mjs --apply, až netbird-management stojí.`,
      );
    }
    // ⛔ TÁŽ UDÁLOST, DVA VÝZNAMY (naměřeno 2026-08-19).
    //
    // Před vlnou mesh warmupu netbird ještě NEBĚŽÍ — discovery nemá koho se
    // zeptat a selhání je ČEKANÝ stav, ne porucha. Od vlny warmupu dál už mesh
    // stát má, takže totéž selhání je nález.
    //
    // Hláška zněla v obou případech stejně: „mesh discovery selhalo". Operátor
    // ji pak četl jako poruchu i tam, kde žádná nebyla — a v opačném případě ji
    // přehlédl mezi ostatními. Rozlišení už v kódu JE (`meshGuardApplies`),
    // jen se nepromítalo do toho, co člověk uvidí. Měřidlo, které nerozliší
    // čekané od nečekaného, nutí čtenáře hádat.
    // ⛔ NAMĚŘENO 2026-08-27: tady stálo jen `e.message.split("\n")[0]`, což je
    // u `execFile` VŽDY jen „Command failed: node …/netbird-peer-discover.mjs".
    // Skutečnou příčinu píše potomek na stderr — a ta se zahazovala. Vlna 7
    // pak dvanáctkrát zopakovala hlášku, ze které nešlo poznat, jestli chybí
    // pověření, neodpovídá Keycloak, nebo je prázdná adresa. Potomek svou
    // diagnostiku napsal; volající ji musí PŘEDAT, ne uříznout.
    const _stderr = String(e?.stderr || "").trim().split("\n").filter(Boolean).slice(0, 3).join(" | ");
    // Odmítnuté pověření nese vlastní srozumitelnou větu (co to znamená, proč se
    // nezkouší znovu) — ta má přednost před surovým stderr potomka.
    const _duvod = e?.odmitnutePovereni ? e.message : (_stderr || e.message.split("\n")[0]);
    if (meshGuardApplies(wave)) {
      warn(
        `mesh discovery selhalo (${_duvod}) — a jsme ve vlně ${wave}, kde už mesh STÁT MÁ. ` +
          `*_MESH_IP klíče zůstávají, jak jsou; zkontroluj netbird-management.`,
      );
    } else {
      info(
        `mesh discovery zatím neodpovídá (${_duvod}) — ČEKANÉ: netbird se nasazuje až ve vlně ` +
          `${MESH_WARMUP_WAVE}. *_MESH_IP klíče zůstávají, jak jsou.`,
      );
    }
    return { ok: true };
  }

  // Do hlášení smí jen to, co náhrada OPRAVDU provedla — dřív se sem klíč
  // přidával bez ohledu na výsledek, takže „✓ mesh refresh" tvrdilo zápis,
  // který se nekonal.
  const filled = [];
  const zapis = await upravEnvCoolify(
    (cerstve) => {
      let out = cerstve;
      filled.length = 0;
      for (const key of emptyKeys) {
        const ip = discovered.get(key);
        if (!ip) continue;
        const re = new RegExp(`^${key}=\\s*$`, "m");
        if (!re.test(out)) continue;
        out = out.replace(re, `${key}=${ip}`);
        filled.push(`${key}=${ip}`);
      }
      // MESH_PEER_IPS se PŘEPISUJE, ne doplňuje: je to úplný výčet toho, co
      // discovery právě vidí. Doplňovat jen prázdnou hodnotu by znamenalo, že
      // odejitý peer zůstane důvěryhodný navždy.
      if (meshPeerIps.length > 0) {
        const hodnota = meshPeerIps.join(",");
        const re = /^MESH_PEER_IPS=.*$/m;
        // ⛔ NÁHRADA FUNKCÍ, ne řetězcem: `String.replace(a, b)` vykládá v `b`
        // sekvenci `$$` jako escape a tiše by hodnotu zmrzačila (2026-09-01).
        if (re.test(out)) out = out.replace(re, () => `MESH_PEER_IPS=${hodnota}`);
        else out += `${out.endsWith("\n") ? "" : "\n"}MESH_PEER_IPS=${hodnota}\n`;
        filled.push(`MESH_PEER_IPS=${meshPeerIps.length} peeru`);
      }
      return out;
    },
    { zaloha: "bak-mesh-refresh" },
  );
  if (zapis.zapsano) {
    ok(`mesh refresh: ${filled.join(", ")} (záloha .env.coolify.bak-mesh-refresh)`);
  } else if (filled.length > 0) {
    warn(`mesh refresh NEZAPSAL ${filled.join(", ")} — ${zapis.duvod}`);
  }
  if (coreEmpty && !discovered.get("CORE_MESH_IP") && MESH_IP_REQUIRED_BY.has(short) && meshGuardApplies(wave)) {
    return {
      ok: false,
      error:
        `CORE_MESH_IP zůstalo prázdné i po discovery (peer 'core' v NetBirdu není?). ` +
        `Deploy '${short}' se odmítá — viz incidenty 07-29/07-30/07-31.`,
    };
  }
  return { ok: true };
}

// ── Overlay cachebust refresh (ls-remote → env SoT, PŘED env-syncem) ────────
// Táž třída jako mesh IP výše: hodnota má výrobce, ale jen na JEDNÉ cestě.
//
// BuildKit kešuje vrstvu podle TEXTU příkazu, takže `git clone` overlay repa
// proběhne jednou a pak už nikdy — obraz veze obsah z prvního buildu. Proti
// tomu stojí `*_CACHEBUST`: SHA vzdálené větve, která se změní právě tehdy,
// když se změnil obsah. Jenže ji dosud počítal POUZE aisha-cold-start.sh, a
// navíc jen `if [ -z ... ]` — tedy když je prázdná. Při redeployi se
// nepřepočítala vůbec, takže platilo: overlay se změnil, deploy proběhl
// zeleně, a v obrazu zůstalo staré téma. Naměřeno 2026-08-02 — instanční
// texty přihlašovací stránky by nedorazily a build by to neohlásil.
//
// Povrchy (provision-surfaces.sh) to už dělají správně: přepočítávají při
// KAŽDÉM běhu. Tohle dorovnává zbylé dvě rodiny na týž vzor.
//
// Fail-soft, ale nahlas: prázdnou hodnotu sem nikdy nezapíšeme (na prázdné
// Dockerfile svc-web-artifactu schválně padá), a když se HEAD nepodaří
// přečíst, řekneme, CO to znamená — ne jen že se něco nepovedlo.
const OVERLAY_CACHEBUSTS = [
  {
    bustKey: "KC_THEME_OVERLAY_CACHEBUST",
    urlKey: "KC_THEME_OVERLAY_GIT_URL",
    refKey: "KC_THEME_OVERLAY_REF",
    consumers: new Set(["keycloak"]),      // Dockerfile.keycloak (téma přihlášení)
    what: "téma přihlašovací stránky z instančního repa",
  },
  {
    bustKey: "AISHA_WEB_DESIGN_CACHEBUST",
    urlKey: "AISHA_WEB_DESIGN_GIT_URL",
    refKey: null,                           // bez refu → výchozí větev vzdáleného repa
    consumers: new Set(["core"]),          // services/svc-web-artifact/Dockerfile
    what: "designový overlay webu",
  },
  {
    bustKey: "SURFACE_OVERLAY_CACHEBUST",
    urlKey: "SURFACE_OVERLAY_GIT_URL",
    refKey: "SURFACE_OVERLAY_REF",
    consumers: new Set(["extranet"]),      // deploy/surface-host/Dockerfile
    what: "instanční overlay povrchů (extranet)",
    // Tahle rodina NEŽIJE v .env.coolify — URL je nastavená přímo na Coolify
    // aplikaci, protože povrch je samostatná Dockerfile appka, ne compose stack.
    // Hodnotu proto čteme i vracíme TAM; env-sync by ji nedoručil, ten posílá
    // jen klíče přítomné v .env.coolify.
    onApp: true,
  },
  {
    bustKey: "SOURCE_ADAPTER_OVERLAY_CACHEBUST",
    urlKey: "SOURCE_ADAPTER_OVERLAY_GIT_URL",  // odvozuje env-doktor z AISHA_INSTANCE_DATA_GIT_URL
    refKey: "SOURCE_ADAPTER_OVERLAY_REF",
    consumers: new Set(["source-broker"]), // Dockerfile.svc-source-broker (stage source-adapters)
    what: "zdrojové adaptéry z instančního overlaye",
  },
];

async function refreshOverlayCachebusts(short, uuid) {
  const src = readEnvCoolify() ?? "";

  const val = (k) => {
    const m = src.match(new RegExp(`^${k}=(.*)$`, "m"));
    return m ? m[1].trim() : "";
  };

  // Envs Coolify aplikace — jen pro rodiny s `onApp`, a jen jednou.
  let appEnvs = null;
  const appVal = async (k) => {
    if (!uuid) return "";
    if (appEnvs === null) {
      try {
        const r = await coolify(`/applications/${uuid}/envs`);
        appEnvs = Array.isArray(r) ? r : (r?.data ?? []);
      } catch (e) {
        // Spolknutá chyba by udělala z „appku NELZE přečíst" totéž co
        // „appka žádné proměnné nemá" — a cachebust by se tiše přeskočil.
        // Prázdný seznam je tedy degradace, ne stav; musí být slyšet.
        //
        // Prázdno zůstává schválně: nasazení se kvůli nečitelným envům
        // neshazuje, volající spadne zpátky na své výchozí hodnoty. Mění se
        // jen to, že je ten rozdíl vidět.
        appEnvs = [];
        warn(
          `envy Coolify appky se nepodařilo přečíst (${e.message.split("\n")[0]}) — ` +
          `overlay se považuje za nedeklarovaný a cachebust se NEDOPLNÍ`,
        );
      }
    }
    return appEnvs.find((e) => e.key === k)?.value ?? "";
  };

  let out = src;
  const changed = [];
  for (const ov of OVERLAY_CACHEBUSTS) {
    if (!ov.consumers.has(short)) continue;
    const url = ov.onApp ? (val(ov.urlKey) || await appVal(ov.urlKey)) : val(ov.urlKey);
    if (!url) continue;                     // overlay pro tuhle instanci nedeklarovaný
    let sha = "";
    try {
      // Overlay URL do buildu NENESOU pověření (build arg = `docker history`;
      // naměřeno 2026-09-13 na SURFACE_OVERLAY_GIT_URL). `ls-remote` na privátní
      // repo token potřebuje — skript si ho doplní z FORGEJO_TOKEN, a ten tenhle
      // proces sám v prostředí nemá: leží v .env.coolify vedle URL.
      const { stdout } = await execFileP(
        "bash",
        [join(ROOT, "scripts/deploy/overlay-cachebust.sh"), url, ov.refKey ? val(ov.refKey) : ""],
        // Odvozená URL je bez tokenu (jde do build ARGu); HEAD soukromého repa
        // se pak čte tokenem z SoT — týmž, který build dostává secretem.
        { cwd: ROOT, env: { ...process.env, FORGEJO_TOKEN: process.env.FORGEJO_TOKEN || val("FORGEJO_TOKEN") } },
      );
      sha = stdout.trim();
    } catch (e) {
      warn(
        `${ov.bustKey}: HEAD overlay repa se nepodařilo přečíst (${e.message.split("\n")[0]}) — ` +
        `build '${short}' použije KEŠOVANÝ klon a nasadí ${ov.what} v podobě z prvního buildu`,
      );
      continue;
    }
    if (!sha) continue;                     // prázdné nikdy nezapisujeme

    if (ov.onApp) {
      // Hodnota patří tam, odkud si ji build bere — na aplikaci. env-sync by ji
      // nedoručil (posílá jen klíče přítomné v .env.coolify), a bez ní build
      // povrchu SPADNE: Dockerfile je fail-closed. Naměřeno 2026-08-02 —
      // <prefix>-extranet se pokusil nasadit třikrát a třikrát skončil na
      // "SURFACE_OVERLAY_GIT_URL je zadané, ale SURFACE_OVERLAY_CACHEBUST prázdné".
      if (sha === await appVal(ov.bustKey)) continue;
      // PATCH v Coolify jen PŘEPISUJE; nad neexistujícím klíčem vrací
      // 404 "Environment variable not found". Klíč, který na appce nikdy nebyl,
      // se tedy musí nejdřív ZALOŽIT přes POST.
      //
      // Naměřeno 2026-08-03: první verze téhle opravy uměla jen PATCH a spadla
      // přesně takhle. A je to zároveň vysvětlení, proč nepomohl ani
      // provision-surfaces.sh — ten PATCHuje s `|| true`, takže jeho zápis
      // selhával TIŠE. Výrobce hodnoty existoval, jen se nikdy nezapsal.
      const wrote = await (async () => {
        for (const method of ["PATCH", "POST"]) {
          try {
            await coolify(`/applications/${uuid}/envs`, {
              method,
              body: { key: ov.bustKey, value: sha, is_preview: false },
            });
            return method;
          } catch (e) {
            if (method === "POST") throw e;   // druhý pokus selhal → ven s tím
          }
        }
      })().catch((e) => {
        warn(
          `${ov.bustKey}: zápis na Coolify appku selhal (${e.message.split("\n")[0]}) — ` +
          `build '${short}' na prázdné hodnotě SPADNE (Dockerfile je fail-closed)`,
        );
        return null;
      });
      if (wrote) {
        appEnvs = null;                     // vynutit čerstvé čtení příště
        changed.push(`${ov.bustKey}=${sha.slice(0, 12)}… na appce ${wrote === "POST" ? "(nově založeno) " : ""}(${ov.what})`);
      }
      continue;
    }

    if (sha === val(ov.bustKey)) continue;  // beze změny → keš smí zůstat
    out = new RegExp(`^${ov.bustKey}=.*$`, "m").test(out)
      ? out.replace(new RegExp(`^${ov.bustKey}=.*$`, "m"), `${ov.bustKey}=${sha}`)
      : `${out.replace(/\n*$/, "\n")}${ov.bustKey}=${sha}\n`;
    changed.push(`${ov.bustKey}=${sha.slice(0, 12)}… (${ov.what})`);
  }

  // `out !== src` odliší zápis do SoT od změny, která šla rovnou na appku —
  // jinak by se .env.coolify přepisoval (a zálohoval) i tehdy, když se v něm
  // nic nezměnilo. Prázdný `src` (soubor není) tudy taky neprojde.
  if (out !== src) {
    // Přepočet se dělá nad `src` z doby PŘED zámkem; uvnitř zámku se proto
    // aplikuje na ČERSTVÝ obsah znovu, aby souběžná úprava nezmizela.
    const zapis = await upravEnvCoolify(
      (cerstve) => {
        let x = cerstve;
        for (const ov of OVERLAY_CACHEBUSTS) {
          const m = out.match(new RegExp(`^${ov.bustKey}=(.*)$`, "m"));
          if (!m) continue;
          const re = new RegExp(`^${ov.bustKey}=.*$`, "m");
          x = re.test(x) ? x.replace(re, `${ov.bustKey}=${m[1]}`) : `${x.replace(/\n*$/, "\n")}${ov.bustKey}=${m[1]}\n`;
        }
        return x;
      },
      { zaloha: "bak-overlay-cachebust" },
    );
    if (!zapis.zapsano && zapis.duvod !== "beze změny") {
      warn(`overlay cachebust NEZAPSÁN — ${zapis.duvod}`);
    }
  }
  if (changed.length > 0) ok(`overlay cachebust: ${changed.join(", ")}`);
  return { ok: true };
}

// ── Složeniny z domains.env (šablona → env SoT, PŘED env-syncem) ────────────
// Třetí výskyt téže třídy (mesh IP, overlay cachebust, tohle): hodnota MÁ
// výrobce, ale jen na jedné cestě. `config/domains.env` je ŠABLONA a rozvine ji
// POUZE `aisha-cold-start.sh`; `coolify-sync-envs.sh` pak posílá do Coolify jen
// to, co v `.env.coolify` už je. Změna šablony se tedy k běžící službě nikdy
// nedostane.
//
// Naměřeno 2026-08-03: PR #113 přidal `https://${AUTH_DOMAIN_PUBLIC}` do
// ALLOWED_ORIGINS, změna přistála v mainu — a gateway ji nedostala, takže
// přihlašovací stránka zůstala na „Stav provozu se zjišťuje".
//
// PROČ SEZNAM A NE PLOŠNÝ PŘEPIS
// Rozvinutí šablony nad produkčním SoT vydalo DVĚ odchylky: ALLOWED_ORIGINS
// (chtěná) a RAGNAROK_URL — kde `.env.coolify` nese
// `http://integration.mesh.<mesh-tld>:9696`, kdežto šablona
// `https://api.mesh.<mesh-tld>`. Ani jeden z klíčů není připnutý v
// `.env-prod-backup`, takže „operátor vyhrává" je nerozliší. Přepsat druhý
// naslepo by přesměrovalo integraci jinam. Nasazovací cesta proto přepisuje jen
// klíče, které VLASTNÍ; každou další odchylku OHLÁSÍ, aby nezůstala neviditelná.
const OWNED_COMPOSITES = new Set([
  "ALLOWED_ORIGINS",   // CORS pro prohlížečové originy (web, api, auth, povrchy)
  "CORS_ALLOWLIST",    // totéž pod jménem, které čtou služby
  // SSRF — kam služba SMÍ volat. Táž logika jako CORS, jen opačný směr:
  // CORS říká „kdo smí ke mně", SSRF „kam smím já". Obojí se ODVOZUJE z toho,
  // co existuje, ne udržuje. Naměřeno 2026-08-19: ruční seznam se rozešel se
  // skutečností ve 3 ze 4 položek u jediné služby a jinde nesl jméno CIZÍ
  // instance. `packages/security/src/ssrf.ts` je fail-closed jako `cors.ts`.
  "OPENCLAW_HOSTPORT",
  "OPENCLAW_HOST",
  "COSMOS_NODE_HOST",
  "LLM_PROVIDER_HOSTS",
  "AI_CHAT_SSRF_ALLOWLIST",
  "COSMOS_SSRF_ALLOWLIST",
]);

// ⛔ CO APPKA DOSTALA, A CO JE V SoT TEĎ — dvě různé věci.
//
// NAMĚŘENO 2026-09-03: běh skončil `exit=0` a hlásil „5 spuštěno, 5 zdravých,
// 0 selhání", a přesto `<fork>-core` odjel se seznamem důvěry BEZ JEDINÉ adresy
// mesh peera, kdežto `<fork>-edge` jich měl 23. Ve vlně 6 discovery dvakrát
// selhalo (přerušený dotaz na token Keycloaku), `core` se synchronizoval
// s prázdnou derivací; ve vlně 7 discovery uspělo a zapsalo 23 peerů — `edge`
// je dostal, `core` už ne.
//
// Souhrn to nepoznal, protože měří „doběhlo a je zdravé", ne „nese to, co má".
// Každá appka si proto při synchronizaci zapamatuje OTISK odvozených klíčů
// a na konci běhu se porovná s finálním SoT.
const otiskPriSyncu = new Map();
let _odvozeneKliceVBehu = null;

async function nactiOdvozeneKlice() {
  if (_odvozeneKliceVBehu) return _odvozeneKliceVBehu;
  const { stdout } = await execFileP("node", [join(ROOT, "scripts/aisha-env-doctor.mjs"), "--print-contract-keys"], {
    cwd: ROOT,
    maxBuffer: 4 * 1024 * 1024,
  });
  _odvozeneKliceVBehu = odvozeneKlice(stdout);
  return _odvozeneKliceVBehu;
}

/** Otisk odvozených klíčů nad AKTUÁLNÍM SoT; `null` = nešlo změřit. */
async function zmerOtisk() {
  try {
    const klice = await nactiOdvozeneKlice();
    const src = readEnvCoolify();
    if (src === null) return null;
    return otiskOdvozenych(src, klice);
  } catch (e) {
    // Nezměřeno není totéž co „shoda". Řekne se to a post-kontrola se přeskočí.
    warn(`otisk odvozených klíčů se nepodařilo změřit (${e.message.split("\n")[0]}) — post-kontrola bude NEPROHLÉDNUTO`);
    return null;
  }
}

// Odvozené klíče srovnat do SoT DŘÍV, než je env-sync roznese — táž cesta,
// týž důvod jako u složenin níže.
//
// ⛔ NAMĚŘENO 2026-09-02 V PROVOZU. `GATEWAY_TRUSTED_PROXIES` nesl v Coolify
// i v SoT `100.64.0.0/10` (CGNAT rozsah operátorů) i poté, co ho oprava
// z důvěry odstranila. Oprava byla v `derive-subnets.mjs`, env-doktor ji uměl
// spočítat — ale v nasazovací cestě ho NIKDO NESPOUŠTĚL:
//   · preflight v `coolify-sync-envs.sh` je `--report --strict`, tedy ČTENÁŘ,
//     a redeploy ho navíc vypíná přes `SKIP_ENV_PREFLIGHT=1`,
//   · `refreshDerivedComposites()` vlastní jen složeniny z `domains.env`.
// Zápis derivace tak dělal JEDINÝ volající — `aisha-cold-start.sh`. Nasazení
// posílalo, co v souboru zrovna leželo.
//
// ⭐ SPOUŠTÍ SE VLASTNÍK, NEDĚLÁ SE DRUHÝ. Přidat `GATEWAY_TRUSTED_PROXIES`
// mezi OWNED_COMPOSITES by znamenalo druhého zapisovatele téže hodnoty vedle
// env-doktora — a dva zapisovatelé, kteří tlačí opačně, jsou v tomhle repu
// zdokumentovaná porucha. Hodnota má JEDEN domov; tady se jen volá.
async function srovnejOdvozeneKlice() {
  // ⛔ DOKTOR JE ZAPISOVATEL — BĚŽÍ POD TÍMTÉŽ ZÁMKEM (naměřeno 2026-09-15).
  // Vlna spouští aplikace souběžně, takže doktor-dítě běželo vedle mesh
  // refreshe, složenin i DALŠÍHO doktora. Zámek výš serializoval jen zápisy
  // v tomhle procesu; doktor zapisoval mimo něj a rodič přečetl jeho rozepsaný
  // (prázdný) soubor. Dva souběžní doktoři navíc každý vygenerují JINOU
  // hodnotu téhož chybějícího tajemství — a každá aplikace odjede s jinou.
  const beh = _envZamek.then(() => spustDoktora());
  _envZamek = beh.then(() => {}, () => {});
  return beh;
}

async function spustDoktora() {
  // Holý běh = apply. Nenulový kód znamená, že doktor SPADL: chybějící
  // EXTERNAL klíče (které redeploy vědomě toleruje) končí nulou, protože
  // `--strict` je vypnutý. Kód je tu proto měřidlem toho, co nás zajímá.
  try {
    await execFileP("node", [join(ROOT, "scripts/aisha-env-doctor.mjs")], {
      cwd: ROOT,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { ok: true };
  } catch (e) {
    // Potomek píše příčinu na stderr; volající ji musí PŘEDAT, ne uříznout.
    const stderr = String(e?.stderr || "").trim().split("\n").filter(Boolean).slice(0, 3).join(" | ");
    return {
      ok: false,
      error:
        `env-doktor (srovnání odvozených klíčů) selhal: ${stderr || e.message.split("\n")[0]} — ` +
        `NEPOKRAČUJU: env-sync by roznesl SoT, o kterém nevím, že je aktuální.`,
    };
  }
}

async function refreshDerivedComposites() {
  const src = readEnvCoolify();
  if (src === null) return { ok: true };

  let lines = [];
  try {
    const { stdout } = await execFileP(
      "bash",
      [
        join(ROOT, "scripts/deploy/derive-composites.sh"),
        ENV_COOLIFY,
        join(ROOT, "config/domains.env"),
        // Vlastněné složeniny se smějí i ZALOŽIT. Bez toho by CORS_ALLOWLIST
        // zůstal navždy mimo SoT — a `packages/security/src/cors.ts` je
        // fail-closed, takže prázdný seznam odmítne každý prohlížečový origin.
        [...OWNED_COMPOSITES].join(","),
      ],
      { cwd: ROOT, maxBuffer: 4 * 1024 * 1024 },
    );
    lines = stdout.split("\n").filter((l) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(l));
  } catch (e) {
    warn(`složeniny z domains.env se nepodařilo rozvinout (${e.message.split("\n")[0]}) — env SoT zůstává, jak je`);
    return { ok: true };
  }

  let out = src;
  const changed = [];
  const cizi = [];
  for (const line of lines) {
    const key = line.slice(0, line.indexOf("="));
    const val = line.slice(line.indexOf("=") + 1);
    if (!OWNED_COMPOSITES.has(key)) { cizi.push(key); continue; }
    const re = new RegExp(`^${key}=.*$`, "m");
    // Vlastněnou složeninu, která v SoT ještě není, ZALOŽÍME. Nevlastněné se
    // sem nedostanou — skript je bez seznamu vlastněných klíčů ani nevydá.
    out = re.test(out)
      ? out.replace(re, `${key}=${val}`)
      : `${out.replace(/\n*$/, "\n")}${key}=${val}\n`;
    changed.push(key);
  }

  if (cizi.length > 0) {
    warn(
      `složeniny mimo správu nasazení se liší od config/domains.env: ${cizi.join(", ")} — ` +
      `NEPŘEPSÁNO. Je to buď ruční hodnota v .env.coolify, nebo zastaralá šablona; ` +
      `rozhodni vědomě a případně doplň do OWNED_COMPOSITES.`,
    );
  }
  if (changed.length > 0) {
    // Tytéž hodnoty se aplikují na ČERSTVÝ obsah uvnitř zámku. Bez toho
    // přepočet složenin přepsal soubor svou starší kopií a smazal
    // CORE_MESH_IP, kterou o chvíli dřív zapsal mesh refresh.
    const zapis = await upravEnvCoolify(
      (cerstve) => {
        let x = cerstve;
        for (const line of lines) {
          const key = line.slice(0, line.indexOf("="));
          const val2 = line.slice(line.indexOf("=") + 1);
          if (!OWNED_COMPOSITES.has(key)) continue;
          const re = new RegExp(`^${key}=.*$`, "m");
          x = re.test(x) ? x.replace(re, `${key}=${val2}`) : `${x.replace(/\n*$/, "\n")}${key}=${val2}\n`;
        }
        return x;
      },
      { zaloha: "bak-composites" },
    );
    if (zapis.zapsano) {
      ok(`složeniny přepočítány: ${changed.join(", ")} (záloha .env.coolify.bak-composites)`);
    } else if (zapis.duvod !== "beze změny") {
      warn(`složeniny NEZAPSÁNY (${changed.join(", ")}) — ${zapis.duvod}`);
    }
  }
  return { ok: true };
}

// ── Deploy trigger ───────────────────────────────────────────────────────────
async function triggerDeploy(uuid, name, wave) {
  // Re-sync this app's env BEFORE the force-redeploy so a compose change that
  // introduced a new ${VAR} (e.g. REDIS_PASSWORD_CORE in realtime,
  // docker-compose.coolify-realtime.yml) is interpolated against .env.coolify,
  // not the STALE on-app Coolify env. Without this, a standalone `npm run
  // redeploy` (which, unlike cold-start, never runs coolify-sync-envs.sh) lets
  // force=true recreate the container and interpolate the new var to EMPTY →
  // Redis WRONGPASS crashloop (incident 2026-06-13, realtime). Per-app
  // intersection filter (compose ${VAR} ∩ .env.coolify) makes this idempotent;
  // on cold-start the var is already synced so this is a no-op refresh.
  const short = name.startsWith(APP_PREFIX_DASH) ? name.slice(APP_PREFIX_DASH.length) : name;

  // Prázdné *_MESH_IP doplnit z discovery DŘÍV, než je env-sync roznese —
  // jinak env-sync přepíše i hodnotu, kterou mesh-sync mezitím nastavil na
  // Coolify (třetí výskyt: 07-29, 07-30, 07-31; detail u refreshMeshIps).
  const mesh = await refreshMeshIps(short, wave);
  if (!mesh.ok) return { ok: false, error: mesh.error };

  // Táž cesta, týž důvod: šablona domains.env se musí rozvinout do SoT DŘÍV,
  // než ho env-sync roznese — jinak změna domén/originů zůstane jen v gitu.
  await refreshDerivedComposites();

  // Táž cesta, týž důvod, a JAKO POSLEDNÍ: derivace čte `MESH_PEER_IPS`, které
  // doplňuje `refreshMeshIps` o pár řádků výš. Kdyby se srovnávalo dřív,
  // vyrobil by se seznam důvěry bez mesh peerů.
  const odvozene = await srovnejOdvozeneKlice();
  if (!odvozene.ok) return { ok: false, error: odvozene.error };

  // Táž cesta, týž důvod: hodnotu, kterou build potřebuje čerstvou, doplň do
  // SoT DŘÍV, než ji env-sync roznese. Bez toho se overlay zakeší napořád.
  //
  // AŽ ZA DOKTOREM (2026-09-14): URL overlaye může být odvozená
  // (SOURCE_ADAPTER_OVERLAY_GIT_URL). Počítat cachebust před srovnáním by na
  // PRVNÍM nasazení našlo URL prázdnou, cachebust vynechalo — a sync by pak
  // doručil URL bez cachebustu, na čemž fail-closed build spadne. Druhý běh by
  // prošel, první ne. Derivace na cachebustu nezávisí, pořadí je tedy volné.
  await refreshOverlayCachebusts(short, uuid);

  // Sync roznáší SoT do Coolify — nad SoT, který přišel o klíče, NIKDY
  // (viz _kliceNaStartu). Roznesl by nová tajemství místo běžících.
  const predSyncem = readEnvCoolify();
  const ztracenePredSyncem = predSyncem === null ? [] : ztraceneKliceProtiStartu(predSyncem);
  if (ztracenePredSyncem.length) {
    return {
      ok: false,
      error: `${popisZtraty(ztracenePredSyncem)} — env-sync NESPUŠTĚN. Obnov .env.coolify ze zálohy (.backup/) a spusť znovu.`,
    };
  }

  // Zapamatovat, S ČÍM tahle appka odjíždí — porovná se na konci běhu.
  const otiskTed = await zmerOtisk();
  if (otiskTed) otiskPriSyncu.set(short, otiskTed.otisk);

  try {
    await execFileP("bash", [join(ROOT, "scripts/coolify-sync-envs.sh"), short], {
      cwd: ROOT,
      // Mirror cold-start's invocation (aisha-cold-start.sh): skip the strict
      // env-doctor preflight so an unrelated empty EXTERNAL secret can't abort
      // an otherwise-valid redeploy. The per-app filter only pushes keys
      // PRESENT in .env.coolify, so a missing var is simply not sent (never
      // pushed as empty).
      env: { ...process.env, SKIP_ENV_PREFLIGHT: "1" },
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (e) {
    // Fail closed: do NOT proceed to deploy with stale env — that is the bug
    // this fixes. Surface it so the wave marks this app failed_trigger.
    //
    // PROČ sync selhal, píše na STDOUT: řádky ✗ s chybějícími povinnými
    // proměnnými a → s příkazem k nápravě (scripts/lib/povinne-promenne.mjs).
    // `e.message` nese jen stderr, takže bez nich by vlna řekla „Command failed"
    // a příkaz, který obsluhu posune dál, by zůstal v zahozeném výstupu.
    const nalezy = String(e?.stdout || "")
      .split("\n")
      .filter((r) => /✗|→|KEYS=/.test(r))
      .slice(0, 12)
      .map((r) => r.trim());
    return {
      ok: false,
      error: `env-sync failed before deploy: ${e.message}${nalezy.length ? `\n  ${nalezy.join("\n  ")}` : ""}`,
    };
  }
  // ⛔ NEZAKLÁDAT DRUHÉ NASAZENÍ TÉŽE APLIKACE (naměřeno 2026-09-02).
  //
  // O pár set řádků výš stálo, že „Coolify is actively working (its serial
  // build queue is draining)". Tak to NENÍ: fronta sériová není a druhé
  // nasazení TÉŽE aplikace přijme, zatímco první běží. Změřeno na sdíleném
  // Coolify za 14 dní: překryvy u aplikací pěti různých projektů, nejvíc 43
  // u jedné aplikace; u vlastní instance 4.
  //
  // Nás to dosud nekouslo jen proto, že vlny nasazujeme sériově samy od sebe —
  // ne že by to kdokoli hlídal. Jakmile se běh přeruší a spustí znovu (tři
  // pokusy o wipe 2026-08-30), navazující běh spustí nasazení proti tomu,
  // které po mrtvém běhu ještě dobíhá.
  //
  // Řadit za Coolify NEBUDEME — jen se ho zeptáme, jestli už neběží, a pokud
  // ano, PŘEVEZMEME ho místo zakládání druhého. Vlna pak čeká na TOTÉŽ
  // nasazení, které opravdu běží, ne na svoje vlastní vedle něj.
  const rozdelane = await bezicíNasazeniAplikace(uuid);
  if (rozdelane) {
    return { ok: true, deployment: rozdelane, prevzato: true };
  }
  try {
    const r = await coolify(`/deploy?uuid=${uuid}&force=true`, { method: "POST" });
    const d = r?.deployments?.[0]?.deployment_uuid || r?.deployment_uuid || "";
    // ⛔ Bez `deployment_uuid` se výsledek nasazení NEDÁ změřit: vlna by ho
    // posoudila podle zdraví STARÉHO kontejneru. Coolify požadavek přijal
    // a nic nezařadil — týž výklad jako u restartu níž a v deploy-and-verify.sh.
    if (!d) return { ok: false, error: "POST /deploy bez deployment_uuid — nasazení se nezařadilo (odpověď bez důkazu)" };
    return { ok: true, deployment: d };
  } catch (e) {
    // `backpressure` = server má PLNOU frontu nasazení. To není vada tohohle
    // spouštěče, je to „teď ne" — a musí se to donést až do vlny, která jediná
    // umí počkat SPOLEČNĚ za všechny (jinak si N spouštěčů vyrobí retry storm).
    return { ok: false, error: e.message, backpressure: e?.backpressure === true };
  }
}

// ── Restart trigger (restart validace) ───────────────────────────────────────
// ZÁMĚRNĚ bez env-sync, mesh-refresh i cachebustů: restart měří, že NASAZENÝ
// stav se umí vrátit sám. Cokoli bychom před ním dosypali, by měřilo jiný stav
// než ten, který poběží po příštím výpadku.
//
// Změřeno 2026-08-11 (aisha-clamav): POST /applications/{uuid}/restart → 200 +
// deployment_uuid; deployment jde do TÉŽE sériové fronty serveru jako deploye
// (viselo `queued` za build-heavy vlnou). Bez deployment_uuid restart nejde
// odlišit od tichého no-opu → fail-loud.
async function triggerRestart(uuid, name, _wave) {
  try {
    const r = await coolify(`/applications/${uuid}/restart`, { method: "POST", timeoutMs: 30_000 });
    const d = r?.deployment_uuid || r?.deployments?.[0]?.deployment_uuid || "";
    if (!d) {
      return { ok: false, error: "restart bez deployment_uuid — nelze prokázat, že se vůbec zařadil (odpověď bez důkazu)" };
    }
    return { ok: true, deployment: d };
  } catch (e) {
    return { ok: false, error: e.message, backpressure: e?.backpressure === true };
  }
}

// ── Hlídané spouštění: JEDINÉ dveře k triggeru ───────────────────────────────
//
// ⛔ NAMĚŘENO 2026-09-24 (fork, sdílený hostitel). Vlna spouštěla všechny cíle
// přes `Promise.all`, osm stacků si naráz stahovalo a stavělo obrazy a disk
// uzlu došel (ENOSPC, 100 %). Kaskáda shodila i to, co předtím běželo.
//
// Každé spuštění — vlna, kanárek, auto-retry i dodatečný průchod po změně
// SoT — proto jde TUDY:
//   1. disková brána změří uzel, kam nasazení poběží (lib/diskova-brana.mjs);
//      nedostatek = STOP celého běhu, žádný POST /deploy;
//   2. nejvýš `deploy_concurrency` nasazení v letu; místo se uvolní až
//      DOBĚHNUTÍM nasazení, ne odesláním triggeru (lib/nasazeni-s-omezenim.mjs).
// Čtyři místa s vlastním triggerem by byla čtyři místa, kde záruka neplatí.
//
// `--no-wait` se týká čekání na ZDRAVÍ; na doběhnutí nasazení se čeká vždy —
// jinak by se sériovost změnila zpátky v souběh, který disk nevydržel.
const hlidani = { soubeznost: null, zdroj: "", mapaUzlu: null, nezmereno: [], zastaveni: null };

/**
 * `deploy_concurrency` z profilu instance. JEDEN domov: žádná proměnná
 * prostředí ani přepínač. Chybějící klíč = 1 (sériově). Nečitelný profil nebo
 * neplatná hodnota je CHYBA — profil řídí víc než tohle a nesmí projít tiše,
 * i když 1 je bezpečný směr.
 */
function nactiSoubeznost() {
  const id = (process.env.AISHA_PROFILE || readBackupKey("AISHA_PROFILE") || "").trim();
  if (!id) {
    throw new Error(
      "AISHA_PROFILE není deklarovaný — nevím, z jakého profilu číst deploy_concurrency. " +
        "Deklaruj ho v .env-prod-backup (týž klíč čte resolver domén).",
    );
  }
  const v = loadProfile(id)?.deploy_concurrency;
  if (v === undefined) return { soubeznost: 1, zdroj: `profil ${id} klíč nemá → sériově` };
  if (!Number.isInteger(v) || v < 1) {
    throw new Error(`profil ${id}: deploy_concurrency=${JSON.stringify(v)} — čekám celé číslo ≥ 1`);
  }
  return { soubeznost: v, zdroj: `profil ${id}` };
}

function pripravHlidani() {
  if (hlidani.soubeznost !== null) return;
  try {
    const { soubeznost, zdroj } = nactiSoubeznost();
    hlidani.soubeznost = soubeznost;
    hlidani.zdroj = zdroj;
    hlidani.mapaUzlu = nactiMapuUzlu(process.env.AISHA_NODE_SSH || readBackupKey("AISHA_NODE_SSH"));
  } catch (e) {
    errLog(e.message);
    process.exit(2);
  }
  const uzly = [...hlidani.mapaUzlu.keys()];
  info(`Souběžnost nasazení: ${hlidani.soubeznost} (${hlidani.zdroj})`);
  info(`Disková brána: ${uzly.length ? `měří uzly ${uzly.join(", ")}` : "AISHA_NODE_SSH nedeklaruje žádný uzel → disk NEZMĚŘEN"}`);
}

/**
 * `image:` reference stacku, rozvinuté hodnotami, se kterými compose interpoluje
 * Coolify (týž čtenář jako mapa instance: prostředí, pak .env.coolify).
 * Nerozvinutelné reference se hlásí — nesmí se tvářit, že stack nic nestahuje.
 */
function obrazyAplikace(jmeno) {
  const { compose, cti } = mapaInstance();
  const soubor = compose.get(jmeno);
  if (!soubor || !existsSync(join(ROOT, soubor))) return [];
  const { obrazy, nerozvinute } = obrazyZCompose(readFileSync(join(ROOT, soubor), "utf8"), cti);
  if (nerozvinute.length) {
    warn(`${jmeno.padEnd(22)} disková brána: ${nerozvinute.length} image: nejde rozvinout (${nerozvinute.slice(0, 3).join(", ")}) — ty se neměří`);
  }
  return obrazy;
}

/**
 * Služby stacku se `build:` — na uzlu z nich vznikne `<uuid>_<služba>`. Brána podle
 * nich pozná, že stack bez kontejnerů má na uzlu jen ČÁST obrazů (pak NEZMĚŘENO).
 * Nečitelný compose se hlásí — nesmí se tvářit, že stack nic nestaví.
 */
function stavbyAplikace(jmeno) {
  const { compose } = mapaInstance();
  const soubor = compose.get(jmeno);
  if (!soubor || !existsSync(join(ROOT, soubor))) return [];
  const sluzby = sluzbySeStavbou(readFileSync(join(ROOT, soubor), "utf8"));
  if (!sluzby) {
    warn(`${jmeno.padEnd(22)} disková brána: ${soubor} nejde přečíst jako compose — stavěné obrazy se nepočítají`);
    return [];
  }
  return sluzby;
}

/** Vzdálené čtení přes deklarovaný SSH cíl. Příkaz skládá diskova-brana (jen čtení). */
async function sshCti(cil, prikaz) {
  const { stdout } = await execFileP(
    "ssh",
    ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", cil, prikaz],
    { timeout: 180_000, maxBuffer: 16 * 1024 * 1024 },
  );
  return stdout;
}

/**
 * Spustí nasazení `jmena` hlídaně (viz hlavička sekce). Vrací výsledky ve tvaru
 * triggerDeploy (`{ name, ok, deployment?, error?, backpressure?, zastaveno? }`)
 * v pořadí vstupu. Po STOPu kdekoli v běhu už nespustí nic.
 */
async function spustHlidane(jmena, { apps, triggerFn = triggerDeploy, wave }) {
  // Pozici ve vlně volající DEKLARUJE (číslo vlny, nebo WAVE_ADHOC) — dveře ji
  // jen předávají triggeru. Neuvedená pozice je chyba volajícího (viz meshGuardApplies).
  if (wave !== WAVE_ADHOC && !Number.isInteger(wave)) {
    throw new Error(`spustHlidane: pozice ve vlně není deklarovaná (${String(wave)}) — předej wave.num nebo WAVE_ADHOC`);
  }
  pripravHlidani();
  if (hlidani.zastaveni) {
    const z = hlidani.zastaveni;
    return jmena.map((name) => ({ name, ok: false, zastaveno: true, error: `nespuštěno — běh zastaven u ${z.jmeno}: ${z.duvod}` }));
  }
  const brana = vytvorDiskovouBranu({
    mapaUzlu: hlidani.mapaUzlu,
    uzelAplikace: (n) => apps.get(n)?.destination?.server?.name ?? null,
    uuidAplikace: (n) => apps.get(n)?.uuid ?? null,
    obrazyAplikace,
    stavbyAplikace,
    ssh: sshCti,
  });
  const { vysledky, zastaveni } = await spustSOmezenim(jmena, {
    soubeznost: hlidani.soubeznost,
    predSpustenim: async (n, kontext) => {
      const v = await brana(n, kontext);
      if (v.nezmereno) {
        hlidani.nezmereno.push({ name: n, ...v.nezmereno });
        warn(`${n.padEnd(22)} disk NEZMĚŘEN — ${v.nezmereno.duvod}`);
      } else if (v.ok && v.cisla) {
        info(`${n.padEnd(22)} disk ${v.cisla.uzel}: volno ${gib(v.cisla.volnoB)} ≥ potřeba ${gib(v.cisla.potrebaB)}`);
      }
      return v;
    },
    spust: (n) => {
      const a = apps.get(n);
      return a ? triggerFn(a.uuid, n, wave) : Promise.resolve({ ok: false, error: "aplikace v Coolify chybí" });
    },
    dobehni: (n, r) =>
      pockejNaDobehnuti(r.deployment, {
        ctiStav: fetchDeploymentStatus,
        intervalMs: HEALTH_POLL_S * 1000,
        limitMs: STROP_NASAZENI_S * 1000,
        priZmene: (s) => log(`    ${C.dim("[deploy]")} ${n.padEnd(22)} ${s || "?"} ${C.dim(r.deployment)}`),
      }),
  });
  if (zastaveni && !hlidani.zastaveni) {
    hlidani.zastaveni = zastaveni;
    errLog(`BĚH ZASTAVEN u ${zastaveni.jmeno}: ${zastaveni.duvod}`);
  }
  return vysledky;
}

// ── Pre-wave snapshot ────────────────────────────────────────────────────────
// Captures last-known-good deployment_uuid for each app v rámci wave PŘED
// triggering deploys. Pokud wave failne, snapshot slouží jako reference pro
// manuální rollback (Coolify UI → Deployments → Re-deploy on saved uuid).
async function snapshotWave(waveNum, targetApps, allApps) {
  const snapshot = {
    run_id: RUN_ID,
    wave: waveNum,
    timestamp: new Date().toISOString(),
    coolify_base: COOLIFY_BASE,
    apps: [],
  };

  for (const name of targetApps) {
    const a = allApps.get(name);
    if (!a) continue;
    // Best-effort: fetch last deployments per app. If endpoint nepodporuje,
    // alespoň capture current uuid + status.
    let lastDeployment = null;
    try {
      // ⛔ BYLO `/applications/{uuid}/deployments` — vrací 404, takže `catch`
      // ho spolkl a `lastDeployment` byl VŽDY null. Snapshot tím nikdy nenesl
      // `last_deployment_uuid`, který nabízí při zotavení. Ověřeno 2026-09-02.
      const deployments = await coolify(`/deployments/applications/${a.uuid}?take=1`, { timeoutMs: 10_000 });
      // Various Coolify API shapes — try a few
      const list = Array.isArray(deployments?.deployments) ? deployments.deployments
                 : Array.isArray(deployments?.data) ? deployments.data
                 : Array.isArray(deployments) ? deployments : [];
      lastDeployment = list[0] || null;
    } catch {
      // Endpoint may not exist; ignore
    }

    snapshot.apps.push({
      name,
      uuid: a.uuid,
      pre_wave_status: a.status || "unknown",
      last_online_at: a.last_online_at || null,
      last_deployment_uuid: lastDeployment?.uuid || lastDeployment?.deployment_uuid || null,
      last_deployment_status: lastDeployment?.status || null,
      last_deployment_commit: lastDeployment?.commit || lastDeployment?.git_commit_sha || null,
    });
  }

  try {
    if (!existsSync(SNAPSHOT_DIR)) mkdirSync(SNAPSHOT_DIR, { recursive: true });
    const path = join(SNAPSHOT_DIR, `${RUN_ID}-wave${waveNum}.json`);
    writeFileSync(path, JSON.stringify(snapshot, null, 2));
    info(`Snapshot saved: ${path}`);
    return { snapshot, path };
  } catch (e) {
    warn(`Snapshot save failed: ${e.message}`);
    return { snapshot, path: null };
  }
}

// Try multiple Coolify endpoint shapes for redeploy specific past deployment.
// Returns { ok: true, endpoint } if any worked, { ok: false } if all failed.
async function tryCoolifyRollback(appUuid, deploymentUuid) {
  // Endpoint shape 1: direct deployment restart (Coolify v4 newer)
  try {
    const r = await coolify(`/deployments/${deploymentUuid}/restart?force=true`, { method: "POST", timeoutMs: 15_000 });
    if (r) return { ok: true, endpoint: `/deployments/${deploymentUuid}/restart` };
  } catch {
    // Endpoint shape mismatch — fall through to next variant
  }

  // Endpoint shape 2: application restart with deployment ref
  try {
    const r = await coolify(`/applications/${appUuid}/restart?deployment_uuid=${deploymentUuid}&force=true`, { method: "POST", timeoutMs: 15_000 });
    if (r) return { ok: true, endpoint: `/applications/${appUuid}/restart?deployment_uuid=...` };
  } catch {
    // Endpoint shape mismatch — fall through to next variant
  }

  // Endpoint shape 3: deploy with explicit commit (if snapshot has commit)
  // Skipped — would need PATCH git_commit_sha + redeploy, side-effect-heavy.

  return { ok: false };
}

async function printRollbackRecipe(snapshot, snapshotPath, failedApps, opts = {}) {
  if (!snapshot || failedApps.length === 0) return;
  const autoRollback = opts.autoRollback === true;

  log("");
  log(C.bold(C.yellow("━━━ ROLLBACK RECIPE ━━━")));
  log(C.dim(`  Snapshot: ${snapshotPath || "(in-memory only)"}`));
  log("");
  log(C.bold("Failed apps and their last-known-good deployments:"));

  for (const app of failedApps) {
    const snap = snapshot.apps.find((a) => a.name === app);
    if (!snap) continue;
    log(`  ${C.cyan(app)}`);
    log(`    Pre-wave status:  ${snap.pre_wave_status}`);
    if (snap.last_deployment_uuid) {
      log(`    Last deployment:  ${snap.last_deployment_uuid} (${snap.last_deployment_status || "?"})`);
      if (snap.last_deployment_commit) {
        log(`    Last commit:      ${snap.last_deployment_commit.slice(0, 12)}`);
      }
      if (autoRollback) {
        info(`    Attempting auto-rollback via Coolify API...`);
        const r = await tryCoolifyRollback(snap.uuid, snap.last_deployment_uuid);
        if (r.ok) {
          ok(`    Auto-rollback triggered: ${r.endpoint}`);
        } else {
          warn(`    Auto-rollback failed (Coolify API endpoint not accepted)`);
          log(`    ${C.dim("Fallback — manual rollback v Coolify UI:")}`);
          log(`    ${C.dim(`  → ${COOLIFY_BASE}/applications/${snap.uuid}/deployments`)}`);
          log(`    ${C.dim(`  → klikni Re-Deploy na deployment ${snap.last_deployment_uuid}`)}`);
        }
      } else {
        log(`    ${C.dim("Auto-rollback (--auto-rollback flag):")}`);
        log(`    ${C.dim(`  POST ${COOLIFY_BASE}/api/v1/deployments/${snap.last_deployment_uuid}/restart`)}`);
        log(`    ${C.dim("Manual fallback v Coolify UI:")}`);
        log(`    ${C.dim(`  → ${COOLIFY_BASE}/applications/${snap.uuid}/deployments`)}`);
      }
    } else {
      log(`    ${C.dim("(no prior deployment recorded — fresh app, žádný rollback target)")}`);
    }
  }
  log("");
}

// ── Filtering ────────────────────────────────────────────────────────────────
/** Aplikace z manifestu instance, které v Coolify chybí (plní main, čte výsledek). */
const CHYBI_V_COOLIFY = new Set();
function filterWaveApps(wave, apps) {
  // Vypnutá lane se NENASAZUJE, i když aplikace v Coolify z dřívějška existuje —
  // hlásí se jednou na začátku běhu (viz ohlasMapuInstance), ne tady.
  const { vypnute } = mapaInstance();
  let names = wave.apps.filter((n) => apps.has(n) && !vypnute.has(n));
  if (ONLY) {
    const set = new Set(ONLY.split(",").map((s) => `${APP_PREFIX_DASH}${s.trim()}`));
    names = names.filter((n) => set.has(n));
  } else {
    // Skip known-broken apps unless explicitly targeted via --only
    names = names.filter((n) => !KNOWN_BROKEN.has(n));
  }
  if (SKIP_HEALTHY) {
    names = names.filter((n) => classifyStatus(apps.get(n).status) !== "healthy");
  }
  return names;
}

// ── Canary deploy ────────────────────────────────────────────────────────────
// Deploys single app + extended verify (longer STABLE_POLLS, deployment status
// check, no wave continuation). Output je explicit "OK / FAIL" rozhodnutí pro
// rozhodnutí, jestli pokračovat normálním cold-start.
async function runCanary(shortName, apps) {
  const fullName = shortName.startsWith(APP_PREFIX_DASH) ? shortName : `${APP_PREFIX_DASH}${shortName}`;
  const app = apps.get(fullName);
  if (!app) {
    errLog(`Canary target not found: ${fullName}`);
    errLog(`  Available: ${[...apps.keys()].join(", ")}`);
    process.exit(2);
  }

  log(C.bold(`\n━━━ Canary: ${fullName} ━━━`));
  log(`  ${C.dim("UUID:")}        ${app.uuid}`);
  log(`  ${C.dim("Pre-status:")}  ${app.status || "?"}`);

  // Snapshot before deploy (rollback recipe target if canary fails)
  const { snapshot, path: snapPath } = await snapshotWave(0, [fullName], apps);

  // Trigger deploy — hlídaně jako každé jiné (disková brána + doběhnutí).
  info("Triggering deploy...");
  const [r] = await spustHlidane([fullName], { apps, wave: WAVE_ADHOC });
  if (!r.ok) {
    errLog(`Deploy trigger failed: ${r.error}`);
    process.exit(1);
  }
  ok(`Queued deployment ${r.deployment}`);

  // Extended verify: 2× normální STABLE_POLLS pro canary (raise confidence threshold)
  const canaryStablePolls = STABLE_POLLS * 2;
  const canaryTimeoutS = WAVE_TIMEOUT_S;
  info(`Waiting up to ${canaryTimeoutS}s for healthy + ${canaryStablePolls} stable polls...`);

  const deployments = new Map([[fullName, r.deployment]]);
  // Manually replicate wait logic with custom STABLE_POLLS
  const deadline = Date.now() + canaryTimeoutS * 1000;
  const stableCount = new Map();
  let lastStatus = null;
  let lastDeployStatus = null;

  while (Date.now() < deadline) {
    let cur;
    try {
      cur = await fetchApps();
    } catch (e) {
      warn(`fetchApps transient: ${e.message}`);
      await sleep(HEALTH_POLL_S * 1000);
      continue;
    }
    const a = cur.get(fullName);
    if (!a) {
      warn(`${fullName} not found in API response — retrying`);
      await sleep(HEALTH_POLL_S * 1000);
      continue;
    }
    const cls = classifyStatus(a.status);
    if (a.status !== lastStatus) {
      log(`    ${C.dim("[canary]")} ${a.status} (${cls})`);
      lastStatus = a.status;
    }
    if (r.deployment) {
      try {
        const ds = await fetchDeploymentStatus(r.deployment);
        if (ds && ds !== lastDeployStatus) {
          log(`    ${C.dim("[deploy]")} ${ds}`);
          lastDeployStatus = ds;
        }
        if (ds === "failed" || ds === "cancelled") {
          errLog(`Canary FAIL — deployment ${ds}`);
          await printRollbackRecipe(snapshot, snapPath, [fullName], { autoRollback: AUTO_ROLLBACK });
          process.exit(1);
        }
      } catch {
        // Transient API hiccup — retry on next poll iteration
      }
    }

    if (isFullyHealthy(cls)) {
      stableCount.set(fullName, (stableCount.get(fullName) || 0) + 1);
      if (stableCount.get(fullName) >= canaryStablePolls) {
        ok(`Canary OK — ${fullName} healthy + stable for ${canaryStablePolls} polls`);
        log("");
        log(C.green("  ✓ Canary verdict: PROCEED"));
        log(`    Bezpečné dokončit deploy: ${C.dim("node scripts/aisha-redeploy.mjs")}`);
        log(`    Nebo cold-start s --skip-create: ${C.dim("bash scripts/aisha-cold-start.sh --skip-create")}`);
        return;
      }
    } else {
      stableCount.set(fullName, 0);
    }
    await sleep(HEALTH_POLL_S * 1000);
  }

  errLog(`Canary FAIL — ${fullName} did not reach healthy in ${canaryTimeoutS}s`);
  log(C.red("  ✗ Canary verdict: ABORT"));
  await printRollbackRecipe(snapshot, snapPath, [fullName], { autoRollback: AUTO_ROLLBACK });
  process.exit(1);
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  // `--print-phases` — hranice fází pro cold-start, ve tvaru k `eval`u.
  // Tímhle kanálem přestávají být čísla vln opsaná v shellu: cold-start si je
  // vyzvedne z TÉHOŽ pole, které vlny definuje. Stejný vzor jako
  // `derive-domains.mjs --shell`, který už cold-start source-uje.
  //
  // Píše se JEDNÍM zápisem a čeká na jeho dokončení: `console.log` do roury
  // s následným `process.exit()` zahodí nezapsané bajty (naměřeno 2026-08-12
  // u env-doctor --print-contract-keys, kde se tím uřízl konec seznamu).
  if (flag("--print-phases")) {
    const p = PHASE_BOUNDARIES;
    const text =
      `AISHA_WAVE_PHASE_A_UNTIL=${p.A_UNTIL}\n` +
      `AISHA_WAVE_PHASE_C_FROM=${p.C_FROM}\n` +
      `AISHA_WAVE_PHASE_C_UNTIL=${p.C_UNTIL}\n` +
      `AISHA_WAVE_PHASE_D_FROM=${p.D_FROM}\n` +
      `AISHA_WAVE_LAST=${p.LAST}\n` +
      `__PHASES_END__=${Object.keys(p).length}\n`;
    await new Promise((resolve) => process.stdout.write(text, resolve));
    process.exit(0);
  }

  // `--print-waves` — pořadí, ve kterém CI nasazuje dotčené aplikace. Z TÉHOŽ
  // pole, podle kterého nasazuje cold-start, takže se CI a cold-start nemohou
  // rozejít v tom, co musí stát dřív (registry → pki → core → keycloak →
  // netbird → mesh-router → peeři → edge). Role se vypíše JEN při prvním
  // výskytu: vlna 6 („Přepnutí do meshe") opakuje už nasazené aplikace, což je
  // krok konvergence cold-startu, ne druhé nasazení téže změny.
  // Jména bez prefixu instance (`aisha-` je v poli šablona) — CI je předává
  // `deploy-and-verify.sh`, který prefix doplní z deklarace instance.
  if (flag("--print-waves")) {
    const videne = new Set();
    let text = "";
    for (const wave of [...WAVES].sort((a, b) => a.num - b.num)) {
      for (const sablona of wave.apps ?? []) {
        const role = sablona.replace(/^aisha-/, "");
        if (videne.has(role)) continue;
        videne.add(role);
        const strop = STROP_PRACE_S[sablona];
        text += strop ? `${wave.num}\t${role}\t${strop}\n` : `${wave.num}\t${role}\n`;
      }
    }
    if (!videne.size) {
      process.stderr.write("aisha-redeploy --print-waves: WAVES neobsahují jedinou aplikaci — pořadí nejde vydat\n");
      process.exit(2);
    }
    await new Promise((resolve) => process.stdout.write(text, resolve));
    process.exit(0);
  }

  log(C.bold("\n🚀 aisha-redeploy — stateful Coolify redeploy\n"));
  log(`  ${C.dim("Coolify:")}      ${COOLIFY_BASE}`);
  log(`  ${C.dim("Mode:")}         ${CANARY ? `canary --canary=${CANARY}` : STATUS_ONLY ? "status-only" : PLAN_ONLY ? "plan-only" : RESTART_VALIDATE ? "restart-validate (restart nasazeného stavu + návrat zdraví)" : "execute"}`);
  if (ONLY) log(`  ${C.dim("Filter:")}       --only=${ONLY}`);
  if (FROM_WAVE > 1) log(`  ${C.dim("From wave:")}    ${FROM_WAVE}`);
  if (UNTIL_WAVE < 999) log(`  ${C.dim("Until wave:")}   ${UNTIL_WAVE}`);
  if (SKIP_HEALTHY) log(`  ${C.dim("Skip healthy:")} yes`);
  if (NO_WAIT) log(`  ${C.dim("Wait health:")}  no`);
  log("");

  // Výchozí bod invariantu „klíče jen přibývají" (viz _kliceNaStartu).
  const sotNaStartu = readEnvCoolify();
  if (sotNaStartu !== null) {
    _kliceNaStartu = kliceSoT(sotNaStartu);
    if (_kliceNaStartu.size === 0) {
      errLog(`${ENV_COOLIFY} existuje, ale nenese jediný klíč — rozepsaný nebo zkrácený zápis. Nasazení nad ním by vyrobilo nová tajemství.`);
      process.exit(2);
    }
  }

  info("Fetching current state from Coolify...");
  // `let`, ne `const`: stav se před KAŽDOU vlnou načítá znovu (viz smyčka níž).
  let apps = await fetchApps();
  if (apps.size === 0) {
    errLog(`No ${APP_PREFIX_DASH}* applications found`);
    process.exit(2);
  }
  ok(`Found ${apps.size} ${APP_PREFIX_DASH}* applications`);
  printStatusTable(apps);

  if (STATUS_ONLY) return;

  // Co manifest nasazuje a co z toho v Coolify CHYBÍ / má vypnutou lane — nahlas,
  // jednou, pro vlny v rozsahu tohoto běhu. Chybějící se započítá do výsledku.
  const { ocekavane, vypnute } = mapaInstance();
  const vRozsahu = new Set(WAVES.filter((w) => w.num >= FROM_WAVE && w.num <= UNTIL_WAVE).flatMap((w) => w.apps));
  for (const [n, podminky] of vypnute) {
    if (vRozsahu.has(n)) info(`${n.padEnd(22)} lane vypnutá (${podminky || "?"} nesplněno) — nenasazuje se`);
  }
  if (!ONLY) {
    for (const n of ocekavane) {
      if (vRozsahu.has(n) && !apps.has(n)) {
        errLog(`${n.padEnd(22)} manifest ji nasazuje, ale v Coolify NENÍ — nezaložila se (krok 3 / story-init)`);
        CHYBI_V_COOLIFY.add(n);
      }
    }
  }

  // ── --only musí umět říct „na tohle nedosáhnu" ───────────────────────────
  //
  // ⛔ NAMĚŘENO 2026-08-20: `--only=model,observability-stack` nasadilo JEDNU
  // appku a skončilo `triggered: 1 · deploy failed: 0 · trigger failed: 0`.
  // Kdo čte souhrn, přečte si „obojí vyřízeno". cílová appka přitom zůstala
  // `exited:unhealthy` a nikdo se to nedozvěděl.
  //
  // Příčina není nová — je POPSANÁ v hlavičce tohohle souboru i v docstringu
  // brány `redeploy-wave-coverage`: `filterWaveApps()` filtruje UVNITŘ
  // `wave.apps`, takže `--only` neumí vybrat appku, kterou nevlastní žádná
  // vlna (incident 2026-06-12: ai-chat, realtime, clamav). Vědělo se to,
  // zapsalo se to na dvě místa — a nástroj přesto mlčel dál.
  //
  // `tier=optional` appky (model, playwright, monitoring) jsou legitimní
  // sirotci: brána je smí propustit, protože je story-init zakládá jen za
  // podmínky. Jenže „smí být mimo vlny" NEZNAMENÁ „smí se tvářit, že se
  // nasadily".
  //
  // Cesta `--canary` tenhle standard drží už teď (`Canary target not found:
  // … Available: …`). Tohle ji jen dorovnává — nevymýšlí nové chování.
  if (ONLY) {
    const dosazitelne = dosazitelneVeVlnach(WAVES, apps);
    const { mimoVlny, neexistuji, vypnuteLane } = rozdelOnlyCile(ONLY.split(","), APP_PREFIX_DASH, apps, dosazitelne, vypnute);
    for (const n of vypnuteLane) {
      info(`${n.padEnd(22)} --only ji jmenuje, ale lane je vypnutá (${vypnute.get(n) || "?"} nesplněno) — nenasazuje se`);
    }
    if (mimoVlny.length || neexistuji.length) {
      if (neexistuji.length) {
        errLog(`--only jmenuje appky, které v Coolify NEEXISTUJÍ: ${neexistuji.join(", ")}`);
      }
      if (mimoVlny.length) {
        errLog(`--only jmenuje appky, které NEVLASTNÍ ŽÁDNÁ VLNA: ${mimoVlny.join(", ")}`);
        errLog(`  V Coolify existují, ale --only na ně nedosáhne — filtruje uvnitř wave.apps.`);
        errLog(`  CO S TÍM: buď je přidej do WAVES (volba (a), vždy bezpečná —`);
        errLog(`  filterWaveApps cílí jen na appky, které v Coolify opravdu jsou),`);
        errLog(`  nebo je nasaď mimo tenhle nástroj. NEDĚLEJ: nespoléhej na to, že`);
        errLog(`  souhrn níž řekne pravdu — bez tohohle kroku by mlčel.`);
      }
      errLog(`  Dosažitelné: ${[...dosazitelne].sort().join(", ")}`);
      process.exit(2);
    }
  }

  // Canary mode — deploy single app, extended verify, exit. No wave logic.
  //
  // PLAN_ONLY must win over CANARY. It did not, until 2026-08-02: `--plan
  // --canary=keycloak` was run as a dry run during a production outage and went
  // straight to "Triggering deploy..." — a real force-redeploy. It stopped only
  // because an unrelated env-sync error happened to fail first. A flag whose
  // whole purpose is "look, don't touch" must never be the one that gets
  // overridden; the look-only modes are checked BEFORE any deploy path.
  if (CANARY) {
    if (PLAN_ONLY) {
      const target = `${APP_PREFIX_DASH}${CANARY}`;
      const a = apps.get(target);
      log(C.bold("Canary plan:"));
      log(`  → ${target.padEnd(22)} ${a ? statusColor(classifyStatus(a.status))(a.status) : C.red("missing")}`);
      log("");
      info("(plan-only — no deploys triggered)");
      return;
    }
    return await runCanary(CANARY, apps);
  }

  // Print plan
  log(C.bold("Wave plan:"));
  for (const wave of WAVES) {
    if (wave.num < FROM_WAVE) {
      log(`  ${C.dim(`wave ${wave.num} (skipped via --from)`)}`);
      continue;
    }
    if (wave.num > UNTIL_WAVE) {
      log(`  ${C.dim(`wave ${wave.num} (skipped via --until)`)}`);
      continue;
    }
    const targets = filterWaveApps(wave, apps);
    if (targets.length === 0) {
      log(`  ${C.dim(`wave ${wave.num}: ${wave.name} (no targets)`)}`);
      continue;
    }
    log(`  ${C.cyan(`wave ${wave.num}`)} ${C.bold(wave.name)}`);
    if (wave.gates?.length) {
      for (const gate of wave.gates) {
        if (gate.url) {
          const name = gate.name || gate.url;
          log(`    ${C.dim("requires")} ${name.padEnd(22)} ${C.yellow("?")} ${C.dim("http-gate")} ${C.dim(gate.url)}`);
          continue;
        }
        const a = apps.get(gate.app);
        const cls = classifyStatus(a?.status);
        const tag = gate.hard ? "hard-gate" : "soft-gate";
        const status = a?.status || "missing";
        const passNow = gatePass(cls, gate.hard, wave.num);
        const passIndicator = passNow ? C.green("✓") : C.red("✗");
        log(`    ${C.dim("requires")} ${gate.app.padEnd(22)} ${passIndicator} ${C.dim(tag)} ${C.dim(status)}`);
      }
    }
    for (const n of targets) {
      const cls = classifyStatus(apps.get(n).status);
      log(`    → ${n.padEnd(22)} ${statusColor(cls)(apps.get(n).status)}`);
    }
  }
  log("");

  if (PLAN_ONLY) {
    info("(plan-only — no deploys triggered)");
    return;
  }

  // Execute waves
  // Profil (souběžnost) a mapa uzlů se čtou PŘED první vlnou: vadný profil
  // nesmí vyjít najevo až uprostřed běhu, po polovině nasazení.
  pripravHlidani();
  const summary = { triggered: [], failed_trigger: [], deploy_failed: [], unhealthy: [], healthy: [], prijate: [], gate_aborted: [] };
  for (const wave of WAVES) {
    if (wave.num < FROM_WAVE) continue;
    if (wave.num > UNTIL_WAVE) continue;
    // STOP mohl přijít i z auto-retry uvnitř čekání předchozí vlny.
    if (hlidani.zastaveni) {
      summary.gate_aborted.push(...filterWaveApps(wave, apps));
      continue;
    }

    // ⛔ STAV SE PŘED KAŽDOU VLNOU NAČÍTÁ ZNOVU (naměřeno 2026-08-18).
    //
    // Dřív se `apps` načetlo JEDNOU před smyčkou a `--skip-healthy` z toho
    // rozhodovalo až do konce běhu. Jenže vlna může shodit aplikaci z vlny
    // pozdější — a přesně to se stalo:
    //
    //     08:10:42  <fork>-keycloak  running:healthy   → PŘESKOČEN jako zdravý
    //     08:11:20  <fork>-core      deploy queued     → `compose down` vzal DB,
    //                                                 na které Keycloak stojí
    //     08:14:24  <fork>-keycloak  exited:unhealthy  → už ho nikdo nevrátil
    //     …         wave 5 ABORTED — gate: <fork>-keycloak (hard)
    //
    // Běh si tím vyrobil bránu, na které se sám zasekl, a odmítl 21 aplikací
    // kvůli závislosti, kterou nepřímo zabil. Rozhodnutí „tahle je zdravá,
    // přeskoč" musí vycházet ze stavu V OKAMŽIKU VLNY, ne z otisku na začátku.
    //
    // Selhání načtení je TVRDÉ: pokračovat se zastaralou mapou znamená znovu
    // rozhodovat podle něčeho, co nemusí platit — a to je právě ta vada.
    try {
      apps = await fetchApps();
    } catch (err) {
      errLog(`Nepodařilo se načíst stav před vlnou ${wave.num}: ${err.message}`);
      errLog("Pokračovat se zastaralým stavem NELZE — rozhodnutí o přeskočení by bylo z otisku, který už neplatí.");
      process.exit(2);
    }

    const targets = filterWaveApps(wave, apps);
    if (targets.length === 0) continue;

    log(C.bold(`\n━━━ Wave ${wave.num}: ${wave.name} ━━━`));
    const waveT0 = Date.now();

    // Gate check — verify required dependencies are up before triggering
    if (wave.gates?.length && !ONLY) {
      const gateResult = await waitForGates(wave);
      if (!gateResult.ok) {
        errLog(`Wave ${wave.num} ABORTED — gate dependencies not ready: ${gateResult.blocking?.join(", ")}`);
        errLog(`Skipping waves ${wave.num}+ to avoid deploying services with broken dependencies.`);
        summary.gate_aborted.push(...targets);
        // Mark remaining waves as aborted too
        for (const laterWave of WAVES) {
          if (laterWave.num > wave.num) {
            const laterTargets = filterWaveApps(laterWave, apps);
            summary.gate_aborted.push(...laterTargets);
          }
        }
        break;  // stop processing further waves
      }
    }
    // Snapshot pre-wave deployment state — slouží jako rollback reference
    // pokud wave selže.
    const { snapshot: waveSnapshot, path: waveSnapshotPath } = await snapshotWave(wave.num, targets, apps);

    // Restart validace měří NÁVRAT ze zdraví — aplikaci, která je rozbitá už
    // před restartem, restart nezmění ve validační vzorek. Nahlas ji vyřadíme
    // (rozbitost už reportoval rollout) a restartujeme jen to, co běží.
    let waveTargets = targets;
    if (RESTART_VALIDATE) {
      const skipped = targets.filter((n) => !isAcceptable(classifyStatus(apps.get(n)?.status)));
      waveTargets = targets.filter((n) => isAcceptable(classifyStatus(apps.get(n)?.status)));
      for (const n of skipped) {
        warn(`${n.padEnd(22)} PŘESKOČENO — nebyla zdravá už před restartem (${apps.get(n)?.status || "missing"}); restart validace ji neměří`);
        summary.unhealthy.push({ name: n, status: `před restartem: ${apps.get(n)?.status || "missing"}` });
      }
      if (waveTargets.length === 0) {
        warn(`Vlna ${wave.num}: žádná běžící aplikace k restartu`);
        continue;
      }
    }

    // Trigger deploys (nebo restarty) — hlídaně: nejvýš `deploy_concurrency`
    // v letu, každé za diskovou bránou (viz spustHlidane).
    const triggerFn = RESTART_VALIDATE ? triggerRestart : triggerDeploy;
    const akce = RESTART_VALIDATE ? "restart" : "deploy";

    // Jedno kolo spouštění. Do souhrnu se ZÁMĚRNĚ nezapisuje — o tom, jestli
    // je to nezdar, se rozhoduje až po vyčerpání čekání na zpětný tlak.
    const spustKolo = (jmena) => spustHlidane(jmena, { apps, triggerFn, wave: wave.num });

    // ⛔ NAMĚŘENO 2026-08-25: Coolify vrátil na KAŽDÝ z 22 spouštěčů
    //     HTTP 429 {"message":"Deployment queue is full. …"}
    // protože souběžný běh nacpal do fronty 27 nasazení (souběžnost 2, drain
    // 15–40 min). Vlny 7, 8 a 9 pak proběhly NAPRÁZDNO a nahlásily to jako
    // „No deploys triggered in this wave" — tedy stejně, jako by neměly co
    // nasazovat. Zpětný tlak není nezdar; je to „počkej". Čeká se JEDNOU za
    // vlnu, ne v každém spouštěči, jinak N smyček vyčerpá rozpočet požadavků
    // (200/okno) a vyrobí ten DRUHÝ druh 429.
    const vysledky = new Map();
    let kZopakovani = [...waveTargets];
    for (let kolo = 1; ; kolo++) {
      for (const v of await spustKolo(kZopakovani)) {
        vysledky.set(v.name, v);
        if (v.ok) ok(`${v.name.padEnd(22)} ${akce} queued ${C.dim(v.deployment)}`);
        else if (v.backpressure) warn(`${v.name.padEnd(22)} fronta nasazení plná — počkám na místo`);
        // Důvod STOPu už vypsal spustHlidane („BĚH ZASTAVEN…") — tady jen stav.
        else if (v.zastaveno) warn(`${v.name.padEnd(22)} nespuštěno — běh zastaven`);
        else errLog(`${v.name.padEnd(22)} trigger failed: ${v.error}`);
      }
      kZopakovani = [...vysledky.values()].filter((v) => !v.ok && v.backpressure).map((v) => v.name);
      if (kZopakovani.length === 0) break;
      if (kolo >= ZPETNY_TLAK_KOL) {
        errLog(`zpětný tlak trvá i po ${ZPETNY_TLAK_KOL} kolech čekání — nečekám dál`);
        break;
      }
      info(`${kZopakovani.length} nasazení čeká na místo ve frontě (kolo ${kolo}/${ZPETNY_TLAK_KOL})`);
      const misto = await waitForDeploymentSlot(coolify, { log: (m) => info(`  ${m}`) });
      if (!misto.uvolneno) {
        errLog(`fronta se neuvolnila: ${misto.duvod} (hloubka ${misto.hloubka}, čekáno ${Math.round(misto.cekanoMs / 60000)} min)`);
        break;
      }
    }

    const triggers = waveTargets.map((n) => vysledky.get(n)).filter(Boolean);
    for (const t of triggers) {
      if (t.ok) summary.triggered.push(t.name);
      // Zastavené nebyly spuštěny vůbec — nejsou to selhané triggery; vykáže
      // je `gate_aborted` níž.
      else if (!t.zastaveno) summary.failed_trigger.push(t.name);
    }
    // ⛔ STOP (disková brána / nasazení nedoběhlo) = konec běhu HNED. Nečeká se
    // na zdraví toho, co už doběhlo: další čekání by jen oddálilo hlášení
    // a nic by nezměnilo na tom, že další nasazení spustit nejde.
    if (hlidani.zastaveni) {
      const z = hlidani.zastaveni;
      const druh = z.druh === "brana" ? "brána před spuštěním" : "nasazení nedoběhlo";
      summary.gate_aborted.push(`wave-${wave.num}: ${druh} u ${z.jmeno}`);
      for (const pozdejsi of WAVES) {
        if (pozdejsi.num > wave.num && pozdejsi.num <= UNTIL_WAVE) summary.gate_aborted.push(...filterWaveApps(pozdejsi, apps));
      }
      break;
    }
    const successfulTriggers = triggers.filter((t) => t.ok);
    const successful = successfulTriggers.map((t) => t.name);
    if (successful.length === 0) {
      // ⛔ „Nic jsem nespustil" NENÍ „nebylo co spouštět". Do 2026-08-25 to byl
      // `warn` + `continue`, takže vlna, které selhaly VŠECHNY spouštěče,
      // vypadala stejně jako vlna bez cílů — a běh šel vesele dál nasazovat
      // na stack, který zůstal na starém artefaktu. Brány dalších vln přitom
      // prošly, protože STARÉ kontejnery pořád běžely zdravé.
      const kritickeCile = waveTargets.filter((n) => !SOFT_DEPLOY_APPS.has(n));
      if (kritickeCile.length > 0) {
        errLog(`Vlna ${wave.num}: NEPODAŘILO SE SPUSTIT ANI JEDNO nasazení z ${waveTargets.length} (kritických: ${kritickeCile.length}). Pokračovat by znamenalo nasazovat další vlny na neaktualizovaný stack.`);
        summary.gate_aborted.push(`wave-${wave.num}: žádné nasazení nespuštěno`);
        break;
      }
      warn(`Vlna ${wave.num}: nespuštěno nic, ale všechny cíle jsou měkké (${waveTargets.join(", ")}) — pokračuji`);
      continue;
    }
    const deployments = new Map(
      successfulTriggers
        .filter((t) => t.deployment)
        .map((t) => [t.name, t.deployment]),
    );

    // Wait for health
    info(`Waiting for ${successful.length} app(s) to become healthy (idle-timeout ${WAVE_TIMEOUT_S}s — resets on any deploy/health progress; hard cap ${STROP_NASAZENI_S}s)...`);
    const wait = await waitForHealthyOrFailedDeploy(successful, {
      wave: wave.num,
      timeoutS: WAVE_TIMEOUT_S,
      deployments,
      // Auto-retry jde týmiž hlídanými dveřmi — i opakované nasazení zabírá disk.
      retryTrigger: async (_uuid, name, poziceVlny) => (await spustHlidane([name], { apps, triggerFn, wave: poziceVlny }))[0],
    });
    if (wait.ok) {
      // Use resolvedClasses (post-grace reclassification) when available,
      // so apps accepted as "stable starting" via FINISHED_GRACE_S aren't
      // double-counted as unhealthy here. The wave-loop's accept criteria
      // and the summary's accept criteria must agree — otherwise we get
      // "Wave complete" + "exit 1 from unhealthy app" on the same app.
      let allFully = true;
      for (const [n, s] of Object.entries(wait.statuses)) {
        const resolvedCls = wait.resolvedClasses?.[n];
        const cls = resolvedCls || classifyStatus(s);
        if (isFullyHealthy(cls)) {
          summary.healthy.push(n);
        } else if (isAcceptable(cls)) {
          // Stable starting/unhealthy were accepted by the wave loop; the
          // app may still be transitioning. Don't fail the cold-start over
          // a known-acceptable transient state — log it as a soft warning.
          //
          // ⛔ VLASTNÍ KOŠÍK (naměřeno 2026-09-05). Do teď to padalo do
          // `summary.healthy`, který se tiskne pod jménem „healthy after".
          // Běh `--only=realtime` proto vypsal „healthy after: 1“ o aplikaci,
          // která skončila `running:unhealthy` — a `live.` vracelo 502.
          // Měřidlo tedy tvrdilo pravý opak toho, co dokládal jeho vlastní
          // řádek stavu o dva řádky výš.
          //
          // Rozhodnutí o BĚHU se nemění (přijaté stavy dál nejsou tvrdý
          // problém, viz `tvrdyProblem` — bootstrap okno je zapsané níž);
          // mění se jen to, že se nevydávají za zdravé.
          summary.prijate.push({ name: n, status: s, cls });
        } else {
          summary.unhealthy.push({ name: n, status: s });
          allFully = false;
        }
      }
      if (allFully) ok(`Wave ${wave.num} complete (all healthy)`);
      else ok(`Wave ${wave.num} complete (running; some accepted as stable non-healthy)`);
    } else {
      for (const failure of wait.deploymentFailures || []) {
        summary.deploy_failed.push(failure);
        errLog(`${failure.name} deployment ${failure.status}: ${failure.deploymentId}`);
      }
      // Wave timed out. For apps that are the gate dependency of the NEXT wave,
      // warn explicitly — the next wave's gate check will block and report clearly.
      const nextWave = WAVES.find((w) => w.num === wave.num + 1);
      const nextGateApps = new Set(nextWave?.gates?.map((g) => g.app) || []);
      for (const [n, s] of Object.entries(wait.statuses)) {
        const resolvedCls = wait.resolvedClasses?.[n];
        const cls = resolvedCls || classifyStatus(s);
        if (isFullyHealthy(cls)) summary.healthy.push(n);
        else {
          summary.unhealthy.push({ name: n, status: s });
          if (nextGateApps.has(n)) {
            warn(`${n} is a gate dependency for wave ${wave.num + 1} — gate will block until it recovers`);
          }
        }
      }
      if (wait.deploymentFailures?.length) {
        const failedNames = (wait.deploymentFailures || []).map((f) => f.name);
        // Print rollback recipe — pre-wave snapshot ukáže, kterou deployment
        // má user re-deploynout pro ruční rollback. S --auto-rollback se Coolify
        // API zavolá přímo (POST /deployments/{uuid}/restart).
        await printRollbackRecipe(waveSnapshot, waveSnapshotPath, failedNames, { autoRollback: AUTO_ROLLBACK });
        // Cascade-halt ONLY on critical apps. Optional/self-contained apps
        // (SOFT_DEPLOY_APPS — e.g. aisha-ledger) failing must not skip later
        // waves: their failure is isolated, and breaking here silently drops
        // everything downstream (notably aisha-messaging in wave 7).
        const criticalFailures = failedNames.filter((n) => !SOFT_DEPLOY_APPS.has(n));
        if (criticalFailures.length === 0) {
          warn(
            `Wave ${wave.num}: optional app(s) failed to deploy (${failedNames.join(", ")}) — ` +
              `continuing to later waves (SOFT, isolated). Re-run with --only=<app> to retry.`,
          );
          // fall through → log duration, proceed to next wave
        } else {
          warn(
            `Wave ${wave.num} stopped because a critical deployment failed ` +
              `(${criticalFailures.join(", ")}) — later waves are skipped.`,
          );
          for (const laterWave of WAVES) {
            if (laterWave.num > wave.num) {
              const laterTargets = filterWaveApps(laterWave, apps);
              summary.gate_aborted.push(...laterTargets);
            }
          }
          break;
        }
      }
      warn(`Wave ${wave.num} timed out — gate check will enforce deps before wave ${wave.num + 1}`);
    }

    // Per-wave duration tracking — log only (Prometheus integration disabled,
    // viz `// import { metrics }` výše pro re-enable instrukce).
    const waveDuration = (Date.now() - waveT0) / 1000;
    info(`Wave ${wave.num} duration: ${waveDuration.toFixed(1)}s`);
  }
  // Reporting is best-effort. The wave verdict above is authoritative; a
  // transient Coolify read must not turn an already completed deployment into
  // a fatal cold-start failure (observed after Wave 5 on 2026-08-14).
  try {
    const finalApps = await fetchApps();
    printStatusTable(finalApps);
  } catch (error) {
    warn(`Final status table unavailable after completed waves: ${error.message}`);
  }

  // ── POST-KONTROLA: nese každá nasazená appka to, co je v SoT TEĎ? ──────────
  //
  // ⛔ Zelená není totéž co splněný záměr. Když se SoT během běhu změní (mesh
  // discovery uspěje až v pozdější vlně), appky nasazené PŘED tou změnou nesou
  // starou hodnotu — a souhrn o tom neví, protože měří zdraví, ne obsah.
  //
  // ⭐ ŘEŠÍ SE AUTONOMNĚ, ne hlášením do prázdna: dotčené appky se přenasadí
  // JEDNÍM dodatečným průchodem. Bez toho by musel člověk sledovat, ve které
  // vlně discovery uspělo, a doklikat zbytek ručně — což je přesně ta práce,
  // kterou nástroj má dělat za něj.
  //
  // ⛔ PRÁVĚ JEDEN PRŮCHOD. Kdyby se opakovalo do shody, běh by se mohl točit,
  // dokud se SoT hýbe; druhý nesoulad je proto NÁLEZ, ne další pokus.
  const otiskNaKonci = await zmerOtisk();
  if (otiskNaKonci === null) {
    log(`  ${C.yellow("∅")} shoda odvozených klíčů: NEPROHLÉDNUTO (otisk se nepodařilo změřit)`);
  } else if (otiskPriSyncu.size > 0) {
    const zastarale = [...otiskPriSyncu.entries()]
      .filter(([, otisk]) => otisk !== otiskNaKonci.otisk)
      .map(([app]) => app);
    if (zastarale.length === 0) {
      log(`  ${C.green("✓")} odvozené klíče: všech ${otiskPriSyncu.size} appek odjelo s aktuálním SoT (${otiskNaKonci.pocet} klíčů)`);
    } else {
      warn(
        `SoT se během běhu ZMĚNIL — ${zastarale.length} appka(y) odjela se zastaralými odvozenými klíči: ` +
          `${zastarale.join(", ")}. Přenasazuji je JEDNÍM dodatečným průchodem.`,
      );
      const cile = [];
      for (const app of zastarale) {
        // ⛔ `fetchApps()` vrací MAPU jméno→appka, ne pole. Klíč je PLNÉ jméno
        // (`<prefix>-core`), kdežto tady evidujeme `short` (`core`) — týž tvar,
        // jaký `triggerDeploy` předává env-syncu. Skládá se zpátky prefixem,
        // ne hádáním přes `endsWith`: to by u `core` sedlo i na `story-core`.
        const cil = apps.get(`${APP_PREFIX_DASH}${app}`) ?? apps.get(app);
        if (!cil) { warn(`  ${app}: aplikaci se nepodařilo dohledat — NEPŘENASAZENO`); continue; }
        cile.push({ app, jmeno: cil.name });
      }
      // Hlídaně: dřív tu smyčka odeslala triggery za sebou bez čekání — tedy
      // souběh, jen rozložený do pár vteřin.
      const vysledkyPrenasazeni = await spustHlidane(cile.map((c) => c.jmeno), { apps, wave: WAVE_ADHOC });
      for (const [i, r] of vysledkyPrenasazeni.entries()) {
        const { app } = cile[i];
        if (r.ok) ok(`  ${app}: přenasazeno s aktuálním SoT`);
        else warn(`  ${app}: přenasazení selhalo (${r.error}) — hodnota zůstává zastaralá`);
      }
      const potvrzeni = await zmerOtisk();
      const porad = [...otiskPriSyncu.entries()].filter(([, o]) => potvrzeni && o !== potvrzeni.otisk).map(([a]) => a);
      if (potvrzeni && porad.length > 0) {
        warn(`SoT se hýbe i po dodatečném průchodu (${porad.join(", ")}) — to už NENÍ přechodný stav, podívej se proč.`);
      }
    }
  }

  log(C.bold("Summary"));
  log(`  ${C.green("✓")} triggered:        ${summary.triggered.length}`);
  log(`  ${C.green("✓")} healthy after:    ${summary.healthy.length}`);
  if (summary.prijate.length > 0) {
    log(`  ${C.yellow("~")} přijaté, NE zdravé: ${summary.prijate.length} (${summary.prijate.map((u) => `${u.name}=${u.status}`).join(", ")})`);
  }
  log(`  ${C.yellow("⚠")} still unhealthy:  ${summary.unhealthy.length}`);
  log(`  ${C.red("✗")} deploy failed:    ${summary.deploy_failed.length}`);
  log(`  ${C.red("✗")} trigger failed:   ${summary.failed_trigger.length}`);
  if (summary.gate_aborted.length > 0) {
    log(`  ${C.red("✗")} gate aborted:     ${summary.gate_aborted.length} (${summary.gate_aborted.join(", ")})`);
  }
  if (hlidani.zastaveni) {
    log(`  ${C.red("✗")} ZASTAVENO:        ${hlidani.zastaveni.jmeno} — ${hlidani.zastaveni.duvod}`);
  }
  // NEZMĚŘENO není čisto: nasazení proběhlo bez pojistky, kterou má mít.
  const nezmereneUzly = [...new Set(hlidani.nezmereno.map((z) => z.uzel))];
  if (nezmereneUzly.length > 0) {
    log(`  ${C.yellow("∅")} disk NEZMĚŘEN:    ${hlidani.nezmereno.length} nasazení na uzlech ${nezmereneUzly.join(", ")} (deklaruj AISHA_NODE_SSH)`);
  }
  if (summary.unhealthy.length > 0) {
    log("");
    log(C.bold("Unhealthy apps (post-deploy):"));
    for (const { name, status } of summary.unhealthy) {
      log(`  ${C.yellow("⚠")} ${name.padEnd(22)} ${status}`);
    }
  }
  log("");

  // ── Observability ────────────────────────────────────────────────────────
  // Primary observability je Langfuse (LLM ops) + ClickHouse (events). Pokud
  // chceš Prometheus textfile output, odkomentuj import výše a tento blok:
  //   import { metrics } from "./lib/metrics.mjs";
  //   metrics.gauge("aisha_redeploy_triggered_total", summary.triggered.length);
  //   ... (viz git history před touto změnou pro vzor)
  //   const metricsPath = metrics.flush();

  // ⛔ NAMĚŘENO PŘI WIPU 2026-08-24. Tady se vracela JEDNIČKA za cokoli — i když
  // jediná nezdravá appka byla MĚKKÁ (`SOFT_DEPLOY_APPS`). Vlny kvůli ní
  // správně nepřeskočily, ale cold-start bere jakoukoli nenulovou hodnotu jako
  // „bootstrap aborted", takže se `<fork>-clamav` (tier=optional, isolovaný)
  // zastavil celý běh na konci fáze A: mesh ani edge se nenasadily a všechny
  // veřejné povrchy zůstaly na 503.
  //
  // Měkké selhání tedy fungovalo jako tvrdé. Rozlišení musí být v NÁVRATOVÉM
  // KÓDU, ne v textu souhrnu — volající čte kód:
  //   0 = čisto     3 = jen měkké appky      1 = tvrdý problém
  //
  // ⛔ BOOTSTRAP OKNO (naměřeno při wipu 2026-08-24, druhý pád). Běh `--until=4`
  // skončil jedničkou kvůli `<fork>-core: running:unhealthy` — a core měkký není.
  // Jenže z třinácti kontejnerů core byl nezdravý JEDINÝ: `netbird-agent`.
  // Jeho sonda testuje ČLENSTVÍ V MESHI, a mesh vzniká až ve vlně 5. V okně
  // před ní ta otázka NEMŮŽE platit — přesně to už tenhle soubor popisuje
  // u bran vlny 5 („podmínka, která v té fázi nemůže platit"), jen se to
  // neuplatnilo na návratový kód.
  //
  // Kruh, který to působilo: fáze A vrátí 1 → cold-start přeruší bootstrap →
  // vlna 5 (mesh genesis) se nikdy nespustí → agent se nemá kam zapsat →
  // fáze A vrátí 1. Dvakrát za sebou, platforma celou dobu na 503.
  //
  // `running:unhealthy` = kontejnery BĚŽÍ, jen app-level sonda neprošla. To je
  // v tomhle okně přijatelné (viz `isAcceptable`). `exited:*` a `restarting:*`
  // přijatelné NEJSOU nikdy — ty sem nespadají.
  const predMeshGenezi = UNTIL_WAVE < MESH_WARMUP_WAVE;
  const ocekavaneVOkne = ({ name, status }) =>
    predMeshGenezi && String(status || "").startsWith("running:");
  // ⛔ NAMĚŘENO 2026-09-13 (audit nad guru). Selhané NASAZENÍ měkké aplikace
  // vracelo 1, ačkoli nezdravá měkká aplikace vracela 3 — takže `model` bez vah
  // (měkký, izolovaný) ukončil cold-start ve fázi E a s ním krok 6 (n8n).
  // Měkkost je vlastnost APLIKACE, ne druhu selhání. A přijaté stavy (stabilní
  // `running:unhealthy`/`starting`) mimo bootstrap okno nejsou „čisto": vracely
  // nulu, takže se o nich volající nedozvěděl. Teď 3 — pokračovat smí, ale ví to.
  const mekka = (n) => SOFT_DEPLOY_APPS.has(n);
  const tvrdyProblem =
    summary.deploy_failed.some((f) => !mekka(f.name)) ||
    summary.failed_trigger.some((n) => !mekka(n)) ||
    summary.gate_aborted.length > 0 ||
    hlidani.zastaveni !== null ||
    [...CHYBI_V_COOLIFY].some((n) => !mekka(n)) ||
    summary.unhealthy.some((u) => !mekka(u.name) && !ocekavaneVOkne(u));
  if (tvrdyProblem) process.exit(1);
  const mekkeNalezy = [
    ...summary.deploy_failed.map((f) => `${f.name}=deploy ${f.status}`),
    ...summary.failed_trigger.map((n) => `${n}=nespuštěno`),
    ...[...CHYBI_V_COOLIFY].map((n) => `${n}=v Coolify chybí`),
    ...summary.unhealthy.map((u) => `${u.name}=${u.status}`),
    ...summary.prijate.filter((u) => !ocekavaneVOkne(u)).map((u) => `přijaté ${u.name}=${u.status}`),
    ...nezmereneUzly.map((u) => `disk NEZMĚŘEN na ${u}`),
  ];
  if (mekkeNalezy.length > 0) {
    log(C.yellow(`  ⚠ nedokončeno jen u měkkých aplikací nebo v bootstrap okně před vlnou ${MESH_WARMUP_WAVE} (${mekkeNalezy.join(", ")}) — vracím 3, volající smí pokračovat, ale NENÍ to čisto`));
    process.exit(3);
  }
  process.exit(0);
}

main().catch((e) => {
  errLog(`Fatal: ${e.message}`);
  if (process.env.DEBUG) console.error(e);
  process.exit(2);
});
