/**
 * Brána: build, který neví, ČÍ identitu staví, nesmí postavit nic.
 *
 * PROČ (naměřeno 2026-08-07, dvakrát po sobě)
 * ------------------------------------------
 * `build-ios.sh` psal na výstup
 *
 *     Instance env derived: … client=aisha-app (default)
 *     Version in project matches version.json: 1.0.0 (12)
 *
 * a KLIDNĚ POKRAČOVAL. Stavěl tedy platformní brand místo brandu instance
 * 1.0.11(13) — s platformním OIDC klientem, platformní verzí a platformní
 * ikonou. Zachytilo to jedině to, že jsem četl prvních dvanáct řádků logu.
 *
 * Táž třída už jednou poslala do TestFlightu TŘI buildy s AISHA robotem místo
 * instanční ikony. Tichý rozumný default je horší než chybějící vstup: nevynutí si
 * pozornost, a u store identity se vada projeví až v ruce testera.
 *
 * ⭐ UNIVERZUM SE HLEDÁ, NEVYPISUJE (2026-08-19)
 * ----------------------------------------------
 * Tahle brána byla napsaná na JEDNO JMÉNO SOUBORU (`build-ios.sh`). Tím měřila
 * implementaci, ne vlastnost, a měla dvě díry naráz:
 *
 *   · `prepare-xcode-build.sh` — cesta „připrav projekt a archivuj z Xcode" —
 *     odvození identity NEMĚLA VŮBEC (`grep AISHA_INSTANCE_ENV` v ní vracel
 *     nulu). Brána byla zelená a druhá cesta stavěla projekt bez adresy brány,
 *     bez realmu a bez redirect URI. Poznalo by se to až přihlášením
 *     z TestFlightu — tedy přesně tou třídou vad, kvůli které vznikla.
 *   · Táž cesta instalovala pody POD ROSETTOU (`uname -m == arm64` → holé
 *     `pod install`), s fallbackem `|| pod install` navrch. Opravená byla ta
 *     cesta, kterou jsem tehdy četl; druhá zůstala vadná a čekala na archiv.
 *   · Jakmile se odvození přesunulo do sdíleného `instance-env-derive.sh`
 *     (aby platilo pro OBĚ cesty), brána zčervenala — na refaktoru, který
 *     vlastnost POSÍLIL. Červená na zlepšení je signál o měřidle.
 *
 * Univerzum se proto ODVOZUJE, a to STRUKTURÁLNĚ: iOS build cesta je skript,
 * který dojde k `pod install` (CocoaPods = nativní iOS projekt) a přitom ho
 * nikdo jiný nesourcuje — tedy VSTUPNÍ BOD, ne sdílený kus. Rozlišit to je
 * nutné: jakmile se instalace podů přesunula do sdíleného `pods-install.sh`,
 * pravidlo „obsahuje pod install" začalo ukazovat na ten sdílený soubor a obě
 * skutečné cesty z univerza VYPADLY. Brána by zůstala zelená nad souborem,
 * který žádnou appku nestaví.
 *
 * Každá nalezená cesta se čte VČETNĚ sourcovaných souborů, takže je jedno,
 * jestli vlastnost bydlí přímo v ní nebo ve sdíleném kusu. Nová build cesta je
 * změřená od chvíle, kdy vznikne.
 *
 * CO SE MĚŘÍ (na KAŽDÉ nalezené cestě)
 * ------------------------------------
 * 1. Skript se na nedeklarovanou identitu MUSÍ zastavit (`exit 1`).
 * 2. Nesmí zůstat tvar, který dosazuje platformního klienta jako výchozího.
 * 3. Chybová hláška musí říct, CO S TÍM — verdikt bez návodu vede k tomu, že
 *    si příště někdo „pomůže" exportem a vada se vrátí tišeji.
 * 4. CocoaPods jedou nativně na arm64, bez tichého ústupu na Rosettu.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(__dirname, "../../..");
const SCRIPTS = resolve(ROOT, "mobile-app/scripts");

/**
 * Koho si daný text sourcuje. Řádek smí začínat přiřazením proměnné
 * (`PODS_CLEAN=1 . "$SCRIPT_DIR/…"`), proto se nekotví na začátek řádku.
 */
function sourceRefs(text: string): string[] {
  const re = /(?:^|[;\s])(?:\.|source)\s+"?\$\{?SCRIPT_DIR\}?\/([\w.-]+\.sh)"?/gm;
  return [...text.matchAll(re)].map((m) => m[1]);
}

/**
 * Text skriptu BEZ komentářů.
 *
 * ⛔ NAMĚŘENO MUTACÍ (2026-08-19): bez tohohle brána měřila ZMÍNKU MÍSTO ČINU.
 * Hlavička `pods-install.sh` popisuje, jak se pody instalovat MAJÍ, a doslova
 * v ní stojí `/usr/bin/arch -arm64 pod install`. Když jsem ten příkaz v kódu
 * nahradil holým `pod install` — tedy vrátil Rosettu — brána zůstala ZELENÁ,
 * protože si našla svůj vzorek v komentáři o dvacet řádků výš.
 *
 * Dokumentace v tomhle repu je hustá a popisná záměrně; tím spíš nesmí sloužit
 * jako důkaz. Měří se to, co se spustí.
 */
function cti(jmeno: string): string {
  let text: string;
  try {
    text = readFileSync(join(SCRIPTS, jmeno), "utf8");
  } catch {
    return "";
  }
  return text
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
}

/** Text skriptu VČETNĚ všeho, co si sourcuje (tranzitivně). */
function scelaText(jmeno: string, videno = new Set<string>()): string {
  if (videno.has(jmeno)) return "";
  videno.add(jmeno);
  const text = cti(jmeno);
  return text + sourceRefs(text).map((s) => "\n" + scelaText(s, videno)).join("");
}

const vsechny = readdirSync(SCRIPTS).filter((f) => f.endsWith(".sh")).sort();

/** Soubory, které někdo jiný sourcuje = sdílené kusy, ne vstupní body. */
const sourcovane = new Set<string>(vsechny.flatMap((f) => sourceRefs(cti(f))));

/** Univerzum: VSTUPNÍ BODY, které dojdou k instalaci podů. */
const cesty = vsechny.filter((f) => !sourcovane.has(f) && /pod install/.test(scelaText(f)));

/**
 * Vrátí CELOU shellovou větev od `if`, který sedne na `zacatek`, po JEJÍ vlastní
 * `fi` — počítá vnoření, takže nezáleží na odsazení ani na tom, co je pod ní.
 * `null`, když taková větev není (nebo se nikde neuzavře).
 */
function vetevOd(zdroj: string, zacatek: RegExp): string | null {
  const radky = zdroj.split("\n");
  const i = radky.findIndex((r) => zacatek.test(r));
  if (i === -1) return null;

  let hloubka = 0;
  for (let j = i; j < radky.length; j++) {
    const r = radky[j];
    // `elif` neotevírá nový blok a `fi` na téže řádce (`if …; then …; fi`) se
    // odečte hned — proto se počítá po výskytech, ne po řádcích.
    hloubka += (r.match(/(^|[\s;])if[\s[]/g) ?? []).length;
    hloubka -= (r.match(/(^|[\s;])fi([\s;]|$)/g) ?? []).length;
    if (hloubka <= 0) return radky.slice(i, j + 1).join("\n");
  }
  return null;
}

describe("brána: identita iOS buildu", () => {
  it("univerzum není prázdné — jinak brána neměří nic", () => {
    expect(
      cesty,
      "v mobile-app/scripts není ŽÁDNÝ vstupní bod, který dojde k `pod install` — " +
        "buď se přejmenoval, nebo se změnil způsob instalace podů, nebo si ho " +
        "někdo začal sourcovat; brána by tiše prošla nad prázdnem",
    ).not.toHaveLength(0);
  });

  for (const jmeno of cesty) {
    describe(jmeno, () => {
      const sh = scelaText(jmeno);

      it("nedeklarovaná identita build ZASTAVÍ, ne jen zaloguje", () => {
        // Univerzum je konkrétní: větev, která na prázdné EXPO_PUBLIC_KC_CLIENT_ID
        // reaguje. Musí v ní být `exit 1`, ne pokračování.
        //
        // ⛔ 2026-08-20: tady stálo `[\s\S]{0,1600}?\nfi`. To `fi` je ukotvené
        // na sloupec 0, jenže vlastní `fi` té větve je ODSAZENÉ — vzor tedy
        // ve skutečnosti sahal až na `fi` VNĚJŠÍHO bloku a držel jen proto,
        // že se do 1600 znaků náhodou vešlo. Jakmile pod větev přibyl další
        // (legitimní) kód, brána spadla — a přitom se vlastnost nikam
        // neposunula. Měřit VZDÁLENOST znamená měřit rozvržení, ne strukturu;
        // táž past je pojmenovaná v `krok-nesmi-hlasit-uspech-po-chybe`.
        const branch = vetevOd(sh, /if \[ -z "\$\{EXPO_PUBLIC_KC_CLIENT_ID:-\}" \];/);
        expect(
          branch,
          `${jmeno}: chybí fail-closed větev nad EXPO_PUBLIC_KC_CLIENT_ID ` +
            "(ani přímo, ani v ničem, co si sourcuje)",
        ).not.toBeNull();
        expect(branch!, `${jmeno}: větev existuje, ale build nezastaví`).toMatch(/exit 1/);
      });

      it("platformní klient se NEDOSAZUJE jako tichý výchozí", () => {
        // Přesně ten tvar, který vadu způsobil: `${VAR:-aisha-app (default)}`.
        expect(
          sh,
          `${jmeno}: někdo vrátil dosazení platformního klienta — build pak postaví ` +
            "cizí appku a řekne o tom jednou větou uprostřed logu",
        ).not.toMatch(/EXPO_PUBLIC_KC_CLIENT_ID:-\s*aisha-app/);
      });

      it("chyba říká, CO S TÍM — obě cesty, instanční i platformní", () => {
        expect(sh, `${jmeno}: chybová hláška bez návodu`).toMatch(/CO S TIM|CO S TÍM/);
        // Instanční cesta: podstrčit brand overlay.
        expect(sh).toMatch(/version\.json/);
        // Platformní cesta: deklarovat výslovně, ne se na to spolehnout.
        expect(sh).toMatch(/EXPO_PUBLIC_KC_CLIENT_ID=aisha-app/);
      });

      /**
       * ⛔ DO DVEŘÍ SE NIC NEVYMÝŠLÍ. Dveře MLČÍ i při úspěchu, takže zaťukání
       * na uhodnutou adresu, port, `kid` nebo scope vypadá úplně stejně jako
       * zaťukání správné: nijak. Dosazená „rozumná" hodnota by z toho udělala
       * poruchu, kterou nelze odlišit od zavřených dveří — a člověk by
       * donekonečna psal správný kód do špatných dveří.
       *
       * Měří se TVAR přiřazení: `EXPO_PUBLIC_KNOCK_* := <něco>` smí dosadit
       * VÝHRADNĚ hodnotu z proměnné (`$…`), nikdy literál.
       */
      it("hodnoty dveří se ODVOZUJÍ, nikdy nedosazují literálem", () => {
        const literaly = [...sh.matchAll(/EXPO_PUBLIC_KNOCK_[A-Z]+:=([^}"\n]*)/g)]
          .map((m) => m[0])
          .filter((cele) => {
            const hodnota = cele.split(":=")[1].trim();
            return hodnota !== "" && !hodnota.startsWith("$");
          });
        expect(
          literaly,
          `${jmeno}: dveře dostaly vymyšlenou hodnotu — zaťukání jinam vypadá stejně jako zaťukání správné`,
        ).toEqual([]);
      });

      it("CocoaPods jedou nativně a bez tichého ústupu na x86", () => {
        // Druhá půlka téhož dne: `arch -arm64 … || pod install` vracel Rosettu
        // zpátky, jen tišeji. Fallback tam být nesmí.
        expect(sh, `${jmeno}: pody se neinstalují vynuceně nativně`).toMatch(
          /\/usr\/bin\/arch -arm64 pod install/,
        );
        // ⛔ ZAKÁZANÝ JE ÚSTUP, NE `||`. První verze zakazovala JAKÉKOLI `||` za
        // tím příkazem — a zamítla tím `|| pods_rc=$?`, tedy ZACHYCENÍ
        // NÁVRATOVÉHO KÓDU, což je pravý opak tichého ústupu: bez něj skript
        // hlásil „CocoaPods installed" i po pádu. Brána tak trestala opravu
        // vady, kterou sama existuje hlídat.
        //
        // Měří se proto vlastnost: po `||` NESMÍ následovat další spuštění
        // `pod` (to by byl běh bez `arch -arm64`, tedy Rosetta).
        expect(sh, `${jmeno}: fallback na další \`pod\` vrací běh pod Rosettou`).not.toMatch(
          /arch -arm64 pod install[^\n]*\|\|\s*(?:\/usr\/bin\/)?pod\b/,
        );
      });
    });
  }

  /**
   * ⛔ KDO VYRÁBÍ ARTEFAKT, MUSÍ ZNÁT INSTANCI.
   *
   * Naměřeno 2026-08-20: `build-android.sh` NESOURCOVAL `instance-env-derive.sh`
   * vůbec (`grep -c` = 0), zatímco `build-ios.sh` i `prepare-xcode-build.sh` ano.
   * Androidí build by tedy vznikl bez adresy brány, bez realmu, bez redirect URI
   * a bez dveří — appka, která se nemá kam připojit. Poznalo by se to teprve
   * tím, že se tester nepřihlásí.
   *
   * ⭐ Univerzum se ODVOZUJE: skripty, které spouštějí výrobu artefaktu
   * (`xcodebuild`, `gradlew assemble/bundle`). Ručně psaný seznam by zetlel
   * první novou platformou — což je přesně to, co se stalo.
   */
  describe("výrobce artefaktu zná instanci", () => {
    /**
     * ⛔ MĚŘÍ SE SPUŠTĚNÍ, NE VÝSKYT ŘETĚZCE. První verze chytila
     * `assert-arm64.sh` — ten je OVĚŘOVATEL a `xcodebuild` má jen uvnitř `echo`
     * jako radu pro operátora. Nástroj se proto hledá až po odstranění
     * komentářů a řádků, které jen něco vypisují.
     */
    const spousti = (f: string) => {
      const cinny = cti(f)
        .split("\n")
        .filter((r) => !/^\s*#/.test(r) && !/\b(echo|printf|log_[a-z]+)\b/.test(r))
        .join("\n");
      return /(^|[\s;&|(])(xcodebuild|\.\/gradlew)\b/m.test(cinny);
    };
    const vyrobci = vsechny.filter((f) => spousti(f) && !sourcovane.has(f));

    it("nějaký výrobce artefaktu v repu je", () => {
      // Prázdná množina není čistý strom — je to slepá brána.
      expect(
        vyrobci,
        "v mobile-app/scripts není žádný vstupní bod, který vyrábí artefakt — " +
          "buď se přejmenoval, nebo se změnil způsob buildu",
      ).not.toHaveLength(0);
    });

    it.each(vyrobci)("%s odvozuje instanční hodnoty", (jmeno) => {
      expect(
        cti(jmeno),
        `${jmeno}: nesourcuje instance-env-derive.sh — artefakt vznikne bez adresy ` +
          "brány, realmu a dveří, a pozná se to až tím, že se nikdo nepřihlásí",
      ).toMatch(/instance-env-derive\.sh/);
    });
  });

  /**
   * ⛔ SLIB „PŘIPRAVENO PRO ARCHIV Z XCODE" MUSÍ PLATIT I BEZ NAŠEHO PROSTŘEDÍ.
   *
   * `Product → Archive` v Xcode neběží z našeho shellu, takže `app.config.ts`
   * nevidí `AISHA_APP_VERSION_FILE` a fail-closed guard build ZASTAVÍ. Bez
   * zápisu identity do `.xcode.env.local` tedy ten slib neplatil: archivovat
   * z Xcode šlo jen appku, kterou zrovna stavěl terminál.
   *
   * ⚠️ Měří se JEN skript, který ten slib dává (má ho v hlavičce) — univerzum
   * se odvozuje z textu, ne z ručního seznamu.
   */
  describe("příprava pro ruční archiv nese identitu appky", () => {
    // Univerzum: skripty, které ten slib SAMY VYSLOVUJÍ. Ručně psaný seznam by
    // zetlel první přejmenovanou cestou.
    const slibujici = vsechny.filter((f) =>
      /archive\/upload in Xcode|Product -> Archive|Product → Archive/.test(cti(f)),
    );

    it("takový skript v repu je", () => {
      // Prázdná množina není čistý strom — je to slepá brána.
      expect(
        slibujici,
        "žádný skript v mobile-app/scripts neslibuje přípravu pro archiv z Xcode — " +
          "buď se slib přeformuloval, nebo cesta zmizela; brána by měřila nad prázdnem",
      ).not.toHaveLength(0);
    });

    /**
     * ⛔ MĚŘÍ SE ZÁPIS, NE VÝSKYT ŘETĚZCE. První verze téhle brány hledala
     * `AISHA_APP_VERSION_FILE` kdekoli v `scelaText` — a mutace, která zápis
     * ODSTRANILA, přesto prošla: jméno proměnné se našlo v sourcovaném
     * `app-profile.sh`, který ji jen ČTE. Brána tak měřila pravopis.
     *
     * Univerzum je tady konkrétní blok `{ … } >> "$XCODE_ENV_LOCAL"` VE
     * VLASTNÍM textu skriptu; tvrzení zní, že v něm ta proměnná je.
     */
    /**
     * ⛔ SEZNAM PŘENÁŠENÝCH HODNOT SE NESMÍ UDRŽOVAT RUKOU.
     *
     * Naměřeno 2026-08-20 na archivu `cz.riq.ridic` 1.0.0(3): `EXPO_PUBLIC_KNOCK_*`
     * byly v `extra` prázdné, ačkoli je `instance-env-derive.sh` o řádek dřív
     * úspěšně odvodil. Příčina: `prepare-xcode-build.sh` je přepisoval do
     * `.xcode.env.local` podle RUČNÍHO SEZNAMU šesti klíčů, který se s derivací
     * rozešel. Tiše — derivace hlásila úspěch a archiv vznikl.
     *
     * Táž díra spolkla i `EXPO_PUBLIC_LIVEKIT_URL` (hovory), `_KC_AUTHORITY`
     * a `_BOOTSTRAP_URL`. Poznalo by se to až z TestFlightu.
     *
     * `EXPO_PUBLIC_*` je z definice veřejná hodnota buildu ⇒ univerzum je
     * „všechny nastavené", a to se dá jen ODVODIT.
     */
    it.each(slibujici)("%s odvozuje seznam přenášených EXPO_PUBLIC_*, nedrží ho ručně", (jmeno) => {
      const vlastni = cti(jmeno);
      const blok = vlastni.match(/\{[\s\S]*?\}\s*>>\s*"\$XCODE_ENV_LOCAL"/);
      expect(blok, `${jmeno}: nedopisuje do $XCODE_ENV_LOCAL`).not.toBeNull();
      expect(
        /compgen -v[^\n]*EXPO_PUBLIC_/.test(blok![0]),
        `${jmeno}: přenášené hodnoty se berou z ručního seznamu — co v něm chybí, ` +
          "tiše nedoletí do Xcode a pozná se to až z TestFlightu",
      ).toBe(true);
    });

    it.each(slibujici)("%s zapisuje AISHA_APP_VERSION_FILE do .xcode.env.local", (jmeno) => {
      const vlastni = cti(jmeno);
      const bloky = [...vlastni.matchAll(/\{[\s\S]*?\}\s*>>\s*"\$XCODE_ENV_LOCAL"/g)].map((m) => m[0]);
      expect(bloky, `${jmeno}: nikde nedopisuje do $XCODE_ENV_LOCAL`).not.toHaveLength(0);
      expect(
        bloky.some((b) => /AISHA_APP_VERSION_FILE/.test(b)),
        `${jmeno}: do .xcode.env.local se nezapisuje AISHA_APP_VERSION_FILE — ` +
          "archiv z Xcode (Product → Archive) proto spadne na fail-closed guardu " +
          "v app.config.ts, protože identitu appky nikdo neřekl",
      ).toBe(true);
    });
  });
});
