/**
 * Hlídač čísel (fáze 4 „AI na CPU") — odpověď modelu nese jen hodnoty z faktů.
 *
 * Fakta = tvar obálky `answer_verified_facts` (intent dluh, Inspirace, změřeno na
 * riq 2026-09-28: dluh 194 360, k úhradě 259 597, předepsáno 297 520, nejstarší
 * 686 dní). Kontrolní vzorek: vymyšlená částka a posunuté datum PROPADNOU — jinak
 * by „vše prošlo" platilo i pro hlídač, který nic nehlídá.
 */
import { describe, expect, it } from "vitest";
import { hlidejCisla, hodnotyTextu } from "../lib/factNumberGuard.js";

const FAKTA = {
  intent: "debt",
  coverage: "partial",
  answer: "Inspirace: dluh (po splatnosti) 194 360 Kč, nejstarší 686 dní; k úhradě celkem 259 597 Kč.",
  data: { dluh: 194360, k_uhrade: 259597, nejstarsi_dni: 686, predepsano: 297520, dluh_od: "2024-11-11", smluv: 1 },
};
const OTAZKA = "Kolik dluží Inspirace?";

describe("hlídač čísel: odpověď modelu jen z faktů", () => {
  it("český zápis částek a data z faktů projde", () => {
    const v = hlidejCisla(
      "Inspirace dluží 194 360 Kč po splatnosti, nejstarší faktura je 686 dní po splatnosti (od 11. 11. 2024). Celkem k úhradě 259\u00a0597 Kč.",
      FAKTA, OTAZKA,
    );
    expect(v).toEqual({ ok: true, cizi: [] });
  });

  it("jiné zápisy téže hodnoty projdou (bez mezer, tečka jako tisíce, desetinná čárka, ISO datum, rok)", () => {
    expect(hlidejCisla("Dluh 194360 Kč, splatné od 2024-11-11.", FAKTA).ok).toBe(true);
    expect(hlidejCisla("Dluh 194.360 Kč.", FAKTA).ok).toBe(true);
    expect(hlidejCisla("Dluh 194 360,00 Kč od listopadu 2024, 1 smlouva.", FAKTA).ok).toBe(true);
  });

  it("KONTROLNÍ VZOREK: vymyšlená částka propadne a je jmenovaná", () => {
    const v = hlidejCisla("Inspirace dluží 195 000 Kč.", FAKTA, OTAZKA);
    expect(v.ok).toBe(false);
    expect(v.cizi).toEqual(["195 000"]);
  });

  it("KONTROLNÍ VZOREK: posunuté datum propadne", () => {
    const v = hlidejCisla("Dluh trvá od 12. 11. 2024.", FAKTA);
    expect(v.ok).toBe(false);
    expect(v.cizi).toEqual(["2024-11-12"]);
  });

  it("zaokrouhlení je cizí číslo (přísně, rozhodnutí majitele 29. 9.)", () => {
    expect(hlidejCisla("Dluh je asi 194 tisíc Kč.", FAKTA).cizi).toEqual(["194"]);
    expect(hlidejCisla("Dluh je 194,4 tis. Kč.", FAKTA).ok).toBe(false);
  });

  it("číslo z otázky uživatele smí model zopakovat", () => {
    expect(hlidejCisla("Faktura 2024117 ve faktech není.", FAKTA, "Je zaplacená faktura 2024117?").ok).toBe(true);
    expect(hlidejCisla("Faktura 2024117 ve faktech není.", FAKTA).ok).toBe(false);
  });

  it("odpověď bez čísel projde (model řekne, že neví)", () => {
    expect(hlidejCisla("To ve faktech nemám.", FAKTA).ok).toBe(true);
  });

  it("slovo s číslem v čísle smlouvy/roku se nesloučí se sousedním číslem", () => {
    expect(hodnotyTextu("1 smlouva, 686 dní").cisla.map((c) => c.zapis)).toEqual(["1", "686"]);
  });
});
