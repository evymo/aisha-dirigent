import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Slovník jazyka musí obsahovat všechna jeho slova.
 *
 * `custom-elements.json` je způsob, jakým balík OZNAMUJE, co umí — `package.json`
 * na něj ukazuje polem `customElements`, čtou ho editory, dokumentace i lidé,
 * kteří se ptají „co v tomhle jazyce vůbec můžu říct?". Prvek, který v něm není,
 * pro ně NEEXISTUJE, i když v kódu funguje.
 *
 * ⛔ NAMĚŘENO 2026-08-09: zdroj měl 19 prvků, slovník 14. Chyběly `es-stmt`
 * a `es-tree` (dávno) a `es-fact`, `es-measure`, `es-evidence` (téhož dne
 * přidané). Manifest se totiž píše RUKOU a nic ho neověřovalo — takže drift
 * nebyl náhoda, ale jediný možný výsledek. Přesně proto to hlídá brána a ne
 * jednorázová oprava.
 *
 * ⭐ UNIVERZUM SE HLEDÁ VE ZDROJI, NEPÍŠE SE SEM. Kdyby tenhle soubor nesl
 * seznam prvků, měl by tutéž vadu, kterou má léčit: rozešel by se stejně tiše.
 * Proto se čte `src/*.js` a slovník se poměřuje PROTI němu.
 */
const ROOT = join(__dirname, "../../..");
/**
 * Slovník se čte z BALÍKU, ne z kopie v repu.
 *
 * ⛔ 2026-08-17 se `packages/extranet-sdk-ui` (0.1.0) smazal a jazyk se přesunul
 * do `@aisha/extranet-sdk-ui` na Verdacciu. Kdyby tahle cesta ukazovala dál do
 * `packages/`, brána by po smazání spadla na chybějící adresář — a to je právě
 * ta chvíle, kdy někdo „pomůže" podmínkou a měřidlo tiše oněmí.
 */
const BALIK = join(ROOT, "node_modules/@aisha/extranet-sdk-ui");
const SLOVNIK = join(BALIK, "custom-elements.json");

/** Nejmenší počet prvků, pod kterým je pravděpodobnější slepý vzorec než malý jazyk. */
const PODLAHA = 10;

interface Deklarace {
  tagName?: string;
  description?: string;
  attributes?: { name: string }[];
}

function zdrojoveSoubory(): { jmeno: string; text: string }[] {
  return readdirSync(join(BALIK, "src"))
    .filter((f) => f.endsWith(".js"))
    .map((jmeno) => ({ jmeno, text: readFileSync(join(BALIK, "src", jmeno), "utf8") }));
}

/** Tagy, které zdroj SKUTEČNĚ definuje — dvěma způsoby, jimiž to balík dělá. */
function tagyZeZdroje(): Set<string> {
  const tagy = new Set<string>();
  for (const { text } of zdrojoveSoubory()) {
    for (const m of text.matchAll(/static\s+tag\s*=\s*['"]([a-z][a-z0-9-]*)['"]/g)) tagy.add(m[1]);
    for (const m of text.matchAll(/customElements\.define\(\s*['"]([a-z][a-z0-9-]*)['"]/g)) {
      tagy.add(m[1]);
    }
  }
  return tagy;
}

/** Pro každý tag atributy, které třída deklaruje jako sledované (`static observed`). */
function sledovaneZeZdroje(): Map<string, string[]> {
  const mapa = new Map<string, string[]>();
  for (const { text } of zdrojoveSoubory()) {
    // Kus textu od jednoho `static tag` k dalšímu = tělo jedné třídy.
    const kusy = text.split(/(?=static\s+tag\s*=)/);
    for (const kus of kusy) {
      const tag = kus.match(/static\s+tag\s*=\s*['"]([a-z][a-z0-9-]*)['"]/)?.[1];
      if (!tag) continue;
      const obs = kus.match(/static\s+observed\s*=\s*\[([^\]]*)\]/);
      if (!obs) continue;
      mapa.set(
        tag,
        [...obs[1].matchAll(/['"]([a-zA-Z][a-zA-Z0-9-]*)['"]/g)].map((m) => m[1]).sort(),
      );
    }
  }
  return mapa;
}

function deklarace(): Deklarace[] {
  const raw = JSON.parse(readFileSync(SLOVNIK, "utf8")) as {
    modules?: { declarations?: Deklarace[] }[];
  };
  return (raw.modules ?? []).flatMap((m) => m.declarations ?? []).filter((d) => d.tagName);
}

describe("ESDK — slovník odpovídá jazyku", () => {
  const zdroj = tagyZeZdroje();
  const slovnik = deklarace();
  const deklarovane = new Set(slovnik.map((d) => d.tagName as string));

  it("vzorec vůbec něco našel — jinak by vše níž bylo bezobsažné", () => {
    expect(
      zdroj.size,
      `Ve zdrojích balíku jsem našel ${zdroj.size} prvků. Buď se změnil způsob ` +
        `jejich definice, nebo je vzorec téhle brány slepý — v obou případech ` +
        `neměří nic a nesmí svítit zeleně.`,
    ).toBeGreaterThan(PODLAHA);
    expect(deklarovane.size, "custom-elements.json nedeklaruje žádný prvek").toBeGreaterThan(
      PODLAHA,
    );
  });

  it("každý prvek ze zdroje je ve slovníku", () => {
    const chybi = [...zdroj].filter((t) => !deklarovane.has(t)).sort();
    expect(
      chybi,
      `Prvky, které kód definuje, ale slovník o nich mlčí: ${chybi.join(", ")}.\n` +
        `Pro kohokoli, kdo čte custom-elements.json, tyhle prvky NEEXISTUJÍ.\n` +
        `Doplň je do custom-elements.json v repu @aisha/extranet-sdk a vydej novou verzi.`,
    ).toEqual([]);
  });

  it("slovník neslibuje prvek, který zdroj nedefinuje", () => {
    const navic = [...deklarovane].filter((t) => !zdroj.has(t)).sort();
    expect(
      navic,
      `Slovník deklaruje prvky, které v kódu nejsou: ${navic.join(", ")}.\n` +
        `Buď je někdo odebral a zapomněl na slovník, nebo je to překlep v tagu — ` +
        `obojí končí tím, že si někdo napíše element, který se nikdy nevykreslí.`,
    ).toEqual([]);
  });

  it("žádné slovo bez významu — každá deklarace má popis", () => {
    const bezPopisu = slovnik
      .filter((d) => !d.description || !d.description.trim())
      .map((d) => d.tagName as string)
      .sort();
    expect(
      bezPopisu,
      `Prvky bez popisu: ${bezPopisu.join(", ")}. Heslo ve slovníku bez významu ` +
        `je jen o málo lepší než chybějící heslo.`,
    ).toEqual([]);
  });

  it("sledované atributy sedí s tím, co slovník vypisuje", () => {
    // `static observed` je to, na co element REAGUJE. Když se rozejde s výpisem
    // ve slovníku, čtenář buď nastavuje atribut, který se ignoruje, nebo o
    // fungujícím atributu neví.
    const sledovane = sledovaneZeZdroje();
    expect(sledovane.size, "žádná třída nemá `static observed` — vzorec je nejspíš slepý").toBeGreaterThan(0);

    const rozdily: string[] = [];
    for (const [tag, atributy] of sledovane) {
      const d = slovnik.find((x) => x.tagName === tag);
      if (!d) continue; // pokryto testem výše
      const vypsane = (d.attributes ?? []).map((a) => a.name).sort();
      if (JSON.stringify(vypsane) !== JSON.stringify(atributy)) {
        rozdily.push(`${tag}: zdroj sleduje [${atributy}], slovník vypisuje [${vypsane}]`);
      }
    }
    expect(rozdily, `Rozešlé atributy:\n  ${rozdily.join("\n  ")}`).toEqual([]);
  });
});
