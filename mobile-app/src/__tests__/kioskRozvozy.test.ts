/**
 * Obrazovka tabletu (F2) — odpověď serveru se jen ověří a převede, nic se nedopočítává.
 * Chyba serveru se hlásí (ne tichý prázdný seznam). Rozvozy jdou na tutéž pásku jako na
 * telefonu a výběr dne přežije restart, ne půlnoc. (Stavy relace řeší `pruvodceTabletu`.)
 */
import { describe, expect, it } from "@jest/globals";
import {
  ChybaRozvozu, dnesniDen, naPasku, rozlozNabidku, rozlozRozvozy, zParsujVyber, type Rozvoz,
} from "../lib/kioskRozvozy";

describe("nabídka a rozvozy", () => {
  it("nabídka řidičů a vozidel; vadné položky vypadnou", () => {
    expect(rozlozNabidku({
      ok: true,
      ridici: [{ hodnota: "Jan", k_predani: 2, hotovo: 1 }, { hodnota: "", k_predani: 1 }, null],
      vozidla: [{ hodnota: "1T23456", k_predani: 3, hotovo: 0 }],
    })).toEqual({
      ridici: [{ hodnota: "Jan", hotovo: 1, kPredani: 2 }],
      vozidla: [{ hodnota: "1T23456", hotovo: 0, kPredani: 3 }],
    });
  });

  it("rozvozy berou jen povolená pole; chybějící pole = null, ne výmysl", () => {
    expect(rozlozRozvozy({
      ok: true,
      rozvozy: [
        { id: "a", stav: "pending", pole: { counterparty: "Stavby a.s.", dl_number: "DL1", delivery_address: "Lom", driver_name: "Jan" } },
        { id: "b", stav: "completed", pole: {} },
        { stav: "pending", pole: {} },
      ],
    })).toEqual([
      { doklad: "DL1", hotovo: false, id: "a", kam: "Lom", odberatel: "Stavby a.s.", ridic: "Jan", vozidlo: null },
      { doklad: null, hotovo: true, id: "b", kam: null, odberatel: null, ridic: null, vozidlo: null },
    ]);
  });

  it("⛔ chyba serveru se hlásí jako chyba, ne jako prázdný den", () => {
    expect(() => rozlozNabidku({ error: "jen_zarizeni", ok: false })).toThrow(ChybaRozvozu);
    expect(() => rozlozRozvozy(null)).toThrow(/neznama_odpoved/);
  });
});

describe("rozvozy na pásce — týž tvar jako na telefonu", () => {
  const rozvoz = (o: Partial<Rozvoz>): Rozvoz => ({
    id: "k1", hotovo: false, odberatel: "Odběratel s.r.o.", doklad: "DL-1", kam: "Ulice 1, Město",
    ridic: "Řidič A", vozidlo: "1AB 2345", ...o,
  });

  it("nadpis = odběratel, citace = místo, chip = dodací list", () => {
    const [p] = naPasku([rozvoz({})], "ridic");
    expect(p).toMatchObject({ id: "k1", title: "Odběratel s.r.o.", quote: "Ulice 1, Město", state: "pending" });
    expect((p.fields as Array<{ key: string }>)[0]).toMatchObject({ key: "doklad", value: "DL-1" });
  });

  it("druhý údaj je ten, který výběr NEZNÁ (řidič → vozidlo, vozidlo → řidič)", () => {
    const podleRidice = naPasku([rozvoz({})], "ridic")[0].fields as Array<{ key: string; value: unknown }>;
    const podleVozidla = naPasku([rozvoz({})], "vozidlo")[0].fields as Array<{ key: string; value: unknown }>;
    expect(podleRidice[1]).toMatchObject({ key: "vozidlo", value: "1AB 2345" });
    expect(podleVozidla[1]).toMatchObject({ key: "ridic", value: "Řidič A" });
  });

  it("hotové předání je na pásce uzavřené; bez odběratele nadpis nese doklad", () => {
    expect(naPasku([rozvoz({ hotovo: true })], "ridic")[0].state).toBe("human_confirmed");
    expect(naPasku([rozvoz({ odberatel: null })], "ridic")[0].title).toBe("DL-1");
  });

  it("pořadí je serverové — nic se neřadí", () => {
    const ids = naPasku([rozvoz({ id: "b" }), rozvoz({ id: "a" })], "ridic").map((p) => p.id);
    expect(ids).toEqual(["b", "a"]);
  });
});

describe("výběr dne na tabletu", () => {
  const DEN = "2026-09-29";

  it("dnešní výběr se obnoví", () => {
    expect(zParsujVyber(JSON.stringify({ den: DEN, rezim: "vozidlo", hodnota: "1AB 2345" }), DEN))
      .toEqual({ rezim: "vozidlo", hodnota: "1AB 2345" });
  });

  it("⛔ včerejší výběr NE — tablet mohl ráno přejet do jiné soupravy", () => {
    expect(zParsujVyber(JSON.stringify({ den: "2026-09-28", rezim: "ridic", hodnota: "Řidič A" }), DEN)).toBeNull();
  });

  it("vadný záznam nic nevymyslí", () => {
    expect(zParsujVyber("{", DEN)).toBeNull();
    expect(zParsujVyber(JSON.stringify({ den: DEN, rezim: "jiny", hodnota: "x" }), DEN)).toBeNull();
    expect(zParsujVyber(JSON.stringify({ den: DEN, rezim: "ridic", hodnota: "  " }), DEN)).toBeNull();
    expect(zParsujVyber(null, DEN)).toBeNull();
  });

  it("den je místní YYYY-MM-DD", () => {
    expect(dnesniDen(new Date(2026, 8, 9, 23, 59))).toBe("2026-09-09");
  });
});
