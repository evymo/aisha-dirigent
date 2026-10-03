/**
 * Brána: skript nasazení nesmí sahat na jméno, které neexistuje
 *
 * ⛔ NAMĚŘENO 2026-09-14 při nasazení forku: `aisha-redeploy.mjs` skončil
 * `Fatal: OVERLAYS is not defined` dřív, než cokoli nasadil. Commit c08cf2559
 * (2026-08-27) přejmenoval seznam rodin na OVERLAY_CACHEBUSTS, ale jedno místo
 * — zápis cachebustu do .env.coolify pod zámkem — zůstalo u starého jména.
 * Ta větev se spouští JEN tehdy, když se změní cachebust ukládaný v souboru;
 * sedmnáct dní se to nestalo, takže chyba ležela v kódu tiše. Probudila ji až
 * první nová rodina (zdrojové adaptéry) — při ostrém nasazení.
 *
 * `node --check` tohle nevidí (je to syntakticky platné), žádná brána tu větev
 * nespouští a lint projektu `no-undef` na skripty nepouští. JavaScript chybějící
 * jméno ohlásí až v okamžiku, kdy na řádek dojde.
 *
 * CO BRÁNA HLÍDÁ: ESLint `no-undef` nad CELÝM `scripts/**∕*.mjs` (univerzum
 * celé, ne vzorek). Známé nálezy jsou vyjmenované níž i s důvodem — rohatka:
 * nový nález bránu shodí, oprava známého ho musí ze seznamu odebrat.
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { ESLint } from "eslint";
import globals from "globals";

const ROOT = process.cwd();

/**
 * Známé nedefinované jméno → proč ještě není opravené. Klíč `soubor:jméno`.
 * Každá položka je dluh, ne výjimka: skript na tom řádku spadne.
 */
const ZNAME: Record<string, string> = {
  "scripts/deploy-individual-tools.mjs:MCP_BRIDGE_WF_ID":
    "Security hardening ef98e1ac1 (2026-03-26) odstranil zadrátované ID workflow bez náhrady. " +
    "Skript je celý neudržovaný — resolveAgentIds() nikdo nevolá, takže ani ID agentů nejsou dohledaná; " +
    "oprava patří k němu celému, ne k jednomu jménu (samostatný úkol).",
};

async function nalezy(): Promise<string[]> {
  const eslint = new ESLint({
    cwd: ROOT,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ["**/*.mjs"],
        languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: { ...globals.node } },
        rules: { "no-undef": "error" },
      },
    ],
  });
  const vysledky = await eslint.lintFiles(["scripts/**/*.mjs"]);
  const ven: string[] = [];
  for (const v of vysledky) {
    for (const z of v.messages) {
      if (z.ruleId !== "no-undef") continue;
      const jmeno = /'([^']+)' is not defined/.exec(z.message)?.[1] ?? z.message;
      ven.push(`${v.filePath.slice(ROOT.length + 1)}:${jmeno}`);
    }
  }
  return [...new Set(ven)].sort();
}

describe("skript nemá nedefinované jméno", () => {
  test("no-undef nad scripts/**/*.mjs = jen vyjmenované známé dluhy", async () => {
    const nalezeno = await nalezy();
    const nove = nalezeno.filter((n) => !(n in ZNAME));
    const opravene = Object.keys(ZNAME).filter((k) => !nalezeno.includes(k));
    expect(
      nove,
      `Skript sahá na jméno, které neexistuje — spadne, až na ten řádek dojde:\n  ${nove.join("\n  ")}\n\n` +
        `Naměřeno 2026-09-14: redeploy padl na OVERLAYS (přejmenováno jinde, jedno místo zapomenuté)\n` +
        `při prvním ostrém nasazení, které tu větev spustilo — 17 dní po vzniku chyby.`,
    ).toEqual([]);
    expect(opravene, "Tyhle známé dluhy už nejsou nalezeny — odeber je ze ZNAME (rohatka jen dolů).").toEqual([]);
  }, 60_000);
});
