#!/usr/bin/env node
/**
 * derive-accel-uzel.mjs — env akcelerační vrstvy z deklarace GPU uzlu. JEDEN domov cesty
 * „deklarace v datech instance → ACCEL_*“: volá ho cold-start (heredoc) i env-doktor (kind
 * `derived`, i na cestě redeploye), takže doktor a nasazení vidí tytéž hodnoty.
 *
 * Deklarace: `<overlay instance>/accel/uzel.json` (data instance VLASTNÍKA vrstvy; overlay
 * hledá jediný vstup lib/instance-overlay.mjs). Výklad a ověření: lib/accel-uzel.mjs.
 *
 * Výstup je vždy ÚPLNÁ sada klíčů vrstvy (kliceVrstvy):
 *   - instance bez overlaye nebo bez accel/uzel.json → všechny prázdné. Lane vrstvy
 *     (accel-hostfw, accel-vstup, accel-embed-<n>) se tím zavřou a hodnota z minula se
 *     nepřenese (prázdná hodnota je deklarace, chybění by kontinuita převzala z minula);
 *   - platná deklarace → hodnoty (slot enginu, který deklarace nemá, zůstane prázdný);
 *   - vadná nebo nečitelná deklarace → výjimka (CLI kód 3). „Nevím, co uzel servíruje“
 *     není „uzel nic neservíruje“: cold-start STOP, doktor hlásí důvod.
 * Deklarace nenese tajemství; výstup tedy žádné neobsahuje.
 *
 * CLI:
 *   node scripts/lib/derive-accel-uzel.mjs [--uzel <cesta>]   KEY=VALUE po řádcích (kód 0)
 *                                                             vadná deklarace = kód 3 (stderr)
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { envZUzlu, nactiUzel, slotyEnginu } from './accel-uzel.mjs';
import { isDirectRun } from './cli-entry.mjs';
import { overlayDirOrRequired } from './instance-overlay.mjs';

/** Kde deklarace leží v datech instance (relativně ke kořeni overlaye). */
export const CESTA_DEKLARACE = join('accel', 'uzel.json');

/** Klíče vrstvy, které odvození vydává — úplný výčet (i pro instanci bez uzlu). */
export function kliceVrstvy(sloty = slotyEnginu()) {
  const k = [
    'ACCEL_OWNER_PREFIX',
    'ACCEL_FW_NODE_OWNER',
    'ACCEL_FW_MODE',
    'ACCEL_FW_SSH',
    'ACCEL_FW_ADMIN_CIDRS',
    'ACCEL_FW_CONFIRM_S',
    'ACCEL_FW_INTERVAL_S',
    'ACCEL_FW_UDP_MESH_PORT',
    'ACCEL_JADRO_PODSIT',
    'ACCEL_JADRO_VSTUP_IP',
  ];
  for (let s = 1; s <= 8; s++) k.push(`ACCEL_NAJEMCE_${s}`, `ACCEL_NAJEMCE_${s}_PODSIT`, `ACCEL_NAJEMCE_${s}_ROZSAH`, `ACCEL_NAJEMCE_${s}_IP`);
  for (const id of [...sloty].sort()) {
    const p = `ACCEL_${id.toUpperCase().replace(/-/g, '_')}_`;
    for (const x of ['REPO', 'REVIZE', 'SOUBOR_VAH', 'FORMAT_VAH', 'SHA256', 'MAX_MODEL_LEN', 'PODIL_GPU']) k.push(`${p}${x}`);
    // Chatový slot navíc: meze LoRA (adaptéry načítá za běhu vstup lane z deklarace VB).
    if (id.startsWith('chat-')) for (const x of ['MAX_LORAS', 'MAX_LORA_RANK']) k.push(`${p}${x}`);
  }
  k.push('ACCEL_VAHY_B64', 'ACCEL_DEKLARACE_B64');
  return k;
}

/** Cesta k deklaraci TÉHLE instance, nebo `null` (instance bez overlaye = vrstvu nevlastní). */
export function cestaDeklaraceInstance() {
  const dir = overlayDirOrRequired('derive-accel-uzel');
  return dir ? join(dir, CESTA_DEKLARACE) : null;
}

/**
 * Env vrstvy: Map klíč → hodnota přes CELÝ výčet kliceVrstvy().
 * @param {{ cesta?: string|null }} [opts] výslovná cesta k uzel.json; bez ní deklarace instance
 * @throws vadná nebo nečitelná deklarace (zpráva = vady)
 */
export function envVrstvy({ cesta } = {}) {
  const c = cesta === undefined ? cestaDeklaraceInstance() : cesta;
  const ven = new Map(kliceVrstvy().map((k) => [k, '']));
  if (!c || !existsSync(c)) return ven;
  const r = nactiUzel(c);
  if (r.vady) throw new Error(`deklarace uzlu ${c} je vadná: ${r.vady.join('; ')}`);
  for (const [k, v] of envZUzlu(r.uzel)) {
    if (!ven.has(k)) throw new Error(`deklarace uzlu vydala klíč ${k}, který výčet vrstvy nezná`);
    ven.set(k, v);
  }
  return ven;
}

/**
 * Pro env-doktora: hodnota jednoho klíče, nebo "" s důvodem na stderr v tvaru, který čte
 * brána deklarace-v-compose-ma-zapisovatele (`aisha-env-doctor: KEY se neodvodil (…)`).
 * Odvození se počítá jednou za běh doktora.
 */
let mezipamet = null;
export function hodnotaVrstvyNeboPrazdno(klic) {
  if (mezipamet === null) {
    try {
      mezipamet = { env: envVrstvy() };
    } catch (e) {
      mezipamet = { chyba: String(e?.message ?? e) };
    }
  }
  if (mezipamet.chyba) {
    console.error(`aisha-env-doctor: ${klic} se neodvodil (${mezipamet.chyba})`);
    return '';
  }
  return mezipamet.env.get(klic) ?? '';
}

if (isDirectRun(import.meta.url)) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--uzel');
  try {
    const env = envVrstvy(i >= 0 ? { cesta: argv[i + 1] ?? '' } : {});
    for (const [k, v] of env) process.stdout.write(`${k}=${v}\n`);
  } catch (e) {
    process.stderr.write(`derive-accel-uzel: ${e.message}\n`);
    process.exit(3);
  }
}
