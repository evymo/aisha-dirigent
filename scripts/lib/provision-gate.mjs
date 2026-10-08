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
 *   node provision-gate.mjs --compose-zavrenych [--env-file <soubor>]
 *        → compose soubory, které nese JEN služba s vypnutou lane, po řádcích (preflight
 *          je měří jen strukturou)
 *   node provision-gate.mjs --dopln-adresy-zavrenych <soubor>
 *        → do env souboru doplní PRÁZDNÝ řádek pro každou adresu služby se zavřenou
 *          lane, kterou soubor ještě nenese (lane se čte z téhož souboru); vypíše jména
 *   kód 2 = katalog nejde přečíst (NEMĚŘENO — nikdy se netváří jako „nic")
 *
 * Zdroj hodnot: prostředí procesu, a je-li předán `--env-file`, pak soubor
 * s tím, že VÝSLOVNĚ nastavené prostředí má přednost (operátor smí lane pro
 * jeden běh přepnout bez úpravy souboru).
 */
import { readFileSync, writeFileSync } from "node:fs";
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

/** Klíče, pod kterými resolver vydává adresy služby: `<ID>_URL` a aliasy z katalogu. */
function kliceAdres(id, sluzba) {
  const klice = [];
  if (sluzba?.internal_url?.service && sluzba?.internal_url?.port) {
    klice.push(`${id.toUpperCase().replace(/-/g, "_")}_URL`, ...(sluzba.internal_url.env_aliases ?? []));
  }
  for (const ep of [...(sluzba?.internal_endpoints ?? []), ...(sluzba?.internal_tcp_endpoints ?? [])]) {
    klice.push(...(ep.env_aliases ?? []));
  }
  return klice;
}

/**
 * Klíče adres služeb, jejichž lane je ZAVŘENÁ — resolver je nevydá, protože službu
 * vynechá celou. Klíč, který deklaruje i služba se zapnutou lane (sdílený alias),
 * sem nepatří: tu adresu resolver vydá.
 *
 * ⛔ NAMĚŘENO 2026-10-04 (vypnutí lokálního modelu na nasazené instanci). Zavřít lane
 * je ROZHODNUTÍ (`CHAT_GGUF_URL=`), jenže adresa služby (`VLLM_GENERATION_URL`, čte ji
 * core i ai-chat) v novém env souboru jen CHYBĚLA — a chybějící čtený klíč kontinuita
 * převezme z minula. Migrace by tak dostala adresu služby, která se nenasazuje, a
 * provider `vllm-local` by zapnula; v Coolify by stará adresa visela dál, protože sync
 * klíče nemaže. Chybění je od zapomenutí nerozeznatelné; prázdná hodnota je deklarace.
 */
export function adresyZavrenychLanes(sluzby, cti = (k) => process.env[k]) {
  const zavrene = new Set(neprovisionovaneSluzby(sluzby, cti));
  const vydavaZapnuta = new Set();
  for (const [id, s] of Object.entries(sluzby ?? {})) {
    if (s && !zavrene.has(id)) for (const k of kliceAdres(id, s)) vydavaZapnuta.add(k);
  }
  const klice = new Set();
  for (const id of zavrene) for (const k of kliceAdres(id, sluzby[id])) if (!vydavaZapnuta.has(k)) klice.add(k);
  return [...klice].sort();
}

/** Compose soubory služby v katalogu: hlavní a varianta pro slot s GPU (`compose_gpu`). */
function composeSluzby(sluzba) {
  return [sluzba?.compose, sluzba?.compose_gpu].filter(Boolean);
}

/**
 * Compose soubory, které nese JEN služba se ZAVŘENOU lane — instance je nenasadí, takže se
 * jejich env nemá ani validovat (preflight je měří jen strukturou). Compose, který nese
 * i služba se zapnutou lane (sdílený stack), sem nepatří: ten se nasadí.
 *
 * ⛔ NAMĚŘENO 2026-10-06 (suchý běh konvergence guru): preflight interpoloval firewall
 * hostitele GPU uzlu (accel-hostfw, opt-in deklarací uzlu), který story-init bez
 * deklarace nezaloží; holé `start_period: ${ACCEL_FW_CONFIRM_S}s` vyšlo jako `s`
 * a cold-start padl za službu, která se nenasazuje. Odpověď má tenhle domov, ne
 * druhé čtení řádků `app:` v preflightu.
 */
export function composeZavrenychLanes(sluzby, cti = (k) => process.env[k]) {
  const zavrene = new Set(neprovisionovaneSluzby(sluzby, cti));
  const nesouZapnute = new Set();
  for (const [id, s] of Object.entries(sluzby ?? {})) {
    if (s && !zavrene.has(id)) for (const c of composeSluzby(s)) nesouZapnute.add(c);
  }
  const vysledek = new Set();
  for (const id of zavrene) for (const c of composeSluzby(sluzby[id])) if (!nesouZapnute.has(c)) vysledek.add(c);
  return [...vysledek].sort();
}

/**
 * Doplní do textu env souboru PRÁZDNÝ řádek pro každý klíč, který v něm ještě není.
 * Klíč, který soubor už nese, se NEMĚNÍ — ani neprázdný: adresu, kterou operátor
 * připnul v záloze (cizí služba místo vlastní), zapsal průchod zálohy a platí dál.
 */
export function doplnPrazdneKlice(text, klice) {
  const zaklad = String(text);
  const ma = new Set([...zaklad.matchAll(/^([A-Z_][A-Z0-9_]*)=/gm)].map((m) => m[1]));
  const doplnene = klice.filter((k) => !ma.has(k));
  if (!doplnene.length) return { text: zaklad, doplnene };
  const oddelovac = zaklad === "" || zaklad.endsWith("\n") ? "" : "\n";
  return { text: `${zaklad}${oddelovac}${doplnene.map((k) => `${k}=`).join("\n")}\n`, doplnene };
}

/** Zavřené lanes se čtou z TÉHOŽ souboru, který se doplňuje (prostředí má přednost). */
export function doplnAdresyZavrenych(soubor, sluzby = nactiKatalog()) {
  const r = doplnPrazdneKlice(readFileSync(soubor, "utf8"), adresyZavrenychLanes(sluzby, ctenarHodnot(soubor)));
  if (r.doplnene.length) writeFileSync(soubor, r.text);
  return r.doplnene;
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
  // ⛔ Neznámý přepínač je STOP, ne jiná větev. Nástroj umí zapisovat
  // (--dopln-adresy-zavrenych); překlep v přepínači by jinak spadl do větve, kterou
  // volající nechtěl, a skončil kódem, který čte jako odpověď. Registr se drží
  // u parsování — přepínač přidaný níž a nezapsaný sem stráž shodí na první použití.
  const ZNAME_PREPINACE = new Set(["--zapnuto", "--neprovisionovane", "--compose-zavrenych", "--env-file", "--dopln-adresy-zavrenych"]);
  const POUZITI =
    "použití: provision-gate.mjs --zapnuto <id> | --neprovisionovane [--env-file <soubor>] | --compose-zavrenych [--env-file <soubor>] | --dopln-adresy-zavrenych <soubor>";
  const nezname = argv.filter((a) => a.startsWith("-") && !ZNAME_PREPINACE.has(a));
  if (nezname.length) {
    console.error(`provision-gate: neznámý přepínač ${nezname.join(" ")} — NEMĚŘENO\n${POUZITI}`);
    process.exit(2);
  }
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
  const kDoplneni = hodnotaZa("--dopln-adresy-zavrenych");
  if (argv.includes("--dopln-adresy-zavrenych")) {
    if (!kDoplneni) {
      console.error("provision-gate: --dopln-adresy-zavrenych potřebuje cestu k env souboru");
      process.exit(2);
    }
    let doplnene;
    try {
      doplnene = doplnAdresyZavrenych(kDoplneni, sluzby);
    } catch (e) {
      console.error(`provision-gate: adresy zavřených lanes nejdou doplnit do ${kDoplneni} — NEMĚŘENO (${e.message})`);
      process.exit(2);
    }
    if (doplnene.length) console.log(`  Zavřené lanes — adresy vydány PRÁZDNÉ (${doplnene.length}): ${doplnene.join(" ")}`);
    process.exit(0);
  }
  const cti = ctenarHodnot(hodnotaZa("--env-file"));
  if (argv.includes("--neprovisionovane")) {
    for (const id of neprovisionovaneSluzby(sluzby, cti)) console.log(id);
    process.exit(0);
  }
  if (argv.includes("--compose-zavrenych")) {
    for (const f of composeZavrenychLanes(sluzby, cti)) console.log(f);
    process.exit(0);
  }
  const id = hodnotaZa("--zapnuto");
  if (id) {
    const deklarace = sluzby[id]?.provision_when_env;
    if (podminkaSplnena(deklarace, cti)) process.exit(0);
    console.log(klicePodminky(deklarace).join(" "));
    process.exit(1);
  }
  console.error(POUZITI);
  process.exit(2);
}
