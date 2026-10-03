import { describe, expect, it } from "@jest/globals";
import {
  INTERVAL_CEKA_MS,
  PO_ZATUKANI_MS,
  dalsiPokusZa,
  krokTabletu,
  zavedTablet,
  type VstupPruvodce,
  type ZavedeniDeps,
} from "@/lib/pruvodceTabletu";
import type { VysledekTabletu } from "@/lib/ohlaseniTabletu";

const KID = "dev-4564eb0d47345c6a";
const relaceOk = { stav: "ok" as const, relace: { token: "t", vyprsi: 1, kid: KID, uzivatel: "u" } };

describe("průvodce tabletu — kde tablet je", () => {
  const pripady: Array<[string, VstupPruvodce, ReturnType<typeof krokTabletu>]> = [
    ["úložiště se ještě čte", { klic: "nevim", prukaz: null, relace: null }, { krok: "nacitam" }],
    ["bez klíče → technik zavede", { klic: "nema", prukaz: null, relace: null }, { krok: "zavedeni", proc: "bez-klice" }],
    ["nečitelný klíč → servis", { klic: "vadny", prukaz: null, relace: null }, { krok: "vadny-klic" }],
    ["brána klíč nezná → zavést znovu", { klic: "ma", prukaz: { stav: "nezname" }, relace: null }, { krok: "zavedeni", proc: "nezname" }],
    ["ohlášený, čeká na správce", { klic: "ma", prukaz: { stav: "ceka", kid: KID }, relace: null }, { krok: "ceka", kid: KID }],
    ["schválený, relace zatím ne (dveře)", { klic: "ma", prukaz: { stav: "schvaleno", kid: KID }, relace: { stav: "dvere-zavrene" } }, { krok: "pripojuji" }],
    ["schválený a relace je → hotovo", { klic: "ma", prukaz: { stav: "schvaleno", kid: KID }, relace: relaceOk }, { krok: "hotovo" }],
    ["odvolaný (stav)", { klic: "ma", prukaz: { stav: "odvolano", kid: KID }, relace: null }, { krok: "odvolano" }],
    ["odvolaný (relace)", { klic: "ma", prukaz: null, relace: { stav: "neschvaleno", duvod: "odvolano" } }, { krok: "odvolano" }],
    ["průkaz vypršel", { klic: "ma", prukaz: null, relace: { stav: "neschvaleno", duvod: "vyprselo" } }, { krok: "vyprselo" }],
    ["stav nejde zjistit a relace také ne → porucha", { klic: "ma", prukaz: { stav: "selhalo", duvod: "HTTP 502" }, relace: null }, { krok: "porucha", duvod: "HTTP 502" }],
  ];
  it.each(pripady)("%s", (_popis, vstup, cekam) => {
    expect(krokTabletu(vstup)).toEqual(cekam);
  });

  it("⛔ relace ok přebije starou odpověď stavu (správce mezitím schválil)", () => {
    expect(krokTabletu({ klic: "ma", prukaz: { stav: "ceka", kid: KID }, relace: relaceOk })).toEqual({ krok: "hotovo" });
  });

  it("⛔ porucha cesty (404 Route not found = selhalo) NENÍ „zaveďte znovu“", () => {
    const k = krokTabletu({ klic: "ma", prukaz: null, relace: { stav: "selhalo", duvod: "HTTP 404 Not Found" } });
    expect(k).toEqual({ krok: "porucha", duvod: "HTTP 404 Not Found" });
  });
});

describe("průvodce tabletu — kdy se zeptá sám", () => {
  it("čekání na správce: pravidelně, bez odstupu", () => {
    expect(dalsiPokusZa({ krok: "ceka", kid: KID }, 0)).toBe(INTERVAL_CEKA_MS);
    expect(dalsiPokusZa({ krok: "ceka", kid: KID }, 9)).toBe(INTERVAL_CEKA_MS);
  });

  it("připojování i porucha: odstup roste, ale má strop", () => {
    const pripojuji = [0, 1, 2, 3, 10].map((i) => dalsiPokusZa({ krok: "pripojuji" }, i));
    expect(pripojuji).toEqual([5_000, 15_000, 30_000, 60_000, 60_000]);
    const porucha = [0, 3, 50].map((i) => dalsiPokusZa({ krok: "porucha", duvod: "x" }, i));
    expect(porucha).toEqual([30_000, 300_000, 300_000]);
  });

  it("na člověka čeká jen zavedení a vadný klíč; hotovo drží zdroj relace", () => {
    expect(dalsiPokusZa({ krok: "zavedeni", proc: "bez-klice" }, 0)).toBeNull();
    expect(dalsiPokusZa({ krok: "vadny-klic" }, 0)).toBeNull();
    expect(dalsiPokusZa({ krok: "hotovo" }, 0)).toBeNull();
  });

  it("odvolaný i vypršelý se po čase zeptá sám — správce to může napravit", () => {
    expect(dalsiPokusZa({ krok: "odvolano" }, 0)).toBe(300_000);
    expect(dalsiPokusZa({ krok: "vyprselo" }, 0)).toBe(300_000);
  });
});

describe("zavedení technikem — jeden úkon", () => {
  function deps(o: Partial<ZavedeniDeps> & { odpovedi?: VysledekTabletu[]; klic?: boolean } = {}) {
    const zaznam: string[] = [];
    const odpovedi = [...(o.odpovedi ?? [{ stav: "ceka", kid: KID } as VysledekTabletu])];
    let klic = o.klic ?? false;
    const d: ZavedeniDeps = {
      zatukejKodem: o.zatukejKodem ?? (async (kod) => { zaznam.push(`tuk:${kod}`); return { sent: true }; }),
      pockej: async (ms) => { zaznam.push(`cekej:${ms}`); },
      maKlic: async () => klic,
      zalozKlic: async () => { zaznam.push("klic"); klic = true; },
      ohlas: async () => { zaznam.push("ohlas"); return odpovedi.shift() ?? { stav: "dvere-zavrene" }; },
    };
    return { d, zaznam };
  }

  it("kód → zaťukat → počkat → založit klíč → ohlásit", async () => {
    const { d, zaznam } = deps();
    expect(await zavedTablet("1234", d)).toEqual({ vysledek: "ohlaseno", prukaz: { stav: "ceka", kid: KID } });
    expect(zaznam).toEqual(["tuk:1234", `cekej:${PO_ZATUKANI_MS}`, "klic", "ohlas"]);
  });

  it("⛔ klíč se NEZAKLÁDÁ, když zaťukání neodešlo (průkaz jen po úkonu u dveří)", async () => {
    const { d, zaznam } = deps({ zatukejKodem: async () => ({ sent: false, error: "EHOSTUNREACH" }) });
    expect(await zavedTablet("1234", d)).toEqual({ vysledek: "neodeslano", duvod: "EHOSTUNREACH" });
    expect(zaznam).toEqual([]);
  });

  it("existující klíč se nepřepisuje — jen se ohlásí", async () => {
    const { d, zaznam } = deps({ klic: true });
    await zavedTablet("1234", d);
    expect(zaznam).not.toContain("klic");
  });

  it("ztracený rámec: ohlášení se jednou zopakuje, pak řekne „dveře zavřené“", async () => {
    const { d, zaznam } = deps({ odpovedi: [{ stav: "dvere-zavrene" }, { stav: "ceka", kid: KID }] });
    expect(await zavedTablet("1234", d)).toEqual({ vysledek: "ohlaseno", prukaz: { stav: "ceka", kid: KID } });
    expect(zaznam.filter((z) => z === "ohlas")).toHaveLength(2);

    const druhy = deps({ odpovedi: [{ stav: "dvere-zavrene" }, { stav: "dvere-zavrene" }] });
    expect(await zavedTablet("1234", druhy.d)).toEqual({ vysledek: "dvere-zavrene" });
  });

  it("výjimka se nepropustí — obrazovka dostane důvod", async () => {
    const { d } = deps({ zatukejKodem: async () => { throw new Error("secure store zamčený"); } });
    expect(await zavedTablet("1234", d)).toEqual({ vysledek: "chyba", duvod: "secure store zamčený" });
  });
});
