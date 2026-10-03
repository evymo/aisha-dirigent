#!/usr/bin/env node
// =============================================================================
// platno-do-seedu.mjs — uloží práci z editoru zpět do seedu
// =============================================================================
// ⛔ PROČ (naměřeno 2026-09-01).
//
// Web se edituje v GrapesJS, tedy do `web_pages`. Seed ale při každém nasazení
// `core` dělá `DO UPDATE SET canvas_data/html/css = EXCLUDED`, takže práci
// z editoru přepíše. Cesta zpátky neexistovala: `export-web-seed` čte
// DESIGNOVOU SLOŽKU, ne databázi.
//
// Tenhle skript tu smyčku uzavírá. Postup je pak:
//     upravit v GrapesJS → tenhle export → commit → nasazení je bezpečné.
//
// ⛔ PŘEPISUJE SE NA MÍSTĚ, NEGENERUJE SE ZNOVU. `01_web.sql` se od 2026-08-30
// udržuje RUČNĚ (viz jeho hlavička) a nese komentáře, překlady i značky, které
// by regenerace zahodila — přesně ta ztrátovost, kvůli které se `export-web-seed`
// vypnul. Nahrazují se proto jen bloky `canvas_data` a `canvas_html` uvnitř
// existujících INSERTů; vše ostatní zůstane bajt po bajtu stejné.
//
// ⛔ `canvas_css` SE NEPŘEPISUJE. Většina stránek ho nenese doslova, bere ho
// odkazem na `index`; přepsat ho u nich by ten sdílený tvar rozbil a seed by
// nafoukl dvanáctkrát. CSS se mění v seedu ručně — je to design, ne obsah.
//
// Použití:
//   node scripts/web/platno-do-seedu.mjs --seed=<cesta> --ssh=<host> --db=<vzor>
//   node scripts/web/platno-do-seedu.mjs --seed=<cesta> --dump=<json> --apply
//
// Bez `--apply` jen ukáže, co by se změnilo. Návratový kód 0 vždy, pokud
// nedošlo k chybě — tenhle nástroj nehodnotí, ukládá.
// =============================================================================
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { rozeberSeed, stejnyJson } from "./lib/seed-platno.mjs";

const arg = (n) => {

// ⛔ NEZNÁMÝ PŘEPÍNAČ JE STOP, NE VÝCHOZÍ CHOVÁNÍ. Tenhle nástroj ZAPISUJE.
// Kdyby překlep („--aply") jen propadl, běželo by chování, které nikdo nechtěl —
// a u zapisujícího nástroje je tiché spolknutí přepínače tichá škoda.
// Registr se drží U PARSOVÁNÍ, ne v dokumentaci: přepínač přidaný níž a sem
// nezapsaný tuhle stráž shodí na první použití.
const ZNAME_PREPINACE = new Set(["--apply", "--db", "--dump", "--seed", "--ssh", "--help", "-h"]);
{
  const nezname = process.argv
    .slice(2)
    .filter((a) => a.startsWith("-") && !ZNAME_PREPINACE.has(a.split("=")[0]));
  if (nezname.length) {
    console.error(`platno-do-seedu: neznámý přepínač: ${nezname.join(" ")}`);
    console.error("Použití: node scripts/web/platno-do-seedu.mjs --seed=<cesta> [--ssh=<host>|--dump=<json>] [--db=<vzor>] [--apply]");
    process.exit(2);
  }
}

  const p = process.argv.slice(2).find((a) => a.startsWith(`${n}=`));
  return p ? p.slice(n.length + 1) : null;
};
const konec = (kod, z) => {
  process.stderr.write(`${z}\n`);
  process.exit(kod);
};

const SEED = arg("--seed");
const DUMP = arg("--dump");
const SSH = arg("--ssh");
const DB = arg("--db");
const APPLY = process.argv.includes("--apply");

if (!SEED) konec(2, "chybí --seed=<cesta k 01_web.sql>");
if (!existsSync(SEED)) konec(2, `seed neexistuje: ${SEED}`);
if (!DUMP && !(SSH && DB)) konec(2, "chybí zdroj: --dump=<json> nebo --ssh=<host> --db=<vzor>");

function zDatabaze() {
  if (DUMP) return JSON.parse(readFileSync(DUMP, "utf-8"));
  const sql =
    "select json_agg(json_build_object('slug',slug,'canvas_data',canvas_data::text," +
    "'canvas_html',canvas_html)) from public.web_pages;";
  // Jméno kontejneru se HLEDÁ — Coolify k němu lepí razítko nasazení, takže
  // zapsané jméno přežije přesně do dalšího deploye.
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
  if (!t || t === "null") konec(2, `databáze nevrátila stránky — sedí vzor --db=${DB}?`);
  return JSON.parse(t);
}

const puvodni = readFileSync(SEED, "utf-8");
const seed = rozeberSeed(puvodni);
if (seed.size === 0) konec(2, "v seedu se nenašla ani jedna stránka — změnil se tvar INSERTu?");

const db = new Map(
  zDatabaze().map((r) => [r.slug, { data: r.canvas_data ?? "", html: r.canvas_html ?? "" }]),
);

// ── Co se změní ──────────────────────────────────────────────────────────────
const nahrady = [];
const preskoceno = [];
for (const [slug, s] of seed) {
  const d = db.get(slug);
  if (!d) {
    preskoceno.push(`${slug}: v databázi není`);
    continue;
  }
  const zmenaData = !stejnyJson(d.data, s.data);
  const zmenaHtml = d.html !== s.html;
  if (!zmenaData && !zmenaHtml) continue;

  // ⛔ ZNAČKA MUSÍ PŘEŽÍT OBSAH. Kdyby nový obsah obsahoval `$wp$`, uzavřel by
  // blok uprostřed a rozbil celý soubor. Značka se proto prodlužuje, dokud se
  // v obsahu nevyskytuje — týž postup jako v generátoru.
  const bezpecnaZnacka = (obsah) => {
    let t = "wp";
    while (obsah.includes(`$${t}$`)) t += "x";
    return `$${t}$`;
  };
  if (zmenaData) {
    const z = bezpecnaZnacka(d.data);
    nahrady.push({ konec: s.bloky[0].konec, obsah: d.data, slug, tag: z, zacatek: s.bloky[0].zacatek, puvodniTag: s.bloky[0].tag, co: "data" });
  }
  if (zmenaHtml) {
    const z = bezpecnaZnacka(d.html);
    nahrady.push({ konec: s.bloky[1].konec, obsah: d.html, slug, tag: z, zacatek: s.bloky[1].zacatek, puvodniTag: s.bloky[1].tag, co: "html" });
  }
}

if (nahrady.length === 0) {
  process.stdout.write(`stránek ${seed.size} · databáze a seed souhlasí — není co ukládat\n`);
  if (preskoceno.length) for (const p of preskoceno) process.stdout.write(`  přeskočeno ${p}\n`);
  process.exit(0);
}

process.stdout.write(`stránek ${seed.size} · ke změně ${nahrady.length} bloků\n\n`);
for (const n of nahrady) {
  const stara = s_delka(puvodni, n);
  process.stdout.write(`  ${n.slug.padEnd(24)} ${n.co} ${stara}B → ${n.obsah.length}B\n`);
}
function s_delka(text, n) {
  return n.konec - n.zacatek;
}
for (const p of preskoceno) process.stdout.write(`  přeskočeno ${p}\n`);

if (!APPLY) {
  process.stdout.write("\n▸ Zkušební běh. Spusť znovu s --apply pro zápis do seedu.\n");
  process.exit(0);
}

// ── Zápis: odzadu, aby si pozice navzájem neposunuly ─────────────────────────
let text = puvodni;
for (const n of [...nahrady].sort((a, b) => b.zacatek - a.zacatek)) {
  const predTagem = n.zacatek - n.puvodniTag.length;
  const zaTagem = n.konec + n.puvodniTag.length;
  text = text.slice(0, predTagem) + n.tag + n.obsah + n.tag + text.slice(zaTagem);
}
writeFileSync(SEED, text, "utf-8");

// ⛔ VERDIKT SE ČTE ZPĚTNĚ ZE SOUBORU, ne z toho, že zápis nespadl.
const kontrola = rozeberSeed(readFileSync(SEED, "utf-8"));
const zbyva = [...seed.keys()].filter((slug) => {
  const d = db.get(slug);
  const k = kontrola.get(slug);
  return d && k && (!stejnyJson(d.data, k.data) || d.html !== k.html);
});
if (kontrola.size !== seed.size) {
  konec(1, `✗ po zápisu se seed rozpadl: stránek ${kontrola.size} místo ${seed.size} — VRAŤ ZMĚNU`);
}
if (zbyva.length) konec(1, `✗ po zápisu se pořád liší: ${zbyva.join(", ")}`);
process.stdout.write(`\n✓ zapsáno do ${SEED} — ${nahrady.length} bloků, ${kontrola.size} stránek dál čitelných\n`);
process.stdout.write("  Zkontroluj `git diff` a commitni.\n");
