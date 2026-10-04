/**
 * Gate: kořenový `package-lock.json` musí znát KAŽDÝ deklarovaný workspace — celý.
 *
 * ⛔ NAMĚŘENO 2026-09-07 při nasazení jádra. Build spadl hned na prvním kroku:
 *
 *     [gateway build 4/8] RUN npm ci --workspace=@aisha/gateway
 *     npm error `npm ci` can only install packages when your package.json
 *     and package-lock.json are in sync.
 *     Missing: @aisha/plugin-<fork>-source@0.1.0 from lock file
 *
 * Do `package.json` přibyl workspace `plugins/<fork>-source`, ale kořenový zámek
 * o něm věděl jen POLOVINU: nesl cestu `plugins/<fork>-source` (zbytek po dřívějším
 * ořezu, zapsaný jako `extraneous`), a NENESL odkaz
 * `node_modules/@aisha/plugin-<fork>-source`. npm potřebuje obojí; půl záznamu je
 * pro `npm ci` totéž co žádný.
 *
 * ⭐ PROČ TO BOLÍ VÍC, NEŽ SE ZDÁ: `npm ci` je fail-closed, takže rozpor neshodí
 * jen službu, které se nový workspace týká — shodí build KAŽDÉ služby, která
 * `npm ci` volá. Tady jádro, které s tím pluginem nemá nic společného. Jedna
 * chybějící řádka v zámku tedy zastaví celé nasazení.
 *
 * ⭐ A PROČ TO NECHYTILA CI: pre-push staví nad UŽ EXISTUJÍCÍMI `node_modules` a
 * `npm ci` z čistého stavu nespustí nikdy. Rozpor mezi `package.json` a zámkem je
 * pro něj proto neviditelný — projeví se až v Dockeru, kde se instaluje načisto.
 * Tahle brána tu mezeru zavírá bez instalace: porovná DEKLARACI se ZÁMKEM.
 *
 * Půlrozbitý záznam ležel v zámku dva měsíce tiše. Mlčel, dokud si ho nikdo
 * nenárokoval — což je táž třída jako mrtvý resolver nebo bucket bez zakladatele:
 * jméno vypadá platně, druhá strana chybí, a pozná se to až u toho, kdo na ně sáhne.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vzoryWorkspaces, workspaceAdresare } from "./lib/workspaces";

const ROOT = process.cwd();
const cti = (p: string) => JSON.parse(readFileSync(join(ROOT, p), "utf-8"));

type Clen = { dir: string; name: string };

/** Členové workspace podle DEKLARACE v kořenovém package.json. */
function clenove(): Clen[] {
  const pj = cti("package.json") as { workspaces?: string[] };
  const out: Clen[] = [];
  // Rozbalení jako npm (negace, doslovné cesty) — jeden domov v lib/workspaces.
  for (const dir of workspaceAdresare(vzoryWorkspaces(pj), ROOT)) {
    const name = (JSON.parse(readFileSync(join(ROOT, dir, "package.json"), "utf-8")) as { name?: string }).name;
    if (name) out.push({ dir, name });
  }
  return out;
}

describe("kořenový zámek — zná každý workspace, a celý", () => {
  const lock = cti("package-lock.json") as { packages?: Record<string, unknown> };
  const balicky = lock.packages ?? {};
  const clen = clenove();

  test("nějaké workspace vůbec existují (jinak brána nic neměří)", () => {
    expect(clen.length, "package.json nedeklaruje žádný workspace — detekce se rozešla se skutečností")
      .toBeGreaterThan(10);
    expect(Object.keys(balicky).length, "kořenový zámek nemá `packages` — jiný formát?")
      .toBeGreaterThan(100);
  });

  test("každý deklarovaný workspace má v zámku CESTU i ODKAZ", () => {
    const neuplne = clen
      .map(({ dir, name }) => ({
        dir,
        name,
        cesta: Object.prototype.hasOwnProperty.call(balicky, dir),
        odkaz: Object.prototype.hasOwnProperty.call(balicky, `node_modules/${name}`),
      }))
      .filter((z) => !z.cesta || !z.odkaz)
      .map((z) => `${z.dir} (${z.name}): cesta=${z.cesta ? "ano" : "NE"} odkaz=${z.odkaz ? "ano" : "NE"}`);

    expect(
      neuplne,
      "Tyhle workspace zná kořenový zámek jen zpola. `npm ci` je fail-closed a spadne\n" +
        "na NICH i na každé jiné službě, která ho volá — tedy celé nasazení, ne jen\n" +
        "dotčený balík. CI to nechytí: pre-push staví nad existujícími node_modules.\n" +
        "Náprava: `npm install --package-lock-only` a zámek commitni.",
    ).toEqual([]);
  });

  test("zámek nenese cestu k workspace, který už neexistuje (osiřelý půlzáznam)", () => {
    // Právě takový zbytek po ořezu tu ležel dva měsíce: cesta bez balíku. Mlčel,
    // dokud si ji někdo nenárokoval novým workspace — pak si npm vyžádal druhou
    // půlku, která nikdy nevznikla.
    const deklarovane = new Set(clen.map((c) => c.dir));
    // Zúženo na tu třídu, která BOLÍ: cesta ke ČLENU workspace (tedy bez jediného
    // segmentu `node_modules/` kdekoli v cestě — vnořené závislosti jsou legitimní
    // záznamy, ne sirotci), ke které v repu žádný balík není.
    const osirele = Object.keys(balicky).filter(
      (k) =>
        k !== "" &&
        !k.includes("node_modules/") &&
        !deklarovane.has(k) &&
        !existsSync(join(ROOT, k, "package.json")),
    );
    expect(
      osirele,
      "Cesta v zámku, které neodpovídá žádný workspace ani adresář — zbytek po ořezu.\n" +
        "Sám o sobě mlčí; probudí se, až se to jméno znovu použije.",
    ).toEqual([]);
  });

  test("negativní sonda: rozbalení jako npm — glob, doslovná cesta a negace; adresář bez package.json ne", () => {
    const koren = mkdtempSync(join(tmpdir(), "workspaces-sonda-"));
    const balik = (dir: string) => {
      mkdirSync(join(koren, dir), { recursive: true });
      writeFileSync(join(koren, dir, "package.json"), JSON.stringify({ name: dir }));
    };
    try {
      balik("packages/a");
      balik("packages/sdk"); // kořen vnořeného monorepa — negace ho vyřadí
      balik("packages/sdk/packages/ui");
      balik("packages/sdk/packages/native"); // doslovně nevyjmenovaný → není workspace
      mkdirSync(join(koren, "packages/prazdny"), { recursive: true }); // bez package.json
      expect(
        workspaceAdresare(["packages/*", "!packages/sdk", "packages/sdk/packages/ui"], koren),
      ).toEqual(["packages/a", "packages/sdk/packages/ui"]);
      expect(workspaceAdresare([], koren)).toEqual([]);
      expect(vzoryWorkspaces({ workspaces: { packages: ["x/*"] } })).toEqual(["x/*"]);
      expect(vzoryWorkspaces({})).toEqual([]);
    } finally {
      rmSync(koren, { recursive: true, force: true });
    }
  });
});
