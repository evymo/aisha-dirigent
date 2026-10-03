/**
 * Pojistky vazby účtu se nesmí dát smazat jako „duplicity".
 *
 * ⛔ PROČ TAHLE BRÁNA VZNIKLA (2026-09-10). Napsal jsem do dokumentace poznámku
 * „kdo bude indexy uklízet, nesmí ty dva užší smazat" — a majitel na to řekl,
 * že v tom vidí díru. Měl pravdu: pravidlo, které drží KOMENTÁŘ, není pravidlo.
 * Kdokoli ty indexy odstraní, žádný test nespadne a nikdo se to nedozví.
 *
 * ⛔ CO SE STANE, KDYŽ ZMIZÍ. Vazba `ref_kind='account'` rozhoduje o tom, co
 * člověk vidí (`workflow_step_visible_to` → `my_twins`). Bez těch pojistek se
 * na jeden účet naváže víc twinů nebo na jeden twin víc účtů — a projeví se to
 * tím, že je vidět VÍC. To nenahlásí nikdo: chybějící přístup uživatel oznámí
 * do minuty, přebývající ne.
 *
 * ⭐ MĚŘÍ SE TŘI VĚCI, PROTOŽE KAŽDÁ MŮŽE ZMIZET SAMA:
 *   1. soubor indexu existuje,
 *   2. je zapojený v `heals.sql` (jinak se na živou databázi nedostane),
 *   3. tvar klíče je ten PŘÍSNĚJŠÍ — samotná existence souboru nestačí,
 *      protože „úklid" může znamenat i přidání `source` zpátky do klíče.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const KOREN = join(__dirname, "..", "..", "..");
const HEALS = readFileSync(join(KOREN, "aisha/db/heals.sql"), "utf8");

/** Index → tvar klíče, který MUSÍ mít. Volnější klíč = slabší podmínka. */
const POJISTKY = [
  {
    jmeno: "uq_twin_external_refs_active_account",
    klic: /\(\s*source_key\s*\)/,
    proc: "jeden účet = nejvýš jeden aktivní twin; `source` v klíči BÝT NESMÍ, protože ho čtenář ignoruje",
  },
  {
    jmeno: "uq_twin_external_refs_active_account_twin",
    klic: /\(\s*twin_id\s*\)/,
    proc: "jeden twin = nejvýš jeden aktivní účet",
  },
];

describe("pojistky vazby účtu", () => {
  it("⛔ oba užší indexy existují, jsou v heals a mají PŘÍSNÝ klíč", () => {
    const chybi: string[] = [];

    for (const p of POJISTKY) {
      const cesta = join(KOREN, "aisha/db/sql/indexes", `${p.jmeno}.sql`);
      if (!existsSync(cesta)) {
        chybi.push(`${p.jmeno}: soubor indexu zmizel — ${p.proc}`);
        continue;
      }
      const sql = readFileSync(cesta, "utf8");

      if (!new RegExp(`\\\\ir\\s+sql/indexes/${p.jmeno}\\.sql`).test(HEALS))
        chybi.push(`${p.jmeno}: není v heals.sql — na živou databázi se nedostane`);

      // Klíč = to, co je v závorce hned za `ON public.twin_external_refs`.
      const zaTabulkou = sql.split(/ON\s+public\.twin_external_refs/i)[1] ?? "";
      const klic = zaTabulkou.slice(0, zaTabulkou.indexOf(")") + 1);
      if (!p.klic.test(klic))
        chybi.push(`${p.jmeno}: klíč je \`${klic.trim()}\`, čeká se přísnější — ${p.proc}`);

      if (!/ref_kind\s*=\s*'account'/.test(sql) || !/state\s*=\s*'confirmed'/.test(sql) ||
          !/valid_to\s+IS\s+NULL/i.test(sql))
        chybi.push(`${p.jmeno}: podmínka indexu neomezuje na potvrzenou a platnou vazbu účtu`);
    }

    expect(chybi).toEqual([]);
  });

  it("⛔ u vazby účtu smí být jediný `source` — jinak indexy jen zakrývají rozpor", () => {
    // Model obecně říká „source rozlišuje", čtenář `workflow_step_visible_to`
    // ho ale nečte. Bez tohohle CHECKu je to nejednoznačnost, kterou pojistky
    // jen maskují; s ním ji nejde ani vyrobit.
    // ⛔ MUSÍ BÝT NA OBOU MÍSTECH a je to naměřený nález, ne opatrnost:
    // první verze téhle brány hledala ten vzor v celém souboru a prošla by
    // i tehdy, kdyby zbyl jen jeden výskyt. Přitom `CREATE TABLE` platí JEN
    // pro cold start a `ALTER` JEN pro už existující databázi — chybějící
    // půlka znamená, že jedna z těch dvou cest ochranu nemá.
    const tabulka = readFileSync(join(KOREN, "aisha/db/sql/tables/twin_external_refs.sql"), "utf8");
    const podminka = /ref_kind\s*<>\s*'account'\s+OR\s+source\s*=\s*'aisha_auth'/;
    const vCreate = tabulka.slice(0, tabulka.indexOf(");"));
    const zaCreate = tabulka.slice(tabulka.indexOf(");"));

    const chybi: string[] = [];
    if (!podminka.test(vCreate))
      chybi.push("CHECK chybí v `CREATE TABLE` — čistá databáze by ochranu neměla");
    if (!(podminka.test(zaCreate) && /ADD\s+CONSTRAINT\s+twin_external_refs_account_source/i.test(zaCreate)))
      chybi.push("chybí idempotentní `ADD CONSTRAINT` — na EXISTUJÍCÍ databázi se CHECK nikdy nepřidá");
    expect(chybi).toEqual([]);
  });

  it("⛔ čtenář `source` NEČTE — kdyby začal, pojistky je nutné přepočítat", () => {
    // Kotva na tvrzení, o které se ty indexy opírají. Kdyby někdo do predikátu
    // `source` doplnil, přestane platit důvod, proč je klíč jen `source_key` —
    // a tenhle test má tu změnu zastavit, aby se to probralo, ne prošlo.
    const rozhodovac = readFileSync(
      join(KOREN, "aisha/db/sql/functions/workflow_step_visible_to.sql"), "utf8");
    const usek = rozhodovac.slice(rozhodovac.indexOf("ref_kind"));
    const chybi = /\br\.source\b|\bsource\s*=/.test(usek.slice(0, 400))
      ? ["`workflow_step_visible_to` začal číst `source` — přepočítej klíče obou pojistek"]
      : [];
    expect(chybi).toEqual([]);
  });
});
