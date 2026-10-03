/**
 * Brána: doktor měří ROZVINUTOU HODNOTU, ne text šablony
 *
 * ⛔ NAMĚŘENO 2026-09-04. Fáze A doktora kontroluje sedm nosných domén a její
 * vlastní komentář říká proč: „Blank values here (e.g. only .example
 * placeholders after fresh clone or wrong overlay) cause 'variable is not set'
 * during docker compose build … and hard FATAL in render-app-config".
 *
 * Četla ale SYROVÝ řádek šablony:
 *
 *     val=$(grep -E "^${dkey}=" config/domains.env | head -1 | cut -d= -f2-)
 *
 * `config/domains.env` je od iterace 14 ŠABLONA, takže ten řádek zní
 * `APP_DOMAIN=${APP_DOMAIN:-}` a `cut` z něj vytáhne literál `${APP_DOMAIN:-}`.
 * Ten je neprázdný a neobsahuje ani „example", ani „placeholder" — kontrola
 * tedy ohlásila ✅ a NEMOHLA SELHAT NIKDY. Změřeno na všech sedmi klíčích.
 *
 * Následek je doložený: doktor hlásil 38 pass / 0 fails a cold-start umřel o
 * fázi dál; `netbird.aisha.example.com` a `pki.backend.internal.example.com`
 * prošly až do produkčního nasazení právě tudy. Kontrola, která nemůže
 * selhat, je horší než žádná — tvrdí, že něco hlídá.
 *
 * Táž třída jako `mesh_default` bez konzumenta a jako `ENABLE_GOOGLE_OAUTH`,
 * které bylo osm měsíců zapnuté a přihlašovací stránka nabízela jen heslo.
 *
 * Brána proto žádá, aby smyčka:
 *   1. brala hodnoty z RESOLVERU (jediný zdroj pravdy o topologii),
 *   2. nečetla `config/domains.env` přes `cut -d=` (to je čtení šablony),
 *   3. uměla odmítnout i NEROZVINUTOU hodnotu (`${…}`) — protože právě ta
 *      předtím procházela jako platná.
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const DOCTOR = join(ROOT, "scripts/cold-start-doctor.sh");

/** Tělo smyčky přes nosné domény — od `for dkey in …` po `done`. */
function smyckaDomen(src: string): string {
  const start = src.indexOf("for dkey in APP_DOMAIN");
  if (start < 0) return "";
  const end = src.indexOf("\n    done", start);
  return end < 0 ? src.slice(start) : src.slice(start, end);
}

const SRC = existsSync(DOCTOR) ? readFileSync(DOCTOR, "utf8") : "";
const SMYCKA = smyckaDomen(SRC);

describe("doktor měří hodnotu, ne šablonu", () => {
  test("doktor a jeho smyčka domén se našly (jinak brána nic neměří)", () => {
    expect(existsSync(DOCTOR), "scripts/cold-start-doctor.sh musí existovat").toBe(true);
    expect(
      SMYCKA.length,
      "smyčka `for dkey in APP_DOMAIN …` v doktorovi nenalezena — brána by tiše prošla",
    ).toBeGreaterThan(0);
  });

  test("hodnoty bere z resolveru", () => {
    expect(
      SMYCKA,
      `Smyčka nekonzultuje derive-domains.mjs. Resolver je jediný zdroj pravdy o tom,\n` +
        `jakou adresu služba MÁ; cokoli jiného je druhá pravda o téže hodnotě.`,
    ).toMatch(/derive-domains\.mjs/);
  });

  test("nečte config/domains.env přes cut -d= (to je text šablony)", () => {
    const cteSablonu = /grep[^\n]*domains\.env[^\n]*cut\s+-d=/.test(SMYCKA);
    expect(
      cteSablonu,
      `Smyčka čte syrový řádek config/domains.env. Ten soubor je ŠABLONA, takže\n` +
        `u 'APP_DOMAIN=\${APP_DOMAIN:-}' dostane literál '\${APP_DOMAIN:-}' — neprázdný,\n` +
        `bez slova „example" — a ohlásí ✅. Přesně tak kontrola určená na .example\n` +
        `placeholdery nemohla selhat nikdy (naměřeno 2026-09-04 na všech 7 klíčích).`,
    ).toBe(false);
  });

  test("odmítne i nerozvinutou hodnotu", () => {
    expect(
      SMYCKA,
      `Smyčka nekontroluje, jestli hodnota nezůstala nerozvinutá ('\${…}').\n` +
        `Právě nerozvinutý literál byl ten, co osm kontrol pouštělo jako platný.`,
    ).toMatch(/==\s*\*'\$\{'\*/);
  });

  test("prázdnou hodnotu hlásí jako chybu, ne jako úspěch", () => {
    // V původní verzi se prázdno vůbec nemohlo objevit, protože literál šablony
    // je vždy neprázdný — proto se na něj musí existovat výslovná `fail` větev.
    //
    // Měří se KONKRÉTNÍ hláška, ne vzdálenost od `-z "$val"`. První verze tohoto
    // testu brala 300 znaků za prvním výskytem a zčervenala, jakmile jsem nad
    // fallback přidal komentář — anchor na pozici měří formátování, ne chování.
    expect(SMYCKA).toMatch(/-z "\$val"/);
    expect(
      SMYCKA,
      "chybí výslovná `fail` větev pro prázdnou hodnotu",
    ).toMatch(/fail "domains: \$dkey se nerozvinul/);
  });
});
