/**
 * PKI stack dostane identitu CA (CLASS gate)
 *
 * TŘÍDA VADY: hodnota se VYROBÍ (je v .env.coolify), ale nikdo ji nedoručí do
 * kontejneru, který ji potřebuje. `printenv` uvnitř pak vrací prázdno a služba
 * padne na něčem, co vypadá jako chybějící konfigurace instance.
 *
 * NAMĚŘENO 2026-08-10: `pki-realm-bootstrap.sh` skončil na
 *   FATAL: cannot determine CA identity — set AISHA_CA_NAME / AISHA_OPERATOR_ORG (or APP_NAME_PREFIX)
 * Přitom všechny tři proměnné v `.env.coolify` byly. Compose PKI stacku
 * nepředával ani jednu (grep = 0). Realm CA se proto nezaložila → `pki-init`
 * v CORE po 600 s fail-closed → aisha-core nikdy nenaběhl.
 *
 * Vada byla v PKI, ale ohlásila se o tři vlny později v jiné aplikaci — proto
 * je invariant tady, u zdroje.
 *
 * INVARIANT: služba, která mintuje realm CA (pki-server), dostává identitu
 * instance. `APP_NAME_PREFIX` je povinný (`:?` — dosazená identita by vydala
 * certifikát znějící na cizí subjekt); `AISHA_CA_NAME` / `AISHA_OPERATOR_ORG`
 * smí být prázdné, protože bootstrap má z prefixu na co spadnout.
 *
 * Spousti se pres: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const PKI = join(ROOT, "docker-compose.coolify-pki.yml");

/** Blok `environment:` služby pki-server. */
export function pkiServerEnvBlock(src: string): string {
  const start = src.indexOf("\n  pki-server:");
  expect(start, "služba pki-server nenalezena — změnil se tvar compose?").toBeGreaterThanOrEqual(0);
  const rest = src.slice(start + 1);
  // konec = další služba na téže úrovni odsazení
  const end = rest.search(/\n {2}[a-z][a-z0-9-]*:\n/);
  return end > 0 ? rest.slice(0, end) : rest;
}

describe("PKI dostane identitu CA", () => {
  const src = readFileSync(PKI, "utf-8");

  test("pki-server dostává APP_NAME_PREFIX a je POVINNÝ", () => {
    const block = pkiServerEnvBlock(src);
    expect(block, "APP_NAME_PREFIX se pki-serveru nedoručuje").toMatch(/^\s+APP_NAME_PREFIX:/m);
    // `:?` — identita se nesmí dosadit; certifikát by zněl na cizí subjekt.
    expect(
      /APP_NAME_PREFIX:\s*"\$\{APP_NAME_PREFIX:\?/.test(block),
      "APP_NAME_PREFIX musí být `:?` (bez dosazení) — jinak CA vydá cert na cizí subjekt",
    ).toBe(true);
  });

  test("pki-server dostává i AISHA_CA_NAME / AISHA_OPERATOR_ORG", () => {
    const block = pkiServerEnvBlock(src);
    for (const v of ["AISHA_CA_NAME", "AISHA_OPERATOR_ORG"]) {
      expect(block, `${v} se pki-serveru nedoručuje`).toMatch(new RegExp(`^\\s+${v}:`, "m"));
    }
  });

  test("regrese: bootstrap čte právě tyhle tři proměnné", () => {
    // Kdyby se v skriptu přejmenovaly, brána výš by hlídala mrtvá jména.
    const boot = readFileSync(join(ROOT, "infra/pki/pki-realm-bootstrap.sh"), "utf-8");
    expect(boot).toMatch(/AISHA_CA_NAME/);
    expect(boot).toMatch(/AISHA_OPERATOR_ORG/);
    expect(boot).toMatch(/APP_NAME_PREFIX/);
  });

  // ── Negativní testy ────────────────────────────────────────────────────────
  test("blok bez APP_NAME_PREFIX je nález", () => {
    const fake = '\n  pki-server:\n    environment:\n      REALMS: "a b"\n\n  pki-db:\n';
    const block = pkiServerEnvBlock(fake);
    expect(/^\s+APP_NAME_PREFIX:/m.test(block)).toBe(false);
  });

  test("APP_NAME_PREFIX s dosazením (`:-`) je nález", () => {
    const fake = '\n  pki-server:\n    environment:\n      APP_NAME_PREFIX: "${APP_NAME_PREFIX:-aisha}"\n\n  pki-db:\n';
    const block = pkiServerEnvBlock(fake);
    expect(/APP_NAME_PREFIX:\s*"\$\{APP_NAME_PREFIX:\?/.test(block)).toBe(false);
  });
});
