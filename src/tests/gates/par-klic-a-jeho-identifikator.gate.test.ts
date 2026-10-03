/**
 * Brána: pár klíč + jeho identifikátor
 *
 * DVA INVARIANTY, oba o téže vadě z různých stran:
 *
 *   1. Hodnota, kterou vyrobí bootstrap za běhu, musí PŘEŽÍT přegenerování
 *      `.env.coolify`. Setup key NetBirdu a jeho `_ID` jsou PÁR — klíč sám
 *      neřekne, který v NetBirdu je; to říká identifikátor. Obě půlky proto
 *      musí být ve VŠECH TŘECH domovech: v seznamu zachovávaných hodnot
 *      generátoru, v jeho emisi a v heredocu cold-startu.
 *
 *   2. Kdo zafrontuje nasazení, počká, než doběhne — než se kohokoli zeptá.
 *
 * ⛔ NAMĚŘENO 2026-08-15, jeden běh, oba důsledky:
 *
 *   „NETBIRD_STACK_KEY_FRONTEND present but …_ID is missing — regenerating"
 *   (a totéž u zbylých tří) — protože `_ID` nebylo ani v generátoru, ani
 *   v heredocu, takže ho každé přegenerování zahodilo. Klíče se tím razily
 *   ZNOVU při každém běhu.
 *
 *   „4 setup key(s) regenerated — triggering redeploy of affected stacks"
 *   → do fronty šlo 25 aplikací včetně `aisha-keycloak` → a hned nato:
 *   „netbird-peer-discover failed (exit 2): fetch failed: This operation was
 *   aborted — https://auth…/openid-connect/token". Cold-start skončil.
 *   Tatáž adresa o pár hodin později odpovídá 200 za 0,14 s — nešlo o vadu
 *   adresy, ale o dotaz na službu, kterou si skript sám poslal do restartu.
 *
 * Brána měří VLASTNOST, ne vzorek: množinu základních jmen si odvodí ze
 * seznamu v generátoru, takže pátý setup key se bude hlídat sám.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import * as path from "node:path";

const ROOT = process.cwd();
const GENERATOR = path.join(ROOT, "scripts/generate-secrets.mjs");
const COLD_START = path.join(ROOT, "scripts/aisha-cold-start.sh");
const KONTRAKT = path.join(ROOT, "scripts/aisha-env-doctor.mjs");
const BOOTSTRAP = path.join(ROOT, "scripts/netbird-bootstrap.sh");

const generator = readFileSync(GENERATOR, "utf8");
const coldStart = readFileSync(COLD_START, "utf8");
const kontrakt = readFileSync(KONTRAKT, "utf8");
const bootstrap = readFileSync(BOOTSTRAP, "utf8");

/** Základní jména setup keys (bez `_ID`), odvozená z emisí generátoru. */
const zakladni = [
  ...new Set(
    [...generator.matchAll(/emit\('(NETBIRD_STACK_KEY_[A-Z]+)'/g)].map((m) => m[1]),
  ),
];

describe("brána: klíč a jeho identifikátor jsou pár", () => {
  it("nějaké setup keys se vůbec emitují (jinak by brána měřila prázdno)", () => {
    expect(zakladni.length, "generátor neemituje žádný NETBIRD_STACK_KEY_*").toBeGreaterThanOrEqual(4);
  });

  it("ke každému klíči existuje jeho `_ID` ve všech třech domovech", () => {
    const chybi: string[] = [];
    for (const klic of zakladni) {
      const id = `${klic}_ID`;
      // 1. seznam zachovávaných hodnot — bez něj generátor hodnotu nepřevezme
      if (!new RegExp(`'${id}'`).test(generator)) chybi.push(`${id}: chybí v generate-secrets`);
      // 2. emise — bez ní se do souboru nezapíše
      if (!new RegExp(`emit\\('${id}'`).test(generator)) chybi.push(`${id}: negeneruje se (emit)`);
      // 3. heredoc cold-startu — ten soubor přepisuje celý
      if (!new RegExp(`^${id}=`, "m").test(coldStart)) chybi.push(`${id}: chybí v heredocu cold-startu`);
      // 4. kontrakt — aby ho doktor nepovažoval za cizí
      if (!new RegExp(`"${id}"`).test(kontrakt)) chybi.push(`${id}: chybí v kontraktu env-doktora`);
    }
    expect(
      chybi,
      "Klíč bez svého identifikátoru nejde OVĚŘIT, jen PŘERAZIT — a přeražení\n" +
        "strhne redeploy celé flotily při každém běhu:\n  " + chybi.join("\n  "),
    ).toEqual([]);
  });

  // Od fáze D (2026-09-26) bootstrap nezařazuje nasazení přes `REDEPLOY=1`
  // (osm stacků naráz vyčerpalo disk, ENOSPC) a nečeká zvlášť přes
  // coolify-deploy-watch: přenasazuje `aisha-redeploy --only`, který sám čeká
  // na doběhnutí nasazení I na zdraví, než se vrátí. Obě vlastnosti níž se
  // proto měří na tom volání.
  const REDEPLOY_VOLANI = 'node scripts/aisha-redeploy.mjs --only="$_nb_stacky"';

  it("bootstrap po zafrontování nasazení počká, než doběhnou", () => {
    // Najdi větev, která nasazení spouští, a ověř, že se čeká na doběhnutí i zdraví.
    const i = bootstrap.indexOf(REDEPLOY_VOLANI);
    expect(i, "větev se spuštěním redeploye se nenašla — brána by měřila prázdno").toBeGreaterThan(0);
    const radek = bootstrap.slice(bootstrap.lastIndexOf("\n", i), bootstrap.indexOf("\n", i));
    expect(
      radek,
      "Kdo zafrontuje nasazení, nesmí se hned ptát služby, kterou právě restartuje.\n" +
        "aisha-redeploy čeká na doběhnutí i zdraví — pokud ho `--no-wait` nevypne.",
    ).not.toMatch(/--no-wait/);
    expect(radek, "přenasazení musí běžet v popředí, ne na pozadí").not.toMatch(/&\s*$/);
  });

  it("čekání je neblokující — vypršení není důkaz vady klíčů", () => {
    const i = bootstrap.indexOf(REDEPLOY_VOLANI);
    // ⛔ MĚŘÍ SE VLASTNOST, NE ZNĚNÍ. Do 2026-08-26 tu byl pin na doslovné
    // „warn \"nasazení nedoběhla" — a spadl, když se hláška přeformulovala
    // (čekání přešlo z pevného stropu na rozpočet na STÁNÍ). Přesné znění není
    // to, co chráníme; chráníme, že se na nezdar VARUJE a nekončí.
    const vetevNezdaru = bootstrap.slice(bootstrap.indexOf("\n      else", i));
    expect(
      vetevNezdaru,
      "vypršení čekání nesmí shodit bootstrap: klíče už jsou vyražené a doručené,\n" +
        "tvrdý exit by tu práci zahodil kvůli pomalé frontě",
    ).toMatch(/\bwarn\s+"/);
    expect(
      vetevNezdaru.slice(0, vetevNezdaru.indexOf("\n      fi") + 1),
      "…a nesmí z té větve odejít nenulovým kódem",
    ).not.toMatch(/\b(exit\s+[1-9]|return\s+[1-9])/);
  });
});
