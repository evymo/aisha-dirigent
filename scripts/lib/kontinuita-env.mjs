#!/usr/bin/env node
/**
 * kontinuita-env.mjs — nový .env.coolify EXISTUJÍCÍ instance nesmí ztratit, co drží provoz
 *
 * Krok 2 cold-startu vyrábí .env.coolify NANOVO (heredoc + tajemství z minula +
 * záloha) a env-doktor potom doplní, co chybí. Nad existujícím stackem
 * (`--skip-create`) tím tiše mizí všechno, co žilo jen v minulém souboru:
 *
 * ⛔ NAMĚŘENO 2026-10-03 (konvergence nasazené instance, výpadek ~7 h):
 *   (8) DRŽENÝ klíč: `POSTGRES_MAJOR` minulý soubor nesl 17, nový ho neměl a doktor
 *       doplnil domov (18) → obraz 18 nad daty 17 odmítl start. `AISHA_DB_IMAGE` totéž.
 *   (9) PIN operátora: `KEYCLOAK_URL=${KEYCLOAK_URL:-https://${KEYCLOAK_DOMAIN}}` —
 *       pin žil jen v minulém souboru, odvození bez něj dalo `https://` (prázdný host).
 *   (10) 27 klíčů ze souboru ZMIZELO, 12 z nich nasazovaná verze čte (CORS_ALLOWLIST,
 *       SVC_MONEY_URL, FCM/GCP…). V Coolify zůstaly jen proto, že sync klíče nemaže —
 *       to je štěstí, ne vlastnost. Simulace kroku 2 hlídala jen VYPRÁZDNĚNÍ.
 *
 * Pravidla (nad klíči s neprázdnou minulou hodnotou):
 *   držený klíč (DRZENE_INSTANCI)        → minulá hodnota VYHRÁVÁ; změnu smí jen nástroj
 *                                           k tomu určený (postgres-major-upgrade.mjs)
 *   klíč, který compose čte, a v novém CHYBÍ → převezme se z minula
 *   síťová URL s PRÁZDNÝM hostem u čteného klíče → minulá platná hodnota vyhrává (pin);
 *                                           bez ní: klíč, který compose VYŽADUJE (`:?`), je
 *                                           VADA a soubor se nezapíše; volitelný se ohlásí
 *   změněná hodnota čteného klíče        → jen hlášení (jména), ať je vidět, co sync změní
 * Prázdná hodnota v novém souboru se tu NEPŘEBÍJÍ: odvozené klíče mají vyhrát
 * čerstvým odvozením (ozvěna starého výstupu je jiná, dřív naměřená vada);
 * hodnoty operátora (external/placeholder) přebírá cold-start o krok dřív.
 *
 * Rozhodnutí je čistá funkce (měří brána kontinuita-env-existujici-instance);
 * CLI nový soubor přepíše na místě a vypíše jen JMÉNA klíčů, nikdy hodnoty.
 *
 *   node scripts/lib/kontinuita-env.mjs --minule <.env.coolify> --nove <tmp> --koren <repo>
 *   návratový kód: 0 v pořádku (i s převzetím), 3 vada (soubor se NEMĚNÍ),
 *                  4 NEMĚŘENO — minulý soubor chybí nebo nenese žádný klíč (soubor se NEMĚNÍ)
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isDirectRun } from "./cli-entry.mjs";

/**
 * Klíče, jejichž hodnotu si instance DRŽÍ proti domovu (config/image-versions.env):
 * v kontraktu doktora `["K", "required-static", image("K", "")]` — „zapisuje se jen
 * tam, kde klíč chybí". Seznam hlídá brána proti zdroji doktora (nový držený klíč
 * bez zápisu sem = červená).
 */
export const DRZENE_INSTANCI = ["AISHA_DB_IMAGE", "POSTGRES_MAJOR"];

const KLIC_RADKU = /^([A-Z_][A-Z0-9_]*)=(.*)$/;

function holy(hodnota) {
  const v = String(hodnota ?? "").trim();
  return v.length >= 2 && v[0] === v[v.length - 1] && (v[0] === '"' || v[0] === "'") ? v.slice(1, -1) : v;
}

/**
 * Síťová URL bez hostu (`https://`, `http:///cesta`, `wss://:8443`) — odvození z prázdné
 * domény. Jen schémata, kde je host povinný: `file:///…` nebo `postgresql:///db`
 * (místní socket) jsou platné tvary a sem nepatří.
 */
export function urlBezHostu(hodnota) {
  return /^(?:https?|wss?):\/\/(?:[/:?#]|$)/i.test(holy(hodnota));
}

function nacti(text) {
  const mapa = new Map();
  for (const radek of String(text).split("\n")) {
    const m = radek.match(KLIC_RADKU);
    if (m) mapa.set(m[1], { radek, hodnota: holy(m[2]) });
  }
  return mapa;
}

/**
 * Proměnné, které čte aspoň jeden compose nasazované verze (`${VAR…}`), a z nich ty,
 * které některý compose VYŽADUJE (`${VAR:?…}` / `${VAR?…}`).
 */
export function cteneCompose(texty) {
  const ctene = new Set();
  const povinne = new Set();
  for (const text of texty) {
    for (const m of String(text).matchAll(/\$\{([A-Z_][A-Z0-9_]*)(:?\?)?/g)) {
      ctene.add(m[1]);
      if (m[2]) povinne.add(m[1]);
    }
  }
  return { ctene, povinne };
}

/**
 * @param {{ minule: string, nove: string, ctene: Set<string>, povinne?: Set<string>, drzene?: string[] }} vstup
 * @returns {{ vystup: string, drzene: string[], prevzate: string[], piny: string[], zmenene: string[], bezHostu: string[], vady: string[] }}
 */
export function srovnejKontinuitu({ minule, nove, ctene, povinne = new Set(), drzene = DRZENE_INSTANCI }) {
  const stare = nacti(minule);
  const nova = nacti(nove);
  const nahradit = new Map();
  const pridat = [];
  const hlaseni = { drzene: [], prevzate: [], piny: [], zmenene: [], bezHostu: [], vady: [] };

  for (const [klic, s] of stare) {
    if (s.hodnota === "") continue;
    const n = nova.get(klic);
    if (drzene.includes(klic)) {
      if (!n) { pridat.push(s.radek); hlaseni.drzene.push(klic); } else if (n.hodnota !== s.hodnota) { nahradit.set(klic, s.radek); hlaseni.drzene.push(klic); }
      continue;
    }
    if (!ctene.has(klic)) continue;
    if (!n) { pridat.push(s.radek); hlaseni.prevzate.push(klic); continue; }
    if (urlBezHostu(n.hodnota)) {
      if (!urlBezHostu(s.hodnota)) { nahradit.set(klic, s.radek); hlaseni.piny.push(klic); }
      continue; // obě bez hostu → vada níž
    }
    if (n.hodnota !== "" && n.hodnota !== s.hodnota) hlaseni.zmenene.push(klic);
  }
  // URL bez hostu, kterou nebylo čím nahradit (třída, ne jeden klíč): vyžadovaný klíč
  // je fail-closed — služba by s ní nastartovala a selhávala až za běhu; volitelný
  // (funkce nenastavená) se jen ohlásí.
  for (const [klic, n] of nova) {
    if (!ctene.has(klic) || !urlBezHostu(n.hodnota) || nahradit.has(klic)) continue;
    if (povinne.has(klic)) hlaseni.vady.push(`${klic}: compose ho vyžaduje a hodnota je URL s prázdným hostem (žádná platná minulá hodnota)`);
    else hlaseni.bezHostu.push(klic);
  }

  const radky = String(nove).split("\n").map((radek) => {
    const m = radek.match(KLIC_RADKU);
    return m && nahradit.has(m[1]) ? nahradit.get(m[1]) : radek;
  });
  let vystup = radky.join("\n");
  if (pridat.length) vystup = `${vystup}${vystup === "" || vystup.endsWith("\n") ? "" : "\n"}${pridat.join("\n")}\n`;
  for (const k of Object.keys(hlaseni)) hlaseni[k].sort();
  return { vystup, ...hlaseni };
}

/** CLI: návratový kód vrací, proces nekončí — volá ho i brána v témže procesu. */
export function main(argv) {
  const arg = (jmeno) => { const i = argv.indexOf(jmeno); return i >= 0 ? argv[i + 1] : undefined; };
  const minule = arg("--minule"); const nove = arg("--nove"); const koren = arg("--koren");
  if (!minule || !nove || !koren) { console.error("použití: kontinuita-env.mjs --minule <soubor> --nove <soubor> --koren <repo>"); return 2; }
  // Minulý soubor je vlastnost STROMU (není v gitu), ne instance: v čerstvém klonu, v jiném pracovním
  // stromu nebo na jiném stroji chybí. Bez něj není s čím srovnat — a „není s čím srovnat“ není
  // „v pořádku“: nový soubor by vzal držené hodnoty a piny z domova, ne z provozu (tvar výpadku,
  // kvůli kterému kontinuita vznikla). Rozhoduje se TADY, ne podmínkou u volajícího: volající,
  // který by kontrolu při chybějícím souboru přeskočil, ji přeskočí potichu.
  const minulyText = existsSync(minule) ? readFileSync(minule, "utf8") : "";
  // TÝŽ výraz, kterým klíče čte `nacti()`: volnější kontrola by pustila soubor, ze kterého se pak
  // nepřečte nic (jen řádky malými písmeny), a srovnávalo by se proti nule klíčů.
  if (nacti(minulyText).size === 0) {
    console.error(`✗ kontinuita NEMĚŘENA: minulý soubor ${minule} chybí nebo nenese žádný klíč — NEZAPISUJI.`);
    console.error("    Nad existujícím stackem by nový soubor vzal držené hodnoty a piny z domova, ne z provozu.");
    console.error("    Konverguj ze stromu, který drží soubor z posledního běhu této instance.");
    return 4;
  }
  const composes = readdirSync(resolve(koren)).filter((f) => /^docker-compose\.coolify.*\.ya?ml$/.test(f));
  if (!composes.length) { console.error(`✗ kontinuita: v ${koren} není žádný docker-compose.coolify*.yml — nevím, co nasazovaná verze čte`); return 3; }
  const { ctene, povinne } = cteneCompose(composes.map((f) => readFileSync(join(resolve(koren), f), "utf8")));
  const r = srovnejKontinuitu({ minule: minulyText, nove: readFileSync(nove, "utf8"), ctene, povinne });
  if (r.vady.length) {
    console.error("✗ kontinuita: nový .env.coolify by nasadil rozbitou hodnotu — NEZAPISUJI:");
    for (const v of r.vady) console.error(`    ${v}`);
    return 3;
  }
  writeFileSync(nove, r.vystup);
  const vypis = (popis, klice) => { if (klice.length) console.log(`  ${popis} (${klice.length}): ${klice.join(" ")}`); };
  vypis("DRŽENO instancí — minulá hodnota vyhrála nad domovem; změnu dělá jen nástroj k tomu určený", r.drzene);
  vypis("PŘEVZATO z minula — compose je čte, nový soubor je neměl; doplň je do zálohy", r.prevzate);
  vypis("PIN operátora — odvození dalo URL bez hostu, platí minulá hodnota; doplň pin do zálohy", r.piny);
  vypis("URL bez hostu u volitelného klíče — funkce není nastavená, nebo chybí doména", r.bezHostu);
  vypis("změněná hodnota čteného klíče — sync ji přepíše v aplikacích", r.zmenene);
  return 0;
}

if (isDirectRun(import.meta.url)) process.exitCode = main(process.argv.slice(2));
