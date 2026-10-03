/**
 * Brána: allowlist se ODVOZUJE, nepíše se ručně.
 *
 * TŘÍDA VADY: seznam povolených hostitelů je druhá kopie informace, kterou už
 * drží adresa v konfiguraci. Dvě kopie se rozejdou — a protože obě vypadají
 * rozumně, pozná se to až tím, že volání skončí na SSRF bloku, daleko od místa
 * vzniku.
 *
 * ⛔ NAMĚŘENO 2026-08-19, jediná služba:
 *     svc-blockchain měl v seznamu  local-postgrest, local-keycloak
 *     ve skutečnosti volal na       aisha-postgrest, localhost, <x>-cosmos-node
 *   → 3 ze 4 položek mimo. Jinde stálo `aisha-openclaw` (jméno CIZÍ instance),
 *     zatímco OPENCLAW_URL vede na `<x>-companion.mesh.<tld>`.
 *
 * ⭐ ROZHODNUTÍ MAJITELE: „allowlist je něco udržovatelného a to nechceme,
 * chceme vše dynamické. U CORS se generuje z toho, co potřebuje přistupovat —
 * stejná logika je třeba všude."
 *
 * CÍLOVÝ TVAR — týž mechanismus jako CORS:
 *   config/domains.env      složenina (hostitel se loupe Z URL, ne skládá vedle)
 *   derive-composites.sh    dopočítá do SoT; klíč je v OWNED_COMPOSITES
 *   compose                 `${…:-}`, prázdno je platný stav
 *   packages/security       fail-closed konzument (prázdný seznam = nikam)
 *
 * CO SE MĚŘÍ: nikde ve compose ani v pipeline nesmí být allowlist NAPSANÝ.
 * Jediný dovolený domov literálu je `config/domains.env`.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = resolve(process.cwd());
const DOMOV = "config/domains.env";
const KLIC = /SSRF_HOST_ALLOWLIST/;

/** Univerzum se HLEDÁ: každý sledovaný soubor, který ten klíč zmiňuje. */
function nositele(): string[] {
  return execFileSync("git", ["grep", "-l", "SSRF_HOST_ALLOWLIST", "--", "docker-compose*.yml", "scripts", "config"], {
    cwd: ROOT, encoding: "utf-8",
  }).split("\n").filter(Boolean);
}

/** Hodnota vpravo od klíče: odvozená (`${…}`), nebo NAPSANÁ. */
function napsaneHodnoty(text: string): string[] {
  const vady: string[] = [];
  for (const radek of text.split("\n")) {
    if (!KLIC.test(radek) || /^\s*(#|\/\/|\*)/.test(radek.trim())) continue;
    // Klíč musí být na ZAČÁTKU řádku = přiřazení. Uvnitř řádku je to vzor,
    // kterým někdo allowlist MĚŘÍ (doktor, brána) — a měřidlo není zápis.
    const m = /^\s*SSRF_HOST_ALLOWLIST\s*[:=]\s*(.+)$/.exec(radek);
    if (!m) continue;
    const hodnota = m[1].trim();
    // Odvozené = celá hodnota je jedna reference na proměnnou.
    // Dovolené je JEN `${VAR}` nebo `${VAR:-}`. `${VAR:-a,b}` je napsaný seznam
    // schovaný ve výchozí hodnotě — přesně tak tam ta cizí jména celou dobu byla.
    if (/^\$\{[A-Za-z_][A-Za-z0-9_]*(:-)?\}$/.test(hodnota)) continue;
    if (hodnota === "" || hodnota === '""') continue;
    vady.push(radek.trim());
  }
  return vady;
}

describe("allowlist se nepíše ručně", () => {
  test("detektor pozná napsaný seznam i odvozenou hodnotu", () => {
    expect(napsaneHodnoty("      SSRF_HOST_ALLOWLIST: ${AI_CHAT_SSRF_ALLOWLIST:-}")).toEqual([]);
    expect(napsaneHodnoty("      SSRF_HOST_ALLOWLIST: ${X}")).toEqual([]);
    expect(
      napsaneHodnoty("      SSRF_HOST_ALLOWLIST: ${X:-api.openai.com,aisha-openclaw}"),
      "vnořený seznam ve výchozí hodnotě je pořád NAPSANÝ seznam",
    ).toHaveLength(1);
    expect(napsaneHodnoty("      SSRF_HOST_ALLOWLIST: cosmos-node")).toHaveLength(1);
    expect(
      napsaneHodnoty(`if ! grep -qE 'SSRF_HOST_ALLOWLIST:[[:space:]]*x' "$CC"; then`),
      "měřidlo není zápis — doktor a brány allowlist HLEDAJÍ, nepíšou ho",
    ).toEqual([]);
  });

  test("žádný soubor stacku allowlist NEPÍŠE — jediný domov je config/domains.env", () => {
    const vady: string[] = [];
    let mereno = 0;
    for (const rel of nositele()) {
      if (rel === DOMOV) continue;
      mereno++;
      for (const radek of napsaneHodnoty(readFileSync(resolve(ROOT, rel), "utf-8"))) {
        vady.push(`${rel}: ${radek}`);
      }
    }
    expect(mereno, "brána si univerzum HLEDÁ — nula souborů znamená, že měřidlo osleplo").toBeGreaterThan(0);
    expect(
      vady,
      "allowlist se ODVOZUJE, nepíše — napsaná kopie se rozejde s adresou, kterou služba volá.\n\n" +
        "CO S TÍM: složeninu přidej do ${DOMOV} (hostitele LOUPEJ z URL: `${VAR#*://}`, `${VAR%%:*}`),\n" +
        "klíč zapiš do OWNED_COMPOSITES v scripts/aisha-redeploy.mjs a compose ať ho jen ČTE (`${KLIC:-}`).\n" +
        "NEDĚLEJ: nedopisuj hodnotu do .env.coolify ručně (přepíše ji derivace) ani sem výjimku.\n\n" +
        "NAPSANÉ ZDE:\n  " + vady.join("\n  "),
    ).toEqual([]);
  });
});
