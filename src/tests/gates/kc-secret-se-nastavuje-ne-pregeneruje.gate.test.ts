/**
 * Secret klienta se NASTAVUJE, ne přegeneruje (CLASS gate)
 *
 * TŘÍDA VADY: zápis vrátí úspěšný stavový kód a uloží NĚCO JINÉHO, než co jsme
 * poslali. Volající si pak myslí, že hodnotu zná, a rozdíl se projeví až jinde
 * a mnohem později.
 *
 * NAMĚŘENO 2026-08-10 na ČISTÉ instalaci po `--wipe`:
 *   `PUT /admin/realms/{r}/clients/{id}/client-secret` Keycloak tělo IGNORUJE
 *   a vygeneruje NÁHODNÝ secret. Vlastní komentář v kódu to přiznával
 *   („returns 204 when it generates new"), a volalo se to stejně.
 *   Druhý pokus `PUT /clients/{id}` s ČÁSTEČNÝM `{"secret": …}` tahle verze KC
 *   ignoruje také → v Keycloaku zůstala náhodná hodnota z prvního kroku.
 *
 *   Důsledek u `netbird-backend`:  KC eafca793aaf1  vs  env 59d4df26da79
 *   → NetBird se nemohl autentizovat → mesh nenaběhl → veřejný povrch dole.
 *
 * CO FUNGUJE (ověřeno na živém KC): GET klienta → doplnit `secret` → PUT CELOU
 * reprezentaci. Po zápisu KC vrátil shodu. Je to totéž, co dělá
 * `kcadm update clients/{id} -s secret=…`.
 *
 * DRUHÁ POLOVINA: PUBLIC klient žádný secret nemá. `aisha-app` má
 * `publicClient: true`, takže prázdné zpětné čtení je SPRÁVNÉ — hlásit to jako
 * selhání posílá operátora za neexistující vadou.
 *
 * INVARIANT:
 *   1. na `/client-secret` se smí jen ČÍST (GET), nikdy zapisovat
 *   2. secret se zapisuje PUT CELÉ reprezentace (GET → merge → PUT)
 *   3. public klient se přeskakuje, ne hlásí jako chyba
 *   4. po zápisu se ověřuje ZPĚTNÝM ČTENÍM, ne stavovým kódem
 *
 * Spousti se pres: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SSO = join(ROOT, "scripts/provision-sso.sh");

/** Řádky, které na daný endpoint ZAPISUJÍ (mají -X PUT/POST). */
export function findSecretRegenWrites(src: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  const lines = src.split("\n");
  lines.forEach((raw, i) => {
    if (/^\s*#/.test(raw)) return;                       // komentář není kód
    if (!/client-secret/.test(raw)) return;
    // zápis se pozná podle -X PUT/POST na témže řádku, nebo pár řádků nad ním
    const window = lines.slice(Math.max(0, i - 4), i + 1).join("\n");
    if (/-X\s+(PUT|POST)/.test(window)) out.push({ line: i + 1, text: raw.trim() });
  });
  return out;
}

describe("secret klienta se nastavuje, ne přegeneruje", () => {
  test("provision-sso.sh existuje (brána má co měřit)", () => {
    expect(existsSync(SSO)).toBe(true);
  });

  test("na /client-secret se pouze ČTE — žádný PUT/POST", () => {
    const src = readFileSync(SSO, "utf-8");
    const bad = findSecretRegenWrites(src);
    if (bad.length) {
      throw new Error(
        `Nalezen ZÁPIS na /client-secret (${bad.length}×). Keycloak u toho endpointu tělo\n` +
          `IGNORUJE a vygeneruje NÁHODNÝ secret — v KC pak je jiná hodnota než v env a\n` +
          `konzumenti dostanou invalid_client.\n` +
          `Nastavuj přes PUT CELÉ reprezentace klienta (GET → merge → PUT).\n\n` +
          bad.map((b) => `  provision-sso.sh:${b.line}  ${b.text}`).join("\n"),
      );
    }
    expect(bad).toEqual([]);
  });

  test("secret se zapisuje PUT celé reprezentace (GET → merge → PUT)", () => {
    const src = readFileSync(SSO, "utf-8");
    // Měří se, že se reprezentace NAČTE — ne kterým nástrojem. Dřív tu stál pin
    // na `rep=$(curl …`; jenže dotazy na Keycloak se sjednotily do `kc_api`
    // (aby selhavší dotaz nemohl vydat verdikt), a pin na tvar tu opravu blokoval.
    expect(src, "chybí načtení reprezentace klienta").toMatch(
      /(rep=\$\(curl[\s\S]{0,200}|kc_api GET "[^"]*)clients\/\$\{client_uuid\}/,
    );
    expect(src, "chybí merge secretu do reprezentace").toMatch(/jq -c --arg s "\$secret" '\.secret = \$s'/);
    // A do třetice: měří se, že se zapisuje SLOUČENÁ reprezentace — ať už ji
    // předá curl přímo, nebo `kc_api PUT … "$merged"`.
    expect(src, "zapisovat se má sloučená reprezentace").toMatch(
      /(--data-binary "\$merged"|kc_api PUT [^\n]*"\$merged")/,
    );
  });

  test("public klient se přeskakuje, ne hlásí jako selhání", () => {
    const src = readFileSync(SSO, "utf-8");
    expect(src, "nečte se publicClient").toMatch(/publicClient/);
    expect(src, "public klient musí vést na return 0, ne fail").toMatch(
      /is_public.*==.*"true"[\s\S]{0,300}return 0/,
    );
  });

  test("po zápisu se ověřuje ZPĚTNÝM ČTENÍM, ne stavovým kódem", () => {
    const src = readFileSync(SSO, "utf-8");
    // Totéž: podstatné je, že se secret po zápisu ZNOVU PŘEČTE, ne čím.
    expect(src, "chybí zpětné čtení secretu").toMatch(
      /(actual_secret=\$\(curl|kc_api GET "[^"]*\/client-secret")/,
    );
    expect(src, "musí se porovnávat s odeslanou hodnotou").toMatch(/"\$actual_secret" == "\$secret"/);
  });

  // ── Negativní testy ────────────────────────────────────────────────────────
  test("PUT na /client-secret je nález", () => {
    const s = `  curl -X PUT "\${KC_URL}/admin/realms/r/clients/\${id}/client-secret" \\\n    -d '{}'`;
    expect(findSecretRegenWrites(s).length).toBeGreaterThan(0);
  });

  test("GET na /client-secret není nález", () => {
    const s = `  actual=$(curl -sf "\${KC_URL}/admin/realms/r/clients/\${id}/client-secret")`;
    expect(findSecretRegenWrites(s)).toEqual([]);
  });

  test("zakomentovaný PUT není nález", () => {
    const s = `  # -X PUT ".../client-secret"  (dřívější tvar — regeneroval)`;
    expect(findSecretRegenWrites(s)).toEqual([]);
  });
});
