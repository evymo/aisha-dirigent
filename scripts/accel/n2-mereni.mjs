// N2 — měření zátěže nájemce přes vstup lane. Běží v jednorázovém kontejneru na síti nájemce, kterého
// měří (diagnostika = nájemce sondy, `<vlastník>-lane-sonda`), s jeho klíčem; skript přijde přes stdin
// (`node -`). Výstup jsou jen čísla, žádná data nájemce. Tvar zátěže je dopočet vektorů: sekvenční třída
// `davka` s jedním vstupem na požadavek v tempu TEMPO_S, souběžně řídké `dotaz`. Vypisuje jen čísla.
//
//   VSTUP, KLIC_SONDY, ALIAS         vstup lane, klíč sondy, alias enginu, který se měří
//   TEMPO_S                          cílové tempo dávky, úseků/s (od nájemce: korpus / doba dopočtu)
//   TRVANI_S                         délka zátěže, aspoň jedno kvótové okno
//   KORPUS                           počet úseků pro odhad doby dopočtu (od nájemce)
//   DELKY                            délky úseků ve znacích oddělené čárkou, berou se dokola (od nájemce)
// Tvar zátěže dodá nájemce; skript žádný nedosazuje.
const env = process.env;
const VSTUP = env.VSTUP;
const ALIAS = env.ALIAS;
const cislo = (k) => {
  const x = Number(env[k]);
  if (!env[k] || !Number.isFinite(x) || x <= 0) {
    console.log(`n2: ${k} chybí nebo není kladné číslo`);
    process.exit(2);
  }
  return x;
};
const TEMPO = cislo('TEMPO_S');
const TRVANI_MS = cislo('TRVANI_S') * 1000;
const KORPUS = cislo('KORPUS');
const h = (trida) => ({ authorization: `Bearer ${env.KLIC_SONDY}`, 'content-type': 'application/json', 'x-aisha-trida': trida });

// Syntetický český text dané délky ve znacích (žádná data nájemce).
const VETA = 'Řidič převzal vozidlo na stanovišti, zkontroloval stav paliva, pneumatik a tachometru a potvrdil předávací protokol. ';
const text = (znaku) => VETA.repeat(Math.ceil(znaku / VETA.length)).slice(0, znaku);
// Délky úseků korpusu nájemce (znaky), dokola, např. průměr ×8, p95, max = 80 / 10 / 10 %.
const DELKY = String(env.DELKY ?? '').split(',').map(Number);
if (DELKY.length === 0 || DELKY.some((d) => !Number.isInteger(d) || d <= 0)) {
  console.log('n2: DELKY chybí nebo nejsou kladná celá čísla oddělená čárkou');
  process.exit(2);
}

async function zadost(trida, vstup) {
  const t0 = performance.now();
  try {
    const r = await fetch(`${VSTUP}/v1/embeddings`, { method: 'POST', headers: h(trida), body: JSON.stringify({ model: ALIAS, input: [vstup] }), signal: AbortSignal.timeout(30_000) });
    const j = await r.json().catch((e) => {
      console.log(`n2: tělo odpovědi ${r.status} není JSON (${e.message})`);
      return null;
    });
    return { ms: performance.now() - t0, status: r.status, gpuMs: Number(r.headers.get('x-aisha-gpu-ms') ?? NaN), duvod: j?.duvod ?? null, dim: j?.data?.[0]?.embedding?.length ?? 0 };
  } catch (e) {
    return { ms: performance.now() - t0, status: 0, gpuMs: NaN, duvod: `chyba: ${e.message}`, dim: 0 };
  }
}
const kvantil = (xs, q) => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const f = (x) => (Number.isFinite(x) ? x.toFixed(1) : '—');
const souhrn = (nazev, vys) => {
  const ok = vys.filter((v) => v.status === 200);
  const ms = ok.map((v) => v.ms);
  const gpu = ok.map((v) => v.gpuMs).filter(Number.isFinite);
  console.log(`${nazev}: n=${vys.length} ok=${ok.length} ms p50 ${f(kvantil(ms, 0.5))} p95 ${f(kvantil(ms, 0.95))} max ${f(Math.max(...ms))} · gpu_ms p50 ${f(kvantil(gpu, 0.5))} p95 ${f(kvantil(gpu, 0.95))}`);
};
const duvody = (vys) => Object.entries(vys.filter((v) => v.status !== 200).reduce((a, v) => ((a[`${v.status} ${v.duvod}`] = (a[`${v.status} ${v.duvod}`] ?? 0) + 1), a), {}));

(async () => {
  console.log(`n2 ${new Date().toISOString()} alias ${ALIAS} tempo ${TEMPO}/s trvání ${TRVANI_MS / 1000} s`);
  // 0) Zahřátí spojení (nepočítá se).
  await zadost('dotaz', text(80));
  // 1) Dotaz v klidu.
  const klid = [];
  for (let i = 0; i < 20; i++) klid.push(await zadost('dotaz', text(80)));
  souhrn('dotaz v klidu', klid);

  // 2) Zátěž: sekvenční dávka v tempu + souběžně dotaz 1/s.
  const davka = [];
  const dotazy = [];
  const start = performance.now();
  let konec = false;
  const smyckaDotazu = (async () => {
    while (!konec) {
      dotazy.push(await zadost('dotaz', text(80)));
      await new Promise((r) => setTimeout(r, 1000));
    }
  })();
  const krok = 1000 / TEMPO;
  for (let i = 0; performance.now() - start < TRVANI_MS; i++) {
    const delka = DELKY[i % DELKY.length];
    davka.push({ delka, ...(await zadost('davka', text(delka))) });
    const dalsi = start + (i + 1) * krok;
    const cekej = dalsi - performance.now();
    if (cekej > 0) await new Promise((r) => setTimeout(r, cekej));
  }
  konec = true;
  await smyckaDotazu;
  const trvani = (performance.now() - start) / 1000;

  for (const d of [...new Set(DELKY)]) souhrn(`davka ${d} zn.`, davka.filter((v) => v.delka === d));
  souhrn('davka celkem', davka);
  souhrn('dotaz pod zátěží', dotazy);
  const ok = davka.filter((v) => v.status === 200);
  const prumMs = ok.reduce((s, v) => s + v.ms, 0) / Math.max(1, ok.length);
  const prumGpu = ok.map((v) => v.gpuMs).filter(Number.isFinite).reduce((s, x, _, a) => s + x / a.length, 0);
  console.log(`propustnost: ${(ok.length / trvani).toFixed(1)} úseků/s (cíl ${TEMPO}) · průměr požadavku ${f(prumMs)} ms · gpu_ms na úsek ${f(prumGpu)}`);
  console.log(`odhad dopočtu ${KORPUS} úseků: v tempu ${(KORPUS / TEMPO / 3600).toFixed(2)} h; sekvenčně bez tempa ${(KORPUS * prumMs / 1000 / 3600).toFixed(2)} h`);
  console.log(`gpu_ms za 60 s při tempu ${TEMPO}/s ≈ ${Math.round(TEMPO * prumGpu * 60)}`);
  console.log(`odmítnutí: ${JSON.stringify(duvody([...davka, ...dotazy]))}`);
  const m = await fetch(`${VSTUP}/v1/aisha/mereni`, { headers: h('dotaz'), signal: AbortSignal.timeout(10_000) })
    .then((r) => r.json())
    .catch((e) => {
      console.log(`n2: /v1/aisha/mereni nedostupné (${e.message})`);
      return { chyba: e.message };
    });
  console.log(`okno nájemce: ${JSON.stringify(m)}`);
  process.exit(ok.length > 0 && davka.every((v) => v.status === 200 || v.status === 429) ? 0 : 1);
})().catch((e) => {
  console.log('n2 chyba', e.message);
  process.exit(1);
});
