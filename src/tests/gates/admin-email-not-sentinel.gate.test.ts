/**
 * Gate: vyplněný klíč ještě neznamená použitelnou hodnotu.
 *
 * PROČ (2026-07-29)
 * ----------------
 * `PGADMIN_EMAIL=admin@example.invalid` prošlo VŠEMI kontrolami: klíč v CONTRACT
 * je, hodnota není prázdná, compose se interpoluje. A pgAdmin přesto padal
 * v restartovací smyčce od 15. 12., protože `.invalid` doménu odmítá jako
 * nedoručitelnou:
 *
 *     'admin@example.invalid' does not appear to be a valid email address.
 *
 * Sentinel měl čitelný záměr — RFC6761 značka „operátor to ještě nenastavil".
 * Jenže env-doctor kontroluje PŘÍTOMNOST klíče, ne jeho POUŽITELNOST, takže se
 * ta značka projevila až za běhu, u služby, která na ni umřela.
 *
 * A byla LEPIVÁ: `preservedValue()` recykluje existující hodnotu napořád, takže
 * se jednou zapsaný sentinel sám nikdy nenahradil. Táž třída jako
 * „preserved-secret strength floor" — hodnota, která NEPROJDE politikou, se
 * nemá zachovávat.
 *
 * Změřeno: tři z pěti admin adres nesly sentinel (langfuse, appsmith, pgadmin),
 * dvě už byly odvozené (nocodb, platform). Ta nesouměrnost je celý nález.
 *
 * CO SE MĚŘÍ
 * ----------
 * Výstup generátoru, ne zdrojový text: pouští se `generate-secrets.mjs` a čte
 * se, co skutečně vydá. Sonda na pravopis by minula vše, co vznikne kaskádou.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");

/** Adresy, které generátor skutečně vydá, s PUBLIC_TLD dodaným zvenčí. */
function emittedEmails(publicTld: string, args: string[] = []): Record<string, string> {
  const out = execFileSync("node", ["scripts/generate-secrets.mjs", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    // Bez env souboru: měří se ČISTÉ odvození, ne to, co náhodou leží v .env.
    // APP_NAME_PREFIX je povinný — generátor odmítá běžet bez identity instance
    // (a má pravdu: rozhoduje, do které Coolify jmenné oblasti se zapisuje).
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      APP_NAME_PREFIX: "gatetest",
      PUBLIC_TLD: publicTld,
    },
  });
  const emails: Record<string, string> = {};
  for (const line of out.split("\n")) {
    const m = line.match(/^([A-Z_]*EMAIL[A-Z_]*)='?([^']*)'?$/);
    if (m && m[2].includes("@")) emails[m[1]] = m[2];
  }
  return emails;
}

const SENTINEL = /@(.*\.invalid|example\.(com|org|net))$/i;

describe("admin adresy", () => {
  it("generátor nějaké adresy vydává (jinak sonda nic neměří)", () => {
    expect(Object.keys(emittedEmails("example.test")).length).toBeGreaterThan(3);
  });

  it("žádná vydaná adresa nenese sentinel, zná-li instance svou doménu", () => {
    const emails = emittedEmails("instance.example.test");
    const bad = Object.entries(emails)
      .filter(([, v]) => SENTINEL.test(v))
      .map(([k, v]) => `${k}=${v}`)
      .sort();
    expect(
      bad,
      `Adresa se sentinelovou doménou — klíč je vyplněný, ale služba ji odmítne:\n  ${bad.join("\n  ")}`,
    ).toEqual([]);
  });

  it("sentinel PŘEDANÝ v argumentu se nepočítá jako zadaná hodnota", () => {
    // Nejde o teorii: aisha-cold-start.sh volá generátor s
    //   --nocodb-admin-email="${NOCODB_ADMIN_EMAIL:-${SMTP_ADMIN_EMAIL:-admin@example.invalid}}"
    // a argument má přednost před odvozením. Oprava jen uvnitř generátoru by
    // tedy neplatila právě při cold startu — jediné cestě, kterou se tyhle
    // hodnoty do .env.coolify dostávají.
    const emails = emittedEmails("instance.example.test", [
      "--admin-email=admin@example.invalid",
      "--nocodb-admin-email=admin@example.com",
    ]);
    const bad = Object.entries(emails)
      .filter(([, v]) => SENTINEL.test(v))
      .map(([k, v]) => `${k}=${v}`)
      .sort();
    expect(bad, `Sentinel z argumentu prošel až do výstupu:\n  ${bad.join("\n  ")}`).toEqual([]);
  });

  it("adresu zadanou operátorem generátor NEPŘEPÍŠE", () => {
    // Protipól předchozího testu. Kdyby se filtr rozšířil na cokoli, co „nevypadá
    // správně", přišel by operátor o možnost adresu určit — a to je horší vada
    // než sentinel, protože tichá.
    const emails = emittedEmails("instance.example.test", ["--admin-email=sef@firma.example"]);
    expect(emails.PGADMIN_EMAIL).toBe("sef@firma.example");
  });

  it("adresy se odvozují z domény instance, ne z pevného literálu", () => {
    // Vlastnost, ne pravopis: změna domény MUSÍ změnit adresy. Kdyby se jen
    // přepsal jeden literál za jiný, tenhle test to odhalí.
    const a = emittedEmails("first.example.test");
    const b = emittedEmails("second.example.test");
    const derived = Object.keys(a).filter((k) => a[k] !== b[k]);
    expect(
      derived.length,
      `Žádná adresa se s doménou instance nezměnila — jsou psané natvrdo:\n  ${JSON.stringify(a, null, 2)}`,
    ).toBeGreaterThan(0);
    for (const k of derived) {
      expect(a[k], `${k} se neodvozuje z PUBLIC_TLD`).toContain("first.example.test");
    }
  });
});
