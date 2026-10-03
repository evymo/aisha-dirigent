/**
 * „Čeká na kontrolu“ jen u řádku, který branami SKUTEČNĚ neprošel.
 *
 * NAMĚŘENO 2026-09-30 (tablet, Řidič 15b): ingest píše u řádků AUTO_PASS (prošel
 * branami) nebo NEEDS_REVIEW; `PASS` nepíše vůbec. Staré pravidlo „vše kromě PASS
 * čeká“ proto dávalo ⚠ každé položce — i přebírajícímu na podpisové obrazovce.
 */
import { polozkyKZobrazeni } from "@/lib/polozkyDokladu";

const radek = (status?: unknown) => ({
  status,
  fields: { item_name: { value: "Kamenivo" }, quantity: { value: "1" }, unit: { value: "t" } },
});

describe("stav řádku dokladu", () => {
  it("prošlé řádky (AUTO_PASS, HUMAN_CONFIRMED, PASS) na kontrolu nečekají", () => {
    for (const s of ["AUTO_PASS", "HUMAN_CONFIRMED", "PASS", "auto_pass"]) {
      expect(polozkyKZobrazeni([radek(s)])[0].cekaNaKontrolu).toBe(false);
    }
  });

  it("řádek, který branami neprošel, se přizná", () => {
    for (const s of ["NEEDS_REVIEW", "REVIEW", "REJECTED", "PENDING"]) {
      expect(polozkyKZobrazeni([radek(s)])[0].cekaNaKontrolu).toBe(true);
    }
  });

  it("chybějící nebo neznámý stav se jako „čeká“ nehlásí", () => {
    expect(polozkyKZobrazeni([radek()])[0].cekaNaKontrolu).toBe(false);
    expect(polozkyKZobrazeni([radek("NECO")])[0].cekaNaKontrolu).toBe(false);
    expect(polozkyKZobrazeni([radek(7)])[0].cekaNaKontrolu).toBe(false);
  });
});
