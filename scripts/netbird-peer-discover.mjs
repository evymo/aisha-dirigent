#!/usr/bin/env node
/**
 * netbird-peer-discover.mjs — query NetBird Management API for peer IPs.
 *
 * Authenticates via the `aisha-bootstrap` Keycloak user token — a REAL realm
 * user, tedy někdo, koho IdP vidí. Emituje seznam peerů buď jako JSON, nebo
 * jako `KEY=value` řádky pro shell.
 *
 * ⛔ ÚSTUP NA `client_credentials` TU BÝVAL A BYL ODSTRANĚN (2026-08-20).
 * Servisní účet je pro IdP neviditelný, takže by dostal 403, a na prázdném
 * datastoru by se navíc NEVRATNĚ stal vlastníkem účtu. Viz `getAuthHeader()`.
 *
 * ⛔ A NEPŘIDÁVEJ SEM „LOKÁLNÍ ZDROJ" ČTOUCÍ PEERY PŘES DOCKER (zkusil jsem
 * to 2026-08-21). Adresu sice vrátí, ale obchází tím mesh i management API a
 * v cold-startu, kde žádné ssh ani cizí docker není, nefunguje vůbec. Když
 * management API odmítá, je vada V IDENTITĚ, kterou mu posíláme — a ta se
 * opravuje v `aisha-bootstrap-user-init.sh`, ne náhradním zdrojem dat.
 *
 * Use cases:
 *   1. Cold-start orchestration: discover peer IPs after stacks deploy,
 *      then propagate to Coolify env vars for downstream stacks (edge
 *      mesh-proxies need core peer IP for /etc/hosts entries).
 *   2. Manual operator runs: `npm run mesh:discover` to inspect mesh state.
 *
 * Env required:
 *   NETBIRD_API_URL                 — e.g. https://netbird.example.com
 *   KEYCLOAK_DOMAIN_PUBLIC          — VEŘEJNÁ tvář auth (auth.example.com).
 *                                     Tenhle nástroj běží MIMO mesh, takže
 *                                     vnitřní KEYCLOAK_URL se odsud nepřeloží;
 *                                     `KEYCLOAK_PUBLIC_URL` je výslovný override.
 *   KEYCLOAK_REALM                  — e.g. aisha
 *   NETBIRD_KEYCLOAK_CLIENT_ID      — Keycloak service-account client (default `netbird-backend`)
 *   NETBIRD_MGMT_SECRET             — Keycloak service-account secret
 *   AISHA_BOOTSTRAP_PASSWORD        — POVINNÉ (není „optional"): vlastník účtu
 *   AISHA_BOOTSTRAP_CLIENT_SECRET   — POVINNÉ: tentýž pár, ROPC klient
 *                                     Obojí vyrábí `aisha-bootstrap-user-init.sh`;
 *                                     po wipe je drží `generate-secrets.mjs`
 *                                     přes `emit(preservedValue(...))`.
 *
 * Fallback: if NETBIRD_AUTH_SCHEME=Token + NETBIRD_API_TOKEN, uses static token.
 *
 * Usage:
 *   node scripts/netbird-peer-discover.mjs                # KEY=value lines
 *   node scripts/netbird-peer-discover.mjs --json         # full JSON
 *   node scripts/netbird-peer-discover.mjs --hostname X   # one peer by hostname
 *
 * Output format (default, sourceable):
 *   CORE_MESH_IP=100.64.0.5
 *   EDGE_MESH_IP=100.64.0.6
 *   ...
 *
 * Hostname → env-key mapping:
 *   - Strips common prefixes (`aisha-`, `frontend-`, `backend-`, `experimental-`)
 *   - Replaces dashes with underscores
 *   - Uppercase + suffix _MESH_IP
 *   - Examples:
 *       frontend-edge        → EDGE_MESH_IP
 *       aisha-backend-host   → BACKEND_HOST_MESH_IP   (legacy; future: CORE_MESH_IP)
 *       core              → CORE_MESH_IP
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnvFile, readConfigKey } from "./lib/config-env-files.mjs";
// Domov pomocníka je sdílená lib — lokální kopie se rozejdou (viz
// mesh-api-se-vola-tvari-ktera-obsluhuje.gate).
import { tvarKteraObsluhuje } from "./lib/netbird-auth.mjs";
import { klicMeshIp, meshIpKlice, nejlepsiPeerPodleJmena } from "./lib/mesh-peers.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const arg = (name, fallback = "") => {
  const m = argv.find((a) => a.startsWith(`${name}=`));
  return m ? m.slice(name.length + 1) : fallback;
};
const hostnameFilter = arg("--hostname") || (() => {
  const idx = argv.indexOf("--hostname");
  return idx >= 0 && argv[idx + 1] && !argv[idx + 1].startsWith("--") ? argv[idx + 1] : "";
})();
const JSON_OUTPUT = flag("--json");
const QUIET = flag("--quiet");

function backendClientId() {
  const explicit = process.env.NETBIRD_KEYCLOAK_CLIENT_ID || process.env.NETBIRD_BACKEND_CLIENT_ID;
  if (explicit) return explicit;

  // NETBIRD_OIDC_CLIENT_ID is the dashboard/frontend client in compose.
  // Treat that value as absent so operator shells sourced from .env.coolify
  // still use the M2M service-account client for Management API calls.
  if (process.env.NETBIRD_OIDC_CLIENT_ID && process.env.NETBIRD_OIDC_CLIENT_ID !== "netbird") {
    return process.env.NETBIRD_OIDC_CLIENT_ID;
  }

  return "netbird-backend";
}

/**
 * STANOVIŠTĚ: tenhle nástroj běží na OPERÁTORSKÉM stroji — volá ho vlnový
 * běhec (aisha-redeploy.mjs) i coolify-mesh-sync.mjs, oba mimo mesh. Právě
 * proto se ptá NetBirdu, KDE mesh je; kdyby v mesh byl, nemusel by se ptát.
 *
 * Z toho plyne, kterou tvář Keycloaku smí použít: VEŘEJNOU. `KEYCLOAK_URL`
 * v .env.coolify nese vnitřní jméno (naměřeno na aishe:
 * https://aisha-auth.mesh.aisha.internal), které se zvenčí nepřeloží — a
 * protože bylo první v pořadí, přebilo i správnou hodnotu. Veřejná tvář má
 * vlastní klíč `KEYCLOAK_DOMAIN_PUBLIC` (auth.<public-tld>), takže se nic
 * neodvozuje ani nehádá: bere se deklarovaná adresa pro tohle stanoviště.
 *
 * Pořadí: výslovný operátorský override → veřejná tvář → co dal volající.
 */
function keycloakUrlProOperatora() {
  const explicit = (process.env.KEYCLOAK_PUBLIC_URL || "").trim();
  if (explicit) return explicit;
  const publicDomain = readConfigKey("KEYCLOAK_DOMAIN_PUBLIC");
  if (publicDomain) return `https://${publicDomain}`;
  return (process.env.KEYCLOAK_URL || "").trim();
}

// ⛔ ŽÁDNÝ FALLBACK (2026-08-25). Tímhle realmem se razí token, kterým se čte
// seznam mesh peerů. Dosazený realm znamená token odjinud — a projeví se to jako
// „mesh discovery neodpovídá", tedy jako vada meshe, ne jako vada identity.
//
// Kontroluje se AŽ PŘI POUŽITÍ, ne při načtení modulu: chybějící konfigurace má
// v tomhle skriptu jeden dohodnutý tvar — throw uvnitř fetchPeers(), který main()
// chytí a ukončí EXIT 2 s čitelnou hláškou. Throw na úrovni modulu by ten kanál
// obešel a instance by dostala exit 1 bez vysvětlení.
//
// ⛔ NAMĚŘENO 2026-09-13 (doktor, fáze N): „mesh: shoda pohledů NEZMĚŘENA —
// [netbird-peer-discover] sonda Keycloaku přeskočena: KEYCLOAK_REALM není
// deklarovaná". Deklarovaná BYLA — v `.env.coolify` instance. Jenže realm se tu
// četl JEN z prostředí, zatímco sourozenecké klíče téhož dotazu (NETBIRD_DOMAIN,
// KEYCLOAK_DOMAIN_PUBLIC, *_DOMAIN_DIRECT) se čtou z konfiguračního řetězu přes
// readConfigKey. Doktor `.env.coolify` nesourcuje (načítá .env.local a
// .env-prod-backup, a v tom realm není), takže adresu dostal a jméno realmu ne.
// Prošel jen volající, který si prostředí skládá sám (aisha-redeploy.mjs).
//
// Realm proto chodí TOUŽ cestou jako ostatní klíče tohohle nástroje: výslovně
// exportovaná hodnota má přednost, jinak řetěz deklarací. Pořád žádný literál —
// nenajde-li se nikde, selže to nahlas jako dřív.
function keycloakRealmProOperatora() {
  const zProstredi = (process.env.KEYCLOAK_REALM || "").trim();
  const realm = zProstredi || readConfigKey("KEYCLOAK_REALM");
  if (!realm) {
    throw new Error(
      "KEYCLOAK_REALM není deklarovaná (prostředí ani konfigurační řetěz " +
        "config/domains.env → .env.coolify → .env.local → .env-prod-backup → .env.aisha) — " +
        "jméno realmu je identita instance a nedosazuje se.",
    );
  }
  return realm;
}

const cfg = {
  netbirdApiUrl: process.env.NETBIRD_API_URL,
  keycloakUrl: keycloakUrlProOperatora(),
  get keycloakRealm() {
    return keycloakRealmProOperatora();
  },
  oidcClientId: backendClientId(),
  oidcClientSecret: process.env.NETBIRD_MGMT_SECRET,
  bootstrapClientId: process.env.AISHA_BOOTSTRAP_CLIENT_ID || "aisha-bootstrap",
  bootstrapClientSecret: process.env.AISHA_BOOTSTRAP_CLIENT_SECRET,
  bootstrapUsername: process.env.AISHA_BOOTSTRAP_USERNAME || "aisha-bootstrap",
  bootstrapPassword: process.env.AISHA_BOOTSTRAP_PASSWORD,
  apiToken: process.env.NETBIRD_API_TOKEN,
  authScheme: process.env.NETBIRD_AUTH_SCHEME || "Bearer",
};

// Doplnění z konfiguračního řetězu, když prostředí mlčí. Čte se přes
// lib/config-env-files.mjs — jediný domov toho parseru; ten mimo jiné ví, že
// nerozvinutá šablona (`${KEYCLOAK_DOMAIN:-}`) NENÍ hodnota. Dřív se tu
// config/domains.env četl vlastním parserem, ten šablonu vrátil jako text,
// truthiness na ní prošla a do adresy doputoval literál.
if (!cfg.netbirdApiUrl) {
  const netbirdDomain = readConfigKey("NETBIRD_DOMAIN");
  if (netbirdDomain) cfg.netbirdApiUrl = `https://${netbirdDomain}`;
}
if (!cfg.oidcClientSecret) {
  // AISHA_ENV_BACKUP_FILE: overridable secret-backup path (isolation seam).
  // Tests point it at a nonexistent file so the "secrets missing" fail-fast
  // path is asserted against a truly empty environment — a populated operator
  // vault (.env-prod-backup after a reverse-sync) must not change test behavior.
  const backupFile = process.env.AISHA_ENV_BACKUP_FILE || resolve(ROOT, ".env-prod-backup");
  const backup = parseEnvFile(backupFile);
  cfg.oidcClientSecret = backup.NETBIRD_MGMT_SECRET || cfg.oidcClientSecret;
}

function logErr(msg) {
  if (!QUIET) process.stderr.write(`[netbird-peer-discover] ${msg}\n`);
}

async function fetchWithTimeout(url, init = {}, timeoutMs = 10_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (err) {
    // Chyba, která neřekne KAM to šlo, se nedá vyšetřit: „fetch failed: fetch
    // failed" vypadá stejně pro překlep, pro nedostupnou vnitřní adresu i pro
    // spadlou službu. Adresa se do hlášky vrací bez query (tam bývají tajemství).
    const kam = String(url).split("?")[0];
    throw new Error(`${err?.message ?? err} — ${kam}`);
  } finally {
    clearTimeout(timer);
  }
}

async function getKeycloakToken() {
  if (!cfg.oidcClientSecret) throw new Error("NETBIRD_MGMT_SECRET not set (Keycloak client_credentials)");
  if (!cfg.keycloakUrl)
    throw new Error(
      "adresa Keycloaku pro OPERÁTORSKÉ stanoviště není deklarovaná — " +
        "čekám KEYCLOAK_DOMAIN_PUBLIC (veřejná tvář) nebo KEYCLOAK_PUBLIC_URL; " +
        "vnitřní KEYCLOAK_URL se odsud nepřeloží",
    );
  const tokenUrl = `${cfg.keycloakUrl.replace(/\/+$/, "")}/realms/${cfg.keycloakRealm}/protocol/openid-connect/token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: cfg.oidcClientId,
    client_secret: cfg.oidcClientSecret,
  });
  const res = await fetchWithTimeout(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Keycloak token request failed: HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  if (!json.access_token) throw new Error("Keycloak response missing access_token");
  return json.access_token;
}

async function getBootstrapUserToken() {
  if (!cfg.bootstrapClientSecret || !cfg.bootstrapPassword) return "";
  if (!cfg.keycloakUrl)
    throw new Error(
      "adresa Keycloaku pro OPERÁTORSKÉ stanoviště není deklarovaná — " +
        "čekám KEYCLOAK_DOMAIN_PUBLIC (veřejná tvář) nebo KEYCLOAK_PUBLIC_URL; " +
        "vnitřní KEYCLOAK_URL se odsud nepřeloží",
    );
  const tokenUrl = `${cfg.keycloakUrl.replace(/\/+$/, "")}/realms/${cfg.keycloakRealm}/protocol/openid-connect/token`;
  const body = new URLSearchParams({
    grant_type: "password",
    client_id: cfg.bootstrapClientId,
    client_secret: cfg.bootstrapClientSecret,
    username: cfg.bootstrapUsername,
    password: cfg.bootstrapPassword,
    scope: "openid",
  });
  const res = await fetchWithTimeout(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // 401 znamená neplatné heslo NEBO uživatele zamčeného brute-force ochranou realmu —
    // Keycloak odpovídá v obou případech stejně. Opakovaný pokus zámek prodlužuje,
    // proto se to říká tady, u zdroje (volající v redeployi pak v běhu nezkouší znovu).
    const napoveda = res.status === 401
      ? " — neplatné heslo, NEBO uživatel zamčený brute-force ochranou (v logu Keycloaku user_temporarily_disabled); nezkoušej hned znovu, zámek se prodlužuje"
      : "";
    throw new Error(`Keycloak bootstrap token request failed: HTTP ${res.status}: ${text.slice(0, 200)}${napoveda}`);
  }
  const json = await res.json();
  if (!json.access_token) throw new Error("Keycloak bootstrap response missing access_token");
  return json.access_token;
}

async function getAuthHeader() {
  if (cfg.authScheme === "Token") {
    if (!cfg.apiToken) throw new Error("NETBIRD_API_TOKEN required for Token auth");
    return `Token ${cfg.apiToken}`;
  }
  const bootstrapToken = await getBootstrapUserToken();
  if (bootstrapToken) {
    return `Bearer ${bootstrapToken}`;
  }
  // ⛔ ZDE BÝVAL ÚSTUP NA client_credentials (servisní účet mesh backendu).
  // NAMĚŘENO 2026-08-20: ten ústup nejenže nemůže uspět, on škodí.
  //
  // 1. Nemůže uspět: mesh management si uživatele ověřuje proti VÝPISU
  //    uživatelů z Keycloaku, a servisní účty v něm nejsou. Hlásí proto
  //    "not found in IDP" a odpoví 403 "user is pending approval".
  // 2. Škodí NEVRATNĚ: první ověřený dotaz na prázdný datastore ZAKLÁDÁ účet
  //    a zapisuje volajícího jako vlastníka. Tichý ústup tím účet natrvalo
  //    zapíše na identitu, kterou IdP nikdy neuvidí — a schválit ji nemá kdo,
  //    protože jediný, kdo by mohl, je právě ona.
  //
  // Navenek to vypadá jako "čeká se na schválení", takže se čeká. Jenže tenhle
  // stav se čekáním nezmění a příčina je o dvě vrstvy jinde: chybějící
  // pověření bootstrap uživatele po wipe.
  //
  // Nejistota znamená STOP, ne náhradní identitu.
  if (cfg.oidcClientSecret) {
    throw new Error(
      "Pověření bootstrap uživatele chybí (AISHA_BOOTSTRAP_PASSWORD + AISHA_BOOTSTRAP_CLIENT_SECRET).\n" +
        "  NEUSTUPUJI na client_credentials: servisní účet je pro IdP neviditelný, dostal by 403\n" +
        "  'user is pending approval' — a na prázdném datastoru by se navíc stal VLASTNÍKEM účtu,\n" +
        "  což je nevratné a schválit ho nemá kdo.\n" +
        "  CO S TÍM: spusť scripts/aisha-bootstrap-user-init.sh (vyrobí uživatele i obě pověření\n" +
        "  a zapíše je do env), pak tenhle nástroj znovu.\n" +
        "  NEDĚLEJ: nedosazuj NETBIRD_API_TOKEN 'aby to prošlo' — statický token je jiná identita\n" +
        "  a vlastnictví účtu neřeší.",
    );
  }
  if (cfg.apiToken) {
    return `Bearer ${cfg.apiToken}`;
  }
  throw new Error("Need AISHA_BOOTSTRAP_PASSWORD/AISHA_BOOTSTRAP_CLIENT_SECRET, NETBIRD_MGMT_SECRET, or NETBIRD_API_TOKEN");
}


async function fetchPeers() {
  if (!cfg.netbirdApiUrl) throw new Error("NETBIRD_API_URL not set");
  // Obě tváře se vyberou AŽ TADY, při použití — stejně jako se tu kontroluje realm.
  //
  // ⛔ SONDA NESMÍ PŘEPSAT DIAGNOSTIKU. `cfg.keycloakRealm` je fail-loud getter:
  // při nedeklarovaném realmu VYHODÍ. Kdyby se to nechalo probublat odsud, chyba
  // by mluvila o realmu i tehdy, když ve skutečnosti chybí NETBIRD_MGMT_SECRET —
  // a `getAuthHeader()` níž má na to vlastní, přesnější hlášku. Sonda je proto
  // NEPOVINNÁ: když si nemá čím sestavit dotaz, mlčky ustoupí a nechá selhat
  // toho, kdo umí říct proč. (Naměřeno bránou `netbird-peers` 2026-08-28.)
  try {
    cfg.keycloakUrl = await tvarKteraObsluhuje(
      cfg.keycloakUrl,
      readConfigKey("KEYCLOAK_DOMAIN_DIRECT"),
      `/realms/${cfg.keycloakRealm}/.well-known/openid-configuration`,
      "Keycloak",
      "netbird-peer-discover",
    );
  } catch (e) {
    // Sonda ustupuje, ale NE mlčky: zaznamená DŮVOD a nechá vyslovit diagnózu
    // toho, kdo ji umí říct přesněji (getAuthHeader). Tichý `catch {}` by z
    // téhle větve udělal slepé místo — viz silent-degradation.gate.
    console.error(`[netbird-peer-discover] sonda Keycloaku přeskočena: ${String(e?.message || e).split("\n")[0]}`);
  }
  cfg.netbirdApiUrl = await tvarKteraObsluhuje(
    cfg.netbirdApiUrl,
    readConfigKey("NETBIRD_DOMAIN_DIRECT"),
    "/api/peers",
    "NetBird",
    "netbird-peer-discover",
  );
  const auth = await getAuthHeader();
  const url = `${cfg.netbirdApiUrl.replace(/\/+$/, "")}/api/peers`;
  const res = await fetchWithTimeout(url, {
    headers: { Authorization: auth, Accept: "application/json" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`NetBird API GET /api/peers => HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error("NetBird /api/peers did not return array");
  return data;
}

/**
 * Jméno peera → klíč adresy služby. Pravidlo (i proč jsou prefixy
 * `frontend-`/`backend-`/`experimental-` jen historické) žije v
 * `lib/mesh-peers.mjs`; tady se jen používá.
 */
const envKeyForHostname = klicMeshIp;

async function main() {
  let peers;
  try {
    peers = await fetchPeers();
  } catch (err) {
    logErr(`fetch failed: ${err.message}`);
    process.exit(2);
  }

  if (hostnameFilter) {
    // Po re-enrollmentu drží management víc záznamů téhož jména — `find` by vzal
    // první v pořadí API, klidně odpojený. Vybírá se podle lib/mesh-peers.mjs.
    const peer = nejlepsiPeerPodleJmena(peers.filter((p) => p.hostname === hostnameFilter || p.name === hostnameFilter))
      .values().next().value;
    if (!peer) {
      logErr(`peer not found: ${hostnameFilter}`);
      process.exit(1);
    }
    if (JSON_OUTPUT) {
      console.log(JSON.stringify(peer, null, 2));
    } else {
      console.log(`${envKeyForHostname(peer.hostname || peer.name)}=${peer.ip}`);
    }
    return;
  }

  if (JSON_OUTPUT) {
    console.log(JSON.stringify(peers.map((p) => ({
      id: p.id,
      hostname: p.hostname,
      name: p.name,
      ip: p.ip,
      connected: p.connected,
      groups: (p.groups || []).map((g) => g.name),
      lastSeen: p.last_seen,
    })), null, 2));
    return;
  }

  // Default: sourceable KEY=value — KAŽDÝ klíč právě jednou, vybraný
  // deterministicky (lib/mesh-peers.mjs). Dřív šel ven řádek za každého peera,
  // takže duplicitní jména i kolize prefixů dávaly víc řádků téhož klíče a
  // „platil" ten poslední v pořadí API.
  const { klice, nejednoznacne } = meshIpKlice(peers);
  for (const [klic, ip] of klice) console.log(`${klic}=${ip}`);
  for (const [klic, jmena] of nejednoznacne) {
    logErr(`${klic} nevydán — nejednoznačný, patří jménům: ${jmena.join(", ")}`);
  }
}

main().catch((err) => {
  logErr(err.message || String(err));
  process.exit(2);
});
