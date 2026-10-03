/**
 * Orientace obrazovky je VLASTNOST PROFILU APPKY, ne konstanta platformy.
 *
 * Majitel 2026-09-30: Řidič na tabletu v kabině se neotáčel podle nastavení displeje.
 * Zámek na výšku byl v app.config.ts natvrdo pro všechny appky; Android 16 ho na
 * velkém displeji ignoruje, Android 15 ne — tablety se chovaly každý jinak.
 * Pravidlo se čte ze zdroje (app.config.ts spouští načtení profilu instance).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const zdroj = readFileSync(join(__dirname, "..", "..", "app.config.ts"), "utf8");

describe("orientace obrazovky z profilu appky", () => {
  it("⛔ žádný zámek na výšku natvrdo — orientaci nese brand.orientation", () => {
    expect(zdroj).not.toMatch(/orientation:\s*'portrait',/);
    expect(zdroj).toMatch(/orientation:\s*orientaceObrazovky\(VERSION\.brand\.orientation\)/);
  });

  it("bez klíče zůstává výška (ostatní appky beze změny), neznámá hodnota zastaví build", () => {
    expect(zdroj).toMatch(/if \(v === undefined\) return 'portrait';/);
    expect(zdroj).toMatch(/v === 'portrait' \|\| v === 'landscape' \|\| v === 'default'/);
    expect(zdroj).toMatch(/throw new Error\(`version\.json brand\.orientation/);
  });
});
