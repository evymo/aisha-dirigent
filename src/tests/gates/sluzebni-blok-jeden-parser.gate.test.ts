/**
 * Brána: blok služby se čte JEDNÍM parserem, ne šesti regexy.
 *
 * ── PROČ ──────────────────────────────────────────────────────────────────────
 * Brány, které se ptají na TEXT služby (má healthcheck? jaké nese env? je tam
 * `restart: "no"`?), si každá nesla vlastní extraktor. Naměřeno 2026-09-03:
 * šest kopií, každá jinak — řádkový sken s hloubkou, řádkový sken bez ní,
 * `serviceBlocks()` nad všemi službami, a `indexOf("<jméno>:")`.
 *
 * Ta poslední najde jméno kdekoli: v komentáři, v hodnotě proměnné, uvnitř
 * jména cizí služby, které to naše obsahuje jako podřetězec. A všechny sdílejí
 * druhou vadu: komentář NAD službou B se počítá do bloku A, protože blok končí
 * až na dalším klíči — próza tedy mění verdikt brány. Táž třída, kterou dnes
 * musely opravit tři jiné brány (xss-client-storage, auth-security,
 * owasp-discovery).
 *
 * `sluzebniBlok()` v `lib/vnitrni-adresa.ts` se ptá PARSERU, kde služba začíná,
 * a text řeže podle odsazení — brány potřebují původní zápis (`${VAR}`,
 * uvozovky, víceřádkové příkazy), takže strom sám nestačí.
 *
 * ── CO MĚŘÍ ───────────────────────────────────────────────────────────────────
 * 1. Chování sdíleného parseru na případech, kde se kopie rozcházejí.
 * 2. RÁČNU: počet vlastních extraktorů smí jen KLESAT. Nové kopie nesmí
 *    přibývat; migrace zbylých je práce navíc, ne podmínka téhle brány.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { sluzebniBlok } from "./lib/vnitrni-adresa";

const ROOT = process.cwd();
const BRANY = join(ROOT, "src/tests/gates");

/** Kolik bran si dodneška nese vlastní extraktor. Smí jen klesat. */
const RACNA_VLASTNICH_EXTRAKTORU = 6;

const UKAZKA = `services:
  alfa:
    image: alfa:1
    restart: "no"
    healthcheck:
      test: ["CMD", "true"]

  # Tenhle komentář patří BETĚ, ne alfě.
  # Druhý řádek téhož komentáře.
  beta:
    image: beta:1
    environment:
      POZNAMKA: "alfa: není služba, je to hodnota"

  alfa-druha:
    image: jina:1
`;

describe("blok služby se čte jedním parserem", () => {
  test("vrátí jen řádky té služby", () => {
    const blok = sluzebniBlok(UKAZKA, "alfa");

    expect(blok).toContain("image: alfa:1");
    expect(blok).toContain('restart: "no"');
    expect(blok).toContain("healthcheck:");
  });

  // ⛔ TOHLE ROZHODLO. Řádkové skeny berou blok „až po další klíč", takže
  // komentář nad další službou spadne do té předchozí — a brána, která hledá
  // v textu služby nějaký řetězec, ho najde v cizí próze.
  test("komentář nad NÁSLEDUJÍCÍ službou do bloku nepatří", () => {
    const blok = sluzebniBlok(UKAZKA, "alfa");

    expect(blok).not.toContain("patří BETĚ");
    expect(blok).not.toContain("Druhý řádek");
  });

  // ⛔ `indexOf("alfa:")` trefí hodnotu proměnné v cizí službě.
  test("jméno v HODNOTĚ cizí služby není začátek bloku", () => {
    const blok = sluzebniBlok(UKAZKA, "beta");

    expect(blok).toContain("image: beta:1");
    expect(blok).toContain('POZNAMKA: "alfa: není služba, je to hodnota"');
  });

  // ⛔ `indexOf` na `alfa:` trefí i `alfa-druha:`? Ne — ale opačně ano:
  // hledání `alfa` jako prefixu by `alfa-druha` spolklo. Kotvení na celý
  // klíč to vylučuje.
  test("služba, jejíž jméno je prefixem jiné, se nesplete", () => {
    const blok = sluzebniBlok(UKAZKA, "alfa-druha");

    expect(blok).toContain("image: jina:1");
    expect(blok).not.toContain("healthcheck");
  });

  test("neexistující služba vrací null, ne prázdný řetězec", () => {
    expect(sluzebniBlok(UKAZKA, "neni-tam")).toBeNull();
  });

  test("ráčna: vlastních extraktorů smí jen ubývat", () => {
    const vlastni = readdirSync(BRANY)
      .filter((f) => f.endsWith(".gate.test.ts"))
      .filter((f) => {
        const text = readFileSync(join(BRANY, f), "utf-8");
        return /function\s+(extractServiceBlock|serviceBlocks|serviceBlock)\b/.test(text);
      });

    expect(
      vlastni.length,
      `Vlastních extraktorů bloku služby: ${vlastni.length} (ráčna ${RACNA_VLASTNICH_EXTRAKTORU}):\n  ${vlastni.join("\n  ")}\n\n` +
        "CO S TÍM: nový extraktor nepiš — použij `sluzebniBlok()` z lib/vnitrni-adresa.\n" +
        "Když nějakou kopii zrušíš, SNIŽ i ráčnu, ať se nemůže vrátit.",
    ).toBeLessThanOrEqual(RACNA_VLASTNICH_EXTRAKTORU);
  });
});
