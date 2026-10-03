/**
 * Brána: klikatelný řádek musí říct, CO JE.
 *
 * PROČ (naměřeno na produkci 2026-08-07)
 * --------------------------------------
 * Shell udělá řádek tabulky klikatelným právě tehdy, když nese sloupec `id`
 * (`blocks.tsx:Table`). Dokud k tomu nepatřil žádný DRUH, měl shell pro `id`
 * jediný význam — „dokument" — a `App.tsx` posílal každé `id` čtečce dokladů.
 *
 * Řádek dlužníka přitom nese IČO. Klik tedy vedl na
 * `get_document_detail(doc_slug='26683911')`, což vrátilo
 * `{record_id: null, fields: []}` — tedy PRÁZDNOU KARTU, ne chybu. Uživatel
 * vidí „ten dlužník nemá nic", i když má 92 faktur. Tiché prázdno je horší než
 * pád: pádu si někdo všimne.
 *
 * CO SE MĚŘÍ
 * ----------
 * Univerzum se seeduje ZE ZDROJE (SQL funkce na disku), ne z ručního výčtu —
 * výčet by zdědil díry svého autora a rozešel se při první nové čtečce.
 * Čtečka je „tabulková", když vydává `columns` i `rows`; když její řádky navíc
 * nesou `id`, MUSÍ vydat i `row_kind`.
 *
 * Druh vydává RPC schválně: jedině ona ví, co do `id` dala. Kdyby ho dopisoval
 * shell podle jména bloku, byla by to zase domněnka — jen o patro výš.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(__dirname, "../../..");
const FN_DIR = resolve(ROOT, "aisha/db/sql/functions");

/** Čtečky, které vydávají tvar tabulkového bloku (`columns` + `rows`). */
function tableReaders(): Array<{ file: string; text: string }> {
  return readdirSync(FN_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => ({ file: f, text: readFileSync(join(FN_DIR, f), "utf8") }))
    .filter(({ text }) => /'columns'\s*,/.test(text) && /'rows'\s*,/.test(text));
}

/**
 * Nese řádek `id`? Hledá se `'id',` uvnitř jsonb_build_object — tedy klíč,
 * který shell čte jako `rows[i].id`. Komentáře se odstraňují, aby zmínka
 * v poznámce nedělala nález (týž pár měřidlo/komentář, na kterém už jedna
 * brána zčervenala kvůli vzorku ve vysvětlivce).
 */
function emitsRowId(text: string): boolean {
  const code = text.replace(/^\s*--.*$/gm, "");
  return /'id'\s*,/.test(code);
}

function declaresRowKind(text: string): boolean {
  return /'row_kind'\s*,/.test(text.replace(/^\s*--.*$/gm, ""));
}

describe("brána: klikatelný řádek nese DRUH", () => {
  it("univerzum není prázdné (jinak brána nic neměří)", () => {
    expect(tableReaders().length).toBeGreaterThan(0);
  });

  it("každá tabulková čtečka s `id` v řádku vydává i `row_kind`", () => {
    const offenders = tableReaders()
      .filter(({ text }) => emitsRowId(text) && !declaresRowKind(text))
      .map(({ file }) => file);

    expect(
      offenders,
      "Tyhle čtečky dělají řádek klikatelným (nesou `id`), ale neříkají, na CO " +
        "ukazuje. Shell pak spadne na výchozí druh 'document' a u jiného než " +
        "dokladu vydá PRÁZDNOU kartu místo chyby. Doplň do `data` klíč " +
        "`'row_kind', '<druh>'` — a druh, který shell nezná, deklaruj instanci " +
        "ve `workbench.detail_by_kind`:\n  " + offenders.join("\n  "),
    ).toEqual([]);
  });

  it("dlužníci ukazují na odběratele, ne na doklad", () => {
    // Konkrétní vada, kvůli které brána vznikla. Obecné tvrzení výš by prošlo
    // i s druhem 'document' — a to je přesně ten stav, který uživatel viděl.
    const text = readFileSync(join(FN_DIR, "get_receivables_overdue.sql"), "utf8");
    expect(text).toMatch(/'row_kind'\s*,\s*'counterparty'/);
  });

  it("shell druh NEHÁDÁ — čte ho z dat a rozcestník bere z instance", () => {
    const app = readFileSync(resolve(ROOT, "apps/workbench-shell/src/App.tsx"), "utf8");
    const blocks = readFileSync(
      resolve(ROOT, "apps/workbench-shell/src/components/blocks.tsx"),
      "utf8",
    );
    expect(blocks).toMatch(/block\.data\.row_kind\s*\?\?\s*'document'/);
    expect(app).toMatch(/detail_by_kind\?\.\[kind\]/);
    // Žádné jméno druhu zadrátované do větvení — to by byl podnikový pojem
    // v generickém shellu.
    expect(app).not.toMatch(/kind\s*===\s*'counterparty'/);
  });
});
