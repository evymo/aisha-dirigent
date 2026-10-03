#!/usr/bin/env node
// =============================================================================
// platno-vs-seed.mjs — co je v editoru vs. co přepíše nasazení
// =============================================================================
// ⛔ PROČ (naměřeno 2026-09-01).
//
// Web se edituje v GrapesJS, tedy do tabulky `web_pages`. Instanční seed
// `01_web.sql` ale při KAŽDÉM nasazení `core` dělá:
//
//     ON CONFLICT (branding_profile_id, slug) DO UPDATE SET
//       canvas_data = EXCLUDED.canvas_data,
//       canvas_html = EXCLUDED.canvas_html,
//       canvas_css  = EXCLUDED.canvas_css,
//
// Co tedy v editoru vznikne, žije jen do dalšího nasazení. Cesta zpátky do
// gitu neexistuje: `export-web-seed` čte DESIGNOVOU SLOŽKU, ne databázi.
//
// Tenhle skript tu ztrátu neodstraní — ale UDĚLÁ JI VIDITELNOU dřív, než
// nastane. Řekne, které stránky se v databázi liší od seedu, tedy co přesně
// příští nasazení zahodí.
//
// Použití:
//   node scripts/web/platno-vs-seed.mjs --seed=<cesta/01_web.sql> --ssh=<host> --db=<vzor jména>
//   node scripts/web/platno-vs-seed.mjs --seed=<cesta> --dump=<soubor.json>
//
// `--dump` bere JSON [{slug, canvas_html, canvas_css}] — pro běh tam, kde
// ssh není (CI, jiný stroj).
//
// Návratový kód: 0 = souhlasí, 1 = ROZEŠLY SE, 2 = chyba běhu.
// =============================================================================
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const arg = (n) => {
  const p = process.argv.slice(2).find((a) => a.startsWith(`${n}=`));
  return p ? p.slice(n.length + 1) : null;
};
const konec = (kod, zprava) => {
  process.stderr.write(`${zprava}\n`);
  process.exit(kod);
};

const SEED = arg("--seed");
const DUMP = arg("--dump");
const SSH = arg("--ssh");
const DB = arg("--db");

if (!SEED) konec(2, "chybí --seed=<cesta k 01_web.sql>");
if (!existsSync(SEED)) konec(2, `seed neexistuje: ${SEED}`);
if (!DUMP && !(SSH && DB)) konec(2, "chybí zdroj dat: buď --dump=<json>, nebo --ssh=<host> --db=<vzor jména kontejneru>");

// ── 1. Co by seed zapsal ─────────────────────────────────────────────────────
// Bloky dolarových uvozovek v pořadí canvas_data, canvas_html, canvas_css.
// Čte se TENTÝŽ text, který se pouští do databáze — ne jeho přepis.
function zeSeedu(text) {
  const out = new Map();
  // ⛔ SEED NEMÁ JEDEN TVAR, MÁ DVA (naměřeno 2026-09-01, po dvou špatných
  // parserech). Většina stránek nenese `canvas_css` doslova — bere ho ODKAZEM:
  //
  //     , (SELECT w.canvas_css FROM public.web_pages w WHERE w.slug = 'index' …)
  //
  // Doslova ho mají jen `index`, `nav` a `footer`. Parser, který slepě čekal
  // tři dolarové bloky, proto devět stránek z dvanácti zahodil a u zbylých
  // spároval délky napříč poli (`css 26150B → 4178B`).
  //
  // Čte se tedy: dva bloky = data + html, CSS se dědí z `index`; tři bloky =
  // data + html + vlastní CSS.
  const bloky = text.split("INSERT INTO public.web_pages").slice(1);
  const surove = [];
  for (const b of bloky) {
    const slug = /VALUES \('([a-z0-9-]+)'/.exec(b)?.[1];
    if (!slug) continue;
    const casti = [];
    let zbytek = b;
    while (casti.length < 3) {
      const m = /\$(wpx*)\$/.exec(zbytek);
      if (!m) break;
      const tag = `$${m[1]}$`;
      const od = m.index + tag.length;
      const konec = zbytek.indexOf(tag, od);
      if (konec < 0) break;
      casti.push(zbytek.slice(od, konec));
      zbytek = zbytek.slice(konec + tag.length);
    }
    if (casti.length < 2) continue;
    surove.push({ slug, data: casti[0], html: casti[1], css: casti.length >= 3 ? casti[2] : null });
  }
  const spolecneCss = surove.find((r) => r.slug === "index")?.css ?? null;
  for (const r of surove) out.set(r.slug, { data: r.data, html: r.html, css: r.css ?? spolecneCss ?? "" });
  return out;
}

// ── 2. Co je v databázi ──────────────────────────────────────────────────────
function zDatabaze() {
  if (DUMP) return JSON.parse(readFileSync(DUMP, "utf-8"));
  const sql =
    "select json_agg(json_build_object('slug',slug,'canvas_data',canvas_data::text,'canvas_html',canvas_html,'canvas_css',canvas_css)) " +
    "from public.web_pages;";
  // ⛔ JMÉNO KONTEJNERU SE HLEDÁ, NEZADÁVÁ. Coolify k němu lepí časové
  // razítko nasazení (`db-<uuid>-091616522798`), takže zapsané jméno přežije
  // přesně do dalšího deploye. `--db` je proto VZOR, ne přesné jméno —
  // pravé se dohledá až na místě. Naměřeno 2026-09-01: první verze měla
  // jméno opsané a rozbila se hodinu po napsání.
  const raw = execFileSync(
    "ssh",
    [
      "-o",
      "ConnectTimeout=15",
      SSH,
      `C=$(docker ps --format '{{.Names}}' | grep -m1 ${JSON.stringify(DB)}) && ` +
        `test -n "$C" && docker exec "$C" psql -U postgres -d postgres -t -A -c ${JSON.stringify(sql)}`,
    ],
    { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 },
  );
  const t = raw.trim();
  if (!t || t === "null") konec(2, `databáze nevrátila žádné stránky — sedí vzor --db=${DB} na běžící kontejner?`);
  return JSON.parse(t);
}

const seed = zeSeedu(readFileSync(SEED, "utf-8"));
if (seed.size === 0) konec(2, "v seedu se nenašla ani jedna stránka — změnil se tvar INSERTu?");

const db = new Map(
  // ⛔ CHYBĚJÍCÍ POLE NENÍ PRÁZDNÉ POLE. `undefined` znamená „dump to
  // nenesl", `null`/`""` znamená „v databázi je prázdné". První verze je
  // slila do `?? ""` a z dumpu bez `canvas_css` udělala DVANÁCT nálezů
  // `css 0B → 26150B` — tedy obvinění celého webu z chybějících dat.
  // Táž třída jako ranní `souboru_nezmereno`: neúplné měření není nález.
  zDatabaze().map((r) => [
    r.slug,
    {
      css: r.canvas_css === undefined ? undefined : (r.canvas_css ?? ""),
      data: r.canvas_data === undefined ? undefined : (r.canvas_data ?? ""),
      html: r.canvas_html === undefined ? undefined : (r.canvas_html ?? ""),
    },
  ]),
);

// ── 3. Porovnání ─────────────────────────────────────────────────────────────
const rozdily = [];
const nezmereno = new Set();
for (const [slug, s] of seed) {
  const d = db.get(slug);
  if (!d) {
    rozdily.push({ slug, co: "v databázi NENÍ (nasazení ji vytvoří)" });
    continue;
  }
  const zmeny = [];
  // ⛔ POROVNÁVAJÍ SE VŠECHNA TŘI POLE, KTERÁ SEED PŘEPISUJE. První verze
  // hlídala jen html a css — a kanárek s podvrhem do `canvas_data` prošel
  // jako „souhlasí". Editor přitom ukládá právě do `canvas_data`, takže
  // detektor by mlčel u toho, co se ztrácí nejčastěji.
  //
  // `canvas_data` je JSON: porovnává se PO ROZPARSOVÁNÍ, aby rozdíl v pořadí
  // klíčů nebo v mezerách nedělal falešný nález.
  // ⛔ `jsonb` KLÍČE PŘEROVNÁVÁ. Databáze vrací `canvas_data::text` v SVÉM
  // pořadí a bez mezer, seed v pořadí autorově — prosté `JSON.stringify`
  // nad rozparsovaným objektem pořadí zachová, takže hlásilo rozdíl
  // i u stránek, kterých se nikdo nedotkl (`features 4476B → 4476B`:
  // stejná délka, jiné pořadí). Porovnávat se proto musí KANONICKY:
  // klíče seřazené, rekurzivně.
  const kanonicky = (v) => {
    if (Array.isArray(v)) return v.map(kanonicky);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.keys(v)
          .sort()
          .map((k) => [k, kanonicky(v[k])]),
      );
    }
    return v;
  };
  const stejnyJson = (a, b) => {
    try {
      return JSON.stringify(kanonicky(JSON.parse(a))) === JSON.stringify(kanonicky(JSON.parse(b)));
    } catch {
      return a === b; // nerozparsovatelné se porovná doslova, ne prohlásí za shodné
    }
  };
  if (d.data !== undefined && !stejnyJson(d.data, s.data))
    zmeny.push(`data ${d.data.length}B → ${s.data.length}B`);
  if (d.html !== undefined && d.html !== s.html)
    zmeny.push(`html ${d.html.length}B → ${s.html.length}B`);
  if (d.css !== undefined && d.css !== s.css)
    zmeny.push(`css ${d.css.length}B → ${s.css.length}B`);
  for (const pole of ["data", "html", "css"]) if (d[pole] === undefined) nezmereno.add(pole);
  if (zmeny.length) rozdily.push({ slug, co: zmeny.join(", ") });
}
for (const slug of db.keys()) {
  if (!seed.has(slug)) rozdily.push({ slug, co: "v seedu NENÍ — nasazení ji nechá být" });
}

process.stdout.write(`stránek v seedu ${seed.size} · v databázi ${db.size}\n`);
if (nezmereno.size)
  process.stdout.write(
    `⚠ NEZMĚŘENO: zdroj nenesl ${[...nezmereno].join(", ")} — o těch polích tenhle běh NIC neříká\n`,
  );
process.stdout.write("\n");
if (rozdily.length === 0) {
  process.stdout.write("✓ seed a databáze souhlasí — nasazení nic nepřepíše\n");
  process.exit(0);
}
process.stdout.write("⚠ ROZEŠLY SE. Příští nasazení přepíše databázi seedem:\n\n");
for (const r of rozdily) process.stdout.write(`  ${r.slug.padEnd(24)} ${r.co}\n`);
process.stdout.write(
  "\nCo s tím: buď změny z editoru přenes do seedu (a commitni), nebo je\n" +
    "vědomě zahoď. Cesta zpět z databáze do seedu zatím NEEXISTUJE — dokud\n" +
    "nevznikne, je editor náhled, ne nástroj.\n",
);
process.exit(1);
