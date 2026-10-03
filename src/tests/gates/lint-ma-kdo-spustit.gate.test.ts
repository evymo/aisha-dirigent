/**
 * Brána: každý `lint` skript musí mít v CI svého SPOUŠTĚČE.
 *
 * TŘÍDA VADY: balíček má `npm run lint`, nikdo ho nevolá, a protože nic
 * neodporuje, konfigurace se rozejde s tím, co si o ní lidé myslí. Není to
 * kosmetika — nespuštěný linter tiše zneplatní i to, co už v kódu STOJÍ.
 *
 * ⛔ NAMĚŘENO 2026-08-20 na `mobile-app`. Web lintoval, n8n-nodes lintoval,
 * appka nikdy. Nasbíralo se:
 *   - `useTranslation.ts` měl `eslint-disable-next-line react-hooks/exhaustive-deps`
 *     na pravidlo, které v konfiguraci appky VŮBEC NEBYLO (ESLint takový odkaz
 *     hlásí jako chybu — a nikdo ji neviděl),
 *   - `brandInterpolation.test.ts` si u své výjimky poznamenal „the root config
 *     flags it as no-require-imports" — autor tedy počítal s tím, že si appka
 *     dědí kořenovou konfiguraci. Nedědí: `lint` běží s `--no-config-lookup`,
 *     takže platí výhradně `mobile-app/eslint.config.cjs`.
 *   - `react-hooks/rules-of-hooks` — v React Native to nejcennější pravidlo
 *     vůbec — nebylo zapnuté; podmíněně volaný hook se pozná až pádem
 *     na zařízení.
 * Tři pravidla, na která se kód ODVOLÁVAL, a ani jedno neplatilo.
 *
 * CO SE MĚŘÍ (vlastnost, ne pravopis): univerzum = každý `package.json`
 * vedený v gitu, který má `scripts.lint`. Pro každý se hledá krok v CI, který
 * v JEHO adresáři spustí `npm run lint`. Adresář se ODVOZUJE z YAML —
 * `defaults.run.working-directory` úlohy i `working-directory` kroku — ne
 * z textu, protože textová shoda by neuměla říct, KTERÝ balíček se lintuje.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve, dirname, normalize } from "node:path";
import yaml from "js-yaml";
import { envWithoutGitLocation } from "../../../scripts/lib/git-worktree-health.mjs";

const ROOT = resolve(process.cwd());

type Krok = { run?: string; "working-directory"?: string };
type Uloha = {
  defaults?: { run?: { "working-directory"?: string } };
  steps?: Krok[];
};
type Workflow = { jobs?: Record<string, Uloha> };

/** Adresář balíčku vůči kořenu; kořen sám je ".". */
function adresarBalicku(relPackageJson: string): string {
  const d = dirname(relPackageJson);
  return d === "" ? "." : normalize(d);
}

/**
 * Univerzum se HLEDÁ v gitu, nevypisuje se ručně — jinak brána zdědí díry
 * seznamu a příští balíček proklouzne. `node_modules` git nevede, takže se
 * odfiltrovat nemusí.
 */
export function balikySLintem(cwd = ROOT): string[] {
  const soubory = execFileSync("git", ["ls-files", "package.json", "*/package.json", "*/*/package.json"], {
    cwd,
    encoding: "utf-8",
    // `cwd` je parametr — nad jiným stromem by zděděný GIT_DIR z hooku měřil tenhle.
    env: envWithoutGitLocation(),
  })
    .split("\n")
    .filter(Boolean);

  const out: string[] = [];
  for (const rel of soubory) {
    let pkg: { scripts?: Record<string, string> };
    try {
      pkg = JSON.parse(readFileSync(join(cwd, rel), "utf-8"));
    } catch {
      continue; // nečitelný package.json řeší jiná brána, ne tahle
    }
    if (pkg.scripts?.lint) out.push(adresarBalicku(rel));
  }
  return [...new Set(out)].sort();
}

/** Spustí `npm run lint` tenhle krok? `--if-present` i další příznaky jsou v pořádku. */
const SPOUSTI_LINT = /(^|[\n;&|])\s*(npm|pnpm|yarn)\s+run\s+lint(\s|$)/m;

/**
 * Adresáře, ve kterých CI doopravdy lintuje. Odvozeno z YAML, ne z textu:
 * krok dědí `working-directory` od úlohy, pokud si vlastní neurčí.
 */
export function adresareKdeCIlintuje(zdrojeWorkflow: string[]): Set<string> {
  const kde = new Set<string>();
  for (const zdroj of zdrojeWorkflow) {
    const wf = yaml.load(zdroj) as Workflow | null;
    for (const uloha of Object.values(wf?.jobs ?? {})) {
      const vychozi = uloha.defaults?.run?.["working-directory"];
      for (const krok of uloha.steps ?? []) {
        if (!krok.run || !SPOUSTI_LINT.test(krok.run)) continue;
        const wd = krok["working-directory"] ?? vychozi ?? ".";
        kde.add(normalize(wd));
      }
    }
  }
  return kde;
}

function zdrojeWorkflow(): string[] {
  return execFileSync("git", ["ls-files", ".forgejo/workflows/*.yml", ".forgejo/workflows/*.yaml"], {
    cwd: ROOT,
    encoding: "utf-8",
  })
    .split("\n")
    .filter(Boolean)
    .map((rel) => readFileSync(join(ROOT, rel), "utf-8"));
}

describe("každý lint skript má v CI svého spouštěče", () => {
  test("detektor pozná tvar, kvůli kterému brána vznikla", () => {
    // Bez tohohle by se brána mohla tiše stát no-opem — viz `sonda-musi-umet-odpovedet-ne`.
    const sLintem = `
jobs:
  web:
    steps:
      - run: npm run lint
  mobil:
    defaults:
      run:
        working-directory: mobile-app
    steps:
      - run: npm run type-check
      - run: npm run lint
  nodes:
    steps:
      - working-directory: packages/n8n-nodes-aisha
        run: npm run lint --if-present
`;
    expect([...adresareKdeCIlintuje([sLintem])].sort()).toEqual([
      ".",
      "mobile-app",
      "packages/n8n-nodes-aisha",
    ]);

    // A hlavně: umí říct „ne". Přesně tenhle tvar měla appka do 2026-08-20 —
    // úloha existuje, typy i testy běží, lint nikde.
    const bezLintu = `
jobs:
  mobil:
    defaults:
      run:
        working-directory: mobile-app
    steps:
      - run: npm run type-check
      - run: npm test -- --ci
`;
    expect([...adresareKdeCIlintuje([bezLintu])]).toEqual([]);

    // Zmínka v komentáři není spuštění.
    const jenKomentar = `
jobs:
  mobil:
    steps:
      - run: |
          # dřív se tu volalo npm run lint
          echo preskoceno
`;
    expect([...adresareKdeCIlintuje([jenKomentar])]).toEqual([]);
  });

  test("žádný balíček s `lint` skriptem nezůstal bez spouštěče", () => {
    const lintuje = adresareKdeCIlintuje(zdrojeWorkflow());
    const osirele = balikySLintem().filter((d) => !lintuje.has(d));

    expect(
      osirele,
      "balíček má `npm run lint`, ale žádná úloha v `.forgejo/workflows/` ho v jeho\n" +
        "adresáři nespouští. Nespuštěný linter neplatí — a co hůř, zneplatní i to, co\n" +
        "v kódu STOJÍ: `eslint-disable` na pravidlo, které nikdo nezapnul, je jen komentář.\n\n" +
        "CO S TÍM: do úlohy, která ten balíček už staví, přidej krok\n" +
        "  - name: ESLint\n" +
        "    run: npm run lint\n" +
        "a ujisti se, že úloha má správné `working-directory` (dědí se z `defaults.run`).\n" +
        "Pokud balíček lintovat NEMÁ, smaž mu `scripts.lint` — skript, který nikdo\n" +
        "nespouští, je slib, který nikdo nedrží.\n" +
        "NEDĚLEJ: nepřidávej sem výjimku a neobcházej to `--if-present` u skriptu,\n" +
        "který existuje — brána měří spuštění, ne pravopis.\n\n" +
        "BEZ SPOUŠTĚČE:\n  " + osirele.join("\n  "),
    ).toEqual([]);
  });
});
