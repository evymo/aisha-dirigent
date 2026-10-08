/**
 * Compose nese KONFIGURACI, ne prózu (CLASS gate)
 *
 * ⛔ NAMĚŘENO 2026-09-04. Přidání jediné služby do `docker-compose.coolify.yml`
 * přerazilo strop `ARG_MAX` (36 875 B proti stropu 35 000). Ukázalo se, že core
 * byl **823 B pod stropem ještě PŘED** přidáním čehokoli — takže každý další
 * řádek byl blokující, a člověk, který tam chtěl dopsat službu, musel nejdřív
 * uklidit cizí komentáře.
 *
 * Konvence tu přitom už byla — hlavička `docker-compose.coolify-exec.yml`:
 *
 *     "this file is shipped to the server as a command-line argument and
 *      competes with ARG_MAX, so it carries configuration only.
 *      Add explanations there, anchored to the line they explain."
 *
 * ⭐ Jenže konvence zapsaná v komentáři JEDNOHO souboru není pravidlo — je to
 * přání. Vymáhá ji tahle brána; próza patří do `docs/compose-notes/<soubor>.md`.
 *
 * ⛔ BLOKOVÝ SKALÁR NENÍ KOMENTÁŘ. Komentář uvnitř `command: |` je OBSAH, který
 * se nasazuje, ne metadata. První verze přesunu to nerozlišila a změnila
 * rendrovaný compose (naměřeno týž den: 13 z 51 komentářů v core leželo uvnitř
 * skriptů, mj. celý rozbor `trusted_proxies` u Caddy). Detekce to proto řeší
 * sledováním odsazení bloků, ne hledáním `#`.
 *
 * ⭐ PRÁH JE NA SOUVISLÝCH BLOCÍCH, ne na jednotlivých řádcích. Krátká poznámka
 * u konfiguračního řádku nese kontext PŘÍMO tam, kde je potřeba, a její přesun
 * by čtenáři ubral víc, než přidal. Blokuje se až vyprávění.
 */
import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
/** Kolik po sobě jdoucích YAML komentářů už je próza, ne poznámka. */
const PRAH_RADKU = 4;

/**
 * Indexy řádků, které jsou SKUTEČNĚ YAML komentáře.
 * Řádek uvnitř blokového skaláru (`command: |`, `entrypoint: >`) se nepočítá.
 */
export function yamlKomentare(radky: readonly string[]): Set<number> {
  const out = new Set<number>();
  let blokIndent: number | null = null;
  for (let i = 0; i < radky.length; i += 1) {
    const r = radky[i];
    const holy = r.trim();
    const indent = r.length - r.trimStart().length;
    if (blokIndent !== null) {
      if (holy === "" || indent > blokIndent) continue;
      blokIndent = null;
    }
    if (/[|>][-+]?$/.test(holy)) { blokIndent = indent; continue; }
    if (holy.startsWith("#")) out.add(i);
  }
  return out;
}

/** Souvislé bloky YAML komentářů delší než práh. */
function prozaBloky(radky: readonly string[]): Array<{ od: number; do: number }> {
  const y = yamlKomentare(radky);
  const out: Array<{ od: number; do: number }> = [];
  let i = 0;
  while (i < radky.length) {
    if (y.has(i)) {
      let j = i;
      while (y.has(j)) j += 1;
      if (j - i >= PRAH_RADKU) out.push({ od: i, do: j });
      i = j;
    } else i += 1;
  }
  return out;
}

const soubory = readdirSync(ROOT).filter((f) => /^docker-compose\.coolify.*\.ya?ml$/.test(f)).sort();

/**
 * ROHATKA, ne ultimátum.
 *
 * Konvence se nedodržuje NIKDE — 40 bloků v 15 souborech. Vyžadovat úklid
 * všech naráz by znamenalo bránu, kterou nikdo nemůže splnit, a taková se
 * neopravuje, ta se vypíná. Stav se proto ZMRAZÍ a smí jen KLESAT; týž vzor
 * má `build-time-mnozina-vsech-compose`.
 *
 * ⛔ `docker-compose.coolify.yml` MUSÍ ZŮSTAT NA NULE. Je jediný, který se
 * o strop `ARG_MAX` opravdu otírá (34 182 B proti 35 000 po úklidu), takže
 * u něj próza není estetika, ale blokace další práce: kdo tam chce dopsat
 * službu, musel by nejdřív uklízet cizí komentáře. Chybějící záznam v mapě
 * proto znamená NULA, ne „nesledováno".
 */
const ROHATKA: Record<string, number> = {
  "docker-compose.coolify-clamav.yml": 4,
  "docker-compose.coolify-domain-services.yml": 1,
  "docker-compose.coolify-exec.yml": 1,
  "docker-compose.coolify-extranet.yml": 2,
  "docker-compose.coolify-integration.yml": 2,
  // 2026-09-12 (slití <fork>): čtyři forkové bloky odešly do compose-notes, zbyl jeden (naměřeno 1).
  "docker-compose.coolify-keycloak.yml": 1,
  "docker-compose.coolify-local-ingest.yml": 5,
  // ⛔ GENEROVANÉ SOUBORY: 1 = povinné varování „NEUPRAVUJ RUČNĚ", ne próza.
  // Výklad žije ve zdroji `scripts/gen-mesh-router.mjs`; ve výstupu zůstává jen
  // věta, která čtenáři brání editovat soubor, který se při příští regeneraci
  // přepíše. Bez ní je ruční úprava tichá ztráta práce — ověřeno na vlastní kůži
  // 2026-09-07, kdy sem extrakce prózy sáhla a generátor to vzápětí přepsal.
  "docker-compose.coolify-mesh-router-backend.yml": 1,
  "docker-compose.coolify-mesh-router-experimental.yml": 1,
  "docker-compose.coolify-matrix.yml": 1,
  "docker-compose.coolify-n8n.yml": 3,
  // 2026-10-05 (generátor instancí NetBirdu): próza netbird šla do compose-notes, naměřeno 0 — rohatka dotažena.
  "docker-compose.coolify-pki.yml": 1,
  "docker-compose.coolify-playwright.yml": 2,
  "docker-compose.coolify-prebuilt.yml": 4,
  "docker-compose.coolify-shared-redis.yml": 1,
  // 2026-09-12 (slití <fork>): naměřeno 0 bloků — rohatka dotažena, ať se próza nevrátí.
  "docker-compose.coolify-source-broker.yml": 0,
};

describe("compose nese konfiguraci, ne prózu", () => {
  test("univerzum není prázdné — jinak by brána mlčela z nedostatku vstupu", () => {
    expect(soubory.length).toBeGreaterThan(5);
  });

  test.each(soubory)("%s: próza smí jen KLESAT", (soubor) => {
    const radky = readFileSync(join(ROOT, soubor), "utf8").split("\n");
    const bloky = prozaBloky(radky);
    const strop = ROHATKA[soubor] ?? 0;
    const popis = bloky.map((b) => `  ř.${b.od + 1}-${b.do}: ${radky[b.od].trim().slice(0, 60)}`).join("\n");
    expect(
      bloky.length,
      `${soubor} veze ${bloky.length} blok(ů) prózy, rohatka je ${strop}. ` +
        `Compose jde na server JAKO ARGUMENT PŘÍKAZU a soutěží s ARG_MAX — próza patří ` +
        `do docs/compose-notes/${soubor}.md, anchored k řádku, který vysvětluje. ` +
        `Když blok ubyde, SNIŽ i rohatku, ať se nemůže vrátit.\n${popis}`,
    ).toBeLessThanOrEqual(strop);
  });

  test("komentář UVNITŘ blokového skaláru se za prózu NEPOVAŽUJE", () => {
    // ⛔ Regrese na první verzi přesunu, která tohle nerozlišila a změnila
    // rendrovaný compose. Komentář ve skriptu je obsah, ne metadata.
    const vzorek = [
      "services:",
      "  a:",
      "    command: |",
      "      # tohle je SHELL komentar uvnitr skriptu",
      "      # a nesmi se povazovat za prozu",
      "      # ani kdyz je dlouhy",
      "      # ctyri radky",
      "      echo ahoj",
    ];
    expect(prozaBloky(vzorek)).toEqual([]);
  });

  test("skutečná YAML próza se NAJDE — jinak by brána nemohla nikdy spustit", () => {
    const vzorek = [
      "services:",
      "  # tohle je vypraveni",
      "  # ktere patri do notes",
      "  # protoze je dlouhe",
      "  # a nikdo ho tu necte",
      "  a:",
      "    image: x",
    ];
    expect(prozaBloky(vzorek).length).toBe(1);
  });

  test("krátká poznámka u konfigurace projde — blokuje se vyprávění, ne kontext", () => {
    const vzorek = ["services:", "  a:", "    # proc zrovna tenhle port", "    ports:", '      - "80"'];
    expect(prozaBloky(vzorek)).toEqual([]);
  });
});
