import { cilZPolozek, polozkyKZobrazeni, polozkyZKroku } from "@/lib/polozkyDokladu";

/**
 * Tvar je z produkce (`li_source_registry.line_items`, 2026-09-01), hodnoty
 * neutrální — testu na nich nezáleží a instanční data do platformního kódu
 * nepatří.
 */
const RADEK = (nazev: string, mnozstvi?: string, jednotka?: string, status = "PASS") => ({
  line_index: 0,
  status,
  fields: {
    item_name: { raw: nazev, value: nazev, gate: "PASS" },
    ...(mnozstvi ? { quantity: { raw: mnozstvi, value: mnozstvi, gate: "PASS" } } : {}),
    ...(jednotka ? { unit: { raw: jednotka, value: jednotka, gate: "PASS" } } : {}),
  },
});

describe("položky dokladu", () => {
  it("spojí množství s jednotkou do jednoho údaje", () => {
    // U rampy se čte rychle: „12,5 t" na jeden pohled, ne dvě sousední kolonky.
    expect(polozkyKZobrazeni([RADEK("Kamenivo 8/16", "12,5", "t")])[0]).toEqual({
      nazev: "Kamenivo 8/16",
      mnozstvi: "12,5 t",
      cekaNaKontrolu: false,
    });
  });

  it("jednotku bez množství nekreslí — samotné „t“ není údaj", () => {
    expect(polozkyKZobrazeni([RADEK("Kamenivo 8/16", undefined, "t")])[0].mnozstvi).toBe("");
  });

  it("řádek bez názvu vynechá (JAZYK-03)", () => {
    // Nerozpoznaný název je práce pro review frontu, ne prázdný proužek u rampy.
    expect(polozkyKZobrazeni([RADEK("", "3", "ks"), RADEK("Obrubník", "40", "ks")])).toHaveLength(1);
  });

  it("řádek, který neprošel branami, se přizná", () => {
    expect(polozkyKZobrazeni([RADEK("Písek", "2", "t", "NEEDS_REVIEW")])[0].cekaNaKontrolu).toBe(true);
  });

  it("chybějící nebo cizí vstup nevyrobí ani jeden řádek", () => {
    expect(polozkyKZobrazeni(null)).toEqual([]);
    expect(polozkyKZobrazeni(undefined)).toEqual([]);
    expect(polozkyKZobrazeni([{ fields: null }])).toEqual([]);
  });
});

describe("cíl zastávky na kartě TEĎ", () => {
  it("první řádek dokladu: množství zvýrazněné, název vedle", () => {
    expect(cilZPolozek(polozkyKZobrazeni([RADEK("Kamenivo 8/16", "12,5", "t")]))).toEqual({
      hlavni: "12,5 t",
      doplnek: "Kamenivo 8/16",
      dalsich: 0,
    });
  });

  it("⛔ víc řádků se NESČÍTÁ — ukáže se první a přizná se, kolik dalších", () => {
    const cil = cilZPolozek(polozkyKZobrazeni([
      RADEK("Kamenivo 8/16", "12,5", "t"),
      RADEK("Písek 0/4", "10", "t"),
      RADEK("Paleta", "2", "ks"),
    ]));
    expect(cil).toEqual({ hlavni: "12,5 t", doplnek: "Kamenivo 8/16", dalsich: 2 });
    expect(JSON.stringify(cil)).not.toContain("22,5");
  });

  it("řádek bez množství: zvýrazní se název, doplněk nevzniká", () => {
    expect(cilZPolozek(polozkyKZobrazeni([RADEK("Kamenivo 8/16")]))).toEqual({
      hlavni: "Kamenivo 8/16",
      doplnek: null,
      dalsich: 0,
    });
  });

  it("doklad bez položek cíl NEMÁ — prázdné se nekreslí (JAZYK-03)", () => {
    expect(cilZPolozek([])).toBeNull();
  });
});

describe("položky vydané S KROKEM (get_workflow_step_polozky)", () => {
  it("hodnoty bez provenance → tatáž pravidla jako řádky registru", () => {
    expect(
      polozkyZKroku([
        { item_name: "Kamenivo 8/16", quantity: "24.5", unit: "t", stav_radku: "PASS" },
        { item_name: "Písek 0/4", quantity: 12, unit: "t" },
      ]),
    ).toEqual([
      { nazev: "Kamenivo 8/16", mnozstvi: "24.5 t", cekaNaKontrolu: false },
      { nazev: "Písek 0/4", mnozstvi: "12 t", cekaNaKontrolu: false },
    ]);
  });

  it("řádek, který neprošel branami, se přizná i s krokem", () => {
    expect(polozkyZKroku([{ item_name: "X", quantity: "1", unit: "t", stav_radku: "REVIEW" }])[0].cekaNaKontrolu).toBe(true);
  });

  it("tablet bez názvu položky (projekce ho nepustila) nic nekreslí; cizí vstup nic nevyrobí", () => {
    expect(polozkyZKroku([{ quantity: "1", unit: "t" }])).toEqual([]);
    expect(polozkyZKroku(null)).toEqual([]);
    expect(polozkyZKroku([null as unknown as Record<string, unknown>, "x" as unknown as Record<string, unknown>])).toEqual([]);
  });
});
