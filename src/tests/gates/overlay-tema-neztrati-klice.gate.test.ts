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
 * Bez overlaye nemá co měřit a řekne to nahlas (NEMĚŘENO, přeskočený test) místo
 * tiché zelené; `AISHA_OVERLAY_REQUIRED=1` povyšuje na povinný OVERLAY, ne vlastní
 * hlášky.
 *
 * ⛔ OVERLAY BEZ VLASTNÍCH HLÁŠEK JE PLATNÝ TVAR (naměřeno 2026-10-03). Do té doby
 * brána pod vynucením padala na „overlay nevlastní žádný soubor hlášek — měřila nad
 * prázdnem": instance, která jede na výchozích textech platformy, by měla lane
 * overlay-gates červenou. Jenže taková instance nemá co ztratit — platformní soubor
 * zůstává celý. Řekne se to VIDITELNĚ a test se přeskočí.
 *
 * Že měřidlo není slepé, se proto neměří na overlayi instance, ale na vzorovém:
 * úplná kopie platformního souboru projde, kopie se ztraceným klíčem zčervená.
 * Vzor se staví Z PLATFORMNÍHO SOUBORU při běhu — kopie uložená v repu by zastarala
 * s prvním novým klíčem a kotva by hlídala sama sebe.
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { overlayDirOrRequired } from "../../../scripts/lib/instance-overlay.mjs";

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

/**
 * Platforma × overlay: kolik platformních souborů hlášek overlay TAKÉ vlastní a
 * které platformní klíče v nich chybí (`soubor: klíč`).
 */
export function ztraceneKlice(platformFiles: string[], overlayDir: string): { porovnano: number; chybi: string[] } {
  const chybi: string[] = [];
  let porovnano = 0;
  for (const pf of platformFiles) {
    const rel = relative(ROOT, pf);
    const of_ = join(overlayDir, rel);
    if (!existsSync(of_)) continue; // overlay soubor nevlastní → platformní zůstává
    porovnano++;
    const overlayKeys = keysOf(of_);
    for (const k of [...keysOf(pf)].filter((k) => !overlayKeys.has(k)).sort()) {
      chybi.push(`${rel}: ${k}`);
    }
  }
  return { porovnano, chybi };
}

describe("Instanční overlay nesmí ztratit platformní klíč tématu (gate)", () => {
  test("overlay, který vlastní soubor hlášek, nese všechny platformní klíče", (ctx) => {
    const platformFiles = platformMessageFiles();
    expect(
      platformFiles.length,
      "pod keycloak/themes nejsou žádné .properties — přesunulo se téma?",
    ).toBeGreaterThan(0);

    // Chybí-li overlay a je vynucený, vyhodí to už dveře (vada zapojení, ne stav světa).
    const dir = overlayDirOrRequired("overlay-tema-neztrati-klice");
    if (!dir) {
      console.warn(
        "[overlay-tema] bez overlaye — " +
          `NEPROHLÉDNUTO ${platformFiles.length} platformních souborů hlášek. Prázdná množina není čistý strom.`,
      );
      ctx.skip();
      return;
    }

    const { porovnano, chybi } = ztraceneKlice(platformFiles, dir);
    expect(
      chybi,
      "Instanční overlay nahrazuje soubor CELÝ, takže tyhle platformní klíče by po " +
      "nasazení na stránce CHYBĚLY:\n" +
      chybi.map((c) => `  ${c}`).join("\n") +
      "\n\nDoplň je do instančního souboru (hodnotu si instance zvolí sama), " +
      "nebo ať overlay ten soubor nevlastní.",
    ).toEqual([]);

    if (porovnano === 0) {
      console.warn(
        "[overlay-tema] overlay nevlastní žádný soubor hlášek (instance jede na výchozích textech) — " +
          `není co ztratit; NEMĚŘENO ${platformFiles.length} platformních souborů`,
      );
      ctx.skip();
    }
  });
});

describe("měřidlo ztracených klíčů nad vzorovým overlayem (kotva a mutace)", () => {
  /** Vzorový overlay v dočasném adresáři souboru testů (uklízí ho setupFiles). */
  const vzor = (uprav: (radky: string[]) => string[]) => {
    const pf = platformMessageFiles().find((f) => keysOf(f).size >= 2);
    expect(pf, "žádný platformní soubor hlášek s ≥ 2 klíči — vzor nemá z čeho vzniknout").toBeTruthy();
    const dir = mkdtempSync(join(tmpdir(), "overlay-vzor-"));
    const cil = join(dir, relative(ROOT, pf!));
    mkdirSync(dirname(cil), { recursive: true });
    writeFileSync(cil, uprav(readFileSync(pf!, "utf8").split("\n")).join("\n"));
    return { dir, rel: relative(ROOT, pf!), klice: [...keysOf(pf!)] };
  };

  test("kladná kotva: overlay s úplným souborem hlášek se MĚŘÍ a nic neztrácí", () => {
    const { dir } = vzor((r) => r);
    expect(ztraceneKlice(platformMessageFiles(), dir)).toEqual({ porovnano: 1, chybi: [] });
  });

  test("mutace: overlay s hláškami a ztraceným klíčem je červený", () => {
    let ztraceny = "";
    const { dir, rel } = vzor((radky) => {
      const i = radky.findIndex((l) => {
        const s = l.trim();
        return s !== "" && !s.startsWith("#") && !s.startsWith("!") && s.indexOf("=") > 0;
      });
      ztraceny = radky[i].slice(0, radky[i].indexOf("=")).trim();
      return radky.filter((_, j) => j !== i);
    });
    expect(ztraceneKlice(platformMessageFiles(), dir)).toEqual({ porovnano: 1, chybi: [`${rel}: ${ztraceny}`] });
  });

  test("overlay bez hlášek: nic se neporovná a nic se neztrácí", () => {
    const dir = mkdtempSync(join(tmpdir(), "overlay-vzor-"));
    mkdirSync(join(dir, "profiles"), { recursive: true });
    expect(ztraceneKlice(platformMessageFiles(), dir)).toEqual({ porovnano: 0, chybi: [] });
  });
});
