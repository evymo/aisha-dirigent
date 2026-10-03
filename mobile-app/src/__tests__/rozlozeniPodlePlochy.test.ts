// ⛔ ŽÁDNÝ IMPORT TESTOVACÍHO RÁMCE. `mobile-app` pouští testy JESTEM
// (`"test": "jest"`), který `describe`/`it`/`expect` dává GLOBÁLNĚ — import
// z "vitest" pod ním spadne na `Vitest cannot be imported in a CommonJS
// module using require()`. Naměřeno 2026-09-03 na #292: lokálně jsem to
// pouštěl `npx vitest` a bylo zeleno, v CI červeno.
// ⭐ Týž kořen jako TS2554 dřív: `@types/jest` v tomhle balíčku není omyl,
// je to POPIS toho, čím se tu měří. Ostatní testy v této složce proto žádný
// rámec neimportují — držím se toho.
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Rozložení se rozhoduje podle PLOCHY, ne podle zařízení.
 *
 * ⛔ PROČ TO HLÍDÁME
 * `docs/predani-ocima-ridice-ux-2026-08-20.md` (N13) master–detail zamítl,
 * protože tablet byl tehdy nahodilý. 2026-09-03 se premisa změnila — řidiči
 * dostávají 10" tablety — a master–detail se vrátil. Riziko té změny je, že
 * se do kódu vplíží seznam zařízení: „je to iPad?", „je to tablet?". Takový
 * seznam zastará dřív, než se dopíše, a otočený telefon ani rozdělená
 * obrazovka do něj nikdy nezapadnou.
 */
const SRC = join(__dirname, "..");
const ROZLOZENI = readFileSync(join(SRC, "lib/rozlozeni.ts"), "utf8");
const KROKY = readFileSync(join(SRC, "app/kroky.tsx"), "utf8");
const PASKA = readFileSync(join(SRC, "components/PaskaKroku.tsx"), "utf8");

/**
 * Konstanty se ČTOU ZE ZDROJE, ne importují.
 *
 * ⛔ Tahle testovací sada aplikační moduly NEROZKLÁDÁ — `@/…` v ní selže
 * (naměřeno 2026-09-03: `apiConfig.test.ts` padá `Failed to resolve import
 * "@/config/api"` i bez jakékoli mé změny). Fungující testy v téhle složce
 * proto čtou soubory a měří jejich obsah; držím se téhož vzoru, místo abych
 * kvůli jednomu testu přestavoval infrastrukturu.
 */
function cislo(zdroj: string, jmeno: string): number {
  const m = zdroj.match(new RegExp(`${jmeno}\\s*=\\s*(\\d+)`));
  if (!m) throw new Error(`konstanta ${jmeno} ve zdroji není`);
  return Number(m[1]);
}
const PASKA_SIRKA_DP = cislo(ROZLOZENI, "PASKA_SIRKA_DP");
const SLOUPEC_MAX_DP = cislo(
  readFileSync(join(SRC, "lib/sirkaObsahu.ts"), "utf8"),
  "SLOUPEC_MAX_DP",
);

/** Komentáře pryč — jinak měřidlo měří text o kódu místo kódu. */
const kod = (s: string) =>
  s
    .split("\n")
    .filter((r) => !/^\s*(\/\/|\*|\/\*)/.test(r))
    .join("\n");

describe("rozložení podle plochy", () => {
  it("nikde se neptá na zařízení — jen na šířku", () => {
    // ⛔ ZPRÁVA PATŘÍ DO POROVNÁVANÉ HODNOTY. `expect(x, "zpráva")` za běhu
    // projde, ale TypeScript v CI ji odmítne (`TS2554`) — `mobile-app` má
    // `@types/jest`, jehož `expect` bere JEDEN argument. Naměřeno 2026-09-03 na
    // #287: lokálně zeleno, v CI červeno. Běh a typy jsou dvě různá měřidla.
    const nalezy: string[] = [];
    const soubory = [
      { jmeno: "lib/rozlozeni.ts", zdroj: ROZLOZENI },
      { jmeno: "app/kroky.tsx", zdroj: KROKY },
      { jmeno: "components/PaskaKroku.tsx", zdroj: PASKA },
    ];
    for (const { jmeno, zdroj } of soubory) {
      const c = kod(zdroj);
      if (/Platform\.isPad/.test(c)) nalezy.push(`${jmeno}: Platform.isPad je podmínka na ZAŘÍZENÍ`);
      if (/\bisTablet\b/.test(c)) nalezy.push(`${jmeno}: isTablet je podmínka na ZAŘÍZENÍ`);
      if (/deviceType|DeviceType|getModel/.test(c))
        nalezy.push(`${jmeno}: model zařízení nesmí rozhodovat o rozložení`);
    }
    if (!/useWindowDimensions/.test(kod(ROZLOZENI)))
      nalezy.push("lib/rozlozeni.ts: šířka se musí brát z okna, aby reagovala na otočení");
    expect(nalezy).toEqual([]);
  });

  it("práh nechá vedle čitelného sloupce ještě místo na pásku", () => {
    // ⭐ Kdyby práh byl NIŽŠÍ než čitelný sloupec, vznikly by dva proužky a
    // ani jeden by nebyl čitelný — tedy horší výsledek než jednosloupcovka.
    // ⭐ PRÁH MUSÍ BÝT ODVOZENÝ, NE VYMYŠLENÝ. Nejdřív tu stálo 700 a test
    // ukázal, že by detailu zbylo 340 — míň než rejstříku. Číslo napsané rukou
    // se rozejde s tím, co má popisovat; součet ne.
    const odvozeny = /PRAH_DVOUSLOUPCE_DP\s*=\s*PASKA_SIRKA_DP\s*\+\s*SLOUPEC_MAX_DP/.test(
      kod(ROZLOZENI),
    );
    expect(
      odvozeny ? [] : ["práh musí být SOUČET rejstříku a čitelného sloupce, ne literál"],
    ).toEqual([]);

    const prah = PASKA_SIRKA_DP + SLOUPEC_MAX_DP;
    const detailNaPrahu = prah - PASKA_SIRKA_DP;
    // Na prahu musí detailu zbýt CELÝ čitelný sloupec.
    expect(detailNaPrahu).toBeGreaterThanOrEqual(SLOUPEC_MAX_DP);
    // A rejstřík musí zůstat užší než práce.
    expect(PASKA_SIRKA_DP).toBeLessThan(detailNaPrahu);
  });

  it("páska drží CELOU frontu, detail zůstává beze změny", () => {
    const c = kod(KROKY);
    const chyby: string[] = [];
    // Detail se nesmí měnit: `all` je pořád táž větev jako na telefonu.
    if (!/const all: WorkflowStep\[\] = focused \? \[focused\]/.test(c))
      chyby.push("detail se nesmí větvit podle rozložení");
    // Páska bere frontu ze STEJNÉHO dotazu — druhý zdroj by se rozešel.
    if (!/doPasky[^\n]*=\s*steps\.data/.test(c))
      chyby.push("páska musí brát data ze `steps`, ne z vlastního dotazu");
    if (!/dvousloupec\s*&&/.test(c)) chyby.push("páska se kreslí jen nad prahem");
    expect(chyby).toEqual([]);
  });
});
