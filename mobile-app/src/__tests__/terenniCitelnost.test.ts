/**
 * Terénní čitelnost — podlaha pro obrazovky, které se čtou U KAMIONU.
 *
 * ⛔ NAMĚŘENO 2026-08-20 (WCAG 2.1 kontrastní poměr proti `colors.background`
 * #0E0E10):
 *     colors.text           19.28:1   ✓
 *     colors.textSecondary   6.90:1   ✓
 *     colors.textMuted       3.60:1   ⛔ POD AA (4.5:1 pro běžný text)
 *
 * `textMuted` byl v `kroky.tsx` na SEDMI místech, a nesl přitom informace:
 * doklad s produktem, popis kroku, dispečerskou poznámku, nápovědu pole. Na
 * displeji v ruce, na slunci, přes sluneční brýle je to nečitelné — a člověk
 * pak potvrzuje předání podle toho, co si pamatuje, ne podle toho, co vidí.
 *
 * ⭐ UNIVERZUM SE ODVOZUJE, NEPÍŠE. Ručně vedený seznam obrazovek by zetlel
 * první novou komponentou. Brána proto vyjde ze VSTUPNÍCH OBRAZOVEK řidiče
 * a projde jejich importy do `src/components` do hloubky — co si obrazovka
 * přitáhne, to měří.
 *
 * ⚠️ VÝJIMKA JE MĚŘENÁ, NE V HLAVĚ. Uppercase popisek s prostrkáním (eyebrow)
 * je strukturální značka, ne obsah, a čte se větší, než je jeho nominální
 * velikost. Brána ho proto pouští — ale jen tehdy, když si to opravdu řekne
 * (`textTransform: "uppercase"` v TÉMŽE stylu), takže se pod tu výjimku nedá
 * schovat běžný text.
 */
import fs from "node:fs";
import path from "node:path";

/** Nejmenší text, který se dá přečíst v ruce u rampy. */
const PODLAHA_PX = 13;

/** Barvy pod AA (4.5:1) proti pozadí appky — do informací nepatří. */
const ZAKAZANE_BARVY = ["colors.textMuted"];

/**
 * Kód BEZ komentářů.
 *
 * ⛔ NAMĚŘENO 2026-09-03: brána četla syrový soubor, takže zčervenala na
 * KOMENTÁŘI, který vysvětloval, PROČ se ten token nesmí použít. Trestat
 * dokumentaci o pravidle je zvrácené — v praxi to vede k tomu, že se důvod
 * nezapíše vůbec, protože „to shazuje bránu".
 *
 * ⭐ Komentář nemá kontrast. Rozhoduje jen to, co se opravdu vykoná.
 */
function bezKomentaru(zdroj: string): string {
  return zdroj
    .replace(/\/\*[\s\S]*?\*\//g, "")  // blokové
    .replace(/(^|[^:])\/\/.*$/gm, "$1"); // řádkové (":" chrání http://)
}

const KOREN = path.join(__dirname, "..");

/**
 * Odkud řidič vychází.
 *
 * ⚠️ Tenhle seznam je JEDINÁ ručně psaná věc a je jí schválně málo: jsou to
 * VSTUPY, ne inventář. Co z nich roste, si brána najde sama.
 */
const VSTUPY = ["app/porada.tsx", "app/kroky.tsx"];

/** Cesty, které importy sledujeme. Kreslení bydlí tady. */
/**
 * Kde bydlí kreslení. ⛔ `extranet/` tu MUSÍ být: `BlockRenderer` kreslí
 * řidičovu pásku, a bez něj by brána měřila obrazovku bez jejího obsahu.
 */
const SLEDOVANE = ["components/", "extranet/"];

function precti(rel: string): string | null {
  for (const p of [rel, `${rel}.tsx`, `${rel}.ts`, `${rel}/index.tsx`, `${rel}/index.ts`]) {
    const abs = path.join(KOREN, p);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
  }
  return null;
}

/** Univerzum: vstupy + vše, co si přitáhnou z `src/components`. */
function univerzum(): string[] {
  const videt = new Set<string>();
  const fronta: string[] = [];
  for (const v of VSTUPY) {
    const abs = precti(v);
    if (abs) { videt.add(abs); fronta.push(abs); }
  }
  while (fronta.length > 0) {
    const abs = fronta.shift()!;
    const zdroj = fs.readFileSync(abs, "utf8");
    for (const m of zdroj.matchAll(/from\s+["'](@\/[^"']+|\.[^"']+)["']/g)) {
      const spec = m[1];
      const rel = spec.startsWith("@/")
        ? spec.slice(2)
        : path.relative(KOREN, path.resolve(path.dirname(abs), spec));
      if (!SLEDOVANE.some((s) => rel.startsWith(s))) continue;
      const cil = precti(rel);
      if (cil && !videt.has(cil)) { videt.add(cil); fronta.push(cil); }
    }
  }
  return [...videt].sort();
}

const SOUBORY = univerzum();

describe("univerzum se odvozuje", () => {
  it("vstupy existují a něco si přitáhly", () => {
    // Prázdná množina není čistý strom — je to slepá brána.
    expect(SOUBORY.length).toBeGreaterThan(VSTUPY.length);
  });

  it("obsahuje komponenty, které řidič opravdu drží", () => {
    const jmena = SOUBORY.map((f) => path.basename(f));
    expect(jmena).toEqual(expect.arrayContaining([
      "kroky.tsx", "MomentPodpisu.tsx", "PruhFronty.tsx", "EvidencePhotos.tsx",
    ]));
  });
});

describe("kontrast", () => {
  it.each(SOUBORY.map((f) => [path.relative(KOREN, f), f]))(
    "%s nepoužívá barvu pod AA", (_jmeno, soubor) => {
      const zdroj = bezKomentaru(fs.readFileSync(soubor as string, "utf8"));
      for (const barva of ZAKAZANE_BARVY) {
        expect(zdroj).not.toContain(barva);
      }
    });
});

describe("velikost písma", () => {
  it.each(SOUBORY.map((f) => [path.relative(KOREN, f), f]))(
    `%s drží podlahu ${PODLAHA_PX} px`, (_jmeno, soubor) => {
      const zdroj = fs.readFileSync(soubor as string, "utf8");
      const hrisnici: string[] = [];
      // Styl = jeden `{ … }` blok; výjimku hledáme v TÉMŽE bloku, aby se pod ni
      // nedal schovat sousední řádek.
      for (const blok of zdroj.matchAll(/\{[^{}]*fontSize:\s*([0-9.]+)[^{}]*\}/g)) {
        const px = Number(blok[1]);
        if (px >= PODLAHA_PX) continue;
        if (/textTransform:\s*["']uppercase["']/.test(blok[0])) continue;
        hrisnici.push(`${px}px v ${blok[0].replace(/\s+/g, " ").slice(0, 90)}`);
      }
      expect(hrisnici).toEqual([]);
    });
});
