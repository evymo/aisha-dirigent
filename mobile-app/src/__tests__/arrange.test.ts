import { DEFAULT_SURFACE, dvojcifri, heroParts, partitionTape, pickSurface } from "@/extranet/arrange";
import type { SurfaceSection } from "@/extranet/useSurface";

const sec = (section: string, state?: "active" | "inactive"): SurfaceSection => ({
  section,
  block_count: 1,
  ...(state ? { state } : {}),
});

describe("pickSurface", () => {
  it("prefers the daily brief when it is granted", () => {
    expect(pickSurface([sec("workbench"), sec("porada")], null)).toBe("porada");
  });

  it("falls back to the backend's FIRST section — order is the backend's, not ours", () => {
    expect(pickSurface([sec("workbench"), sec("registr")], null)).toBe("workbench");
  });

  it("never auto-selects a section that is declared but not wired to a source", () => {
    // Landing on a section that cannot load reads as a broken app, not as
    // pending work — so 'stroje' is skipped even though it comes first.
    expect(pickSurface([sec("stroje", "inactive"), sec("registr")], null)).toBe("registr");
  });

  it("still names a surface when nothing is granted, so the screen can render empty", () => {
    expect(pickSurface([], null)).toBe(DEFAULT_SURFACE);
    expect(pickSurface([sec("meridla", "inactive")], null)).toBe(DEFAULT_SURFACE);
  });

  it("lets the user's pick win over every default", () => {
    expect(pickSurface([sec("porada")], "meridla")).toBe("meridla");
  });
});

describe("partitionTape", () => {
  const items = [
    { id: 1, state: "human_confirmed" },
    { id: 2, state: "needs_review" },
    { id: 3, state: "needs_review" },
    { id: 4, state: "human_confirmed" },
  ];

  it("counts what is done and stands the user on the first waiting item", () => {
    const { done, now, ahead } = partitionTape(items);
    expect(done.map((i) => i.id)).toEqual([1, 4]);
    expect(now?.id).toBe(2);
    expect(ahead.map((i) => i.id)).toEqual([3]);
  });

  it("keeps the producer's order — the queue's order is itself information", () => {
    const { now, ahead } = partitionTape([
      { id: "c", state: "needs_review" },
      { id: "a", state: "needs_review" },
      { id: "b", state: "needs_review" },
    ]);
    expect(now?.id).toBe("c");
    expect(ahead.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("treats any non-confirmed state as waiting, so an unknown state is never lost", () => {
    const { done, now } = partitionTape([{ id: 9, state: "some_future_state" }]);
    expect(done).toEqual([]);
    expect(now?.id).toBe(9);
  });

  it("has no NOW when everything is done", () => {
    const { done, now, ahead } = partitionTape([{ id: 1, state: "human_confirmed" }]);
    expect(done).toHaveLength(1);
    expect(now).toBeUndefined();
    expect(ahead).toEqual([]);
  });
});

describe("heroParts — hero „TEĎ“ je pravidlo, ne kreslení", () => {
  const f = (key: string, value: unknown) => ({ key, label_key: `app.wf.field.${key}`, value: value as string });

  it("chip je PRVNÍ údaj producenta, zbytek jsou fakta pod ním", () => {
    const item = { id: "s1", fields: [f("dl", "DL-2601776"), f("kam", "Opava"), f("co", "Štěrk 8/16")] };
    const { chip, facts } = heroParts(item, 0, 5);
    expect(chip).toBe("DL-2601776");
    expect(facts.map((x) => x.key)).toEqual(["kam", "co"]);
  });

  /**
   * ⛔ Renderer nesmí vědět, co je dodací list. Táž funkce musí obsloužit
   * obchůzku měřidel, kde je první údaj něco úplně jiného — bez jediné větve.
   */
  it("nezná doménu — u odečtu je prvním údajem měřidlo a nic se nemění", () => {
    const item = { id: "m1", fields: [f("meridlo", "EL-114"), f("stav", "48 812")] };
    expect(heroParts(item, 0, 1).chip).toBe("EL-114");
  });

  it("prázdný ani chybějící údaj chip NEDĚLÁ (JAZYK-03)", () => {
    expect(heroParts({ id: "a", fields: [f("dl", null)] }, 0, 1).chip).toBeNull();
    expect(heroParts({ id: "a", fields: [f("dl", "")] }, 0, 1).chip).toBeNull();
    expect(heroParts({ id: "a", fields: [] }, 0, 1).chip).toBeNull();
    expect(heroParts({ id: "a" }, 0, 1).chip).toBeNull();
    expect(heroParts(undefined, 0, 0).chip).toBeNull();
  });

  it("číselná hodnota se nekreslí jako prázdná — nula je údaj", () => {
    expect(heroParts({ id: "a", fields: [f("kusy", 0)] }, 0, 1).chip).toBe("0");
  });

  /**
   * Pořadí dne se POČÍTÁ z pásky. Není to „jízda 7 z 12" z předlohy — ta stojí
   * na zakázce, kterou v datech nemáme (`Zakazka` 0 %).
   */
  it("pořadí = hotových + 1 ze všech dnešních", () => {
    expect(heroParts({ id: "a" }, 0, 7).position).toEqual({ n: 1, total: 7 });
    expect(heroParts({ id: "a" }, 3, 7).position).toEqual({ n: 4, total: 7 });
  });

  it("sedí s partitionTape nad týmiž daty — dvě pravidla, jeden příběh", () => {
    const items = [
      { id: "1", state: "human_confirmed" },
      { id: "2", state: "human_confirmed" },
      { id: "3", state: "pending" },
      { id: "4", state: "pending" },
    ];
    const { done, now } = partitionTape(items);
    expect(heroParts(now, done.length, items.length).position).toEqual({ n: 3, total: 4 });
  });
});

describe("odchylka na pásce (2026-09-29)", () => {
  it("⛔ předání s odchylkou (`failed`) je UZAVŘENÉ — nesmí se stát kartou TEĎ", () => {
    const { done, now, ahead } = partitionTape([
      { id: "1", state: "failed" },
      { id: "2", state: "pending" },
      { id: "3", state: "pending" },
    ]);
    expect(done.map((i) => i.id)).toEqual(["1"]);
    expect(now?.id).toBe("2");
    expect(ahead.map((i) => i.id)).toEqual(["3"]);
  });
});

describe("karta TEĎ podle makety (2026-09-29)", () => {
  it("⛔ údaj se stejnou hodnotou jako citace se nekreslí podruhé", () => {
    // riq: `quote_src` i pole „kam" jsou táž adresa — pod nadpisem byla dvakrát.
    const item = {
      title: "Odběratel s.r.o.",
      quote: "Ulice 1, Město",
      fields: [
        { key: "dl", label_key: "a", value: "DL-1" },
        { key: "kam", label_key: "b", value: "Ulice 1, Město" },
        { key: "vozidlo", label_key: "c", value: "1AB 2345" },
      ],
    };
    expect(heroParts(item, 0, 1).facts.map((f) => f.key)).toEqual(["vozidlo"]);
  });

  it("dedup porovnává HODNOTU, ne klíč — jiná hodnota pod týmž klíčem zůstává", () => {
    const item = { quote: "Ulice 1", fields: [{ key: "dl", label_key: "a", value: "X" }, { key: "kam", label_key: "b", value: "Ulice 2" }] };
    expect(heroParts(item, 0, 1).facts.map((f) => f.key)).toEqual(["kam"]);
  });

  it("prázdný údaj dedup nepolyká — o prázdném rozhoduje Fact (JAZYK-03)", () => {
    const item = { quote: "", fields: [{ key: "dl", label_key: "a", value: "X" }, { key: "pozn", label_key: "b", value: "" }] };
    expect(heroParts(item, 0, 1).facts.map((f) => f.key)).toEqual(["pozn"]);
  });

  it("ghost číslo = pořadí karty TEĎ na dvě cifry", () => {
    expect(heroParts(undefined, 6, 12).ghost).toBe("07");
    expect(heroParts(undefined, 11, 12).ghost).toBe("12");
  });

  it("dvojcifri: tři cifry se neořezávají, záporné ani desetinné nevznikne", () => {
    expect(dvojcifri(3)).toBe("03");
    expect(dvojcifri(104)).toBe("104");
    expect(dvojcifri(-1)).toBe("00");
    expect(dvojcifri(2.7)).toBe("02");
  });
});
