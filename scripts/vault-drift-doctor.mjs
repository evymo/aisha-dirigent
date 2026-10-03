#!/usr/bin/env node
/**
 * vault-drift-doctor.mjs — hodnota v trezoru, která PŘEBÍJÍ čerstvou.
 *
 * ⛔ PROČ (naměřeno 2026-08-25): kanonický řetěz (lib/config-env-files.mjs)
 * říká, že `.env-prod-backup` má VYŠŠÍ přednost než `.env.coolify`. To je
 * záměr — trezor drží, co operátor dodal a co má přežít wipe. Jenže tajemství,
 * která si vyrábí sama platforma, se do trezoru dostanou při snapshotu a pak
 * ZKAMENÍ: generátor je přerazí do `.env.coolify`, trezor si drží starou
 * hodnotu — a protože je výš, každý nástroj čtoucí řetěz dostane MRTVOU.
 *
 * Přesně tohle stálo 2026-08-25 několik hodin: `netbird-bootstrap.sh` vyrobil
 * čtyři nové setup klíče do `.env.coolify`, trezor si nechal staré, a agenti
 * hlásili `setup key is invalid`, ač validace „podle ID" procházela. Tatáž
 * vada držela `AISHA_BOOTSTRAP_CLIENT_SECRET` (401 unauthorized_client, ač
 * secret v `.env.coolify` s Keycloakem SEDĚL) a `NETBIRD_DNS_IP=127.0.0.11`
 * (vestavěný resolver Dockeru místo mesh DNS).
 *
 * Rozchod SÁM O SOBĚ není vada — u `external` klíčů je trezor právem autorita.
 * Vada je rozchod u klíče, který si platforma VYRÁBÍ: tam je `.env.coolify`
 * výstup generátoru a trezor jen jeho zastaralá kopie.
 *
 * Nikdy nevypisuje HODNOTU — jen otisk (délka + sha256), aby se dal rozchod
 * ukázat, aniž by tajemství uteklo do logu.
 *
 * Provoz:
 *   node scripts/vault-drift-doctor.mjs            # jen měří (výchozí)
 *   node scripts/vault-drift-doctor.mjs --json     # strojově
 */

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectRun } from "./lib/cli-entry.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GENEROVANY = join(ROOT, ".env.coolify");
const TREZOR = join(ROOT, ".env-prod-backup");

/**
 * Klíče, které si platforma VYRÁBÍ nebo ODVOZUJE. Univerzum se HLEDÁ v
 * registru `aisha-env-doctor.mjs` — neopisuje se sem, aby brána nezdědila
 * díry ručního seznamu. Registr má tvar `["KLÍČ", "typ", …]`.
 *
 * Typy podle env-doctoru:
 *   secret | hex | b64std  — vygenerované tajemství
 *   placeholder            — env-doctor zapíše zástupný text, skutečnou
 *                            hodnotu doplní až provisioning (setup klíče)
 *   static                 — pevná hodnota vydávaná platformou
 *   external               — DODÁVÁ OPERÁTOR; tam je trezor právem autorita
 */
const VYRABENE_TYPY = new Set(["secret", "hex", "b64std", "placeholder", "static"]);

export function nactiRegistrTypu(cesta = join(ROOT, "scripts/aisha-env-doctor.mjs")) {
  const t = readFileSync(cesta, "utf8");
  const registr = new Map();
  for (const m of t.matchAll(/\[\s*"([A-Z][A-Z0-9_]*)"\s*,\s*"([a-z0-9]+)"/g)) {
    if (!registr.has(m[1])) registr.set(m[1], m[2]);
  }
  return registr;
}

export function nactiEnv(cesta) {
  const o = new Map();
  if (!existsSync(cesta)) return o;
  for (const radek of readFileSync(cesta, "utf8").split("\n")) {
    const m = radek.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) o.set(m[1], m[2].trim().replace(/^['"]|['"]$/g, ""));
  }
  return o;
}

const otisk = (s) =>
  s ? `${String(s).length}z/${createHash("sha256").update(String(s)).digest("hex").slice(0, 8)}` : "—";

/**
 * @returns {{vady: object[], podleZameru: object[], neznameTypy: object[]}}
 */
export function zmerRozchod({
  generovany = GENEROVANY,
  trezor = TREZOR,
  registr = nactiRegistrTypu(),
} = {}) {
  const g = nactiEnv(generovany);
  const t = nactiEnv(trezor);
  const vady = [], podleZameru = [], neznameTypy = [];
  for (const [klic, hodnotaG] of g) {
    if (!t.has(klic)) continue;
    const hodnotaT = t.get(klic);
    if (hodnotaG === hodnotaT) continue;
    const typ = registr.get(klic);
    const zaznam = { klic, typ: typ ?? "(neregistrovaný)", generovany: otisk(hodnotaG), trezor: otisk(hodnotaT) };
    if (typ && VYRABENE_TYPY.has(typ)) vady.push(zaznam);
    else if (typ === "external") podleZameru.push(zaznam);
    else neznameTypy.push(zaznam);
  }
  return { vady, podleZameru, neznameTypy };
}

// ⛔ NE `import.meta.url === \`file://${process.argv[1]}\``. To porovnává ŘETĚZCE:
// stačí symlink, worktree nebo diakritika v cestě a blok se TIŠE přeskočí —
// měřidlo pak vypíše nic a skončí nulou, což se čte jako „žádný rozchod".
// `isDirectRun` porovnává dev+ino (viz lib/cli-entry.mjs). Chytila to brána
// `strazce-vstupu-porovnava-soubor` na tomhle souboru.
/**
 * Přerazí v trezoru zkamenělé kopie klíčů, které si platforma VYRÁBÍ.
 *
 * ⛔ Opravuje se VÝHRADNĚ `vady` — klíče, u kterých je `.env.coolify` výstup
 * generátoru a trezor jen jeho stará kopie. `podleZameru` (autorita je
 * operátor) ani `neznameTypy` (nevím, čí to je hodnota) se NESAHÁ: přepsat
 * cizí vstup na základě domněnky je horší než rozchod nechat viditelný.
 *
 * Zapisuje se ŘÁDEK PO ŘÁDKU, aby v trezoru přežily komentáře i pořadí —
 * přegenerování celého souboru by zahodilo, co tam operátor napsal rukou.
 *
 * @returns {{prepsano: string[], nenalezeno: string[], zaloha: string}}
 */
export function opravTrezor({ generovany = GENEROVANY, trezor = TREZOR, vady, casovaZnacka } = {}) {
  if (!vady?.length) return { prepsano: [], nenalezeno: [], zaloha: "" };
  if (!casovaZnacka) throw new Error("opravTrezor: casovaZnacka je POVINNÁ (jméno zálohy musí být určeno volajícím)");
  const g = nactiEnv(generovany);
  const cerstve = new Map();
  for (const v of vady) {
    if (!g.has(v.klic)) continue;
    cerstve.set(v.klic, g.get(v.klic));
  }
  const zaloha = `${trezor}.pred-opravou-${casovaZnacka}`;
  copyFileSync(trezor, zaloha);

  const zbyva = new Set(cerstve.keys());
  const radky = readFileSync(trezor, "utf8").split("\n");
  const vysledek = radky.map((radek) => {
    const m = radek.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (!m || !cerstve.has(m[1])) return radek;
    zbyva.delete(m[1]);
    return `${m[1]}=${cerstve.get(m[1])}`;
  });
  writeFileSync(trezor, vysledek.join("\n"));
  return {
    prepsano: [...cerstve.keys()].filter((k) => !zbyva.has(k)),
    nenalezeno: [...zbyva],
    zaloha,
  };
}

if (isDirectRun(import.meta.url)) {
  const jakoJson = process.argv.includes("--json");
  const opravit = process.argv.includes("--oprav");
  const v = zmerRozchod();
  if (jakoJson) {
    console.log(JSON.stringify(v, null, 2));
  } else {
    console.log(`Trezor (.env-prod-backup) PŘEBÍJÍ .env.coolify — kanonický řetěz, záměr.\n`);
    const vypis = (nadpis, pole, znak) => {
      console.log(`${znak} ${nadpis}: ${pole.length}`);
      for (const z of pole) {
        console.log(`    ${z.klic}  [${z.typ}]`);
        console.log(`        .env.coolify     ${z.generovany}`);
        console.log(`        .env-prod-backup ${z.trezor}   ← přebíjí`);
      }
      if (pole.length) console.log("");
    };
    vypis("VADY — platforma si klíč vyrábí, trezor drží zkamenělou kopii", v.vady, "⛔");
    vypis("podle záměru — klíč dodává operátor, trezor je autorita", v.podleZameru, "✓");
    vypis("NEZNÁMÝ TYP — klíč není v registru env-doctoru; rozchod nelze posoudit", v.neznameTypy, "⚠");
  }
  // ⛔ Oprava NEUMLČÍ nález: přeraženy jsou jen `vady`. `neznameTypy` zůstávají
  // nálezem i po opravě, protože „nedokážu posoudit" se nesmí opravit tichem.
  let prepsanoKlicu = 0;
  if (opravit && v.vady.length) {
    const r = opravTrezor({ vady: v.vady, casovaZnacka: new Date().toISOString().replace(/[:.]/g, "-") });
    prepsanoKlicu = r.prepsano.length;
    if (!jakoJson) {
      console.log(`🔧 přeraženo v trezoru: ${r.prepsano.length} (záloha: ${r.zaloha})`);
      for (const k of r.prepsano) console.log(`    ${k}`);
      for (const k of r.nenalezeno) console.log(`    ⚠ ${k} — v trezoru NENÍ řádek k přepsání`);
      console.log("");
    }
  }

  // Nezname typy jsou taky nález: nevím, čí je to hodnota, tedy nevím, jestli
  // ten rozchod vadí. „Nedokážu posoudit" se nesmí tvářit jako „je to v pořádku".
  const zbylevady = opravit ? v.vady.length - prepsanoKlicu : v.vady.length;
  process.exit(zbylevady > 0 || v.neznameTypy.length > 0 ? 1 : 0);
}
