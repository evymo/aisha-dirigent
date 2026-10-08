#!/usr/bin/env node
// gen-netbird-instance.mjs — JEDEN zdroj řídicí roviny meshe, vykreslený pro každou
// DEKLAROVANOU instanci stacku NetBird (config/netbird-instances.json).
//
//   node scripts/gen-netbird-instance.mjs           # zapíše compose a šablonu management.json každé instance
//   node scripts/gen-netbird-instance.mjs --check   # jen ověří shodu (brána netbird-instance-z-generatoru)
//
// ⭐ PROČ GENERÁTOR (aisha.decision 2026-10-05 03:17:54Z, varianta C). Každý fork dostává
// vedle hlavního meshe SAMOSTATNÝ MODELOVÝ mesh — druhou instanci téhož stacku z téhož
// generátoru a deklarace. Ručně psaný hlavní compose, ze kterého by se modelový odvozoval
// přepisem textu, by byly DVA zdroje téže věci: každá ruční úprava hlavního by modelový
// tiše rozešla. Zdroj je proto jeden (šablona + deklarace) a OBĚ instance jsou VÝSTUP,
// hlídaný `--check` — týž tvar jako gen-mesh-router.
//
// ⭐ HLAVNÍ INSTANCE JE BAJTOVĚ SHODNÁ s dřívějším ručním souborem. To je důkaz, že fork
// bez modelového meshe se zavedením generátoru nemění (kontrakt meshe DT4/MM4).
//
// Šablona zná jen dvě konstrukce, obě s tvrdým selháním:
//   {{JMENO}}            hodnota z `hodnoty` instance (neznámá = chyba, ne prázdno)
//   {{#sekce}}…{{/sekce}} blok, který instance nese, jen když `sekce.<jméno>` je true
//                        (značka na vlastním řádku odebere i ten řádek)
// Po vykreslení nesmí zbýt žádné `{{` — šablona doručená místo hodnoty je tichá vada.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDirectRun } from "./lib/cli-entry.mjs";

const ROOT = process.cwd();
export const DEKLARACE = "config/netbird-instances.json";
export const SABLONA_COMPOSE = "coolify/netbird/compose.sablona.yml.tpl";
export const SABLONA_MANAGEMENT = "coolify/netbird/management.sablona.json.tpl";

export function nactiDeklaraci(root = ROOT) {
  const d = JSON.parse(readFileSync(join(root, DEKLARACE), "utf-8"));
  if (!Array.isArray(d.instance) || d.instance.length === 0) {
    throw new Error(`${DEKLARACE}: chybí neprázdné pole "instance"`);
  }
  const ids = new Set();
  for (const i of d.instance) {
    for (const k of ["id", "compose", "management", "hodnoty", "sekce"]) {
      if (i[k] === undefined) throw new Error(`${DEKLARACE}: instance ${i.id ?? "?"} nemá "${k}"`);
    }
    if (ids.has(i.id)) throw new Error(`${DEKLARACE}: instance "${i.id}" je deklarovaná dvakrát`);
    ids.add(i.id);
  }
  return d.instance;
}

/**
 * Vykreslí šablonu pro jednu instanci. Čistá funkce — žádné IO.
 * Neznámý zástupný znak, nedeklarovaná sekce nebo zbylé `{{` = výjimka.
 */
export function vykresli(sablona, instance) {
  const { hodnoty, sekce, id } = instance;
  // Značka sekce na vlastním řádku: odebrat celý řádek, značku ponechat k dalšímu kroku.
  let s = sablona.replace(/^[ \t]*(\{\{[#/][a-z_]+\}\})[ \t]*\n/gm, "$1");
  s = s.replace(/\{\{#([a-z_]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, jmeno, obsah) => {
    if (typeof sekce[jmeno] !== "boolean") {
      throw new Error(`instance "${id}": sekce "${jmeno}" není v deklaraci (true/false)`);
    }
    return sekce[jmeno] ? obsah : "";
  });
  s = s.replace(/\{\{([A-Z_]+)\}\}/g, (_, jmeno) => {
    if (typeof hodnoty[jmeno] !== "string") {
      throw new Error(`instance "${id}": zástupný znak {{${jmeno}}} nemá hodnotu v deklaraci`);
    }
    return hodnoty[jmeno];
  });
  if (s.includes("{{")) {
    throw new Error(`instance "${id}": po vykreslení zůstalo "{{" — neuzavřená sekce nebo neznámý tvar`);
  }
  return s;
}

export function vystupy(root = ROOT) {
  const compose = readFileSync(join(root, SABLONA_COMPOSE), "utf-8");
  const management = readFileSync(join(root, SABLONA_MANAGEMENT), "utf-8");
  return nactiDeklaraci(root).flatMap((i) => [
    { instance: i.id, cesta: i.compose, obsah: vykresli(compose, i) },
    { instance: i.id, cesta: i.management, obsah: vykresli(management, i) },
  ]);
}

// Registr se drží U PARSOVÁNÍ: neznámý přepínač u ZAPISUJÍCÍHO nástroje je STOP.
const ZNAME_PREPINACE = new Set(["--check"]);

const NAPOVEDA = `gen-netbird-instance — vykreslí řídicí roviny meshe z jedné šablony a deklarace

  bez přepínače  ZAPÍŠE compose a šablonu management.json každé instance
  --check        jen ověří shodu, NEZAPISUJE (používá brána)
  --help, -h     tahle nápověda`;

export function main(argv = process.argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(NAPOVEDA);
    return 0;
  }
  const nezname = argv.slice(2).filter((a) => a.startsWith("-") && !ZNAME_PREPINACE.has(a.split("=")[0]));
  if (nezname.length > 0) {
    // Neznámý přepínač u ZAPISUJÍCÍHO nástroje = STOP (brána neznamy-prepinac-neni-vychozi-chovani).
    console.error(`gen-netbird-instance: neznámý přepínač: ${nezname.join(" ")}`);
    console.error(NAPOVEDA);
    process.exit(2);
  }
  const jenOver = argv.includes("--check");
  let neshody = 0;
  for (const { instance, cesta, obsah } of vystupy()) {
    if (jenOver) {
      let mame = null;
      try { mame = readFileSync(join(ROOT, cesta), "utf-8"); } catch { /* chybí */ }
      if (mame !== obsah) {
        neshody++;
        console.error(`✗ ${cesta} (${instance}) ${mame === null ? "CHYBÍ" : "se rozešel s generátorem"}`);
      } else {
        console.log(`✓ ${cesta} (${instance})`);
      }
    } else {
      writeFileSync(join(ROOT, cesta), obsah);
      console.log(`zapsáno ${cesta} (${instance})`);
    }
  }
  if (jenOver && neshody > 0) {
    console.error(`\nNáprava: needitovat výstup ručně — upravit šablonu/deklaraci a spustit node scripts/gen-netbird-instance.mjs`);
    return 1;
  }
  return 0;
}

if (isDirectRun(import.meta.url)) {
  process.exit(main());
}
