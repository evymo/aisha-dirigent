#!/usr/bin/env node
/**
 * Rehost news images — přenese obrázky článků z cizího webu do našeho úložiště.
 *
 * PROČ: těla článků (import z WordPressu) odkazují obrázky přímo na cizí web.
 * Dostupnost obsahu tím visí na cizí infrastruktuře a čtenářův prohlížeč se na ten
 * web hlásí (referer) pokaždé, když si článek otevře.
 *
 * REŽIMY (právě jeden je povinný — bez něj skript nic neudělá a vypíše nápovědu):
 *   --dry-run      Soupis z databáze. ŽÁDNÝ zápis, ŽÁDNÉ síťové volání ven.
 *   --check-urls   K soupisu přidá HEAD na každou cizí adresu (zjistí, co ještě
 *                  odpovídá). Kontaktuje cizí web, proto je to VLASTNÍ přepínač.
 *   --apply        Stáhne obrázky, nahraje je do našeho úložiště a VYGENERUJE SQL
 *                  patch pro instance-data. Do živé databáze NEZAPISUJE.
 *
 * ⛔ `--apply` stahuje z cizího webu. Spouští ho člověk, ne automat a ne agent,
 * který si k tomu nevyžádal svolení.
 *
 * ⛔ PŘEPIS TĚL NEJDE DO ŽIVÉ DB. `--apply` vydá soubor s `UPDATE`y, který patří
 * do repa instance-data jako seed/migrace. Obsah webu se mění přes git, ne rukou.
 *
 * Použití:
 *   AISHA_DB_URL=postgres://… node scripts/content/rehost-news-images.mjs --dry-run
 *   AISHA_DB_URL=… node scripts/content/rehost-news-images.mjs --check-urls
 *   AISHA_DB_URL=… STORAGE_AUTH_URL=… AISHA_ADMIN_TOKEN=… \
 *     node scripts/content/rehost-news-images.mjs --apply --out patch.sql
 *
 * @module
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { psqlPripojeni } from '../db/lib/psql-pripojeni.mjs';

const ARGV = process.argv.slice(2);

// ⛔ NEZNÁMÝ PŘEPÍNAČ JE STOP, NE VÝCHOZÍ CHOVÁNÍ (ráčna `neznamy-prepinac-neni-vychozi-chovani`).
// Skript umí stahovat z cizího webu a zapisovat soubor; překlep typu `--apply --dryrun`
// by bez téhle stráže tiše běžel jako `--apply`. Známá množina je jediný zdroj pravdy;
// hodnota za `--out` přepínačem není.
const ZNAME_PREPINACE = new Set(['--dry-run', '--check-urls', '--apply', '--out', '--help']);
const hodnotaOut = ARGV.includes('--out') ? ARGV[ARGV.indexOf('--out') + 1] : undefined;
const nezname = ARGV.filter((a, i) => a.startsWith('-') && !ZNAME_PREPINACE.has(a.split('=')[0]))
  .concat(ARGV.filter((a, i) => !a.startsWith('-') && !(ARGV[i - 1] === '--out')));
if (nezname.length) {
  console.error(`rehost-news-images: neznámý přepínač nebo argument: ${nezname.join(' ')}\n`);
  console.error('Režimy: --dry-run (jen soupis) | --check-urls (+ HEAD ven) | --apply (stáhne a nahraje)');
  process.exit(2);
}
if (ARGV.includes('--help')) {
  console.log('Režimy: --dry-run (jen soupis) | --check-urls (+ HEAD ven) | --apply (stáhne a nahraje)');
  console.log('Volitelně: --out <soubor.sql> (jen s --apply)');
  process.exit(0);
}
if (ARGV.includes('--out') && (!hodnotaOut || hodnotaOut.startsWith('-'))) {
  console.error('rehost-news-images: --out potřebuje jméno souboru.');
  process.exit(2);
}

const MODE = ['--dry-run', '--check-urls', '--apply'].filter((m) => ARGV.includes(m));
const OUT = hodnotaOut ?? 'news-images-patch.sql';
const DB_URL = process.env.AISHA_DB_URL || process.env.DATABASE_URL || '';

/** Náš vlastní původ — obrázky, které už jsou u nás, se nepřenášejí. */
const VLASTNI = (process.env.PUBLIC_TLD || '').trim();

function napoveda(duvod) {
  console.error(`${duvod}\n`);
  console.error('Režimy: --dry-run (jen soupis) | --check-urls (+ HEAD ven) | --apply (stáhne a nahraje)');
  console.error('Prostředí: AISHA_DB_URL; pro --apply navíc STORAGE_AUTH_URL a AISHA_ADMIN_TOKEN');
  process.exit(2);
}

if (MODE.length !== 1) napoveda(MODE.length === 0 ? 'Chybí režim.' : `Režimy se nekombinují: ${MODE.join(' ')}`);
if (!DB_URL) napoveda('Chybí AISHA_DB_URL.');

/** Řádky z psql — stejná závislost jako cold-start, žádný nový klient. */
// Heslo DB NE do argv (ps, výpis chyby) — cíl bez hesla + PGPASSWORD přes psqlPripojeni (brána heslo-db-mimo-argv).
function psqlRows(sql) {
  const { cil, env } = psqlPripojeni(DB_URL);
  const r = spawnSync('psql', [cil, '-X', '-v', 'ON_ERROR_STOP=1', '-tAF|', '-c', sql], { encoding: 'utf-8', env });
  if (r.error) throw new Error(`psql není spustitelné: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`psql skončilo ${r.status}: ${(r.stderr || '').trim()}`);
  return r.stdout.split('\n').filter(Boolean).map((line) => line.split('|'));
}

/**
 * Soupis cizích obrázků. Čte DVA zdroje, protože obrázky jsou na dvou místech:
 * v tělech článků (`translations.value`, jeden řádek na jazyk) a v titulním
 * obrázku článku (`news_articles.image_url`).
 */
function soupis() {
  const vTelech = psqlRows(`
    WITH tela AS (
      SELECT na.id AS article_id, tr.locale, tr.key, tr.value
        FROM public.translations tr
        JOIN public.news_articles na ON tr.key = na.content_key
       WHERE tr.namespace = 'news'
    ), odkazy AS (
      SELECT article_id, locale, key,
             (regexp_matches(value, '<img[^>]+src="(https?://[^"]+)"', 'g'))[1] AS url
        FROM tela
    )
    SELECT url, count(*)::text AS vyskytu, count(DISTINCT article_id)::text AS clanku
      FROM odkazy
     WHERE url NOT LIKE '%/storage/v1/object/public/%'
     GROUP BY url ORDER BY 2 DESC;`);

  const titulni = psqlRows(`
    SELECT image_url, count(*)::text, count(*)::text
      FROM public.news_articles
     WHERE image_url IS NOT NULL
       AND image_url LIKE 'http%'
       AND image_url NOT LIKE '%/storage/v1/object/public/%'
     GROUP BY image_url ORDER BY 1;`);

  return { vTelech, titulni };
}

const hostitel = (u) => { try { return new URL(u).hostname; } catch { return '(neplatná adresa)'; } };

function shrnutiPodleHostitele(radky) {
  const m = new Map();
  for (const [url, vyskytu] of radky) {
    const h = hostitel(url);
    const z = m.get(h) ?? { unikatnich: 0, vyskytu: 0 };
    z.unikatnich += 1;
    z.vyskytu += Number(vyskytu || 1);
    m.set(h, z);
  }
  return [...m.entries()].sort((a, b) => b[1].vyskytu - a[1].vyskytu);
}

const { vTelech, titulni } = soupis();

// Táž adresa bývá v těle i jako titulní obrázek. Bez sloučení by se stáhla
// a nahrála dvakrát a v patchi by vznikly dvě různé cílové cesty k jednomu souboru.
const podleAdresy = new Map();
for (const [url, vyskytu] of [...vTelech, ...titulni]) {
  const z = podleAdresy.get(url) ?? 0;
  podleAdresy.set(url, z + Number(vyskytu || 1));
}
const vse = [...podleAdresy.entries()].map(([url, vyskytu]) => [url, String(vyskytu)]);

console.log('── Obrázky článků mimo naše úložiště ──────────────────────────────');
console.log(`v tělech:  ${vTelech.length} unikátních adres, ${vTelech.reduce((s, r) => s + Number(r[1]), 0)} výskytů`);
console.log(`titulní:   ${titulni.length} unikátních adres`);
console.log(`souborů ke stažení: ${vse.length} (adresa v těle i v titulku = jeden soubor)`);
if (VLASTNI) console.log(`(vlastní doména dle PUBLIC_TLD: ${VLASTNI})`);
console.log('');
console.log('podle hostitele:');
for (const [h, z] of shrnutiPodleHostitele(vse)) {
  console.log(`  ${h.padEnd(38)} ${String(z.unikatnich).padStart(5)} adres  ${String(z.vyskytu).padStart(5)} výskytů`);
}

if (MODE[0] === '--dry-run') {
  console.log('\n--dry-run: nic se nestahovalo ani nezapisovalo.');
  console.log('Stav adres zjistíš --check-urls (kontaktuje cizí web), přenos udělá --apply.');
  process.exit(0);
}

/** HEAD na cizí adresu. Sekvenčně a s pauzou — cizí web není naše zátěžová laboratoř. */
async function stav(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(15_000) });
    return { kod: res.status, delka: Number(res.headers.get('content-length') || 0), typ: res.headers.get('content-type') || '' };
  } catch (err) {
    return { kod: 0, delka: 0, typ: '', chyba: err instanceof Error ? err.message : String(err) };
  }
}

if (MODE[0] === '--check-urls') {
  console.log('\n── HEAD na každou adresu (kontaktuje cizí web) ────────────────────');
  let ok = 0, chybi = 0, bajtu = 0;
  for (const [url] of vse) {
    const s = await stav(url);
    if (s.kod === 200) { ok += 1; bajtu += s.delka; } else { chybi += 1; console.log(`  ${String(s.kod).padStart(3)}  ${url}`); }
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log(`\nodpovídá 200: ${ok} | neodpovídá: ${chybi} | celkem ke stažení: ${(bajtu / 1024 / 1024).toFixed(1)} MB`);
  console.log('Nic se nestáhlo ani nezapsalo.');
  process.exit(0);
}

// ── --apply ────────────────────────────────────────────────────────────────
const STORAGE = (process.env.STORAGE_AUTH_URL || '').replace(/\/$/, '');
const TOKEN = process.env.AISHA_ADMIN_TOKEN || '';
if (!STORAGE || !TOKEN) napoveda('--apply potřebuje STORAGE_AUTH_URL a AISHA_ADMIN_TOKEN (role admin/staff).');

/** Nahraje jeden soubor naším vlastním tokem: preflight → PUT → ohlášení dokončení. */
async function nahraj(bajty, jmeno, typ) {
  const pre = await fetch(`${STORAGE}/upload-preflight`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ bucket: 'page-assets', filename: jmeno, contentType: typ, fileSizeBytes: bajty.byteLength }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!pre.ok) throw new Error(`preflight ${pre.status}: ${(await pre.text()).slice(0, 200)}`);
  const { uploadUrl, quarantineKey } = await pre.json();

  const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': typ }, body: bajty, signal: AbortSignal.timeout(120_000) });
  if (!put.ok) throw new Error(`PUT ${put.status}`);

  // Teprve tohle spustí antivirový sken a promoci — bez něj objekt zůstane
  // v karanténě a nikdy se neservíruje.
  const done = await fetch(`${STORAGE}/upload-complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ objectKey: quarantineKey }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!done.ok) throw new Error(`upload-complete ${done.status}: ${(await done.text()).slice(0, 200)}`);
  const { objectKey } = await done.json();
  return objectKey;
}

const mapa = new Map();
let stazeno = 0, preskoceno = 0;
console.log('\n── Stahuji a nahrávám ────────────────────────────────────────────');
for (const [url] of vse) {
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60_000) });
    if (!res.ok) { console.log(`  ${res.status}  přeskočeno: ${url}`); preskoceno += 1; continue; }
    const typ = (res.headers.get('content-type') || 'application/octet-stream').split(';')[0];
    const bajty = Buffer.from(await res.arrayBuffer());
    const jmeno = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'obrazek');
    const klic = await nahraj(bajty, jmeno, typ);
    mapa.set(url, klic);
    stazeno += 1;
    await new Promise((r) => setTimeout(r, 200));
  } catch (err) {
    preskoceno += 1;
    console.log(`  CHYBA  ${url} — ${err instanceof Error ? err.message : err}`);
  }
}

// SQL patch pro instance-data. Nahrazuje se PŘESNÁ adresa, takže běh je idempotentní:
// po prvním použití už se stará adresa v datech nevyskytuje.
const radky = ['-- Rehost obrázků novinek do našeho úložiště.', `-- Vygeneroval scripts/content/rehost-news-images.mjs, ${new Date().toISOString()}.`, `-- Adres: ${mapa.size}. Idempotentní: nahrazuje přesné adresy, které už podruhé nejsou.`, ''];
for (const [url, klic] of mapa) {
  const nova = `/storage/v1/object/public/page-assets/${klic}`;
  const esc = (x) => x.replace(/'/g, "''");
  radky.push(`UPDATE public.translations SET value = replace(value, '${esc(url)}', '${esc(nova)}') WHERE namespace = 'news' AND position('${esc(url)}' in value) > 0;`);
  radky.push(`UPDATE public.news_articles SET image_url = '${esc(nova)}' WHERE image_url = '${esc(url)}';`);
}
mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
writeFileSync(OUT, radky.join('\n') + '\n');

console.log(`\nstaženo a nahráno: ${stazeno} | přeskočeno: ${preskoceno}`);
console.log(`SQL patch: ${OUT} — patří do repa instance-data jako seed/migrace, ne do živé DB.`);
