import { cisloDokladu, coSePredava, coSePredavaVyplnene, podtitulKroku } from "@/lib/coSePredava";

/**
 * Popis dodávky — měří se na TVARU, KTERÝ JE V PRODUKCI.
 *
 * Vzorky nejsou vymyšlené: `expedice:95f866a9-…` i `expedice:DLR251149` jsou
 * doslovné `batch_code` z produkce (2026-09-01), stejně jako subjekt kroku.
 * Vymyšlený vzorek by tuhle vadu neodhalil — ona vznikla právě tím, že se
 * měřilo na tvaru, který se do appky neposílá.
 */
describe("co se předává", () => {
  /** Krok předání, jak ho appka dostane z `get_my_workflow_steps`. */
  const predani = {
    batch_code: "expedice:95f866a9-d8fd-4930-afe9-090616d3f157",
    input_data: {
      dl_number: "DLP2602167",
      counterparty: "Doprastav, a.s., organizační složka Praha",
      delivery_address: "Ostrava-Poruba, stavba II/478",
      vehicle_registration: "1B0 1665",
      money_id: "95f866a9-d8fd-4930-afe9-090616d3f157",
    },
  };

  it("ukazuje číslo z papíru, ne identitu běhu", () => {
    // ⛔ Tohle je ta vada: hlavička brala `batch_code`, takže řidič viděl
    //    `expedice:95f866a9-…` pod popiskem „Doklad". Obě hodnoty jsou správné,
    //    ale u rampy platí ta z papíru.
    expect(cisloDokladu(predani)).toBe("DLP2602167");
  });

  it("u kroku bez dokladu zůstane identita běhu", () => {
    // Odečet měřidla dokladem nevzniká — `batch_code` je jediné, co má.
    expect(cisloDokladu({ batch_code: "odecet:2026-08", input_data: { subject_twin_id: "x" } }))
      .toBe("odecet:2026-08");
  });

  it("nese komu, kam a čím — hodnoty, které krok reálně má", () => {
    const podle = Object.fromEntries(coSePredava(predani).map((u) => [u.labelKey, u.value]));
    expect(podle["handover.moment.komu"]).toBe("Doprastav, a.s., organizační složka Praha");
    expect(podle["handover.moment.kam"]).toBe("Ostrava-Poruba, stavba II/478");
    expect(podle["handover.moment.vozidlo"]).toBe("1B0 1665");
  });

  it("NEMÁ pole „Co“ — bylo plněné popisem běhu, ne předmětem dodávky", () => {
    // Popis běhu (`{counterparty} — {dn_number}`) je správná hodnota, ale pod
    // popiskem „Co“ tvrdila, že je to předmět dodávky. Materiál a množství
    // přijdou z `line_items` přes `doc_slug`; do té doby tu to pole nemá být.
    expect(coSePredava(predani).map((u) => u.labelKey)).not.toContain("handover.moment.co");
  });

  it("prázdné se nekreslí (JAZYK-03)", () => {
    const holy = { batch_code: "expedice:DLR251149", input_data: { dl_number: "DLR251149", counterparty: "   " } };
    expect(coSePredavaVyplnene(holy).map((u) => u.labelKey)).toEqual(["workflow.step.doc"]);
  });

  it("krok bez jakýchkoli údajů nevyrobí ani jeden řádek", () => {
    expect(coSePredavaVyplnene({ batch_code: null, input_data: null })).toEqual([]);
  });
});

describe("podtitul kroku v seznamu a na pásce", () => {
  const KLIC = "expedice:00000000-0000-4000-8000-000000000001";

  it("⛔ strojový klíč běhu se nekreslí — doklad a komu", () => {
    const krok = {
      batch_code: KLIC,
      product_name: "Odběratel s.r.o. — DL-100",
      input_data: { dl_number: "DL-100", counterparty: "Odběratel s.r.o." },
    };
    expect(podtitulKroku(krok)).toBe("DL-100 · Odběratel s.r.o.");
    expect(podtitulKroku(krok)).not.toContain("expedice:");
  });

  it("bez odběratele: popis běhu, a když číslo už nese, stojí sám (ne dvakrát)", () => {
    expect(podtitulKroku({ batch_code: KLIC, product_name: "Odběratel — DL-100", input_data: { dl_number: "DL-100" } }))
      .toBe("Odběratel — DL-100");
    expect(podtitulKroku({ batch_code: KLIC, product_name: "Jiný popis", input_data: { dl_number: "DL-100" } }))
      .toBe("DL-100 · Jiný popis");
  });

  it("krok bez dokladu (odečet) dál ukáže svůj klíč — není čím ho nahradit", () => {
    expect(podtitulKroku({ batch_code: "odecet:elektromer-1", product_name: null, input_data: {} }))
      .toBe("odecet:elektromer-1");
  });

  it("prázdné nic nevyrobí (JAZYK-03)", () => {
    expect(podtitulKroku({ batch_code: null, product_name: "  ", input_data: null })).toBe("");
  });
});
