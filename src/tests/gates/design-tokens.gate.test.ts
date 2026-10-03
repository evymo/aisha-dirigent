/**
 * Design Tokens SoT Gate
 *
 * Why this exists:
 *   The AISHA brand for the stack's INTERNAL surfaces (cockpit, workbench admin)
 *   is unified onto a single committed source of truth:
 *   `packages/design-tokens/tokens.json`. Surfaces that cannot import it at
 *   runtime (the zero-dependency, pre-`npm install` setup cockpit) ship a
 *   committed mirror. This gate keeps those mirrors — and tokens.json itself —
 *   honest:
 *
 *     1. The cockpit snapshot (scripts/setup-cockpit/ui/aisha-tokens.css) must
 *        carry the same brand invariants (primary/ember/skew) as tokens.json.
 *        Fix by editing tokens.json (the SoT), never the mirror in isolation.
 *     2. The mobile theme must be GENERATED from a brand file, never hand-edited.
 *     3. tokens.json's own `mobile` section must agree with its `color` section
 *        on the shared roles — AISHA is one brand, not two.
 *     4. tokens.json must match the CANONICAL brand source
 *        (domains/templates/aisha.guru/lib/tokens.src.css, the aisha-guru-web
 *        submodule) WHEN that submodule is checked out. When it is absent
 *        (public / fresh checkout) the canonical check is skipped.
 *
 * The mobile app is NOT an internal AISHA surface — it is a client-facing
 * white-label product. Each client builds it under its own store identity from
 * its own brand file, so this gate must never pin the mobile theme to AISHA's
 * colours. It pins the theme to *its own declared brand* instead: hand-edits are
 * caught, re-skinning is not blocked.
 *
 * @module
 */
import { describe, test, expect } from "vitest";
import { readFileSync, existsSync, mkdtempSync, rmSync } from "fs";
import { execFileSync } from "child_process";
import { tmpdir } from "os";
import { join } from "path";

const ROOT = process.cwd();
const TOKENS = join(ROOT, "packages/design-tokens/tokens.json");
const BUILD = join(ROOT, "packages/design-tokens/build.mjs");
const COCKPIT = join(ROOT, "scripts/setup-cockpit/ui/aisha-tokens.css");
const MOBILE = join(ROOT, "mobile-app/src/theme/index.ts");
const SUBMODULE_SRC = join(ROOT, "domains/templates/aisha.guru/lib/tokens.src.css");

interface MobileBrand {
  colors: Record<string, string>;
  spacing: Record<string, number>;
  typography: Record<string, { fontSize: number; fontWeight: string; color: string }>;
}
interface Tokens {
  color: Record<string, string>;
  skew: Record<string, string>;
  mobile: MobileBrand;
}
const tokens = JSON.parse(readFileSync(TOKENS, "utf8")) as Tokens;

/** Extract a CSS custom-property value (`--name: value;`). */
function cssVar(src: string, name: string): string | null {
  const m = src.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`));
  return m ? m[1].trim() : null;
}

const eq = (a: string, b: string) => a.toUpperCase() === b.toUpperCase();

describe("Design Tokens SoT", () => {
  test("cockpit aisha-tokens.css mirrors tokens.json brand invariants", () => {
    expect(existsSync(COCKPIT), "cockpit token snapshot is missing").toBe(true);
    const css = readFileSync(COCKPIT, "utf8");

    // [tokens.json value, cockpit CSS var name]
    const invariants: [string, string][] = [
      [tokens.color.primary, "color-primary"],
      [tokens.color.primaryDark, "color-primary-dark"],
      [tokens.color.primaryLight, "color-primary-light"],
      [tokens.color.bg0, "bg-0"],
      [tokens.color.bg1, "bg-1"],
      [tokens.color.success, "color-success"],
      [tokens.color.warning, "color-warning"],
      [tokens.color.error, "color-error"],
      [tokens.skew.angle, "skew-angle"],
    ];

    const drift: string[] = [];
    for (const [expected, varName] of invariants) {
      const actual = cssVar(css, varName);
      if (actual === null) drift.push(`  --${varName} missing in cockpit snapshot`);
      else if (!eq(actual, expected)) drift.push(`  --${varName}: cockpit "${actual}" ≠ tokens.json "${expected}"`);
    }

    if (drift.length) {
      throw new Error(
        "Cockpit token snapshot drifted from packages/design-tokens/tokens.json:\n" +
          drift.join("\n") +
          "\n\nFix tokens.json (the SoT), then update the cockpit snapshot to match.",
      );
    }
    expect(drift).toEqual([]);
  });

  /**
   * ⛔ TAHLE KONTROLA SE NESMÍ MLČKY PŘESKOČIT.
   *
   * Do 2026-08-09 tu stálo `if (!existsSync(brandPath)) return;` — „brand forku
   * leží mimo tenhle checkout, nejde přegenerovat". Mělo to dva důsledky a oba
   * jsou horší než ta nepohodlnost, které se to vyhýbalo:
   *
   *   1. Brána odpověděla „OK", aniž cokoli změřila. Táž třída jako zelená
   *      deploy úloha, která nic nenasadila.
   *   2. Aby NEPŘESKOČILA, musel se brand soubor ZRCADLIT do tohohle repa
   *      (`instances/<slug>/brand.tokens.json`). Ta kopie neexistuje kvůli
   *      nasazení — nasazení bere overlay z instančního repa přes
   *      `SURFACE_OVERLAY_GIT_URL` — ale právě a jen kvůli téhle bráně.
   *      Měřidlo si tak vynutilo, KDE smí bydlet zdroj. To je obráceně.
   *
   * Vlastnost, která se má měřit, je jedna: **motiv odpovídá značce, kterou sám
   * deklaruje**. Ta se dá změřit ve všech třech světech, aniž se kdy mlčí:
   *
   *   • žádná instance → `@brand` ukazuje do tohohle repa; přegeneruj a porovnej
   *   • instance deklarovaná a zdroj dosažitelný → rozřeš z kanálu, porovnej
   *   • instance deklarovaná a zdroj NEDOSAŽITELNÝ → PÁD
   *
   * Ten třetí případ je ten, kvůli kterému se to přepisovalo: nedosažitelný
   * design není „volnější nastavení", je to rozbitá dodávka. Mlčet o něm
   * znamená nasadit starý vzhled a tvářit se, že je ověřený.
   */
  test("mobile theme is generated from its brand file, not hand-edited", () => {
    expect(existsSync(MOBILE), "mobile theme is missing").toBe(true);
    const committed = readFileSync(MOBILE, "utf8");

    // Generátor si razítkuje, ze které značky stavěl.
    const stamp = committed.match(/@brand\s+(\S+)/);
    expect(stamp, "mobile theme carries no `@brand` stamp — regenerate it with packages/design-tokens/build.mjs").not.toBeNull();

    const brandPath = join(ROOT, stamp![1]);
    if (!existsSync(brandPath)) {
      // Značka není ve stromu ⇒ MUSÍ být deklarovaná jako kanál. Jinak nikdo
      // neví, odkud se vzhled bere — a to je nález, ne důvod k mlčení.
      const kanal = process.env.AISHA_DESIGN_GIT_URL ?? process.env.SURFACE_OVERLAY_GIT_URL ?? "";
      throw new Error(
        `mobile theme razítkuje značku '${stamp![1]}', která v tomhle stromu NENÍ` +
          (kanal
            ? " — a je deklarovaný kanál, ze kterého ji lze získat.\n" +
              "Brána ji odtud zatím neumí rozřešit; dokud to neumí, nesmí předstírat, že měřila.\n" +
              "CO S TÍM: přegeneruj motiv ze zdroje, na který kanál ukazuje.\n"
            : ".\n\nCO TO ZNAMENÁ: vzhled se bere z něčeho, co tenhle strom nezná, a NIC to neověřuje.\n" +
              "Dřív se tady mlčky přeskakovalo, takže stačilo mít razítko a kontrola nikdy neproběhla.\n\n" +
              "CO S TÍM — jedno ze dvou:\n" +
              "  (a) deklaruj zdroj designu jako git kanál (AISHA_DESIGN_GIT_URL), jako to dělá\n" +
              "      AISHA_WEB_DESIGN_GIT_URL pro veřejný web — pak ho zná i doctor a cold start;\n" +
              "  (b) nebo motiv přegeneruj ze značky, která v repu JE:\n" +
              "      node packages/design-tokens/build.mjs --brand packages/design-tokens/tokens.json \\\n" +
              "        --mobile-only --out mobile-app/src/theme/index.ts\n"),
      );
    }

    const tmp = mkdtempSync(join(tmpdir(), "design-tokens-gate-"));
    try {
      const out = join(tmp, "index.ts");
      execFileSync("node", [BUILD, "--brand", brandPath, "--mobile-only", "--out", out], {
        cwd: ROOT,
        stdio: "pipe",
      });
      const regenerated = readFileSync(out, "utf8");
      if (regenerated !== committed) {
        throw new Error(
          "mobile-app/src/theme/index.ts does not match what its brand file generates.\n" +
            "The mobile theme is GENERATED — do not hand-edit it. Edit the brand file and regenerate:\n" +
            `  node packages/design-tokens/build.mjs --brand ${stamp![1]} --mobile-only --out mobile-app/src/theme/index.ts`,
        );
      }
      expect(regenerated).toEqual(committed);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("tokens.json mobile section agrees with its color section on shared roles", () => {
    // AISHA is ONE brand: the mobile surface and the internal surfaces must not
    // drift apart within this file. (A client fork ships a SEPARATE brand file —
    // this check is about tokens.json's internal consistency, so it never
    // constrains a fork's colours.)
    const shared: [string, string][] = [
      [tokens.mobile.colors.primary, tokens.color.primary],
      [tokens.mobile.colors.primaryDark, tokens.color.primaryDark],
      [tokens.mobile.colors.background, tokens.color.bg0],
      [tokens.mobile.colors.success, tokens.color.success],
      [tokens.mobile.colors.error, tokens.color.error],
      [tokens.mobile.colors.warning, tokens.color.warning],
      [tokens.mobile.colors.info, tokens.color.info],
    ];
    const names = ["primary", "primaryDark", "background↔bg0", "success", "error", "warning", "info"];

    const drift: string[] = [];
    shared.forEach(([mobileVal, colorVal], i) => {
      if (!eq(mobileVal, colorVal)) drift.push(`  ${names[i]}: mobile "${mobileVal}" ≠ color "${colorVal}"`);
    });

    if (drift.length) {
      throw new Error(
        "packages/design-tokens/tokens.json is internally inconsistent — its `mobile` " +
          "section disagrees with its `color` section:\n" +
          drift.join("\n") +
          "\n\nBoth describe the AISHA brand; pick the intended value and align them.",
      );
    }
    expect(drift).toEqual([]);
  });

  test("every mobile typography role references a declared colour", () => {
    // A typo here emits `colors.undefined` and renders transparent at runtime.
    // `$`-prefix je v tokenech konvence pro POZNÁMKU (`$meta`, `$note`,
    // `$fontNote`). Brána ji musí ctít stejně jako generátor, jinak se ty dva
    // NESHODNOU na tom, co je role — a poznámka uvnitř sekce spadne jako
    // „role bez barvy“. Naměřeno 2026-09-02: opravil jsem konvenci v
    // `build.mjs` a zapomněl tady, takže generátor stavěl a brána červenala.
    const bad = Object.entries(tokens.mobile.typography)
      .filter(([role]) => !role.startsWith("$"))
      .filter(([, spec]) => !(spec.color in tokens.mobile.colors))
      .map(([role, spec]) => `  typography.${role}.color = "${spec.color}" is not a key of mobile.colors`);
    if (bad.length) {
      throw new Error(
        "packages/design-tokens/tokens.json mobile typography references unknown colours:\n" +
          bad.join("\n") +
          `\n\nAvailable: ${Object.keys(tokens.mobile.colors).join(", ")}`,
      );
    }
    expect(bad).toEqual([]);
  });

  test("tokens.json matches the canonical aisha-guru-web source when the submodule is present", () => {
    if (!existsSync(SUBMODULE_SRC)) {
      // submodule not initialized (public stack / fresh checkout) — cannot verify here.
      expect(true).toBe(true);
      return;
    }
    const src = readFileSync(SUBMODULE_SRC, "utf8");
    const checks: [string, string][] = [
      [tokens.color.primary, "color-primary"],
      [tokens.color.primaryDark, "color-primary-dark"],
      [tokens.color.primaryLight, "color-primary-light"],
      [tokens.color.success, "color-success"],
      [tokens.color.error, "color-error"],
      [tokens.color.warning, "color-warning"],
      [tokens.skew.angle, "skew-angle"],
    ];

    const drift: string[] = [];
    for (const [jsonVal, varName] of checks) {
      const canon = cssVar(src, varName);
      if (canon !== null && !eq(canon, jsonVal)) {
        drift.push(`  --${varName}: tokens.json "${jsonVal}" ≠ canonical "${canon}"`);
      }
    }

    if (drift.length) {
      throw new Error(
        "packages/design-tokens/tokens.json drifted from the canonical brand " +
          "(aisha-guru-web/lib/tokens.src.css):\n" +
          drift.join("\n") +
          "\n\nResync tokens.json from the brand repo.",
      );
    }
    expect(drift).toEqual([]);
  });

  test("build.mjs emits the three internal-surface artifacts", () => {
    const build = readFileSync(BUILD, "utf8");
    for (const out of ["aisha.css", "aisha-theme.ts", "vscode-colors.json"]) {
      expect(build, `build.mjs no longer emits ${out}`).toContain(out);
    }
  });
});
