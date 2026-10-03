/**
 * Instanční overlay nesmí ZTRATIT platformní klíč tématu
 *
 * `Dockerfile.keycloak` kopíruje téma ve dvou krocích:
 *
 *   COPY keycloak/themes/aisha            /opt/keycloak/themes/aisha   (platforma)
 *   COPY --from=theme-overlay /themes/    /opt/keycloak/themes/        (instance)
 *
 * Instanční krok je DRUHÝ, takže soubor stejného jména platformní **nahradí
 * celý** — ne po klíčích. Overlay tedy není „přepis vybraných hodnot", je to
 * výměna souboru. Co v instanční verzi nestojí, na stránce prostě není.
 *
 * NAMĚŘENO 2026-08-02. Platformní #106 nahradila tři kontrolky s produktovými
 * jmény jedním agregovaným příznakem a přidala `loginStatusUnknown/Ok/Degraded`.
 * Instance ale vlastní obě jazykové sady, takže po nasazení by platilo:
 *
 *   ztraceno : loginStatusUnknown / loginStatusOk / loginStatusDegraded
 *              → nový příznak bez textů
 *   přežilo  : loginStackSso=Keycloak SSO, loginStackData=PostgreSQL
 *              → přesně ta jména subsystémů, která #106 odstraňovala
 *
 * Tedy: platformní oprava by se nasadila a instance by ji potichu zrušila.
 * Build i deploy přitom projdou zeleně — pozná se to až očima na stránce.
 *
 * CO BRÁNA MĚŘÍ: pro každý platformní soubor s hláškami, který instanční overlay
 * také vlastní, musí být množina klíčů overlaye NADMNOŽINOU platformní. Hodnoty
 * se nekontrolují — ty se přepisovat MAJÍ, o to overlay jde.
 *
 * Bez `AISHA_INSTANCE_CONFIG_DIR` nemá co měřit a řekne to nahlas místo tiché
 * zelené; v CI ho `AISHA_OVERLAY_REQUIRED=1` povyšuje na povinný.
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { overlayDir, overlayRequired } from "../../../scripts/lib/instance-overlay.mjs";

const ROOT = process.cwd();
const PLATFORM_THEMES = join(ROOT, "keycloak", "themes");

/** Každý `*.properties` pod platformním tématem — seznam se NEUDRŽUJE ručně. */
function platformMessageFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".properties")) out.push(p);
    }
  };
  walk(PLATFORM_THEMES);
  return out;
}

/** Klíče z .properties — komentáře a prázdné řádky pryč. */
function keysOf(file: string): Set<string> {
  const keys = new Set<string>();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || t.startsWith("!")) continue;
    const eq = t.indexOf("=");
    if (eq > 0) keys.add(t.slice(0, eq).trim());
  }
  return keys;
}

describe("Instanční overlay nesmí ztratit platformní klíč tématu (gate)", () => {
  test("overlay, který vlastní soubor hlášek, nese všechny platformní klíče", () => {
    const platformFiles = platformMessageFiles();
    expect(
      platformFiles.length,
      "pod keycloak/themes nejsou žádné .properties — přesunulo se téma?",
    ).toBeGreaterThan(0);

    const dir = overlayDir();
    if (!dir) {
      const zprava =
        "overlay-tema-neztrati-klice: AISHA_INSTANCE_CONFIG_DIR není nastaven — " +
        `NEPROHLÉDNUTO ${platformFiles.length} platformních souborů hlášek. ` +
        "Prázdná množina není čistý strom.";
      if (overlayRequired()) throw new Error(zprava);
      console.warn(zprava);
      expect(true).toBe(true);
      return;
    }

    const chybi: string[] = [];
    let porovnano = 0;
    for (const pf of platformFiles) {
      const rel = relative(ROOT, pf);
      const of_ = join(dir, rel);
      if (!existsSync(of_)) continue;   // overlay soubor nevlastní → platformní zůstává
      porovnano++;
      const overlayKeys = keysOf(of_);
      for (const k of [...keysOf(pf)].filter((k) => !overlayKeys.has(k)).sort()) {
        chybi.push(`${rel}: ${k}`);
      }
    }

    // Overlay, který nevlastní ANI JEDEN soubor hlášek, znamená, že brána
    // proběhla nad prázdnem — to je vada měřidla, ne důkaz pořádku.
    if (overlayRequired()) {
      expect(
        porovnano,
        "overlay je vynucený, ale nevlastní žádný soubor hlášek — brána měřila nad prázdnem",
      ).toBeGreaterThan(0);
    }

    expect(
      chybi,
      "Instanční overlay nahrazuje soubor CELÝ, takže tyhle platformní klíče by po " +
      "nasazení na stránce CHYBĚLY:\n" +
      chybi.map((c) => `  ${c}`).join("\n") +
      "\n\nDoplň je do instančního souboru (hodnotu si instance zvolí sama), " +
      "nebo ať overlay ten soubor nevlastní.",
    ).toEqual([]);
  });
});
