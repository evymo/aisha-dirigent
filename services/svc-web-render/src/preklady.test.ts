import { describe, expect, it } from "vitest";

import { chybejiciKlice, radkyNaMapu } from "./preklady.js";

describe("radkyNaMapu", () => {
  // ⛔ NAPSÁNO ČERVENÉ proti dřívějšímu chování (naměřeno 2026-09-03):
  // generátor bral odpověď RPC jako mapu, ale PostgREST vydává SETOF
  // funkci jako pole řádků. `preklady["web.about.title"]` bylo `undefined`
  // a fallback dosadil klíč — 10 stránek na produkci s <title>web.about.title>.
  it("převede pole řádků RPC na mapu klíč → hodnota (skutečný tvar odpovědi)", () => {
    const mapa = radkyNaMapu([
      { key: "web.about.title", value: "About" },
      { key: "web.hero.title", value: "Example App" },
    ]);

    expect(mapa["web.about.title"]).toBe("About");
    expect(mapa["web.hero.title"]).toBe("Example App");
  });

  it("prázdné pole = prázdná mapa, ne chyba", () => {
    expect(radkyNaMapu([])).toEqual({});
  });

  it("objekt místo pole je chyba tvaru — neprojde mlčky", () => {
    expect(() => radkyNaMapu({ "web.about.title": "About" })).toThrow(/pole/);
  });

  it("řádek bez key/value je chyba tvaru s číslem řádku", () => {
    expect(() => radkyNaMapu([{ key: "a", value: "b" }, { klic: "x" }])).toThrow(/řádek 1/);
  });
});

describe("chybejiciKlice", () => {
  it("vrátí klíče, které stránka potřebuje a mapa nemá", () => {
    const mapa = { "web.about.title": "About" };

    expect(chybejiciKlice(mapa, ["web.about.title", "web.about.lede", undefined])).toEqual(["web.about.lede"]);
  });

  it("nic nechybí → prázdno", () => {
    expect(chybejiciKlice({ a: "1" }, ["a"])).toEqual([]);
  });
});
