import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Jeden jazyk, dva renderery — a důkaz v obou.
 *
 * Extranet mluví jedním jazykem, ale kreslí ho dvakrát: webově
 * (`packages/extranet-sdk-ui`, custom elements) a nativně
 * (`mobile-app/src/extranet/esdk.tsx`, React Native). Sdílený KÓD to spojit
 * nemůže — React Native nemá `react-dom` a `es-*` jsou custom elements —
 * takže paritu musí držet sdílený DŮKAZ.
 *
 * ⭐ MĚŘÍ SE VLASTNOST, NE PRAVOPIS. Bránu nezajímá, jak se komponenta jmenuje
 * ani co vypíše. Zajímá ji jediné: pro každé pravidlo jazyka existuje test
 * v OBOU sadách. Přidat pravidlo do `JAZYK.json` proto zčervená, dokud ho oba
 * renderery nedoloží — a to je zamýšlený tlak, ne obtíž.
 *
 * ⛔ PROČ NE SNÍMEK VZHLEDU: dva renderery na dvou platformách se vizuálně
 * nikdy neshodnou na pixel, takže snímková parita by buď šuměla, nebo by se
 * musela tolerovat tak volně, že by přestala měřit. Věty o datech se ale
 * shodnout MUSÍ — a právě ty rozhodují, jestli si dispečer a řidič o téže věci
 * myslí totéž.
 */
const ROOT = join(__dirname, "../../..");

/**
 * Pravidla jazyka se berou z BALÍKU, ne z kopie v repu.
 *
 * ⛔ 2026-08-17 se `packages/extranet-sdk-ui` (0.1.0) smazal a jazyk se přesunul
 * do `@aisha/extranet-sdk-ui` na Verdacciu. Kdyby tahle cesta zůstala ukazovat
 * do `packages/`, brána by po smazání spadla na chybějící soubor — a kdyby si
 * někdo „pomohl" fallbackem na prázdný seznam, svítila by zeleně a NEMĚŘILA BY
 * NIC. Proto se čte balík a při jeho nepřítomnosti se hlásí ztráta předmětu.
 */
const JAZYK = join(ROOT, "node_modules/@aisha/extranet-sdk-ui/JAZYK.json");
const SADY = [
  { kdo: "web (custom elements)", soubor: "src/tests/esdk-polni-slovnik.test.ts" },
  { kdo: "mobil (React Native)", soubor: "mobile-app/src/__tests__/esdkNativni.test.tsx" },
];

interface Pravidlo {
  id: string;
  veta: string;
  proc: string;
}

function pravidla(): Pravidlo[] {
  // Chybějící balík je ZTRÁTA PŘEDMĚTU, ne „nula pravidel". Bez téhle věty by
  // se `npm ci`, který balík nedotáhl, projevil jako zelená brána.
  expect(
    existsSync(JAZYK),
    `${JAZYK} neexistuje — @aisha/extranet-sdk-ui není nainstalovaný, takže ` +
      "brána nemá co měřit. Nespouštěj ji bez závislostí a NEDOPLŇUJ fallback.",
  ).toBe(true);
  const raw = JSON.parse(readFileSync(JAZYK, "utf8")) as { pravidla?: Pravidlo[] };
  const list = raw.pravidla ?? [];
  // Prázdný seznam by udělal každé tvrzení níž bezobsažným — brána by svítila
  // zeleně, aniž by cokoli měřila.
  expect(list.length, "JAZYK.json nemá žádná pravidla — brána ztratila předmět").toBeGreaterThan(3);
  return list;
}

/** Id pravidel, na která se sada odkazuje v názvech testů. */
function dolozena(soubor: string): Set<string> {
  const src = readFileSync(join(ROOT, soubor), "utf8");
  return new Set([...src.matchAll(/\[(JAZYK-\d+)\]/g)].map((m) => m[1]));
}

describe("jazyk extranetu — každé pravidlo doloží OBA renderery", () => {
  const vsechna = pravidla();

  it("obě sady vůbec existují a odkazují se na pravidla", () => {
    for (const { kdo, soubor } of SADY) {
      const ids = dolozena(soubor);
      expect(ids.size, `${kdo}: sada ${soubor} se neodkazuje na žádné pravidlo`).toBeGreaterThan(0);
    }
  });

  for (const { id, veta } of vsechna) {
    it(`${id} doloží oba renderery — „${veta}“`, () => {
      const chybi = SADY.filter(({ soubor }) => !dolozena(soubor).has(id)).map((x) => x.kdo);
      expect(
        chybi,
        `Pravidlo ${id} („${veta}“) nedokládá: ${chybi.join(", ")}.\n` +
          `Přidej test, jehož název obsahuje [${id}], do odpovídající sady — ` +
          `nebo pravidlo z JAZYK.json odeber, pokud už jazyk neplatí.`,
      ).toEqual([]);
    });
  }

  it("žádná sada se neodkazuje na pravidlo, které v jazyce NENÍ", () => {
    // Osiřelý odkaz znamená buď překlep (test tedy nedokládá, co si myslí),
    // nebo pravidlo, které někdo z jazyka odebral a důkaz po něm zůstal.
    const znama = new Set(vsechna.map((p) => p.id));
    for (const { kdo, soubor } of SADY) {
      const osirele = [...dolozena(soubor)].filter((id) => !znama.has(id));
      expect(osirele, `${kdo}: odkazy na neexistující pravidla: ${osirele.join(", ")}`).toEqual([]);
    }
  });

  it("nativní renderer NEIMPORTUJE ESDK — jinak by se mobil při buildu rozbil", () => {
    // React Native nemá `react-dom` a `es-*` jsou custom elements. Import by
    // prošel typovou kontrolou a spadl až na zařízení, tedy nejdráž.
    const src = readFileSync(join(ROOT, "mobile-app/src/extranet/esdk.tsx"), "utf8");
    expect(src).not.toMatch(/from\s+['"]extranet-sdk-ui/);
  });
});
