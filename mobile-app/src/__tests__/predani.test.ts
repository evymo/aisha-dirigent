import { casNaRazitku, chybiKPotvrzeni, dalsiZastavka } from "@/lib/predani";

describe("předání ve dvou krocích — co chybí k potvrzení", () => {
  const PODPIS = "data:image/png;base64,AAAA";

  it("podpis i jméno = lze potvrdit", () => {
    expect(chybiKPotvrzeni({ podpis: PODPIS, jmeno: "Jan Novák", vyzadovat: true })).toBeNull();
  });

  it("řekne PŘESNĚ, co chybí — ne obecné „nelze“", () => {
    expect(chybiKPotvrzeni({ podpis: null, jmeno: "Jan Novák", vyzadovat: true })).toBe("podpis");
    expect(chybiKPotvrzeni({ podpis: PODPIS, jmeno: "", vyzadovat: true })).toBe("jmeno");
    expect(chybiKPotvrzeni({ podpis: null, jmeno: "  ", vyzadovat: true })).toBe("obe");
  });

  it("jeden znak ani mezery nejsou jméno", () => {
    expect(chybiKPotvrzeni({ podpis: PODPIS, jmeno: " J ", vyzadovat: true })).toBe("jmeno");
    expect(chybiKPotvrzeni({ podpis: PODPIS, jmeno: "Ng", vyzadovat: true })).toBeNull();
  });

  it("dispečer u cizího kroku podpis nemá odkud vzít — nevyžaduje se", () => {
    expect(chybiKPotvrzeni({ podpis: null, jmeno: "", vyzadovat: false })).toBeNull();
  });
});

describe("další jízda po předání", () => {
  const fronta = [
    { step_id: "a", status: "completed" },
    { step_id: "b", status: "pending" },
    { step_id: "c", status: "failed" },
    { step_id: "d", status: "in_progress" },
  ];

  it("⛔ právě předaný krok se nevrátí jako další, i když ve frontě ještě čeká", () => {
    expect(dalsiZastavka(fronta, "b")?.step_id).toBe("d");
  });

  it("první čekající v pořadí producenta; hotové i s odchylkou se přeskočí", () => {
    expect(dalsiZastavka(fronta, "x")?.step_id).toBe("b");
  });

  it("nic dalšího = null, ne prázdná karta", () => {
    expect(dalsiZastavka([{ step_id: "a", status: "completed" }], "a")).toBeNull();
    expect(dalsiZastavka([], "a")).toBeNull();
  });
});

describe("čas na razítku", () => {
  it("místní HH:MM z okamžiku potvrzení", () => {
    const d = new Date(2026, 8, 29, 7, 5, 30);
    expect(casNaRazitku(d.toISOString())).toBe("07:05");
  });

  it("vadný vstup nic nevymyslí", () => {
    expect(casNaRazitku("neni-cas")).toBe("");
  });
});
