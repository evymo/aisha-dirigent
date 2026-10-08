/**
 * Brána: nasazovací úlohy musí číst DETEKTOR, a porovnávat CELÁ jména.
 *
 * PROČ (naměřeno 2026-08-11)
 * -------------------------
 * PR #184 změnil `services/svc-web-artifact/` — kontejner běžící v CORE stacku.
 * Byl zelený, sloučený, a nasadilo ho NULA úloh. Příznak `services_change` se
 * rozsvítil, ale nekonzumovala ho ŽÁDNÁ nasazovací úloha, jen `Services: Tests`.
 * Deploy úlohy klíčovaly na hrubé příznaky (`app`, `infra_core`), mezi které se
 * services nevešly.
 *
 * Příznak odpovídá na „co se změnilo". Nasazení potřebuje „která appka se tím
 * mění" — a to umí `aisha-changed-apps.mjs`, který vlastníka odvozuje
 * z `build.dockerfile` v compose souboru přiřazeném appce v manifestu.
 *
 * ⛔ PODŘETĚZCOVÁ PAST (chycena při psaní téhle změny, ne až v provozu)
 * `contains()` ve Forgejo/GitHub výrazech je PODŘETĚZCOVÝ:
 *
 *     contains('ledger', 'edge')  →  PRAVDA     (l-`edge`-r)
 *
 * Holý seznam appek by tedy nasazoval EDGE při každé změně LEDGERU. Seznam se
 * proto emituje obalený čárkami (`,core,edge,`) a podmínky porovnávají `,edge,`.
 * Kdyby někdo čárky zahodil, vada by se neprojevila chybou — jen NADBYTEČNÝM
 * nasazováním, což vypadá jako opatrnost.
 *
 * CO SE MĚŘÍ
 * ----------
 * Nad SKUTEČNÝM workflow: že se seznam emituje obalený, že každá nasazovací
 * úloha svého stacku detektor čte, a že žádné porovnání nepoužívá holé jméno.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

const ROOT = process.cwd();
const CESTA = join(ROOT, ".github/workflows/ci.yml");
const TEXT = readFileSync(CESTA, "utf8");
const WF = yaml.load(TEXT) as { jobs: Record<string, { if?: string; name?: string }> };

/** Nasazovací úlohy, které cílí na jeden konkrétní stack (suffix z deploy-and-verify.sh). */
const CILENE: Array<[string, string]> = [
  ["deploy-core", "core"],
  ["deploy-edge", "edge"],
  ["deploy-extranet", "extranet"],
];

describe("nasazovací úlohy čtou detektor (brána)", () => {
  test("univerzum sedí — všechny měřené úlohy ve workflow existují", () => {
    for (const [job] of CILENE) {
      expect(WF.jobs?.[job], `úloha ${job} ve workflow není — brána ztratila předmět`).toBeTruthy();
    }
  });

  test("seznam appek se emituje OBALENÝ ČÁRKAMI", () => {
    expect(
      TEXT,
      "krok `deploy_apps` musí zapsat `deploy_apps=,$APPS,` — bez obalení je\n" +
        "`contains(deploy_apps, 'edge')` pravdivé i pro `ledger` (l-edge-r) a edge by se\n" +
        "nasazoval při každé změně ledgeru. Vada by se neprojevila chybou, jen\n" +
        "nadbytečným nasazováním — což vypadá jako opatrnost.",
    ).toMatch(/deploy_apps=,\$APPS,/);
  });

  test.each(CILENE)("%s čte detektor pro svůj stack (%s)", (job, suffix) => {
    const podminka = WF.jobs?.[job]?.if ?? "";
    expect(
      podminka,
      `${job} nekonzumuje výstup detektoru. Přesně tak se 2026-08-11 stalo, že změna\n` +
        `services/svc-web-artifact/ (kontejner CORE stacku) nenasadila NIC: příznaky\n` +
        `svítily, ale žádná nasazovací úloha je nečetla.`,
    ).toContain(`contains(needs.detect.outputs.deploy_apps, ',${suffix},')`);
  });

  test.each(["deploy-koren", "deploy-stacky"])("%s nasazuje podle detektoru (deploy_apps), ne podle ručního seznamu", (job) => {
    const uloha = WF.jobs?.[job] as unknown as { if?: string; steps?: Array<{ run?: string; env?: Record<string, string> }> } | undefined;
    expect(uloha, `úloha ${job} ve workflow není`).toBeTruthy();
    expect(uloha!.if ?? "", "úloha se musí spouštět jen, když detektor něco vydal").toContain("needs.detect.outputs.deploy_apps != ',,'");
    const krok = (uloha!.steps ?? []).find((st) => /nasad-podle-vln\.sh/.test(st.run ?? ""));
    expect(krok, `${job} nevolá nasad-podle-vln.sh`).toBeTruthy();
    expect(krok!.env?.DEPLOY_APPS, "seznam appek jde z detektoru přes env, ne z textu").toBe("${{ needs.detect.outputs.deploy_apps }}");
    expect(krok!.run).toMatch(/--aplikace "\$DEPLOY_APPS"/);
  });

  test("žádné porovnání appky nepoužívá HOLÉ jméno", () => {
    const spatne = [...TEXT.matchAll(/contains\(needs\.detect\.outputs\.deploy_apps,\s*'([^']*)'\)/g)]
      .map((m) => m[1])
      .filter((v) => !(v.startsWith(",") && v.endsWith(",")));
    expect(
      spatne,
      "tahle porovnání nemají jméno obalené čárkami, takže jsou podřetězcová:\n" +
        "`ledger` obsahuje `edge`, `core` obsahuje `or`, `extranet` obsahuje `net`.\n" +
        "Správný tvar je `,jmeno,`.",
    ).toEqual([]);
  });

  test("detektor svůj výstup opravdu vydává", () => {
    const outputs = (WF.jobs?.detect as unknown as { outputs?: Record<string, string> })?.outputs ?? {};
    expect(
      Object.keys(outputs),
      "`detect` musí vydat `deploy_apps`, jinak jsou podmínky výš vždy nepravdivé — " +
        "a nepravdivá podmínka vypadá jako „změna se téhle appky netýká.",
    ).toContain("deploy_apps");
  });
});
