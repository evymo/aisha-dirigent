/**
 * Gate: co skripty publikační dráhy IMPORTUJÍ, to musí být DEKLAROVÁNO.
 *
 * ⛔ NAMĚŘENO 2026-09-06. Init kontejner publikace skončil `Exited (1)`:
 *
 *     ERR_MODULE_NOT_FOUND: Cannot find package 'esbuild'
 *       imported from /app/scripts/plugins/build.mjs
 *
 * Nezabalil se ANI JEDEN plugin a `plugin_catalog` zůstal na nule. Připisovalo
 * se to oprávněním (heal #40, 2026-09-02: „zdroje zapnuté přes dvě hodiny
 * a nepřibyl ani JEDEN řádek") — oprávnění se opravila a katalog byl prázdný dál.
 *
 * ⭐ PROČ TO ČTENÍ MINULO. `Dockerfile.plugin-publish-init` tvrdil: „ŽÁDNÉ
 * `npm ci`. Ověřeno čtením importů: build.mjs i publish.mjs sahají VÝHRADNĚ na
 * vestavěné moduly node." To bylo pravdivé o STATICKÝCH importech — jenže na
 * řádku 107 je `await import("esbuild")` uvnitř funkce. Dynamický import
 * nestojí na začátku řádku, takže ho pohled po `^import` nevidí.
 *
 * ⭐ A DRUHÁ POLOVINA: `esbuild` nebyl deklarován ANI v `package.json`. Lokálně
 * to fungovalo jen proto, že ho tranzitivně přitáhl někdo jiný — tedy náhodou,
 * kterou by kterákoli změna závislostí tiše zrušila.
 *
 * Tenhle test proto hledá OBĚ formy importu a ptá se na deklaraci, ne na to,
 * co je zrovna v `node_modules`.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
// Brána volá TENTÝŽ kód, který běží v obraze — ne jeho opis.
import { slozProjekt } from "../../../scripts/lib/zavislosti-z-lockfile.mjs";

const ROOT = process.cwd();
const SKRIPTY = resolve(ROOT, "scripts/plugins");

/** Balíky, které skript importuje — staticky i dynamicky. `node:*` se nepočítá. */
const importovaneBaliky = (): { balik: string; kde: string }[] => {
  const out: { balik: string; kde: string }[] = [];
  for (const jmeno of readdirSync(SKRIPTY).filter((f) => f.endsWith(".mjs"))) {
    const zdroj = readFileSync(join(SKRIPTY, jmeno), "utf8");
    for (const m of zdroj.matchAll(/(?:^|\s)import\s+[^;]*?from\s*["']([^"']+)["']/gm)) {
      out.push({ balik: m[1]!, kde: jmeno });
    }
    // ⭐ Dynamický import — právě ten čtení minulo.
    for (const m of zdroj.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) {
      out.push({ balik: m[1]!, kde: jmeno });
    }
  }
  return out.filter(
    (x) => !x.balik.startsWith("node:") && !x.balik.startsWith(".") && !x.balik.startsWith("/"),
  );
};

const deklarovane = (): Set<string> => {
  const d = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  return new Set([
    ...Object.keys(d.dependencies ?? {}),
    ...Object.keys(d.devDependencies ?? {}),
  ]);
};

describe("publikační dráha má své závislosti deklarované", () => {
  it("měřidlo něco najde — jinak je test slepý", () => {
    // Prázdná množina = brána mlčí jako zelená.
    expect(importovaneBaliky().length).toBeGreaterThan(0);
  });

  it("detektor vidí i DYNAMICKÝ import — právě ten vadu způsobil", () => {
    // Měřidlo se ověřuje na známém vstupu, ne důvěrou: `build.mjs` má
    // `await import("esbuild")` a bez jeho zachycení by test nic neměřil.
    const nalezene = importovaneBaliky().map((x) => x.balik);
    expect(nalezene).toContain("esbuild");
  });

  it("⛔ každý importovaný balík je v package.json", () => {
    const dekl = deklarovane();
    const chybi = importovaneBaliky()
      .filter((x) => !dekl.has(x.balik))
      .map((x) => `${x.kde} → ${x.balik}`);
    // ⛔ Zpráva do POROVNÁVANÉ hodnoty, ne do druhého argumentu `expect`.
    expect(chybi).toEqual([]);
  });

  it("⛔ obraz publikace KAŽDOU tu závislost instaluje", () => {
    // Měří VLASTNOST („obraz ten balík opatří"), ne tvar zápisu. První verze
    // hledala `npm install … esbuild` na jednom řádku a zčervenala, jakmile
    // jsem instalaci přepsal do smyčky — přitom se nic nerozbilo.
    // ⛔ KOMENTÁŘE SE ODSTRANÍ PŘED MĚŘENÍM. Bez toho brána zezelená i po
    // odebrání instalace — stačí, že balík zůstane zmíněný v komentáři.
    // Naměřeno mutací na sobě: odebrání `minio` z instalační smyčky nechalo
    // test ZELENÝ, protože jméno zůstalo v komentáři, který tu vadu popisuje.
    const df = readFileSync(join(ROOT, "Dockerfile.plugin-publish-init"), "utf8")
      .split("\n")
      .filter((r) => !r.trim().startsWith("#"))
      .join("\n");
    // `npm ci` nad izolovaným lockfile je TÁŽ vlastnost jako `npm install` —
    // obraz balík opatří; hermeticky (2026-09-23, viz Dockerfile).
    const instaluje = /npm\s+(?:install|ci)\b/.test(df);
    const chybi = [...new Set(importovaneBaliky().map((x) => x.balik))].filter(
      (b) => !df.includes(b),
    );
    // ⛔ Zpráva do POROVNÁVANÉ hodnoty, ne do druhého argumentu `expect`.
    expect({ instaluje, chybi }).toEqual({ instaluje: true, chybi: [] });
  });

  /*
    ⛔ NAMĚŘENO 2026-09-23: obraz dřív instaloval nad KOŘENOVÝM package.json bez
    lockfile, takže do node_modules náhodou spadl celý strom monorepa — i závislosti
    pluginů, které build BALÍ (`fast-xml-parser` u tcars-fleet a webdispecink-fleet).
    Hermetická instalace je bere z manifestů; když manifest a lockfile nesedí, obraz
    by padl až při nasazení. Tady se to pozná už na PR — stejným kódem jako v obraze.
  */
  it("⛔ závislosti pluginů jdou nainstalovat z lockfile (manifest = lockfile)", () => {
    const pluginy = resolve(ROOT, "plugins");
    const manifesty = readdirSync(pluginy)
      .filter((slug) => existsSync(join(pluginy, slug, "manifest.json")))
      .map((slug) => ({ slug, manifest: JSON.parse(readFileSync(join(pluginy, slug, "manifest.json"), "utf8")) }));
    expect(manifesty.length).toBeGreaterThan(0);
    const { pkg } = slozProjekt({
      rootPkg: JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")),
      lock: JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8")),
      nastroje: ["esbuild", "minio"],
      manifesty,
    });
    const pluginoveDeps = [...new Set(manifesty.flatMap((m) => Object.keys(m.manifest.dependencies ?? {})))];
    expect(pluginoveDeps.filter((d) => !(d in pkg.dependencies))).toEqual([]);
  });

  it("⛔ obraz instaluje hermeticky — izolovaný lockfile, ne `npm install` nad monorepem", () => {
    const df = readFileSync(join(ROOT, "Dockerfile.plugin-publish-init"), "utf8")
      .split("\n")
      .filter((r) => !r.trim().startsWith("#"))
      .join("\n");
    expect({
      generator: /zavislosti-z-lockfile\.mjs\s+\S+\s+\/app\/plugins\s+\/app\b/.test(df),
      ci: /npm\s+ci\b/.test(df),
      holyInstall: /npm\s+install\b/.test(df),
      rootPkgDoApp: /COPY\s+package\.json\s+\.\/package\.json/.test(df),
    }).toEqual({ generator: true, ci: true, holyInstall: false, rootPkgDoApp: false });
  });
});

