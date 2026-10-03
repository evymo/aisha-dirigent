/**
 * Fronta, kterou je vidět.
 *
 * ⛔ Nejdůležitější tvrzení je to o NEČITELNÉM ÚLOŽIŠTI: nula je tvrzení
 * („nic tam není"), a když nevíme, nesmí se dosadit.
 */
import { stavFronty, type VstupFronty } from "@/lib/stavFronty";

const KLID: VstupFronty = {
  queueSize: 0,
  needsAttention: 0,
  isProcessing: false,
  isConnected: true,
  storeUnreadable: false,
};

describe("prázdná fronta", () => {
  it("⛔ NEKRESLÍ NIC — odznak, který je vidět vždycky, přestane být odznak", () => {
    expect(stavFronty(KLID)).toBeNull();
  });
});

describe("čeká", () => {
  it("bez signálu leží a je to vidět i s počtem", () => {
    expect(stavFronty({ ...KLID, queueSize: 2, isConnected: false }))
      .toEqual({ povaha: "ceka", pocet: 2 });
  });

  it("⛔ `isProcessing` z minulého běhu bez signálu NEZNAMENÁ odesílání", () => {
    // Bez sítě neodchází nic; věta „odesílá se" by byla nepravdivá.
    expect(stavFronty({ ...KLID, queueSize: 2, isConnected: false, isProcessing: true }))
      .toEqual({ povaha: "ceka", pocet: 2 });
  });
});

describe("odesílá", () => {
  it("se signálem a běžícím během", () => {
    expect(stavFronty({ ...KLID, queueSize: 3, isProcessing: true }))
      .toEqual({ povaha: "odesila", pocet: 3 });
  });
});

describe("vyžaduje člověka", () => {
  it("vyčerpané pokusy mají přednost — samy se neodešlou", () => {
    expect(stavFronty({ ...KLID, queueSize: 5, needsAttention: 2, isProcessing: true }))
      .toEqual({ povaha: "vyzaduje-cloveka", pocet: 2 });
  });

  it("počítá TY, co čekají na člověka, ne celou frontu", () => {
    const s = stavFronty({ ...KLID, queueSize: 9, needsAttention: 1 });
    expect(s?.pocet).toBe(1);
  });
});

describe("nečitelné úložiště", () => {
  it("⛔ říká NEVÍM a počet je null — nula by byla lež", () => {
    expect(stavFronty({ ...KLID, storeUnreadable: true }))
      .toEqual({ povaha: "nevim", pocet: null });
  });

  it("⛔ přebíjí i vyčerpané pokusy — poslední známá hodnota není měření", () => {
    const s = stavFronty({ ...KLID, storeUnreadable: true, queueSize: 4, needsAttention: 2 });
    expect(s).toEqual({ povaha: "nevim", pocet: null });
  });

  it("⛔ NEUMLČÍ SE prázdnou frontou — nevím není totéž co nic tam není", () => {
    // Tohle je ta past: kdyby se `queueSize === 0` testovalo dřív, nečitelný
    // trezor by se tvářil jako klid a řidič by odjel od rampy v dobré víře.
    expect(stavFronty({ ...KLID, storeUnreadable: true, queueSize: 0 })).not.toBeNull();
  });
});
