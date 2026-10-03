#!/usr/bin/env node
/**
 * provision-gate.mjs — je opt-in lane služby ZAPNUTÁ? Jeden domov té otázky.
 *
 * Katalog (`config/services.json`) deklaruje u opt-in služeb `provision_when_env`
 * (řetězec = jedna podmínka, pole = kterákoli z nich) a u veřejné tváře
 * `public_when_env`. Odpověď „zapnuto?" dosud dávalo PĚT míst samostatně:
 * story-init (jq + bash), coolify-app-vars (inline node), derive-domains (třikrát)
 * — a všechna shodně za zapnuté brala JAKOUKOLI neprázdnou hodnotu.
 *
 * ⛔ NAMĚŘENO 2026-09-13 (audit cesty cold-startu nad guru): `config/domains.env`
 * nese `EXTRANET_ENABLED=false` jako vypínač — a všech pět míst ho četlo jako
 * ZAPNUTO. Vypínač, který nejde vypnout, je horší než žádný: dělá dojem, že
 * rozhodnutí existuje.
 *
 * Pravidlo je proto zde a jen zde: lane je zapnutá, když hodnota po ořezání není
 * prázdná a není to výslovné „ne" (`false`, `0`, `no`, `off`, bez ohledu na
 * velikost písmen). Cokoli jiného — URL, cesta, `1`, `true` — je deklarace lane.
 *
 * CLI:
 *   node provision-gate.mjs --zapnuto <id> [--env-file <soubor>]
 *        → kód 0 = služba se nasazuje (nemá podmínku, nebo je lane zapnutá)
 *          kód 1 = nenasazuje se; na stdout jména podmínek oddělená mezerou
 *   node provision-gate.mjs --neprovisionovane [--env-file <soubor>]
 *        → id služeb, jejichž lane je vypnutá, po řádcích
 *   kód 2 = katalog nejde přečíst (NEMĚŘENO — nikdy se netváří jako „nic")
 *
 * Zdroj hodnot: prostředí procesu, a je-li předán `--env-file`, pak soubor
 * s tím, že VÝSLOVNĚ nastavené prostředí má přednost (operátor smí lane pro
 * jeden běh přepnout bez úpravy souboru).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectRun } from "./cli-entry.mjs";
import { parseEnvFile } from "./config-env-files.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const VYSLOVNE_NE = /^(false|0|no|off)$/i;

/** Je hodnota deklarací zapnuté lane? */
export function jeLaneZapnuta(hodnota) {
  const t = String(hodnota ?? "").trim();
  return t !== "" && !VYSLOVNE_NE.test(t);
}

/** Jména podmínek z deklarace (`provision_when_env` / `public_when_env`), vždy pole. */
export function klicePodminky(deklarace) {
  if (!deklarace) return [];
  return (Array.isArray(deklarace) ? deklarace : [deklarace]).filter(Boolean);
}

/**
 * Splňuje hodnota některou z podmínek? Bez podmínky = ano.
 * @param {string|string[]|undefined} deklarace
 * @param {(klic: string) => string|undefined} cti
 */
export function podminkaSplnena(deklarace, cti = (k) => process.env[k]) {
  const klice = klicePodminky(deklarace);
  return klice.length === 0 || klice.some((k) => jeLaneZapnuta(cti(k)));
}

/** Id služeb katalogu, jejichž provisioning lane je vypnutá. */
export function neprovisionovaneSluzby(sluzby, cti = (k) => process.env[k]) {
  return Object.entries(sluzby ?? {})
    .filter(([, s]) => s && !podminkaSplnena(s.provision_when_env, cti))
    .map(([id]) => id);
}

/** Čtenář hodnot: prostředí má přednost, env soubor je deklarace pod ním. */
export function ctenarHodnot(envFile) {
  const zeSouboru = envFile ? parseEnvFile(envFile, { keepEmpty: true }) : {};
  return (k) => {
    const zProstredi = process.env[k];
    return zProstredi !== undefined && String(zProstredi).trim() !== "" ? zProstredi : zeSouboru[k];
  };
}

export function nactiKatalog(cesta = join(REPO_ROOT, "config/services.json")) {
  const j = JSON.parse(readFileSync(cesta, "utf8"));
  return j.services ?? j;
}

if (isDirectRun(import.meta.url)) {
  const argv = process.argv.slice(2);
  const hodnotaZa = (prepinac) => {
    const i = argv.indexOf(prepinac);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  let sluzby;
  try {
    sluzby = nactiKatalog();
  } catch (e) {
    console.error(`provision-gate: katalog nejde přečíst — NEMĚŘENO (${e.message})`);
    process.exit(2);
  }
  const cti = ctenarHodnot(hodnotaZa("--env-file"));
  if (argv.includes("--neprovisionovane")) {
    for (const id of neprovisionovaneSluzby(sluzby, cti)) console.log(id);
    process.exit(0);
  }
  const id = hodnotaZa("--zapnuto");
  if (id) {
    const deklarace = sluzby[id]?.provision_when_env;
    if (podminkaSplnena(deklarace, cti)) process.exit(0);
    console.log(klicePodminky(deklarace).join(" "));
    process.exit(1);
  }
  console.error("použití: provision-gate.mjs --zapnuto <id> | --neprovisionovane [--env-file <soubor>]");
  process.exit(2);
}
