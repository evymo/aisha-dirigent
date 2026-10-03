/**
 * Grace ODKLÁDÁ rozsudek, nevynáší ho (CLASS gate)
 *
 * TŘÍDA VADY: tolerance k zastaralému stavu, která se přemění v souhlas.
 * Coolify po dokončení deploye chvíli hlásí stale `exited:*` (app-level cache
 * lag), proto ho čekací smyčka po FINISHED_GRACE_S přepisuje na `starting`.
 * Jenže `starting` je v isAcceptable() — po STABLE_POLLS stabilních dotazech
 * se aplikace PŘIJALA jako v pořádku. Odklad tak sám vynesl rozsudek.
 *
 * NAMĚŘENO 2026-08-11 (aisha-netinit-experimental na varra): kontejner skončil
 * s kódem 1 (kolize subnetu 10.99.0.0/24 s cizím nájemníkem), Coolify hlásil
 * `exited:unhealthy` — a vlna vypsala „healthy after: 3". Pojistka
 * deployPending to nechytila: deployment doběhl korektně, `compose up -d`
 * uspěl, kontejner nastartoval a AŽ POTOM umřel. To je jiná otázka než
 * „stojí akce ve frontě?".
 *
 * INVARIANTY:
 *  1. v grace se aplikace nepřijme (`!inGrace` v podmínce `ok`),
 *  2. v grace se nesbírá stabilita (jinak tři dotazy uvnitř grace = přijato),
 *  3. souhrn vidí SYROVOU třídu, ne zdvořilé „starting“.
 *
 * Spousti se pres: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const REDEPLOY = "scripts/aisha-redeploy.mjs";

/** Zkontroluje, že grace jen odkládá. Vrací nálezy (prázdné = OK). */
export function zkontrolujGrace(src: string): string[] {
  const nalezy: string[] = [];

  if (!/let inGrace = false;/.test(src) || !/inGrace = true;/.test(src)) {
    nalezy.push(
      "chybí příznak inGrace — bez něj nejde odlišit odložený rozsudek od přijetí; " +
        "`exited` přepsané na `starting` projde přes isAcceptable() jako úspěch.",
    );
    return nalezy;
  }

  // 1) Přijetí musí grace vylučovat.
  if (!/const ok = [^;]*!inGrace[^;]*;/.test(src)) {
    nalezy.push(
      "podmínka `ok` nevylučuje inGrace — aplikace v grace by se dala přijmout " +
        "jako zdravá, přestože její kontejner mohl skončit (naměřeno 2026-08-11).",
    );
  }

  // 2) V grace se nesmí sbírat stabilita.
  if (!/if \(inGrace\) \{[\s\S]{0,240}?stableCount\.set\(name, 0\)/.test(src)) {
    nalezy.push(
      "v grace se sbírá stabilita — STABLE_POLLS dotazů uvnitř grace znamená " +
        "„stable starting“ a tedy přijetí. Grace musí stabilitu nulovat.",
    );
  }

  // 3) Souhrn dostane syrovou třídu.
  if (!/resolvedClasses\[name\] = inGrace \? rawCls : cls;/.test(src)) {
    nalezy.push(
      "resolvedClasses v grace nevrací syrovou třídu — kdyby vlna vypršela uvnitř " +
        "grace, souhrn by hlásil `starting` u kontejneru, který doopravdy skončil.",
    );
  }

  return nalezy;
}

describe("grace odkládá rozsudek, nevynáší ho", () => {
  const src = readFileSync(join(ROOT, REDEPLOY), "utf-8");

  test("čekací smyčka drží všechny tři invarianty", () => {
    expect(zkontrolujGrace(src)).toEqual([]);
  });

  // ── Negativní testy: brána musí každé odebrání POZNAT ─────────────────────
  test("odstranění !inGrace z podmínky ok je nález", () => {
    const mut = src.replace("!deployPending && !inGrace &&", "!deployPending &&");
    expect(zkontrolujGrace(mut).join("\n")).toContain("nevylučuje inGrace");
  });

  test("sbírání stability v grace je nález", () => {
    const mut = src.replace("stableCount.set(name, 0);", "stableCount.set(name, 99);");
    expect(zkontrolujGrace(mut).join("\n")).toContain("sbírá stabilita");
  });

  test("zdvořilá třída v souhrnu je nález", () => {
    const mut = src.replace(
      "resolvedClasses[name] = inGrace ? rawCls : cls;",
      "resolvedClasses[name] = cls;",
    );
    expect(zkontrolujGrace(mut).join("\n")).toContain("syrovou třídu");
  });

  test("úplné odstranění příznaku je nález", () => {
    const mut = src.split("let inGrace = false;").join("let x = false;");
    expect(zkontrolujGrace(mut).join("\n")).toContain("chybí příznak inGrace");
  });

  // Kotva: `starting` MUSÍ zůstat v isAcceptable — kdyby vypadlo, invarianty
  // výše by byly bezpředmětné a brána by hlídala mrtvou větev.
  test("isAcceptable stále obsahuje starting (jinak brána hlídá nic)", () => {
    const fn = src.match(/function isAcceptable\(cls\) \{[\s\S]*?\}/)?.[0] || "";
    expect(fn, "isAcceptable nenalezena").not.toBe("");
    expect(/"starting"/.test(fn), "starting už není acceptable — přehodnoť tuhle bránu").toBe(true);
  });
});
