#!/usr/bin/env node
/**
 * Cache zelených stromů pro pre-push (logika: scripts/lib/ci-zelene.mjs).
 *
 *   node scripts/ci-zelene.mjs --over  --beh <id>   exit 0 = HIT (sadu přeskočit), 1 = MISS (pustit)
 *   node scripts/ci-zelene.mjs --zapis --beh <id>   po CELÉ zelené sadě: zapíše, jen když se klíč
 *                                                   od --over nezměnil
 *   node scripts/ci-zelene.mjs --stav               co je v cache (pro člověka)
 *
 * AISHA_CI_ZNOVU=1 → --over vždy MISS (vynucený běh). Serverová CI se nemění.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { klic, najdi, souhrnDeniku, ulozStart, uklid, vychoziUloziste, zapisDenik, zapisKonec, zmerVstupy } from "./lib/ci-zelene.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ZNAME_PREPINACE = new Set(["--over", "--zapis", "--stav", "--beh", "--rezim", "--help", "-h"]);
const S_HODNOTOU = new Set(["--beh", "--rezim"]);
const argv = process.argv.slice(2);
const POUZITI = "použití: node scripts/ci-zelene.mjs --over --beh <id> | --zapis --beh <id> --rezim <vse|vyber> | --stav";

const nezname = argv.filter((a, i) => a.startsWith("-") && !ZNAME_PREPINACE.has(a) && !S_HODNOTOU.has(argv[i - 1]));
if (nezname.length) {
  console.error(`ci-zelene: neznámý přepínač: ${nezname.join(" ")}\n${POUZITI}`);
  process.exit(2);
}
if (argv.includes("--help") || argv.includes("-h")) { console.log(POUZITI); process.exit(0); }

const DIR = vychoziUloziste();
const behI = argv.indexOf("--beh");
const beh = behI >= 0 ? argv[behI + 1] : undefined;
const rezimI = argv.indexOf("--rezim");
const rezim = rezimI >= 0 ? argv[rezimI + 1] : undefined;
const kratky = (h) => String(h).slice(0, 10);

if (argv.includes("--stav")) {
  if (!existsSync(DIR)) { console.log("cache zelených stromů je prázdná"); process.exit(0); }
  const s = souhrnDeniku(DIR);
  console.log(`deník: ${s.hit}× přeskočeno (ušetřeno ${Math.round(s.usporaS / 60)} min sady), ${s.miss}× běh, ${s.zapis}× zapsáno`);
  for (const [d, c] of Object.entries(s.duvody)) console.log(`  MISS ${c}× — ${d}`);
  for (const n of readdirSync(DIR).filter((x) => x.endsWith(".json") && !x.startsWith("beh-"))) {
    try {
      const z = JSON.parse(readFileSync(join(DIR, n), "utf8"));
      console.log(`${new Date(z.zapsano).toISOString()}  strom ${kratky(z.casti.strom)}  ${z.casti.node}  deps ${kratky(z.casti.deps)}  dist ${kratky(z.casti.dist)}  (${z.trvani_s ?? "?"} s)`);
    } catch (e) {
      console.log(`${n}  (nečitelný záznam: ${e.message})`);
    }
  }
  process.exit(0);
}

if (!beh) { console.error(`ci-zelene: chybí --beh <id>\n${POUZITI}`); process.exit(2); }

if (argv.includes("--over")) {
  uklid(DIR);
  if (process.env.AISHA_CI_ZNOVU === "1") {
    console.log("  > Cache zelených stromů: AISHA_CI_ZNOVU=1 — vynucený běh celé sady.");
    zapisDenik(DIR, { udalost: "vynuceny-beh", beh });
    process.exit(1);
  }
  const v = await zmerVstupy(ROOT);
  const k = klic(v);
  const r = najdi(DIR, k);
  if (r.hit) {
    const z = r.zaznam;
    const kdy = new Date(z.zapsano).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
    console.log(`OK Pre-push: strom ${kratky(v.strom)} prošel CELOU sadou v ${kdy} (node ${v.node}, deps ${kratky(v.deps)}, dist ${kratky(v.dist)}) — PŘESKOČENO.`);
    console.log("   Tentýž vstup, tentýž výsledek. Vynutit běh: AISHA_CI_ZNOVU=1 git push …  (serverová CI běží dál)");
    zapisDenik(DIR, { udalost: "cache-hit", strom: v.strom, uspora_s: z.trvani_s ?? null, beh });
    process.exit(0);
  }
  console.log(`  > Cache zelených stromů: MISS — ${r.duvod}.`);
  zapisDenik(DIR, { udalost: "cache-miss", strom: v.strom, duvod: r.duvod, beh });
  ulozStart(DIR, beh, k);
  process.exit(1);
}

if (argv.includes("--zapis")) {
  const v = await zmerVstupy(ROOT);
  const r = zapisKonec(DIR, beh, klic(v), { meta: { node: v.node }, rezim });
  zapisDenik(DIR, r.zapsano ? { udalost: "cache-zapis", strom: v.strom, beh } : { udalost: "nezapsano", strom: v.strom, duvod: r.duvod, beh });
  console.log(r.zapsano
    ? `  > Cache zelených stromů: strom ${kratky(v.strom)} zapsán (platí 24 h).`
    : `  > Cache zelených stromů: nezapsáno — ${r.duvod}.`);
  process.exit(0);
}

console.error(`ci-zelene: chybí --over | --zapis | --stav\n${POUZITI}`);
process.exit(2);
