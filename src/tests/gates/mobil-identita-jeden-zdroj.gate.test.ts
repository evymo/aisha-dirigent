/**
 * Identita mobilní appky má JEDEN zdroj — a build skripty si ji nesmí zjišťovat samy.
 *
 * ⛔ PROČ TAHLE BRÁNA VZNIKLA (2026-08-19). Při prvním buildu DRUHÉ appky
 * (RIQ Řidič) se ukázalo, že identitu si zjišťoval každý skript po svém, a
 * všechny stejně špatně — napevno `$PROJECT_DIR/version.json`. `app.config.ts`
 * přitom čte `AISHA_APP_VERSION_FILE` a bez fallbacku. Dokud existovala JEDNA
 * appka, ukazovaly obě cesty na týž soubor a rozdíl nešlo poznat.
 *
 * Co to způsobilo, než se to našlo:
 *   · prepare-xcode-build.sh → poslal operátora otevřít cizí workspace
 *   · post-prebuild.sh       → kopíroval do ios/AISHADirigent/, prebuild
 *                              vyrobil ios/RIQidi/ ⇒ `cp` spadl
 *   · bump-version.sh        → zvedl by verzi PLATFORMĚ místo instanci
 *   · build-android.sh       → táž vada, jen se ještě nestavěl
 *
 * ⭐ MĚŘÍ VLASTNOST, NE PRAVOPIS: skript, který na identitu sahá, ji MUSÍ brát
 * z `app-profile.sh`. Jak se ta proměnná jmenuje ani jak je odsazená, bránu
 * nezajímá.
 *
 * ⭐ A UNIVERZUM SI HLEDÁ: čte adresář `mobile-app/scripts`, ne ručně vedený
 * seznam. Nový skript je tím pádem změřený od chvíle, kdy vznikne — vypsaný
 * seznam by zetlel přesně jako zetlely ty zadrátované cesty.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const SCRIPTS = resolve(process.cwd(), "mobile-app/scripts");
/** Sám zdroj pravdy — ten identitu samozřejmě číst musí. */
const ZDROJ = "app-profile.sh";
/**
 * Sdílená vrstva: soubory, které se SOURCUJÍ a `VERSION_FILE` dostávají od
 * volajícího. Nesourcují `app-profile.sh` právě proto, že jsou jeho sousedé —
 * kdyby ho volaly, byla by to smyčka.
 */
const SDILENE = new Set([ZDROJ, "instance-env-derive.sh"]);

const skripty = readdirSync(SCRIPTS)
  .filter((f) => f.endsWith(".sh") && !SDILENE.has(f))
  .map((f) => ({ jmeno: f, obsah: readFileSync(join(SCRIPTS, f), "utf-8") }));

describe("identita mobilní appky má jeden zdroj", () => {
  it("univerzum není prázdné — brána měří nad skutečnými skripty", () => {
    expect(skripty.length, "mobile-app/scripts neobsahuje .sh — brána by měřila nad ničím").toBeGreaterThan(3);
  });

  it("⛔ žádný skript si necestu k profilu NEZADRÁTUJE", () => {
    const hresi = skripty
      .filter((s) => /VERSION_FILE=["']?\$PROJECT_DIR\/version\.json/.test(s.obsah))
      .map((s) => s.jmeno);
    expect(hresi, `identita se bere z app-profile.sh, ne z pevné cesty: ${hresi.join(", ")}`).toEqual([]);
  });

  it("⛔ kdo na identitu sahá, bere ji z app-profile.sh", () => {
    const hresi = skripty
      .filter((s) => /version\.json|XCODE_NAME|GOOGLE_PLIST_SRC/.test(s.obsah))
      .filter((s) => !s.obsah.includes(ZDROJ))
      .map((s) => s.jmeno);
    expect(hresi, `sahají na identitu, ale nesourcují ${ZDROJ}: ${hresi.join(", ")}`).toEqual([]);
  });

  /**
   * ⛔ Tichý fallback na jméno platformy poslal operátora archivovat CIZÍ appku
   * a `cp` do neexistujícího adresáře. Chybějící hodnota má build zastavit.
   */
  it("⛔ nikde není tichý fallback na identitu platformy", () => {
    const hresi = skripty
      .filter((s) => /=\s*"?\$\{[A-Z_]+:-(AISHADirigent|AISHA Dirigent|cz\.id3a\.aisha)/.test(s.obsah))
      .map((s) => s.jmeno);
    expect(hresi, `fallback na identitu platformy vyrobí archiv s cizím jménem: ${hresi.join(", ")}`).toEqual([]);
  });

  it("zdroj pravdy sám nemá fallback a chybějící profil zastaví", () => {
    const zdroj = readFileSync(join(SCRIPTS, ZDROJ), "utf-8");
    expect(zdroj).toContain("AISHA_APP_VERSION_FILE");
    expect(zdroj, "nepřečtený profil musí build zastavit").toMatch(/exit 1/);
  });

  /*
    KDO STAVÍ, TEN APLIKUJE OVERLAY — všechny cesty k buildu, ne jen dvě.

    ⛔ NAMĚŘENO 2026-09-06. `prepare-xcode-build.sh` (cesta „připrav projekt
    a archivuj z Xcode") overlay NEAPLIKOVAL. S `AISHA_INSTANCE_OVERLAY`
    ukazujícím na overlay JEDNÉ instance vyrobil projekt s xcodeName
    PLATFORMY — tedy cizí aplikaci. Nespadl; jen ji postavil, a poznalo se to
    podle JMÉNA VZNIKLÉHO SOUBORU, ne podle jakékoli hlášky.

    ⛔ Konkrétní slug sem NEPATŘÍ a tenhle komentář ho měl (naměřeno bránou
    `stack-nesmi-znat-jmeno-instance` hned při prvním pushi). Fork se do
    upstreamu vrací jedním merge, takže jméno instance v kódu stacku je dluh,
    který se veze s ním.

    ⭐ Je to potřetí táž vada. Komentář v `build-ios.sh` ji popisuje už
    2026-09-04: overlay se vytáhl do sdíleného souboru právě proto, „aby
    existoval JEDNOU a mohla ho použít i druhá platforma — dokud byl uvnitř,
    Android ho neměl a APK by vzniklo v barvách PLATFORMY, ne instance".
    Při tom vytažení se na třetí cestu zapomnělo.

    ⭐ Univerzum se ČTE: vstupní bod je ten, kdo SÁM volá `expo prebuild`
    (tam se identita zapisuje do projektu). Zmínka v komentáři nebo v `echo`
    se nepočítá — jinak by brána chytala `post-prebuild.sh`, který o prebuildu
    jen píše. Přibude-li zítra čtvrtá cesta, objeví se tu sama.
  */
  it("⛔ každá cesta k buildu aplikuje overlay instance", () => {
    const jeVolani = (radek: string): boolean => {
      const t = radek.trim();
      if (t.startsWith("#")) return false;
      // `echo "... expo prebuild ..."` je text, ne spuštění.
      if (/^echo\b/.test(t)) return false;
      return /(^|[;&|]\s*)(npx\s+)?expo prebuild\b/.test(t);
    };

    // `skripty` nese { jmeno, obsah } — ne holá jména. (Naměřeno na sobě:
    // první verze tohohle testu spadla na `join(SCRIPTS, <objekt>)`.)
    const vstupniBody = skripty.filter((s) => s.obsah.split("\n").some(jeVolani));

    // Prázdná množina = brána mlčí jako zelená. Pojistka proti tomu.
    expect(vstupniBody.length).toBeGreaterThan(0);

    const bezOverlaye = vstupniBody
      .filter((s) => !s.obsah.includes("instance-overlay-apply.sh"))
      .map((s) => s.jmeno);
    // ⛔ Zpráva do POROVNÁVANÉ hodnoty, ne do druhého argumentu `expect`.
    expect(bezOverlaye).toEqual([]);
  });
});
