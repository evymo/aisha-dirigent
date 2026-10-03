/**
 * Polní slovník ESDK — gramatika práce v terénu.
 *
 * Testuje se VLASTNOST, ne značky: „stroj navrhuje, člověk potvrzuje", „rozdíl
 * mezi nimi je informace" a „prázdný údaj se nekreslí". Tyhle věty musí platit
 * v obou rendererech (web i mobil), takže jsou zároveň zadáním pro paritu.
 */
import { beforeAll, describe, expect, it } from "vitest";

let EsFact: CustomElementConstructor;
let EsMeasure: CustomElementConstructor;
let EsEvidence: CustomElementConstructor;
let EsLamp: CustomElementConstructor;

beforeAll(async () => {
  const m = await import("@aisha/extranet-sdk-ui/elements");
  ({ EsFact, EsMeasure, EsEvidence, EsLamp } = m as unknown as Record<string, CustomElementConstructor>);
  for (const C of [EsFact, EsMeasure, EsEvidence, EsLamp]) {
    const tag = (C as unknown as { tag: string }).tag;
    if (!customElements.get(tag)) customElements.define(tag, C);
  }
});

/** Připojí prvek do dokumentu — bez připojení se `render()` nespustí. */
function vykresli(tag: string, attrs: Record<string, string> = {}, data?: unknown): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.appendChild(el);
  if (data !== undefined) (el as HTMLElement & { data: unknown }).data = data;
  return el;
}

describe("es-lamp — stav se čte, ne jen vidí", () => {
  it("[JAZYK-01] stav se čte jako glyf + slovo, nikdy jen jako barva", () => {
    const el = vykresli("es-lamp", { state: "fault", label: "porucha" });
    // Slovo musí být přítomné samo o sobě…
    expect(el.textContent).toContain("porucha");
    // …a glyf vedle něj, aby stav šel přečíst i bez barvy. Na slunci za sklem
    // kabiny zmizí barevný rozdíl první a barvoslepý ho nemá nikdy.
    expect(el.textContent).toContain("■");
  });

  it("[JAZYK-01] glyf se nezdvojí, když ho popisek už nese", () => {
    const el = vykresli("es-lamp", { state: "fault", label: "porucha ■" });
    expect((el.textContent?.match(/■/g) ?? []).length).toBe(1);
  });
});

describe("es-fact — prázdný údaj se NEKRESLÍ", () => {
  it("[JAZYK-03] s hodnotou vykreslí popisek i hodnotu", () => {
    const el = vykresli("es-fact", { label: "Příjemce", value: "Novák" });
    expect(el.textContent).toContain("Příjemce");
    expect(el.textContent).toContain("Novák");
    expect(el.hidden).toBe(false);
  });

  it.each([[""], [" "]])("[JAZYK-03] prázdná hodnota (%p) nevyrobí prázdný řádek", (v) => {
    const el = vykresli("es-fact", { label: "Poznámka", value: v.trim() });
    if (v.trim() === "") {
      // Nevyplněný řádek není informace — vypadal by jako údaj a četl se jako
      // „nezjištěno", i když třeba jen nebylo o co se ptát.
      expect(el.innerHTML).toBe("");
      expect(el.hidden).toBe(true);
    }
  });

  it("[JAZYK-03] chybějící atribut value se chová jako prázdný, ne jako „undefined“", () => {
    const el = vykresli("es-fact", { label: "Poznámka" });
    expect(el.innerHTML).toBe("");
    expect(el.textContent).not.toContain("undefined");
  });
});

describe("es-measure — stroj navrhuje, člověk potvrzuje", () => {
  it("[JAZYK-04] hodnotou je to, co potvrdil ČLOVĚK — ne odhad stroje", () => {
    const el = vykresli("es-measure", { value: "1428", unit: "m³", suggested: "1423" });
    const hodnota = el.querySelector(".mv")?.textContent ?? "";
    expect(hodnota).toContain("1428");
    expect(hodnota).not.toContain("1423"); // odhad se do hodnoty NEDOSTANE
  });

  it("[JAZYK-06] rozdíl mezi strojem a člověkem je VIDĚT — je to informace, ne chyba", () => {
    const el = vykresli("es-measure", { value: "1428", suggested: "1423" });
    const pozn = el.querySelector(".ms");
    expect(pozn?.textContent).toContain("1423");
    expect(pozn?.textContent).toContain("přepsáno");
    expect(pozn?.classList.contains("over")).toBe(true);
  });

  it("[JAZYK-06] shoda se hlásí jako potvrzení, ne jako přepsání", () => {
    const el = vykresli("es-measure", { value: "1428", suggested: "1428" });
    expect(el.querySelector(".ms")?.textContent).toContain("potvrzeno");
    expect(el.querySelector(".ms")?.classList.contains("over")).toBe(false);
  });

  it("[JAZYK-07] „12,0“ a „12“ je TÁŽ hodnota — porovnává se číselně, ne textově", () => {
    const el = vykresli("es-measure", { value: "12,0", suggested: "12" });
    // Textová shoda by tu nepravdivě hlásila, že člověk stroj přepsal.
    expect(el.querySelector(".ms")?.classList.contains("over")).toBe(false);
  });

  it("bez odhadu stroje se o stroji NIC netvrdí", () => {
    const el = vykresli("es-measure", { value: "1428" });
    expect(el.querySelector(".ms")).toBeNull();
  });

  it("[JAZYK-02] číslo nikdy bez zdroje — provenience je vždy", () => {
    const el = vykresli("es-measure", { value: "1428" });
    expect(el.querySelector("es-prov")).not.toBeNull();
  });

  it("chybějící hodnota se kreslí jako pomlčka, ne jako prázdno nebo nula", () => {
    const el = vykresli("es-measure", {});
    expect(el.querySelector(".mv")?.textContent).toContain("—");
  });

  /**
   * ⭐ NEJOSTŘEJŠÍ TVAR PRAVIDLA — a v suitě CHYBĚL, dokud ho neodhalila mutace.
   *
   * Když člověk nic nepotvrdil, odhad stroje se hodnotou stát NESMÍ, i když je
   * po ruce. Prázdné pole není pozvánka stroj dosadit: nepotvrzený odečet je
   * nepotvrzený odečet. Bez tohohle testu prošla mutace, která přesně tohle
   * dělala — a suita zůstala zelená.
   */
  it("[JAZYK-05] bez potvrzení člověkem se odhad stroje hodnotou NESTANE, i když existuje", () => {
    const el = vykresli("es-measure", { suggested: "1423" });
    const hodnota = el.querySelector(".mv")?.textContent ?? "";
    expect(hodnota).toContain("—");
    expect(hodnota).not.toContain("1423");
  });
});

describe("es-evidence — chybějící doklad se hlásí nahlas", () => {
  it("[JAZYK-08] nezaplněné sloty se spočítají a řeknou", () => {
    const el = vykresli("es-evidence", {}, [
      { slot: "stav", label: "Displej", filled: true },
      { slot: "okoli", label: "Okolí", filled: false },
    ]);
    expect(el.querySelectorAll(".evs")).toHaveLength(2);
    expect(el.querySelector("es-lamp")?.getAttribute("label")).toContain("1");
  });

  it("[JAZYK-08] když je vše zaplněné, nic se nevytýká", () => {
    const el = vykresli("es-evidence", {}, [{ slot: "stav", label: "Displej", filled: true }]);
    expect(el.querySelector("es-lamp")).toBeNull();
  });

  it("[JAZYK-09] prvek nese STAV, ne obrázky — v markupu není žádné img ani uri", () => {
    const el = vykresli("es-evidence", {}, [
      { slot: "stav", label: "Displej", filled: true, uri: "file:///tajne.jpg" },
    ]);
    expect(el.innerHTML).not.toContain("img");
    expect(el.innerHTML).not.toContain("tajne");
  });
});

describe("escapování", () => {
  it("popisek se značkami se vykreslí jako TEXT, ne jako markup", () => {
    const el = vykresli("es-fact", { label: "x", value: '<img src=x onerror="1">' });
    expect(el.querySelector("img")).toBeNull();
    expect(el.textContent).toContain("<img");
  });

  it("uvozovka ve zdroji nepodvrhne atribut sousedního prvku", () => {
    const el = vykresli("es-measure", { value: "1", source: '" onload="x' });
    expect(el.querySelector("es-prov")?.getAttribute("source")).toBe('" onload="x');
  });
});
