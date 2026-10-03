#!/usr/bin/env node
/**
 * coverage-probe.mjs — kolik korpusu je vůbec DOHLEDATELNÉ.
 *
 * PROČ (naměřeno 2026-08-08 na živé DB)
 * -------------------------------------
 *   chunků celkem            49 928
 *   z toho s vektorem        49 928   ⇒ pokrytí vektory 100 %
 *   položek celkem           44 983
 *   položek s aspoň 1 chunkem 44 421  ⇒ 562 POLOŽEK NEMÁ ANI JEDEN CHUNK
 *
 * Vektory tedy NEZAOSTÁVAJÍ — dopočítávat je při nasazení by řešilo problém,
 * který neexistuje. Skutečné vady jsou dvě jiné:
 *   • 562 položek není nachunkovaných, takže je vyhledávání NIKDY nenajde.
 *     Položka bez chunku není „skoro hotová" — je pro retrieval neviditelná,
 *     a přitom se do statistik počítá jako existující.
 *   • nikdo to NEMĚŘÍ. Kdyby pokrytí spadlo na 60 %, projde to bez povšimnutí:
 *     táž třída jako mizející bloky v extranetu — vada, která se projeví
 *     NEPŘÍTOMNOSTÍ, a tu nikdo nereklamuje.
 *
 * PROČ SONDA A NE BRÁNA: brány v tomhle repu jsou statické (čtou soubory).
 * Tohle se ze souborů zjistit NEDÁ — je to vlastnost živého korpusu. Sonda
 * proto stojí vedle bran a spouští se tam, kde je DB na dosah (operátor, cron,
 * CI lane s pověřením).
 *
 * A PROČ SE VEKTORY NEPOČÍTAJÍ TADY: korpus se embeduje MLX na Apple Siliconu,
 * protože cílový host je x86 Linux — proto je ten model v katalogu s
 * `is_available = false`. CI runner je taky x86. „Počítat vektory při CI" je
 * fyzicky mimo; měřit pokrytí jde odkudkoli.
 *
 * Použití:
 *   node scripts/rag/coverage-probe.mjs              # změř a porovnej s laťkou
 *   node scripts/rag/coverage-probe.mjs --update     # posuň laťku NAHORU
 *   node scripts/rag/coverage-probe.mjs --json
 *
 * Pověření: POSTGREST_SERVICE_TOKEN + veřejná PostgREST adresa (env nebo
 * .env.coolify). Bez nich sonda PADÁ — mlčet by znamenalo tvářit se změřeně.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const LATKA = resolve(ROOT, 'scripts/rag/coverage-baseline.json');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);

/** Pověření: env vyhrává nad souborem (v CI soubor neexistuje). */
function prostredi() {
  const env = {};
  const f = resolve(ROOT, '.env.coolify');
  if (existsSync(f)) {
    for (const radek of readFileSync(f, 'utf8').split(/\r?\n/)) {
      const t = radek.trim();
      if (!t || t.startsWith('#') || !t.includes('=')) continue;
      const i = t.indexOf('=');
      env[t.slice(0, i)] = t.slice(i + 1).replace(/^['"]|['"]$/g, '');
    }
  }
  return { ...env, ...process.env };
}

const env = prostredi();
const token = env.POSTGREST_SERVICE_TOKEN || '';
/**
 * KAM se sonda ptá. ŽÁDNÝ VÝCHOZÍ HOST — první verze tu měla za `||` natvrdo
 * veřejnou adresu jedné konkrétní instance, a byly to dvě vady naráz: tichý
 * default, který zakryje chybějící vstup, a instanční jméno ve stack kódu.
 * Obojí odchytily brány — přesně proto existují. Adresa je vlastnost NASAZENÍ,
 * ne zdrojáku.
 *
 * (Ta doména se sem záměrně NEPÍŠE ani jako příklad: brána čte soubor textově,
 * takže vzorek ve vysvětlivce by vzala jako kód. Táž past dnes potřetí.)
 *
 * `POSTGREST_URL` z .env.coolify je mesh adresa (zevnitř); z notebooku se chodí
 * přes veřejné API, proto se dá přebít `RAG_PROBE_URL`.
 */
const api = (env.RAG_PROBE_URL || env.POSTGREST_URL || '').replace(/\/$/, '');

if (!token || !api) {
  const co = [!token && 'POSTGREST_SERVICE_TOKEN', !api && 'RAG_PROBE_URL (nebo POSTGREST_URL)']
    .filter(Boolean).join(' + ');
  console.error(`FATAL: chybí ${co} — sonda NEMĚŘILA nic.`);
  console.error('Sonda, která bez pověření nebo bez adresy skončí tiše, je horší než žádná:');
  console.error('tváří se změřeně. Adresu předej podle prostředí, do zdrojáku nepatří.');
  process.exit(2);
}

/** Strop čekání: `fetch` bez něj umí viset donekonečna a sonda by pak ani
 *  neselhala — jen by nikdy nedoběhla, což je nejhorší ze všech odpovědí. */
const TIMEOUT_MS = Number(env.RAG_PROBE_TIMEOUT_MS || 40000);

async function rpc(fn, body) {
  const brzda = new AbortController();
  const t = setTimeout(() => brzda.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${api}/rpc/${fn}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: brzda.signal,
    });
    if (!res.ok) throw new Error(`rpc ${fn} → HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

const pct = (a, b) => (b === 0 ? 0 : Math.round((a / b) * 10000) / 100);

let stat;
try {
  // Hotové měřidlo, které v repu UŽ BYLO — nepíše se sedmé.
  stat = await rpc('mcp_get_knowledge_stats', {});
} catch (e) {
  console.error(`FATAL: korpus se nepodařilo změřit: ${e.message}`);
  process.exit(2);
}

const chunky = Number(stat.total_chunks ?? 0);
const sVektorem = Number(stat.embedding_coverage?.chunks_with_embeddings ?? 0);
const polozky = Number(stat.total_items ?? 0);
const sChunky = Number(stat.embedding_coverage?.items_with_chunks ?? 0);

// Prázdný korpus by prošel jakoukoli laťkou — to není čistý stav, to je rozbité
// měřidlo (nebo špatná DB).
if (chunky === 0 || polozky === 0) {
  console.error(`FATAL: korpus hlásí ${polozky} položek / ${chunky} chunků — měřidlo míří jinam, než si myslíš.`);
  process.exit(2);
}

const ted = {
  vektory_pct: pct(sVektorem, chunky),
  chunkovani_pct: pct(sChunky, polozky),
  _mereno: { chunky, sVektorem, polozky, sChunky },
};

if (flag('--json')) console.log(JSON.stringify(ted, null, 2));
else {
  console.log(`vektory:    ${sVektorem}/${chunky} chunků = ${ted.vektory_pct} %`);
  console.log(`chunkování: ${sChunky}/${polozky} položek = ${ted.chunkovani_pct} %`);
  const bez = polozky - sChunky;
  if (bez > 0) console.log(`⚠️  ${bez} položek nemá ANI JEDEN chunk — vyhledávání je nenajde.`);
}

const latka = existsSync(LATKA) ? JSON.parse(readFileSync(LATKA, 'utf8')) : null;

if (flag('--update')) {
  // Rohatka se smí jen utahovat: laťka jde NAHORU, nikdy dolů. Kdo chce dolů,
  // musí to napsat ručně a zdůvodnit — jinak by se propad „opravil" přepsáním.
  const nova = {
    vektory_pct: Math.max(ted.vektory_pct, latka?.vektory_pct ?? 0),
    chunkovani_pct: Math.max(ted.chunkovani_pct, latka?.chunkovani_pct ?? 0),
    _poznamka: 'Laťka pokrytí korpusu. Smí jen RŮST — pokles je nález, ne důvod k přepsání.',
  };
  writeFileSync(LATKA, `${JSON.stringify(nova, null, 2)}\n`);
  console.log(`\nlaťka posunuta: vektory ${nova.vektory_pct} % · chunkování ${nova.chunkovani_pct} %`);
  process.exit(0);
}

if (!latka) {
  console.error('\nFATAL: laťka neexistuje — spusť poprvé s --update.');
  process.exit(2);
}

const propady = [];
if (ted.vektory_pct < latka.vektory_pct) propady.push(`vektory ${latka.vektory_pct} % → ${ted.vektory_pct} %`);
if (ted.chunkovani_pct < latka.chunkovani_pct) propady.push(`chunkování ${latka.chunkovani_pct} % → ${ted.chunkovani_pct} %`);

if (propady.length > 0) {
  console.error(`\nPOKLES POKRYTÍ:\n${propady.map((p) => `  ${p}`).join('\n')}`);
  console.error('\nCO TO ZNAMENÁ: část korpusu přestala být dohledatelná. Není to kosmetika —');
  console.error('položka, kterou vyhledávání nenajde, pro odpovídač NEEXISTUJE.');
  console.error('CO S TÍM: dohledat, co poslední ingest nezpracoval. Laťku NEPŘEPISOVAT.');
  process.exit(1);
}

console.log('\nOK: pokrytí nekleslo pod laťku.');
