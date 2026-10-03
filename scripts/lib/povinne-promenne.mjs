#!/usr/bin/env node
/**
 * povinne-promenne.mjs — DOSTANE compose všechno, co POVINNĚ interpoluje?
 *
 * ⛔ NAMĚŘENO 2026-09-13 PO SLITÍ FORKŮ DO UPSTREAMU. Push do mainu spustil
 * nasazení a `Deploy: Core` spadl: compose nesl nové `${MESH_DNS_NETWORK:?…}`,
 * hodnota ležela v `.env.coolify` — a do aplikace `<prefix>-core` ji nikdo
 * nedoručil. Běžel dál starý kontejner a příčinu bylo nutné vydolovat z logu
 * nasazení v Coolify.
 *
 * Změřeno přes celou flotilu (compose z repa × envy aplikací v Coolify):
 * 20 z 32 aplikací, 8 různých klíčů, všechny `${X:?}`. Každý z nich znamenal, že
 * PŘÍŠTÍ nasazení té aplikace spadne — a nikdo to nevěděl, dokud nenasadil.
 *
 * Mezera nebyla v jednom nástroji, ale MEZI nimi. Každý se ptal na něco jiného:
 *   · env-doktor:        je `.env.coolify` úplný vůči KONTRAKTU?
 *   · preflight-compose: jde compose interpolovat nad `.env.coolify`?
 *   · sync read-back:    dorazila TAJEMSTVÍ neprázdná?
 *   · deploy:            přijal Coolify požadavek a doběhl build?
 * Otázku „má APLIKACE, kterou právě nasazuji, všechno, bez čeho její compose
 * spadne?" nekladl NIKDO — a přesně na ní nasazení padá.
 *
 * Tenhle modul je JEDINÉ místo, kde se na ni odpovídá. Stanoviště se liší jen
 * tím, ODKUD bere hodnoty:
 *   · Coolify aplikace (sync read-back, CI před nasazením, doctor)
 *   · env soubor (`.env.coolify`, lokální `.env.local.dev`)
 *   · mapa v paměti (lokální generátor)
 *
 * Co je povinné, určuje `compose-env-refs.mjs` — tedy YAML parser, ne regex nad
 * textem (proč, viz jeho hlavička). Vedle `${X:?}` i pole `x-aisha-povinne-za-behu`:
 * proměnné, bez kterých služba nenastartuje, ale které `:?` nést nesmí (build-time).
 *
 * CLI:
 *   node povinne-promenne.mjs --compose <f> --coolify-envs <soubor|-> [--app <jméno>] [--sot <.env.coolify>]
 *   node povinne-promenne.mjs --compose <f> [--compose <g> …] --env-file <soubor>
 *        ↳ `--sot` k nálezu přidá, KDO ho umí doplnit (sync, nebo env-doktor)
 *   node povinne-promenne.mjs --coolify --prefix <p> [--env-file <SoT>]
 *        ↳ všechny aplikace projektu instance; compose podle toho, co má aplikace
 *          v Coolify NASTAVENÉ (`docker_compose_location`), ne podle odhadu
 *
 * Návratový kód: 0 = vše doručeno · 1 = něco nedoručeno · 2 = NEMĚŘENO
 * (chybný vstup, nečitelné envy, API) · 3 = bez nálezu, ale část aplikací
 * změřit nešla. Mlčení nástroje se nesmí dát odlišit od nálezu jen barvou.
 * Hodnoty se nikdy nevypisují — jen jména.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectRun } from "./cli-entry.mjs";
import { povinneZaBehu, referenceCompose } from "./compose-env-refs.mjs";
import { parseEnvFile } from "./config-env-files.mjs";
import { porovnej } from "./razeni.mjs";

// Kořen repa bez dalších importů: CI nasazovací úloha má řídký checkout a každý
// modul navíc je soubor, který musí vyjmenovat (viz ci.yml, sparse-checkout).
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Jména, která si Coolify doplňuje sám (magické SERVICE_* proměnné). Aplikace je
 * v envech mít nemusí a doručovat je nemá kdo — táž politika jako per-app filtr
 * v `coolify-app-vars.sh`.
 */
export const SPRAVUJE_COOLIFY = /^SERVICE_(FQDN|URL|USER|PASSWORD|BASE)_/;

/**
 * Z referencí compose vybere ty, bez kterých compose SPADNE.
 * Jméno, které se v souboru objeví jednou jako `${X?}` a jinde jako `${X:?}`,
 * musí být neprázdné — rozhoduje nejpřísnější výskyt.
 *
 * @param {Array<{jmeno:string, povinna:boolean, neprazdna:boolean}>} reference
 * @returns {Array<{jmeno:string, neprazdna:boolean}>} seřazeno podle jména
 */
export function povinneZReferenci(reference) {
  const podleJmena = new Map();
  for (const r of reference) {
    if (!r.povinna || SPRAVUJE_COOLIFY.test(r.jmeno)) continue;
    podleJmena.set(r.jmeno, Boolean(podleJmena.get(r.jmeno)) || Boolean(r.neprazdna));
  }
  return [...podleJmena]
    .sort(([a], [b]) => porovnej(a, b))
    .map(([jmeno, neprazdna]) => ({ jmeno, neprazdna }));
}

/**
 * @param {Array<{jmeno:string, neprazdna:boolean}>} povinne
 * @param {Map<string,string>} hodnoty — co compose při interpolaci UVIDÍ
 * @returns {{chybi:string[], prazdne:string[], ok:boolean}}
 */
export function nedorucene(povinne, hodnoty) {
  const chybi = [];
  const prazdne = [];
  for (const { jmeno, neprazdna } of povinne) {
    if (!hodnoty.has(jmeno)) chybi.push(jmeno);
    else if (neprazdna && String(hodnoty.get(jmeno) ?? "") === "") prazdne.push(jmeno);
  }
  return { chybi, prazdne, ok: chybi.length === 0 && prazdne.length === 0 };
}

/**
 * Odpověď `GET /api/v1/applications/{uuid}/envs` → co uvidí PRODUKČNÍ nasazení.
 *
 * Bere se jen `is_preview` false/nevyplněné — týž výběr, jaký dělá read-back
 * tajemství v `coolify-sync-envs.sh`. Preview záznamy slouží nasazení PR.
 *
 * ⛔ Nepole NENÍ prázdný seznam. Chyba API, HTML stránka nebo `{message: …}`
 * by jinak vyšly jako „aplikace nemá žádné proměnné" a každá povinná by se
 * hlásila jako chybějící — nebo, u volajícího, který chybu spolkne, jako nic.
 *
 * @param {unknown} envs
 * @returns {Map<string,string>}
 */
export function hodnotyZCoolifyEnvs(envs) {
  if (!Array.isArray(envs)) {
    throw new Error("envy aplikace nejsou pole — Coolify je nevydal, doručení NEJDE změřit");
  }
  const hodnoty = new Map();
  for (const e of envs) {
    if (typeof e?.key !== "string") continue;
    if (!(e.is_preview === false || e.is_preview == null)) continue;
    const hodnota = e.value == null ? "" : String(e.value);
    // Duplicitní záznam téhož klíče: neprázdná hodnota nesmí zmizet pod prázdnou.
    if (!hodnoty.has(e.key) || hodnoty.get(e.key) === "") hodnoty.set(e.key, hodnota);
  }
  return hodnoty;
}

/** Env soubor → hodnoty; prázdné klíče ZŮSTÁVAJÍ (rozdíl chybí × prázdné). */
export function hodnotyZEnvSouboru(cesta) {
  if (!existsSync(cesta)) throw new Error(`env soubor ${cesta} neexistuje — není proti čemu měřit`);
  return new Map(Object.entries(parseEnvFile(cesta, { keepTemplates: true, keepEmpty: true })));
}

/**
 * Nedoručené klíče rozdělí podle toho, KDO je umí dodat:
 *   · kSyncu     — `.env.coolify` je má neprázdné → stačí je rozeslat
 *   · kDoktorovi — ani v `.env.coolify` nejsou → nejdřív env-doktor (odvodí,
 *                  nebo řekne, že jde o vstup obsluhy)
 * Bez SoT (null) jsou všechny `kDoktorovi` — nic se nepředstírá.
 *
 * @param {string[]} klice
 * @param {Map<string,string>|null} sot
 */
export function kdoDoplni(klice, sot) {
  const kSyncu = [];
  const kDoktorovi = [];
  for (const k of klice) {
    if (sot && String(sot.get(k) ?? "") !== "") kSyncu.push(k);
    else kDoktorovi.push(k);
  }
  return { kSyncu, kDoktorovi };
}

/** Jeden řádek pro člověka. Jen jména, nikdy hodnoty. */
export function popisNedorucenych(vysledek) {
  const casti = [];
  if (vysledek.chybi.length) casti.push(`chybí ${vysledek.chybi.join(", ")}`);
  if (vysledek.prazdne.length) casti.push(`prázdné ${vysledek.prazdne.join(", ")}`);
  return casti.join("; ");
}

/**
 * Povinné proměnné compose souboru (cesta absolutní, nebo vůči kořeni repa):
 * co compose SHODÍ (`${X:?}`, `${X?}`) plus co služba bez hodnoty nenastartuje
 * (`x-aisha-povinne-za-behu`, viz compose-env-refs.mjs) — to jako neprázdné.
 */
export function povinneSouboru(cesta) {
  const plna = cesta.startsWith("/") ? cesta : join(REPO_ROOT, cesta);
  const text = readFileSync(plna, "utf8");
  const povinne = new Map(povinneZReferenci(referenceCompose(text, plna)).map((p) => [p.jmeno, p.neprazdna]));
  for (const jmeno of povinneZaBehu(text, plna)) povinne.set(jmeno, true);
  return [...povinne]
    .sort(([a], [b]) => porovnej(a, b))
    .map(([jmeno, neprazdna]) => ({ jmeno, neprazdna }));
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function argumenty(argv) {
  const out = { coolify: false, compose: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--coolify") out.coolify = true;
    else if (["--compose", "--coolify-envs", "--env-file", "--app", "--prefix", "--sot"].includes(a)) {
      if (argv[i + 1] === undefined) throw new Error(`${a} potřebuje hodnotu`);
      if (a === "--compose") out.compose.push(argv[++i]);
      else out[a.slice(2)] = argv[++i];
    } else throw new Error(`neznámý přepínač '${a}'`);
  }
  return out;
}

function nactiJson(zdroj) {
  const text = zdroj === "-" ? readFileSync(0, "utf8") : readFileSync(zdroj, "utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("envy aplikace nejsou JSON — Coolify vrátil cizí tělo, doručení NEJDE změřit");
  }
}

async function vyjmenovaneCompose(a) {
  const hodnoty = a["coolify-envs"] !== undefined
    ? hodnotyZCoolifyEnvs(nactiJson(a["coolify-envs"]))
    : hodnotyZEnvSouboru(a["env-file"]);
  let kod = 0;
  for (const compose of a.compose) {
    const jmeno = a.app ?? compose;
    const povinne = povinneSouboru(compose);
    const vysledek = nedorucene(povinne, hodnoty);
    if (vysledek.ok) {
      console.log(`✓ ${jmeno}: ${povinne.length} povinných proměnných compose doručeno`);
      continue;
    }
    kod = 1;
    console.log(`✗ ${jmeno}: ${popisNedorucenych(vysledek)}`);
    if (a.sot !== undefined) {
      vypisNapravu(kdoDoplni([...vysledek.chybi, ...vysledek.prazdne], hodnotyZEnvSouboru(a.sot)), a.sot, [jmeno]);
    }
  }
  return kod;
}

function vypisNapravu({ kSyncu, kDoktorovi }, sotJmeno, aplikace) {
  if (kSyncu.length) {
    console.log(`→ v ${sotJmeno} JSOU, jen nedoručené — rozeslat:`);
    console.log(`    KEYS=${[...kSyncu].sort().join(",")} bash scripts/coolify-sync-envs.sh ${aplikace.join(" ")}`);
  }
  if (kDoktorovi.length) {
    console.log(
      `→ ani v ${sotJmeno} NEJSOU (${[...kDoktorovi].sort().join(", ")}) — nejdřív node scripts/aisha-env-doctor.mjs ` +
      "(doplní odvoditelné, o ostatních řekne, že jsou vstupem obsluhy), pak znovu",
    );
  }
}

async function celyProjekt(a) {
  if (!a.prefix) throw new Error("--coolify potřebuje --prefix <prefix instance>");
  const { readConfigKeyAny } = await import("./config-env-files.mjs");
  const baseUrl = process.env.COOLIFY_BASE_URL || process.env.COOLIFY_URL || readConfigKeyAny(["COOLIFY_BASE_URL", "COOLIFY_URL"]);
  const token = process.env.COOLIFY_API_TOKEN || process.env.COOLIFY_API_KEY || readConfigKeyAny(["COOLIFY_API_TOKEN", "COOLIFY_API_KEY"]);
  if (!baseUrl || !token) throw new Error("chybí COOLIFY_URL nebo COOLIFY_API_TOKEN — aplikace NEJDE přečíst");

  const { createCoolifyClient } = await import("./coolify-http.mjs");
  const { createProjectScope } = await import("./coolify-project-scope.mjs");
  const coolify = createCoolifyClient({ baseUrl, token, timeoutMs: 120_000 });
  const scope = await createProjectScope(coolify);
  const aplikace = scope
    .filter(await coolify("/applications"))
    .filter((app) => typeof app?.name === "string" && app.name.startsWith(`${a.prefix}-`))
    .sort((x, y) => porovnej(x.name, y.name));
  if (aplikace.length === 0) {
    throw new Error(`v projektu instance není žádná aplikace '${a.prefix}-*' — není co měřit`);
  }

  const sot = a["env-file"] ? hodnotyZEnvSouboru(a["env-file"]) : null;
  const kSyncu = new Map();      // klíč → aplikace
  const kDoktorovi = new Map();
  const nemereno = [];
  let doruceno = 0;

  for (const app of aplikace) {
    const kratke = app.name.slice(a.prefix.length + 1);
    const compose = String(app.docker_compose_location ?? "").replace(/^\/+/, "");
    if (!compose || !existsSync(join(REPO_ROOT, compose))) {
      nemereno.push(`${kratke} (compose '${compose || "?"}' v tomhle stromu není)`);
      continue;
    }
    let vysledek;
    try {
      vysledek = nedorucene(povinneSouboru(compose), hodnotyZCoolifyEnvs(await coolify(`/applications/${app.uuid}/envs`)));
    } catch (e) {
      nemereno.push(`${kratke} (${String(e.message).split("\n")[0]})`);
      continue;
    }
    if (vysledek.ok) { doruceno++; continue; }
    console.log(`✗ ${kratke} (${compose}): ${popisNedorucenych(vysledek)}`);
    const rozdeleni = kdoDoplni([...vysledek.chybi, ...vysledek.prazdne], sot);
    for (const k of rozdeleni.kSyncu) kSyncu.set(k, [...(kSyncu.get(k) ?? []), kratke]);
    for (const k of rozdeleni.kDoktorovi) kDoktorovi.set(k, [...(kDoktorovi.get(k) ?? []), kratke]);
  }

  console.log(`✓ ${doruceno}/${aplikace.length} aplikací má povinné proměnné compose doručené`);
  for (const n of nemereno) console.log(`? NEMĚŘENO: ${n}`);
  if (kSyncu.size || kDoktorovi.size) {
    if (sot) {
      const appky = [...new Set([...kSyncu.values()].flat())].sort();
      vypisNapravu({ kSyncu: [...kSyncu.keys()], kDoktorovi: [...kDoktorovi.keys()] }, a["env-file"], appky);
    } else {
      console.log(`→ SoT nebyl předán (--env-file), nevím, co z toho umí sync: ${[...kDoktorovi.keys()].sort().join(", ")}`);
    }
  }
  if (kSyncu.size || kDoktorovi.size) return 1;
  return nemereno.length ? 3 : 0;
}

if (isDirectRun(import.meta.url)) {
  let kod;
  try {
    const a = argumenty(process.argv.slice(2));
    if (a.coolify) {
      kod = await celyProjekt(a);
    } else {
      const zdroju = (a["coolify-envs"] !== undefined) + (a["env-file"] !== undefined);
      if (a.compose.length === 0 || zdroju !== 1 || (a.app !== undefined && a.compose.length > 1)) {
        throw new Error(
          "použití: --compose <f> [--compose <g> …] (--coolify-envs <soubor|-> | --env-file <soubor>)\n" +
          "         [--app <jméno>, jen s jedním compose] [--sot <.env.coolify>]\n" +
          "         --coolify --prefix <p> [--env-file <SoT>]",
        );
      }
      kod = await vyjmenovaneCompose(a);
    }
  } catch (e) {
    console.error(`povinne-promenne: NEMĚŘENO — ${e.message}`);
    kod = 2;
  }
  process.exit(kod);
}
