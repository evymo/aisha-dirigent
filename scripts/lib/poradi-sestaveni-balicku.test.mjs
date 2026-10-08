import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { grafBalicku, poradiSestaveni, poradiZGrafu, sestavSeZavislostmi } from "./poradi-sestaveni-balicku.mjs";

const uzel = (zavisi = [], sestavitelny = true) => ({ jmeno: "x", sestavitelny, zavisi });

describe("pořadí z grafu", () => {
  it("závislost stojí před závislým, i když je abecedně až za ním", () => {
    const graf = new Map([
      ["packages/a-klient", uzel(["packages/z-jadro"])],
      ["packages/m-prostredni", uzel()],
      ["packages/z-jadro", uzel()],
    ]);
    expect(poradiZGrafu(graf)).toEqual(["packages/z-jadro", "packages/a-klient", "packages/m-prostredni"]);
  });

  it("řetěz závislostí se rozvine celý a každý balíček je v pořadí jednou", () => {
    const graf = new Map([
      ["packages/a", uzel(["packages/b", "packages/c"])],
      ["packages/b", uzel(["packages/c"])],
      ["packages/c", uzel()],
    ]);
    expect(poradiZGrafu(graf)).toEqual(["packages/c", "packages/b", "packages/a"]);
  });

  it("cíl přinese své závislosti (i nepřímé) a nic navíc", () => {
    const graf = new Map([
      ["packages/a", uzel(["packages/b"])],
      ["packages/b", uzel(["packages/c"])],
      ["packages/c", uzel()],
      ["packages/d", uzel()],
    ]);
    expect(poradiZGrafu(graf, ["packages/a"])).toEqual(["packages/c", "packages/b", "packages/a"]);
    expect(poradiZGrafu(graf, ["packages/d"])).toEqual(["packages/d"]);
  });

  it("balíček bez skriptu build se nestaví, ale jeho závislosti se projdou", () => {
    const graf = new Map([
      ["packages/a", uzel(["packages/bez-buildu"])],
      ["packages/bez-buildu", uzel(["packages/c"], false)],
      ["packages/c", uzel()],
    ]);
    expect(poradiZGrafu(graf, ["packages/a"])).toEqual(["packages/c", "packages/a"]);
  });

  it("cyklus je chyba, která jmenuje cestu — ne „nějaké pořadí“", () => {
    const graf = new Map([
      ["packages/a", uzel(["packages/b"])],
      ["packages/b", uzel(["packages/a"])],
    ]);
    expect(() => poradiZGrafu(graf)).toThrow(/cyklus závislostí mezi balíčky: packages\/a → packages\/b → packages\/a/);
  });

  it("neznámý cíl je chyba, ne prázdný seznam", () => {
    expect(() => poradiZGrafu(new Map([["packages/a", uzel()]]), ["packages/neni"])).toThrow(/neznámý balíček workspace: packages\/neni/);
  });
});

describe("sestavení cíle se závislostmi", () => {
  const graf = new Map([
    ["packages/jadro", uzel()],
    ["packages/klient", uzel(["packages/jadro"])],
    ["packages/nastroj", uzel(["packages/jadro"])],
  ]);

  it("závislost se sestaví před cílem a v jednom běhu jen jednou", () => {
    const postaveno = [];
    const hotove = new Set();
    const sestav = (b) => postaveno.push(b);
    expect(sestavSeZavislostmi({ graf, cil: "packages/klient", sestav, hotove })).toEqual(["packages/jadro", "packages/klient"]);
    expect(sestavSeZavislostmi({ graf, cil: "packages/nastroj", sestav, hotove })).toEqual(["packages/nastroj"]);
    expect(sestavSeZavislostmi({ graf, cil: "packages/klient", sestav, hotove })).toEqual([]);
    expect(postaveno).toEqual(["packages/jadro", "packages/klient", "packages/nastroj"]);
  });

  it("pád závislosti jmenuje závislost; cíl se nestaví a nic se nezapamatuje jako hotové", () => {
    const postaveno = [];
    const hotove = new Set();
    const sestav = (b) => {
      if (b === "packages/jadro") throw new Error("build failed (exit 2)");
      postaveno.push(b);
    };
    expect(() => sestavSeZavislostmi({ graf, cil: "packages/klient", sestav, hotove })).toThrow(
      /závislost packages\/jadro se nesestavila — build failed \(exit 2\)/,
    );
    expect(postaveno).toEqual([]);
    expect([...hotove]).toEqual([]);
  });

  it("pád samotného cíle projde ven beze změny", () => {
    const sestav = (b) => {
      if (b === "packages/klient") throw new Error("build failed (exit 2)");
    };
    expect(() => sestavSeZavislostmi({ graf, cil: "packages/klient", sestav, hotove: new Set() })).toThrow(/^build failed \(exit 2\)$/);
  });
});

describe("graf ze stromu", () => {
  const koren = mkdtempSync(join(tmpdir(), "poradi-balicku-"));
  afterAll(() => rmSync(koren, { recursive: true, force: true }));
  const balicek = (adresar, pkg) => {
    mkdirSync(join(koren, "packages", adresar), { recursive: true });
    if (pkg) writeFileSync(join(koren, "packages", adresar, "package.json"), JSON.stringify(pkg));
  };
  balicek("jadro", { name: "@vzor/jadro", scripts: { build: "tsc" } });
  balicek("klient", { name: "@vzor/klient", scripts: { build: "tsc" }, dependencies: { "@vzor/jadro": "file:../jadro", zod: "^3" } });
  balicek("nastroj", { name: "@vzor/nastroj", scripts: { build: "tsc" }, devDependencies: { "@vzor/klient": "*" } });
  balicek("peer", { name: "@vzor/peer", scripts: { build: "tsc" }, peerDependencies: { "@vzor/jadro": "*" }, optionalDependencies: { "@vzor/nastroj": "*" } });
  balicek("jen-data", { name: "@vzor/jen-data" });
  balicek("sam-na-sebe", { name: "@vzor/sam", scripts: { build: "tsc" }, dependencies: { "@vzor/sam": "*" } });
  balicek("bez-manifestu", null);

  it("hrana = závislost kteréhokoli druhu se jménem jiného balíčku z repa", () => {
    const graf = grafBalicku(koren);
    expect([...graf.keys()]).toEqual(["packages/jadro", "packages/jen-data", "packages/klient", "packages/nastroj", "packages/peer", "packages/sam-na-sebe"]);
    expect(graf.get("packages/klient").zavisi).toEqual(["packages/jadro"]);
    expect(graf.get("packages/nastroj").zavisi).toEqual(["packages/klient"]);
    expect(graf.get("packages/peer").zavisi).toEqual(["packages/jadro", "packages/nastroj"]);
    expect(graf.get("packages/sam-na-sebe").zavisi, "závislost na sobě není hrana").toEqual([]);
    expect(graf.get("packages/jen-data").sestavitelny).toBe(false);
  });

  it("pořadí nad stromem: závislosti dřív, balíček bez buildu vynechán", () => {
    expect(poradiSestaveni(koren)).toEqual(["packages/jadro", "packages/klient", "packages/nastroj", "packages/peer", "packages/sam-na-sebe"]);
    expect(poradiSestaveni(koren, ["packages/nastroj"])).toEqual(["packages/jadro", "packages/klient", "packages/nastroj"]);
  });
});

describe("skutečné balíčky repa", () => {
  const graf = grafBalicku();
  const poradi = poradiSestaveni();

  it("sonda nemlčí: graf i pořadí něco nesou a závislosti mezi balíčky existují", () => {
    expect(graf.size).toBeGreaterThan(10);
    expect(poradi.length).toBeGreaterThan(10);
    expect([...graf.values()].some((b) => b.zavisi.length > 0), "žádná hrana v grafu — pořadí by nic neřídilo").toBe(true);
  });

  it("každá závislost z repa stojí v pořadí před balíčkem, který ji potřebuje", () => {
    const spatne = [];
    for (const [cesta, b] of graf) {
      for (const z of b.zavisi) {
        if (poradi.includes(cesta) && poradi.includes(z) && poradi.indexOf(z) > poradi.indexOf(cesta)) spatne.push(`${z} až po ${cesta}`);
      }
    }
    expect(spatne).toEqual([]);
  });
});
