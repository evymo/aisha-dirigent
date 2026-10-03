/**
 * Objevovaná hodnota nesmí mít dosazený default (CLASS gate)
 *
 * TŘÍDA VADY: hodnota, kterou runtime OBJEVUJE (peer IP, UUID serveru, adresa
 * zjištěná z API), dostane v compose `:-<literál>`. Dosadit ji znamená HÁDAT
 * fakt o světě — a hádaná adresa je horší než chybějící: chybějící selže na
 * správném místě, hádaná tiše trefí něco jiného.
 *
 * Naměřeno 2026-08-09 na `docker-compose.coolify-prebuilt.yml`:
 *
 *     CORE_MESH_IP: ${CORE_MESH_IP:-100.64.0.2}
 *
 * Hned pod tím stála kontrola prázdné hodnoty s poctivým odůvodněním
 * („Prázdné CORE_MESH_IP nesmí projít TIŠE … Hlásit to je levné; hádat, proč
 * api padá, stálo hodiny", měřeno 2026-07-29). Jenže ten default zajistil, že
 * prázdná hodnota se ke kontrole NIKDY nedostala — fallback umlčel varování
 * napsané přesně proti němu. Místo hlášky vzniklo DNAT na hádanou mesh IP.
 *
 * ── ROZLIŠENÍ, KTERÉ TAHLE BRÁNA DĚLÁ ─────────────────────────────────────
 * Ne každý `:-` je vada. Rozhoduje, ODKUD hodnota pochází:
 *
 *   OBJEVOVANÁ (default zakázán) — runtime ji zjišťuje z živého systému:
 *     *_MESH_IP        peer IP z NetBird discovery
 *     *_SERVER_UUID*   UUID serveru z Coolify /servers
 *     *_PEER_IP        totéž jinými slovy
 *
 *   VOLENÁ (default povolen) — naše rozhodnutí, ne měření:
 *     subnety (172.30.0.0/24), porty, CPU limity, e2e bind 127.0.0.1,
 *     Docker embedded DNS 127.0.0.11
 *
 * Proto se nekontroluje „je to IP adresa", ale „je to jméno objevované
 * veličiny". Kdyby brána zakazovala každou literální IP, křičela by na
 * subnety — a brána, které se přestane věřit, nechrání nic.
 *
 * ── PROČ `:-` A NE `:?` ───────────────────────────────────────────────────
 * Prázdná CORE_MESH_IP je před vlnou 5 LEGITIMNÍ (mesh se teprve zapíná —
 * WAVES[5]). `:?` by shodil interpolaci celého stacku už ve vlně 2. Správně je
 * prázdný default: interpolace projde, runtime kontrola nahlásí.
 *
 * Spousti se pres: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const ROOT = process.cwd();

/** Jména veličin, které runtime OBJEVUJE. Dosadit je = hádat fakt o světě. */
const DISCOVERED = /^[A-Z0-9_]*(MESH_IP|PEER_IP|SERVER_UUID(_[A-Z]+)?)$/;

/**
 * Mohl by tenhle default projít jako SKUTEČNÁ hodnota svého druhu?
 * IP adresa, UUID/slug, hostname → ano, to je hádání faktu.
 * `(unset)`, `<none>`, `?` → ne, to je zástupka pro čtenáře logu.
 */
export function looksLikeRealValue(d: string): boolean {
  if (/^[([<]/.test(d)) return false;            // (unset), <none>, [none]
  if (/\s/.test(d)) return false;                 // víceslovná prosa
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(d)) return true;   // IPv4
  if (/^[a-z0-9]{8,}$/i.test(d)) return true;     // UUID / Coolify slug
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(d)) return true; // hostname
  return false;
}

interface Violation { file: string; line: number; name: string; dflt: string; text: string }

function composeFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "-z", "docker-compose*.yml", "docker-compose*.yaml"], {
    cwd: ROOT, encoding: "utf-8", maxBuffer: 16 * 1024 * 1024,
  });
  return out.split("\0").filter(Boolean);
}

/** `${NAME:-default}` — vrací jen ta, kde je default NEPRÁZDNÝ. */
export function findDiscoveredWithDefault(file: string, content: string): Violation[] {
  const out: Violation[] = [];
  content.split("\n").forEach((line, i) => {
    // Komentář není konfigurace. Bez tohohle by o vadě nešlo ani napsat — brána
    // by chytila vlastní odůvodnění, které ten špatný vzor cituje.
    if (line.trim().startsWith("#")) return;
    for (const m of line.matchAll(/\$\{([A-Z0-9_]+):-([^}]*)\}/g)) {
      const [, name, dflt] = m;
      if (!DISCOVERED.test(name)) continue;
      if (dflt.trim() === "") continue; // prázdný default je správné řešení
      // Zástupka ve výpisu není dosazená hodnota. `echo "IP=${X:-(unset)}"` dělá
      // prázdnotu VIDITELNOU — to je opak téhle vady. Flagujeme jen default,
      // který by mohl být zaměněn za skutečnou hodnotu svého druhu.
      if (!looksLikeRealValue(dflt.trim())) continue;
      out.push({ file, line: i + 1, name, dflt, text: line.trim() });
    }
  });
  return out;
}

describe("objevovaná hodnota nemá dosazený default", () => {
  test("žádný compose nedosazuje hodnotu, kterou runtime objevuje", () => {
    const violations: Violation[] = [];
    for (const f of composeFiles()) {
      violations.push(...findDiscoveredWithDefault(f, readFileSync(join(ROOT, f), "utf-8")));
    }
    if (violations.length) {
      const msg = violations
        .map((v) => `  ${v.file}:${v.line}  ${v.name} := "${v.dflt}"\n    ${v.text}`)
        .join("\n");
      throw new Error(
        `Nalezeno ${violations.length} dosazení objevované hodnoty.\n` +
          `Runtime ji zjišťuje z živého systému; literál je HÁDÁNÍ faktu o světě — a hádaná\n` +
          `adresa je horší než chybějící: chybějící selže na správném místě, hádaná tiše\n` +
          `trefí něco jiného. Navíc umlčí kontroly prázdné hodnoty pod sebou\n` +
          `(CORE_MESH_IP / 100.64.0.2, naměřeno 2026-08-09).\n\n` +
          `Použij prázdný default \${NAME:-} a nech runtime nahlásit chybějící hodnotu.\n\n${msg}`,
      );
    }
    expect(violations).toEqual([]);
  });

  test("regrese: CORE_MESH_IP v edge compose nemá literální default", () => {
    const f = "docker-compose.coolify-prebuilt.yml";
    const src = readFileSync(join(ROOT, f), "utf-8");
    // Táž logika jako hlavní sken: zástupka ve výpisu (`(unset)`) není nález.
    const bad = src
      .split("\n")
      .filter((l) => !l.trim().startsWith("#"))
      .filter((l) => {
        const m = l.match(/\$\{CORE_MESH_IP:-([^}]+)\}/);
        return m ? looksLikeRealValue(m[1].trim()) : false;
      });
    expect(
      bad,
      "CORE_MESH_IP se plní z NetBird discovery (coolify-mesh-sync.mjs); dosazená " +
        "hodnota vyrobí DNAT na cizí adresu a umlčí kontrolu prázdné hodnoty pod sebou",
    ).toEqual([]);
  });

  test("kontrola prázdné hodnoty pod tím je stále dosažitelná", () => {
    // Smysl téhle kontroly: default nesmí nikdy zaručit, že do case-větve
    // nedorazí prázdná hodnota. Kdyby se default vrátil, tenhle test padne
    // spolu s předchozím — dvě nezávislé cesty ke stejné pravdě.
    const src = readFileSync(join(ROOT, "docker-compose.coolify-prebuilt.yml"), "utf-8");
    expect(/case "\$\$\{CORE_MESH_IP\}" in/.test(src), "runtime kontrola musí zůstat").toBe(true);
    expect(
      /CORE_MESH_IP: \$\{CORE_MESH_IP:-\}/.test(src),
      "prostředí musí prázdnou hodnotu propustit až k té kontrole",
    ).toBe(true);
  });

  // Negativní testy — brána, která nemůže padnout, není brána.
  test("detektor chytí hádanou mesh IP", () => {
    const s = "      CORE_MESH_IP: ${CORE_MESH_IP:-100.64.0.2}";
    expect(findDiscoveredWithDefault("x.yml", s).map((v) => v.name)).toEqual(["CORE_MESH_IP"]);
  });

  test("komentář citující ten špatný vzor se neflaguje", () => {
    const s = "      # `:-100.64.0.2` tu UMLČEL kontrolu: ${CORE_MESH_IP:-100.64.0.2}";
    expect(findDiscoveredWithDefault("x.yml", s)).toEqual([]);
  });

  test("zástupka ve výpisu není dosazená hodnota", () => {
    const s = '              echo "CORE_MESH_IP=$${CORE_MESH_IP:-(unset)}"';
    expect(findDiscoveredWithDefault("x.yml", s)).toEqual([]);
    expect(looksLikeRealValue("(unset)")).toBe(false);
    expect(looksLikeRealValue("100.64.0.2")).toBe(true);
    expect(looksLikeRealValue("rwoc0g4c08gggowkg88c4goo")).toBe(true);
  });

  test("prázdný default je správné řešení, ne nález", () => {
    expect(findDiscoveredWithDefault("x.yml", "      CORE_MESH_IP: ${CORE_MESH_IP:-}")).toEqual([]);
  });

  test("VOLENÉ hodnoty s defaultem se neflagují (subnety, porty, CPU, bind)", () => {
    const s = [
      '      - "${E2E_DB_BIND:-127.0.0.1}:${E2E_DB_PORT:-57422}:5432"',
      "    cpus: ${KEYCLOAK_CPUS:-1.0}",
      '      SUBNET: ${AISHA_NETSEG_BACKEND_SUBNET:-172.31.0.0/24}',
      "      DNS: ${NETBIRD_DNS_IP:-127.0.0.11}",
    ].join("\n");
    expect(findDiscoveredWithDefault("x.yml", s)).toEqual([]);
  });

  test("chytí i UUID serveru, nejen IP", () => {
    const s = "      SRV: ${COOLIFY_SERVER_UUID_BACKEND:-rwoc0g4c08gggowkg88c4goo}";
    expect(findDiscoveredWithDefault("x.yml", s).map((v) => v.name)).toEqual([
      "COOLIFY_SERVER_UUID_BACKEND",
    ]);
  });
});
