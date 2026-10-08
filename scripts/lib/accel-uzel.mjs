#!/usr/bin/env node
/**
 * accel-uzel.mjs — JEDEN domov výkladu deklarace GPU uzlu (operátor společné lane).
 *
 * Deklarace leží v datech instance vlastníka vrstvy (overlay `accel/uzel.json`), v upstreamu
 * je jen schéma config/accel-uzel.schema.json a příklad. Platforma žádnou hodnotu nedosazuje.
 * Čte ji derive-accel-uzel.mjs (env vrstvy pro cold-start i env-doktora) a z ní plynou:
 *   - env compose vrstvy (envZUzlu): identita, firewall hostitele, sítě, enginy, váhy;
 *   - deklarace pro VB (vbDeklarace), kterou one-shot `accel-deklarace` zapíše do /deklarace;
 *     VB týž tvar ověřuje podruhé (tabulka.ts, zod) a k tomu fakta za běhu.
 *
 * Sítě nájemců jsou ve jmenném prostoru VLASTNÍKA: `<vlastnik>-lane-<nájemce>`. Operátor je
 * zakládá (compose accel-vstup), nájemce se na ni připojuje — jméno v prostoru nájemce
 * (`<nájemce>-lane`) by operátor zakládal za někoho jiného a dva vlastníci by se o něj prali.
 *
 * Volné sloty: compose vstupu vede pevně 8 sítí slotů, proto generátor vyplní i prázdné.
 * Volný slot dostane jméno `<vlastnik>-lane-volny-<n>` a podsíť z vyhrazeného bloku
 * `volne_sloty_blok` z deklarace; nájemce do něj zasahovat nesmí (STOP).
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deklaraceFirewallu } from './accel-deklarace.mjs';
import { isDirectRun } from './cli-entry.mjs';

const RE = {
  vlastnik: /^[a-z][a-z0-9-]{1,30}$/,
  // Totéž pravidlo jako VB (tabulka.ts) a měření členství (clenstvi.ts): jiné jméno by měření nepřečetlo.
  najemce: /^[a-z][a-z0-9-]{0,30}$/,
  // Jméno sítě volného slotu; nájemce se tak jmenovat nesmí (schéma: propertyNames.not).
  volny: /^volny-[0-9]+$/,
  // Hodnoty, které jdou do env vrstvy: jen bezpečné znaky (pojistka v envZUzlu).
  repo: /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/,
  soubor: /^[A-Za-z0-9._-]+$/,
  engine: /^[a-z0-9][a-z0-9-]{0,31}$/,
  alias: /^[a-z0-9][a-z0-9._-]*$/,
  cidr: /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/,
  ipv4: /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/,
  hex40: /^[0-9a-f]{40}$/,
  hex64: /^[0-9a-f]{64}$/,
};

/** Druh enginu podle slotu: embed-* pooling, chat-* generate (compose slotu jiný druh neumí). */
export const druhSlotu = (id) => (id.startsWith('chat-') ? 'generate' : 'pooling');
/** Jméno adaptéru ve vLLM i ve VB: prostor jmen nájemce `<nájemce>.<jméno>`. */
export const jmenoAdapteru = (najemce, jmeno) => `${najemce}.${jmeno}`;
const RE_ADAPTER = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/**
 * `soubor_vah: "@vse"` = identita CELÉHO adresáře revize: sha256 seřazeného seznamu `relativní/cesta:sha256`
 * všech souborů (rozdělené váhy, config.json, tokenizér a šablona chatu, u adaptéru i adapter_config.json),
 * mimo aisha-identita.json a .cache. vLLM z adresáře čte všechno, proto se měří všechno (revize commitu
 * d8684dcad: měřit jen váhy nechávalo konfiguraci a šablonu chatu bez kontroly). Měří accel-vahy
 * i entrypoint enginu stejně. Značka nese `@`, které jméno souboru v deklaraci mít nesmí.
 */
export const SLOZENE = '@vse';

/**
 * Identita adresáře revize (`@vse`) — TÝŽ výpočet jako v compose (accel-vahy, entrypoint enginu):
 * sha256 seřazeného seznamu `relativní/cesta:sha256` všech souborů mimo aisha-identita.json a .cache.
 * Operátor jím spočítá hodnotu do deklarace ze staženého snapshotu (CLI --identita).
 */
export function identitaAdresare(koren) {
  const radky = [];
  const projdi = (adr, rel) => {
    for (const jm of readdirSync(adr)) {
      const cesta = join(adr, jm);
      const r = rel ? `${rel}/${jm}` : jm;
      if (statSync(cesta).isDirectory()) {
        if (jm !== '.cache') projdi(cesta, r);
      } else if (jm !== 'aisha-identita.json') {
        radky.push(`${r}:${createHash('sha256').update(readFileSync(cesta)).digest('hex')}`);
      }
    }
  };
  projdi(koren, '');
  if (radky.length === 0) throw new Error(`${koren} je prázdný`);
  // Python `sorted()` řadí podle kódových bodů — stejně jako výchozí sort řetězců v JS (bez localeCompare).
  return createHash('sha256').update(radky.sort().join('\n')).digest('hex');
}

/** Režimy kvót nájemce (schéma kvoty.rezim). Platforma žádný nedosazuje. */
export const REZIMY_KVOT = Object.freeze(['varovani', 'vynucovat']);

/**
 * Sloty enginů = služby katalogu `accel-<engine>` se svým compose: `embed-<n>` = pooling
 * (`--runner pooling`), `chat-<n>` = generate s LoRA adaptéry nájemců. Měří se z katalogu: deklarace s enginem, pro který upstream compose
 * nemá, by vyrobila env, který nikdo nečte, a engine by nikdy nenaběhl.
 */
export function slotyEnginu(katalog = nactiKatalog()) {
  return new Set(
    Object.keys(katalog.services ?? katalog)
      .map((id) => /^accel-((?:embed|chat)-[0-9]+)$/.exec(id)?.[1])
      .filter(Boolean),
  );
}
function nactiKatalog() {
  const koren = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  return JSON.parse(readFileSync(join(koren, 'config', 'services.json'), 'utf8'));
}

function oktety(s) {
  const m = RE.ipv4.exec(s);
  if (!m) return null;
  const o = [m[1], m[2], m[3], m[4]].map(Number);
  return o.every((x) => x >= 0 && x <= 255) ? o : null;
}
function parsujCidr(s) {
  const m = RE.cidr.exec(s);
  if (!m) return null;
  const o = [m[1], m[2], m[3], m[4]].map(Number);
  const maska = Number(m[5]);
  if (!o.every((x) => x >= 0 && x <= 255) || maska < 0 || maska > 32) return null;
  const base = ((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0;
  const bitu = maska === 0 ? 0 : (0xffffffff << (32 - maska)) >>> 0;
  // Nezarovnaný zápis (adresa není začátek sítě) = vada, ne tiché maskování (shodně s VB).
  if (((base & bitu) >>> 0) !== base) return null;
  return { base, maska, bitu };
}
/** Síť lane (jádro, nájemce, rozsah klientů, blok volných): zarovnaná, prefix 8–30 jako ve VB (sit-adresy.ts). */
function sitLane(s) {
  const c = parsujCidr(s);
  return c && c.maska >= 8 && c.maska <= 30 ? c : null;
}
function ipVVrozsahu(ip, cidr) {
  const o = oktety(ip);
  const c = parsujCidr(cidr);
  if (!o || !c) return false;
  const v = ((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0;
  return ((v & c.bitu) >>> 0) === c.base;
}
function prekryv(a, b) {
  const x = parsujCidr(a);
  const y = parsujCidr(b);
  if (!x || !y) return false;
  const spolecna = Math.min(x.maska, y.maska);
  const bitu = spolecna === 0 ? 0 : (0xffffffff << (32 - spolecna)) >>> 0;
  return ((x.base & bitu) >>> 0) === ((y.base & bitu) >>> 0);
}
const ip = (x) => `${x >>> 24}.${(x >>> 16) & 255}.${(x >>> 8) & 255}.${x & 255}`;

/**
 * Podsíť volného slotu n (1..8) z bloku volných slotů deklarace (`volne_sloty_blok`, /21): slot n má
 * /28 na začátku n-tého /24 bloku. Hodnota patří operátorovi uzlu, platforma žádnou nedosazuje.
 */
export function podsitVolneho(u, n) {
  const b = parsujCidr(u?.volne_sloty_blok);
  if (!b || b.maska !== 21) throw new Error('volne_sloty_blok: zarovnaná síť /21');
  return `${ip((b.base + (n - 1) * 256) >>> 0)}/28`;
}

/** Jméno sítě slotu (nájemce, nebo `volny-<n>`). Compose ho skládá z ACCEL_OWNER_PREFIX a ACCEL_NAJEMCE_<n>. */
export const sitSlotu = (vlastnik, obsazeni) => `${vlastnik}-lane-${obsazeni}`;

/** Proměnné firewallu hostitele (accel-hostfw) z deklarace. Vykládá je accel-deklarace.mjs, nikdo jiný. */
function envFirewallu(u) {
  const fw = u.firewall ?? {};
  return new Map([
    ['ACCEL_OWNER_PREFIX', String(u.vlastnik ?? '')],
    ['ACCEL_FW_NODE_OWNER', String(u.vlastnik ?? '')],
    ['ACCEL_FW_MODE', String(fw.rezim ?? '')],
    ['ACCEL_FW_SSH', String(fw.ssh ?? '')],
    ['ACCEL_FW_ADMIN_CIDRS', Array.isArray(fw.spravci) ? fw.spravci.join(',') : ''],
    ['ACCEL_FW_CONFIRM_S', String(fw.potvrzeni_s ?? '')],
    ['ACCEL_FW_INTERVAL_S', String(fw.interval_s ?? '')],
    ['ACCEL_FW_UDP_MESH_PORT', fw.udp_mesh_port ? String(fw.udp_mesh_port) : ''],
  ]);
}

/**
 * Ověří deklaraci uzlu. Vrací pole vad (prázdné = v pořádku). Zrcadlí schéma a přidává
 * fakta, která schéma neunese: součet VRAM, překryv podsítí, kolize slotů, engine aliasu
 * musí existovat a mít slot v katalogu, vstup/klient leží ve své podsíti, volné sloty v bloku.
 */
export function overUzel(u, { sloty = slotyEnginu() } = {}) {
  const vady = [];
  const v = (c, m) => { if (!c) vady.push(m); };
  if (!u || typeof u !== 'object') return ['uzel.json není objekt'];
  v(u.verze === 1, 'verze musí být 1');
  v(typeof u.vlastnik === 'string' && RE.vlastnik.test(u.vlastnik), 'vlastnik: jméno [a-z][a-z0-9-]');
  for (const k of ['registry_proxy', 'docker_host']) v(!(k in u), `${k}: pole zaniklo s warmupem (uzel nasazuje Coolify, obrazy jdou přes REGISTRY_PROXY instance)`);
  const karta = u.karta ?? {};
  v(Number.isInteger(karta.kapacita_mib) && karta.kapacita_mib >= 1, 'karta.kapacita_mib: kladné celé');
  v(Number.isInteger(karta.rezerva_mib) && karta.rezerva_mib >= 0, 'karta.rezerva_mib: nezáporné celé');

  const blokOk = parsujCidr(u.volne_sloty_blok);
  v(blokOk && blokOk.maska === 21, 'volne_sloty_blok: zarovnaná síť /21 (8 slotů po /28 na začátku každého /24)');
  // Firewall: jeden výklad (accel-deklarace.mjs, týž čte hostfw.sh v kontejneru) nad env, který z deklarace vyjde.
  const fw = u.firewall ?? {};
  const fwEnv = envFirewallu(u);
  for (const c of deklaraceFirewallu((k) => fwEnv.get(k)).chyby) v(false, `firewall: ${c}`);
  v(Number.isInteger(fw.potvrzeni_s) && fw.potvrzeni_s >= 30, 'firewall.potvrzeni_s: celé ≥ 30');
  v(Number.isInteger(fw.interval_s) && fw.interval_s >= 5, 'firewall.interval_s: celé ≥ 5');
  v(fw.udp_mesh_port === undefined || fw.udp_mesh_port === null || Number.isInteger(fw.udp_mesh_port), 'firewall.udp_mesh_port: celé číslo nebo null');

  const podsite = []; // [jmeno, cidr] pro překryv
  const jadro = u.jadro ?? {};
  if (sitLane(jadro.podsit)) { podsite.push(['jadro', jadro.podsit]); } else v(false, 'jadro.podsit: zarovnaná síť /8–/30');
  if (sitLane(jadro.podsit) && blokOk) v(!prekryv(jadro.podsit, u.volne_sloty_blok), 'jadro.podsit: zasahuje do bloku volných slotů');
  v(oktety(jadro.vstup_ip) && ipVVrozsahu(jadro.vstup_ip, jadro.podsit || '0.0.0.0/0'), 'jadro.vstup_ip leží mimo podsíť jádra');

  const enginy = u.enginy ?? {};
  v(Object.keys(enginy).length >= 1, 'enginy: aspoň jeden');
  let sumaVram = 0;
  for (const [id, e] of Object.entries(enginy)) {
    v(RE.engine.test(id), `engine ${id}: jméno [a-z0-9-]`);
    v(sloty.has(id), `engine ${id}: upstream pro něj nemá slot (katalog accel-${id}); sloty: ${[...sloty].sort().join(', ') || '—'}`);
    v(e && e.druh === druhSlotu(id), `engine ${id}.druh: slot ${id.replace(/-[0-9]+$/, '')}-* servíruje jen ${druhSlotu(id)}`);
    if (e && e.druh === 'generate') {
      const l = e.lora ?? {};
      v(Number.isInteger(l.max_adapteru) && l.max_adapteru >= 1 && l.max_adapteru <= 64, `engine ${id}.lora.max_adapteru: celé 1–64 (vLLM --max-loras)`);
      v([8, 16, 32, 64, 128, 256].includes(l.max_rank), `engine ${id}.lora.max_rank: 8|16|32|64|128|256 (vLLM --max-lora-rank)`);
    } else if (e) v(!('lora' in e), `engine ${id}.lora: jen u enginu generate`);
    v(e && !('projekt' in e), `engine ${id}.projekt: pole zaniklo s warmupem (projekt compose určuje Coolify)`);
    v(e && RE.repo.test(e.repo ?? ''), `engine ${id}.repo: owner/name ze znaků [A-Za-z0-9._-]`);
    v(e && RE.hex40.test(e.revize ?? ''), `engine ${id}.revize: 40 hex`);
    v(e && (RE.soubor.test(e.soubor_vah ?? '') || e.soubor_vah === SLOZENE), `engine ${id}.soubor_vah: jméno souboru ze znaků [A-Za-z0-9._-], nebo '${SLOZENE}' (identita celého adresáře revize)`);
    v(e && (e.format_vah === 'pytorch' || e.format_vah === 'safetensors'), `engine ${id}.format_vah: pytorch|safetensors`);
    v(e && RE.hex64.test(e.sha256 ?? ''), `engine ${id}.sha256: 64 hex`);
    v(e && Number.isInteger(e.vram_mib) && e.vram_mib >= 1, `engine ${id}.vram_mib: kladné celé`);
    v(e && Number.isInteger(e.max_model_len) && e.max_model_len >= 1, `engine ${id}.max_model_len: kladné celé`);
    v(e && Number.isInteger(e.start_mez_s) && e.start_mez_s >= 1, `engine ${id}.start_mez_s: kladné celé`);
    v(e && typeof e.recept === 'string' && e.recept.length > 0, `engine ${id}.recept: prázdné`);
    if (e && Number.isInteger(e.vram_mib)) sumaVram += e.vram_mib;
  }
  // Týž adresář vah `<repo>@<revize>` pro víc enginů (engine na nájemce, O-4) musí nést tutéž identitu:
  // adresář je neměnný a accel-vahy ho změří jednou.
  const adresare = new Map();
  for (const [id, e] of Object.entries(u.enginy ?? {})) {
    if (!e || typeof e !== 'object') continue;
    const k = `${e.repo}@${e.revize}`;
    const identita = `${e.soubor_vah}|${e.format_vah}|${e.sha256}`;
    const d = adresare.get(k);
    if (!d) adresare.set(k, { id, identita });
    else v(d.identita === identita, `engine ${id}: adresář vah ${k} má u enginu ${d.id} jinou identitu (soubor, formát, sha256)`);
  }
  if (Number.isInteger(karta.kapacita_mib) && Number.isInteger(karta.rezerva_mib)) {
    v(sumaVram + karta.rezerva_mib <= karta.kapacita_mib, `Σ VRAM enginů (${sumaVram}) + rezerva (${karta.rezerva_mib}) > kapacita (${karta.kapacita_mib}) (VT3)`);
  }

  const modely = u.modely ?? {};
  v(Object.keys(modely).length >= 1, 'modely: aspoň jeden');
  for (const [jm, m] of Object.entries(modely)) {
    v(RE.alias.test(jm), `modely.${jm}: jméno bez lomítka`);
    v(m && typeof m.engine === 'string' && enginy[m.engine], `modely.${jm}.engine: '${m?.engine}' deklarace nezná`);
    const gen = m && enginy[m.engine]?.druh === 'generate';
    if (gen) v(Number.isInteger(m.max_tokenu) && m.max_tokenu >= 1, `modely.${jm}.max_tokenu: u chatového modelu výslovný strop vygenerovaných tokenů`);
    else v(m && Number.isInteger(m.dim) && m.dim >= 1, `modely.${jm}.dim: kladné celé`);
  }

  const najemci = u.najemci ?? {};
  const pocet = Object.keys(najemci).length;
  v(pocet >= 1 && pocet <= 8, 'najemci: 1 až 8');
  const obsazene = new Set();
  const otiskyVsech = new Set();
  for (const [id, n] of Object.entries(najemci)) {
    v(RE.najemce.test(id) && !RE.volny.test(id), `najemci.${id}: jméno [a-z][a-z0-9-]{0,30} (jako VB a měření členství), ne volny-<n> (síť volného slotu)`);
    v(Number.isInteger(n?.slot) && n.slot >= 1 && n.slot <= 8, `najemci.${id}.slot: 1..8`);
    if (Number.isInteger(n?.slot)) { v(!obsazene.has(n.slot), `najemci.${id}.slot: slot ${n.slot} má už jiný nájemce`); obsazene.add(n.slot); }
    v(!('projekt' in (n ?? {})), `najemci.${id}.projekt: pole zaniklo s warmupem (projekt compose určuje Coolify)`);
    const s = n?.sit ?? {};
    const podsitOk = sitLane(s.podsit);
    v(podsitOk, `najemci.${id}.sit.podsit: zarovnaná síť /8–/30`);
    v(sitLane(s.rozsah_klientu), `najemci.${id}.sit.rozsah_klientu: zarovnaná síť /8–/30 (povinný, N1)`);
    v(oktety(s.vstup_ip) && ipVVrozsahu(s.vstup_ip, s.podsit || '0.0.0.0/0'), `najemci.${id}.sit.vstup_ip leží mimo podsíť`);
    if (sitLane(s.rozsah_klientu) && podsitOk) {
      const r = sitLane(s.rozsah_klientu);
      v(r.maska >= podsitOk.maska && prekryv(s.rozsah_klientu, s.podsit), `najemci.${id}.sit.rozsah_klientu leží mimo podsíť`);
      const brana = ip(podsitOk.base + 1);
      v(!ipVVrozsahu(brana, s.rozsah_klientu), `najemci.${id}.sit.rozsah_klientu zahrnuje bránu ${brana} (N1)`);
      if (oktety(s.vstup_ip)) v(!ipVVrozsahu(s.vstup_ip, s.rozsah_klientu), `najemci.${id}.sit.rozsah_klientu zahrnuje vstup_ip (N1)`);
    }
    if (podsitOk) {
      for (const [jm, cidr] of podsite) if (prekryv(cidr, s.podsit)) v(false, `najemci.${id}.sit.podsit: překrývá se s ${jm}`);
      if (blokOk && prekryv(s.podsit, u.volne_sloty_blok)) v(false, `najemci.${id}.sit.podsit: zasahuje do bloku volných slotů ${u.volne_sloty_blok}`);
      podsite.push([`najemci.${id}`, s.podsit]);
    }
    v(Array.isArray(n?.klice) && n.klice.length >= 1 && n.klice.length <= 2, `najemci.${id}.klice: 1 nebo 2`);
    for (const k of n?.klice ?? []) {
      v(RE.hex64.test(k?.otisk_sha256 ?? ''), `najemci.${id}.klice: otisk 64 hex`);
      if (RE.hex64.test(k?.otisk_sha256 ?? '')) { v(!otiskyVsech.has(k.otisk_sha256), `najemci.${id}.klice: otisk sdílí s jiným nájemcem (klíč musí být po forku)`); otiskyVsech.add(k.otisk_sha256); }
    }
    v(typeof n?.vypnuto === 'boolean', `najemci.${id}.vypnuto: boolean`);
    v(typeof n?.trida_duvery === 'string' && n.trida_duvery.length > 0, `najemci.${id}.trida_duvery: chybí`);
    const nm = n?.modely ?? {};
    v(Object.keys(nm).length >= 1, `najemci.${id}.modely: aspoň jeden alias`);
    const ad = n?.adaptery ?? {};
    for (const [jm, a] of Object.entries(ad)) {
      v(RE_ADAPTER.test(jm), `najemci.${id}.adaptery.${jm}: jméno [a-z0-9][a-z0-9._-]{0,63}`);
      v(a && enginy[a.engine]?.druh === 'generate', `najemci.${id}.adaptery.${jm}.engine: '${a?.engine}' není chatový engine deklarace`);
      v(a && RE.repo.test(a.repo ?? ''), `najemci.${id}.adaptery.${jm}.repo: owner/name`);
      v(a && RE.hex40.test(a.revize ?? ''), `najemci.${id}.adaptery.${jm}.revize: 40 hex`);
      v(a && RE.hex64.test(a.sha256 ?? ''), `najemci.${id}.adaptery.${jm}.sha256: 64 hex (identita celého adresáře adaptéru, '@vse')`);
    }
    for (const [al, mm] of Object.entries(nm)) {
      v(RE.alias.test(al), `najemci.${id}.modely.${al}: jméno bez lomítka`);
      v(mm && typeof mm.model === 'string' && modely[mm.model], `najemci.${id}.modely.${al}.model: '${mm?.model}' deklarace nezná`);
      if (mm?.adapter !== undefined) {
        const a = ad[mm.adapter];
        v(a, `najemci.${id}.modely.${al}.adapter: '${mm.adapter}' nájemce nedeklaruje (najemci.${id}.adaptery)`);
        v(!a || modely[mm.model]?.engine === a.engine, `najemci.${id}.modely.${al}.adapter: adaptér '${mm.adapter}' patří enginu '${a?.engine}', model '${mm.model}' jinému`);
      }
    }
    const kv = n?.kvoty ?? {};
    v(REZIMY_KVOT.includes(kv.rezim), `najemci.${id}.kvoty.rezim: ${REZIMY_KVOT.join('|')} (výslovně — platforma režim nedosazuje)`);
    v(Number.isInteger(kv.okno_s) && kv.okno_s >= 1, `najemci.${id}.kvoty.okno_s: kladné celé`);
    v(Number.isInteger(kv.gpu_ms_za_okno) && kv.gpu_ms_za_okno >= 1, `najemci.${id}.kvoty.gpu_ms_za_okno: kladné celé (0 by VB odmítl a s ním všechny nájemce)`);
    v(n?.diagnostika === undefined || typeof n.diagnostika === 'boolean', `najemci.${id}.diagnostika: boolean`);
    v(kv.soubeh && Number.isInteger(kv.soubeh.dotaz) && kv.soubeh.dotaz >= 1, `najemci.${id}.kvoty.soubeh.dotaz: kladné celé`);
    v(kv.soubeh && Number.isInteger(kv.soubeh.davka) && kv.soubeh.davka >= 1, `najemci.${id}.kvoty.soubeh.davka: kladné celé`);
    v(Number.isInteger(kv.davka_max_vstupu) && kv.davka_max_vstupu >= 1, `najemci.${id}.kvoty.davka_max_vstupu: kladné celé`);
  }
  // Engine na nájemce (O-4): gpu_ms = obsazení enginu, a to jde přičíst jen jedinému nájemci. Sdílet
  // smí jen diagnostika operátora (sonda). Totéž pravidlo vynucuje VB (tabulka.ts).
  const drzitel = new Map();
  for (const [id, n] of Object.entries(najemci)) {
    if (n?.diagnostika) continue;
    for (const mm of Object.values(n?.modely ?? {})) {
      const engine = modely[mm?.model]?.engine;
      if (!engine) continue;
      const jiny = drzitel.get(engine);
      if (jiny && jiny !== id) v(false, `najemci.${id}: engine '${engine}' už slouží nájemci ${jiny} — engine na nájemce (O-4); sdílet smí jen diagnostika`);
      else drzitel.set(engine, id);
    }
  }
  return vady;
}

/** Načti a ověř. { uzel } nebo { vady }. */
export function nactiUzel(cesta, opts) {
  let text;
  try { text = readFileSync(cesta, 'utf8'); } catch (e) { return { vady: [`uzel.json nejde přečíst: ${e.message}`] }; }
  let obj;
  try { obj = JSON.parse(text); } catch (e) { return { vady: [`uzel.json není platný JSON: ${e.message}`] }; }
  const vady = overUzel(obj, opts);
  return vady.length ? { vady } : { uzel: obj };
}

/**
 * Env vrstvy z deklarace — mapa klíč→hodnota pro compose vrstvy na GPU slotu:
 * identita a firewall (ACCEL_OWNER_PREFIX, ACCEL_FW_*; accel-hostfw), sítě a vstup
 * (ACCEL_JADRO_{PODSIT,VSTUP_IP}, ACCEL_NAJEMCE_<n>[_PODSIT|_ROZSAH|_IP], ACCEL_DEKLARACE_B64;
 * accel-vstup), váhy (ACCEL_VAHY_B64) a enginy (ACCEL_<ENGINE>_{REPO,REVIZE,SOUBOR_VAH,
 * FORMAT_VAH,SHA256,PODIL_GPU,MAX_MODEL_LEN}). Vstup MUSÍ být ověřený (nactiUzel), jinak výjimka.
 * Deklarace nenese tajemství, výstup tedy žádné neobsahuje.
 */
export function envZUzlu(u, opts) {
  const vady = overUzel(u, opts);
  if (vady.length) throw new Error(`envZUzlu nad neověřenou deklarací: ${vady[0]}`);
  const env = envFirewallu(u);
  env.set('ACCEL_JADRO_PODSIT', u.jadro.podsit);
  env.set('ACCEL_JADRO_VSTUP_IP', u.jadro.vstup_ip);

  const podleSlotu = new Map();
  for (const [id, n] of Object.entries(u.najemci)) podleSlotu.set(n.slot, { id, n });
  for (let s = 1; s <= 8; s++) {
    const z = podleSlotu.get(s);
    if (z) {
      env.set(`ACCEL_NAJEMCE_${s}`, z.id);
      env.set(`ACCEL_NAJEMCE_${s}_PODSIT`, z.n.sit.podsit);
      env.set(`ACCEL_NAJEMCE_${s}_ROZSAH`, z.n.sit.rozsah_klientu);
      env.set(`ACCEL_NAJEMCE_${s}_IP`, z.n.sit.vstup_ip);
    } else {
      // Volný slot: síť bez nájemce. Rozsah klientů = horní polovina /28 (compose ho chce vždy;
      // klienta tam nikdo nemá — hlídač pustí do sítě slotu jen vstup a agenta nájemce).
      const p = parsujCidr(podsitVolneho(u, s));
      env.set(`ACCEL_NAJEMCE_${s}`, `volny-${s}`);
      env.set(`ACCEL_NAJEMCE_${s}_PODSIT`, `${ip(p.base)}/28`);
      env.set(`ACCEL_NAJEMCE_${s}_ROZSAH`, `${ip(p.base + 8)}/29`);
      env.set(`ACCEL_NAJEMCE_${s}_IP`, ip(p.base + 2));
    }
  }

  for (const [id, e] of Object.entries(u.enginy)) {
    const p = `ACCEL_${id.toUpperCase().replace(/-/g, '_')}_`;
    env.set(`${p}REPO`, e.repo);
    env.set(`${p}REVIZE`, e.revize);
    env.set(`${p}SOUBOR_VAH`, e.soubor_vah);
    env.set(`${p}FORMAT_VAH`, e.format_vah);
    env.set(`${p}SHA256`, e.sha256);
    env.set(`${p}MAX_MODEL_LEN`, String(e.max_model_len));
    // podíl GPU = vram_mib / kapacita, dolů na 3 desetinná místa
    env.set(`${p}PODIL_GPU`, (Math.floor((e.vram_mib / u.karta.kapacita_mib) * 1000) / 1000).toFixed(3));
    if (e.druh === 'generate') {
      // Adaptéry nájemců načítá za běhu vstup lane z deklarace (adaptery.ts); engine dostane jen meze.
      env.set(`${p}MAX_LORAS`, String(e.lora.max_adapteru));
      env.set(`${p}MAX_LORA_RANK`, String(e.lora.max_rank));
    }
  }
  // Adresáře vah pro accel-vahy, každý `<repo>@<revize>` jednou, aby compose nemusel jmenovat enginy.
  const vahy = new Map();
  for (const e of Object.values(u.enginy)) vahy.set(`${e.repo}@${e.revize}`, { repo: e.repo, revize: e.revize, soubor_vah: e.soubor_vah, format_vah: e.format_vah, sha256: e.sha256 });
  // Adaptéry nájemců stahuje a měří týž stahovač — identita celého adresáře (váhy i adapter_config.json).
  for (const id of Object.keys(u.enginy)) for (const a of adapteryEnginu(u, id)) vahy.set(`${a.repo}@${a.revize}`, { repo: a.repo, revize: a.revize, soubor_vah: SLOZENE, format_vah: 'safetensors', sha256: a.sha256 });
  env.set('ACCEL_VAHY_B64', Buffer.from(JSON.stringify([...vahy.values()])).toString('base64'));
  env.set('ACCEL_DEKLARACE_B64', Buffer.from(JSON.stringify(vbDeklarace(u, opts))).toString('base64'));
  // Pojistka: env vrstvy putuje do .env instance a do Coolify; hodnota mimo bezpečné znaky sem nepatří nikdy.
  for (const [k, hodnota] of env) if (!/^[A-Za-z0-9._:\/,@+=-]*$/.test(hodnota)) throw new Error(`envZUzlu: ${k} nese znaky mimo [A-Za-z0-9._:/,@+=-]`);
  return env;
}

/** Neměnný adresář vah ve svazku `<vlastník>-accel-vahy` (tvar accel-vahy a VB enginy.ts). */
export const adresarVah = (repo, revize) => `/vahy/${repo.replace('/', '--')}@${revize}`;
/** Adaptéry nájemců, které servíruje engine `id` (jméno = prostor jmen nájemce), seřazené. */
export function adapteryEnginu(u, id) {
  const ven = [];
  for (const [najemce, n] of Object.entries(u.najemci ?? {})) {
    for (const [jmeno, a] of Object.entries(n.adaptery ?? {})) if (a.engine === id) ven.push({ jmeno: jmenoAdapteru(najemce, jmeno), ...a });
  }
  // Řazení podle kódových bodů (ne localeCompare): pořadí --lora-modules nesmí záviset na LANG stroje.
  return ven.sort((x, y) => (x.jmeno < y.jmeno ? -1 : x.jmeno > y.jmeno ? 1 : 0));
}

/**
 * Deklarace ve tvaru, který čte vstup lane (svc-accel-vstup/src/tabulka.ts, zod .strict()).
 * Adresa enginu = jméno kontejneru `<vlastnik>-accel-<id>` na síti jádra, model = served-model-name
 * = id, zahřátí na max_model_len (VB ho odměří tokenizérem enginu), alias nájemce → engine modelu.
 */
export function vbDeklarace(u, opts) {
  const vady = overUzel(u, opts);
  if (vady.length) throw new Error(`vbDeklarace nad neověřenou deklarací: ${vady[0]}`);
  const enginy = {};
  for (const [id, e] of Object.entries(u.enginy)) {
    enginy[id] = {
      druh: e.druh,
      url: `http://${u.vlastnik}-accel-${id}:8000`,
      zapnuto: true,
      start_mez_s: e.start_mez_s,
      identita: { format: e.format_vah, sha256: e.sha256, revize: e.revize },
      model: id,
      // Chat se zahřívá jednotokenovou odpovědí (enginy.ts); plná délka by zahřívala minuty.
      zahrati_tokenu: e.druh === 'generate' ? 1 : e.max_model_len,
      recept: e.recept,
      ...(e.druh === 'generate' ? { adaptery: Object.fromEntries(adapteryEnginu(u, id).map((a) => [a.jmeno, { sha256: a.sha256, revize: a.revize, adresar: adresarVah(a.repo, a.revize) }])) } : {}),
    };
  }
  const najemci = {};
  for (const [id, n] of Object.entries(u.najemci)) {
    const modely = {};
    for (const [al, mm] of Object.entries(n.modely)) {
      const m = u.modely[mm.model];
      modely[al] = {
        engine: m.engine,
        max_tokenu: mm.max_tokenu ?? m.max_tokenu ?? u.enginy[m.engine].max_model_len - 2,
        ...(mm.adapter !== undefined ? { adapter: jmenoAdapteru(id, mm.adapter) } : {}),
      };
    }
    najemci[id] = {
      sit: { podsit: n.sit.podsit, vstup_ip: n.sit.vstup_ip, rozsah_klientu: n.sit.rozsah_klientu },
      otisky: n.klice.map((k) => k.otisk_sha256),
      vypnuto: n.vypnuto,
      trida_duvery: n.trida_duvery,
      ...(n.diagnostika ? { diagnostika: true } : {}),
      modely,
      kvoty: n.kvoty,
    };
  }
  return { verze: 1, enginy, najemci };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────
//   node scripts/lib/accel-uzel.mjs --over <uzel.json>   kód 0 = platná, 2 = vady (stderr)
//   node scripts/lib/accel-uzel.mjs --vb   <uzel.json>   deklarace pro vstup lane (JSON)
//   node scripts/lib/accel-uzel.mjs --identita <adresář> sha256 `@vse` staženého snapshotu (do deklarace)
// Env vrstvy vydává derive-accel-uzel.mjs (jeden domov cesty k deklaraci v datech instance).
if (isDirectRun(import.meta.url)) {
  const [, , prikaz, cesta] = process.argv;
  if (!['--over', '--vb', '--identita'].includes(prikaz) || !cesta) {
    process.stderr.write('použití: accel-uzel.mjs --over|--vb <uzel.json> | --identita <adresář>\n');
    process.exit(64);
  }
  if (prikaz === '--identita') {
    process.stdout.write(`${identitaAdresare(cesta)}\n`);
    process.exit(0);
  }
  const r = nactiUzel(cesta);
  if (r.vady) {
    for (const v of r.vady) process.stderr.write(`[accel-uzel] ✗ ${v}\n`);
    process.exit(2);
  }
  if (prikaz === '--vb') process.stdout.write(`${JSON.stringify(vbDeklarace(r.uzel))}\n`);
  else process.stderr.write(`[accel-uzel] ✓ ${cesta}: ${Object.keys(r.uzel.najemci).length} nájemců, ${Object.keys(r.uzel.enginy).length} enginů\n`);
}
