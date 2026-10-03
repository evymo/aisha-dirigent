/**
 * Paměť přebírajícího — vlastní vzpomínka řidiče, ne odvozený údaj.
 *
 * ⛔ Nejdůležitější tvrzení je to první: `counterparty` je FIRMA a nesmí se
 * z ní stát jméno člověka v dokladu.
 */
import {
  PLATNOST_DNI, STROP,
  klic, nabidka, protistrana, zapamatuj, zParsuj, type Pamet,
} from "@/lib/prebirajici";

const KROK = { counterparty: "Alfa s.r.o.", dl_number: "DL-2026-0042" };
const TED = new Date("2026-08-20T10:00:00.000Z");
const dnyZpet = (n: number) => new Date(TED.getTime() - n * 86_400_000).toISOString();

describe("protistrana", () => {
  it("je klíčem, pod kterým si jméno pamatujeme", () => {
    expect(protistrana(KROK)).toBe("Alfa s.r.o.");
  });

  it("⛔ chybějící nebo prázdná protistrana = nepamatujeme si nic", () => {
    // Prázdný klíč by nabídl jedno jméno u všech odběratelů naráz.
    expect(protistrana({})).toBeNull();
    expect(protistrana({ counterparty: "   " })).toBeNull();
    expect(protistrana({ counterparty: 42 })).toBeNull();
    expect(protistrana(null)).toBeNull();
  });
});

describe("nabídka", () => {
  it("nabídne to, co člověk sám naposledy potvrdil u TÉTO protistrany", () => {
    const p: Pamet = { "Alfa s.r.o.": { jmeno: "Jan Novák", kdy: dnyZpet(3) } };
    expect(nabidka(p, KROK, TED)).toBe("Jan Novák");
  });

  it("⛔ u jiné protistrany NEnabízí nic — jméno se nepřenáší mezi odběrateli", () => {
    const p: Pamet = { "Alfa s.r.o.": { jmeno: "Jan Novák", kdy: dnyZpet(3) } };
    expect(nabidka(p, { counterparty: "Beta a.s." }, TED)).toBeNull();
  });

  it("vypršelá vzpomínka se nenabízí", () => {
    const p: Pamet = { "Alfa s.r.o.": { jmeno: "Jan Novák", kdy: dnyZpet(PLATNOST_DNI + 1) } };
    expect(nabidka(p, KROK, TED)).toBeNull();
  });

  it("hranice platnosti drží", () => {
    const p: Pamet = { "Alfa s.r.o.": { jmeno: "Jan Novák", kdy: dnyZpet(PLATNOST_DNI - 1) } };
    expect(nabidka(p, KROK, TED)).toBe("Jan Novák");
  });

  it("prázdná paměť = nenabízí se nic", () => {
    expect(nabidka({}, KROK, TED)).toBeNull();
  });
});

describe("zapamatování", () => {
  it("uloží potvrzené jméno pod protistranu", () => {
    const p = zapamatuj({}, KROK, "Jan Novák", TED);
    expect(p["Alfa s.r.o."].jmeno).toBe("Jan Novák");
  });

  it("ořízne bílé znaky", () => {
    const p = zapamatuj({}, KROK, "  Jan Novák  ", TED);
    expect(p["Alfa s.r.o."].jmeno).toBe("Jan Novák");
  });

  it("⛔ prázdné jméno NEPŘEPÍŠE platnou vzpomínku", () => {
    // Nevyplněné pole neznamená „přebíral nikdo".
    const p: Pamet = { "Alfa s.r.o.": { jmeno: "Jan Novák", kdy: dnyZpet(3) } };
    expect(zapamatuj(p, KROK, "   ", TED)).toBe(p);
  });

  it("krok bez protistrany se neukládá", () => {
    const p: Pamet = {};
    expect(zapamatuj(p, {}, "Jan Novák", TED)).toBe(p);
  });

  it("novější potvrzení přepíše starší", () => {
    let p = zapamatuj({}, KROK, "Jan Novák", new Date(TED.getTime() - 86_400_000));
    p = zapamatuj(p, KROK, "Petra Malá", TED);
    expect(p["Alfa s.r.o."].jmeno).toBe("Petra Malá");
  });

  it("strop drží a zahazuje NEJSTARŠÍ", () => {
    let p: Pamet = {};
    for (let i = 0; i < STROP + 5; i++) {
      p = zapamatuj(p, { counterparty: `Firma ${i}` }, `Osoba ${i}`, new Date(TED.getTime() - (STROP + 5 - i) * 86_400_000));
    }
    expect(Object.keys(p)).toHaveLength(STROP);
    expect(p["Firma 0"]).toBeUndefined();                   // nejstarší pryč
    expect(p[`Firma ${STROP + 4}`].jmeno).toBe(`Osoba ${STROP + 4}`); // nejnovější zůstal
  });
});

describe("čtení z úložiště", () => {
  it("přečte, co bylo uloženo", () => {
    const p = zapamatuj({}, KROK, "Jan Novák", TED);
    expect(zParsuj(JSON.stringify(p))).toEqual(p);
  });

  it("poškozený nebo cizí obsah = prázdná paměť, ne pád", () => {
    expect(zParsuj("{tohle není json")).toEqual({});
    expect(zParsuj("[1,2,3]")).toEqual({});
    expect(zParsuj(null)).toEqual({});
    expect(zParsuj(JSON.stringify({ "Alfa s.r.o.": { jmeno: "", kdy: "x" } }))).toEqual({});
  });
});

describe("klíč úložiště", () => {
  it("⛔ nese uid — na sdíleném telefonu se vzpomínky nemíchají", () => {
    expect(klic("uid-a")).not.toBe(klic("uid-b"));
    expect(klic("uid-a")).toContain("uid-a");
  });
});
