import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Build musí vědět — a ZAPSAT — z jakého stromu vznikl.
 *
 * ⛔ PROČ EXISTUJE
 * `build-ios.sh` od 2026-08-20 hlídá IDENTITU appky (`AISHA_APP_VERSION_FILE`),
 * protože bez ní jednou vznikla appka pod cizí značkou. OBSAH stromu ale
 * nekontroloval nikdo. 2026-09-01 byl pracovní strom mezi dvěma buildy přepnut
 * na větev z `main` — skript to mlčky přijal a vyrobil dva archivy BEZ opravy
 * klepání a bez položek dodávky. Poznalo se to z fotky obrazovky od majitele.
 *
 * ⭐ MĚŘÍ SE ZÁPIS, NE VÝPIS. Vypsat větev do logu nestačí: log zmizí s oknem
 * terminálu, zatímco archiv se otevírá za týden. Proto razítko do `Info.plist`.
 *
 * ⚠️ Brána NEOVĚŘUJE, že razítko je pravdivé — to by znamenalo stavět. Ověřuje,
 * že skript git vůbec čte, že špinavý strom odmítne a že razítko ukládá.
 */
const ROOT = join(__dirname, "../../..");
/**
 * ⛔ ČTE SE I TO, CO SI SKRIPT PŘITÁHNE. Brána původně četla JEN `build-ios.sh`
 * a spadla ve chvíli, kdy se blok správně přestěhoval do sdíleného
 * `build-provenance.sh` — tedy blokovala vlastní správné vylepšení (2026-09-04).
 * ⭐ Vlastnost zní „build ví, z čeho staví", ne „ta věta stojí v tomhle souboru".
 */
function seSdilenymi(soubor: string, hloubka = 0): string {
  const cesta = join(ROOT, "mobile-app/scripts", soubor);
  let text: string;
  try {
    text = readFileSync(cesta, "utf8");
  } catch {
    return "";
  }
  if (hloubka > 3) return text;
  for (const m of text.matchAll(/\.\s+"\$SCRIPT_DIR\/([a-z0-9-]+\.sh)"/g)) {
    text += "\n" + seSdilenymi(m[1], hloubka + 1);
  }
  return text;
}

const SRC = seSdilenymi("build-ios.sh");

describe("iOS build ví, z čeho staví", () => {
  it("čte větev i commit ze stromu, ve kterém stojí", () => {
    expect(SRC, "chybí čtení větve").toMatch(/rev-parse\s+--abbrev-ref\s+HEAD/);
    expect(SRC, "chybí čtení commitu").toMatch(/rev-parse\s+--short\s+HEAD/);
  });

  it("špinavý strom odmítne, dokud ho člověk vědomě nepovolí", () => {
    expect(SRC, "chybí detekce necommitnutých změn").toMatch(/status\s+--porcelain/);
    expect(
      SRC,
      "musí existovat vědomé povolení — jinak si ho někdo obejde `|| true`",
    ).toMatch(/AISHA_ALLOW_DIRTY_BUILD/);
    expect(SRC, "bez povolení se musí skončit nenulově").toMatch(
      /AISHA_ALLOW_DIRTY_BUILD[^\n]*\]\s*\|\|\s*exit 1/,
    );
  });

  // ⛔ NAMĚŘENO 2026-09-03 na PRVNÍM skutečném buildu s overlayem — obě vady
  // níž se projeví JEN při instančním buildu, tedy přesně v tom případu, kvůli
  // kterému ten skript existuje. Na platformním buildu jsou neviditelné.
  it("čistota se měří na VSTUPU — před přeskinem, ne po něm", () => {
    // ⛔ NEMĚŘÍ SE POZICE V TEXTU. Původní verze porovnávala offsety v jednom
    // souboru; jakmile se bloky správně přestěhovaly do sdílených skriptů,
    // pořadí v SLEPENÉM textu přestalo odpovídat pořadí VYKONÁNÍ a brána
    // spadla na správné změně (2026-09-04).
    // ⭐ Vlastnost je: strom se změří DŘÍV, než ho build sám přepíše. V nové
    // stavbě to znamená pořadí `. "$SCRIPT_DIR/…"` volání.
    const chyby: string[] = [];
    for (const platforma of ["build-ios.sh", "build-android.sh"]) {
      const zdroj = readFileSync(join(ROOT, "mobile-app/scripts", platforma), "utf8")
        .split("\n")
        .filter((r) => !/^\s*#/.test(r))
        .join("\n");
      const puvod = zdroj.search(/build-provenance\.sh/);
      const overlay = zdroj.search(/instance-overlay-apply\.sh/);
      if (puvod === -1) chyby.push(`${platforma}: nevolá build-provenance.sh`);
      if (overlay === -1) chyby.push(`${platforma}: nevolá instance-overlay-apply.sh`);
      if (puvod > -1 && overlay > -1 && puvod > overlay)
        chyby.push(
          `${platforma}: čistota se měří AŽ ZA přeskinem — build by padal na souboru, ` +
            "který si sám přepsal, a pojistka by se musela vypínat",
        );
    }
    expect(chyby).toEqual([]);
  });

  it("identitu odvodí z overlaye — overlay je JEDINÝ kanál, neptá se na ni dvakrát", () => {
    // `app.config.ts` čte identitu z `AISHA_APP_VERSION_FILE`. Když ji skript
    // z overlaye neodvodí, Xcode spadne až ve skriptové fázi `Generate
    // app.config` — tedy po celé kompilaci, ne na začátku.
    expect(
      SRC,
      "skript identitu z overlaye NEODVOZUJE — build spadne až ve skriptové fázi Xcode",
    ).toMatch(/AISHA_APP_VERSION_FILE=/);
    expect(SRC, "odvozená hodnota se musí vyexportovat, jinak ji Xcode neuvidí").toMatch(
      /export\s+AISHA_APP_VERSION_FILE/,
    );
    // ⭐ Volající má mít přednost: kdo si identitu vysloví sám, toho nepřebíjíme.
    expect(
      SRC,
      "odvození musí být podmíněné — jinak přebije volajícího, který si ji nastavil sám",
    ).toMatch(/if\s+\[\s+-z\s+"\$\{AISHA_APP_VERSION_FILE:-\}"\s+\]/);
  });

  it("razítko se ZAPISUJE do archivu, nejen vypisuje do logu", () => {
    expect(SRC, "chybí zápis větve do Info.plist archivu").toMatch(/AishaSourceBranch/);
    expect(SRC, "chybí zápis commitu do Info.plist archivu").toMatch(/AishaSourceCommit/);
    expect(SRC, "razítko musí jít přes PlistBuddy do ARCHIVE_PATH").toMatch(
      /PlistBuddy[\s\S]{0,200}ARCHIVE_PATH\/Info\.plist/,
    );
  });
});
