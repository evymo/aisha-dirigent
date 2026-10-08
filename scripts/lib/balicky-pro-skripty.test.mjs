import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  balickyProSkripty,
  balickyZTextu,
  importyJmenem,
  jmenaBalicku,
  kSestaveni,
  popisImportuJmenem,
  popisPokryti,
  prohledejSkripty,
  vadySestaveni,
} from "./balicky-pro-skripty.mjs";

let koren;
afterEach(() => koren && rmSync(koren, { recursive: true, force: true }));

/** Strom s jedním balíčkem workspace `@x/proto` v packages/proto. */
function strom() {
  koren = mkdtempSync(join(tmpdir(), "bps-"));
  mkdirSync(join(koren, "scripts/lib"), { recursive: true });
  mkdirSync(join(koren, "packages/proto"), { recursive: true });
  writeFileSync(join(koren, "packages/proto/package.json"), JSON.stringify({ name: "@x/proto", main: "./dist/index.js" }));
  return koren;
}

describe("balicky-pro-skripty", () => {
  it("cesta do dist z scripts/ i scripts/lib/; zdroj se nepočítá", () => {
    expect([...balickyZTextu("import { a } from '../packages/knock-protocol/dist/index.js';")]).toEqual(["packages/knock-protocol"]);
    expect([...balickyZTextu('import x from "../../packages/b/dist/node.js"')]).toEqual(["packages/b"]);
    expect([...balickyZTextu("import x from '../packages/c/src/index.ts'")]).toEqual([]);
    // I jiný tvar než relativní import: shell, který pouští dist přímo.
    expect([...balickyZTextu('node "$KOREN/packages/d/dist/cli.js" --x')]).toEqual(["packages/d"]);
    expect([...balickyZTextu("node packages/e/dist/cli.js")]).toEqual(["packages/e"]);
    expect([...balickyZTextu("cizi-packages/f/dist/x.js")], "jiný adresář končící na packages").toEqual([]);
  });

  it("import balíčku workspace JMÉNEM je NÁLEZ, ne „nic“ (skript by spadl na nesestaveném balíčku)", () => {
    const jmena = ["@x/proto", "bez-scope"];
    // Dřív: balickyZTextu("import x from '@x/proto'") → [] a tím to končilo.
    expect([...balickyZTextu("import x from '@x/proto'")], "cestou do dist to není…").toEqual([]);
    expect([...importyJmenem("import x from '@x/proto'", jmena)], "…ale jménem ANO").toEqual(["@x/proto"]);
    expect([...importyJmenem('import { a,\n  b,\n} from "@x/proto/node";', jmena)], "víceřádkový import s podcestou").toEqual(["@x/proto"]);
    expect([...importyJmenem("export { a } from '@x/proto';", jmena)]).toEqual(["@x/proto"]);
    expect([...importyJmenem("import 'bez-scope';", jmena)]).toEqual(["bez-scope"]);
    expect([...importyJmenem("const m = await import('@x/proto');", jmena)]).toEqual(["@x/proto"]);
    expect([...importyJmenem("const m = require('bez-scope/sub');", jmena)]).toEqual(["bez-scope"]);
    // Kontroly detektoru: cizí balíček, podobné jméno a text kódu uvnitř řetězce importem nejsou.
    expect([...importyJmenem("import x from 'vitest';", jmena)]).toEqual([]);
    expect([...importyJmenem("import x from '@x/proto-jiny';", jmena)], "delší jméno není podcesta").toEqual([]);
    expect([...importyJmenem("  to: 'from \"@x/proto\"',", jmena)], "řetězec přepisovače zdrojáků").toEqual([]);
    expect([...importyJmenem("  `import { a } from '@x/proto';`,", jmena)], "šablona generovaného kódu").toEqual([]);
  });

  it("jména balíčků se čtou z packages/*/package.json", () => {
    strom();
    mkdirSync(join(koren, "packages/bez-manifestu"), { recursive: true });
    expect([...jmenaBalicku(koren)]).toEqual([["@x/proto", "packages/proto"]]);
  });

  it("sken čte CELÉ scripts/ včetně podadresářů; testy a nekód vyjmenuje jako neprohledané", () => {
    strom();
    mkdirSync(join(koren, "scripts/db/hluboko"), { recursive: true });
    mkdirSync(join(koren, "scripts/ci/__tests__"), { recursive: true });
    mkdirSync(join(koren, "scripts/node_modules/zavislost"), { recursive: true });
    writeFileSync(join(koren, "scripts/a.mjs"), "import '../packages/p1/dist/x.js';");
    writeFileSync(join(koren, "scripts/lib/b.mjs"), "import '../../packages/p2/dist/x.js';");
    writeFileSync(join(koren, "scripts/c.test.mjs"), "import '../packages/p3/dist/x.js';");
    // Podadresář, který dřívější sken neviděl — a tvary, které neuměl (shell, .cjs).
    writeFileSync(join(koren, "scripts/db/hluboko/d.cjs"), "require('../../../packages/p4/dist/x.js');");
    writeFileSync(join(koren, "scripts/ci/e.sh"), '#!/usr/bin/env bash\n# packages/p9/dist/ jen v komentáři\nnode "$R/packages/p5/dist/cli.js"\n');
    writeFileSync(join(koren, "scripts/ci/__tests__/f.mjs"), "import '../../../packages/p6/dist/x.js';");
    writeFileSync(join(koren, "scripts/node_modules/zavislost/g.mjs"), "import '../../../packages/p7/dist/x.js';");
    writeFileSync(join(koren, "scripts/db/poznamka.md"), "packages/p8/dist/ v dokumentaci");
    const sken = prohledejSkripty(koren);
    expect(sken.balicky).toEqual(["packages/p1", "packages/p2", "packages/p4", "packages/p5"]);
    expect(balickyProSkripty(koren)).toEqual(sken.balicky);
    expect(sken.prohledano).toBe(4);
    expect(sken.neprohledano).toEqual({ testy: 2, ".md": 1 });
    expect(popisPokryti(sken)).toMatch(/prohledáno 4 souborů v celém scripts\/.*mimo sken: \.md 1, testy 2/);
  });

  it("import jménem ve skriptu kdekoli pod scripts/ se vrátí jako nález se souborem a balíčkem", () => {
    strom();
    mkdirSync(join(koren, "scripts/deploy"), { recursive: true });
    writeFileSync(join(koren, "scripts/deploy/h.mjs"), "// import x from '@x/proto' — komentář se nepočítá\nimport { a } from '@x/proto';\n");
    writeFileSync(join(koren, "scripts/i.test.mjs"), "import { a } from '@x/proto';\n");
    const { jmenem } = prohledejSkripty(koren);
    expect(jmenem).toEqual([{ soubor: "scripts/deploy/h.mjs", balicek: "@x/proto", cesta: "packages/proto" }]);
    expect(popisImportuJmenem(jmenem[0])).toMatch(/scripts\/deploy\/h\.mjs: importuje balíček workspace JMÉNEM '@x\/proto'.*packages\/proto/);
  });

  it("sestavitelnost: chybí package.json / build / nástroj → vada; s nástrojem čisto", () => {
    koren = mkdtempSync(join(tmpdir(), "bps-"));
    expect(vadySestaveni(koren, "packages/x")[0]).toMatch(/package\.json chybí/);
    mkdirSync(join(koren, "packages/x"), { recursive: true });
    writeFileSync(join(koren, "packages/x/package.json"), JSON.stringify({ name: "x" }));
    expect(vadySestaveni(koren, "packages/x")[0]).toMatch(/nemá skript build/);
    writeFileSync(join(koren, "packages/x/package.json"), JSON.stringify({ name: "x", scripts: { build: "tsc -p ." } }));
    expect(vadySestaveni(koren, "packages/x")[0]).toMatch(/'tsc' není nainstalovaný/);
    mkdirSync(join(koren, "node_modules/.bin"), { recursive: true });
    writeFileSync(join(koren, "node_modules/.bin/tsc"), "");
    expect(vadySestaveni(koren, "packages/x")).toEqual([]);
  });
});

describe("co se má sestavit: odvozené balíčky i jejich závislosti z repa, v pořadí grafu", () => {
  /** Strom: skript míří do dist balíčku `klient`, ten závisí na `jadro` (abecedně PŘED ním je `klient` až druhý — pořadí řídí graf). */
  function stromSeZavislosti() {
    koren = mkdtempSync(join(tmpdir(), "bps-poradi-"));
    const balicek = (adresar, pkg) => {
      mkdirSync(join(koren, "packages", adresar), { recursive: true });
      writeFileSync(join(koren, "packages", adresar, "package.json"), JSON.stringify(pkg));
    };
    balicek("a-klient", { name: "@x/a-klient", scripts: { build: "tsc" }, dependencies: { "@x/z-jadro": "*" } });
    balicek("z-jadro", { name: "@x/z-jadro", scripts: { build: "tsc" } });
    balicek("bez-buildu", { name: "@x/bez-buildu" });
    return koren;
  }

  it("závislost z repa se přidá a stojí před odvozeným balíčkem", () => {
    stromSeZavislosti();
    expect(kSestaveni(koren, ["packages/a-klient"])).toEqual({
      poradi: ["packages/z-jadro", "packages/a-klient"],
      bezPoradi: [],
    });
  });

  it("odvozený balíček bez skriptu build nebo bez package.json je VADA, ne „nic k sestavení“", () => {
    stromSeZavislosti();
    const plan = kSestaveni(koren, ["packages/a-klient", "packages/bez-buildu", "packages/neni"]);
    expect(plan.poradi).toEqual(["packages/z-jadro", "packages/a-klient"]);
    expect(plan.bezPoradi).toEqual(["packages/bez-buildu", "packages/neni"]);
  });

  it("nad skutečným stromem: odvozené balíčky pořadí nese a žádný nechybí", () => {
    const odvozene = balickyProSkripty();
    const plan = kSestaveni(process.cwd(), odvozene);
    expect(plan.bezPoradi).toEqual([]);
    for (const b of odvozene) expect(plan.poradi).toContain(b);
  });
});
