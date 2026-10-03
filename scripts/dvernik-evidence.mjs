#!/usr/bin/env node
/**
 * dvernik-evidence.mjs — z evidence přístupů udělá PODKLAD pro rozhodnutí dverníka.
 *
 * PROČ EXISTUJE. `EDGE_DOOR_MODE=observe` zapisuje, kdo na veřejnou plochu chodí.
 * Zápis ale není evidence, je to hromada řádků. Rozhodnutí „tahle adresa smí i po
 * zavření" se dělá nad SEZNAMEM ADRES a tenhle skript je ten převod — jediné místo,
 * kde vzniká.
 *
 * ⛔ NEROZHODUJE. Nic nepovoluje ani nezapisuje do konfigurace. Dveře jsou lidská brána.
 *
 * ⛔ A NENAVRHUJE, KDYŽ NEVÍ, ČÍ ADRESU ČTE. Tohle je jádro. Bez doručeného
 * `GATEWAY_TRUSTED_PROXIES` přepíše Caddy `x-forwarded-for` a do logu zapíše adresu
 * POSLEDNÍHO SKOKU, ne klienta. Návrh z takového logu by do `SPA_STATIC_ALLOW`
 * (trvale otevřené adresy, K4) dostal adresu proxy — a tím by `enforce` sice hlásilo
 * zavřeno, ale prošel by každý, kdo za tou proxy stojí. Dveře by byly TIŠE neúčinné.
 * Stejnou zásadu drží `services/gateway/src/config.ts` (gateway se zapnutými dveřmi
 * a bez té proměnné NENASTARTUJE). Seznam pro řízení přístupu se nehádá.
 *
 * MĚŘÍ SE VLASTNOST, NE PŘÍTOMNOST HODNOTY. Že proměnná existuje, neznamená, že
 * řetěz funguje. Proto: kandidát v rozsahu proxy/meshe = VADA měření (ne povolení),
 * a kolaps celé evidence na jednu adresu = totéž. Obojí běh zastaví.
 *
 * POUŽITÍ
 *   node scripts/dvernik-evidence.mjs --log <cesta> [--dny N] [--min N]
 *   node scripts/dvernik-evidence.mjs --log <cesta> --dny 14 --min 3 --allow-list
 *   node scripts/dvernik-evidence.mjs --log <cesta> --json
 *   … --env-soubor <cesta>   odkud číst GATEWAY_TRUSTED_PROXIES a lhůtu (výchozí .env.coolify)
 *
 * Ve stacku leží evidence v kontejneru edge-proxy — aktivní soubor, denní
 * archivy `pristupy.log.<UTC datum>` a zálohy Caddy `*.log.gz`. Kopíruj CELÝ
 * adresář, aktivní soubor nese nejvýš poslední den:
 *   docker cp <prefix>-edge-proxy:/var/log/edge ./evidence
 *   node scripts/dvernik-evidence.mjs --log evidence/pristupy.log
 * ⚠️ Ta kopie je osobní údaj MIMO instanci. Po rozhodnutí ji smaž — záznam o
 *    činnostech zpracování na ni pamatuje.
 *
 * ⛔ LHŮTA SE MĚŘÍ NA EVIDENCI, NE NA ÚKLIDU. Úklid v edge (compose, „Úklid
 * evidence adres") drží záznamy nejvýš N+1 dní. Že úklid běží, ještě neznamená,
 * že funguje (plný disk, zabitý řez). Proto se měří VLASTNOST: rozpětí mezi
 * nejstarším a nejnovějším záznamem. Je-li větší než N+1 dní, evidence porušuje
 * vlastní deklaraci — nástroj to řekne nahlas, skončí nenulově a návrh nevydá.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vRozsahu, kterýRozsah } from './lib/adresa-v-rozsahu.mjs';

const KOREN = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const umri = (...r) => { for (const x of r) console.error(x); process.exit(2); };

if (has('--help') || has('-h')) {
  console.log(readFileSync(new URL(import.meta.url)).toString().split('*/')[0].replace(/^\/\*\*?|^ \* ?|^ \*/gm, ''));
  process.exit(0);
}

const logPath = val('--log', '/var/log/edge/pristupy.log');
const dny = Number(val('--dny', '0')) || 0;
const minPocet = Number(val('--min', '1')) || 1;
const chceNavrh = has('--allow-list');
// Prostředí má přednost; soubor je pohodlí operátora. Explicitně, aby šel nástroj
// měřit bez ohledu na to, co v checkoutu náhodou leží.
const envSoubor = val('--env-soubor', join(KOREN, '.env.coolify'));

// ── čí adresu vlastně čteme ────────────────────────────────────────────────
function trustedProxies() {
  const zEnv = (process.env.GATEWAY_TRUSTED_PROXIES ?? '').trim();
  if (zEnv) return { hodnota: zEnv, zdroj: 'prostředí' };
  const env = envSoubor;
  if (existsSync(env)) {
    const m = readFileSync(env, 'utf8').match(/^GATEWAY_TRUSTED_PROXIES=(.*)$/m);
    const v = (m?.[1] ?? '').trim().replace(/^['"]|['"]$/g, '');
    if (v) return { hodnota: v, zdroj: basename(env) };
  }
  return { hodnota: '', zdroj: null };
}

// ── deklarovaná lhůta (tentýž zdroj a výchozí hodnota jako edge) ──────────
function deklarovanaLhuta() {
  const zEnv = (process.env.EDGE_ACCESS_RETENTION_DAYS ?? '').trim();
  let hodnota = zEnv, zdroj = zEnv ? 'prostředí' : null;
  const env = envSoubor;
  if (!hodnota && existsSync(env)) {
    const m = readFileSync(env, 'utf8').match(/^EDGE_ACCESS_RETENTION_DAYS=(.*)$/m);
    hodnota = (m?.[1] ?? '').trim().replace(/^['"]|['"]$/g, '');
    if (hodnota) zdroj = basename(env);
  }
  // Nedeklarovaná v envu = ještě nedoplněná doktorem; edge by bez ní nenastartoval
  // (compose `:?`), takže platí hodnota, kterou doplní: kontrakt, static 30.
  if (!hodnota) return { dni: 30, zdroj: 'kontrakt env-doktora (v envu zatím nedoplněna)' };
  if (!/^[1-9][0-9]*$/.test(hodnota)) {
    umri(`EDGE_ACCESS_RETENTION_DAYS='${hodnota}' (${zdroj}) není kladný počet dní.`,
         '  Touž hodnotu by edge odmítl a nenastartoval. Lhůtu nehádám.');
  }
  return { dni: Number(hodnota), zdroj };
}

const tp = trustedProxies();
const lhuta = deklarovanaLhuta();
const rozsahy = tp.hodnota.split(',').map((s) => s.trim()).filter(Boolean);

// ── čtení evidence (rotované soubory patří do TÉŽE evidence) ───────────────
function soubory(p) {
  if (!existsSync(p)) return [];
  const dir = dirname(p), base = basename(p);
  return readdirSync(dir).filter((f) => f === base || f.startsWith(base.replace(/\.log$/, ''))).map((f) => join(dir, f));
}

const files = soubory(logPath);
if (files.length === 0) {
  umri(`evidence nenalezena: ${logPath}`,
       '  ve stacku:  docker cp <prefix>-edge-proxy:/var/log/edge ./evidence',
       '  pak:        node scripts/dvernik-evidence.mjs --log evidence/pristupy.log');
}

// Zálohy Caddy jsou gzip. Číst je jako text = každý řádek „nečitelný" a evidence
// tiše přijde o všechno kromě posledního dne.
function text(f) {
  try { return f.endsWith('.gz') ? gunzipSync(readFileSync(f)).toString('utf8') : readFileSync(f, 'utf8'); }
  catch (e) { nectene.push(`${basename(f)}: ${e.code ?? e.message}`); return ''; }
}
const nectene = [];
// Nečitelný řádek není výjimka toku, je to NÁLEZ: počítá se a hlásí ve výstupu.
function radekJson(line) {
  try { return JSON.parse(line); } catch (e) { return { error: e.message }; }
}

const mez = dny ? Date.now() / 1000 - dny * 86400 : 0;
const adresy = new Map();
let radku = 0, preskoceno = 0, bezAdresy = 0, nejstarsi = Infinity, nejnovejsi = 0;

for (const f of files) {
  // Nuly jsou díra po řezu, ne data: Caddy (lumberjack) nový soubor otevírá bez
  // O_APPEND a po zkrácení píše na starý posun. Řádek za dírou by jinak byl „nečitelný".
  for (const line of text(f).replace(/\0+/g, '').split('\n')) {
    if (!line.trim()) continue;
    radku++;
    const r = radekJson(line);
    if (r.error) { preskoceno++; continue; }
    const ip = r?.request?.client_ip ?? r?.request?.remote_ip;
    const ts = typeof r?.ts === 'number' ? r.ts : 0;
    if (ts) { nejstarsi = Math.min(nejstarsi, ts); nejnovejsi = Math.max(nejnovejsi, ts); }
    if (!ip) { bezAdresy++; continue; }
    if (mez && ts && ts < mez) continue;
    const e = adresy.get(ip) ?? { ip, prvni: Infinity, posledni: 0, pocet: 0, hosty: new Set() };
    e.pocet++;
    if (ts) { e.prvni = Math.min(e.prvni, ts); e.posledni = Math.max(e.posledni, ts); }
    if (r?.request?.host) e.hosty.add(r.request.host);
    adresy.set(ip, e);
  }
}

const vse = [...adresy.values()].sort((a, b) => b.pocet - a.pocet);
const celkemPozadavku = vse.reduce((s, e) => s + e.pocet, 0);

// ── VADY MĚŘENÍ — zastavují běh, nejsou to varování ────────────────────────
const vady = [];
if (rozsahy.length) {
  const zProxy = vse.filter((e) => kterýRozsah(e.ip, rozsahy));
  for (const e of zProxy) {
    vady.push(`adresa ${e.ip} leží v rozsahu důvěryhodné proxy (${kterýRozsah(e.ip, rozsahy)}) — ` +
              `to není klient, to je SKOK. Evidence zapsala proxy, ne návštěvníka.`);
  }
}
if (vse.length === 1 && celkemPozadavku > 1) {
  vady.push(`celá evidence (${celkemPozadavku} požadavků) kolabuje na JEDNU adresu ${vse[0].ip} — ` +
            `typický obraz nepředaného x-forwarded-for.`);
}

// ── LHŮTA — vlastnost evidence ────────────────────────────────────────────
// Rozpětí se měří k NEJNOVĚJŠÍMU záznamu, ne k dnešku: kopie mohla vzniknout
// před týdnem. Odchylka je jednostranná (nikdy falešný poplach), porušení
// z kopie, do které už nic nepřibývá, může uniknout. Rezerva 10 min pokrývá
// 15s interval úklidu a zaokrouhlení `find -mmin`.
const rozpetiDni = nejnovejsi && nejstarsi !== Infinity ? (nejnovejsi - nejstarsi) / 86400 : 0;
const retencePorusena = rozpetiDni * 86400 > (lhuta.dni + 1) * 86400 + 600;
const retence = retencePorusena
  ? `nejstarší záznam ${new Date(nejstarsi * 1000).toISOString().slice(0, 16).replace('T', ' ')} je ${rozpetiDni.toFixed(1)} dní ` +
    `před nejnovějším; deklarace dovoluje nejvýš ${lhuta.dni} + 1 dní. Úklid v edge nefunguje (compose-notes, „Úklid evidence adres").`
  : null;

// ── výstupy ────────────────────────────────────────────────────────────────
const vysledek = vse.filter((e) => e.pocet >= minPocet).map((e) => ({
  adresa: e.ip, pozadavku: e.pocet,
  prvni: e.prvni === Infinity ? null : new Date(e.prvni * 1000).toISOString().slice(0, 16).replace('T', ' '),
  posledni: e.posledni ? new Date(e.posledni * 1000).toISOString().slice(0, 16).replace('T', ' ') : null,
  hosty: [...e.hosty].sort(),
  vRozsahuProxy: rozsahy.length ? Boolean(kterýRozsah(e.ip, rozsahy)) : null,
}));

if (has('--json')) {
  console.log(JSON.stringify({
    radku, preskoceno, bezAdresy, adres: vysledek.length,
    trusted_proxies: { doruceno: Boolean(rozsahy.length), zdroj: tp.zdroj, rozsahy },
    lhuta: { dni: lhuta.dni, zdroj: lhuta.zdroj, rozpetiDni: Number(rozpetiDni.toFixed(2)), porusena: retencePorusena },
    nectene, vady, adresy: vysledek,
  }, null, 2));
  process.exit(vady.length || retencePorusena ? 3 : 0);
}

if (chceNavrh) {
  // ⛔ BRÁNA NÁVRHU. Tři podmínky, každá zastaví — návrh je vstup do řízení
  // přístupu, ne přehled.
  if (!rozsahy.length) {
    umri('ODMÍTÁM NAVRHNOUT: GATEWAY_TRUSTED_PROXIES není doručené.',
      '',
      '  Bez něj Caddy přepíše x-forwarded-for a do evidence zapíše adresu POSLEDNÍHO',
      '  SKOKU, ne klienta. Návrh by pak do SPA_STATIC_ALLOW dostal adresu proxy a',
      '  otevřel dveře každému, kdo za ní stojí — „enforce" by hlásilo zavřeno a nebylo.',
      '',
      '  Seznam pro řízení přístupu se NEHÁDÁ. Touž zásadu drží gateway:',
      '  services/gateway/src/config.ts — se zapnutými dveřmi a bez té proměnné NENASTARTUJE.',
      '',
      '  Hodnotu odvozuje scripts/lib/derive-subnets.mjs, doručuje coolify-sync-envs.',
      '  Přehled (bez návrhu) jde vypsat i tak — spusť bez --allow-list.');
  }
  if (vady.length) {
    umri('ODMÍTÁM NAVRHNOUT: evidence neměří klienty.', '',
      ...vady.map((v) => `  • ${v}`), '',
      '  Návrh z takové evidence by povolil skok, ne návštěvníka. Oprav doručení',
      '  GATEWAY_TRUSTED_PROXIES na edge a nech evidenci nasbírat znovu.');
  }
  if (retencePorusena) {
    umri('ODMÍTÁM NAVRHNOUT: RETENCE PORUŠENA.', '', `  ${retence}`, '',
      '  Evidence, která porušuje vlastní deklarovanou lhůtu, není podklad pro řízení',
      '  přístupu — je to vada zpracování osobních údajů. Nejdřív oprav úklid.');
  }
  if (!has('--dny') || !has('--min')) {
    umri('ODMÍTÁM NAVRHNOUT: chybí --dny a --min.', '',
      '  Výchozí „všechno, co se kdy objevilo" je nejhorší možný návrh: nese i skenery',
      '  a člověk ho neproklepne. Okno a práh jsou ROZHODNUTÍ, ne výchozí hodnota.',
      '  Např.: --dny 14 --min 3');
  }
  console.log(`# PODKLAD, NE HOTOVÁ HODNOTA — ${vysledek.length} adres, okno ${dny} dní, práh ${minPocet}`);
  console.log(`# Projdi řádek po řádku. Co necháš, projde i po zavření dveří, bez zaťukání.`);
  console.log(`# Vlož do SPA_STATIC_ALLOW ručně a jen to, co jsi opravdu schválil.`);
  for (const e of vysledek) {
    console.log(`#   ${e.pozadavku.toString().padStart(6)} požadavků · ${e.prvni} → ${e.posledni} · ${e.hosty.join(' ')}`);
    console.log(`${e.adresa}`);
  }
  process.exit(0);
}

console.log(`\nEVIDENCE ADRES — podklad pro rozhodnutí dverníka`);
console.log(`  zdroj: ${files.length} souborů, ${radku} řádků${preskoceno ? `, ${preskoceno} nečitelných` : ''}${bezAdresy ? `, ${bezAdresy} bez adresy` : ''}`);
console.log(`  okno:  ${dny ? `posledních ${dny} dní` : 'celá evidence'}, práh ${minPocet} požadavků`);
console.log(`  lhůta: ${lhuta.dni} dní (${lhuta.zdroj}), rozpětí záznamů ${rozpetiDni.toFixed(1)} dní${retencePorusena ? ' — ⛔ RETENCE PORUŠENA' : ' — v mezích'}`);
if (nectene.length) console.log(`  ⚠ nečitelné soubory: ${nectene.join(', ')}`);
if (retence) console.log(`\n  ⛔ RETENCE PORUŠENA: ${retence}\n`);
console.log(`  čí adresu čteme: ${rozsahy.length ? `trusted_proxies doručeno (${tp.zdroj}): ${rozsahy.join(' ')}` : 'NEZNÁMO — GATEWAY_TRUSTED_PROXIES není doručené'}`);
if (vady.length) {
  console.log(`\n  ⛔ VADY MĚŘENÍ (návrh je zablokovaný):`);
  for (const v of vady) console.log(`     • ${v}`);
}
console.log('');
if (vysledek.length === 0) { console.log('  (žádná adresa neprošla filtrem)\n'); process.exit(vady.length || retencePorusena ? 3 : 0); }
const w = Math.max(6, ...vysledek.map((e) => e.adresa.length));
console.log(`  ${'ADRESA'.padEnd(w)}  ${'POŽ.'.padStart(6)}  ${'PRVNÍ'.padEnd(16)}  ${'POSLEDNÍ'.padEnd(16)}  HOSTY`);
for (const e of vysledek) {
  const zn = e.vRozsahuProxy ? ' ⛔proxy' : '';
  console.log(`  ${e.adresa.padEnd(w)}  ${String(e.pozadavku).padStart(6)}  ${(e.prvni ?? '?').padEnd(16)}  ${(e.posledni ?? '?').padEnd(16)}  ${e.hosty.join(' ')}${zn}`);
}
console.log(`\n  celkem ${vysledek.length} adres.${vady.length || retencePorusena ? ' Návrh zablokovaný — viz výš.' : ' Podklad k rozhodnutí: --dny N --min N --allow-list'}\n`);
process.exit(vady.length || retencePorusena ? 3 : 0);
