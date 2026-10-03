/**
 * Souhrn nesmí vydávat PŘIJATÉ za ZDRAVÉ (CLASS gate)
 *
 * TŘÍDA VADY: dva různé stavy sesypané do jednoho košíku, který se pak tiskne
 * pod jménem toho příznivějšího. Měřidlo tím tvrdí opak toho, co samo o dva
 * řádky výš doložilo.
 *
 * NAMĚŘENO 2026-09-05. Běh `--only=<app>` vypsal v průběhu
 * `[22:57:42] <prefix>-realtime → running:unhealthy` a v souhrnu
 * `✓ healthy after: 1`. Ve stejné chvíli vracela veřejná adresa té aplikace
 * pětistovku na KAŽDÉ cestě (`/`, `/health`, `/socket.io/`). Příčina byla
 * v účtování, ne v nasazení:
 *
 *   if (isFullyHealthy(cls)) summary.healthy.push(n);
 *   else if (isAcceptable(cls)) summary.healthy.push(n);   // ← unhealthy i starting
 *
 * `isAcceptable` je ŠIRŠÍ než `isFullyHealthy` — zahrnuje `unhealthy`
 * a `starting`. Obojí padalo do `summary.healthy`, který se tiskne jako
 * „healthy after". Operátor tedy četl zelené číslo o aplikaci, která neběžela.
 *
 * ROZHODNUTÍ O BĚHU SE TÍM NEMĚNÍ. Přijaté stavy dál nejsou tvrdý problém
 * (`tvrdyProblem` je počítá jinak — bootstrap okno před vznikem meshe je
 * v tom souboru zapsané a má svůj důvod). Mění se JEN to, že se nevydávají
 * za zdravé: mají vlastní košík `summary.prijate` a vlastní řádek souhrnu.
 *
 * INVARIANTY:
 *  1. větev `isAcceptable` NEPLNÍ `summary.healthy`,
 *  2. existuje oddělený košík pro přijaté stavy,
 *  3. souhrn ten košík VYPÍŠE (tichý košík je horší než sloučený — nikdo se
 *     nedozví, že se něco přijalo),
 *  4. výpis nese i STAV, ne jen počet (číslo bez stavu se nedá ověřit).
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const REDEPLOY = "scripts/aisha-redeploy.mjs";

/** Vrací nálezy (prázdné pole = invariant drží). */
export function zkontrolujSouhrn(src: string): string[] {
  const nalezy: string[] = [];

  // 1) Větev `isAcceptable` nesmí plnit košík zdravých.
  //
  // ⛔ Řez se dělá INDEXEM, ne regulárním výrazem se stropem délky. První verze
  // téhle brány měla `[\s\S]{0,900}?` a spadla na vlastní opravě: komentář
  // uvnitř větve povyrostl přes strop, vzor se nechytil a brána ohlásila
  // „větev nenalezena". Próza tedy měnila verdikt — táž třída, kterou tahle
  // brána hlídá jinde. Délka komentáře nesmí rozhodovat o měření.
  const zacatek = src.indexOf("else if (isAcceptable(cls))");
  const konec = zacatek === -1 ? -1 : src.indexOf("\n        } else {", zacatek);
  const vetevAcceptable = zacatek !== -1 && konec !== -1 ? src.slice(zacatek, konec) : "";
  if (!vetevAcceptable) {
    nalezy.push(
      "větev `else if (isAcceptable(cls))` v souhrnu vlny nenalezena — " +
        "brána neví, co měří; zkontroluj, jestli se účtování nepřejmenovalo.",
    );
    return nalezy;
  }
  if (/summary\.healthy\.push/.test(vetevAcceptable)) {
    nalezy.push(
      "přijaté stavy padají do `summary.healthy`, který se tiskne jako " +
        '"healthy after" — `running:unhealthy` se tím vydává za zdravé ' +
        "(naměřeno 2026-09-05 na realtime — veřejná adresa té aplikace přitom vracela 502).",
    );
  }

  // 2) Oddělený košík musí existovat a být deklarovaný v souhrnu.
  if (!/const summary = \{[^}]*prijate: \[\]/.test(src)) {
    nalezy.push(
      "v `summary` chybí oddělený košík `prijate` — bez něj se přijaté stavy " +
        "nemají kam uložit a skončí zpátky mezi zdravými.",
    );
  }
  if (!/summary\.prijate\.push/.test(vetevAcceptable)) {
    nalezy.push("větev `isAcceptable` neplní `summary.prijate` — košík zůstal prázdný.");
  }

  // 3+4) Souhrn to musí vypsat, a se stavem.
  const tisk = src.match(/summary\.prijate\.length > 0[\s\S]{0,400}?\n {2}\}/)?.[0] ?? "";
  if (!tisk) {
    nalezy.push(
      "souhrn `prijate` nevypisuje — tichý košík je horší než sloučený: " +
        "operátor se nedozví, že se něco přijalo jako nezdravé.",
    );
  } else if (!/\.status/.test(tisk)) {
    nalezy.push(
      "výpis přijatých nenese STAV, jen počet — číslo bez stavu se nedá ověřit " +
        "a nedá se z něj poznat, jestli šlo o `starting`, nebo `running:unhealthy`.",
    );
  }

  return nalezy;
}

describe("souhrn nasazení nevydává přijaté za zdravé", () => {
  test("aisha-redeploy účtuje přijaté stavy odděleně a vypisuje je", () => {
    const src = readFileSync(join(ROOT, REDEPLOY), "utf8");
    const nalezy = zkontrolujSouhrn(src);
    expect(
      nalezy,
      `Souhrn nasazení tvrdí víc, než doložil:\n  ${nalezy.join("\n  ")}\n\n` +
        "CO S TÍM: `isAcceptable` je širší než `isFullyHealthy` (zahrnuje\n" +
        "`unhealthy` a `starting`). Přijaté stavy patří do vlastního košíku\n" +
        "`summary.prijate` a na vlastní řádek souhrnu — rozhodnutí o běhu\n" +
        "(`tvrdyProblem`) se tím NEMĚNÍ.",
    ).toEqual([]);
  });

  test("sebetest měřidla: starý tvar musí spadnout, nový projít", () => {
    // Starý tvar — obě větve do jednoho košíku, žádný oddělený.
    const stary = `
      const summary = { triggered: [], failed_trigger: [], deploy_failed: [], unhealthy: [], healthy: [], gate_aborted: [] };
        if (isFullyHealthy(cls)) {
          summary.healthy.push(n);
        } else if (isAcceptable(cls)) {
          summary.healthy.push(n);
        } else {
          summary.unhealthy.push({ name: n, status: s });
        }
    `;
    expect(
      zkontrolujSouhrn(stary).length,
      "měřidlo musí starý tvar odmítnout — jinak nic nehlídá",
    ).toBeGreaterThan(0);

    // Nový tvar — oddělený košík i výpis se stavem.
    const novy = `
      const summary = { triggered: [], failed_trigger: [], deploy_failed: [], unhealthy: [], healthy: [], prijate: [], gate_aborted: [] };
        if (isFullyHealthy(cls)) {
          summary.healthy.push(n);
        } else if (isAcceptable(cls)) {
          summary.prijate.push({ name: n, status: s, cls });
        } else {
          summary.unhealthy.push({ name: n, status: s });
        }
  if (summary.prijate.length > 0) {
    log(\`  \${C.yellow("~")} přijaté, NE zdravé: \${summary.prijate.length} (\${summary.prijate.map((u) => \`\${u.name}=\${u.status}\`).join(", ")})\`);
  }
    `;
    expect(zkontrolujSouhrn(novy), "nový tvar musí projít").toEqual([]);
  });
});
