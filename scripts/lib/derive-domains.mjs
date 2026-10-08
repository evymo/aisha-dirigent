#!/usr/bin/env node
/**
 * derive-domains.mjs — central domain resolver.
 *
 * Reads:
 *   config/services.json         (service catalog)
 *   config/profiles/<id>.json    (deployment profile)
 *   AISHA_PROFILE env (default: cloud-single — samostatný stack; viz buildTopology)
 *   MESH_ENABLED env  (default: TRUE — mesh je podmínka provozu, ne volba)
 *
 * Emits:
 *   - JS module: import { domains } from "scripts/lib/derive-domains.mjs"
 *   - CLI:       node scripts/lib/derive-domains.mjs [--shell|--json|--check]
 *     --shell   bash-sourceable export lines (cold-start consumes this)
 *     --json    structured JSON for tooling
 *     --check   sanity-check the resolved topology (exit 1 on inconsistency)
 *     --profile=<id>   override AISHA_PROFILE
 *     --mesh=on|off    override MESH_ENABLED
 *
 * Goal: every compose file, deploy script, and gate test should derive
 * service URLs from THIS module — no hardcoded `.<server>.<internal_tld>` literals
 * anywhere except the profile JSON.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { overlayDirOrRequired } from "./instance-overlay.mjs";
import { isDirectRun } from "./cli-entry.mjs";
import { podminkaSplnena } from "./provision-gate.mjs";
import { isMeshHost } from "./mesh-host.mjs";
import { composeProUmisteni, slotModelovehoMeshe, SLUZBA_MODELU } from "./umisteni-sluzeb.mjs";
import { PROFIL_DVERI, knockUpstream } from "./dvere-deklarace.mjs";
import { gatewayRestPrefix, nesouladyPovrchu } from "./povrch-shoda-s-derivaci.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");

/**
 * Every environment variable this resolver reads.
 *
 * SINGLE SOURCE OF TRUTH — exported because gates must invoke the resolver with
 * these STRIPPED, or an ambient deployment value steers the run and the gate
 * reports the environment instead of the code. Two gates used to keep their own
 * hand-copied lists; both had drifted to 8 of the 14 entries, so six variables
 * (AISHA_SUBDOMAIN_PREFIX among them) could silently contaminate a verdict.
 *
 * src/tests/gates/resolver-env-inputs-complete.gate.test.ts pins this list
 * against the actual `process.env.X` reads in this file, so a new input cannot
 * be added without the gates learning about it. It follows the overlay door
 * too: the two overlay variables below are read by instance-overlay.mjs on this
 * resolver's behalf, not by the lines here.
 *
 * AISHA_OVERLAY_REQUIRED steers the result even though this file never names it.
 * Stripping AISHA_INSTANCE_CONFIG_DIR while leaving it set turns the overlay
 * lookup from "fall back to the template" into a throw, so a gate would report
 * the environment it ran in rather than the topology it claims to test. The
 * same holds for AISHA_INSTANCE_DATA_GIT_URL: an instance that DECLARES an
 * overlay requires one (instance-overlay.mjs).
 */
/**
 * Proměnné, které resolver čte NEPŘÍMO — přes `substitute()` z katalogu.
 *
 * ⛔ NAMĚŘENO 2026-08-21. `AISHA_WEB_PUBLIC_ALIASES` (katalog: `web.
 * public_aliases_env`) v seznamu nebyl, protože v tomhle souboru nikde
 * nestojí `process.env.AISHA_WEB_PUBLIC_ALIASES` — vstupuje hodnotou
 * z katalogu. Důsledek: `aisha-env-doctor` spuštěný v holém shellu vydal
 * `WEB_ALIAS_ORIGINS` BEZ aliasu `corp` a tou zkrácenou hodnotou přepsal SoT.
 * Ztráta veřejného jména vypadá jako „drift opraven", ne jako vada.
 *
 * Čte se z katalogu, nevypisuje: ruční seznam by zdědil díry svého autora —
 * táž třída, kterou `provisionFlagKeys()` v env-doktoru řeší stejným způsobem.
 */
function katalogoveEnvVstupy() {
  try {
    const { services } = readJSON(resolve(ROOT, "config/services.json"));
    const klice = new Set();
    const projdi = (uzel) => {
      if (Array.isArray(uzel)) return uzel.forEach(projdi);
      if (!uzel || typeof uzel !== "object") return;
      for (const [k, v] of Object.entries(uzel)) {
        // Pole, jehož HODNOTA je jméno proměnné (`public_aliases_env`).
        if (k.endsWith("_env") && typeof v === "string" && /^[A-Z][A-Z0-9_]*$/.test(v)) klice.add(v);
        // Odkaz `${VAR}` uvnitř kterékoli hodnoty — ten `substitute()` rozvine.
        if (typeof v === "string") {
          for (const m of v.matchAll(/\$\{([A-Z][A-Z0-9_]*)(?::-[^}]*)?\}/g)) klice.add(m[1]);
        } else projdi(v);
      }
    };
    projdi(services ?? {});
    return [...klice].sort();
  } catch (e) {
    // Hlasitě: prázdný seznam vypadá jako „katalog žádné vstupy nemá",
    // a brány by pak běžely s ambientní hodnotou, aniž by to kdo poznal.
    process.stderr.write(`[derive-domains] WARN: katalogové env vstupy nelze přečíst: ${e.message}\n`);
    return [];
  }
}

export const RESOLVER_ENV_INPUTS = [
  "AISHA_INSTANCE",
  "AISHA_INSTANCE_CONFIG_DIR",
  // Čtou ho dveře k overlayi: deklarovaný overlay je povinný (instance-overlay.mjs).
  // Tady musí být i proto, aby ho env-doktor vyzvedl z CÍLOVÉHO souboru — jinak
  // by instance, která URL drží jen v .env.coolify, dál tiše dostala šablonu.
  "AISHA_INSTANCE_DATA_GIT_URL",
  "AISHA_OVERLAY_REQUIRED",
  "AISHA_PROFILE",
  "AISHA_SERVICE_ALIAS_PREFIX",
  // AISHA_SUBDOMAIN_PREFIX tu BÝVAL a je pryč schválně: byl to druhý název pro
  // identitu, kterou instance už nese jako APP_NAME_PREFIX (níž v tomhle
  // seznamu). Dvě jména pro touž věc znamenají, že se rozejdou — a tahle se
  // rozešla tak, že jedno bylo naplněné a druhé ne, takže hostnames identitu
  // ignorovaly. Viz odvození u `profile.domain.subdomain_prefix`.
  "AISHA_WEB_APEX_MODE",
  "APP_NAME_PREFIX",
  // Veřejné tváře aplikací mimo katalog (deriveExternalFaces) — deklarace
  // instance, proto ji env-doktor musí vyzvednout z cílového souboru.
  "EXTERNAL_FACES",
  "INTERNAL_TLD",
  // Realm instance — derivace ho NEVYDÁVÁ, jen jím ověřuje issuer v overlayi
  // povrchu (viz lib/povrch-shoda-s-derivaci.mjs). Chybí-li, realm se nezměří
  // a derivace to řekne nahlas.
  "KEYCLOAK_REALM",
  "LOCAL_INGEST_DROP_HOST_DIR",
  "MESH_ENABLED",
  "MESH_TLD",
  "OAUTH2_COOKIE_DOMAINS",
  "OAUTH2_WHITELIST_DOMAINS",
  "PUBLIC_TLD",
  // Nepřímé vstupy z katalogu (`*_env` a `${VAR}`) — viz katalogoveEnvVstupy().
  ...katalogoveEnvVstupy(),
];

// ── Helpers ──────────────────────────────────────────────────────────────────
function readJSON(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

/**
 * Substitute env-style placeholders `${VAR:-default}` with real env values.
 * Only used in profile JSON values like "${SINGLE_HOST_SERVER:-backend}".
 */
function substitute(value) {
  if (typeof value !== "string") return value;
  return value.replace(/\$\{([A-Z_][A-Z0-9_]*):-([^}]*)\}/g, (_, name, def) =>
    process.env[name] ?? def,
  ).replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_, name) =>
    process.env[name] ?? "",
  );
}

function deepSubstitute(obj) {
  if (Array.isArray(obj)) return obj.map(deepSubstitute);
  if (obj && typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = deepSubstitute(v);
    return out;
  }
  return substitute(obj);
}

function parseCsvList(value) {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isSafePublicAlias(alias) {
  if (typeof alias !== "string") return false;
  if (alias.length < 1 || alias.length > 63) return false;
  if (!/^[a-z0-9-]+$/.test(alias)) return false;
  return alias[0] !== "-" && alias[alias.length - 1] !== "-";
}

function uniqueSafePublicAliases(values, context) {
  const out = [];
  const seen = new Set();
  for (const raw of values) {
    const alias = String(raw ?? "").trim().toLowerCase();
    if (!alias) continue;
    if (!isSafePublicAlias(alias)) {
      throw new Error(
        `[derive-domains] Invalid public alias '${raw}' for ${context}. ` +
        `Use comma-separated DNS labels only (example: web,corp,portal).`,
      );
    }
    if (!seen.has(alias)) {
      seen.add(alias);
      out.push(alias);
    }
  }
  return out;
}

function resolvePublicAliases(svc, override, primarySubdomain, serviceId) {
  const staticAliases = svc.public_aliases ?? (svc.public_alias ? [svc.public_alias] : []);
  const overrideAliases = Object.prototype.hasOwnProperty.call(override, "public_aliases")
    ? (override.public_aliases ?? [])
    : staticAliases;
  const envAliases = svc.public_aliases_env
    ? parseCsvList(process.env[svc.public_aliases_env])
    : [];
  const includePrimary = Boolean(svc.public_aliases_include_primary) && primarySubdomain;
  const aliases = uniqueSafePublicAliases(
    [
      ...(includePrimary ? [primarySubdomain] : []),
      ...overrideAliases,
      ...envAliases,
    ],
    `service '${serviceId}'`,
  );
  return aliases.length ? aliases : null;
}

// ── Load configuration ──────────────────────────────────────────────────────
// A profile that names a real deployment — its domains, its servers, its
// organization — is INSTANCE DATA, and this repository is public. So the
// instance's own profile lives in its private overlay and is picked up here,
// exactly like the operator roster already is (aisha-cold-start.sh clones the
// overlay host-side and prefers its operators.json over the repo's).
//
// config/profiles/ therefore ships TEMPLATES only (cloud-multi, cloud-single,
// local-dev): the SHAPES a deployment can take, with no tenant in them.
//
// Overlay wins when present. It has to: a fork that vendors a template and then
// customises it in its overlay must get the customised one, and silently
// preferring the shipped template would hand it someone else's topology.
// Čte se PŘI VOLÁNÍ, ne při importu.
//
// Jako `const` na úrovni modulu se hodnota zachytí ve chvíli `import`u — a v ES
// modulech se importy vyhodnocují PŘED tělem importujícího souboru. Konzument,
// který si proměnnou do process.env teprve doplňuje (aisha-env-doctor.mjs
// hydratuje z .env-prod-backup až na svém řádku 165), tedy nikdy nedosáhl na
// tenhle řádek včas: cesta zůstala prázdná, `Profile '<id>' not found` a
// derivace spadla na šablonu. Operátorská deklarace přišla pozdě bez ohledu na
// to, kde ji napsal.
//
// Měřeno 2026-07-28: AISHA_INSTANCE_CONFIG_DIR i AISHA_PROFILE byly správně
// deklarované v .env-prod-backup, a přesto se instanční profil nenačetl.
// Jedny dveře k overlayi. Derivace domén bez něj SMÍ pokračovat na šabloně —
// komunitní install to tak chce — proto volitelný režim; přísnost si vynutí
// prostředí (AISHA_OVERLAY_REQUIRED=1). Líné čtení uvnitř funkce zůstává:
// právě to je poučení z 2026-07-28 popsané výš.
function instanceConfigDir() {
  return overlayDirOrRequired("derive-domains") ?? "";
}

function profileCandidates(profileId) {
  const paths = [];
  const dir = instanceConfigDir();
  if (dir) {
    paths.push(resolve(dir, `profiles/${profileId}.json`));
  }
  paths.push(resolve(ROOT, `config/profiles/${profileId}.json`));
  return paths;
}

/**
 * Profil instance — overlay má přednost, šablona v config/profiles/ je fallback.
 * Exportovaný, aby ostatní čtenáři profilu (aisha-redeploy: `deploy_concurrency`)
 * šli TÝMIŽ dveřmi, ne vlastní kopií hledání.
 */
export function loadProfile(profileId) {
  return deepSubstitute(loadProfileRaw(profileId));
}

/**
 * Týž profil TÝMIŽ dveřmi, ale BEZ dosazení `${VAR}`. Pro čtenáře, kterým na rozdílu
 * „proměnná nenastavená“ × „nastavená prázdná“ záleží: `substitute()` z obou dělá "",
 * takže z dosazeného profilu se nedá poznat, jestli prostředí odpověď DEKLAROVALO
 * (domov vlastnictví: nenastavená proměnná v `external_domain` = „nevím“, ne „vlastní“).
 */
export function loadProfileRaw(profileId) {
  const candidates = profileCandidates(profileId);
  const path = candidates.find((p) => existsSync(p));
  if (!path) {
    // Name every location tried. "Profile not found" without the search path is
    // unactionable once a profile can legitimately live outside the repo.
    throw new Error(
      `Profile '${profileId}' not found. Looked in:\n  ${candidates.join("\n  ")}\n` +
        `Templates shipped here: cloud-multi, cloud-single, local-dev. An instance profile ` +
        `belongs in the private overlay (AISHA_INSTANCE_CONFIG_DIR / AISHA_INSTANCE_DATA_GIT_URL), ` +
        `not in this public repository.`,
    );
  }
  return readJSON(path);
}

/**
 * Čtečka lane pro `podminkaSplnena`: lane modelového meshe (`MODEL_MESH`) je
 * ODVOZENÁ z umístění modelu, ostatní lane deklaruje prostředí. Jedna čtečka pro
 * celou derivaci — kdyby některé místo četlo `MODEL_MESH` z prostředí, rozešlo
 * by se s topologií hned, jak operátor model přesune.
 */
function ctiLaneTopologie(modelovyMesh) {
  return (k) => (k === "MODEL_MESH" ? modelovyMesh : process.env[k]);
}

function loadCatalog() {
  return readJSON(resolve(ROOT, "config/services.json"));
}

/** Compose soubor edge stacku — univerzum legálních `edge_profiles`. */
export const EDGE_COMPOSE_FILE = "docker-compose.coolify-prebuilt.yml";

/**
 * Jména compose profilů, která edge stack SKUTEČNĚ zná.
 *
 * Čte se ze souboru, ne z ručního výčtu: výčet by zdědil díry svého autora a
 * rozešel by se při prvním novém profilu. Tohle je jediná otázka, na kterou umí
 * odpovědět jen compose — `profiles: ["knock"]` je jeho vlastní deklarace.
 *
 * @returns {Set<string>}
 */
export function edgeComposeProfiles(root = ROOT) {
  const file = resolve(root, EDGE_COMPOSE_FILE);
  if (!existsSync(file)) return new Set();
  const names = new Set();
  for (const m of readFileSync(file, "utf8").matchAll(/^\s*profiles:\s*\[([^\]]*)\]/gm)) {
    for (const raw of m[1].split(",")) {
      const name = raw.trim().replace(/^["']|["']$/g, "");
      if (name) names.add(name);
    }
  }
  return names;
}

/**
 * Prefix síťových aliasů sdílené infrastruktury.
 *
 * PROČ: v compose stálo natvrdo `aisha-db`, `aisha-postgrest`, `aisha-gateway`.
 * To je jméno JINÉ instance zapečené do kódu stacku — generické patří nahoru,
 * instanční je DATA. Nosné jsou přitom právě aliasy: `container_name` Coolify
 * stejně přepisuje na `<služba>-<uuid>-<n>`, kdežto alias rozhoduje, na co se
 * dá napojit napříč stacky.
 *
 * Hodnota má jeden domov (katalog) a instance ji přebíjí proměnnou — týž postup
 * jako u AISHA_SUBDOMAIN_PREFIX. Bez fallbacku v kódu: chybí-li obojí, je to
 * chyba konfigurace a musí být vidět, ne zalátaná odhadem.
 */
function serviceAliasPrefix() {
  const fromEnv = (process.env.AISHA_SERVICE_ALIAS_PREFIX || "").trim();
  if (fromEnv) return fromEnv;
  const fromCatalog = (loadCatalog().service_alias_prefix || "").trim();
  if (fromCatalog) return fromCatalog;
  throw new Error(
    "SERVICE_ALIAS_PREFIX nelze odvodit: chybí `service_alias_prefix` v config/services.json " +
      "i proměnná AISHA_SERVICE_ALIAS_PREFIX. Compose ho vyžaduje pro aliasy sdílené infrastruktury.",
  );
}

/**
 * Prefix ZÁKAZNÍKA — jediné jméno, které je na sdílené síti jednoznačné.
 *
 * ⚠️ NEZAMĚŇOVAT se `serviceAliasPrefix()`. Ten nese jméno IMPLEMENTACE stacku a
 * je `aisha` pro každou instanci, takže alias `aisha-keycloak` na síti `coolify` nepatří
 * jedné instanci: změřeno 2026-08-04 tam stálo 149 aplikací, 8 zákaznických
 * prefixů a PĚT Keycloaků — a všechny se hlásí týmž jménem. Adresa postavená ze
 * `serviceAliasPrefix()` proto nemíří na konkrétní instanci, ale na kteroukoli
 * z nich, kterou docker zrovna vybere.
 *
 * Bez fallbacku, i když by se nabízel: dosazený prefix by adresu tiše otočil na
 * CIZÍ produkci, a to je právě ta vada, kvůli které tahle funkce vznikla.
 * Chybí-li identita, není co odvodit — a musí to být vidět.
 */
function appNamePrefixOrWarn(topo, kvuliCemu) {
  const prefix = (topo?.app_name_prefix || "").trim();
  if (prefix) return prefix;
  // Bez identity se alias složit NEDÁ a dosadit ji nesmíme — odhadnutý prefix
  // by adresu otočil na CIZÍ instanci. Zbývá druhá legitimní adresa (přímý
  // host); ta identitu nepotřebuje. Není to tichá degradace: volající to
  // ohlásí, protože přímý host je ta cesta, která se z kontejneru měřeně
  // nemusí rozřešit (cert mismatch → 503, 2026-07-20).
  process.stderr.write(
    `[derive-domains] WARN: ${kvuliCemu} se skládá z přímého hostu, ne z aliasu — ` +
      `topologie nenese app_name_prefix (identitu ZÁKAZNÍKA). Deklaruj ji v profilu ` +
      `nebo nastav APP_NAME_PREFIX; SERVICE_ALIAS_PREFIX to nezastoupí, ten je pro ` +
      `všechny instance stejný.\n`,
  );
  return null;
}

/**
 * `container_name` compose služeb v jednom souboru — mapa `klíč služby → jméno`.
 *
 * ── PROČ SE TO ČTE, A NEOPISUJE ───────────────────────────────────────────────
 * Jméno kontejneru má JEDEN domov: `container_name` v compose. Katalog dřív
 * držel jeho OPIS (`internal_url.container: "aisha-openclaw"`) a ty dva zdroje
 * se rozešly — naměřeno 2026-08-13 na všech 38 výskytech:
 *
 *   6× opis == skutečnost, ale jen protože prefix TÉHLE instance je „aisha";
 *      na kterékoli jiné je to adresa cizí instance, nebo mrtvá,
 *  31× opis byl HOLÉ jméno (`minio`, `svc-model`), tedy nárok na sdílené síti,
 *      o který se přetahují všichni nájemníci — táž třída, kvůli které se
 *      OpenXPKI půl spojení trefovala do CIZÍ databáze (`pki-db`, 2026-08-10),
 *   1× opis neodpovídal ničemu (`backend--integration--ragnarok`, kontejner je
 *      `<prefix>-integration--ragnarok`) — prostě zastaralý řetězec.
 *
 * Katalog proto na jméno UKAZUJE (`service:` = klíč compose služby) a složí ho
 * až tahle funkce. Nový compose = nové jméno bez zásahu do katalogu.
 *
 * Čte se po řádcích, ne YAML parserem: `yaml` není runtime závislost a tenhle
 * modul cold-start sourcuje na čerstvém stroji. Týž postup jako
 * `edgeComposeProfiles()` — jeden způsob čtení compose, ne dva.
 */
const composeContainerCache = new Map();
function composeContainerNames(composeFile, root = ROOT) {
  const klic = `${root}\u0000${composeFile}`;
  if (composeContainerCache.has(klic)) return composeContainerCache.get(klic);
  const file = resolve(root, composeFile);
  const map = new Map();
  if (existsSync(file)) {
    let vSluzbach = false;
    let aktualni = null;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (/^\S/.test(line)) {
        // Blok nejvyšší úrovně: `services:` otevírá, cokoli jiného zavírá.
        vSluzbach = /^services:\s*$/.test(line);
        aktualni = null;
        continue;
      }
      if (!vSluzbach) continue;
      const sluzba = /^ {2}([A-Za-z0-9._-]+):\s*$/.exec(line);
      if (sluzba) {
        aktualni = sluzba[1];
        continue;
      }
      const cn = /^ {4,}container_name:\s*(\S.*?)\s*$/.exec(line);
      if (cn && aktualni) map.set(aktualni, cn[1].replace(/^["']|["']$/g, ""));
    }
  }
  composeContainerCache.set(klic, map);
  return map;
}

/**
 * Jméno kontejneru pro katalogový odkaz `{ service: "<klíč compose služby>" }`.
 *
 * `prefix` je identita ZÁKAZNÍKA (`APP_NAME_PREFIX`). Bez ní se jméno složit
 * NEDÁ a dosadit ji nesmíme — viz `appNamePrefixOrWarn`: odhadnutý prefix
 * otočí adresu na cizí produkci. Vrací `null`, volající to musí ohlásit.
 *
 * @returns {string|null}
 */
/**
 * Dosadí identitu instance do adresy z katalogu.
 *
 * ⛔ PROČ (naměřeno 2026-08-21). Katalog vydával `http://mesh-router:3001` jako
 * `edge_mesh_upstream`. Holé jméno je na sdíleném hostiteli adresa BEZ
 * VLASTNÍKA — patří tomu, kdo na dané síti odpoví první. Nic přitom neselže:
 * spojení se naváže a odpoví CIZÍ router, tedy cizí mesh.
 *
 * Vrací `null`, když adresa identitu vyžaduje a ta chybí. Dosadit ji nesmíme
 * (odhad otočí adresu na cizí produkci) a vrátit nerozvinutou šablonu taky ne
 * (literál `${…}` v env vypadá jako hodnota a projde dál). Konzument
 * (`requireEdgeMeshUpstream`) na null selže nahlas.
 */
function dosadIdentitu(adresa, prefix) {
  if (!adresa) return adresa;
  if (!/\$\{APP_NAME_PREFIX/.test(adresa)) return adresa;
  if (prefix) return adresa.replace(/\$\{APP_NAME_PREFIX[^}]*\}/g, prefix);

  // Bez identity NEPADÁME a ani nevracíme nerozvinutou šablonu — obojí by
  // rozbilo obecný (upstreamový) strom, kde žádná instance neexistuje a adresa
  // je tak jako tak zástupná. Držíme se tvaru, který tenhle soubor pro TOTÉŽ
  // používá o kus výš (`appNamePrefixOrWarn`): ohlásit a degradovat.
  //
  // Skutečné nasazení identitu VŽDY nese (compose ji vyžaduje jako
  // `${APP_NAME_PREFIX:?identita instance}`), takže se sem produkce nedostane.
  process.stderr.write(
    `[derive-domains] WARN: adresa '${adresa}' se skládá BEZ identity instance — ` +
      `topologie nenese app_name_prefix. Na sdíleném hostiteli je holé jméno ` +
      `adresa bez vlastníka: patří tomu, kdo na síti odpoví první. ` +
      `Deklaruj identitu v profilu nebo nastav APP_NAME_PREFIX.\n`,
  );
  return adresa.replace(/\$\{APP_NAME_PREFIX[^}]*\}-?/g, "");
}

export function containerNameFrom(composeFile, serviceKey, prefix) {
  if (!composeFile || !serviceKey) return null;
  const raw = composeContainerNames(composeFile).get(serviceKey);
  if (!raw) return null;
  if (!/\$\{APP_NAME_PREFIX/.test(raw)) return raw; // jméno bez identity (sdílená infra) — bere se, jak stojí
  if (!prefix) return null;
  return raw.replace(/\$\{APP_NAME_PREFIX[^}]*\}/g, prefix);
}

/**
 * Kde služba bydlí v HLAVNÍM meshi: compose, jehož peer nese její jména, a compose služba,
 * na kterou míří trasy. Obvykle služba sama; model na slotu modelového meshe (varianta C)
 * ale do hlavního meshe nepatří a jeho jména drží MOST (`mesh_most` z topologie, katalog
 * `mesh_most_pro`). Jeden domov pro trasy ingressu (derive-domains) i záznam mesh DNS
 * (netbird-dns-provision) — kdyby si to každý odvodil sám, jméno by mířilo jinam než trasa.
 *
 * @returns {{compose: string|null, sluzba: string|null, most: string|null}}
 */
export function domovVHlavnimMeshi(topo, id) {
  const svc = topo?.services?.[id];
  if (!svc) return { compose: null, sluzba: null, most: null };
  if (!svc.mesh_most) return { compose: svc.compose ?? null, sluzba: svc.internal_url?.service ?? null, most: null };
  const most = topo.services[svc.mesh_most];
  return { compose: most?.compose ?? null, sluzba: most?.internal_url?.service ?? null, most: svc.mesh_most };
}

// B6: the catalog's internal HTTP URL for a service — http://<container>:<port>. PROFILE-
// INDEPENDENT (the container:port is the same in every profile), so local-presets derives
// AGENT_RUNNER_URL/OPENCLAW_URL from this ONE source of truth instead of hardcoding (the
// passthrough that drifted). Returns null when the service has no internal HTTP listener.
//
// Lokální stack si kontejnery přejmenovává, ale PŮVODNÍ jméno drží jako alias na
// své síti (`namespaceContainerNames` v local-compose-gen), takže tenhle tvar
// tam platí dál.
export function internalUrlFor(serviceId, prefix = (process.env.APP_NAME_PREFIX || "").trim()) {
  const svc = loadCatalog().services?.[serviceId];
  if (!svc?.internal_url?.service || !svc?.internal_url?.port) return null;
  const container = containerNameFrom(svc.compose, svc.internal_url.service, prefix);
  if (!container) return null;
  return `http://${container}:${svc.internal_url.port}`;
}

/**
 * Adresa položky `internal_endpoints` podle jejího ALIASU — stejný tvar jako `internalUrlFor`
 * (kontejner složený z identity instance + port z katalogu), jen pro služby, které vydávají
 * víc vnitřních adres (domain-services: storage-auth, push, …).
 *
 * ⛔ Naměřeno 2026-09-30: core compose žádá `${STORAGE_AUTH_URL:?}` (gateway posílá fotky
 * z předání na storage-auth), ale lokální profil `local-dev` stack domain-services nezahrnuje,
 * takže `buildTopology` alias nevydá. Hodnota se proto SKLÁDÁ z katalogu, ne opisuje.
 */
export function internalEndpointUrlFor(serviceId, alias, prefix = (process.env.APP_NAME_PREFIX || "").trim()) {
  const svc = loadCatalog().services?.[serviceId];
  const ep = (svc?.internal_endpoints ?? []).find((e) => (e.env_aliases ?? []).includes(alias));
  if (!ep?.service || !ep?.port) return null;
  const container = containerNameFrom(svc.compose, ep.service, prefix);
  if (!container) return null;
  return `http://${container}:${ep.port}`;
}

function loadServers() {
  return readJSON(resolve(ROOT, "coolify/servers.json"));
}

// ── Domain derivation ──────────────────────────────────────────────────────
/**
 * Build a domain from a pattern + variables.
 *   pattern: "{subdomain}.{server}.{internal_tld}"
 *   vars:    { subdomain: "auth", server: "backend", internal_tld: "example.com" }
 *   → "auth.backend.example.com"
 *
 * Empty/absent subdomain returns the bare TLD (used for root domains).
 */
function fillPattern(pattern, vars) {
  let out = pattern;
  for (const [key, val] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{${key}\\}`, "g"), val ?? "");
  }
  // Collapse leading "." that arises from empty subdomain
  return out.replace(/^\./, "");
}

/**
 * Apply MESH_ENABLED rewrite. User's vision: when mesh ON, prepend `mesh.`.
 * Pattern in profile.domain.mesh_pattern controls the rewrite.
 */
function applyMeshOverlay(domain, subdomain, profile, meshEnabled) {
  if (!meshEnabled) return domain;
  const pattern = profile.domain.mesh_pattern;
  if (!pattern) return domain;
  return fillPattern(pattern, {
    subdomain,
    mesh_tld: profile.domain.mesh_tld,
    public_tld: profile.domain.public_tld,
    internal_tld: profile.domain.internal_tld,
    // Normalized instance namespace, exposed so the few emit sites that build a
    // hostname by hand cannot silently skip it (GATEWAY_DOMAIN_PUBLIC did).
    // Mesh je overlay nad VNITŘNÍ zónou (veřejný scope sem nikdy nevstoupí —
    // volá se s meshEnabled:false), takže platí prefix sdílené zóny.
    subdomain_prefix: prefixProZonu(profile.domain, "internal"),
  });
}

/**
 * Normalize an instance namespace prefix so it always separates from the
 * subdomain it prefixes.
 *
 * WHY: the prefix used to be concatenated bare, so a profile declaring
 * `subdomain_prefix: "tenant"` emitted `tenantauth` / `tenantapi` / `tenantn8n` — while that
 * same profile's own `_notes` documented the contract as `tenant-<svc>`. The value
 * and the code disagreed, and nothing caught it because the only fork running a
 * prefix in production had worked around it by baking the separator into the
 * value ("<prefix>-" → "<prefix>-auth"). Measured 2026-07-19.
 *
 * A value that already ends in a separator is returned untouched, so live
 * deployments using the prefixed form emit exactly what they emit today.
 *
 * @param {string|undefined|null} raw
 * @returns {string} normalized prefix ("" when unset)
 */
function normalizeSubdomainPrefix(raw) {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return "";
  return /[-.]$/.test(value) ? value : `${value}-`;
}

/**
 * Který prefix platí pro DANOU ZÓNU.
 *
 * Dvě různé věci se stejným tvarem, proto se nesmí slít do jedné hodnoty:
 *
 *   `subdomain_prefix`     výslovná volba forku (profil). Platí VŠUDE včetně
 *                          veřejné zóny — fork, který veřejnou zónu s někým
 *                          sdílí, se jinak rozlišit nemůže (živý tvar `<fork>-`).
 *   `shared_zone_prefix`   identita instance odvozená z APP_NAME_PREFIX. Platí
 *                          jen tam, kde zóna identitu nenese — tedy ve vnitřní
 *                          a mesh zóně. Veřejnou zónou je vlastní doména
 *                          instance, ta identitu nese sama.
 *
 * @param {{subdomain_prefix?: string, shared_zone_prefix?: string}|undefined} zdroj
 * @param {"internal"|"public"} scope
 * @returns {string} znormalizovaný prefix ("" když žádný neplatí)
 */
function prefixProZonu(zdroj, scope) {
  const vyslovny = normalizeSubdomainPrefix(zdroj?.subdomain_prefix);
  if (scope === "public") return vyslovny;
  return normalizeSubdomainPrefix(zdroj?.shared_zone_prefix) || vyslovny;
}

/**
 * Resolve a single subdomain to its concrete URL based on profile + scope.
 *
 * @param {string} subdomain - "auth", "n8n", "mcp", ...
 * @param {string} server    - placement server id ("backend", "frontend", ...)
 * @param {object} profile   - loaded profile
 * @param {object} options   - { scope: "internal"|"public", meshEnabled: bool }
 */
function resolveDomain(subdomain, server, profile, { scope = "internal", meshEnabled = false, applyPrefix = true } = {}) {
  if (!subdomain) return null;
  // Apply subdomain_prefix from profile.domain — useful for forks that
  // namespace ALL subdomains under a single prefix. E.g. profile sets
  // `subdomain_prefix: "acme-"` → "api" becomes "acme-api", "auth"
  // becomes "acme-auth", etc. Per-service overrides can bypass the
  // prefix by passing `applyPrefix: false` (e.g. when a service uses an
  // explicit `service_overrides.<id>.subdomain` value the override is
  // taken as-is, no prefix). Backward compatible: when subdomain_prefix
  // is unset (the default), behavior is identical to pre-prefix logic.
  const prefix = prefixProZonu(profile.domain, scope);
  const effectiveSubdomain = (applyPrefix && prefix) ? `${prefix}${subdomain}` : subdomain;
  const pattern = scope === "public"
    ? profile.domain.public_pattern
    : profile.domain.internal_pattern;
  let domain = fillPattern(pattern, {
    subdomain: effectiveSubdomain,
    server,
    public_tld: profile.domain.public_tld,
    internal_tld: profile.domain.internal_tld,
    // mesh_tld PATŘÍ do slovníku i pro vnitřní zónu. Bez něj nešlo napsat
    // `internal_pattern: "{subdomain}.{mesh_tld}"` — vzor se vyplnil doslova
    // a vydal hostname `<fork>-auth.{mesh_tld}` (naměřeno 2026-08-25). Vzor tím
    // mlčky vynucoval `{server}`, tedy adresu odvozenou z UMÍSTĚNÍ služby,
    // a ta je na víceuzlovém nasazení jen náhoda: služba se přesune a jméno
    // přestane platit. Slovník vzoru musí unést i odpověď „vnitřní = mesh“.
    mesh_tld: profile.domain.mesh_tld,
  });
  domain = applyMeshOverlay(domain, effectiveSubdomain, profile, meshEnabled);
  return domain;
}

// ── Top-level: build the topology ──────────────────────────────────────────
/**
 * Druhé jméno Keycloaku pro `extra_hosts` — ZARUČENĚ různé od `KEYCLOAK_DOMAIN_PUBLIC`.
 * Compose dělá z extra_hosts mapu a dvě shodné položky ji rozbijí („must be a
 * mapping“, naměřeno 2026-09-04 na produkci forku). Kanonická doména, je-li
 * různá od veřejné; jinak sentinel `.invalid` (RFC 6761): záznam existuje, ale
 * nikdy se netrefí. Pravidlo má JEDEN domov — čte ho `--shell` emitor níž i
 * lokální zrcadlo (config/local-presets.mjs), aby se dev a produkce nerozešly.
 */
export function keycloakExtraHostAlias(kanonicka, verejna) {
  return kanonicka && kanonicka !== verejna ? kanonicka : "keycloak-alias-disabled.invalid";
}

const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
// Jméno, pod kterým ingress cíl najde: alias na síti agenta (docker ho bere
// z názvu compose služby nebo z `aliases:`), ne `container_name` — ten Coolify
// při nasazení přejmenuje na `<služba>-<uuid>-<čas>`.
const DOCKER_ALIAS = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

/**
 * Veřejné tváře, které obsluhuje edge-proxy, a katalogová služba, které patří.
 *
 * Klíče jsou TÝŽ seznam, který edge-proxy registruje jako svůj Traefik kontrakt
 * (`edgeProxyDomains()` v coolify-domain-doctor.mjs, `EDGE_PROXY_DOMAINS`
 * v coolify-deploy-init.sh); brána `edge-vlastni-jmena-na-svem-uzlu` hlídá, že
 * se nerozejdou. NetBird tu není: jeho jedno jméno pro obě tváře patří
 * netbird-proxy (výjimka majitele 2026-09-16 — mesh staví, nemůže v ní být).
 * Cizí tváře (EXTERNAL_FACES) taky ne: jejich aplikace Coolify doménu nemá.
 *
 * `ask` (GATEWAY_DOMAIN_PUBLIC) patří JÁDRU — edge ho posílá na core gateway,
 * ne na llm-gateway (viz komentář u GATEWAY_DOMAIN_PUBLIC ve formatShellExports).
 */
export const EDGE_VEREJNE_TVARE = Object.freeze([
  Object.freeze({ klic: "API_DOMAIN_PUBLIC", sluzba: "core", upstream: "API_UPSTREAM_MESH" }),
  Object.freeze({ klic: "GATEWAY_DOMAIN_PUBLIC", sluzba: "core", upstream: "GATEWAY_UPSTREAM_MESH" }),
  Object.freeze({ klic: "MCP_DOMAIN", sluzba: "orchestration", upstream: "MCP_UPSTREAM_MESH" }),
  Object.freeze({ klic: "DIRIGENT_DOMAIN", sluzba: "orchestration", upstream: "DIRIGENT_UPSTREAM_MESH" }),
  Object.freeze({ klic: "KEYCLOAK_DOMAIN_PUBLIC", sluzba: "keycloak", upstream: "AUTH_UPSTREAM_MESH" }),
  Object.freeze({ klic: "LIVE_DOMAIN_PUBLIC", sluzba: "realtime", upstream: "LIVE_UPSTREAM_MESH" }),
  Object.freeze({ klic: "COMPANION_DOMAIN_PUBLIC", sluzba: "openclaw", upstream: "COMPANION_UPSTREAM_MESH" }),
  Object.freeze({ klic: "INGEST_DOMAIN_PUBLIC", sluzba: "local-ingest", upstream: "INGEST_UPSTREAM_MESH" }),
  Object.freeze({ klic: "POTOK_DOMAIN_PUBLIC", sluzba: "potok", upstream: "POTOK_UPSTREAM_MESH" }),
  Object.freeze({ klic: "EXTRANET_DOMAIN_PUBLIC", sluzba: "extranet", upstream: "EXTRANET_UPSTREAM_MESH" }),
]);

/**
 * Veřejná jména, která vlastní EDGE — hodnota `EDGE_OWNED_HOSTS`: tváře na uzlu
 * edge A tváře, ke kterým edge jde meshem (na jakémkoli uzlu).
 *
 * ⛔ NAMĚŘENO 2026-09-27 (jednouzlová instance s meshem — server_bindings všech
 * slotů na jeden stroj; cold-start krok 4): edge-proxy i backendy
 * registrovaly totéž jméno (api × core `gateway`, auth × keycloak, mcp/dirigent ×
 * orchestration `n8n-auth`). Návrh to dovoluje, protože „jiný server = jiný
 * Traefik" (fqdn-owners.mjs) — jenže instance měla všechny sloty vázané na JEDEN
 * stroj, takže dva routery skončily na jednom Traefiku: FQDN_CONFLICT ×4, doktor
 * oprávněně odmítl zapisovat a veřejná jména obsluhovaly backendy mimo edge.
 *
 * Pravidlo majitele: veřejné jde jen přes edge. Na uzlu edge proto jméno vlastní
 * edge a backend ho neregistruje (coolify-domain-doctor.mjs i deploy-init čtou
 * TENHLE seznam, sami nic nepočítají). Precedent: „jedno jméno pro obě tváře"
 * u NetBirdu — jen tam jméno patří přímé tváři, protože NetBird mesh staví.
 *
 * Kolokace na téže ose jako PKI_COLOCATED_SLOTS: `(bindings[slot] ?? slot)`.
 * Nevázaný slot je tu tedy samostatný uzel (otevřené rozhodnutí R-e tohle
 * pravidlo NEMĚNÍ — bez `server_bindings` se nic nevydá, jako dosud).
 *
 * JEN PŘI ZAPNUTÉM MESHI. Tehdy edge jde na backend mimo Traefik
 * (`*_UPSTREAM_MESH`: mesh jméno, u kolokovaného Keycloaku alias kontejneru),
 * takže převzetí jména smyčku nevyrobí. Bez meshe jde edge přes `*_UPSTREAM_PUBLIC`
 * — na jednozónové instanci je to TOTÉŽ veřejné jméno a edge by proxoval sám
 * na sebe; tam se vlastnictví nemění (samostatný problém, ne tohoto pravidla).
 *
 * @param {object} topo      výsledek buildTopology
 * @param {(klic: string) => string} hodnota  VYDANÁ hodnota klíče (čte se to,
 *   co uvidí konzument — táž zásada jako u KEYCLOAK_EXTRA_HOST_ALIAS)
 * @returns {string[]} seřazení holí hosté, malými písmeny
 */
export function edgeOwnedHosts(topo, hodnota) {
  if (!topo?.mesh_enabled) return [];
  const bindings = topo.server_bindings ?? {};
  const edgePlacement = topo.services?.edge?.placement;
  if (!edgePlacement) return [];
  const uzel = (slot) => bindings[slot] ?? slot;
  const edgeUzel = uzel(edgePlacement);
  const hosts = new Set();
  for (const { klic, sluzba, upstream } of EDGE_VEREJNE_TVARE) {
    const placement = topo.services?.[sluzba]?.placement;
    if (!placement) continue;
    // ⛔ (2026-10-02, „vše jen přes edge“) Jméno vlastní edge i na JINÉM uzlu,
    // když k tváři jde MESHEM: pak backend router nikdo nepotřebuje a byl by to
    // jen boční vstup mimo dveře a evidenci edge (naměřeno: n8n-auth dál
    // registroval veřejné mcp/dirigent na backendovém Traefiku). Kde edge jde
    // přes Traefik backendu (auth na rozdělené flotile — přímá tvář Keycloaku,
    // bootstrap meshe), jméno zůstává backendu: převzetí by vyrobilo smyčku.
    const meshem = isMeshHost(String(hodnota(upstream) ?? "").trim());
    if (uzel(placement) !== edgeUzel && !meshem) continue;
    const host = String(hodnota(klic) ?? "").trim().toLowerCase();
    if (!host || host.includes("${") || host.endsWith(".invalid")) continue;
    hosts.add(host);
  }
  return [...hosts].sort();
}

/**
 * Veřejné tváře aplikací, které instance NENASAZUJE — proměnná `EXTERNAL_FACES`.
 *
 * Aplikace mimo katalog (vlastní Coolify app, cizí repozitář) potřebuje
 * veřejnou adresu, ale nesmí dostat vlastní cestu kolem meshe — pravidlo
 * majitele „veřejné jde do meshe" platí i pro ni. Nestane se ani peerem
 * (mesh tajemství cizí appce nepatří): jde přes mesh-ingress PLATFORMNÍHO
 * stacku (`via`) na tomtéž serveru, jehož agent na ni vidí po docker síti.
 *
 *   edge  --Host: <veřejné>-->  <mesh jméno>:<port>  (DNS → peer IP stacku via)
 *         --mesh-ingress via-->  <container>:<port>
 *
 * DEKLARACE JE PROMĚNNÁ INSTANCE, ne profil: další aplikace = úprava hodnoty,
 * ne commit. Tvar (položky oddělené čárkou nebo středníkem):
 *
 *   EXTERNAL_FACES="<subdomain>=<container>:<port>@<via>, …"
 *   EXTERNAL_FACES="partner-api=partner-api:8000@source-broker"
 *
 * Bez meshe se tvář NEVYDÁ (a derivace to řekne nahlas) — boční cesta se
 * nedosazuje, ani když by „fungovala".
 *
 * @param {string|undefined} raw  hodnota EXTERNAL_FACES
 * @returns {Array<{id: string, subdomain: string, via: string, via_compose: string,
 *   container: string, port: number, public_host: string, mesh_host: string|null}>}
 */
export function deriveExternalFaces(raw, profile, services, meshEnabled) {
  const polozky = String(raw ?? "").split(/[,;]/).map((x) => x.trim()).filter(Boolean);
  const vzor = "<subdomain>=<container>:<port>@<via>";
  const out = [];
  const videne = new Set();
  for (const polozka of polozky) {
    const tu = `[derive-domains] EXTERNAL_FACES '${polozka}'`;
    const m = /^([^=\s]+)=([^:@\s]+):([^@\s]+)@(\S+)$/.exec(polozka);
    if (!m) throw new Error(`${tu}: čekám ${vzor}.`);
    const [, subdomain, container, portRaw, viaId] = m;
    if (!DNS_LABEL.test(subdomain)) throw new Error(`${tu}: subdoména '${subdomain}' není DNS label (a-z, 0-9, '-').`);
    if (videne.has(subdomain)) throw new Error(`${tu}: subdoména '${subdomain}' je deklarovaná dvakrát.`);
    videne.add(subdomain);
    if (!DOCKER_ALIAS.test(container)) throw new Error(`${tu}: '${container}' není docker jméno/alias.`);
    const port = Number(portRaw);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${tu}: '${portRaw}' není TCP port.`);
    const via = services[viaId];
    if (!via) {
      throw new Error(
        `${tu}: via '${viaId}' v topologii NENÍ (instance tu službu nenasazuje). Tvář vede přes ` +
          `mesh-ingress jejího stacku — bez něj nemá kudy, a boční cestu derivace nedosadí.`,
      );
    }
    const composePath = resolve(ROOT, String(via.compose ?? ""));
    const composeText = via.compose && existsSync(composePath) ? readFileSync(composePath, "utf8") : "";
    if (!/_MESH_INGRESS_ROUTES/.test(composeText)) {
      throw new Error(`${tu}: via '${viaId}' — ${via.compose ?? "(bez compose)"} nemá mesh-ingress, přes který by tvář vedla.`);
    }
    out.push({
      id: subdomain,
      subdomain,
      via: viaId,
      via_compose: via.compose,
      container,
      port,
      // Veřejné jméno je VÝSLOVNÁ volba instance — bere se doslova jako
      // `service_overrides.<id>.subdomain` (bez subdomain_prefix).
      public_host: resolveDomain(subdomain, via.placement, profile, { scope: "public", meshEnabled: false, applyPrefix: false }),
      // Mesh zóna je sdílená — jméno nese identitu instance jako každé jiné.
      mesh_host: meshEnabled
        ? resolveDomain(subdomain, via.placement, profile, { scope: "internal", meshEnabled: true, applyPrefix: true })
        : null,
    });
  }
  return out;
}

/** Platné režimy rezidence dat AI — tytéž, které zná `getExecutionMode()` v @aisha/llm-dispatch. */
export const REZIMY_AI = ["local", "hybrid", "cloud"];

export function buildTopology({ profileId, meshEnabled } = {}) {
  // Nedeklarovaný tvar nasazení = SAMOSTATNÝ STACK, ne rozdělená farma.
  //
  // Ten default není kosmetika: profil nese server_bindings, a ty rozhodují KAŽDOU
  // kolokační větev (PKI_BRIDGE_URL, AUTH_UPSTREAM_*, KEYCLOAK_INTERNAL_URL).
  // Předpokládat rozdělení znamená vydat meziuzlové adresy — `https://auth.backend.
  // <internal>`, `https://pki-bridge.backend.<internal>` — na kterých uvnitř
  // jednoho hostu NIKDO neposlouchá a které se ani nerozřeší. Předpokládat
  // samostatný stack vydá container alias na sdílené docker síti, který funguje
  // i na rozdělené farmě pro služby, co spolu bydlí.
  //
  // Chybný odhad tedy nestojí stejně na obě strany: „single, ale je to multi"
  // selže hlasitě u konkrétní služby, „multi, ale je to single" rozbije bootstrap
  // celé instance. Měřeno 2026-07-28: pki-init exit 1 → bez CA bundle → mesh
  // čtyři dny dole; edge 502 na auth → netbird-management v crash-loopu.
  // ⛔ Bez literálu: `?? "cloud-single"` tu byl DRUHOU odpovědí na touž otázku
  // (cold-start si dosazoval `cloud-multi`), takže podle toho, koho ses zeptal,
  // byla instance jiného tvaru. Kdo profil nedeklaruje, ten neví — a odvozovat
  // celou topologii z uhodnutého tvaru je tišší, ne bezpečnější.
  const PROFILE_ID = profileId ?? (process.env.AISHA_PROFILE ?? "").trim();
  if (!PROFILE_ID) {
    throw new Error(
      "AISHA_PROFILE není deklarovaný a --profile nebyl předán — nevíme, jaký TVAR " +
        "nasazení odvozovat.\n" +
        "  Dosazený tvar by vydal jiné domény, jiné servery a jinou organizaci, " +
        "a nic by přitom nespadlo (naměřeno 2026-08-22: dvě různá dosazení pro touž " +
        "veličinu).\n" +
        "  Deklaruj AISHA_PROFILE v .env-prod-backup, nebo předej --profile=<id>.",
    );
  }
  const profile = loadProfile(PROFILE_ID);

  // ⛔ NAMĚŘENO 2026-09-04: `mesh_default` je deklarovaný ve schématu i ve VŠECH
  // profilech — a NIKDO ho nečetl. MESH se počítal jen z prostředí a bez něj padal
  // na `false`, takže profil, který mesh chce, ho nedostal. Produkce <fork> proto
  // běžela mesh-less, přestože mesh je výchozí stav (by design) — a edge přesto
  // dostával MESH adresy (*_UPSTREAM = <svc>.<slot>.<tld>), které se bez mesh-dns
  // nemají kde rozložit: i/o timeout → 502 na api, mcp i dirigent.
  //
  // Deklarace bez konzumenta je horší než chybějící: tvrdí, že něco řídí.
  // (Táž třída jako ENABLE_GOOGLE_OAUTH, viz instance-rollout.sh ř. 361.)
  //
  // Pořadí: výslovný --mesh > MESH_ENABLED v prostředí > profil > true.
  //
  // Poslední člen je `true`, ne `false` (sloučení 2026-09-12 dvou oprav téže
  // třídy): upstream f133dea3a naměřil, že nejhlubší default `false` vydal
  // slotové adresy místo meshových a edge jel `public`, ač mesh stála — mesh
  // je podmínka provozu, ne per-instanční volba. Schéma profilu `mesh_default`
  // VYŽADUJE, takže na validním profilu se sem nikdy nedojde; na nevalidním
  // nesmí resolver sám rozhodnout, že mesh není.
  const MESH = meshEnabled ?? (
    process.env.MESH_ENABLED !== undefined
      ? String(process.env.MESH_ENABLED).toLowerCase() === "true"
      : typeof profile.mesh_default === "boolean"
        ? profile.mesh_default
        : true
  );
  // Operator env overrides win over profile JSON for TLDs — keeps the
  // profile JSON deployment-agnostic (no public/internal TLD baked in).
  // Profile JSON may still ship the TLDs (as a reference) or leave them
  // empty/null; env always takes precedence when set.
  // Iter 14: SoT for new deploy must be clean — operator declares TLDs
  // via .env-prod-backup (or config/domains.env after it's been populated
  // from the .example reference). Profile values stay as last-resort
  // fallback for backward compat with existing reference deploys.
  if (profile.domain) {
    if (process.env.PUBLIC_TLD)  profile.domain.public_tld   = process.env.PUBLIC_TLD;
    if (process.env.INTERNAL_TLD) profile.domain.internal_tld = process.env.INTERNAL_TLD;
    if (process.env.MESH_TLD)    profile.domain.mesh_tld     = process.env.MESH_TLD;
    // Jmenný prostor instance v hostnames — ODVOZUJE SE Z IDENTITY PROJEKTU.
    //
    // ⛔ NAMĚŘENO 2026-08-12: `subdomain_prefix` uměl resolver od #780 a NIKDO
    // ho nikdy nenaplnil — ani v profilu, ani přes tehdejší env páku
    // `AISHA_SUBDOMAIN_PREFIX` (v .env-prod-backup 0 výskytů, v kontraktu
    // env-doktora 0, v cold-startu 0). Jediná obrana proti tomu, aby dva
    // nájemníci na jednom Traefiku dostali TOTÉŽ jméno, tak zůstala vypnutá.
    // Shodilo to aisha-core: pki-init sáhl na pki-bridge CIZÍ instance, protože
    // `pki-bridge.backend.<internal_tld>` neukazuje jednoznačně nikam.
    //
    // Ta env páka byla navíc DRUHÉ JMÉNO pro věc, kterou už máme: identitu
    // projektu nese `APP_NAME_PREFIX` (vydává generate-secrets, je v kontraktu,
    // stojí ve jméně každého kontejneru, volume i sítě). Hostnames byly jediná
    // osa, která ji ignorovala. Proto se sem NEDOSAZUJE zvláštní proměnná —
    // odvodí se z identity, kterou už instance má. Jedna identita, jeden zdroj.
    //
    // ⛔ ROZSAH (majitel, 2026-08-12): identita se lepí JEN NA SDÍLENOU ZÓNU.
    //
    // Veřejná zóna identitu UŽ NESE — je to vlastní doména instance. `cache`
    // pod `aisha.guru` je jednoznačné; `aisha-cache.aisha.guru` je totéž jméno
    // řečené dvakrát. A není to jen kosmetika: 2026-08-12 se tím rozbil první
    // krok nasazení — pull-through cache se jmenuje `cache.<public_tld>`,
    // prefix z ní udělal `<projekt>-cache.<public_tld>`, kde neposlouchá žádný
    // router (naměřeno: `/v2/` → 404), takže vlna 0 nestáhla ani první obraz.
    //
    // Vnitřní zóna identitu NENESE: `<svc>.<slot>.<internal_tld>` je zóna
    // HOSTITELE a týž tvar jména si vyrobí každý nájemník na týchž strojích.
    // Tam kolize skutečně nastala (pki-init sáhl na cizí pki-bridge) a tam
    // prefix patří. Mesh zóna jde s vnitřní — jména v ní řeší náš vlastní
    // resolver, prefix je tam zadarmo a drží obranu i po přepnutí na mesh.
    //
    // JEDINÝ zdroj identity: APP_NAME_PREFIX (vydává generate-secrets, je
    // v kontraktu, stojí ve jméně každého kontejneru, volume i sítě). Ukládá se
    // do VLASTNÍHO pole, ne přes `subdomain_prefix` — ten zůstává výslovnou
    // volbou forku, která platí ve všech zónách včetně veřejné (živý tvar
    // `<fork>-auth.<public_tld>`: fork, který veřejnou zónu s někým sdílí).
    const identita = (process.env.APP_NAME_PREFIX || "").trim();
    if (identita) profile.domain.shared_zone_prefix = identita;
  }
  // OAuth2 cookie domains — same override pattern. Operator declares the
  // comma-separated cookie zones in .env-prod-backup; falls back to profile
  // JSON when present.
  if (profile.oauth2) {
    if (process.env.OAUTH2_COOKIE_DOMAINS)    profile.oauth2.cookie_domains    = process.env.OAUTH2_COOKIE_DOMAINS;
    if (process.env.OAUTH2_WHITELIST_DOMAINS) profile.oauth2.whitelist_domains = process.env.OAUTH2_WHITELIST_DOMAINS;
  }
  // Iter 15: cloud-* profile JSONs ship with `null` TLDs (template-only).
  // Resolution ladder when env doesn't supply a value:
  //   1. profile JSON itself (may still ship values for legacy back-compat)
  //   2. profile JSON `.example` sibling (AISHA reference deploy values) —
  //      reference fallback used by gate tests + fresh-clone walkthroughs.
  //      Emits a stderr warning so operators don't accidentally ship .example
  //      values to production without realising.
  //   3. throw, pointing operator at the .example file as a starting point.
  // local-dev is exempt — its profile uses the universal `.local` namespace
  // (RFC 6762 mDNS) which is not deployment-specific.
  // Které veřejné/vnitřní TLD přišly z REFERENČNÍHO `.json.example`, ne od
  // instance. Topologie z nich je referenční — nesmí se porovnávat s instančními
  // daty (overlay povrchu), jako by patřila instanci. Viz kontrola na konci
  // formatShellExports().
  const referencniDomeny = [];
  if (PROFILE_ID !== "local-dev" && profile.domain) {
    const needsFallback =
      !profile.domain.public_tld || !profile.domain.internal_tld || !profile.domain.mesh_tld
      || !profile.oauth2?.cookie_domains || !profile.oauth2?.whitelist_domains
      // Identita zákazníka patří do téhož kanálu: šablona ji nedeklaruje
      // (pojmenovala by skutečné nasazení), ale referenční topologie ji
      // potřebuje — adresa na sdílené síti se bez ní složit nedá.
      || !((process.env.APP_NAME_PREFIX || "").trim() || profile.app_name_prefix);
    if (needsFallback) {
      const examplePath = resolve(__dirname, `../../config/profiles/${PROFILE_ID}.json.example`);
      if (existsSync(examplePath)) {
        const exampleProfile = JSON.parse(readFileSync(examplePath, "utf8"));
        process.stderr.write(
          `[derive-domains] WARN profile=${PROFILE_ID}: TLDs/cookie_domains not supplied via env ` +
          `or live profile JSON — falling back to reference values from ${PROFILE_ID}.json.example. ` +
          `Set PUBLIC_TLD/INTERNAL_TLD/MESH_TLD/OAUTH2_COOKIE_DOMAINS/OAUTH2_WHITELIST_DOMAINS in ` +
          `.env-prod-backup for production.\n`,
        );
        if (!profile.app_name_prefix)     profile.app_name_prefix     = exampleProfile.app_name_prefix;
        if (!profile.domain.public_tld)   referencniDomeny.push("PUBLIC_TLD");
        if (!profile.domain.public_tld)   profile.domain.public_tld   = exampleProfile.domain?.public_tld;
        if (!profile.domain.internal_tld) profile.domain.internal_tld = exampleProfile.domain?.internal_tld;
        if (!profile.domain.mesh_tld)     profile.domain.mesh_tld     = exampleProfile.domain?.mesh_tld;
        if (profile.oauth2 && exampleProfile.oauth2) {
          if (!profile.oauth2.cookie_domains)    profile.oauth2.cookie_domains    = exampleProfile.oauth2.cookie_domains;
          if (!profile.oauth2.whitelist_domains) profile.oauth2.whitelist_domains = exampleProfile.oauth2.whitelist_domains;
        }
        if (exampleProfile.oauth2_cookie_domains_per_server && !profile.oauth2_cookie_domains_per_server) {
          profile.oauth2_cookie_domains_per_server = exampleProfile.oauth2_cookie_domains_per_server;
        }
      }
    }
    const missing = [];
    if (!profile.domain.public_tld)   missing.push("PUBLIC_TLD");
    if (!profile.domain.internal_tld) missing.push("INTERNAL_TLD");
    if (!profile.domain.mesh_tld)     missing.push("MESH_TLD");
    if (missing.length > 0) {
      throw new Error(
        `[derive-domains] profile=${PROFILE_ID} is missing required TLD(s): ${missing.join(", ")}.\n` +
        `Set them in your operator overlay (.env-prod-backup or config/domains.env) — ` +
        `the AISHA reference values live in config/profiles/${PROFILE_ID}.json.example.`,
      );
    }
  }
  // Identita ZÁKAZNÍKA se skládá JEDNOU a platí pro celé sestavení topologie.
  //
  // ⛔ MUSÍ TO BÝT AŽ TADY. Zkusil jsem to hned u `loadProfile` a tři brány
  // spadly: profil se o kus výš DOPLŇUJE z referenčního `.json.example`
  // (a identita je součástí toho doplnění), takže dřívější odečet zachytí
  // prázdno. Pořadí není detail — je to rozdíl mezi `<fork>-keycloak`
  // a holým `keycloak`.
  const identitaInstance = (process.env.APP_NAME_PREFIX || "").trim() || profile.app_name_prefix || "";

  const catalog = loadCatalog();
  const servers = loadServers();

  // ⭐ MODELOVÝ MESH FORKU (varianta C, aisha.decision 2026-10-05 03:17:54Z).
  // Řídicí rovinu modelového meshe (`netbird-model`) instance nese PRÁVĚ TEHDY,
  // když svůj model skutečně nasazuje na GPU slot. Lane `MODEL_MESH` se proto
  // NEČTE z prostředí — vydává ji tahle derivace (doktor ji jako `derived` zapíše
  // do .env.coolify, odkud ji čte story-init). Operátor ji nepřepíná: přepíná
  // umístění modelu v profilu instance.
  const modelovyMesh = slotModelovehoMeshe({ servers: servers.servers, sluzby: catalog.services, profil: profile });
  const ctiLane = ctiLaneTopologie(modelovyMesh);

  // Determine which services to include based on profile filter
  const tierFilter = new Set(profile.tier_filter || ["required", "important"]);
  const exclude = new Set(profile.exclude || []);
  const include = new Set(profile.include || []);
  const includeLocalOnly = new Set(profile.include_local_only || []);

  const enabled = {};
  for (const [id, svc] of Object.entries(catalog.services)) {
    if (exclude.has(id)) continue;
    // Opt-in provisioning condition (catalog `provision_when_env`) — the SAME
    // declaration coolify-story-init.sh reads to decide whether to create the
    // Coolify app; no longer a mirror of a bash copy that could drift out of
    // step. String = one condition, array = any-of, because a service can carry
    // several independent lanes (source-broker: federation SOURCE_API_URL OR
    // drop-replay LOCAL_INGEST_DROP_DIR). Without this guard the resolver
    // emitted hostnames for apps a cold-start deliberately does not create, and
    // every downstream coverage check (cold-start-verify route-exists)
    // permanently FAILed on the expected-absent service.
    // „Zapnuto?" rozhoduje JEDEN domov (lib/provision-gate.mjs) — i `false`
    // je vypínač, ne deklarace lane.
    if (!podminkaSplnena(svc.provision_when_env, ctiLane)) continue;
    const isLocalOnly = svc.tier === "local-only";
    const tierOk = tierFilter.has(svc.tier);
    const includedExplicitly = include.has(id);
    const localOnlyOk = isLocalOnly && includeLocalOnly.has(id);
    if (!(tierOk || includedExplicitly || localOnlyOk)) continue;

    // Resolve placement (profile override wins)
    const override = profile.service_overrides?.[id] ?? {};
    const placement = override.placement ?? svc.placement;
    // ⛔ NASAZENÁ ≠ VYSTAVENÁ. Katalog říká, jestli služba veřejnou tvář
    // SMYSLUPLNĚ MÁ (upstream ji jako admin cockpit chce); jestli ji TAHLE
    // instance na edge pouští, je rozhodnutí INSTANCE — a to patří do profilu.
    //
    // Naměřeno 2026-08-21 na riqi: edge servíroval `ingest`, `potok`,
    // `companion` a `live`, přestože jsou to vnitřní služby. Nešlo je vypnout
    // jinak než vyřadit z nasazení (`exclude`), což je něco jiného.
    //
    // `public_when_env` to nezastoupí — ten VYBÍRÁ, KTERÁ z provisioning lanes
    // si veřejnou tvář zaslouží (a brána `public-face-follows-the-lane` hlídá,
    // že odkazuje na skutečné lanes). Neumí říct „nasazená, ale nikdy veřejná".
    const jeVerejna = override.public ?? svc.public;

    // External service: deployed OUTSIDE this instance (e.g. a shared central
    // Keycloak that serves the whole fleet, on a different TLD). When
    // `service_overrides.<id>.external_domain` is set, the resolver emits that
    // fixed FQDN verbatim for EVERY scope (public/internal/direct) instead of
    // deriving a host under this instance's TLD — and never applies
    // subdomain_prefix. The service still participates in the dependency graph
    // (depends_on); it is simply reached at its fixed external address.
    const externalDomain =
      typeof override.external_domain === "string" && override.external_domain.trim()
        ? override.external_domain.trim()
        : null;

    // Build subdomains list — profile override wins over catalog default.
    // service_overrides.<id>.subdomain replaces catalog svc.subdomain; if
    // set, it is taken as-is (no subdomain_prefix applied — explicit choice).
    // service_overrides.<id>.extra_subdomains replaces catalog
    // svc.extra_subdomains similarly. Both useful for forks that bind
    // alternative frontends (e.g. acme binds web service to both
    // "acme" and "therapy" subdomains, no prefix).
    const overridePrimary = Object.prototype.hasOwnProperty.call(override, "subdomain");
    const overrideExtras = Object.prototype.hasOwnProperty.call(override, "extra_subdomains");
    const primarySubdomain = overridePrimary ? override.subdomain : svc.subdomain;
    const extraSubdomains = overrideExtras ? (override.extra_subdomains || []) : (svc.extra_subdomains || []);
    const subdomains = [];
    if (primarySubdomain) subdomains.push({ name: primarySubdomain, applyPrefix: !overridePrimary });
    for (const s of extraSubdomains) {
      subdomains.push({ name: s, applyPrefix: !overrideExtras });
    }

    // Internal / direct / public URLs.
    let urls;
    if (externalDomain) {
      // External service — one fixed FQDN, identical for every scope (internal
      // callers reach it publicly too). No TLD derivation, no subdomain_prefix.
      const sd = primarySubdomain || id;
      urls = {
        internal: [{ subdomain: sd, url: externalDomain }],
        direct: [{ subdomain: sd, url: externalDomain }],
      };
      if (jeVerejna) urls.public = [{ subdomain: sd, url: externalDomain }];
    } else {
      urls = {
        // Internal URLs (always present)
        internal: subdomains.map(({ name: sd, applyPrefix }) => ({
          subdomain: sd,
          url: resolveDomain(sd, placement, profile, { scope: "internal", meshEnabled: MESH, applyPrefix }),
        })),
        // direct: „dosažitelné BEZ meshe“. Konzumenti, kteří na meshi viset
        // NESMÍ (netbird management si tahá JWKS z Keycloaku — a zápis do
        // meshe na Keycloaku závisí, tedy kruh), chodí tímhle rozsahem.
        //
        // Předvyplňuje se vnitřním jménem BEZ mesh overlaye; když má služba
        // veřejnou tvář, PŘEPÍŠE se na ni níž (viz „direct → veřejná tvář“).
        // Vnitřní jméno tu zůstane jen službě, která veřejnou tvář nemá — a to
        // je poctivá odpověď „nic mesh-nezávislého pro ni neexistuje“, ne slib.
        direct: subdomains.map(({ name: sd, applyPrefix }) => ({
          subdomain: sd,
          url: resolveDomain(sd, placement, profile, { scope: "internal", meshEnabled: false, applyPrefix }),
        })),
      };

      // Public URLs (only if service is exposed publicly).
      // public_alias (string) — single public-zone subdomain rename (legacy, simple case).
      // public_aliases (array) — multiple public-zone subdomain forms; the same backend
      //   is reached via different *.{public_tld} hostnames (e.g. n8n backend exposed
      //   as both mcp.{public_tld} and dirigent.{public_tld}).
      if (jeVerejna) {
        const publicEntries = [];
        const aliases = resolvePublicAliases(svc, override, primarySubdomain, id);
        for (const { name: sd, applyPrefix } of subdomains) {
          if (aliases && sd === primarySubdomain) {
            // Replace the primary subdomain with each alias (multiple public faces)
            for (const alias of aliases) {
              publicEntries.push({
                subdomain: alias,
                url: resolveDomain(alias, placement, profile, { scope: "public", meshEnabled: false, applyPrefix }),
              });
            }
          } else {
            // No alias mapping — public-zone uses the same subdomain
            publicEntries.push({
              subdomain: sd,
              url: resolveDomain(sd, placement, profile, { scope: "public", meshEnabled: false, applyPrefix }),
            });
          }
        }
        urls.public = publicEntries;

        // ── direct → veřejná tvář ────────────────────────────────────────────
        // „Dosažitelné bez meshe“ a „vnitřní jméno bez mesh overlaye“ nejsou
        // totéž. Do 2026-08-25 to bylo slité do jedné hodnoty a `direct` vydával
        // `<sub>.<server>.<internal_tld>` — adresu odvozenou z UMÍSTĚNÍ služby.
        // Ta je dosažitelná jen na tom jednom uzlu, a jen díky `extra_hosts` na
        // host-gateway; profil instance si tu berličku sám poznamenal. Na
        // víceuzlovém nasazení Docker DNS servery nekříží, takže to nebyl návrh,
        // ale náhoda kolokace.
        //
        // ⛔ NAMĚŘENO 2026-08-25: netbird management si přes `direct` bere JWKS
        // Keycloaku. Adresa `<fork>-auth.<server>.<internal_tld>` mu nedala klíče,
        // takže odmítl KAŽDÝ token (`token invalid`) a fáze D se zastavila na
        // ražbě setup klíčů — tři vrstvy od příčiny.
        //
        // Veřejná tvář je JEDINÁ adresa, která je zároveň mesh-nezávislá a
        // víceuzlová. Proto ji `direct` dostane, kdykoli ji služba má.
        // ⛔ PŘEPIS JE VOLBA PROFILU (naměřeno 2026-08-26 na ostrém --wipe).
        //
        // Na topologii, kde veřejný wildcard routuje NA UZEL EDGE (pfSense:
        // `*.<public>` → talos) a služba běží jinde, udělá `direct = public`
        // ze všech konzumentů smyčku:
        //   AUTH_UPSTREAM_MESH = https://auth.<public>  ← edge proxuje SÁM NA SEBE
        //   → auth 404, KC smoke fáze B stojí 600 s, NETBIRD_API_URL 404,
        //     fáze D nemá kam sáhnout.
        // Motivační konzument tohohle přepisu (netbird management si bral JWKS
        // přes `direct`) už od #934 chodí přes KEYCLOAK_URL_FROM_CLUSTER —
        // vnitřní kontejnerovou sítí. Přepis je pro něj vestigiální.
        //
        // `direct_scope` v profilu proto rozhoduje:
        //   "public_face"      (výchozí) — chování #934: veřejná tvář, kdykoli je.
        //   "no_mesh_internal" — direct zůstane jméno v ROUTOVANÉ zóně uzlu
        //                        (technický přístup ke stroji zvenku, bez edge
        //                        i bez meshe — přesně to, k čemu rozsah je).
        const directPolitika = profile?.domain?.direct_scope ?? "public_face";
        if (directPolitika === "public_face") {
          for (const entry of urls.direct) {
            const verejna = publicEntries.find((p) => p.subdomain === entry.subdomain);
            if (verejna?.url) entry.url = verejna.url;
          }
        }
      }
    }

    enabled[id] = {
      role: svc.role,
      tier: svc.tier,
      placement,
      // Na slotu s has_gpu tenký stack forku (`compose_gpu`) — jediný domov volby.
      compose: composeProUmisteni(svc, placement, servers.servers),
      canonical_scope: svc.canonical_scope ?? "internal",
      // Musí projít až k emisi domén — tam se rozhoduje, jestli je veřejná tvář
      // armovaná (viz `public_when_env` níže). Bez protažení by pole tiše zmizelo
      // při přestavbě objektu a deklarace v katalogu by nic nedělala.
      public_when_env: svc.public_when_env ?? null,
      // Veřejná tvář: endpoint, na který edge posílá veřejný provoz (za
      // oauth2-proxy, kde před službou stojí). Strukturovaný ODKAZ na compose
      // službu + port — žádná adresa se neopisuje: host i cíl se skládají až
      // v derivaci (`verejnaTvar`, `edgeMeshUpstream`, `edgeMeshHost`).
      public_face: svc.public_face ?? null,
      depends_on: svc.depends_on || [],
      urls,
      // B6: the service's primary INTERNAL HTTP endpoint (container + port), carried so
      // formatShellExports can emit <ID>_URL as a first-class topology primitive. NULL for
      // services with no internal HTTP listener (DBs, init jobs, public-only edges).
      internal_url: svc.internal_url ?? null,
      // DALŠÍ endpointy téže služby. `internal_url` je jednotné číslo, ale core
      // vystavuje šest endpointů a domain-services devět — bez tohohle pole je
      // nelze pojmenovat a jejich konzumenti vždy spadnou na holý container
      // alias. Nese se stejně jako internal_url; whitelist v tomhle objektu je
      // důvod, proč pole přidané do katalogu samo od sebe do derivace NEDOTEČE.
      internal_endpoints: svc.internal_endpoints ?? [],
      // NE-HTTP endpointy (clamd 3310, redis 6379). Vlastní pole, protože se
      // rozvádějí JINAK: mesh-ingress je Caddy a rozlišuje podle `Host`, který
      // TCP nemá — proto tyhle služby dosud chodily po SDÍLENÉ síti `coolify`,
      // kde jméno nárokuje víc nájemníků najednou.
      // ⭐ U TCP ale Host rozlišovat NETŘEBA: každý peer má vlastní netns a mesh
      // IP, takže (mesh IP, port) je jednoznačné samo.
      internal_tcp_endpoints: svc.internal_tcp_endpoints ?? [],
    };
  }

  // ⭐ MOST modelového meshe (varianta C, krok C4). Model na slotu modelového meshe do
  // HLAVNÍHO meshe nepatří — jeho jméno tam drží služba, která to deklaruje
  // (`mesh_most_pro`). Trasy ingressu i záznam mesh DNS pak míří na peer mostu, takže
  // konzumenti (`SVC_MODEL_URL`, `VLLM_GENERATION_URL`) zůstávají beze změny. Bez
  // mostu by jméno modelu v hlavním meshi nemířilo nikam a návrat na CPU model není
  // (MM8) → výjimka. Most poslouchá na portu modelu: konzumenti volají ten.
  if (modelovyMesh && enabled[SLUZBA_MODELU]) {
    const mosty = Object.keys(enabled).filter((id) => catalog.services[id]?.mesh_most_pro === SLUZBA_MODELU);
    if (mosty.length !== 1) {
      throw new Error(
        `[derive-domains] model forku stojí na slotu '${modelovyMesh}' (modelový mesh), ale jeho jméno ` +
        `v hlavním meshi ${mosty.length ? `drží víc mostů (${mosty.join(", ")})` : "nedrží žádný most — služba s `mesh_most_pro: \"model\"` není v topologii (profil ji vyřadil?)"}. ` +
        "Bez právě jednoho mostu by SVC_MODEL_URL mířila nikam.",
      );
    }
    const portModelu = Number(enabled[SLUZBA_MODELU].internal_url?.port);
    const portMostu = Number(enabled[mosty[0]].internal_url?.port);
    if (!portModelu || portMostu !== portModelu) {
      throw new Error(
        `[derive-domains] most '${mosty[0]}' poslouchá na portu ${portMostu || "(žádném)"}, model na ${portModelu || "(žádném)"} — ` +
        "konzumenti volají port modelu, most ho musí převzít beze změny.",
      );
    }
    enabled[SLUZBA_MODELU].mesh_most = mosty[0];
  }

  return {
    profile: profile.id,
    profile_description: profile.description,
    mesh_enabled: MESH,
    mesh_tld: profile.domain.mesh_tld,
    public_tld: profile.domain.public_tld,
    internal_tld: profile.domain.internal_tld,
    referencni_domeny: referencniDomeny,
    // Slot modelového meshe forku, nebo "" (viz výš u `modelovyMesh`).
    model_mesh: modelovyMesh,
    // Deklarace nájemce společné lane na GPU uzlu (profil instance) — z ní LANE_VSTUP_URL.
    lane_gpu: profile.lane_gpu ?? null,
    // Normalized instance namespace, exposed so the few emit sites that build a
    // hostname by hand cannot silently skip it (GATEWAY_DOMAIN_PUBLIC did).
    // POZOR: tohle je VÝSLOVNÁ volba forku — platí i ve veřejné zóně. Identita
    // instance je vedle jako `shared_zone_prefix` a do veřejné zóny nepatří.
    subdomain_prefix: normalizeSubdomainPrefix(profile.domain.subdomain_prefix),
    // Identita instance na SDÍLENÉ zóně (vnitřní + mesh). Veřejná zóna je
    // vlastní doména instance, ta identitu nese sama — viz prefixProZonu().
    shared_zone_prefix: normalizeSubdomainPrefix(profile.domain.shared_zone_prefix),
    // Identita ZÁKAZNÍKA — prefix, pod kterým se stack hlásí na SDÍLENÉ docker
    // síti. Nezaměňovat se `subdomain_prefix` (osa hostnames) ani se
    // `SERVICE_ALIAS_PREFIX` (jméno IMPLEMENTACE, stejné pro všechny instance).
    // Nese se na topologii, protože adresu z něj skládá `formatShellExports`,
    // který profil sám nevidí. Plní se stejným kanálem jako TLD:
    // env > živý profil > reference z `<profil>.json.example` (hlasitě).
    app_name_prefix: identitaInstance,
    services: enabled,
    servers: profile.servers,
    // Optional slot -> Coolify server NAME map. Names, never UUIDs: a UUID is
    // re-minted when Coolify re-provisions a host, and this file is committed,
    // so a UUID here would be both instance-specific and perishable. The name
    // is resolved against the live /api/v1/servers list at deploy time.
    //
    // Absent (every upstream profile) = unchanged behaviour: slot resolution
    // falls through to the structural inferences it uses today.
    server_bindings: profile.server_bindings ?? {},
    oauth2: profile.oauth2,
    oauth2_cookie_domains_per_server: profile.oauth2_cookie_domains_per_server,
    // Pass the raw service_overrides map through so emit-shell-env can
    // honor per-service legacy_env_var renames (e.g. forks that bind
    // a different subdomain for "web" but still want APP_DOMAIN emitted).
    service_overrides: profile.service_overrides ?? {},
    // Surface SPAs (extranet, mobile, …). NOT services: a surface is a
    // standalone Dockerfile app built from a shell + an instance overlay, so it
    // never appears in the compose catalog and story-init's role:server:compose
    // model cannot express it. It still owns a PUBLIC HOSTNAME, which is why it
    // belongs in the topology: the browser origin of every surface has to reach
    // the CORS allowlist, and until 2026-07-28 nothing derived it — the extranet
    // authenticated fine and then had every API call rejected at the preflight
    // with `Origin … not in CORS allowlist`.
    surfaces: Array.isArray(profile.surfaces) ? profile.surfaces : [],
    // Compose profily UVNITŘ edge stacku (dnes: `knock` = vrátný na UDP).
    // Nejsou to služby katalogu — nemají vlastní Coolify app, jedou v témže
    // compose jako edge a zapínají se `COMPOSE_PROFILES`. Deklaruje je proto
    // instance, ne katalog.
    //
    // Prázdno u všech platformních šablon: merge nesmí nikdy nic rozsvítit sám.
    // Instance, která vrátného chce, ho vyjmenuje.
    edge_profiles: Array.isArray(profile.edge_profiles) ? profile.edge_profiles : [],
    // Režim vrátného: 'measure' (nic neotevře) nebo 'live'. VLASTNOST INSTANCE,
    // ne konstanta produktu — a proto tady, ne jako static v kontraktu doctora.
    //
    // Dokud takové místo neexistovalo, neměla instance jak říct „chci ostrý",
    // a vynutila si ruční `>>` do .env.coolify vedle hodnoty, kterou tam píše
    // doctor. Dvě pravdy o jedné hodnotě, a která vyhraje, záleží na tom, kdo
    // soubor čte. Chybějící deklarativní kanál si vždycky vynutí obchvat.
    // ⛔ Zápis se NEZPLOŠŤUJE (naměřeno 2026-09-15): `mode === "live" ? … : "measure"`
    // udělalo z překlepu (`Live`, `enforce`) tiše měřicí režim. Co není `live`
    // ani `measure`, projde jako syrová hodnota a derivace ho odmítne níž.
    knock_mode: profile.knock?.mode ?? "measure",
    knock_mode_deklarovan: profile.knock?.mode !== undefined,
    // Veřejné tváře aplikací mimo katalog — vedou přes mesh-ingress stacku
    // `via` (viz deriveExternalFaces). NEJSOU služby: nezaloží se jim Coolify
    // app, nemají adresy v `services` a nikdo na ně neukazuje přes depends_on.
    external_faces: deriveExternalFaces(process.env.EXTERNAL_FACES, profile, enabled, MESH),
    // Schopnost „zařízení“ (tablety s hlídačem) — VOLITELNÁ. Šablony klíč
    // nemají ⇒ undefined ⇒ vypnuto. Tvar a čtení identity: lib/zarizeni-deklarace.mjs.
    zarizeni: profile.zarizeni,
    // Rezidence dat AI (`ai.execution_mode`: local | hybrid | cloud) — kde smí
    // běžet generování a kam smí odejít otázka i s daty. Je to VLASTNOST
    // INSTANCE (RIQ: model uvnitř meshe), ne volba operátora u konzole ani
    // výchozí hodnota kódu. Nedeklarováno ⇒ prázdná proměnná ⇒ ai-chat compose
    // odmítne start s návodem (žádný tichý výklad „tedy cloud").
    ai_execution_mode: profile.ai?.execution_mode,
  };
}

// ── Sanity checks ──────────────────────────────────────────────────────────
export function checkTopology(topo) {
  const issues = [];

  // Required services must be present
  const required = ["keycloak", "core"];
  for (const r of required) {
    if (!topo.services[r]) {
      issues.push(`required service '${r}' missing from profile '${topo.profile}'`);
    }
  }

  // depends_on must resolve
  for (const [id, svc] of Object.entries(topo.services)) {
    for (const dep of svc.depends_on) {
      if (!topo.services[dep]) {
        issues.push(`'${id}' depends on '${dep}' but '${dep}' not in profile`);
      }
    }
  }

  // No duplicate URLs (would mean two services try to claim the same hostname)
  const seen = new Map();
  for (const [id, svc] of Object.entries(topo.services)) {
    for (const scope of ["internal", "public"]) {
      for (const entry of svc.urls[scope] ?? []) {
        const key = entry.url;
        if (seen.has(key) && seen.get(key) !== id) {
          issues.push(`duplicate URL '${key}' claimed by '${id}' and '${seen.get(key)}'`);
        }
        seen.set(key, id);
      }
    }
  }
  // Cizí tvář nesmí zabrat jméno služby (ani jiné cizí tváře) — edge by jedno
  // jméno routoval dvakrát a vyhrál by ten, kdo je v Caddyfile dřív.
  for (const f of topo.external_faces ?? []) {
    for (const host of [f.public_host, f.mesh_host].filter(Boolean)) {
      const owner = `external_faces.${f.id}`;
      if (seen.has(host) && seen.get(host) !== owner) {
        issues.push(`duplicate URL '${host}' claimed by '${owner}' and '${seen.get(host)}'`);
      }
      seen.set(host, owner);
    }
  }

  return issues;
}

/**
 * Brána: co manifest ZALOŽÍ, musí mít v topologii ADRESU.
 *
 * ⛔ NAMĚŘENO 2026-09-04 na produkci <fork>. Manifest jmenoval 13 aplikací,
 * topologie znala 12 služeb — a ta dvě čísla neporovnával NIKDO. `coolify-story-init.sh`
 * aplikaci podle manifestu založí, `derive-domains.mjs` jí ale odmítne dát adresu,
 * takže se nasadí s tím, co zbylo: `NETBIRD_DOMAIN=netbird.aisha.example.com` a
 * `NETBIRD_API_URL=https://` — obojí doplněné z `config/domains.env.example`.
 *
 * Ten fallback je navržená pohodlnost, která tiše vyrábí VĚROHODNĚ VYPADAJÍCÍ
 * špatné hodnoty. Prázdno by spadlo hlasitě; příklad projde až do produkce.
 *
 * Vada měla dvě patra a ani jedno nekřičelo:
 *   1. netbird má v katalogu `tier: "optional"`, takže ho `tier_filter`
 *      (required+important) zahodil i po vyškrtnutí z `exclude` — kladná
 *      deklarace v `include` je nutná (týž idiom jako `"include": ["openclaw"]`
 *      v config/profiles/local-dev.json).
 *   2. Vyloučení navíc MASKOVALO porušení závislosti: dokud netbird v topologii
 *      nebyl, neměl `checkTopology` co kontrolovat a `--check` mlčel. Po zařazení
 *      ohlásil „'netbird' depends on 'pki' but 'pki' not in profile" okamžitě.
 *
 * Kontrola vrací DVĚ různé diagnózy, protože mají různou léčbu:
 *   - služba není v KATALOGU  → přidat do config/services.json (nebo z manifestu pryč)
 *   - služba je v katalogu, ale profil ji nepustil → doplnit do `include`
 *     (typicky tier=optional), nebo vyškrtnout z `exclude`
 */
/** Ráčna uznaného dluhu; chybějící soubor = prázdná (nic se neomlouvá). */
export function manifestCoverageBaseline() {
  const p = resolve(ROOT, "src/tests/gates/manifest-coverage.baseline.json");
  if (!existsSync(p)) return { bez_katalogu: [], mimo_profil: [] };
  try {
    const d = JSON.parse(readFileSync(p, "utf8"));
    return { bez_katalogu: d.bez_katalogu ?? [], mimo_profil: d.mimo_profil ?? [] };
  } catch {
    return { bez_katalogu: [], mimo_profil: [] };
  }
}

export function checkManifestCoverage(topo, manifestText, catalogServiceIds, catalogServices) {
  const issues = [];
  const apps = [];
  for (const line of String(manifestText ?? "").split(/\r?\n/)) {
    const m = /^app:\s*([a-z0-9-]+):/.exec(line.trim());
    if (m) apps.push(m[1]);
  }
  // Prázdný manifest NENÍ „vše v pořádku" — je to nezměřený stav.
  if (apps.length === 0) return ["manifest nedeklaruje žádnou aplikaci (`app:` řádek) — není co ověřit"];

  const vKatalogu = new Set(catalogServiceIds ?? []);
  /**
   * ⛔ TÁŽ BRÁNA, KTEROU MÁ STORY-INIT I RESOLVER. `provision_when_env` říká, že
   * se aplikace zakládá jen při zapnuté lane; `coolify-story-init.sh` ji přeskočí
   * (`provision_gate_skips`, ř. 146) a resolver ji ze stejného důvodu nevydá.
   * Nezahrnout ji sem znamená hlásit jako vadu shodu tří míst.
   *
   * NAMĚŘENO 2026-09-05: bez téhle brány kontrola na cloud-multi + aisha.manifest
   * vyhlásila 9 nálezů, z nichž 4 (source-broker, local-ingest, extranet, potok)
   * byly PLANÉ — právě ty s uzavřenou lane. Skill to popisuje jako pravidlo
   * „opt-in stack replikuj na všech čtyřech místech najednou"; tohle je čtvrté.
   */
  const laneZavrena = (id) =>
    !podminkaSplnena(catalogServices?.[id]?.provision_when_env, ctiLaneTopologie(topo?.model_mesh ?? ""));
  for (const app of apps) {
    if (topo.services?.[app]) continue;
    if (laneZavrena(app)) continue;
    issues.push(
      vKatalogu.has(app)
        ? `manifest zakládá '${app}', ale profil '${topo.profile}' ho do topologie nepustil ` +
          `(tier_filter/exclude) — doplň ho do 'include', jinak zůstane BEZ adresy a spadne až u spotřebitele`
        : `manifest zakládá '${app}', ale config/services.json ho vůbec nezná ` +
          `— bez katalogové deklarace pro něj resolver nemá co odvodit`,
    );
  }
  return issues;
}

/**
 * Táž měřená skutečnost, jen roztříděná — ráčna potřebuje ID, ne věty.
 * Jeden vlastník verdiktu se sdílí s bránou i s generátorem baseline; druhá
 * implementace by se rozešla a ten rozchod by se četl jako pokrok.
 */
export function manifestCoverageOffenders(topo, manifestText, catalogServices) {
  const bezKatalogu = [];
  const mimoProfil = [];
  const laneZavrena = (id) =>
    !podminkaSplnena(catalogServices?.[id]?.provision_when_env, ctiLaneTopologie(topo?.model_mesh ?? ""));
  for (const line of String(manifestText ?? "").split(/\r?\n/)) {
    const m = /^app:\s*([a-z0-9-]+):/.exec(line.trim());
    if (!m) continue;
    const app = m[1];
    if (topo.services?.[app] || laneZavrena(app)) continue;
    (catalogServices?.[app] ? mimoProfil : bezKatalogu).push(app);
  }
  return { bezKatalogu: [...new Set(bezKatalogu)].sort(), mimoProfil: [...new Set(mimoProfil)].sort() };
}

// ── Output formatters ──────────────────────────────────────────────────────
function requireServiceDomain(topo, serviceId, scope, subdomain) {
  const service = topo.services[serviceId];
  if (!service) {
    throw new Error(`Topology missing service '${serviceId}' required for edge routing`);
  }
  const entries = service.urls?.[scope] ?? [];
  const entry = subdomain
    ? entries.find((candidate) => candidate.subdomain === subdomain)
    : entries[0];
  if (!entry?.url) {
    throw new Error(`Topology missing ${scope} domain for '${serviceId}'${subdomain ? `/${subdomain}` : ""}`);
  }
  return entry.url;
}

/**
 * Veřejná tvář služby — endpoint, na který edge posílá veřejný provoz.
 *
 * Katalog ji deklaruje jako `public_face` ({service, port}); kde chybí, je
 * veřejnou tváří `internal_url`. Rozdíl je podstatný tam, kde před službou
 * stojí oauth2-proxy (n8n-auth, openclaw-auth): služby uvnitř mesh volají
 * `internal_url` s vlastním tokenem, edge musí přes bránu.
 */
function verejnaTvar(svc) {
  return svc?.public_face ?? svc?.internal_url ?? null;
}

/**
 * Mesh-transportované lane mají DVĚ souřadnice.
 *
 * SPOJENÍ jde na primární mesh jméno služby (`<prefix><sub>.mesh.<tld>`) —
 * to je jediné jméno, pro které mesh DNS VYRÁBÍ záznam peeru (netbird-dns-
 * provision), a port veřejné tváře. HOST, podle kterého přísný mesh-ingress
 * na cílovém uzlu routuje, je jméno ENDPOINTU v zóně, když veřejná tvář sedí
 * na deklarovaný `internal_endpoint` (core: core-gateway.<zóna>), jinak
 * primární jméno samo.
 *
 * ⛔ PROČ NE `mesh-router:<port>` (stav do 2026-08-21): mesh-router uměl jen
 * DNAT dvou portů na CORE_MESH_IP. Jakmile šlo na mesh víc stacků, port 8080
 * vedl na imgproxy jádra místo na n8n (421) a `https://<jméno>` bez cesty
 * propadalo přes wildcard resolver na cizí stroj (502, cert *.evymo.com).
 * Jméno ≠ cesta: edge má od té doby routu do rozsahu peerů přes mesh-router
 * (docker-compose.coolify-prebuilt.yml) a míří JMÉNEM.
 *
 * ⛔ PROČ `http://` A NE `https://`: mesh-ingress TLS neterminuje (šifruje
 * WireGuard); `https://<jméno>` bez portu mířilo na 443, kde nikdo neposlouchá.
 */
function edgeMeshHost(topo, serviceId) {
  const svc = topo.services[serviceId];
  const face = verejnaTvar(svc);
  if (!svc || !face?.port) return null;
  const primary = (svc.urls?.internal ?? [])[0];
  const ep = (svc.internal_endpoints ?? []).find(
    (e) => Number(e.port) === Number(face.port) && e.subdomain,
  );
  if (ep) return hostZEndpointu(topo, ep, zonaZAdresy(primary));
  return primary?.url ?? null;
}

function edgeMeshUpstream(topo, serviceId) {
  const svc = topo.services[serviceId];
  const face = verejnaTvar(svc);
  const primary = (svc?.urls?.internal ?? [])[0]?.url;
  if (!svc || !face?.port || !primary) {
    throw new Error(
      `Topology missing public face for '${serviceId}' — katalog potřebuje ` +
        `public_face nebo internal_url ({service, port}) a vnitřní mesh jméno.`,
    );
  }
  return `http://${primary}:${face.port}`;
}

/**
 * Hostitelé endpointů služby v mesh zóně — pro toho, kdo jim vyrábí DNS záznamy
 * (netbird-dns-provision). Jediný domov skládání jména; provisioner si dřív
 * zónu ukrajoval sám (`domain.slice(sub.length + 1)`) a s identitou v prefixu
 * vyráběl záznamy pro jména, která nikdo nevolal.
 *
 * @returns {Array<{subdomain: string, host: string, port: number, service: string|null}>}
 */
export function meshEndpointHosts(topo, serviceId) {
  const svc = topo.services[serviceId];
  const primary = (svc?.urls?.internal ?? [])[0];
  const zone = zonaZAdresy(primary);
  if (!svc || !zone) return [];
  const out = [];
  for (const ep of svc.internal_endpoints ?? []) {
    if (!ep?.subdomain || !ep.port) continue;
    if (ep.subdomain === primary.subdomain) continue; // primární má záznam sám
    const host = hostZEndpointu(topo, ep, zone);
    if (host) out.push({ subdomain: ep.subdomain, host, port: Number(ep.port), service: ep.service ?? null });
  }
  return out;
}

/**
 * Zóna už spočítané adresy — všechno za PRVNÍ tečkou.
 *
 * ⛔ NAMĚŘENO 2026-08-12. Na třech místech stálo
 *
 *     primary.url.slice(primary.subdomain.length + 1)
 *
 * tedy „uřízni tolik znaků, kolik má jméno subdomény". To platí JEN když adresa
 * začíná přesně tou subdoménou. Jakmile `subdomain_prefix` vloží do adresy
 * identitu instance, `url` je `<projekt>-integration.backend.<tld>`, ale
 * `subdomain` zůstává `integration` — a ořez o 11+1 znaků ukousne `<projekt>-i`
 * místo `integration.`. Vzniklo tak 14 adres, které nevedou nikam:
 *
 *     maestro.integration.backend.<tld>   →  maestro.tegration.backend.<tld>
 *     …blockchain.experimental.<tld>      →  …lockchain.experimental.<tld>
 *     communications.domain-services.…    →  communications.-services.…
 *
 * Zákeřné na tom je, že se to projeví AŽ ZAPNUTÍM identity: s prázdným prefixem
 * ořez sedí na znak a všech 44 interních jmen vypadá zdravě. Kdo by tedy naplnil
 * `subdomain_prefix` (což je jediná obrana proti kolizi jmen dvou nájemníků na
 * jednom stroji), rozbil by si tím služby, které do té chvíle běžely.
 *
 * Odvození podle první tečky je na prefixu nezávislé: label vlevo může být
 * cokoli. Hlídá to brána `jmena-na-sdilene-infra-nesou-projekt.gate.test.ts`,
 * která renderuje topologii pod DVĚMA identitami a tvrdí nulový průnik.
 *
 * @param {{url?: string, subdomain?: string}|undefined} primary
 * @returns {string|null} zóna bez prvního labelu, nebo null když adresa žádný nemá
 */
function zonaZAdresy(primary) {
  const url = primary?.url;
  if (!url || !primary?.subdomain) return null;
  const tecka = url.indexOf(".");
  return tecka > 0 ? url.slice(tecka + 1) : null;
}

/**
 * Hostitel pro `internal_endpoints` položku — VČETNĚ identity instance.
 *
 * ⛔ NAMĚŘENO 2026-08-12, druhá polovina téhož nálezu jako u `zonaZAdresy`.
 * Prefix se aplikoval jen na PRIMÁRNÍ subdoménu služby (`resolveSubdomain`),
 * ne na subdomény jednotlivých endpointů. Po opravě ořezu tak 72 jmen identitu
 * neslo a 35 pořád ne — a byla to zrovna ta nejrušnější:
 * `core-gateway`, `postgrest`, `minio`, `plugin-system`, `ai-chat`, `pki-webui`…
 * Přesně ta jména, o která se dva nájemníci na jednom Traefiku perou.
 *
 * `topo.subdomain_prefix` je už znormalizovaný (`normalizeSubdomainPrefix`),
 * takže buď je prázdný, nebo končí oddělovačem. Prázdný prefix ⇒ chování
 * shodné se stavem před touhle opravou (ověřeno diffem celého renderu).
 *
 * @param {{subdomain_prefix?: string}} topo
 * @param {{subdomain?: string}} ep
 * @param {string|null} zone
 * @returns {string|null}
 */
function hostZEndpointu(topo, ep, zone) {
  if (!ep?.subdomain || !zone) return null;
  // `internal_endpoints` žijí VŽDY ve vnitřní (nebo mesh) zóně — tedy tam, kde
  // identita instance platí. Veřejná zóna sem nevstupuje.
  return `${prefixProZonu(topo, "internal")}${ep.subdomain}.${zone}`;
}

// ── Apex (bare PUBLIC_TLD) redirect contract ────────────────────────────────
// When the operator's public zone has a dedicated apex (PUBLIC_TLD) that is
// NOT the canonical web host (APP_DOMAIN), the edge proxy must answer the
// apex with an HTTP 308 redirect to https://${APP_DOMAIN}${uri}. Routers and
// labels can't be conditional, so the resolver emits EDGE_APEX_DOMAIN:
//   - apex rule applies  → EDGE_APEX_DOMAIN = PUBLIC_TLD
//   - rule doesn't apply → EDGE_APEX_DOMAIN = unroutable sentinel (.invalid,
//     RFC 6761) so the static router exists but never matches (same pattern
//     as the mesh-router/netbird sentinels). Community installs where the
//     web app itself serves the apex (APP_DOMAIN == PUBLIC_TLD) or where no
//     PUBLIC_TLD is declared stay unaffected.
export const APEX_REDIRECT_DISABLED_SENTINEL = "apex-redirect-disabled.invalid";

export function normalizeApexMode(value) {
  const mode = String(value ?? "redirect").trim().toLowerCase();
  if (["serve", "web", "spa"].includes(mode)) return "serve";
  return "redirect";
}

export function deriveApexRedirect(publicTld, appDomain, apexMode = "redirect") {
  const apex = String(publicTld ?? "").trim();
  const app = String(appDomain ?? "").trim();
  const mode = normalizeApexMode(apexMode);
  const enabled = mode === "redirect" && Boolean(apex) && Boolean(app) && apex !== app;
  return {
    enabled,
    mode,
    apexDomain: enabled ? apex : APEX_REDIRECT_DISABLED_SENTINEL,
    redirectTarget: enabled ? app : "",
  };
}

/** Resolve the apex redirect contract from a built topology. */
export function apexRedirectFromTopology(topo) {
  // The canonical web host is the edge service's primary public URL
  // (canonical_scope: "public" → urls.public[0]); fall back gracefully when
  // a profile has no edge/web public face (apex rule then disabled).
  const edge = topo.services?.edge;
  const appDomain = edge?.urls?.public?.[0]?.url ?? "";
  return deriveApexRedirect(topo.public_tld, appDomain, process.env.AISHA_WEB_APEX_MODE);
}

export function formatShellExports(topo) {
  const lines = [];
  lines.push(`# AISHA topology — generated by scripts/lib/derive-domains.mjs`);
  lines.push(`# Profile: ${topo.profile}`);
  lines.push(`# Mesh:    ${topo.mesh_enabled ? "ON" : "OFF"}`);
  lines.push(`AISHA_PROFILE=${topo.profile}`);
  // Jméno instance jako BUILD ARG — extranet z něj vybírá svůj overlay
  // (`services.extranet.build.args.INSTANCE_DIR`, `${AISHA_INSTANCE:?…}`).
  //
  // Vznikalo dosud jen uvnitř heredocu v aisha-cold-start.sh, tedy až ve chvíli
  // zápisu env pro jednu app. Compose preflight ale interpoluje proti
  // .env.coolify, takže tam hodnota nebyla a CELÝ cold-start se zastavil na
  // „required variable AISHA_INSTANCE is missing a value" (změřeno 2026-07-30).
  //
  // NENÍ to profil. `AISHA_INSTANCE` pojmenovává ADRESÁŘ OVERLAYE, ze kterého se
  // staví obraz (`instances/<jméno>/app.config.json`), kdežto profil je TVAR BĚHU
  // (cloud-multi / cloud-single / local-dev). Dosadit jedno za druhé vyrobí cestu,
  // která nemůže existovat — leda by si někdo instanci pojmenoval po profilu.
  //
  // ZMĚŘENO 2026-08-10: dřívější `|| topo.profile` dalo `AISHA_INSTANCE=cloud-multi`
  //   → INSTANCE_DIR=instances/cloud-multi
  //   → build workbench-shellu: ENOENT /app/instances/cloud-multi/app.config.json
  //   → aisha-extranet se nenasadil → vlna 4 vypršela.
  // Deterministicky, takže to opakování nemohlo zachránit — jen spálilo sloty.
  //
  // Repo veze jen generický `instances/_default` (potvrzuje brána split-rule:
  // „no tenant overlay under instances/"). Nemá-li instance vlastní overlay, je
  // `_default` SPRÁVNÁ odpověď — a je to táž hodnota, kterou už nese
  // `deploy/surface-host/Dockerfile:20` (`ARG INSTANCE_DIR=instances/_default`).
  // Compose ten rozumný default přebíjel odvozeninou, která neexistuje.
  // ⛔ NAMĚŘENO 2026-08-22: tady stálo `|| "_default"` a byl to KOŘEN vady, ne
  // pojistka. Úvaha z 08-10 zněla „nemá-li instance vlastní overlay, je
  // `_default` správná odpověď" — jenže znala jen overlaye v upstream stromu
  // (`instances/`). Kanál z INSTANČNÍHO REPA (SURFACE_OVERLAY_*) přibyl potom,
  // takže od té chvíle instance overlay MĚLA a `_default` ji přesto přebilo.
  //
  // Výstup derivace se sourcuje do prostředí PŘED heredocem cold-startu, takže
  // dosazená hodnota putovala dál, jako by ji někdo deklaroval. Povrch se pak
  // postavil z referenční šablony (cizí IdP, cizí client_id). Nic nespadlo —
  // vada se poznala až očima, na přihlašovací obrazovce.
  //
  // `_default` NENÍ odpověď, je to přiznání, že nevíme. Nevíme-li, řádek se
  // nevydá a compose skončí na `${AISHA_INSTANCE:?}` — hlasitě a hned.
  // ⛔ `_default` se ČTE JAKO NEDEKLAROVÁNO. Je to jméno referenční šablony,
  // ne instance — a hlavně: `AISHA_INSTANCE` je VÝSTUP téhle derivace, který
  // se přes `.env.coolify` vrací zpátky na vstup. Přijmout ho znamená číst
  // vlastní minulé dosazení jako cizí deklaraci, takže by se `_default`
  // udrželo navěky i po opravě (naměřeno 2026-08-22: prostředí ho neslo dál
  // a env-doctor kvůli tomu hledal surfaces/_default).
  // Jména se čtou DOSLOVA přes `process.env.X`, ne přes `process.env[klic]`:
  // seznam RESOLVER_ENV_INPUTS se ověřuje proti tomu, co je v kódu vidět, a
  // nepřímé čtení by z deklarovaného vstupu udělalo „deklarované, ale nečtené".
  const bezSablony = (v) => {
    const t = (v ?? "").trim();
    return t === "_default" ? "" : t;
  };
  const identitaInstance =
    bezSablony(process.env.AISHA_INSTANCE) ||
    bezSablony(process.env.APP_NAME_PREFIX) ||
    (topo.app_name_prefix ?? "").trim();
  if (identitaInstance) lines.push(`AISHA_INSTANCE=${identitaInstance}`);
  // Prefix ZÁKAZNÍKA — identita instance, ne vlastnost jedné app. Profil ho už
  // nese (`app_name_prefix`), jen se dosud nevydával, takže si ho konzumenti
  // museli shánět sami: `config/local-presets.mjs` sahalo po
  // `process.env.APP_NAME_PREFIX || "local"` — literál v platformě, přestože
  // profil totéž jméno deklaruje o patro výš.
  //
  // Pořadí zdrojů jako u serviceAliasPrefix(): proměnná PŘEBÍJÍ, profil
  // DEKLARUJE, a chybí-li obojí, nevydá se NIC — ať to spadne na
  // `${APP_NAME_PREFIX:?…}` v compose, kde je vidět, co se nenakonfigurovalo.
  //
  // ⚠️ Dosadit sem `topo.profile` by bylo lákavé a špatné — a přesně to je
  // důvod, proč o řádek výš stojí `_default` a ne profil: id profilu je TYP
  // NASAZENÍ (local-dev, cloud-single), ne jméno zákazníka ani adresář overlaye.
  // TÝŽ výraz jako `identitaInstance` výš — schválně ne druhá kopie řetězu.
  // O tři odstavce výš je zapsané, co se stane, když má jedna veličina dvě
  // odvození: rozejdou se, jedno je naplněné a druhé ne.
  if (identitaInstance) lines.push(`APP_NAME_PREFIX=${identitaInstance}`);
  // Hostitelská cesta drop lane — SDÍLENÝ inbox mezi local-ingest (zapisuje
  // bundly) a svc-source-broker (čte je). Oba compose ji bindují, takže musí
  // souhlasit na znak.
  //
  // Dřív stála v obou compose NATVRDO jako `/srv/aisha/drop/local-ingest` —
  // tedy cizí instanční jméno v generickém kódu (7 výskytů ve 4 souborech).
  // Odvozuje se proto z identity instance: dvě instance na jednom stroji si
  // pak nešlapou do stejného inboxu, a v compose nezůstává žádné jméno.
  lines.push(
    `LOCAL_INGEST_DROP_HOST_DIR=${
      process.env.LOCAL_INGEST_DROP_HOST_DIR?.trim() ||
      `/srv/${identitaInstance}/drop/local-ingest`
    }`,
  );
  lines.push(`MESH_ENABLED=${topo.mesh_enabled}`);
  lines.push(`PUBLIC_TLD=${topo.public_tld}`);
  lines.push(`INTERNAL_TLD=${topo.internal_tld}`);
  lines.push(`MESH_TLD=${topo.mesh_tld}`);
  // ── Modelový mesh forku (varianta C) ──────────────────────────────────────
  // Lane vychází VŽDY (prázdná = instance modelový mesh nemá) — doktor ji tak
  // jako `derived` smíří i ve chvíli, kdy model z GPU slotu odejde.
  lines.push(`MODEL_MESH=${topo.model_mesh ?? ""}`);
  if (topo.model_mesh) {
    // Mesh SÁM je vnitřní (majitel přes infra 2026-10-05): jména peerů a DNS
    // doména nikdy pod veřejnou zónou, jen pod mesh zónou instance.
    lines.push(`NETBIRD_MODEL_DNS_DOMAIN=model.${topo.mesh_tld}`);
    // Uzel na GPU slotu se do modelového meshe zapisuje přes VEŘEJNÝ vstup
    // (edge forku, TCP 443) — do hlavního meshe nepatří, jinou cestu nemá.
    const verejna = topo.services?.["netbird-model"]?.urls?.public?.[0]?.url;
    if (!verejna) {
      throw new Error(
        `[derive-domains] model forku stojí na slotu '${topo.model_mesh}' (modelový mesh), ` +
        "ale řídicí rovina `netbird-model` nemá veřejné jméno — profil ji do topologie nepustil " +
        "(tier_filter/exclude). Bez ní se uzel na GPU slotu nemá kam zapsat.",
      );
    }
    lines.push(`MODEL_MESH_MANAGEMENT_URL=https://${verejna}:443`);
    // Jména peerů modelového meshe — JEDEN zdroj pro obě strany: bootstrap je čte
    // jako deklarovanou identitu (rada cb P1: ve skupině uzlu PRÁVĚ JEDEN peer s tímto
    // jménem, jinak STOP), tenký stack na GPU slotu a most je nesou jako NB_HOSTNAME.
    // Bez identity instance by jméno nerozlišilo forky na sdíleném uzlu → selhat.
    if (!identitaInstance) {
      throw new Error("[derive-domains] modelový mesh potřebuje identitu instance (APP_NAME_PREFIX) — z ní je jméno peeru uzlu");
    }
    lines.push(`MODEL_MESH_GPU_PEER=${identitaInstance}-model`);
    lines.push(`MODEL_MESH_MOST_PEER=${identitaInstance}-model-most`);
    // Port, na který most smí do uzlu (jediná politika meshe) = vnitřní port modelu z katalogu.
    const portModelu = topo.services?.model?.internal_url?.port;
    if (!portModelu) {
      throw new Error("[derive-domains] modelový mesh bez portu modelu — služba `model` není v topologii nebo nemá internal_url.port");
    }
    lines.push(`MODEL_MESH_PORT=${portModelu}`);
    // Vstup lane nájemce na síti `<prefix>-lane` (tenký stack: LANE_KLIENT_UPSTREAM). IP, ne jméno
    // (DNS Dockeru by jméno řešil přes všechny sítě agenta); deklaruje ji profil instance podle
    // deklarace GPU uzlu. Upstream žádnou adresu nezná — bez deklarace by tenký stack neměl kam.
    const vstup = topo.lane_gpu?.vstup_url ?? "";
    if (!/^http:\/\/(10\.\d{1,3}|172\.(1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}:\d{1,5}$/.test(vstup)) {
      throw new Error(
        `[derive-domains] model forku stojí na slotu '${topo.model_mesh}' (modelový mesh), ale profil instance nedeklaruje ` +
          "vstup lane (`lane_gpu.vstup_url` = http://<privátní IP vstupu na síti nájemce>:<port>) — tenký stack by neměl kam předávat",
      );
    }
    lines.push(`LANE_VSTUP_URL=${vstup}`);
    // Vlastník uzlu: síť nájemce `<vlastník>-lane-<prefix>` je v JEHO jmenném prostoru (zakládá ji
    // compose vstupu lane operátora). Bez deklarace by tenký stack nevěděl, ke které síti patří.
    const vlastnik = topo.lane_gpu?.vlastnik ?? "";
    if (!/^[a-z][a-z0-9-]{1,30}$/.test(vlastnik)) {
      throw new Error(
        `[derive-domains] model forku stojí na slotu '${topo.model_mesh}' (modelový mesh), ale profil instance nedeklaruje ` +
          "vlastníka GPU uzlu (`lane_gpu.vlastnik` = `vlastnik` z deklarace uzlu) — tenký stack by neznal jméno své sítě",
      );
    }
    lines.push(`LANE_VLASTNIK=${vlastnik}`);
  }
  lines.push(`AISHA_WEB_APEX_MODE=${normalizeApexMode(process.env.AISHA_WEB_APEX_MODE)}`);
  lines.push(`SERVICE_ALIAS_PREFIX=${serviceAliasPrefix()}`);
  // SHARED_REDIS_HOST se tu UŽ NEVYDÁVÁ. Do 2026-08-22 tu stál zvláštní řádek,
  // který skládal alias na sdílené síti — a byl to druhý domov téže adresy vedle
  // katalogu. Dnes ho vydává `internal_tcp_endpoints[].env_aliases` u služby
  // `shared-redis` jako MESH jméno, tedy toutéž dráhou jako každou jinou vnitřní
  // adresu: jeden zdroj, a adresa patří jednomu peeru.
  // Dveře berou roster schválených tabletů z brány? Rozhoduje blok dveří níž,
  // adresa se skládá až na konci (potřebuje adresu brány z katalogu).
  let rosterTabletu = false;
  // Které compose profily edge stacku jsou zapnuté. `coolify-deploy-init.sh`
  // z toho skládá `COMPOSE_PROFILES` edge aplikace, takže rozhodnutí „instance
  // chce vrátného" nemusí nikdo exportovat rukou při každém běhu — jede toutéž
  // dráhou jako zbytek topologie (cold-start → .env.coolify → deploy-init).
  //
  // Vadný zápis SHODÍ derivaci. Tichý přeskok by vyrobil stack, kde vrátný
  // prostě není, a nikde by nestálo proč — a přesně u fail-closed služby je
  // „nenasadila se" nerozeznatelné od „běží a nic nepouští".
  //
  // A hlavně: jméno se ověřuje proti TOMU, co edge compose zná. Překlep by
  // jinak prošel celou dráhou bez jediného slova — `COMPOSE_PROFILES=knok`
  // docker mlčky přijme, nespustí nic, a výsledek je k nerozeznání od stavu
  // „vrátný běží a nikoho nepouští". Přesně to je třída vad, kterou fail-closed
  // služba sama o sobě neumí ohlásit.
  {
    const known = edgeComposeProfiles();
    const unknown = topo.edge_profiles.filter((p) => !known.has(String(p)));
    if (unknown.length > 0) {
      throw new Error(
        `profil instance deklaruje edge_profiles, které ${EDGE_COMPOSE_FILE} nezná: ` +
          `${unknown.join(", ")} — zná ${[...known].sort().join(", ") || "(žádné)"}`,
      );
    }
    // Režim dveří patří dveřím. `knock.mode` bez `knock` v edge_profiles je
    // deklarace, která nic neřídí — a přesně z takové vznikl rozpor „měřicí
    // režim + roster" (lib/dvere-soulad.mjs). Neznámý režim totéž: tichý
    // pád na `measure` by vypnul ostrý provoz, o kterém někdo rozhodl.
    if (!["live", "measure"].includes(String(topo.knock_mode))) {
      throw new Error(
        `profil instance deklaruje knock.mode="${topo.knock_mode}" — platné je jen "live" nebo "measure"`,
      );
    }
    if (topo.knock_mode_deklarovan && !topo.edge_profiles.map(String).includes(PROFIL_DVERI)) {
      throw new Error(
        `profil instance deklaruje knock.mode, ale edge_profiles nejmenuje "${PROFIL_DVERI}" — ` +
          `režim dveří bez dveří nic neřídí; buď edge_profiles: ["${PROFIL_DVERI}"], nebo knock.mode odeber`,
      );
    }
    lines.push(`EDGE_COMPOSE_PROFILES=${topo.edge_profiles.join(",")}`);
    // `SPA_DIAGNOSE=1` je MĚŘICÍ režim: služba odmítne start s operátory, takže
    // strukturálně nemůže nic otevřít. Výchozí je proto měření — instance, která
    // chce ostrý provoz, si o něj řekne v profilu.
    lines.push(`SPA_DIAGNOSE=${topo.knock_mode === "live" ? "0" : "1"}`);
    // Adresa verdiktu dveří pro edge — ODVOZENÁ s identitou instance (alias
    // držitele netns), ne `preservedValue` s holým výchozím jménem. Bez dveří
    // prázdná: edge pak nemá co zavřít a řekne to nahlas. Bez identity derivace
    // skončí (knockUpstream) — holé jméno se nedosazuje.
    const dvere = topo.edge_profiles.map(String).includes(PROFIL_DVERI);
    lines.push(`KNOCK_UPSTREAM=${dvere ? knockUpstream(topo.app_name_prefix) : ""}`);
    // Roster SCHVÁLENÝCH tabletů si dveře berou z brány — jen OSTRÉ dveře
    // (v měřicím režimu svc-knock roster z adresy odmítne). Adresa se skládá
    // až na konci, kde je adresa brány spočtená (viz níž).
    rosterTabletu = dvere && topo.knock_mode === "live";
  }

  // Rezidence dat AI → AISHA_EXECUTION_MODE (čte @aisha/llm-dispatch: v `local`
  // registr cloudový backend vůbec nezaregistruje). Neznámá hodnota derivaci
  // shodí — překlep (`Local`, `lokal`) by jinak tiše znamenal cloud.
  if (topo.ai_execution_mode !== undefined && !REZIMY_AI.includes(String(topo.ai_execution_mode))) {
    throw new Error(
      `profil instance deklaruje ai.execution_mode="${topo.ai_execution_mode}" — platné je jen ${REZIMY_AI.map((r) => `"${r}"`).join(", ")}`,
    );
  }
  lines.push(`AISHA_EXECUTION_MODE=${topo.ai_execution_mode ?? ""}`);

  // Surfaces — emitted in the exact CSV shape provision-surfaces.sh already
  // parses (`surface:shell:subdomain`), so the declaration has ONE home (the
  // profile) and the provisioner keeps its existing contract.
  //
  // SURFACE_ORIGINS is the reason this is here rather than in an operator env:
  // config/domains.env composes ALLOWED_ORIGINS from APP_DOMAIN +
  // API_DOMAIN_PUBLIC + API_DOMAIN, none of which is a surface. Every surface
  // is a browser origin calling that same API, so leaving it out means the CORS
  // preflight rejects the app the instance was built to serve. Derived here, it
  // cannot drift from what the provisioner actually creates.
  /** Overlay povrchu, je-li k dispozici — porovná se s derivací na konci funkce. */
  let overlayPovrchu = null;
  if (Array.isArray(topo.surfaces) && topo.surfaces.length > 0) {
    const triples = [];
    const origins = [];
    for (const [i, s] of topo.surfaces.entries()) {
      // A malformed declaration THROWS instead of being skipped. Skipping it
      // would produce a stack whose extranet simply does not exist, with no
      // line anywhere saying why — which is how this whole class of defect
      // stays invisible until someone opens the app. The declaration is three
      // fields; getting one wrong is a configuration error, not a variant.
      const missing = ["name", "shell", "subdomain"].filter((k) => !s?.[k]);
      if (missing.length > 0) {
        throw new Error(
          `profile surfaces[${i}] is missing ${missing.join(", ")} — ` +
            `each surface needs name + shell + subdomain (got ${JSON.stringify(s)})`,
        );
      }
      triples.push(`${s.name}:${s.shell}:${s.subdomain}`);
      origins.push(`https://${s.subdomain}.${topo.public_tld}`);
    }
    if (triples.length > 0) {
      lines.push(`AISHA_SURFACES=${triples.join(",")}`);
      lines.push(`SURFACE_ORIGINS=${origins.join(",")}`);
      // KDE v instančním repu leží konfigurace povrchu (`app.config.json`).
      //
      // ⛔ NAMĚŘENO 2026-08-22 v prohlížeči majitele: extranet přesměrovával na
      // `https://idp.example.invalid/realms/main` s `client_id=surface-shell`.
      // To jsou hodnoty z `instances/_default/app.config.json`, tedy REFERENČNÍ
      // ŠABLONY — instanční overlay se do buildu nikdy nedostal, protože
      // `SURFACE_OVERLAY_PATH` nikdo nevydával a `AISHA_INSTANCE` spadlo
      // fallbackem na `_default`. Povrch tak měl cizí IdP a nešel přihlásit;
      // NIC přitom nespadlo — vada se pozná až očima, na přihlašovací obrazovce.
      //
      // Cesta je IDENTITA instance, takže nemá a nesmí mít výchozí hodnotu —
      // vestavěný default by tiše nasadil povrch cizí instance (týž důvod,
      // proč ho nemá ani Dockerfile).
      // Jmeno instance se BERE Z RETEZU IDENTITY, nedosazuje se z profilu:
      // profil je TVAR BEHU (cloud-multi/cloud-single), jmeno instance je jina
      // velicina. Dosadit jedno za druhe je presne vada, kterou drzi brana
      // profil-neni-instance. Ze u teto instance obe jmena souhlasi, je shoda
      // pojmenovani, ne pravidlo -- a takova shoda je nejtissi ze vsech opor.
      //
      // Retez ma jednoho vlastnika (lib/coolify-instance-scope.mjs) a sem
      // dotece jako AISHA_STORY. Nedeklarovana identita nevyrobi zadny radek:
      // at radeji compose spadne na `${AISHA_INSTANCE:?}`, nez aby se povrch
      // TISE postavil z referencni sablony.
      const instanceName = identitaInstance;
      if (instanceName) {
        // Deklarovana instance BEZ vlastniho povrchu je rozpustena instance.
        // Overuje se proti overlayi, protoze `surfaces/<jmeno>` je domenka,
        // dokud ji nekdo neporovna se skutecnym stromem instancniho repa.
        const overlayRoot = overlayDirOrRequired("derive-domains: overlay povrchu");
        if (overlayRoot) {
          const surfaceCfg = resolve(overlayRoot, "surfaces", instanceName, "app.config.json");
          if (!existsSync(surfaceCfg)) {
            throw new Error(
              `instance '${instanceName}' deklaruje povrchy, ale v instancnim repu ` +
                `neni surfaces/${instanceName}/app.config.json (hledano: ${surfaceCfg}).\n` +
                `  Bez nej by se povrch postavil z instances/_default, tedy z REFERENCNI ` +
                `SABLONY -- s cizim IdP a cizim client_id. Nic by nespadlo a vada by se ` +
                `poznala az na prihlasovaci obrazovce (nameren 2026-08-22).\n` +
                `  Zaloz surfaces/${instanceName}/app.config.json v instancnim repu, nebo ` +
                `odeber povrchy z profilu.`,
            );
          }
          // Existence nestačí: soubor nese adresu API, issuer a client_id jako
          // LITERÁLY a build je čte doslova. S derivací se porovnají až nad
          // HOTOVÝM výstupem (konec funkce) — API_DOMAIN_PUBLIC a
          // KEYCLOAK_DOMAIN_PUBLIC tady ještě vydané nejsou.
          let config;
          try {
            config = JSON.parse(readFileSync(surfaceCfg, "utf8"));
          } catch (e) {
            throw new Error(`overlay povrchu ${surfaceCfg} není čitelný JSON: ${e.message}`);
          }
          overlayPovrchu = { config, soubor: surfaceCfg, povrchy: topo.surfaces };
        }
        lines.push(`SURFACE_OVERLAY_PATH=surfaces/${instanceName}`);
      }
    }
  }

  // ── Veřejné tváře webu → origins pro CORS ──────────────────────────────────
  //
  // ⛔ NAMĚŘENO 2026-08-11 na nasazené instanci. `corp.<public_tld>` servíroval
  // SPA a API mu odmítalo VŠECHNO — osm RPC na CORS preflightu. Prohlížeč ukázal
  // prázdnou stránku: HTTP 200, žádná chyba, jen nic. `curl -I` tam neměří nic.
  //
  // Příčina: `AISHA_WEB_PUBLIC_ALIASES` se promítne do `docker_compose_domains`
  // (Coolify tedy alias SMĚRUJE), ale `ALLOWED_ORIGINS` se v config/domains.env
  // skládá z APP_DOMAIN + API + AUTH + SURFACE_ORIGINS — a alias mezi nimi není.
  // Dva seznamy téhož a nic je neporovnávalo.
  //
  // ⭐ TÁŽ TŘÍDA POTŘETÍ, DRUHÝM KANÁLEM. 2026-07-28 se to stalo povrchům:
  // „the surface's public hostname was likewise underived, ALLOWED_ORIGINS never
  // contained it" (komentář v aisha-cold-start.sh u kroku 5c). Opravilo se to
  // TEHDY — emisí SURFACE_ORIGINS pár řádků výš. Aliasy webu zůstaly stranou.
  //
  // ⚠️ Ruční doplnění do .env.coolify NEPŘEŽIJE: hodnota je ODVOZENÁ a první
  // regenerace ji smaže (ověřeno — po `aisha-redeploy.mjs` byl alias zase pryč).
  // Brána `cors-allowlist-is-generated` navíc ruční hostname přímo zakazuje.
  // Odvození patří sem, kde ty tváře vznikají.
  //
  // Rozsah je ZÁMĚRNĚ úzký: jen služby, které v katalogu deklarují
  // `public_aliases_env`, tedy „mám víc veřejných webových tváří". Vysypat sem
  // všechny veřejné hosty by do CORS pustilo i mcp/dirigent/live — služby, ne
  // prohlížečové původy.
  {
    const katalog = loadCatalog();
    const webOrigins = [];
    for (const [id, svc] of Object.entries(topo.services)) {
      if (!katalog.services?.[id]?.public_aliases_env) continue;
      for (const e of svc.urls?.public ?? []) if (e?.url) webOrigins.push(`https://${e.url}`);
    }
    const unikatni = [...new Set(webOrigins)];
    if (unikatni.length > 0) lines.push(`WEB_ALIAS_ORIGINS=${unikatni.join(",")}`);
  }

  // OAuth2 Proxy cookie + whitelist domains (per profile, optionally per server).
  // Compose files reference ${OAUTH2_COOKIE_DOMAINS} and ${OAUTH2_WHITELIST_DOMAINS}
  // which are emitted here. For cloud-multi with per-server overrides, services
  // running on a specific server can use ${OAUTH2_COOKIE_DOMAINS_<SERVER>}.
  if (topo.oauth2?.cookie_domains) {
    lines.push(`OAUTH2_COOKIE_DOMAINS=${topo.oauth2.cookie_domains}`);
  }
  if (topo.oauth2?.whitelist_domains) {
    lines.push(`OAUTH2_WHITELIST_DOMAINS=${topo.oauth2.whitelist_domains}`);
  }
  if (topo.oauth2_cookie_domains_per_server) {
    for (const [server, domains] of Object.entries(topo.oauth2_cookie_domains_per_server)) {
      lines.push(`OAUTH2_COOKIE_DOMAINS_${server.toUpperCase()}=${domains}`);
    }
  }

  // Edge proxy route contract. Public-mode upstreams target the canonical
  // internal hostnames derived from the service catalog/profile; mesh-mode
  // upstreams target the edge mesh-router service declared by the same catalog.
  lines.push(`MCP_UPSTREAM_PUBLIC=https://${requireServiceDomain(topo, "orchestration", "internal", "n8n")}`);
  lines.push(`API_UPSTREAM_PUBLIC=https://${requireServiceDomain(topo, "core", "internal", "api")}`);
  lines.push(`DIRIGENT_UPSTREAM_PUBLIC=https://${requireServiceDomain(topo, "orchestration", "internal", "n8n")}`);
  // AUTH upstream is DIRECT (non-mesh) in BOTH modes: mesh enrollment itself
  // depends on Keycloak, so auth cannot depend on mesh (chicken-and-egg — a
  // downed mesh must never take the public auth face with it; incident
  // 2026-07-16: mesh-overlaid AUTH_UPSTREAM made pki→netbird→mesh→ALL public 404
  // a deadlock because KC bootstrap needed the very mesh that needed KC).
  //
  // DIRECT has two shapes, by co-location — the same rule as PKI_BRIDGE_URL and
  // KEYCLOAK_INTERNAL_URL below, for the same reason: on one node the
  // backend-Traefik host https://auth.<placement>.<internal> resolves NOWHERE
  // inside a container (measured 2026-07-28 from edge-proxy: NXDOMAIN, edge
  // answered 502 and netbird-management crash-looped on OIDC discovery), while
  // the shared-network alias answers 200. Same node ⇒ plain-HTTP alias (the
  // docker network is the trust boundary — layers principle, 2026-07-20);
  // split fleet ⇒ backend-Traefik direct host for the cross-node hop.
  const authUpstreamDirect = (() => {
    const bindings = topo.server_bindings ?? {};
    const kcPlacement = topo.services.keycloak?.placement;
    const edgePlacement = topo.services.edge?.placement;
    if (kcPlacement && edgePlacement) {
      const kcNode = bindings[kcPlacement] ?? kcPlacement;
      const edgeNode = bindings[edgePlacement] ?? edgePlacement;
      if (kcNode === edgeNode) {
        const prefix = appNamePrefixOrWarn(topo, "AUTH_UPSTREAM_MESH");
        if (prefix) return `http://${prefix}-keycloak:80`;
      }
    }
    return `https://${requireServiceDomain(topo, "keycloak", "direct", "auth")}`;
  })();
  lines.push(`AUTH_UPSTREAM_PUBLIC=${authUpstreamDirect}`);
  // live.${PUBLIC_TLD} (ws-gateway realtime fabric). Edge fronts the public
  // host and proxies to the canonical internal domain over backend Traefik —
  // exactly like auth/api. ws-gateway speaks WebSocket; both proxy hops
  // (edge Caddy + backend Traefik) upgrade WS natively. Guarded: realtime is
  // tier:optional, absent from cloud-single/local-dev — requireServiceDomain
  // would throw, so only emit when the service is actually in the topology.
  if (topo.services.realtime) {
    lines.push(`LIVE_UPSTREAM_PUBLIC=https://${requireServiceDomain(topo, "realtime", "internal", "live")}`);
  }
  // extra.${PUBLIC_TLD} (customer extranet surface). The extranet is its OWN
  // container/compose — edge only ROUTES its public host, exactly like api/auth.
  // Before 2026-07-29 it carried the public domain itself, bypassing edge, and
  // sat outside every stack registry: nothing deployed it and it stood on a
  // commit from the previous night while three PRs merged past it.
  // Guarded like realtime: tier:optional, absent from profiles that ship no
  // extranet — requireServiceDomain would throw.
  if (topo.services.extranet && topo.public_tld) {
    lines.push(`EXTRANET_DOMAIN_PUBLIC=${topo.subdomain_prefix}extra.${topo.public_tld}`);
    lines.push(`EXTRANET_UPSTREAM_PUBLIC=https://${requireServiceDomain(topo, "extranet", "internal", "extra")}`);
    // Mesh lane: oauth2-proxy na edge (extranet-auth) k povrchu chodí JMÉNEM
    // přes mesh, stejně jako ostatní lane. Naměřeno 2026-08-21: s veřejným
    // tvarem `https://<jméno>` bez cesty končilo každé přihlášení 502 na
    // certifikátu cizí instance (wildcard resolver).
    lines.push(`EXTRANET_UPSTREAM_MESH=${edgeMeshUpstream(topo, "extranet")}`);
  }
  // Mesh lane: SPOJENÍ na primární mesh jméno + port veřejné tváře (plain HTTP,
  // viz edgeMeshUpstream). Katalog říká, KTERÝ endpoint je veřejná tvář
  // (`public_face`: n8n-auth:4180 před n8n, gateway:3001 v jádru).
  lines.push(`MCP_UPSTREAM_MESH=${edgeMeshUpstream(topo, "orchestration")}`);
  lines.push(`API_UPSTREAM_MESH=${edgeMeshUpstream(topo, "core")}`);
  lines.push(`DIRIGENT_UPSTREAM_MESH=${edgeMeshUpstream(topo, "orchestration")}`);
  // Host pro mesh lane (viz edgeMeshHost): mesh-ingress na cílovém uzlu přijímá
  // jen <endpoint>.<zóna> — spojení s Hostem hopu ("mesh-router") dostalo 421
  // a JEDINÝ veřejný datový vstup instance zhasl (změřeno 2026-07-29:
  // api.<instance> 421 na všem po prvním deployi přísného ingressu).
  const apiMeshHost = edgeMeshHost(topo, "core");
  if (apiMeshHost) lines.push(`API_MESH_HOST=${apiMeshHost}`);
  const dirigentMeshHost = edgeMeshHost(topo, "orchestration");
  if (dirigentMeshHost) lines.push(`DIRIGENT_MESH_HOST=${dirigentMeshHost}`);
  // Auth intentionally stays on Keycloak's DIRECT (non-mesh) URL in both modes:
  // mesh enrollment itself depends on Keycloak, so auth cannot depend on mesh.
  // (The previous "internal" scope was mesh-overlaid under MESH_ENABLED=true,
  // silently violating this invariant — the 2026-07-16 auth↔mesh deadlock.)
  // Same co-location shape as AUTH_UPSTREAM_PUBLIC above — see that comment.
  lines.push(`AUTH_UPSTREAM_MESH=${authUpstreamDirect}`);
  // KEYCLOAK_DOMAIN_DIRECT — the mesh-independent backend-Traefik host for KC.
  // Consumed by docker-compose.coolify-keycloak.yml's Traefik router so the
  // direct host is actually served (with a LE cert) even when the canonical
  // KEYCLOAK_DOMAIN is mesh-overlaid. With mesh off it equals KEYCLOAK_DOMAIN.
  lines.push(`KEYCLOAK_DOMAIN_DIRECT=${requireServiceDomain(topo, "keycloak", "direct", "auth")}`);
  // NETBIRD_DOMAIN_DIRECT — týž vzor jako KEYCLOAK_DOMAIN_DIRECT a ze stejného
  // důvodu, jen o jednu službu vedle.
  //
  // ⛔ NAMĚŘENO 2026-08-25. `NETBIRD_DOMAIN` je VEŘEJNÉ jméno
  // (netbird.<PUBLIC_TLD>) a `NETBIRD_API_URL` se z něj skládá. Jenže veřejnou
  // zónu posílá edge (pfSense/HAProxy) na uzel EDGE, zatímco netbird bydlí
  // u pki — na jiném uzlu. Změřeno: `netbird.<PUBLIC_TLD>/api/peers` přes giah
  // přímo → 401 (API běží, chce token), touž adresou veřejnou cestou → 404.
  //
  // Následek: `netbird-peer-discover.mjs` nedosáhl na API, `CORE_MESH_IP`
  // zůstalo prázdné, a pojistka v aisha-redeploy správně ODMÍTLA nasadit edge
  // („mesh-router s DNAT bez cíle → api 502"). Mesh tedy stála, ale nešla
  // změřit — a bez toho měření se nesmí otevřít veřejná tvář.
  //
  // Přímé jméno leží v zóně, kterou edge SMĚRUJE na uzel služby, takže
  // operátorské nástroje (discovery, doktor) na API dosáhnou bez ohledu na to,
  // kde služba bydlí. Trasa mesh-ingressu ho ostatně už vyjmenovává jako
  // přijímaný Host — chybělo jen jméno, kterým se dá zavolat.
  // Guarded na přítomnost služby — netbird je tier:optional a v profilech bez
  // mesh (local-dev) v topologii NENÍ. Neguarded `requireServiceDomain` tam
  // shodil CELOU derivaci ("Topology missing service netbird"), takže si
  // local-presets nedokázal odvodit ani APP_NAME_PREFIX a lokální generátor
  // přestal fungovat. Táž ochrana, jakou má realtime i extranet o pár řádků níž.
  if (topo.services.netbird) {
    lines.push(`NETBIRD_DOMAIN_DIRECT=${requireServiceDomain(topo, "netbird", "direct", "netbird")}`);
  }
  // NETBIRD_MODEL_DOMAIN_DIRECT — týž vzor pro řídicí rovinu MODELOVÉHO meshe forku
  // (varianta C): edge-proxy jde na přímou tvář netbird-model-proxy (veřejná zóna míří na
  // uzel edge, řídicí rovina bydlí u keycloaku), doktor domén ji registruje. Jen když
  // je řídicí rovina v topologii (lane MODEL_MESH).
  if (topo.services["netbird-model"]) {
    lines.push(`NETBIRD_MODEL_DOMAIN_DIRECT=${requireServiceDomain(topo, "netbird-model", "direct", "mesh-model")}`);
  }
  // realtime: mesh lane míří JMÉNEM na ingress stacku (ws přes mesh; Caddy
  // upgrade zvládne na obou hopech). Do 2026-08-21 tu stálo `https://<jméno>`
  // bez portu a bez cesty — viz edgeMeshUpstream. Guarded on realtime presence
  // (tier:optional — see LIVE_UPSTREAM_PUBLIC above).
  if (topo.services.realtime) {
    lines.push(`LIVE_UPSTREAM_MESH=${edgeMeshUpstream(topo, "realtime")}`);
  }
  // ask.${PUBLIC_TLD}/v1 — the "AISHA as a model" PUBLIC face for IDEs
  // (ANTHROPIC_BASE_URL=https://ask.${PUBLIC_TLD}/v1). Per docs/planning/
  // AISHA_OMNI_GATEWAY.md §2/§3: the model is a DISTINCT host (NOT "gateway"),
  // and its public /v1 edge is @aisha/gateway (the CORE gateway) — svc-ai-chat
  // stays a pure INTERNAL service with NO public Traefik router / LE cert (public
  // TLS terminates upstream at pfSense/HAProxy on the *.<public_tld> wildcard).
  // The edge Caddy "gateway" slot — freed now that llm-gateway is public:false —
  // matches Host(GATEWAY_DOMAIN_PUBLIC=ask.<tld>) and reverse-proxies to
  // GATEWAY_UPSTREAM = the core gateway's api.<internal_tld> face (which already
  // owns its router + cert → zero new cert). The core gateway's STREAMING /v1
  // proxy (services/gateway/src/routes/v1.ts, @fastify/http-proxy — never the
  // buffering functions.ts pattern) forwards /v1/* to svc-ai-chat:3011.
  // Bearer-passthrough: the Omni facade validates the PAT itself
  // (validate_mcp_token); the gateway does not re-gate /v1. Gated on ai-chat (the
  // model brain) + public_tld. llm-gateway keeps its own INTERNAL GATEWAY_DOMAIN
  // for role 2 (CLOW backend) / role 3 (/v1/batches) — it is just no longer a
  // public face. NOTE: the env var name stays GATEWAY_* (the edge's generic
  // extra-public-face slot) while the host is ask.<tld>; a rename to ASK_* is a
  // cosmetic follow-up, not a functional change.
  if (topo.services["ai-chat"] && topo.public_tld) {
    lines.push(`GATEWAY_DOMAIN_PUBLIC=${topo.subdomain_prefix}ask.${topo.public_tld}`);
    lines.push(`GATEWAY_UPSTREAM_PUBLIC=https://${requireServiceDomain(topo, "core", "internal", "api")}`);
    lines.push(`GATEWAY_UPSTREAM_MESH=${edgeMeshUpstream(topo, "core")}`);
  }
  // companion.${PUBLIC_TLD} (OpenClaw advisory companion) — tier:optional
  // internal-canonical service fronted by edge-proxy like live: public lane →
  // canonical internal host over backend Traefik; mesh lane → JMÉNEM na ingress
  // stacku, veřejná tvář = openclaw-auth (oauth2-proxy). Guarded on presence.
  if (topo.services.openclaw) {
    lines.push(`COMPANION_UPSTREAM_PUBLIC=https://${requireServiceDomain(topo, "openclaw", "internal", "companion")}`);
    lines.push(`COMPANION_UPSTREAM_MESH=${edgeMeshUpstream(topo, "openclaw")}`);
  }
  // ingest.${PUBLIC_TLD} (svc-local-ingest verified-document cockpit) —
  // tier:optional + provision_when_env(INGEST_BUNDLE_GIT_URL) internal-canonical
  // service fronted by edge-proxy exactly like companion. Guarded on presence.
  if (topo.services["local-ingest"]) {
    lines.push(`INGEST_UPSTREAM_PUBLIC=https://${requireServiceDomain(topo, "local-ingest", "internal", "ingest")}`);
    lines.push(`INGEST_UPSTREAM_MESH=${edgeMeshUpstream(topo, "local-ingest")}`);
  }
  // potok.${PUBLIC_TLD} (svc-potok flow-runtime cockpit) — same contract as
  // ingest/companion: tier:optional + provision_when_env(POTOK_ENABLED).
  if (topo.services.potok) {
    lines.push(`POTOK_UPSTREAM_PUBLIC=https://${requireServiceDomain(topo, "potok", "internal", "potok")}`);
    lines.push(`POTOK_UPSTREAM_MESH=${edgeMeshUpstream(topo, "potok")}`);
  }
  // web-render (svc-web-render, d-ii 2026-10-02) — tier:optional, BEZ veřejné tváře.
  // Web (nginx v edge) si předrenderované stránky táhne PŘÍMO MESHEM (vlastní routa
  // do rozsahu peerů) a posílá tam skořápku; vydává se jen mesh cíl. Bez web-renderu
  // v topologii nic — web předrender nezapne a servíruje SPA.
  if (topo.services["web-render"]) {
    lines.push(`WEB_RENDER_UPSTREAM_MESH=${edgeMeshUpstream(topo, "web-render")}`);
  }
  // Apex host routed by edge-proxy (308 → https://${APP_DOMAIN}${uri}).
  // Sentinel (.invalid) when PUBLIC_TLD is unset or equal to APP_DOMAIN —
  // see deriveApexRedirect() above for the contract.
  lines.push(`EDGE_APEX_DOMAIN=${apexRedirectFromTopology(topo).apexDomain}`);
  // live.${PUBLIC_TLD} sentinel. realtime is tier:optional (excluded from
  // cloud-single/local-dev), but the edge-proxy's STATIC Traefik label
  // Host(`${LIVE_DOMAIN_PUBLIC}`) needs a value in EVERY profile. When realtime
  // is filtered out the per-service loop below emits nothing, so pin the
  // unroutable .invalid sentinel (RFC 6761) exactly like EDGE_APEX_DOMAIN — the
  // router exists but never matches. When realtime IS present, the loop emits
  // the real LIVE_DOMAIN_PUBLIC and this guard is skipped.
  // ⛔ SENTINEL PATŘÍ I SLUŽBĚ, KTERÁ JE NASAZENÁ, ALE NENÍ VEŘEJNÁ.
  //
  // Naměřeno 2026-08-21 na riqi: profil instance označil čtyři vnitřní služby
  // za nevystavené, generátor jim veřejnou adresu vydávat přestal — a v Coolify
  // ZŮSTALA. `coolify-sync-envs` totiž posílá jen klíče, které v souboru JSOU;
  // klíč, který se přestal generovat, se z nasazení nikdy nesmaže. Pipeline umí
  // přidat, ne odebrat (a je to záměr: `.env.coolify` není jediný zapisovatel).
  //
  // Sentinel tu mezeru zavírá bez mazání: klíč se dál vydává, ale s hodnotou,
  // kterou edge-proxy v Caddy bloku výslovně přeskakuje. Route zmizí, aniž by
  // se muselo sahat na cizí zápisy.
  const nevystavena = (id) => {
    const svc = topo.services[id];
    return !svc || !(svc.urls?.public ?? []).length;
  };
  if (nevystavena("realtime")) {

    lines.push(`LIVE_DOMAIN_PUBLIC=live-disabled.invalid`);
  }
  // Same sentinel contract for the other optional edge-fronted public faces:
  // the edge-proxy static Traefik label Host(`${GATEWAY_DOMAIN_PUBLIC}`) /
  // Host(`${COMPANION_DOMAIN_PUBLIC}`) need a value in EVERY profile. The
  // gateway public face is now backed by ai-chat (always present) + requires a
  // public_tld; when either is missing (e.g. a community single-host profile
  // with no public zone) pin the unroutable sentinel so the static router
  // exists but never matches — exactly like EDGE_APEX_DOMAIN / LIVE_DOMAIN_PUBLIC.
  if (!topo.services["ai-chat"] || !topo.public_tld) {
    lines.push(`GATEWAY_DOMAIN_PUBLIC=gateway-disabled.invalid`);
  }
  if (nevystavena("openclaw")) {
    lines.push(`COMPANION_DOMAIN_PUBLIC=companion-disabled.invalid`);
  }
  // Same sentinel contract for the two ingestion/flow-runtime public faces —
  // both are tier:optional AND provision_when_env-gated (INGEST_BUNDLE_GIT_URL /
  // POTOK_ENABLED), so most profiles resolve without them while the edge-proxy
  // static Traefik labels Host(`${INGEST_DOMAIN_PUBLIC}`) /
  // Host(`${POTOK_DOMAIN_PUBLIC}`) still need a value in EVERY profile.
  if (nevystavena("local-ingest")) {
    lines.push(`INGEST_DOMAIN_PUBLIC=ingest-disabled.invalid`);
  }
  if (nevystavena("potok")) {
    lines.push(`POTOK_DOMAIN_PUBLIC=potok-disabled.invalid`);
  }
  // Same sentinel contract for the extranet: tier:optional AND
  // provision_when_env-gated (EXTRANET_ENABLED), while the edge-proxy static
  // Traefik label Host(`${EXTRANET_DOMAIN_PUBLIC}`) needs a value in EVERY
  // profile — the router then exists but never matches.
  if (!topo.services.extranet || !topo.public_tld) {
    lines.push(`EXTRANET_DOMAIN_PUBLIC=extranet-disabled.invalid`);
    // Týž sentinel i pro upstream. Compose interpoluje CELÝ soubor bez ohledu
    // na profily, takže `${EXTRANET_UPSTREAM_PUBLIC:?}` uvnitř vypnuté služby
    // `extranet-auth` by shodilo PARSOVÁNÍ celého edge stacku u každé
    // instance, která extranet nemá — tedy nejkritičtější stack kvůli
    // volitelnému povrchu. Sentinel drží `:?` kontrakt smysluplný (prázdno je
    // pořád vada) a zároveň nechá edge naběhnout.
    lines.push(`EXTRANET_UPSTREAM_PUBLIC=https://extranet-disabled.invalid`);
  }

  // Aliases: each domain emitted under BOTH the service-id var name AND
  // the subdomain var name (legacy forms). e.g. for service "keycloak"
  // with subdomain "auth", we emit:
  //   KEYCLOAK_DOMAIN=auth.backend.example.com   (service-id form — used by KC code)
  //   AUTH_DOMAIN=auth.backend.example.com       (subdomain form — semantic alias)
  // Downstream consumers can pick whichever naming they were already using.
  // The mapping table below keeps the legacy names in domains.env aligned with
  // the new service-id form (e.g. KEYCLOAK ↔ AUTH, ORCHESTRATION ↔ N8N).
  const LEGACY_NAME_BY_SUBDOMAIN = {
    auth: "KEYCLOAK",
    n8n: "N8N",
    mcp: "MCP",
    api: "API",
    web: "APP",
    cache: "REGISTRY",
    matrix: "MATRIX",
    element: "ELEMENT",
    call: "ELEMENT_CALL",
    netbird: "NETBIRD",
    nocodb: "NOCODB",
    appsmith: "APPSMITH",
    intranet: "INTRANET",
    pki: "PKI",
    "pki-bridge": "PKI_BRIDGE",
    langfuse: "LANGFUSE",
    dirigent: "DIRIGENT",
    logs: "DOZZLE",
    studio: "STUDIO",
  };

  // Identita zákazníka pro skládání jmen kontejnerů. Bere se JEDNOU pro celý
  // běh, ne per službu — jinak by se varování o chybějící identitě vysypalo
  // třicetkrát a přestalo být čitelné.
  const appPrefixProCile = (topo?.app_name_prefix || "").trim();

  // ── TABULKA PATŘÍ PEERU, NE SLUŽBĚ ──────────────────────────────────────────
  // Ingress běží v netns AGENTA, tedy jeden na STACK. Pojmenovat jeho tabulku
  // po katalogové službě fungovalo jen náhodou — obvykle je na compose jedna
  // služba. Kde nejsou (cosmos = ledger + svc-blockchain, netinit = 3×), vyrobí
  // to DVA bloky téhož jména a compose se rozsype; a kde se jméno služby liší
  // od stacku (observability/langfuse, messaging/matrix, orchestration/n8n,
  // edge/prebuilt), nese proměnná jméno, které na sdílené ploše nic
  // jednoznačně neurčuje.
  //
  // Jméno peeru = jméno stacku (odvozené z názvu compose souboru), takže je
  // projektově jednoznačné napříč implementacemi. Trasy se sbírají tady a
  // vydávají se AŽ PO smyčce — jedna tabulka na peer, jeden zdroj pravdy.
  const trasyPeeru = new Map();
  const tcpPeeru = new Map();
  const jmenoPeeru = (compose) => {
    const m = /^docker-compose\.coolify(?:-(.+))?\.yml$/.exec(String(compose ?? ""));
    if (!m) return null;
    return (m[1] ?? "core").toUpperCase().replace(/-/g, "_");
  };
  for (const [id, svc] of Object.entries(topo.services)) {
    const idUpper = id.toUpperCase().replace(/-/g, "_");
    lines.push(`${idUpper}_PLACEMENT=${svc.placement}`);

    // B6: the service's INTERNAL consumer URL as a first-class topology primitive.
    // <ID>_URL=http://<container>:<port> for every catalog service with a primary internal
    // HTTP endpoint (OPENCLAW_URL, EXEC_URL, INTEGRATION_URL, …), PLUS any legacy consumer
    // aliases (AGENT_RUNNER_URL→exec, RAGNAROK_URL→integration) so existing readers keep their
    // env contract. Derived from the catalog — replaces the hardcoded passthrough that drifted
    // when a container name/port changed (the AGENT_RUNNER_URL bug).
    if (svc.internal_url?.service && svc.internal_url?.port) {
      // PLNÁ ADRESA VŽDY — ne container alias.
      //
      // `http://<container>:<port>` je jméno na sdílené docker síti: platí na
      // JEDNOM stroji, mezi instancemi nepřenositelné, a je to zároveň ta plochá
      // cesta, kterou má segmentace zavřít. Jako výchozí tvar tedy nemůže
      // sloužit — každá další komponenta nebo instance by si musela vyrobit
      // vlastní výjimku.
      //
      // Vydává se proto vždy jméno z topologie (`<sub>.<zóna>.<tld>`), odvozené
      // per instance z jejích TLD. Pravidlo platí bez ohledu na to, kde služba
      // zrovna bydlí — kolokace se řeší VRSTVOU POD jménem (mesh DNS, Traefik),
      // ne tím, že se jméno změní. Jedno jméno všude, mění se jen cesta k němu.
      //
      // Alias zůstává jen tam, kde služba v topologii žádné jméno nemá (nemá
      // `subdomain`) — a to je stav k doplnění, ne cílový.
      //
      // VÝJIMKA: bootstrapové hopy (PKI_BRIDGE_URL, AUTH_UPSTREAM_*,
      // KEYCLOAK_INTERNAL_URL) si kolokační větev drží dál — ty běží DŘÍV, než
      // existuje čím jméno rozřešit, takže pro ně je alias jediná funkční cesta.
      //
      // ── PROČ TU UŽ NENÍ TICHÝ FALLBACK NA JMÉNO KONTEJNERU ──────────────────
      // Dřív se při chybějícím topologickém jménu vydala adresa `<kontejner>:<port>`.
      // Naměřeno 2026-08-13: tu větev nebere ANI JEDNA z deseti služeb — všechny
      // mají `subdomain`. Byla to tedy mrtvá cesta, která ale držela při životě
      // literální jméno v katalogu a budila dojem, že je nosné.
      //
      // Kdyby službě jméno v topologii jednou chybělo, je to díra v topologii a
      // musí být vidět. Tichá náhrada plochou adresou by ji zakryla — a přesně
      // to je vzor, kvůli kterému mrtvá služba vypadala jako živá.
      const meshName = (svc.urls?.internal ?? [])[0]?.url;
      // `base_path` — cesta, na které služba svůj kontrakt nabízí (OpenAI-kompatibilní
      // servery na `/v1`). Patří k DEKLARACI služby, ne do konzumenta: bez ní si
      // `/v1` dolepuje každý volající zvlášť, a tím si nese znalost o cizí službě.
      const basePath = svc.internal_url.base_path
        ? `/${String(svc.internal_url.base_path).replace(/^\/+|\/+$/g, "")}`
        : "";
      if (!meshName) {
        throw new Error(
          `[derive-domains] ${id}: služba má internal_url, ale topologie jí nevydala vnitřní jméno. ` +
            `Doplň jí 'subdomain' v config/services.json. (Dřív se tu tiše dosadila plochá adresa ` +
            `<kontejner>:<port> — ta ale míří na sdílenou síť a mezi instancemi nefunguje.)`,
        );
      }
      const internalUrl = `http://${meshName}:${svc.internal_url.port}` + basePath;
      lines.push(`${idUpper}_URL=${internalUrl}`);
      for (const a of svc.internal_url.env_aliases ?? []) {
        lines.push(`${a}=${internalUrl}`);
      }
    }

    // DALŠÍ endpointy téže služby.
    //
    // `internal_url` je jednotné číslo, ale jedna katalogová služba jich
    // vystavuje víc: core má postgrest, gateway, minio, imgproxy,
    // mcp-knowledge i web-artifact; domain-services devět konektorů. Bez
    // tohohle pole je nelze pojmenovat, a proto se 34 proměnných nedalo vydat
    // vůbec — konzumenti pak vždy spadli na holý container alias.
    //
    // Každý endpoint má vlastní `subdomain`, takže dostane PLNOU adresu podle
    // téhož pravidla jako primární: `<sub>.<zóna>.<tld>`, odvozeno per instance.
    // Alias zůstává jen tam, kde subdoména není — a to je stav k doplnění.
    // MESH INGRESS — směrovací tabulka, kterou si ingress postaví SÁM při startu.
    //
    // Ingress dřív mapoval PORT → jedna pevná doména, takže dvě služby na jednom
    // portu se vylučovaly a tabulka se udržovala ručně v compose. Ruční seznam se
    // s katalogem rozejde — třída, na kterou tenhle repozitář už doplatil.
    //
    // Tady se vydá jako jedna proměnná `<ID>_MESH_INGRESS_ROUTES` ve tvaru
    // `port|host|cíl;port|host|cíl…`. Přidání služby do katalogu tedy změní
    // proměnnou a ingress se přenastaví při dalším nasazení — bez zásahu.
    //
    // Rozlišuje se HOSTEM, ne portem: mesh jméno přijde v Host hlavičce, takže
    // na jednom portu smí poslouchat libovolný počet služeb.
    //
    // VÍC JMEN NA JEDNU TRASU — `port|jméno1,jméno2,…|cíl`
    // ----------------------------------------------------
    // První verze uměla jen mesh jméno, a produkce po nasazení vracela 421.
    // Volající totiž nepřichází s mesh jménem: edge Caddy dělá
    //
    //     reverse_proxy http://mesh-router:3001 { header_up Host mesh-router:3001 }
    //
    // tedy hlavičku PŘEPÍŠE na jméno upstreamu a původní doménu odloží do
    // X-Forwarded-Host. Ingress tak dostal `Host: mesh-router:3001`, což
    // nematchlo nic, a odmítl vlastní veřejný provoz.
    //
    // Jedna služba je dosažitelná pod VÍCE jmény podle toho, kudy se k ní jde:
    // mesh jméno (mezi uzly), veřejná doména (od klienta), přímá doména
    // (za Traefikem) a jméno, které edge posílá v Host (`edgeMeshHost`).
    // Všechna se odvodí — žádné se nepíše.
    {
      const primary = (svc.urls?.internal ?? [])[0];
      const zone = zonaZAdresy(primary);
      // Veřejná i přímá doména patří JEDNOMU endpointu, ne všem. `api.<PUBLIC_TLD>`
      // je gateway na :3001 — pověsit ji i na :9000 by znamenalo, že na veřejnou
      // doménu odpoví minio.
      //
      // KTERÝ endpoint to je, katalog říká: `public_face` ({service, port}), a
      // kde chybí, `internal_url`. Port veřejné tváře se nehádá podle pořadí
      // ani podle jména.
      const face = verejnaTvar(svc);
      const publicFacePort = face?.port ? Number(face.port) : null;
      const faceHost = edgeMeshHost(topo, id);
      // Jména, pod kterými dorazí provoz na VEŘEJNOU TVÁŘ služby. Kromě veřejné
      // a přímé domény sem patří i PRIMÁRNÍ mesh jméno: edge se na mesh
      // připojuje právě jím (jediné jméno, kterému mesh DNS vyrábí záznam
      // peeru), a oauth2-proxy navíc Host přepisuje na hostitele upstreamu.
      // Bez něj by ingress vlastní veřejný provoz odmítl 421 — přesně to se
      // stalo 2026-07-29 s Hostem hopu ("mesh-router").
      const serviceWideNames = () => {
        const names = [];
        for (const scope of ["public", "direct"]) {
          for (const e of svc.urls?.[scope] ?? []) if (e?.url) names.push(e.url);
        }
        if (primary?.url) names.push(primary.url);
        if (faceHost) names.push(faceHost);
        return names;
      };
      const routes = [];
      const push = (port, hosts, target) => {
        const all = [...hosts];
        if (publicFacePort && port === publicFacePort) all.push(...serviceWideNames());
        routes.push(`${port}|${[...new Set(all)].filter(Boolean).join(",")}|${target}`);
      };
      // CÍL TRASY JE JMÉNO KONTEJNERU — a to má jediný domov: `container_name`
      // v compose. Katalog na něj UKAZUJE (`service:`), neopisuje ho.
      //
      // Naměřeno 2026-08-13, proč: dřív tu stál literál z katalogu a ten se s
      // compose rozešel ve VŠECH 38 výskytech — buď nesl cizí identitu
      // (`aisha-openclaw` na instanci, která se „aisha" nejmenuje), nebo byl
      // holý (`minio`), tedy nárok na sdílené síti, o který se přetahují všichni
      // nájemníci. Ingress pak posílal provoz ke kontejneru JINÉ instance.
      // Jména modelu na slotu modelového meshe drží most (C4): VŠECHNY trasy služby míří
      // na jeho síťový koncový bod, ne do compose modelu (ten na hlavním meshi není).
      const domov = domovVHlavnimMeshi(topo, id);
      const cilKontejneru = (serviceKey) => {
        const jmeno = domov.most
          ? containerNameFrom(domov.compose, domov.sluzba, appPrefixProCile)
          : containerNameFrom(svc.compose, serviceKey, appPrefixProCile);
        if (jmeno) return jmeno;
        // Prázdno není „nic k routování" — je to nedoručená identita nebo
        // odkaz na compose službu, která neexistuje. Obojí je vada, ne stav.
        process.stderr.write(
          `[derive-domains] WARN: ${id}: trasu na '${serviceKey}' nelze postavit — ` +
            `${svc.compose} tu službu nemá, nebo chybí APP_NAME_PREFIX (identita zákazníka).\n`,
        );
        return null;
      };
      if (zone && svc.internal_url?.service && svc.internal_url?.port) {
        const cil = cilKontejneru(svc.internal_url.service);
        if (cil) push(svc.internal_url.port, [primary.url], `${cil}:${svc.internal_url.port}`);
      }
      // Veřejná tvář, když NENÍ totéž co `internal_url` (oauth2-proxy před
      // službou): vlastní trasa na jejím portu. Edge se připojuje na primární
      // jméno (to má DNS záznam peeru), proto je primární jméno i tady v Host.
      const faceJeJina =
        zone && face?.service && face?.port &&
        !(svc.internal_url?.service === face.service && Number(svc.internal_url?.port) === Number(face.port));
      if (faceJeJina) {
        const cil = cilKontejneru(face.service);
        if (cil) push(Number(face.port), [primary.url], `${cil}:${face.port}`);
      }
      if (zone) {
        for (const ep of svc.internal_endpoints ?? []) {
          if (!ep.port || !ep.subdomain || !ep.service) continue;
          const cil = cilKontejneru(ep.service);
          if (cil) push(ep.port, [hostZEndpointu(topo, ep, zone)], `${cil}:${ep.port}`);
        }
      }
      // Táž trasa dvakrát = dva stejně pojmenované matchery, a ty caddyfile
      // odmítne. Vzniká to legitimně: služba smí mít `internal_url` i stejný
      // záznam v `internal_endpoints` (svc-blockchain), a od zavedení
      // `public_face` i tak, že veřejná tvář ukazuje na týž port jako endpoint
      // (core: gateway:3001 = endpoint core-gateway:3001). Slučuje se podle
      // DVOJICE port+cíl a jména se sjednotí — dvě trasy na tentýž kontejner
      // a port nejsou dvě cesty, je to jedna cesta pod víc jmény.
      const podleCile = new Map();
      for (const r of routes) {
        const [port, hosts, target] = r.split("|");
        const klic = `${port}|${target}`;
        const jmena = podleCile.get(klic) ?? [];
        jmena.push(...hosts.split(","));
        podleCile.set(klic, jmena);
      }
      const unique = [...podleCile.entries()].map(([klic, jmena]) => {
        const [port, target] = klic.split("|");
        return `${port}|${[...new Set(jmena)].filter(Boolean).join(",")}|${target}`;
      });
      if (unique.length) {
        const peer = jmenoPeeru(domov.compose);
        if (peer) trasyPeeru.set(peer, [...(trasyPeeru.get(peer) ?? []), ...unique]);
      }

      // ── TCP PŘES MESH ───────────────────────────────────────────────────────
      // Mesh dosud vezl JEN HTTP: ingress je Caddy a rozlišuje podle `Host`,
      // který TCP nemá. Redis a clamd proto chodily po SDÍLENÉ síti `coolify` —
      // tam, kde 2026-08-16 stálo 149 aplikací, 8 zákaznických prefixů, a docker
      // mezi stejnojmennými ROUND-ROBINUJE. Jméno tam bylo jediná obrana.
      //
      // ⭐ U TCP ale rozlišovač `Host` NENÍ POTŘEBA: každý stack má vlastní netns
      // a vlastní mesh IP, takže dvojice (mesh IP, port) je jednoznačná sama.
      // Dva stacky můžou obě poslouchat na 6379, aniž by si překážely — konflikt,
      // kvůli kterému u HTTP vznikl Host-routing, tu neexistuje jako kategorie.
      //
      // Tabulka je proto jednodušší: `port|cíl`, bez jmen. Vydává se toutéž
      // dráhou jako HTTP (katalog → derivace → jedna proměnná → sidecar si
      // konfiguraci postaví při startu), aby nevznikl druhý zdroj pravdy.
      if (zone) {
        const tcp = [];
        for (const ep of svc.internal_tcp_endpoints ?? []) {
          if (!ep.port || !ep.service) continue;
          const cil = cilKontejneru(ep.service);
          if (!cil) continue;
          tcp.push(`${ep.port}|${cil}:${ep.port}`);
        }
        // Sloučení podle dvojice port+cíl: táž trasa dvakrát je jedna trasa.
        const tcpUnique = [...new Set(tcp)];
        if (tcpUnique.length) {
          const peer = jmenoPeeru(svc.compose);
          if (peer) tcpPeeru.set(peer, [...(tcpPeeru.get(peer) ?? []), ...tcpUnique]);
        }
        // Adresa pro KONZUMENTY: mesh jméno, ne alias na sdílené síti. Tohle je
        // druhá půlka pravidla — nejen jak se služba propaguje, ale i pod jakým
        // jménem ji volající oslovuje. Alias na `coolify` nárokuje víc nájemníků;
        // mesh jméno patří JEDNOMU peeru, takže se nelze připojit jinam.
        for (const ep of svc.internal_tcp_endpoints ?? []) {
          if (!ep.port || !ep.service) continue;
          // ⛔ NAMĚŘENO 2026-08-23: mesh jméno tady bylo NEPŘELOŽITELNÉ pro konzumenta.
        // Gateway (a každá běžná služba) sedí na sdílené síti, ne v netns agenta —
        // mesh jméno ani mesh IP odtud nepřeloží ani nedoručí. Projevilo se to jako
        // 15sekundová odezva: kontrola odvolání tokenu čekala na tři retry ioredis.
        // Konzument proto míří na ODCHOZÍ BRÁNU svého vlastního stacku
        // (`<prefix>-mesh-egress`, alias agenta), která spojení předá do meshe.
        for (const a of ep.env_aliases ?? []) lines.push(`${a}=${primary.url}`);
        for (const a of ep.port_env_aliases ?? []) lines.push(`${a}=${ep.port}`);
        }
      }
    }

    for (const ep of svc.internal_endpoints ?? []) {
      if (!ep.port || !(ep.subdomain || ep.service)) continue;
      // Zóna se bere z UŽ SPOČÍTANÉ primární adresy služby (`api.mesh.riq.internal`
      // → `mesh.riq.internal`), takže se nikde neopakuje logika vzorů ani TLD.
      const zone = zonaZAdresy((svc.urls?.internal ?? [])[0]);
      // Záloha pro endpoint BEZ `subdomain` je jméno kontejneru — složené
      // z identity, ne opsané. Endpoint bez subdomény je stav k doplnění;
      // dokud trvá, musí ta adresa aspoň patřit TÉHLE instanci.
      const host = hostZEndpointu(topo, ep, zone) ?? containerNameFrom(svc.compose, ep.service, appPrefixProCile);
      if (!host) continue;
      // `base_path` — volitelná cesta, na které endpoint kontrakt skutečně nabízí
      // (OpenAI-kompatibilní servery ho mají na `/v1`). Bez ní by se adresa vydala
      // jako holý `http://host:port` a konzument by si `/v1` musel dolepit sám —
      // tedy znalost o cizí službě natvrdo v kódu konzumenta. Normalizuje se na
      // jedno úvodní lomítko a bez koncového, aby se z ní nedaly složit `//`.
      const basePath = ep.base_path ? `/${String(ep.base_path).replace(/^\/+|\/+$/g, "")}` : "";
      for (const a of ep.env_aliases ?? []) lines.push(`${a}=http://${host}:${ep.port}${basePath}`);
    }

    // Determine which scope is "canonical" for this service. Default: internal
    // (most services live behind the per-server *.{internal_tld} zone). Override in
    // catalog with `canonical_scope: "public"` for services that are
    // public-only (edge, netbird, registry — clients reach them from the
    // internet, not from inside the cluster).
    // `public_when_env` — VEŘEJNÁ TVÁŘ PATŘÍ LANE, KTERÁ SLUŽBU ZAPNULA.
    // Zrcadlí idiom `provision_when_env`, ale o patro níž: provisioning říká
    // ZDA službu nasadit, tohle ZDA jí dát veřejnou adresu.
    //
    // Naměřeno 2026-08-08 na source-brokeru: má dvě nezávislé lanes — federační
    // (`SOURCE_API_URL`; uživatelé cizí aplikace se autentizují ZVENČÍ, veřejnou
    // tvář potřebuje) a li-driver (`LOCAL_INGEST_DROP_DIR`; jen čte lokální drop
    // adresář, veřejnou tvář nepotřebuje). `canonical_scope` je ale STATICKÝ,
    // takže zapnutí té lokální lane vyrobilo veřejnou `broker.<public-tld>` —
    // útočná plocha za schopnost, která ven nic nevystavuje.
    //
    // Bez deklarace se chování NEMĚNÍ (zpětně kompatibilní). S deklarací: dokud
    // lane není armovaná, služba je canonical INTERNAL — adresa v interní/mesh
    // zóně, ne na veřejném TLD.
    const publicLaneArmed = podminkaSplnena(svc.public_when_env);
    const declaredScope = svc.canonical_scope ?? "internal";
    const canonicalScope = (declaredScope === "public" && !publicLaneArmed)
      ? "internal"
      : declaredScope;
    const canonicalEntries = canonicalScope === "public"
      ? (svc.urls.public ?? [])
      : (svc.urls.internal ?? []);
    const aliasEntries = canonicalScope === "public"
      ? (svc.urls.internal ?? [])
      : (svc.urls.public ?? []);

    // Allow profile to override the legacy var name for the PRIMARY subdomain
    // of this service (only the first canonical entry counts). Use case:
    // a fork renames the frontend service's subdomain from "web" to "acme"
    // (via service_overrides.<id>.subdomain) but still wants APP_DOMAIN
    // emitted so downstream consumers (VITE_PUBLIC_SITE_URL, ALLOWED_ORIGINS,
    // etc.) keep their canonical env-var contract.
    const overrideLegacyEnvVar = topo.service_overrides?.[id]?.legacy_env_var;
    const primarySubdomain = canonicalEntries[0]?.subdomain;

    // CANONICAL domain — emit under <LEGACY>_DOMAIN (drop-in replacement
    // for whatever domains.env declared today) and <SUBDOMAIN>_DOMAIN.
    for (const entry of canonicalEntries) {
      const subUpper = entry.subdomain.toUpperCase().replace(/-/g, "_");
      // legacy_env_var override applies ONLY to the primary subdomain — extras
      // get their natural <SUBDOMAIN>_DOMAIN form (e.g. THERAPY_DOMAIN for an
      // extra subdomain "therapy"). This way a fork can rename its primary
      // frontend env var to APP without polluting extras with APP_DOMAIN too.
      const isPrimary = entry.subdomain === primarySubdomain;
      const legacyName = (isPrimary && overrideLegacyEnvVar)
        ? overrideLegacyEnvVar
        : (LEGACY_NAME_BY_SUBDOMAIN[entry.subdomain] ?? subUpper);
      // pki-bridge is a mesh-BOOTSTRAP dependency: it mints the mesh cert, so its
      // canonical domain must be the mesh-INDEPENDENT direct host — never the mesh
      // overlay (canonical scope "internal" becomes the mesh zone under
      // MESH_ENABLED=true). Its Traefik router is Host(${PKI_BRIDGE_DOMAIN}) and
      // PKI_BRIDGE_URL derives from the same var, so a mesh value strands BOTH the
      // router and the caller on the cert-less, not-yet-reachable mesh host during
      // the very bootstrap window this issuance opens — the same chicken-and-egg
      // the AUTH_UPSTREAM lines above avoid, applied to the other bootstrap dep.
      const url = (id === "pki" && entry.subdomain === "pki-bridge")
        ? (svc.urls.direct?.find((e) => e.subdomain === "pki-bridge")?.url ?? entry.url)
        : entry.url;
      lines.push(`${legacyName}_DOMAIN=${url}`);
      if (legacyName !== subUpper) {
        lines.push(`${subUpper}_DOMAIN=${url}`);
      }
      // Jméno podle ID SLUŽBY — bez ruční mapy.
      //
      // `LEGACY_NAME_BY_SUBDOMAIN` je udržovaný výčet: `auth → KEYCLOAK`. Kdo do
      // něj novou službu nedopíše, dostane jen tvar podle subdomény — a přesně
      // to se stalo extranetu. Jeho compose čte `${EXTRANET_DOMAIN:?…}`, derivace
      // vydávala `EXTRA_DOMAIN`, takže compose preflight spadl a s ním CELÝ
      // cold-start (2026-07-30). Vada se neprojevila u extranetu samotného, ale
      // zablokovala jedinou cestu, kterou se do .env.coolify cokoli dostává.
      //
      // Služba je oslovitelná svým ID i svou subdoménou; obojí se tedy vydá.
      // Ruční mapa tím přestává být podmínkou — zůstává jen pro jména, která se
      // od ID liší z historických důvodů. Shodná vydání slučuje
      // collapseDuplicateEmissions(), takže u keycloaku nic nepřibude.
      if (isPrimary && idUpper !== legacyName && idUpper !== subUpper) {
        lines.push(`${idUpper}_DOMAIN=${url}`);
      }
    }

    // ALIAS domain (the other scope) — emit with _PUBLIC_DOMAIN or
    // _INTERNAL_DOMAIN suffix so consumers can address the alias zone.
    const aliasSuffix = canonicalScope === "public" ? "INTERNAL" : "PUBLIC";

    // Subdomains that exist in canonical scope (so we know NOT to emit
    // them as bare *_DOMAIN if they're also in the alias scope — would
    // collide).
    const canonicalSubdomains = new Set(canonicalEntries.map((e) => e.subdomain));

    for (const entry of aliasEntries) {
      const subUpper = entry.subdomain.toUpperCase().replace(/-/g, "_");
      const legacyName = LEGACY_NAME_BY_SUBDOMAIN[entry.subdomain] ?? subUpper;
      // ⛔ NEARMOVANÁ VEŘEJNÁ LANE NESMÍ VYDAT VEŘEJNOU ADRESU.
      //
      // `public_when_env` výš překlápělo jen KANONICKOU zónu, ale veřejná
      // adresa se pořád emitovala jako alias — a edge ji podle ní servíroval.
      // Deklarace tedy slibovala („tohle říká ZDA jí dát veřejnou adresu")
      // něco, co se do env nikdy nepropsalo. Vlastnost bez měřidla.
      //
      // Naměřeno 2026-08-21 na riqi: čtyři vnitřní služby (ingest, potok,
      // companion, live) měly veřejnou doménu na edge, přestože jsou vnitřní.
      // Nasazená ≠ vystavená.
      //
      // Sentinel `.invalid` (RFC 6761) je týž tvar, jaký tenhle soubor už
      // používá pro služby, které v profilu nejsou: statický router existuje,
      // ale nikdy nesedí. Edge-proxy ho v Caddy bloku sám přeskakuje.
      const aliasUrl = (aliasSuffix === "PUBLIC" && !publicLaneArmed)
        ? `${entry.subdomain}-disabled.invalid`
        : entry.url;
      // Standard form: <LEGACY>_<SUFFIX>_DOMAIN (e.g. API_PUBLIC_DOMAIN)
      lines.push(`${legacyName}_${aliasSuffix}_DOMAIN=${aliasUrl}`);
      if (legacyName !== subUpper) {
        lines.push(`${subUpper}_${aliasSuffix}_DOMAIN=${aliasUrl}`);
      }
      // Legacy form: <LEGACY>_DOMAIN_<SUFFIX> (e.g. API_DOMAIN_PUBLIC) —
      // pre-resolver compose files use this name. Emit for drop-in compat.
      lines.push(`${legacyName}_DOMAIN_${aliasSuffix}=${aliasUrl}`);
      if (legacyName !== subUpper) {
        lines.push(`${subUpper}_DOMAIN_${aliasSuffix}=${aliasUrl}`);
      }
      // If this subdomain has NO canonical counterpart (e.g. pure public_alias
      // like 'dirigent' / 'mcp' that only exists in the public zone), also
      // emit the bare *_DOMAIN form. Otherwise consumers wanting the primary
      // address (no _PUBLIC suffix) would have no way to reach it.
      if (!canonicalSubdomains.has(entry.subdomain)) {
        lines.push(`${legacyName}_DOMAIN=${entry.url}`);
        if (legacyName !== subUpper) {
          lines.push(`${subUpper}_DOMAIN=${entry.url}`);
        }
      }
    }
  }

  // ── Cizí veřejné tváře (EXTERNAL_FACES) ─────────────────────────────
  // Trasa jde do tabulky peeru `via`, edge dostane dvojici veřejné jméno →
  // mesh upstream. Obě proměnné se vydávají VŽDY (i prázdné), aby odebraná
  // tvář z .env.coolify zmizela a nezůstala viset stará trasa.
  //   EDGE_EXTERNAL_FACES       `<veřejné>|http://<mesh>:<port>;…` (edge-proxy)
  //   EDGE_EXTERNAL_FACE_HOSTS  `<veřejné>,…` (Traefik kontrakt edge-proxy)
  const cizi = [];
  for (const f of topo.external_faces ?? []) {
    const peer = jmenoPeeru(f.via_compose);
    if (!f.mesh_host || !peer) {
      process.stderr.write(
        `[derive-domains] WARN: external_faces.${f.id} (${f.public_host}) se NEVYSTAVÍ — ` +
          `${f.mesh_host ? `${f.via_compose} nemá mesh peer` : "mesh je vypnutý"}; boční cesta se nedosazuje.\n`,
      );
      continue;
    }
    trasyPeeru.set(peer, [
      ...(trasyPeeru.get(peer) ?? []),
      `${f.port}|${f.mesh_host},${f.public_host}|${f.container}:${f.port}`,
    ]);
    cizi.push(f);
  }
  lines.push(`EDGE_EXTERNAL_FACES=${cizi.map((f) => `${f.public_host}|http://${f.mesh_host}:${f.port}`).join(";")}`);
  lines.push(`EDGE_EXTERNAL_FACE_HOSTS=${cizi.map((f) => f.public_host).join(",")}`);

  // Vydání PO smyčce: jedna tabulka na peer. Sloučí se trasy všech katalogových
  // služeb, které sdílejí týž compose — sdílejí totiž i netns a mesh IP, takže
  // jsou to dvě jména jednoho peeru, ne dva peeři.
  //
  // Slučuje se podle dvojice port+cíl, stejně jako uvnitř jedné služby: táž
  // trasa pod víc jmény je jedna trasa.
  for (const [peer, trasy] of [...trasyPeeru.entries()].sort()) {
    const podleCile = new Map();
    for (const r of trasy) {
      const [port, hosts, target] = r.split("|");
      const klic = `${port}|${target}`;
      podleCile.set(klic, [...(podleCile.get(klic) ?? []), ...String(hosts).split(",")]);
    }
    const slouceno = [...podleCile.entries()].map(([klic, jmena]) => {
      const [port, target] = klic.split("|");
      return `${port}|${[...new Set(jmena)].filter(Boolean).join(",")}|${target}`;
    });
    lines.push(`${peer}_MESH_INGRESS_ROUTES=${slouceno.join(";")}`);
  }
  for (const [peer, trasy] of [...tcpPeeru.entries()].sort()) {
    lines.push(`${peer}_MESH_TCP_ROUTES=${[...new Set(trasy)].join(";")}`);
  }



  // PKI_BRIDGE_URL — topology-aware, so netbird's pki-init reaches pki-bridge on
  // every fleet shape. pki-bridge only `expose`s :3040 (no host port publish), so
  // the reachable path depends on co-location:
  //   co-located (netbird + pki resolve to the SAME node) → http://pki-bridge:3040,
  //     the plain-HTTP service hop the renewer already uses (#756). No internal-zone
  //     DNS and no TLS/cert dependency — the only path that works during the
  //     cert-less bootstrap window (this very issuance is what mints the mesh cert).
  //   split (different nodes) → NOT emitted here; env-doctor's topo()||dom() falls
  //     through to domains.env's https://${PKI_BRIDGE_DOMAIN} (public Backend Traefik,
  //     which terminates TLS for the cross-node hop).
  // Co-location is decided on the RESOLVED node (server_bindings maps slot→node NAME),
  // not the slot: on a single-node fork netbird=frontend and pki=backend still land
  // on the same machine. Default (no bindings) = same node ⇒ service-name path, which
  // is exactly today's single-node behaviour.
  //
  // ⛔ NAMĚŘENO 2026-08-13: kolokace se dřív rozhodovala JEDNOU, podle netbirdu —
  // a vyhraný verdikt dostali VŠICHNI konzumenti. Na cloud-multi je netbird na
  // frontendu a pki na backendu ⇒ „split" ⇒ https://<direct> pro každého. Jenže
  // pki-init běží i v core a integration, které s pki BYDLÍ (backend) — a ti
  // dostali adresu pro cizí pozici: https na kontejner, kde 443 nikdo neposlouchá
  // (most poslouchá http:3040; TLS existuje až na Traefiku). 600 s marných
  // pokusů → exit 1 → vlna 2 stála. Změřeno z hostitele:
  //     http://<ip>:3040/diag/ca-bundle  → 200, 3 certifikáty
  //     https://<ip>:443                 → connection refused
  //
  // Návrh majitele (2026-08-13): služby spolu mluví po mesh/warmup sítích;
  // Traefik je JEN pro vstup zvenčí — a jediná povolená výjimka je bootstrap
  // hop na JINÝ host, dokud mesh nestojí. Kolokace je proto vlastnost DVOJICE
  // (konzument, pki), ne světa: každý konzument dostane SVOU adresu.
  //
  // Kanál: PKI_BRIDGE_URL zůstává globální BEZPEČNÝ tvar (cross-host přes
  // Traefik — funguje odevšad, jen interně tam, kde to jde, není nejkratší).
  // Navíc se vydává PKI_COLOCATED_SLOTS: sloty, jejichž aplikacím deploy-init
  // přepne PKI_BRIDGE_URL na přímý hop http://pki-bridge:3040 po warmup síti.
  // Rozhodnutí zůstává TADY (resolver zná topologii); deploy-init jen doručuje.
  {
    const bindings = topo.server_bindings ?? {};
    const pkiPlacement = topo.services.pki?.placement;
    if (pkiPlacement) {
      const pkiNode = bindings[pkiPlacement] ?? pkiPlacement;
      const colocated = (topo.servers ?? [])
        .filter((slot) => (bindings[slot] ?? slot) === pkiNode)
        .sort();
      lines.push(`PKI_COLOCATED_SLOTS=${colocated.join(",")}`);
      // ⛔ Identita instance. Holé `pki-bridge` je na sdíleném hostiteli adresa
      // bez vlastníka — a tahle hodnota se GENERUJE do env, takže by se ta
      // dvojznačnost rozvezla všem kolokovaným slotům naráz.
      lines.push(`PKI_BRIDGE_URL_COLOCATED=http://${topo.app_name_prefix}-pki-bridge:3040`);
      if (colocated.length === (topo.servers ?? []).length) {
        // Single-node (vč. single-node forku s více sloty): všichni bydlí s pki,
        // globální tvar je rovnou přímý hop.
        //
        // ⛔ S IDENTITOU INSTANCE (2026-08-25). Stálo tu holé `http://pki-bridge:3040`
        // — a odůvodnění, proč je to vada, je v tomhle souboru o dva řádky výš,
        // u sourozence `PKI_BRIDGE_URL_COLOCATED`: „bez vlastníka — a tahle
        // hodnota se GENERUJE do env, takže by se ta dvojznačnost rozvezla všem
        // kolokovaným slotům naráz."
        //
        // Platí to tady stejně: na sdíleném hostiteli si jméno `pki-bridge` může
        // zvolit kterýkoli nájemník a Docker mezi stejnojmennými ROUND-ROBINUJE,
        // takže by si instance vyžádala certifikát u cizí PKI. Že je nasazení
        // jednouzlové, o počtu NÁJEMNÍKŮ na tom uzlu nevypovídá nic.
        //
        // Skládá se z `app_name_prefix`, neopisuje se — týž zdroj identity jako
        // container_name v compose.
        lines.push(`PKI_BRIDGE_URL=http://${topo.app_name_prefix}-pki-bridge:3040`);
      } else {
        // Split fleet: pki-bridge is a mesh-BOOTSTRAP dependency (this very issuance
        // mints the mesh cert), so it must be reached DIRECT — never via the mesh
        // overlay — the same chicken-and-egg invariant AUTH_UPSTREAM keeps above.
        // The generic *_DOMAIN loop mesh-ifies PKI_BRIDGE_DOMAIN under MESH_ENABLED=true,
        // so a bare fall-through to https://${PKI_BRIDGE_DOMAIN} lands on the cert-less,
        // not-yet-reachable mesh host (verified on cross-host aisha: pki-bridge.mesh.<tld>
        // is unreachable during the bootstrap window). Pin the backend-Traefik direct
        // host, which serves a valid wildcard cert for the cross-node hop.
        lines.push(
          `PKI_BRIDGE_URL=https://${requireServiceDomain(topo, "pki", "direct", "pki-bridge")}`,
        );
      }
    }
  }

  // KEYCLOAK_INTERNAL_URL — the JWKS fetch path pki-bridge uses to validate the
  // renewer's token. Same co-location rule and the same reason as PKI_BRIDGE_URL
  // above: this hop is a mesh-BOOTSTRAP dependency, because the certificate it
  // guards is the mesh certificate. It must never resolve onto the mesh.
  //
  // Emitted here rather than via `internal_url` in config/services.json: that
  // mechanism also emits the <ID>_URL primitive, and KEYCLOAK_URL must stay the
  // PUBLIC issuer (it becomes the `iss` claim) — internal-url-topology asserts
  // exactly that. One derived variable, not a second meaning for an existing one.
  //
  // Measured 2026-07-20 on a single-node fleet: neither auth.mesh.<tld> nor
  // auth.<placement>.<tld> resolves inside a container; the shared-network alias
  // does. So same node ⇒ alias, and only a split fleet needs the direct host.
  {
    const bindings = topo.server_bindings ?? {};
    const kcPlacement = topo.services.keycloak?.placement;
    const pkiPlacement = topo.services.pki?.placement;
    // Emise visí na KEYCLOAKU, ne na PKI. Proměnná vznikla kvůli pki-bridge, ale
    // mezitím ji vyžaduje 12 compose souborů (gateway KC_ADMIN_URL/KC_JWKS_URL,
    // migrate — "provisionuje operátory přes Keycloak VNITŘNĚ", broker …). Dokud
    // podmínka zněla `kcPlacement && pkiPlacement`, instance, která Keycloak
    // PROVOZUJE a PKI ne, ji nedostala vůbec — a všech 12 compose padlo na
    // `required variable KEYCLOAK_INTERNAL_URL is missing a value`, tedy na hlášku
    // tvrdící, že ji "vyrábí topology resolver". Naměřeno na lean profilu
    // <fork> 2026-09-02 (`exclude: [… "pki" …]`): cold-start neměl jak projít
    // Step 2b. PKI o TÉHLE proměnné nerozhoduje — rozhoduje jen o jejím TVARU,
    // protože jediný důvod pro přímý host byl rozdělený fleet.
    if (kcPlacement) {
      const kcNode = bindings[kcPlacement] ?? kcPlacement;
      // Bez PKI rozhoduje o TVARU spotřebitel, ne dosazení. Alias `<prefix>-keycloak`
      // je jméno na sdílené síti JEDNOHO démona — ne DNS; z jiného uzlu se
      // neresolvuje a bez mesh (`mesh_default:false`) není čím ho nahradit. Ptáme se
      // proto na CORE: gateway i migrate, kteří tuhle proměnnou spotřebovávají, běží
      // v core stacku. Stejný slot ⇒ alias (měřeno 2026-07-20: auth.mesh.<tld> ani
      // auth.<placement>.<tld> uvnitř kontejneru neresolvuje, alias ano);
      // rozdílný ⇒ přímý host.
      const consumerPlacement = topo.services.core?.placement ?? kcPlacement;
      const pkiNode = pkiPlacement
        ? (bindings[pkiPlacement] ?? pkiPlacement)
        : (bindings[consumerPlacement] ?? consumerPlacement);
      const prefix = kcNode === pkiNode ? appNamePrefixOrWarn(topo, "KEYCLOAK_INTERNAL_URL") : null;
      if (prefix) {
        lines.push(`KEYCLOAK_INTERNAL_URL=http://${prefix}-keycloak:80`);
      } else {
        lines.push(
          `KEYCLOAK_INTERNAL_URL=https://${requireServiceDomain(topo, "keycloak", "direct", "auth")}`,
        );
      }
    }
  }

  // KEYCLOAK_EXTRA_HOST_ALIAS — DRUHÉ jméno Keycloaku pro `extra_hosts`, které
  // je ZARUČENĚ různé od prvního.
  //
  // ⛔ NAMĚŘENO 2026-09-04 na produkci <fork>: `<fork>-pki` se nenasadila,
  // `docker compose config` skončil na `services.pki-auth.extra_hosts must be a
  // mapping`. Compose převádí seznam na MAPU, takže dvě SHODNÉ položky ji
  // rozbijí — a čtyři compose (pki, llm-gateway, monitoring, openclaw) měly:
  //
  //     - "${KEYCLOAK_DOMAIN_PUBLIC}:host-gateway"
  //     - "${KEYCLOAK_DOMAIN}:host-gateway"
  //
  // Na upstreamu se ty dvě liší, na <fork> se obě rovnají (jediná doména `auth.<tld>`).
  // Není to vada hodnot: reprodukováno lokálně se SPRÁVNÝMI hodnotami. Změřeno,
  // že duplicitu nesnese ANI seznam („must be a mapping"), ANI mapa („mapping
  // key already defined"), a Compose neumí řádek podmíněně vynechat — rozdílnost
  // proto musí zaručit resolver.
  //
  // Sentinel `.invalid` (RFC 6761) je táž technika jako EDGE_APEX_DOMAIN a
  // LIVE_DOMAIN_PUBLIC: záznam existuje, ale nikdy se netrefí.
  //
  // ⛔ POROVNÁVÁ SE PROTI HODNOTÁM, KTERÉ COMPOSE SKUTEČNĚ UVIDÍ, a proto se to
  // dělá až TADY, nad hotovým seznamem. První verze porovnávala KEYCLOAK_DOMAIN_
  // DIRECT s veřejnou doménou, jenže compose má na druhém řádku KANONICKOU
  // `KEYCLOAK_DOMAIN` — na cloud-multi s meshem (auth.mesh.… × auth.aisha.…) se
  // ty dvě liší, alias přesto vycházel jako sentinel a mapování mesh jména na
  // host-gateway by se ZTRATILO. Odvozovat z jiné veličiny, než jakou konzument
  // čte, je táž třída vady jako celý tenhle incident.
  {
    const hodnota = (klic) => {
      const radek = lines.find((l) => typeof l === "string" && l.startsWith(`${klic}=`));
      return radek === undefined ? "" : radek.slice(klic.length + 1).replace(/^'|'$/g, "");
    };
    lines.push(
      `KEYCLOAK_EXTRA_HOST_ALIAS=${keycloakExtraHostAlias(hodnota("KEYCLOAK_DOMAIN"), hodnota("KEYCLOAK_DOMAIN_PUBLIC"))}`,
    );

    // Veřejná jména, která na svém uzlu vlastní edge (viz edgeOwnedHosts).
    // Z VYDANÝCH hodnot, ze stejného důvodu jako alias o řádek výš. Vydává se
    // VŽDY, i prázdné — změna topologie (vypnutý mesh, rozdělení uzlů) musí
    // z .env.coolify odebrat i dřív vydaná jména, jinak by backend dál mlčel.
    lines.push(`EDGE_OWNED_HOSTS=${edgeOwnedHosts(topo, hodnota).join(",")}`);

    // ── Overlay povrchu ↔ derivace ─────────────────────────────────────────
    // ⛔ NAMĚŘENO 2026-09-13: `api.postgrest_url`, `auth.issuer` a
    // `auth.client_id` stojí v overlayi jako literály, build je čte doslova
    // a NIC je neporovnalo s tím, co platforma odvodí. Porovnává se proti
    // VYDANÝM hodnotám (týž důvod jako u aliasu výš): konzument čte tyhle,
    // ne mezivýpočet. Nesoulad SHODÍ derivaci — povrch s cizím IdP se
    // jinak postaví zeleně a pozná se až na přihlašovací obrazovce.
    //
    // Veřejná doména z referenčního `.json.example` NENÍ doména instance:
    // porovnat s ní instanční overlay by ohlásilo „nesoulad", jehož příčinou
    // jsou chybějící vstupy, ne overlay (změřeno 2026-09-13: jen
    // AISHA_INSTANCE_CONFIG_DIR bez PUBLIC_TLD → api.aisha.example.com proti
    // api.<instance>). Taková topologie se nesrovnává — ale NAHLAS, ne mlčky;
    // produkční cesty (cold-start, env-doktor) TLD deklarují.
    if (overlayPovrchu && topo.referencni_domeny?.includes("PUBLIC_TLD")) {
      process.stderr.write(
        `[derive-domains] WARN overlay povrchu NEZMĚŘENO: PUBLIC_TLD je z referenčního .json.example, ` +
          `ne od instance — ${overlayPovrchu.soubor} nelze porovnat s referenční topologií\n`,
      );
    } else if (overlayPovrchu) {
      const { nesoulady, nezmereno } = nesouladyPovrchu({
        ...overlayPovrchu,
        prefix: hodnota("APP_NAME_PREFIX"),
        apiDomena: hodnota("API_DOMAIN_PUBLIC"),
        keycloakDomena: hodnota("KEYCLOAK_DOMAIN_PUBLIC"),
        restPrefix: gatewayRestPrefix(ROOT),
        realm: (process.env.KEYCLOAK_REALM ?? "").trim(),
      });
      if (nesoulady.length > 0) {
        throw new Error(
          `overlay povrchu se rozchází s derivací topologie — povrch by se postavil s adresami, ` +
            `které platforma nevydává (cizí IdP / klient, kterého provision-surfaces nezaloží, ` +
            `issuer, který gateway odmítne):\n  ${nesoulady.join("\n  ")}\n` +
            `  Oprav app.config.json v instančním repu, nebo deklaraci, ze které se derivace počítá.`,
        );
      }
      for (const n of nezmereno) {
        process.stderr.write(`[derive-domains] WARN overlay povrchu NEZMĚŘENO: ${n}\n`);
      }
    }
  }

  // Roster SCHVÁLENÝCH tabletů pro dveře (2026-09-28). Adresa brány je TÁŽ,
  // kterou vydává katalog ostatním konzumentům (`AISHA_GATEWAY_URL`, mesh jméno)
  // — žádný druhý domov téže adresy. Bez ní u ostrých dveří derivace skončí.
  {
    let roster = "";
    if (rosterTabletu) {
      const radek = [...lines].reverse().find((l) => l.startsWith("AISHA_GATEWAY_URL="));
      const brana = (radek ?? "").slice("AISHA_GATEWAY_URL=".length).replace(/\/+$/, "");
      if (!brana) {
        throw new Error("roster tabletů pro dveře: derivace nevydala AISHA_GATEWAY_URL (katalog, služba core)");
      }
      roster = `${brana}/internal/knock/roster`;
    }
    lines.push(`SPA_OPERATORS_URL=${roster}`);
    lines.push(`SPA_OPERATORS_VERSION_URL=${roster ? `${roster}/version` : ""}`);
  }

  return collapseDuplicateEmissions(lines).map(shellQuoteLine).join("\n");
}

/**
 * Hodnota v sourcovaném souboru MUSÍ být shell-safe.
 *
 * Tenhle výstup se třemi místy `.`-sourcuje (aisha-cold-start.sh,
 * coolify-deploy-init.sh, lib/resolve-domains-env.sh), takže „bash-sourceable
 * export lines" z hlavičky souboru je SLIB. Rozbil se, jakmile začaly vznikat
 * strukturované hodnoty: `<ID>_MESH_INGRESS_ROUTES=3000|host|kontejner:3000;…`
 * shell přečte jako rouru a středník. Pod `set -e` to skript rovnou ukončí —
 * naměřeno 2026-07-29: `coolify-deploy-init.sh --stack web` zemřel na
 * `postgrest.mesh.riq.internal: command not found`, takže po nasazení nešel
 * synchronizovat env ANI udělat cold start.
 *
 * Uvozuje se MINIMÁLNĚ — jen hodnota, která bez uvozovek bezpečná není. Stejné
 * pravidlo má `shlex.quote` i `printf %q`: rozhoduje ZNAKOVÁ TŘÍDA hodnoty, ne
 * jméno klíče, takže to není výjimka podle pravopisu — cokoli nového s `|`,
 * mezerou či středníkem se uvozuje samo. Zároveň tím zůstávají všechny dosavadní
 * hodnoty (hostnames, URL) byte-identické, což je záměr: jedenáct bran čte
 * `KEY=hodnota` přímo a měnit jim vstup kvůli formátu by byl zbytečný ruch.
 *
 * Ověřeno, že to stačí: v celém výstupu není hodnota spoléhající na expanzi při
 * sourcování (0 výskytů `$`), takže uvozovkám nic nepadne za oběť.
 */
const SHELL_SAFE_VALUE = /^[A-Za-z0-9_@%+=:,./-]*$/;

function shellQuoteLine(line) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/);
  if (!m) return line; // komentář nebo prázdno
  const [, key, value] = m;
  if (SHELL_SAFE_VALUE.test(value)) return line;
  return `${key}='${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * Jeden klíč = jeden řádek.
 *
 * PROČ: `env_aliases` v katalogu smí přidat jméno, ale když se alias trefí do
 * jména, které se z id služby odvozuje automaticky (`svc-blockchain` →
 * `SVC_BLOCKCHAIN_URL`), vydá se týž klíč dvakrát. Hodnota je stejná, takže se
 * nic nerozbije — ale KTERÁ vyhraje, závisí na tom, kdo soubor parsuje, a to
 * je vlastnost, kterou nechceme mít v základu.
 *
 * Shodné vydání se proto tiše sloučí. ROZPORNÉ se nesloučí: dvě různé hodnoty
 * pod jedním jménem znamenají, že katalog říká dvě věci najednou, a poslední
 * vítěz by tu nejednoznačnost jen schoval. Změřeno 2026-07-29: 0 rozporů, 1
 * shodná duplicita — tahle větev tedy zatím nikdy nepadne, a když padne, je to
 * nález, ne porucha.
 */
function collapseDuplicateEmissions(lines) {
  const valueOf = new Map();
  const out = [];
  const conflicts = [];
  for (const line of lines) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=([\s\S]*)$/);
    if (!m) { out.push(line); continue; }
    const [, key, value] = m;
    if (!valueOf.has(key)) { valueOf.set(key, value); out.push(line); continue; }
    if (valueOf.get(key) !== value) conflicts.push(`${key}: '${valueOf.get(key)}' × '${value}'`);
  }
  if (conflicts.length) {
    throw new Error(
      `derivace vydává týž klíč s RŮZNÝMI hodnotami — katalog si odporuje:\n  ${conflicts.join("\n  ")}`,
    );
  }
  return out;
}

// ── CLI entrypoint ──────────────────────────────────────────────────────────
// Strážce vstupu má jeden domov: lib/cli-entry.mjs. Dřív tu stálo porovnání
// `import.meta.url === `file://${process.argv[1]}`` — to je ale porovnání
// ZÁPISU cesty: URL je percent-enkódovaná, argv[1] syrový. Na cestě s
// diakritikou se rozejdou a blok se TIŠE přeskočí (naměřeno 2026-08-14:
// resolver vydal 0 bajtů s kódem 0 a shodil tím dvanáct bran).
const isMain = isDirectRun(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const flag = (n) => argv.includes(n);
  const arg = (n) => {
    const m = argv.find((a) => a.startsWith(n + "="));
    return m ? m.slice(n.length + 1) : null;
  };

  const profileId = arg("--profile") ?? (process.env.AISHA_PROFILE ?? "").trim() ?? "";
  const mesh = arg("--mesh");
  const meshEnabled = mesh ? ["on", "true", "1", "yes"].includes(mesh) : undefined;

  const topo = buildTopology({ profileId, meshEnabled });

  if (flag("--check")) {
    const issues = checkTopology(topo);
    // Pokrytí manifestu se ověřuje JEN když volající manifest jmenuje. Bez něj
    // by kontrola buď hádala cestu, nebo tiše prošla — a tichý průchod je právě
    // to, co 2026-09-04 pustilo `netbird.aisha.example.com` do produkce.
    const manifestPath = arg("--manifest");
    if (manifestPath) {
      if (!existsSync(manifestPath)) {
        issues.push(`--manifest ${manifestPath} neexistuje — pokrytí manifestu se NEZMĚŘILO`);
      } else {
        // Ráčna: uznaný dluh mlčí, NOVÝ výskyt křičí, OPRAVENÝ musí ze seznamu
        // zmizet (jinak baseline tvrdí dluh, který už neexistuje). Týž tvar jako
        // mesh-inside-edge-outside.baseline.json.
        const sluzby = loadCatalog().services ?? {};
        const text = readFileSync(manifestPath, "utf8");
        const now = manifestCoverageOffenders(topo, text, sluzby);
        const vManifestu = new Set(
          [...text.matchAll(/^app:\s*([a-z0-9-]+):/gm)].map((m) => m[1]),
        );
        const bl = manifestCoverageBaseline();
        for (const [klic, popis] of [["bezKatalogu", "bez_katalogu"], ["mimoProfil", "mimo_profil"]]) {
          const znamé = new Set(bl[popis] ?? []);
          const nove_ = now[klic].filter((x) => !znamé.has(x));
          // ⛔ „SPLACENO" SMÍ TVRDIT JEN MANIFEST, KTERÝ TU APLIKACI JMENUJE.
          // Baseline je globální, ale nálezy jsou PER MANIFEST: <fork>.manifest
          // o `pgadmin` nic neví, takže z jeho mlčení NEPLYNE, že je dluh splacen.
          // Naměřeno hned při zapojení: bez téhle podmínky hlásil <fork> všech pět
          // jako „už NENÍ vada" — porovnání proti jinému vesmíru, než jaký se měří.
          // Táž třída jako celý incident, kvůli kterému ráčna vznikla.
          const opravene = [...znamé].filter((x) => vManifestu.has(x) && !now[klic].includes(x));
          for (const x of nove_) {
            issues.push(
              klic === "bezKatalogu"
                ? `manifest zakládá '${x}', ale config/services.json ho vůbec nezná — bez katalogové deklarace pro něj resolver nemá co odvodit`
                : `manifest zakládá '${x}', ale profil '${topo.profile}' ho do topologie nepustil (tier_filter/exclude) — doplň ho do 'include', jinak zůstane BEZ adresy a spadne až u spotřebitele`,
            );
          }
          for (const x of opravene) {
            issues.push(
              `'${x}' je v ${popis} baseline, ale už NENÍ vada — splacený dluh musí ze seznamu zmizet ` +
                `(node scripts/gen-manifest-coverage-baseline.mjs --write), jinak baseline lže`,
            );
          }
        }
      }
    }
    if (issues.length === 0) {
      console.log(`✓ topology valid (profile=${topo.profile}, mesh=${topo.mesh_enabled ? "ON" : "OFF"}, ${Object.keys(topo.services).length} services${manifestPath ? `, manifest pokryt` : `, manifest NEMĚŘEN`})`);
      process.exit(0);
    }
    console.error(`✗ topology has ${issues.length} issue(s):`);
    for (const i of issues) console.error(`  - ${i}`);
    process.exit(1);
  }

  if (flag("--shell")) {
    console.log(formatShellExports(topo));
    process.exit(0);
  }

  // Default: JSON
  console.log(JSON.stringify(topo, null, 2));
}
