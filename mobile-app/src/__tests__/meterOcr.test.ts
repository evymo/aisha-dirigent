/**
 * Výběr hodnoty z toho, co OCR přečte na štítku měřidla.
 *
 * Tohle je jádro, které rozhoduje, co se člověku PŘEDVYPLNÍ — a proto se testuje
 * bez zařízení i bez ML Kitu: vstupem je text, výstupem číslo nebo nic.
 *
 * Nejdůležitější tvrzení není „umí přečíst číslo", ale **„umí říct nevím"**.
 * Špatně předvyplněné pole je horší než prázdné: prázdné si člověk vyplní,
 * kdežto špatné potvrdí, protože to tam napsala appka.
 */
import { pickReading } from "@/lib/meterOcr";

describe("pickReading — návrh hodnoty z displeje", () => {
  it("vezme číslo, u kterého stojí jednotka", () => {
    // Výrobní číslo je delší, ale jednotka je silnější signál než délka.
    expect(pickReading("Nr. 70150911\n012345,6 kWh")?.value).toBe(12345.6);
  });

  it("bez jednotky rozhoduje délka — stav je delší než rok výroby", () => {
    expect(pickReading("2019\n0045821")?.value).toBe(45821);
  });

  it("desetinná čárka i tečka jsou totéž číslo", () => {
    expect(pickReading("12345,6 kWh")?.value).toBe(12345.6);
    expect(pickReading("12345.6 kWh")?.value).toBe(12345.6);
  });

  it("oddělovač tisíců se nespojí do jiného čísla", () => {
    expect(pickReading("12.345,6 kWh")?.value).toBe(12345.6);
  });

  it("⭐ dvě stejně dlouhá čísla = NEVÍM, ne tip", () => {
    // Stav a výrobní číslo na jednom štítku, obojí 7 číslic a bez jednotky.
    // Tipnout si tu znamená nabídnout špatnou hodnotu s autoritou stroje.
    expect(pickReading("1234567\n7654321")).toBeNull();
  });

  it("popisky a krátká čísla se ignorují", () => {
    expect(pickReading("T1 T2 kWh 3")).toBeNull();
  });

  it("prázdný nebo nečitelný text vrátí null", () => {
    expect(pickReading("")).toBeNull();
    expect(pickReading("ELEKTROMĚR")).toBeNull();
  });

  it("táž hodnota přečtená dvakrát není remíza", () => {
    // Displej i štítek ukazují totéž — to není nejednoznačnost.
    expect(pickReading("045821\n045821")?.value).toBe(45821);
  });

  it("nese i syrový text, aby šlo dohledat, proč to tak přečetl", () => {
    expect(pickReading("012345,6 kWh")?.raw).toContain("12345");
  });
});
