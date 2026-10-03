/**
 * Nezpracovatelný balíček nesmí zastavit frontu (CLASS gate)
 *
 * TŘÍDA VADY: jedna odpověď na dva různé druhy poruchy. Držet kurzor je
 * SPRÁVNĚ, když porucha pomine sama (spadlá databáze, utržené spojení) — jinak
 * by ve frontě vznikla mezera. Je to ŠPATNĚ, když se porucha bez rozhodnutí
 * člověka nespraví: pak fronta stojí na něčem, co sama vyřešit nemůže.
 *
 * ⛔ NAMĚŘENO 2026-08-30 na produkci: balíček, jehož zdroj nebyl aktivní,
 * zablokoval zbylých pět. Driver ho půl hodiny zkoušel dokola, kurzor držel
 * a 5 balíčků čekalo na governance rozhodnutí, které s nimi nesouviselo.
 *
 * ⭐ KARANTÉNA JE EVIDENCE, NE ZAPOMNĚNÍ. Kurzor je VODOZNAK — co je pod ním,
 * se znovu nenabídne. Pouhé přeskočení by balíček ztratilo navždy. Karanténa
 * ho drží JMENOVITĚ a výběr ji sjednocuje s tím, co je nad kurzorem, takže
 * jakmile člověk zdroj aktivuje, balíček projde sám a vypadne z ní.
 *
 * ⭐ ROZLIŠUJE SE TYPEM, ne textem hlášky (`ZdrojNeniAktivni`). Text se změní
 * při první úpravě formulace; vlastnost ne.
 *
 * Spousti se pres: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..");
const DRIVER = join(ROOT, "services", "svc-source-broker", "src", "clients", "li-driver.ts");

describe("karanténa nezastaví frontu", () => {
  const src = readFileSync(DRIVER, "utf8");
  /** Blok `catch` ve smyčce nad balíčky — tam se rozhoduje držet vs. odložit. */
  const smycka = (() => {
    const i = src.indexOf("      for (const bundle of bundles) {");
    return i < 0 ? "" : src.slice(i, src.indexOf("const finishedAt = new Date();", i));
  })();

  test("smyčka nad balíčky se vůbec našla", () => {
    expect(smycka.length, "kotva na smyčku selhala — zbytek brány by měřil prázdno").toBeGreaterThan(200);
  });

  test("0. kontext je PODMÍNKA, ne pruh — jinak běží pruhy pro balíček, co nemůže dosednout", () => {
    // ⛔ Naměřeno na produkci 2026-08-30, dva následky jedné záměny:
    //  · z NEAUTORIZOVANÉHO zdroje dosedlo 854 vazeb a 615 návrhů entit,
    //  · pruh vektorů 70 minut přepisoval 40 tisíc řádků balíčku, který
    //    dosednout nemohl — tik nedoběhl a karanténa se nedostala ke slovu.
    expect(
      src,
      "Kontext se musí resolvovat PŘED prvním pruhem, ne jako `pruh('story')`.",
    ).toMatch(/const storyId: string = await resolveSourceStory\(/);
    // ⛔ Hledá se VOLÁNÍ, ne zmínka. `pruh('story')` stojí i v komentáři, který
    // tu záměnu popisuje — bez `await` se na něj volný výraz chytil a brána
    // padala i ve zdravém stavu (naměřeno mutací tentýž den).
    expect(
      /await pruh\('story'/.test(src),
      "Kontext zpátky jako pruh: izolace pruhů by ho oddělila od pruhů, které\n" +
        "na něm ZÁVISÍ, a balíček by zas dosedal po částech.",
    ).toBe(false);
  });

  test("1. trvalá příčina se rozlišuje TYPEM, ne textem hlášky", () => {
    expect(src).toMatch(/class ZdrojNeniAktivni extends Error/);
    expect(
      src,
      "Rozlišení podle textu hlášky se rozpadne při první úpravě formulace.",
    ).toMatch(/instanceof ZdrojNeniAktivni/);
  });

  test("2. trvalá příčina frontu NEZASTAVÍ — pokračuje se dál", () => {
    // ⛔ VZOR PŘIPÍNAL JMÉNO PROMĚNNÉ. Do 2026-09-02 tu stálo `/trvala…continue;/`,
    // tedy shoda na identifikátoru `const trvala = …`. Když se pravidlo vytáhlo do
    // pojmenované funkce `jeTrvalaPricina()` — aby šlo změřit samostatně —, brána
    // zčervenala, ač její TVRZENÍ platilo beze změny: `continue` ve větvi je.
    //
    // Vzor se proto váže na ROZHODNUTÍ (volání pravidla), ne na to, jak se
    // zrovna jmenuje mezivýsledek. Refaktor nesmí být k nerozeznání od regrese.
    expect(
      smycka,
      "Ve smyčce chybí `continue` pro trvalou příčinu; balíček by frontu blokoval dál.",
    ).toMatch(/jeTrvalaPricina\([\s\S]{0,900}?continue;/);
  });

  test("3. přechodná porucha kurzor DRŽÍ — jinak vznikne mezera", () => {
    expect(
      smycka,
      "Bez `break` u ostatních poruch by se přeskočil balíček, který by po\n" +
        "chvíli prošel — a ve frontě by zůstala díra.",
    ).toMatch(/break;/);
  });

  test("4. karanténa je EVIDENCE — balíček se do ní zapíše jmenovitě", () => {
    expect(smycka).toMatch(/karantena\.add\(bundle\.manifest\.export_id\)/);
  });

  test("5. karanténa se sjednocuje s výběrem — jinak zmizí pod kurzorem", () => {
    expect(
      src,
      "Kurzor je vodoznak. Bez sjednocení by se odložený balíček po prvním\n" +
        "úspěchu dostal pod něj a už se NIKDY nenabídl — ani po aktivaci zdroje.",
    ).toMatch(/karantena\.has\(b\.manifest\.export_id\)/);
  });

  test("6. úspěch z karantény VYNDÁ — jinak by v ní zůstal navždy", () => {
    expect(smycka).toMatch(/karantena\.delete\(bundle\.manifest\.export_id\)/);
  });

  test("7. karanténa PŘEŽIJE restart — ukládá se do stavu", () => {
    // ⛔ Kotva musí sedět na UKLÁDÁNÍ, ne kdekoli. `karantena: result.karantena`
    // je v souboru dvakrát — podruhé v logovací hlášce — takže volný výraz
    // prošel i po odstranění persistence (naměřeno mutací 2026-08-30).
    // Vážeme se proto na sousedství s `last_export_id`, což je metadata blok.
    expect(
      src,
      "Bez uložení by se po restartu brokera odložený balíček ztratil pod kurzorem.",
    ).toMatch(/last_export_id: result\.cursorExportId,[\s\S]{0,400}?karantena: result\.karantena,/);
  });
});
