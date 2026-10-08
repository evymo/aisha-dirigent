#!/usr/bin/env node
/**
 * sloty-serveru.mjs — JEDEN domov seznamu slotů (rolí serverů).
 *
 * Slot je klíč `servers` v `coolify/servers.json`. Discovery serverů
 * (`generate-coolify-context.mjs`) i doménové brány ho odtud čtou odjakživa;
 * zbytek nástrojů měl vlastní opis (`coolify-drift-check.mjs` mapu tří slotů,
 * bash smyčky v cold-startu a doktorovi). Pátý slot by tak znamenal hledat
 * opisy po stromu — a ten, na který se zapomene, slot TIŠE přeskočí
 * (drift-check u neznámého slotu vracel `null` = „neměřit").
 *
 * Odtud se proto odvozuje:
 *   • `slotyServeru()`   — všechny sloty registru,
 *   • `slotyUmisteni()`  — sloty, na které smí katalog službu umístit
 *                          (všechny kromě build serveru, který runtime nenese),
 *   • `uuidSlotu()`      — UUID serveru slotu z `COOLIFY_SERVER_UUID_<SLOT>`;
 *                          neznámý slot je `null` a volající ho musí ohlásit,
 *   • `slotyVProvozu()`  — sloty, na kterých bydlí aspoň jedna katalogová služba
 *                          s otevřenou lane (`provision_when_env`). Volitelný slot
 *                          (GPU uzel `gpu`) se tím bez zapnuté lane nikde
 *                          nevyžaduje ani nehlásí — bez seznamu výjimek,
 *   • `vyzadujeVyslovnouVazbu()` — slot, jehož server se NEHÁDÁ (has_gpu): discovery
 *                          ho nepáruje heuristikou ani nepřišpendlí jednouzlovým
 *                          pinem; `slotyKPripnuti()` = sloty, které pin smí vzít,
 *   • `proxySlotu()`     — deklarovaný typ proxy SERVERU slotu (`proxy` v registru;
 *                          čte coolify-server-proxy.mjs a doktor). Slot bez deklarace
 *                          se neměří ani nemění — nic se nedosazuje.
 *
 * Schémata (`services.schema.json`, `profiles.schema.json`,
 * `servers.schema.json`) sloty vyjmenovávají, protože JSON schéma odkaz na jiný
 * soubor neumí. Brána `sloty-maji-jeden-seznam` je proti tomuhle seznamu MĚŘÍ.
 *
 * CLI (bash konzumenti — cold-start, doktor):
 *   node sloty-serveru.mjs --vsechny | --umisteni | --pripnutelne | --v-provozu [--env-soubor <soubor>] [--profil <id>]
 *     → sloty po řádcích; kód 2 = registr, katalog, env soubor nebo deklarovaný profil
 *       nejde přečíst (NEMĚŘENO, nikdy se netváří jako „žádný slot").
 *   node sloty-serveru.mjs --bez-warmupu [--env-soubor <soubor>] [--profil <id>]
 *     → umístění bez warmupu (netinit-<umístění>) po řádcích; prázdný výstup = pokryto.
 *   Prostředí procesu má přednost před souborem (operátor přepne lane pro jeden běh).
 *
 * ⛔ Přepínač se NEJMENUJE `--env-file`: Node 22 ho čte i ZA jménem skriptu —
 * neexistující soubor ukončí proces kódem 9 dřív, než skript poběží (naměřeno
 * 2026-10-02, node v22.23), takže by „NEMĚŘENO" nikdy nevyslovil skript sám.
 */
import { accessSync, constants, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectRun } from "./cli-entry.mjs";
import { ctenarHodnot, nactiKatalog, podminkaSplnena } from "./provision-gate.mjs";
// Čisté funkce umístění bydlí v modulu BEZ CLI: derive-domains je potřebuje, a kdyby je
// importoval odsud, vznikl by cyklus s CLI níž (`await import("./derive-domains.mjs")`
// → statický import zpět sem) a node by skončil kódem 13 (nedokončený top-level await).
import { ctiSModelovymMeshem, efektivniUmisteni, nasazujeRaw, vyzadujeVyslovnouVazbu } from "./umisteni-sluzeb.mjs";
export { ctiSModelovymMeshem, efektivniUmisteni, nasazujeRaw, slotModelovehoMeshe, SLUZBA_MODELU, vyzadujeVyslovnouVazbu } from "./umisteni-sluzeb.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Registr slotů `coolify/servers.json` → objekt `servers`. Nečitelný nebo prázdný
 * registr je CHYBA, ne prázdný seznam: prázdno by vypadalo jako „žádný slot
 * k ověření" a každý konzument by mlčky nic neměřil.
 */
export function nactiSloty(koren = REPO_ROOT) {
  const cesta = join(koren, "coolify/servers.json");
  const servers = JSON.parse(readFileSync(cesta, "utf8"))?.servers;
  if (!servers || typeof servers !== "object" || Object.keys(servers).length === 0) {
    throw new Error(`${cesta}: registr slotů je prázdný — není z čeho odvodit sloty`);
  }
  return servers;
}

/** Všechny sloty registru v pořadí souboru. */
export function slotyServeru(servers = nactiSloty()) {
  return Object.keys(servers);
}

/** Sloty, na které se umisťují služby: build server runtime kontejnery nenese. */
export function slotyUmisteni(servers = nactiSloty()) {
  return Object.keys(servers).filter((slot) => servers[slot]?.is_build_server !== true);
}

/** Jméno proměnné s UUID serveru slotu — jediný tvar, který čte celý řetěz. */
export function klicUuidSlotu(slot) {
  return `COOLIFY_SERVER_UUID_${String(slot).toUpperCase()}`;
}

/**
 * UUID serveru slotu z prostředí. Neznámý slot (manifest jmenuje slot, který
 * registr nezná) i nenastavené UUID vrací `null` — volající rozliší důvod přes
 * `slotyServeru()` a musí ho vypsat, ne přeskočit.
 */
export function uuidSlotu(slot, env = process.env, servers = nactiSloty()) {
  if (!Object.prototype.hasOwnProperty.call(servers, slot)) return null;
  const uuid = String(env[klicUuidSlotu(slot)] ?? "").trim();
  return uuid || null;
}

/** Sloty, které smí přišpendlit jednouzlový pin (AISHA_TARGET_SERVER): všechny kromě výslovně vázaných. */
export function slotyKPripnuti(servers = nactiSloty()) {
  return Object.keys(servers).filter((slot) => !vyzadujeVyslovnouVazbu(servers[slot]));
}

/** Typy proxy serveru, které umí Coolify (opis výčtu `proxy` v servers.schema.json — brána je měří proti sobě). */
export const PROXY_SERVERU = Object.freeze(["traefik", "caddy", "none"]);

/**
 * Deklarovaná proxy serveru slotu.
 *
 * `proxy: null` = slot proxy NEDEKLARUJE (nikdo ji neměří ani nemění — žádná
 * výchozí hodnota). Vadná deklarace je `chyba`, ne tiché „žádná": neznámý typ
 * i rozpor s `has_traefik` (Traefik běží jen u `traefik`) by jinak nastavily
 * serveru něco jiného, než slot tvrdí o sobě.
 *
 * @returns {{ proxy: "traefik"|"caddy"|"none"|null, chyba: string|null }}
 */
export function proxySlotu(slotDef, slot = "?") {
  if (!slotDef || !Object.prototype.hasOwnProperty.call(slotDef, "proxy")) return { proxy: null, chyba: null };
  const p = slotDef.proxy;
  if (!PROXY_SERVERU.includes(p)) {
    return { proxy: null, chyba: `slot '${slot}': proxy=${JSON.stringify(p)} není ${PROXY_SERVERU.join("|")}` };
  }
  if (p !== "traefik" && slotDef.has_traefik === true) {
    return { proxy: null, chyba: `slot '${slot}': proxy '${p}' a has_traefik:true si odporují (Traefik běží jen s proxy 'traefik')` };
  }
  return { proxy: p, chyba: null };
}

/**
 * Sloty v provozu: hostí aspoň jednu katalogovou službu, jejíž lane je otevřená.
 * Měří se umístění z KATALOGU — přepis profilu (jednouzlová instance) službu
 * přesune, ale slot, který katalog obsazuje povinnou službou, zůstává v provozu
 * tak jako dosud. Volitelný slot vstoupí jen se svou lane.
 *
 * @param {{ servers?: object, sluzby?: object, cti?: (k: string) => string|undefined }} [opts]
 */
export function slotyVProvozu({ servers = nactiSloty(), sluzby = nactiKatalog(), cti: ctiProstredi, profil = null } = {}) {
  // MODEL_MESH odvozuje umístění modelu — týž čtenář jako derive-domains.
  const cti = ctiSModelovymMeshem({ servers, sluzby, profil, cti: ctiProstredi });
  const umisteni = slotyUmisteni(servers);
  const obsazene = new Set();
  for (const sluzba of Object.values(sluzby ?? {})) {
    if (!sluzba || !umisteni.includes(sluzba.placement)) continue;
    if (!podminkaSplnena(sluzba.provision_when_env, cti)) continue;
    obsazene.add(sluzba.placement);
  }
  // Přepis profilu slot PŘIDÁ, neubere: model forku přesunutý profilem na GPU uzel
  // dělá slot `gpu` v provozu (UUID se pak vyžaduje hned po discovery, ne až
  // u zakládání aplikace). Slot, který obsazuje katalog, zůstává v provozu jako
  // dosud — povinné sloty se profilem nemění.
  for (const slot of efektivniUmisteni({ sluzby, profil, cti }).values()) {
    if (umisteni.includes(slot)) obsazene.add(slot);
  }
  return umisteni.filter((slot) => obsazene.has(slot));
}

/**
 * Umístění, kde se nasazuje, ale chybí warmup (`netinit-<umístění>`), který založí
 * hostitelské sítě instance. Měří se nad EFEKTIVNÍM umístěním: služba za zavřenou
 * lane sítě nepotřebuje. (Doktor fáze N dřív četl katalog bez lane — vrstva accel
 * na GPU slotu by tak hlásila FAIL na každé instanci, i bez ACCEL_ENABLED.)
 *
 * Slot s GPU (has_gpu) warmup instance nepotřebuje NIKDY: hostitelské sítě instance tam nikdo
 * nečte. Firewall hostitele běží v síti hostitele, compose vstupu lane (accel-vstup) zakládá
 * sítě jádra a slotů sám (`internal`, podsíť z deklarace uzlu) a enginy i tenké stacky forků
 * (varianta `compose_gpu`) se na ně připojují jako `external`. Dřív fáze N hlásila „umístění
 * bez warmupu: gpu“ u každého forku s modelem na GPU a předlet cold-startu skončil FATAL
 * (2026-10-06); výjimka jen pro tenký stack by tentýž FATAL vrátila operátorovi vrstvy.
 */
export function umisteniBezWarmupu(opts = {}) {
  const potreba = new Set();
  const maji = new Set();
  const servers = opts.servers ?? nactiSloty();
  const sluzby = opts.sluzby ?? nactiKatalog();
  const cti = ctiSModelovymMeshem({ servers, sluzby, profil: opts.profil ?? null, cti: opts.cti });
  for (const [id, umisteni] of efektivniUmisteni({ ...opts, sluzby, cti })) {
    if (id.startsWith("netinit-")) {
      maji.add(umisteni);
      continue;
    }
    if (vyzadujeVyslovnouVazbu(servers[umisteni])) continue;
    potreba.add(umisteni);
  }
  return [...potreba].filter((u) => !maji.has(u)).sort();
}

if (isDirectRun(import.meta.url)) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--env-soubor");
  const envSoubor = i >= 0 ? argv[i + 1] : undefined;
  const ip = argv.indexOf("--profil");
  const profilId = ip >= 0 ? String(argv[ip + 1] ?? "").trim() : "";
  if (i >= 0) {
    // Nečitelný soubor s deklarací lane není „lane zavřená" — je to NEMĚŘENO.
    // Nestačí existsSync: adresář i soubor bez práva čtení „existují", parser by
    // z nich vrátil prázdno a lane by vyšla zavřená s kódem 0.
    try {
      if (!envSoubor) throw new Error("chybí cesta");
      accessSync(envSoubor, constants.R_OK);
      if (!statSync(envSoubor).isFile()) throw new Error("není soubor");
    } catch (e) {
      console.error(`sloty-serveru: NEMĚŘENO — env soubor '${envSoubor ?? ""}' nejde číst (${e.message})`);
      process.exit(2);
    }
  }
  let vystup;
  try {
    const ir = argv.indexOf("--raw");
    if (ir >= 0) {
      // Kód 0 = slot nasazuje compose raw, 1 = běžně; neznámý slot = NEMĚŘENO (2), ne „běžně“.
      const slot = String(argv[ir + 1] ?? "");
      const servers = nactiSloty();
      if (!Object.hasOwn(servers, slot)) throw new Error(`slot '${slot}' registr slotů nezná`);
      process.exit(nasazujeRaw(servers[slot]) ? 0 : 1);
    }
    if (argv.includes("--vsechny")) vystup = slotyServeru();
    else if (argv.includes("--umisteni")) vystup = slotyUmisteni();
    else if (argv.includes("--pripnutelne")) vystup = slotyKPripnuti();
    else if (argv.includes("--v-provozu") || argv.includes("--bez-warmupu")) {
      // Profil instance jde TÝMIŽ dveřmi jako derive-domains (overlay má přednost).
      // Deklarovaný a nečitelný profil je NEMĚŘENO, ne „bez přepisů".
      const profil = profilId ? (await import("./derive-domains.mjs")).loadProfile(profilId) : null;
      const opts = { cti: ctenarHodnot(envSoubor), profil };
      if (argv.includes("--bez-warmupu")) {
        const chybi = umisteniBezWarmupu(opts);
        if (chybi.length > 0) process.stdout.write(`${chybi.join("\n")}\n`);
        process.exit(0);
      }
      vystup = slotyVProvozu(opts);
    }
    else {
      console.error("použití: sloty-serveru.mjs --vsechny | --umisteni | --pripnutelne | --v-provozu | --bez-warmupu [--env-soubor <soubor>] [--profil <id>] | --raw <slot>");
      process.exit(2);
    }
  } catch (e) {
    console.error(`sloty-serveru: NEMĚŘENO — ${e.message}`);
    process.exit(2);
  }
  if (vystup.length === 0) {
    console.error("sloty-serveru: odvozeno NULA slotů — tohle není stav, ale vada vstupu");
    process.exit(2);
  }
  process.stdout.write(`${vystup.join("\n")}\n`);
}
