import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Slova kreslí SLOVNÍK, komponenta je jen renderer.
 *
 * ⛔ NAMĚŘENO 2026-09-05: `@aisha/extranet-sdk-ui/src/mc.js` nese `DEF_LABELS`
 * — 35 řetězců NATVRDO ČESKY (`'Úloha'`, `'Rádio · komunikace agentů'`,
 * `'Schválit — výjezd z boxu'`, …). Host je smí přebít polem `labels`, jenže
 * `apps/workbench-shell` dodával jen TŘI. Zbylých 32 se proto kreslilo česky
 * i anglickému, německému, francouzskému, ruskému a thajskému uživateli —
 * a ten s tím nemohl udělat nic, protože to nebyl klíč, ale konstanta v balíku.
 *
 * Žádná brána to nechytla: `jazyk-parita` měří, že každé pravidlo `JAZYK.json`
 * má test v obou sadách, `esdk-slovnik` měří úplnost `custom-elements.json`.
 * Ani jedna se neptá, ČÍ SLOVA se nakonec vykreslí.
 *
 * ⭐ UNIVERZUM SE HLEDÁ V BALÍKU, NEPÍŠE SE SEM. Kdyby tenhle soubor nesl
 * seznam 35 jmen, měl by tutéž vadu, kterou má léčit — rozešel by se tiše při
 * první nové položce v SDK. Proto se `DEF_LABELS` čte z `mc.js` a poměřuje se
 * PROTI seznamu, který shell deklaruje.
 *
 * ⭐ ROSTE SAMA. Až SDK 0.3.2 protáhne `FLAGS[].label` přes `L` (dnes je
 * obchází — `mc.js:380` sahá na `FLAGS[t.flag].label` přímo, takže těch pět
 * slov host přebít NEMŮŽE), objeví se ta jména v `DEF_LABELS` a tahle brána si
 * je vyžádá bez jediné úpravy.
 */
const ROOT = join(__dirname, "../../..");
const MC = join(ROOT, "node_modules/@aisha/extranet-sdk-ui/src/mc.js");
const SHELL = join(ROOT, "apps/workbench-shell/src/components/blocks.tsx");

/**
 * Labely, které komponenta kreslí jen tehdy, když je host dodá.
 *
 * `hubFoot` je v `mc.js` pod podmínkou (`this.L.hubFoot ? … : ''`), takže jeho
 * nedodání není tichá čeština, ale prázdno — a to je legitimní volba hosta.
 */
const VOLITELNE = new Set(["hubFoot"]);

/** Klíče `DEF_LABELS` ze zdroje balíku — víc jmen na řádek, oddělených čárkou. */
function slovaKtereSdkKresli(): string[] {
  // Chybějící balík je ZTRÁTA PŘEDMĚTU, ne „nula slov". Bez téhle věty by
  // `npm ci`, který balík nedotáhl, prošel jako zelená brána.
  expect(
    existsSync(MC),
    `${MC} neexistuje — @aisha/extranet-sdk-ui není nainstalovaný, takže brána ` +
      "nemá co měřit. Nespouštěj ji bez závislostí a NEDOPLŇUJ fallback.",
  ).toBe(true);
  const src = readFileSync(MC, "utf8");
  const blok = src.match(/var DEF_LABELS = \{([\s\S]*?)\n {2}\};/);
  expect(blok, "v mc.js nejde najít DEF_LABELS — změnil se tvar balíku").not.toBeNull();
  /**
   * ⛔ KOMENTÁŘE PRYČ PŘED ČTENÍM JMEN. `/* … *\/` mezi položkami rozbije kotvu
   * `(?:^|,)` a klíč hned za komentářem se ztratí — brána by pak měřila MÍŇ,
   * než si myslí, a mlčela by právě o slově, které někdo zrovna přidal.
   * Naměřeno 2026-09-05 na sesterském testu v balíku, kde komentář uvnitř
   * `DEF_LABELS` schoval `flagGreen`.
   */
  const bezKomentaru = blok![1].replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const jmena = [...bezKomentaru.matchAll(/(?:^|[,{])\s*([a-zA-Z]\w*)\s*:/gm)].map((m) => m[1]);
  // Prázdný seznam by udělal každé tvrzení níž bezobsažným.
  expect(jmena.length, "DEF_LABELS je prázdné — brána ztratila předmět").toBeGreaterThan(10);
  return jmena;
}

/** Jména, která shell SKUTEČNĚ posílá do `labels` (seznam + explicitní klíče). */
function slovaKtereHostDodava(): Set<string> {
  const src = readFileSync(SHELL, "utf8");
  const seznam = src.match(/const MC_LABEL_KEYS = \[([\s\S]*?)\] as const;/);
  expect(
    seznam,
    "v blocks.tsx nejde najít MC_LABEL_KEYS — přejmenování rozpojilo bránu od toho, co měří",
  ).not.toBeNull();
  const zeSeznamu = [...seznam![1].matchAll(/'([a-zA-Z]\w*)'/g)].map((m) => m[1]);

  // Klíče psané ručně uvnitř missionControlLabels (`tower`, `active`,
  // `finLabel`, `sectorMsg`) — ty v seznamu nejsou, protože nejdou z `app.mc.*`.
  const telo = src.match(/export function missionControlLabels\([\s\S]*?\n\}/);
  expect(telo, "v blocks.tsx nejde najít missionControlLabels").not.toBeNull();
  const explicitni = [...telo![0].matchAll(/^\s{4}([a-zA-Z]\w*):/gm)].map((m) => m[1]);

  return new Set([...zeSeznamu, ...explicitni, ...Object.keys(flagMapa(src))]);
}

/**
 * Jména vlajek se dodávají VLASTNÍ mapou, ne seznamem `MC_LABEL_KEYS` — jejich
 * klíče nejdou z `app.mc.*`, ale z `app.tower.flag.*` (vlajka je pojem timing
 * tower a týž klíč čte i mobilní renderer). Kdyby je brána nečetla, hlásila by
 * je jako nedodané, i když se dodávají — a nutila by je duplikovat do `app.mc.*`.
 *
 * Prázdná mapa je legitimní stav: do SDK 0.3.2 vlajky přebít NEŠLY, takže
 * `DEF_LABELS` jejich jména neznalo a dodávat je nebylo kam.
 */
function flagMapa(src: string): Record<string, string> {
  const blok = src.match(/const MC_FLAG_LABELS: Record<string, string> = \{([\s\S]*?)\};/);
  if (!blok) return {};
  return Object.fromEntries(
    [...blok[1].matchAll(/(\w+)\s*:\s*'([a-z0-9_.]+)'/g)].map((m) => [m[1], m[2]]),
  );
}

describe("Mission Control — slova dodává host, ne balík", () => {
  const kresli = slovaKtereSdkKresli();
  const dodava = slovaKtereHostDodava();

  it("shell dodává label pro KAŽDÉ slovo, které SDK umí nakreslit", () => {
    const chybi = kresli.filter((k) => !dodava.has(k) && !VOLITELNE.has(k)).sort();
    expect(
      chybi,
      `Tahle slova by se vykreslila z DEF_LABELS, tedy ČESKY ve všech jazycích: ` +
        `${chybi.join(", ")}.\n` +
        "Přidej pro každé klíč `app.mc.<jméno>` do src/i18n/content/<jazyk>/extranet.json " +
        "(všech šest jazyků) a jméno do MC_LABEL_KEYS v apps/workbench-shell/src/components/blocks.tsx.",
    ).toEqual([]);
  });

  it("shell neposílá label, který SDK nezná (osiřelý překlad)", () => {
    // Osiřelé jméno znamená buď překlep (slovo se tedy nedodává, i když si to
    // shell myslí), nebo pozůstatek po slově, které z SDK zmizelo — a pak se
    // marně překládá klíč, který nikdo nevykreslí.
    const znama = new Set([...kresli, ...VOLITELNE]);
    const osirele = [...dodava].filter((k) => !znama.has(k)).sort();
    expect(
      osirele,
      `Shell posílá labely, které mc.js nezná: ${osirele.join(", ")}. ` +
        "Odeber je z MC_LABEL_KEYS (a jejich klíče ze slovníku), nebo oprav překlep.",
    ).toEqual([]);
  });

  it("každé dodávané slovo má klíč ve VŠECH jazycích platformní báze", () => {
    // Dodat label z prázdného klíče = vykreslit jméno klíče. Parita se měří
    // v content-parity-check.mjs, tady jde o to, že klíč vůbec EXISTUJE.
    const jazyky = ["en", "cs", "de", "fr", "ru", "th"];
    const src = readFileSync(SHELL, "utf8");
    const zeSeznamu = [
      ...src.match(/const MC_LABEL_KEYS = \[([\s\S]*?)\] as const;/)![1].matchAll(/'([a-zA-Z]\w*)'/g),
    ].map((m) => `app.mc.${m[1]}`);
    const chybi: string[] = [];
    for (const jazyk of jazyky) {
      const slovnik = JSON.parse(
        readFileSync(join(ROOT, `src/i18n/content/${jazyk}/extranet.json`), "utf8"),
      ) as Record<string, string>;
      for (const klic of [...zeSeznamu, "app.mc.sectorMsg", ...Object.values(flagMapa(src))]) {
        if (!(klic in slovnik)) chybi.push(`${jazyk}/${klic}`);
      }
    }
    expect(chybi, `Chybí klíče ve slovníku: ${chybi.join(", ")}`).toEqual([]);
  });

  it("každé dodávané slovo je i v build-time FLOOR (pre-auth / selhané načtení)", () => {
    /**
     * ⛔ NAMĚŘENO 2026-09-05, PO opravě 32 labelů: klíče `app.mc.*` se doplnily
     * do DB contentu, ale NE do `instances/<x>/i18n.json`. `t()` řeší
     * `runtime[locale] ?? runtime[en] ?? floor[locale] ?? floor[en] ?? key`,
     * takže dokud DB nedorazí (před přihlášením) nebo když se `get_translations`
     * nepovede, vykreslil by se SYROVÝ KLÍČ `app.mc.colTask` — a to je horší než
     * čeština, kterou to nahradilo. Shell si přitom výslovně slibuje opak:
     * „the build-time bundle still backs t(), so a failed fetch falls back to the
     * shipped inventory rather than to raw keys."
     *
     * ⛔ PROČ TO NECHYTLA `check-i18n-parity.mjs`: ta hledá LITERÁL
     * `t('app.…')` regexem. Klíče skládané šablonou (`t(\`app.mc.${key}\`)`)
     * pro ni neexistují — hlásila „102 použitých pokryto" a o těchto 32 mlčela.
     * Tady se proto měří proti SEZNAMU, který shell deklaruje.
     */
    const src = readFileSync(SHELL, "utf8");
    const klice = [
      ...src.match(/const MC_LABEL_KEYS = \[([\s\S]*?)\] as const;/)![1].matchAll(/'([a-zA-Z]\w*)'/g),
    ].map((m) => `app.mc.${m[1]}`);
    klice.push("app.mc.sectorMsg");

    const instancesDir = join(ROOT, "instances");
    const chybi: string[] = [];
    for (const inst of readdirSync(instancesDir).filter((d) => statSync(join(instancesDir, d)).isDirectory())) {
      const soubor = join(instancesDir, inst, "i18n.json");
      if (!existsSync(soubor)) continue;
      const slovnik = JSON.parse(readFileSync(soubor, "utf8")) as Record<string, Record<string, string>>;
      for (const jazyk of Object.keys(slovnik).filter((k) => !k.startsWith("_"))) {
        for (const klic of klice) {
          if (!(klic in (slovnik[jazyk] ?? {}))) chybi.push(`${inst}/${jazyk}/${klic}`);
        }
      }
    }
    expect(
      chybi.length,
      `Floor nenese ${chybi.length} klíčů, které shell dodává — při selhaném načtení ` +
        `by se vykreslil syrový klíč. Chybí např.: ${chybi.slice(0, 5).join(", ")}`,
    ).toBe(0);
  });
});
