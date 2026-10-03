/**
 * Ke dveřím se musí dát dostat PŘED přihlášením.
 *
 * ⛔ ZADÁNÍ MAJITELE (2026-08-20): *„můžeme to zařízení udělat neautorizovaným
 * a nešlo by se dostat do režimu mít možnost zaťukat ručně."*
 *
 * ⛔ NAMĚŘENO TÝŽ DEN: jediná cesta k `/zaklepat` vedla z banneru v `kroky.tsx`,
 * a ten se rozsvítí až po NEÚSPĚŠNÉM ODESLÁNÍ — tedy až když je člověk
 * přihlášený. V cílovém modelu se ale zavírá PŘED přihlášením, takže odvolané
 * pověření znamenalo telefon, ze kterého se nedá zaťukat.
 *
 * ⭐ UNIVERZUM SE ODVOZUJE: obrazovky před přihlášením jsou soubory pod
 * `app/(auth)/`. Ručně psaný seznam by zetlel první novou obrazovkou.
 */
import fs from "node:fs";
import path from "node:path";

const AUTH = path.join(__dirname, "..", "app", "(auth)");

const obrazovky = fs
  .readdirSync(AUTH)
  .filter((f) => f.endsWith(".tsx") && f !== "_layout.tsx");

/**
 * ⛔ DOPLNĚNO 2026-09-02 na žádost majitele: „ať se k tomu nemusí dostávat přes
 * URL, ale i kliknutím na ten symbol".
 *
 * Předchozí brána hlídala jen cestu PŘED přihlášením. Po přihlášení ale vedla
 * k `/zaklepat` jedině z banneru po NEÚSPĚŠNÉM odeslání — takže kdo se dostal
 * dovnitř a potřeboval zaťukat znovu (vypršel otvor, změnila se síť), musel
 * adresu opsat ručně.
 *
 * ⭐ Hlídá se HLAVIČKA ZÁLOŽEK, protože ta je na každé obrazovce appky. Kdyby
 * se kontroloval jen výskyt `/zaklepat` kdekoli v `app/`, prošel by i banner,
 * který se rozsvítí až po chybě — tedy přesně stav, který tahle brána řeší.
 */
describe("cesta ke dveřím Z APPKY (po přihlášení)", () => {
  const LAYOUT = path.join(__dirname, "..", "app", "(tabs)", "_layout.tsx");

  it("hlavička záložek vede na /zaklepat — je na každé obrazovce", () => {
    const zdroj = fs.readFileSync(LAYOUT, "utf8");
    // ⛔ ZPRÁVA PATŘÍ DO POROVNÁVANÉ HODNOTY, ne do druhého argumentu `expect`.
    // `mobile-app` má `@types/jest`, jehož `expect` bere JEDEN argument a
    // přebíjí ten z vitestu — dvouargumentová forma za běhu projde, ale
    // TypeScript v CI ji odmítne (`TS2554`, naměřeno 2026-09-03). Běh a typy
    // jsou tu DVĚ RŮZNÁ měřidla a zeleno u jednoho neříká nic o druhém.
    const chybi = zdroj.includes("/zaklepat")
      ? []
      : ["Hlavička `app/(tabs)/_layout.tsx` nevede ke dveřím — po přihlášení " +
         "by zbyl jen banner po neúspěšném odeslání a ruční opis URL."];
    expect(chybi).toEqual([]);
  });

  it("symbol je DoorClosed — zavřené dveře, na které se teprve klepe", () => {
    const zdroj = fs.readFileSync(LAYOUT, "utf8");
    const chybi = zdroj.includes("DoorClosed")
      ? []
      : ["Symbol není `DoorClosed`. Otevřené dveře by slibovaly stav, který " +
         "nastane až PO zaťukání — a to je tvrzení, které tenhle systém nikde " +
         "nedělá (dveře mlčí)."];
    expect(chybi).toEqual([]);
  });
});

describe("cesta ke dveřím před přihlášením", () => {
  it("obrazovky před přihlášením vůbec existují", () => {
    // Prázdná množina není čistý strom — je to slepá brána.
    expect(obrazovky).not.toHaveLength(0);
  });

  it("⛔ aspoň jedna z nich vede na /zaklepat — jinak je odvolané zařízení cihla", () => {
    const vedouci = obrazovky.filter((f) =>
      fs.readFileSync(path.join(AUTH, f), "utf8").includes("/zaklepat"),
    );
    expect(vedouci).not.toHaveLength(0);
  });
});

/*
  OBRAZOVKA BEZ HLAVIČKY NEDĚDÍ NIC — musí mít cestu vlastní.

  ⛔ NAMĚŘENO 2026-09-05 na hlášení od majitele: řidič přihlášený z JINÉ SÍTĚ
  neviděl nic a neměl kde zaťukat. Test výš přitom byl ZELENÝ a jmenoval se
  „je na každé obrazovce".

  ⭐ Proč lhal: četl JEDEN soubor — `(tabs)/_layout.tsx`. Měřil tedy
  MECHANISMUS (že hlavička záložek odkaz má), ne VLASTNOST (že se ke dveřím
  dostane každý). `kroky` ani `porada` pod záložkami nejsou a `_layout.tsx`
  jim dává `headerShown: false`, takže z té hlavičky nedědí nic. Zelená byla
  pravdivá o něčem jiném, než co slibovala.

  Tenhle test si univerzum HLEDÁ: přečte z `_layout.tsx`, komu se hlavička
  vypíná, a na každou takovou obrazovku se podívá zvlášť. Přibude-li zítra
  další `headerShown: false`, objeví se tu sama.
*/
describe("obrazovka bez hlavičky si dveře nese sama", () => {
  const APP = path.join(__dirname, "..", "app");
  const ROOT_LAYOUT = path.join(APP, "_layout.tsx");

  /** Jména obrazovek, kterým kořenový layout vypíná hlavičku. */
  const bezHlavicky = (): string[] => {
    const zdroj = fs.readFileSync(ROOT_LAYOUT, "utf8");
    const out: string[] = [];
    for (const m of zdroj.matchAll(
      /name="([^"]+)"\s+options=\{\{\s*headerShown:\s*false\s*\}\}/g,
    )) {
      out.push(m[1]!);
    }
    return out;
  };

  /*
    NEPODMÍNĚNÁ CESTA — jádro celého testu.

    ⛔ První verze tohohle testu (2026-09-05) se ptala jen `zdroj.includes("/zaklepat")`.
    Byla ZELENÁ i po odebrání opravy, protože `kroky.tsx` má `/zaklepat` ještě
    v banneru — a ten je schovaný za `{zamceno && (…)}`. Tedy přesně ta vada,
    kterou měl test chytat: odkaz existuje, ale jen když už appka funguje.
    Chytila to až MUTACE, ne čtení.

    Proto se podmíněné bloky `{cokoli && ( … )}` ze zdroje nejdřív ODSTRANÍ
    (párováním závorek, ne regexem — regex neumí vnořené bloky) a teprve
    zbytek se prohledává. Co přežije, je vykreslené vždycky.
  */
  const bezPodminenych = (zdroj: string): string => {
    let out = "";
    let i = 0;
    while (i < zdroj.length) {
      const start = zdroj.indexOf("&& (", i);
      if (start === -1) {
        out += zdroj.slice(i);
        break;
      }
      // Zpět k `{`, které ten podmíněný blok otevřelo.
      const otevreni = zdroj.lastIndexOf("{", start);
      if (otevreni === -1) {
        out += zdroj.slice(i, start + 4);
        i = start + 4;
        continue;
      }
      out += zdroj.slice(i, otevreni);
      // Dopředu k jeho `}` — počítáme hloubku, ať vnořené bloky nezmatou.
      let hloubka = 0;
      let j = otevreni;
      for (; j < zdroj.length; j += 1) {
        if (zdroj[j] === "{") hloubka += 1;
        else if (zdroj[j] === "}") {
          hloubka -= 1;
          if (hloubka === 0) break;
        }
      }
      i = j === zdroj.length ? zdroj.length : j + 1;
    }
    return out;
  };

  it("univerzum není prázdné — jinak tenhle test nic neměří", () => {
    // Brána, která nic nenajde, mlčí jako zelená. Tohle je pojistka proti tomu.
    expect(bezHlavicky().length).toBeGreaterThan(0);
  });

  it("odstraňovač podmíněných bloků funguje — jinak test měří jiný text", () => {
    // Měřidlo se ověřuje NA ZNÁMÉM VSTUPU, ne důvěrou. Bez tohohle by chyba
    // v odstraňovači vypadala jako „vše v pořádku".
    const vzorek = 'A {x && (<Door to="/zaklepat" />)} B {y && (<X>{z && (<Y/>)}</X>)} C';
    const zbytek = bezPodminenych(vzorek);
    expect(zbytek.includes("/zaklepat")).toBe(false);
    expect(zbytek.includes("A ") && zbytek.includes(" C")).toBe(true);
  });

  it("⛔ každá taková obrazovka vede na /zaklepat NEPODMÍNĚNĚ", () => {
    const chybi: string[] = [];
    for (const jmeno of bezHlavicky()) {
      // Skupiny v závorkách `(auth)`, `(tabs)` mají vlastní layout — ten je
      // pro ně tou hlavičkou, takže se ptáme na celou složku.
      const jeSkupina = jmeno.startsWith("(");
      const cesta = jeSkupina ? path.join(APP, jmeno) : path.join(APP, `${jmeno}.tsx`);
      if (!fs.existsSync(cesta)) continue;

      const soubory = jeSkupina
        ? fs.readdirSync(cesta).filter((f) => f.endsWith(".tsx")).map((f) => path.join(cesta, f))
        : [cesta];

      const vede = soubory.some((f) =>
        bezPodminenych(fs.readFileSync(f, "utf8")).includes("/zaklepat"),
      );
      if (!vede) {
        chybi.push(
          `${jmeno}: má headerShown:false, takže NEDĚDÍ symbol z hlavičky záložek, ` +
            "a sama na /zaklepat vede nanejvýš PODMÍNĚNĚ. Kdo tu uvízne po změně " +
            "sítě, nemá kam sáhnout — podmínka se rozsvítí až když appka funguje.",
        );
      }
    }
    // ⛔ Zpráva patří do POROVNÁVANÉ hodnoty — `@types/jest` bere `expect`
    // s jedním argumentem a dvouargumentová forma padá na TS2554.
    expect(chybi).toEqual([]);
  });
});

/**
 * ⛔ NAMĚŘENO NA SIMULÁTORU 2026-09-06: obrazovka „aplikaci se nepodařilo načíst"
 * (`startup-error-screen` v `app/_layout.tsx`) nabízela POUZE tlačítko Opakovat.
 *
 * Zavřené dveře shodí start aplikace právě sem. A protože se tahle obrazovka
 * kreslí MÍSTO `AppShell`, nestojí v tu chvíli žádný `<Stack>` — `router.push`
 * nemá kam jít. Klepátko dostupné jen přes navigaci je tedy nedostupné přesně
 * tehdy, kdy je ho potřeba. Z cizí IP bylo „Opakovat" nekonečná smyčka:
 * načtení nemůže uspět, dokud se nezaťuká.
 *
 * ⭐ Předchozí brány tohle minout MUSELY: měřily cestu `/zaklepat` z obrazovek
 * pod `app/`, jenže tahle obrazovka žádnou cestou nedisponuje a klepátko si
 * musí vykreslit SAMA. Proto se tu neměří odkaz, ale VLOŽENÁ KOMPONENTA.
 */
describe("obrazovka selhání startu si dveře nese sama", () => {
  const LAYOUT = path.join(__dirname, "..", "app", "_layout.tsx");
  const zdroj = fs.readFileSync(LAYOUT, "utf8");

  /** Komentář se nesmí počítat jako kód — na tom už jsem naletěl třikrát. */
  const bezKomentaru = zdroj
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  /** Tělo `StartupFallback` vyříznuté párováním složených závorek. */
  const teloFallbacku = (() => {
    const start = bezKomentaru.indexOf("function StartupFallback");
    if (start === -1) return "";
    /**
     * Nelze prostě párovat od první `{` — tou je DESTRUKTUROVANÝ PARAMETR
     * (`function StartupFallback({ configIssue, onRetry }: { … })`) a párování
     * by skončilo na jeho konci, tedy před tělem. Nejdřív se proto dojede
     * seznam parametrů podle KULATÝCH závorek a teprve pak se hledá tělo.
     */
    let kulate = 0;
    let konecParametru = -1;
    for (let j = bezKomentaru.indexOf("(", start); j < bezKomentaru.length; j += 1) {
      if (bezKomentaru[j] === "(") kulate += 1;
      else if (bezKomentaru[j] === ")") {
        kulate -= 1;
        if (kulate === 0) { konecParametru = j; break; }
      }
    }
    if (konecParametru === -1) return "";
    let hloubka = 0;
    for (let j = bezKomentaru.indexOf("{", konecParametru); j < bezKomentaru.length; j += 1) {
      if (bezKomentaru[j] === "{") hloubka += 1;
      else if (bezKomentaru[j] === "}") {
        hloubka -= 1;
        if (hloubka === 0) return bezKomentaru.slice(start, j + 1);
      }
    }
    return "";
  })();

  it("univerzum není prázdné — jinak tenhle test nic neměří", () => {
    expect(teloFallbacku.length).toBeGreaterThan(200);
    expect(teloFallbacku).toContain("startup-error-screen");
  });

  it("odstraňovač komentářů funguje — jinak by prošla pouhá zmínka", () => {
    expect(bezKomentaru).not.toContain("BEZ TOHOHLE JE KLEPÁTKO NEDOSTUPNÉ");
    expect(zdroj).toContain("BEZ TOHOHLE JE KLEPÁTKO NEDOSTUPNÉ");
  });

  it("⛔ vykresluje klepátko, ne jen tlačítko Opakovat", () => {
    expect(teloFallbacku).toContain("<Klepatko");
  });

  it("⛔ klepátko nesmí viset na routeru — ten tu ještě nestojí", () => {
    expect(teloFallbacku).not.toContain("router.push");
    expect(teloFallbacku).not.toContain("useRouter");
  });

  it("komponenta klepátka je na routeru nezávislá", () => {
    const komponenta = fs.readFileSync(
      path.join(__dirname, "..", "components", "Klepatko.tsx"),
      "utf8",
    );
    expect(komponenta).not.toContain("expo-router");
  });
});
