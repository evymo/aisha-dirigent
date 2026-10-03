/**
 * Gate: identita mobilní aplikace se nesmí dosadit sama a Firebase musí umět obě platformy.
 *
 * PROČ (změřeno 2026-08-05 při zavádění nové instance)
 * ---------------------------------------------------
 * 1) `loadVersionConfig` měl v `catch` natvrdo identitu platformy
 *    (`cz.id3a.aisha.app`, `AISHA Dirigent`). Když se `version.json` nepodařilo
 *    přečíst — což u instančního buildu, kde se ukazuje jinam, nastane snadno —
 *    build **prošel** a vyrobil aplikaci s CIZÍM bundle ID a jménem. Pozná se to
 *    až ve storu, kde už je pozdě. Tichá výchozí hodnota tu není pohodlí, je to
 *    záměna identity zákazníka.
 *
 * 2) Firebase pluginy se načítaly podle existence JEN iOS plistu. Android build
 *    tak vyjel bez pushe i tehdy, když `google-services.json` na místě byl —
 *    a `android.googleServicesFile` v konfiguraci nebyl vůbec.
 *
 * Obojí je neviditelné: build je zelený a chyba je až v hotovém artefaktu.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");
const CONFIG = resolve(ROOT, "mobile-app/app.config.ts");

/** Univerzum se seeduje ze skutečnosti — brána nad chybějícím souborem projde vždycky. */
const src = existsSync(CONFIG) ? readFileSync(CONFIG, "utf-8") : "";

/** Tělo `loadVersionConfig` — jen tam dává smysl hledat dosazenou identitu. */
function loadVersionConfigBody(): string {
  const start = src.indexOf("const loadVersionConfig");
  if (start < 0) return "";
  // funkce končí u dalšího `\nconst ` na začátku řádku
  const rest = src.slice(start + 1);
  const end = rest.indexOf("\nconst ");
  return end < 0 ? rest : rest.slice(0, end);
}

describe("mobilní identita se nedosazuje sama", () => {
  it("univerzum není prázdné", () => {
    expect(existsSync(CONFIG), `${CONFIG} neexistuje — brána by měřila nic`).toBe(true);
    expect(src).toContain("loadVersionConfig");
  });

  it("⭐ nepřečtená identita build ZASTAVÍ, nedosadí se výchozí", () => {
    const body = loadVersionConfigBody();
    expect(body.length).toBeGreaterThan(0);
    // Konkrétní bundle/jméno platformy uvnitř té funkce = dosazená identita.
    for (const literal of ["cz.id3a.aisha.app", "AISHA Dirigent", "aisha-dirigent"]) {
      expect(
        body.includes(literal),
        `loadVersionConfig obsahuje literál "${literal}" — to je dosazená identita platformy. ` +
          "Instanční build, kterému se nepodaří přečíst version.json, by pak vyrobil aplikaci " +
          "s CIZÍM bundle ID a poznalo by se to až ve storu. Nepřečtený soubor musí build zastavit.",
      ).toBe(false);
    }
    expect(body, "chybí vyhození chyby při nepřečtení").toMatch(/throw new Error/);
  });

  it("identitu jde přebít instančně, aniž se sahá na soubor platformy", () => {
    expect(
      src,
      "bez přepínače by instance musela přepisovat mobile-app/version.json, " +
        "což je soubor platformy sdílený všemi instancemi",
    ).toContain("AISHA_APP_VERSION_FILE");
  });

  it("⭐ Firebase se zapojí i podle ANDROID konfigurace, nejen iOS", () => {
    expect(src).toContain("google-services.json");
    // pluginy nesmí viset jen na iOS plistu
    const pluginRadek = src.split("\n").find((l) => l.includes("firebasePlugins ="));
    expect(pluginRadek, "nenašel jsem rozhodování o Firebase pluginech").toBeTruthy();
    expect(
      pluginRadek,
      "pluginy se rozhodují jen podle iOS plistu — Android build by tiše vyjel bez pushe",
    ).not.toMatch(/hasIosFirebase\s*$/);
  });

  it("android sekce předává googleServicesFile stejně jako ios", () => {
    // ⛔ DŘÍV TU BYLO `slice(start, start + 900)` — PEVNÉ OKNO ZNAKŮ, tedy měřidlo
    // pravopisu, ne vlastnosti. 2026-08-19 stačilo do android sekce přidat
    // komentář (`allowBackup: false` a proč), sekce narostla na 1335 znaků,
    // `googleServicesFile` skončil na pozici 1047 — a brána zčervenala nad
    // konfigurací, která byla v POŘÁDKU. Brána, kterou rozhodí délka komentáře,
    // učí lidi komentáře nepsat.
    //
    // Sekce se proto najde PÁROVÁNÍM ZÁVOREK: to je její skutečná hranice, ať je
    // uvnitř textu kolik chce.
    const androidStart = src.indexOf("    android: {");
    expect(androidStart).toBeGreaterThan(0);
    const androidBlok = (() => {
      let hloubka = 0;
      for (let j = androidStart; j < src.length; j++) {
        if (src[j] === "{") hloubka++;
        else if (src[j] === "}") {
          hloubka--;
          if (hloubka === 0) return src.slice(androidStart, j);
        }
      }
      return src.slice(androidStart);
    })();
    expect(
      androidBlok,
      "android.googleServicesFile chybí — soubor by ležel na místě a build by ho ignoroval",
    ).toContain("googleServicesFile");
  });

  it("obě konfigurace jsou ignorované gitem (nesou API klíč a jsou instanční)", () => {
    const ignore = readFileSync(resolve(ROOT, "mobile-app/.gitignore"), "utf-8");
    for (const f of ["GoogleService-Info.plist", "google-services.json"]) {
      expect(ignore, `${f} není v mobile-app/.gitignore`).toContain(f);
    }
  });
});
