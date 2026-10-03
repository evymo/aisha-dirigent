#!/usr/bin/env node
/**
 * coolify-mesh-sync.mjs — propagate NetBird mesh peer IPs into Coolify env.
 *
 * Pipeline:
 *   1. Calls `netbird-peer-discover.mjs --json` to enumerate enrolled peers.
 *   2. For each Coolify app declared in the contract below, computes which
 *      peer IPs should appear as env vars (e.g., BACKEND_MESH_IP for the edge
 *      stack so /etc/hosts via `extra_hosts:` resolves backend.mesh.aisha.internal).
 *   3. Reads current Coolify env via `GET /applications/{uuid}/envs`,
 *      patches via `PATCH /applications/{uuid}/envs/bulk` only when drift.
 *
 * Idempotent. Safe to re-run. Default mode is read-only (--check); pass
 * --apply to actually patch Coolify.
 *
 * Env required:
 *   COOLIFY_API_TOKEN         — same as coolify-domain-doctor.mjs
 *   COOLIFY_BASE_URL          — required (Coolify API base URL)
 *   NETBIRD_MGMT_SECRET       — for downstream netbird-peer-discover.mjs
 *   KEYCLOAK_URL, KEYCLOAK_REALM, NETBIRD_API_URL — same as discover script
 *
 * Usage:
 *   node scripts/coolify-mesh-sync.mjs                    # check only
 *   node scripts/coolify-mesh-sync.mjs --apply            # patch Coolify
 *   node scripts/coolify-mesh-sync.mjs --json             # JSON report
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createProjectScope } from "./lib/coolify-project-scope.mjs";
import { resolveInstancePrefix } from "./lib/coolify-instance-scope.mjs";
import { createCoolifyClient } from "./lib/coolify-http.mjs";
import { nejlepsiPeerPodleJmena } from "./lib/mesh-peers.mjs";

// Instance identity comes from the shared boundary (lib/coolify-instance-scope.mjs),
// the same one coolify-drift-check.mjs and coolify-story-init.sh use — one place,
// never re-derived per tool.
const instancePrefix = () => resolveInstancePrefix();
const APP_PREFIX = instancePrefix();

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const APPLY = flag("--apply");
const JSON_OUTPUT = flag("--json");

function loadEnvFile(p) {
  if (!existsSync(p)) return {};
  const env = {};
  for (const line of readFileSync(p, "utf-8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    let raw = m[2];
    if (!raw.startsWith('"') && !raw.startsWith("'")) {
      const h = raw.indexOf(" #");
      if (h >= 0) raw = raw.slice(0, h);
    }
    env[m[1]] = raw.trim().replace(/^['"]|['"]$/g, "");
  }
  return env;
}

function loadCoolifyToken() {
  if (process.env.COOLIFY_API_TOKEN) return process.env.COOLIFY_API_TOKEN.replace(/^['"]|['"]$/g, "");
  const f = resolve(ROOT, ".env-prod-backup");
  if (!existsSync(f)) return "";
  for (const line of readFileSync(f, "utf-8").split(/\r?\n/)) {
    if (line.startsWith("COOLIFY_API_TOKEN=")) {
      return line.slice("COOLIFY_API_TOKEN=".length).trim().replace(/^['"]|['"]$/g, "");
    }
  }
  return "";
}

const token = loadCoolifyToken();
const baseUrlEnv = process.env.COOLIFY_BASE_URL;
if (!baseUrlEnv) {
  process.stderr.write("FATAL: COOLIFY_BASE_URL required (set in .env-prod-backup)\n");
  process.exit(2);
}
const base = baseUrlEnv.replace(/\/$/, "");

if (!token) {
  console.error("COOLIFY_API_TOKEN not found");
  process.exit(2);
}

/**
 * Contract: which Coolify app needs which mesh IP env vars.
 *
 * Format: { app: "<coolify-app-name>", envs: ["BACKEND_MESH_IP", ...] }
 *
 * Discovery output keys are derived from peer hostname (see envKeyForHostname
 * in netbird-peer-discover.mjs). For legacy hostnames we currently expect:
 *   - aisha-backend-host  → BACKEND_HOST_MESH_IP
 *   - frontend-edge       → EDGE_MESH_IP
 *   - experimental-cosmos     → COSMOS_MESH_IP
 *
 * After Phase 2 rename to functional roles, the keys become CORE_MESH_IP,
 * EDGE_MESH_IP, LEDGER_MESH_IP, INTEGRATION_MESH_IP. Update this contract
 * during the rename PR.
 *
 * For now we expose all discovered peer IPs to all apps that need cross-mesh
 * reach — overkill but harmless (extra env vars don't break anything).
 */
// Jméno apky je <prefix>-<role>, ne literál. Prefix nese instance (.env.coolify
// APP_NAME_PREFIX), protože na sdíleném Coolify je "aisha-edge" cizí produkce —
// táž oprava, kterou už prošel pki-bridge-deploy.mjs ("running this from the RIQ
// worktree wrote RIQ's credentials into aisha-pki"). Tenhle nástroj jí neprošel,
// takže na KAŽDÉM forku hlásil `missing app` a CORE_MESH_IP se nikdy nevyplnil —
// mesh-router pak sestavil DNAT `--to-destination :3001`, tedy pravidlo BEZ CÍLE,
// a api odpovídalo 502 bez jediné stopy v logu. Měřeno 2026-07-29 na riq.
const ENV_CONTRACT = [
  {
    role: "edge",
    // Edge needs backend peer IP for extra_hosts → mcp/db-mesh-proxy /etc/hosts
    envs: ["BACKEND_MESH_IP", "BACKEND_HOST_MESH_IP", "CORE_MESH_IP"],
  },
];

// ⛔ TENHLE SKRIPT SI VOZIL VLASTNÍHO KLIENTA BEZ JAKÉHOKOLI OPAKOVÁNÍ — a běží
// ve fázi D2 cold-startu, tedy přesně tam, kde je fronta nasazení plná a
// rozpočet požadavků (200/okno) vyčerpaný. První 429 ho složil. Sdílený klient
// 429 rozlišuje (rate-limit × plná fronta) a ctí `Retry-After`.
//
// Původní TIMEOUT_MS bylo 10 s. To je přesně ta hodnota, kvůli které
// coolify-http.mjs vznikl: Coolify v4 má úseky 20–40 s pomalosti a 10s
// jednorázový fetch z nich dělá falešné AbortError.
const coolify = createCoolifyClient({ baseUrl: base, token });

function discoverPeers() {
  const fileEnv = {
    ...loadEnvFile(resolve(ROOT, ".env.coolify")),
    ...loadEnvFile(resolve(ROOT, ".env-prod-backup")),
  };
  const result = spawnSync(process.execPath, [resolve(ROOT, "scripts/netbird-peer-discover.mjs"), "--json"], {
    env: { ...fileEnv, ...process.env },
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(`netbird-peer-discover failed (exit ${result.status}): ${result.stderr.slice(0, 400)}`);
  }
  const peers = JSON.parse(result.stdout);
  // Jméno → nejlepší peer. NetBird po re-enrollmentu drží staré záznamy téhož
  // jména; volba (připojený > nejnovější lastSeen > nižší IP) má jeden domov
  // v lib/mesh-peers.mjs, sdílený s redeployem a mesh DNS.
  return Object.fromEntries([...nejlepsiPeerPodleJmena(peers)].map(([host, peer]) => [host, peer.ip]));
}

function ipForEnvKey(envKey, peers) {
  // Reverse the envKeyForHostname mapping: try several hostnames that could
  // resolve to this env key.
  const candidates = {
    BACKEND_HOST_MESH_IP: ["aisha-backend-host", "backend-host"],
    BACKEND_MESH_IP: ["aisha-backend-host", "backend-host", "backend", "frontend-core", "core"],
    CORE_MESH_IP: ["frontend-core", "core", "aisha-frontend-core", "aisha-backend-host", "backend-host"],
    EDGE_MESH_IP: ["edge", "frontend-edge"],
    LEDGER_MESH_IP: ["ledger", "experimental-cosmos", "cosmos"],
    INTEGRATION_MESH_IP: ["integration", "aisha-backend-integration", "backend-integration"],
  }[envKey] || [];
  for (const h of candidates) {
    if (peers[h]) return peers[h];
  }
  return null;
}

/**
 * Počká, až se mesh USTÁLÍ — nepočítá hodiny, počítá PEERY.
 *
 * ⛔ NAMĚŘENO 2026-08-26: fáze D2 se ptala JEDNOU. Fáze D přitom předtím čekala
 * pevných 900 s na přenasazení 17 stacků, jenže Coolify je zpracovává sériově
 * (minuty na kus), takže se do rozpočtu nevešly. Agenti se ještě zapisovali,
 * peer mapa byla prázdná — a celý cold-start spadl na `STOP: nevyřešen ANI
 * JEDEN peer`, ačkoli mesh se právě rodila a o pár minut později byla celá.
 *
 * Kolik peerů MÁ být, se dopředu neví (záleží na profilu, opt-in službách
 * a na tom, kolik agentů se stihlo nasadit). Nečeká se tedy na číslo, ale na
 * USTÁLENÍ: dokud peerů přibývá, mesh se rodí a čeká se dál; jakmile se počet
 * `stallMs` nezmění, je hotová (nebo se zasekla — a to pozná STOP níž, který
 * zůstává beze změny).
 */
function pockejNaUstalenouMesh() {
  const stallMs = Number(process.env.AISHA_MESH_SETTLE_STALL_MS || 180_000);
  const hardCapMs = Number(process.env.AISHA_MESH_SETTLE_CAP_MS || 2_700_000);
  const pollMs = Number(process.env.AISHA_MESH_SETTLE_POLL_MS || 15_000);
  const zacatek = Date.now();
  let nejvic = -1;
  let poslednePrirustek = Date.now();
  let peers = [];

  for (;;) {
    try {
      peers = discoverPeers();
    } catch (err) {
      // Nevidím do netbirdu ⇒ nevím, jestli mesh je. To NENÍ „mesh je hotová".
      console.error(`  discovery zatím neodpovídá (${err.message.slice(0, 80)}) — čekám dál`);
      peers = [];
    }
    // ⛔ `discoverPeers()` vrací OBJEKT (hostname → IP), ne pole. `Array.isArray`
    // na něm dá false a počet by byl VŽDY 0 — měřidlo by mlčky hlásilo „mesh
    // není" i nad plnou meshí (naměřeno 2026-08-26: 17 agentů s wt0, tenhle
    // řádek hlásil 0). Týž tvar mě týž den napálil u `/deployments`, které také
    // vrací objekt; proto se počítá přes `Object.keys`.
    const pocet = peers && typeof peers === "object" ? Object.keys(peers).length : 0;
    if (pocet > nejvic) {
      nejvic = pocet;
      poslednePrirustek = Date.now();
      console.error(`  mesh se rodí: ${pocet} peer(ů) — čekám na ustálení`);
    }
    const stoji = Date.now() - poslednePrirustek;
    if (pocet > 0 && stoji >= stallMs) {
      console.error(`  mesh ustálená na ${pocet} peerech (${Math.round(stoji / 1000)}s beze změny)`);
      return peers;
    }
    if (Date.now() - zacatek >= hardCapMs) {
      console.error(`  absolutní strop ${Math.round(hardCapMs / 60000)} min vyčerpán — pokračuji s ${pocet} peery`);
      return peers;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, pollMs);
  }
}

async function main() {
  let peers;
  if (APPLY) {
    // Zápis se dělá JEDNOU a další vlna na něm staví, takže se čeká na ustálení.
    // Kontrolní běh (`--apply` vypnuté) naopak musí odpovědět HNED — je to sonda.
    peers = pockejNaUstalenouMesh();
  } else {
    try {
      peers = discoverPeers();
    } catch (err) {
      console.error(`Discovery failed: ${err.message}`);
      process.exit(2);
    }
  }

  const apps = await coolify("/applications");
  // Confine to OUR project — never PATCH another tenant's same-named aisha-*
  // app env on the shared host. Fail-loud without COOLIFY_PROJECT_UUID.
  const scope = await createProjectScope(coolify);
  const appByName = new Map(
    apps.filter((a) => scope.inProject(a) && a.name?.startsWith(`${APP_PREFIX}-`)).map((a) => [a.name, a]),
  );
  // ── NETBIRD_MGMT_HOST MUSÍ UKAZOVAT NA UZEL, KDE MANAGEMENT OPRAVDU BĚŽÍ ──
  //
  // ⛔ NAMĚŘENO 2026-08-25. Agenti si `netbird.mesh.<instance>.internal` mapují
  // přes `extra_hosts` na `NETBIRD_MGMT_HOST`. Ta hodnota je OPERÁTORSKÁ
  // deklarace a `generate-secrets` ji drží přes `preservedValue` — jednou
  // zapsaná tedy přežije zdroj, ze kterého měla být odvozená.
  //
  // Přesně to se stalo: management se přestěhoval na uzel Giah, ale agenti
  // dál mířili na adresu, která nepatřila ŽÁDNÉMU ze serverů. Nikdo si
  // nestěžoval — peer se prostě nepřipojil. Následek se projevil o tři vrstvy
  // dál a v jiné doméně: mesh bez peerů → CORE_MESH_IP prázdné → edge nemá
  // cíl pro DNAT → api 502, a extranet-auth zabil sám sebe hláškou
  // „mesh je vyhlášená, ale EXTRANET_UPSTREAM_MESH je prázdné" → extra 404.
  //
  // Tenhle skript už s Coolify mluví a jeho úkolem JE mesh, takže tu shodu
  // ověří tady. Adresa se do repa nezapisuje (infra adresy tam nepatří) —
  // jen se porovná a v případě neshody se ta správná POJMENUJE v hlášce.
  {
    const nb = appByName.get(`${APP_PREFIX}-netbird`);
    const nodeIp = nb?.destination?.server?.ip;
    const declared = process.env.NETBIRD_MGMT_HOST;
    const jeIPv4 = (v) => typeof v === "string" && /^\d{1,3}(\.\d{1,3}){3}$/.test(v);
    const zamer = process.env.NETBIRD_HOST_ADDR; // adresa uzlu, kam službu klade PROFIL
    if (jeIPv4(nodeIp) && jeIPv4(declared) && nodeIp !== declared) {
      console.error(`FATAL: adresa managementu si neodpovídá napříč zdroji.`);
      console.error(`  agenti mají zapsáno   NETBIRD_MGMT_HOST = ${declared}`);
      console.error(`  profil službu klade na                    ${zamer ?? "(NETBIRD_HOST_ADDR nezjištěno)"}`);
      console.error(`  Coolify ji reálně běží na                 ${nodeIp}`);
      console.error(``);
      console.error(`  Agenti si přes extra_hosts mapují mesh jméno na ${declared}. Neposlouchá-li tam`);
      console.error(`  management, NEPŘIPOJÍ se — a to MLČKY: peer se prostě neobjeví. Mesh zůstane`);
      console.error(`  prázdná → CORE_MESH_IP prázdné → api 502; extranet-auth se zabije hláškou`);
      console.error(`  o prázdném EXTRANET_UPSTREAM_MESH → 404.`);
      console.error(``);
      if (zamer && zamer !== nodeIp) {
        console.error(`  POZOR: neshodu mají i profil a realita. Nejde tedy o jednu špatnou hodnotu,`);
        console.error(`  ale o rozpor ZÁMĚRU a NASAZENÍ — dosadit kteroukoli z nich by jen vyměnilo`);
        console.error(`  jednu chybu za druhou. Rozhodni, kde má netbird bydlet, a srovnej OBOJÍ:`);
        console.error(`  service_overrides.netbird.placement v profilu × server, na kterém app leží.`);
      } else if (zamer) {
        console.error(`  Profil i realita se shodují na ${nodeIp} — zapsaná hodnota je zastaralá.`);
      } else {
        console.error(`  Záměr profilu se sem NEDOSTAL (NETBIRD_HOST_ADDR emituje generate-coolify-context`);
        console.error(`  při cold-startu). Porovnány tedy byly jen dva zdroje ze tří — netvrdím, že`);
        console.error(`  profil s realitou souhlasí, jen to odsud nevidím.`);
      }
      console.error(`  NEDOSAZUJI to sám: adresa uzlu je pozorování, ale KTERÝ uzel to má být, je rozhodnutí.`);
      process.exit(3);
    }
  }

  const reports = [];
  const nevyreseneEnvy = [];
  let vyreseneEnvy = 0;

  for (const contract of ENV_CONTRACT) {
    const appName = `${APP_PREFIX}-${contract.role}`;
    const app = appByName.get(appName);
    if (!app) {
      reports.push({ app: appName, ok: false, missingApp: true });
      continue;
    }
    const currentEnvs = await coolify(`/applications/${app.uuid}/envs`);
    const drift = [];
    for (const envKey of contract.envs) {
      const desired = ipForEnvKey(envKey, peers);
      if (!desired) {
        // ⛔ NE „skip silently" (tak to tu stálo do 2026-08-25). Když peer není
        // objevený, není to „nic k opravě" — je to „nevidím na mesh". Obojí
        // vydávalo IDENTICKÝ výstup: žádný drift, `OK` u každé appky, exit 0.
        // Fáze D2 se pak odhlásila jako hotová a vlna 6 nasadila edge bez cíle
        // DNAT → api 502, tedy přesně to, před čím cold-start u tohohle kroku
        // varuje. Přeskočené se proto POČÍTAJÍ a vypíšou.
        nevyreseneEnvy.push(`${appName}:${envKey}`);
        continue;
      }
      vyreseneEnvy += 1;
      const current = currentEnvValue(currentEnvs, envKey);
      if (current !== desired || hasEnvDrift(currentEnvs, envKey, desired)) {
        drift.push({ key: envKey, current: current || "<unset>", desired });
      }
    }
    const report = { app: appName, uuid: app.uuid, ok: drift.length === 0, drift };

    if (APPLY && drift.length > 0) {
      // Coolify env bulk update: send all envs (current ones unchanged + drifted ones with new value)
      const merged = currentEnvs.map((e) => ({ ...e }));
      for (const d of drift) {
        let matched = false;
        for (let i = 0; i < merged.length; i += 1) {
          if (merged[i].key !== d.key) continue;
          matched = true;
          merged[i] = { ...merged[i], value: d.desired, is_literal: true };
        }
        if (!matched) {
          merged.push({ key: d.key, value: d.desired, is_literal: true, is_preview: false });
        }
      }
      await coolify(`/applications/${app.uuid}/envs/bulk`, {
        method: "PATCH",
        body: JSON.stringify({ data: merged }),
      });
      report.applied = true;
    }
    reports.push(report);
  }

  if (JSON_OUTPUT) {
    console.log(JSON.stringify({ ok: reports.every((r) => r.ok), applied: APPLY, peers, reports }, null, 2));
  } else {
    console.log(`Coolify mesh-sync (${APPLY ? "apply" : "check"})\n`);
    for (const r of reports) {
      if (r.missingApp) {
        console.log(`FAIL ${r.app}: missing app`);
        continue;
      }
      if (r.drift.length === 0) {
        console.log(`OK   ${r.app}`);
        continue;
      }
      console.log(`${APPLY ? "FIX " : "DRIFT"} ${r.app}`);
      for (const d of r.drift) {
        console.log(`     ${d.key}: ${d.current} → ${d.desired}`);
      }
    }
    if (!APPLY && reports.some((r) => !r.ok)) {
      console.log("\nRun with --apply to patch Coolify env.");
    }
  }

  if (nevyreseneEnvy.length && !JSON_OUTPUT) {
    console.log(`\nBEZ PEERA (${nevyreseneEnvy.length}) — mesh IP neobjevena, hodnota NEZAPSÁNA:`);
    for (const e of nevyreseneEnvy) console.log(`  ${e}`);
  }

  // Rozdíl, na kterém záleží: „některé" × „vůbec nic".
  //   částečně  → volitelná služba neběží; vypsat a pokračovat
  //   ani jeden → mesh nevidím; NESMÍM ohlásit úspěch, protože další vlna na
  //               těch adresách staví (edge → DNAT do meshe)
  //
  // ⛔ PRVNÍ VERZE TÉHLE PODMÍNKY BYLA SAMA TOU VADOU, kterou má chytat
  // (naměřeno 2026-08-25). Odvozovala „nevidím na mesh" z toho, že NIC nemá
  // drift — jenže „žádný drift" znamená TAKÉ „všechno už je správně", tedy
  // ÚSPĚCH. Běh se pak zastavil na hlášce „nevyřešen ani jeden peer",
  // přestože mesh IP byly zapsané a `<fork>-edge` hlásil OK.
  //
  // Počítá se proto, kolik hodnot se SKUTEČNĚ vyřešilo. Nula vyřešených při
  // nenulovém počtu nevyřešených = peer mapa je prázdná, tedy mesh není vidět.
  const zadnyVyresen = vyreseneEnvy === 0 && nevyreseneEnvy.length > 0;
  if (zadnyVyresen) {
    console.error(
      "\nSTOP: nevyřešen ANI JEDEN peer — mesh není vidět.\n" +
      "  Nehlásím úspěch: další vlna staví edge na těchto adresách (DNAT do meshe)\n" +
      "  a bez nich skončí api na 502.\n" +
      "  Ověř: agenti mají wt0 a netbird eviduje peery (fáze D vyrábí setup klíče).",
    );
    process.exit(1);
  }

  const hasUnresolved = reports.some((r) => !r.ok || r.missingApp);
  process.exit(!APPLY && hasUnresolved ? 1 : 0);
}

function currentEnvValue(envs, key) {
  const production = envs.find((e) => e.key === key && e.is_preview !== true);
  if (production) return production.value;
  const fallback = envs.find((e) => e.key === key);
  return fallback?.value || "";
}

function hasEnvDrift(envs, key, desired) {
  const matches = envs.filter((e) => e.key === key);
  if (matches.length === 0) return true;
  return matches.some((e) => e.value !== desired);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(2);
});
