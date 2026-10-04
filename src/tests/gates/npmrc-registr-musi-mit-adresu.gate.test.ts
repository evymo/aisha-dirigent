/**
 * Brána: build nesmí záviset na VLASTNÍM npm registru.
 *
 * ⭐ ROZHODNUTÍ (majitel, 2026-10-04): „vše, co si potřebujeme vybuildit, máme
 * mít k dispozici bez externích závislostí; z registrů stahujeme jen cizí
 * balíčky." Vlastní `@aisha/*` jsou workspaces tohoto repa (packages/*,
 * services/*, apps/*, extranet SDK ze submodulu packages/extranet-sdk) a staví
 * se ze zdroje. Cizí balíky jdou z výchozího registry.npmjs.org a ověřuje je
 * `integrity` v lockfilu. Privátní zrcadlo (Verdaccio) zůstává nanejvýš
 * kanálem pro PUBLIKACI ven (scripts/aisha-packages-publish.mjs si registr
 * předává sama přes `--registry`), ne vstupem buildu.
 *
 * ⛔ PŘEDCHOZÍ STAV (2026-08-18 → 2026-10-03): kořenový `.npmrc` nesl
 *
 *     @aisha:registry=${VERDACCIO_URL}
 *
 * kvůli jedinému balíku (`@aisha/extranet-sdk-ui`) a lockfily měly u ~300
 * cizích balíků `resolved` na zrcadlo. Build se pak bez zrcadla nedal udělat:
 * prázdná URL → `ERR_INVALID_URL` už při načítání konfigurace, nedostupné
 * zrcadlo → `npm ci` padl na balíku, který na npmjs leží celou dobu. Původní
 * brána proto hlídala, že `VERDACCIO_URL` je build-time — a sama psala, že
 * „doslouží", až se adresa přestane skládat z proměnné. Tohle je to doslou-
 * žení: místo „adresa musí do buildu dorazit" platí „žádná vlastní adresa".
 *
 * CO SE MĚŘÍ
 *   1. žádný sledovaný `.npmrc` nemapuje registr (`registry=`, `@scope:registry=`)
 *   2. žádný sledovaný `package-lock.json` nestahuje odjinud než z registry.npmjs.org
 *      (workspace linky a cesty `file:` jsou zdroj ve stromu, ne registr)
 *   3. pověření v `.npmrc` nejsou build-time (únik do `docker history`)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const ROOT = join(__dirname, "../../..");
const VEREJNY_REGISTR = "https://registry.npmjs.org/";

function sledovane(vzor: string): string[] {
  return execFileSync("git", ["ls-files", vzor], { cwd: ROOT, encoding: "utf-8" }).split("\n").filter(Boolean);
}

/** Řádky `.npmrc`, které nastavují registr (globální i pro scope). Čistá funkce. */
export function radkyRegistru(obsah: string): string[] {
  return obsah
    .split("\n")
    .map((radek) => radek.replace(/^\s*[#;].*$/, "").trim())
    .filter((cisty) => cisty && /(?:^|:)registry\s*=/.test(cisty));
}

/** `resolved` adresy z lockfilu, které nejsou veřejný registr ani zdroj ve stromu. Čistá funkce. */
export function resolvedMimoVerejnyRegistr(lock: unknown): string[] {
  const packages = (lock as { packages?: Record<string, { resolved?: string; link?: boolean }> })?.packages ?? {};
  const mimo: string[] = [];
  for (const [cesta, zaznam] of Object.entries(packages)) {
    const resolved = zaznam?.resolved;
    if (!resolved || zaznam.link) continue;
    if (resolved.startsWith(VEREJNY_REGISTR) || resolved.startsWith("file:")) continue;
    mimo.push(`${cesta} ← ${resolved}`);
  }
  return mimo;
}

function buildTimeRegex(): RegExp {
  const vypis = execFileSync(
    "bash",
    ["-c", ". scripts/lib/coolify-buildtime-envs.sh && coolify_buildtime_key_regex"],
    { cwd: ROOT, encoding: "utf-8" },
  ).trim();
  expect(vypis.length, "coolify_buildtime_key_regex() nevrátila nic — brána by měřila prázdno").toBeGreaterThan(20);
  return new RegExp(vypis);
}

describe("build nezávisí na vlastním npm registru", () => {
  it("žádný sledovaný .npmrc nemapuje registr", () => {
    const soubory = sledovane("*.npmrc");
    // Sonda musí doložit, že měřila: kořenový `.npmrc` existuje (komentář proč).
    expect(soubory, "kořenový .npmrc ve stromu není — brána by měřila prázdno").toContain(".npmrc");
    const nalezy = soubory.flatMap((soubor) =>
      radkyRegistru(readFileSync(join(ROOT, soubor), "utf8")).map((radek) => `${soubor}: ${radek}`),
    );
    expect(
      nalezy,
      "`.npmrc` mapuje registr. Vlastní @aisha/* balíky jsou workspaces a staví se\n" +
        "ze zdroje; cizí balíky jdou z výchozího registry.npmjs.org. Scope mapovaný\n" +
        "na vlastní registr udělá z buildu závislost na službě, kterou instance\n" +
        "nemusí mít. Publikace ven si registr předává sama (`--registry`).\n  " +
        nalezy.join("\n  "),
    ).toEqual([]);
  });

  it("žádný sledovaný lockfile nestahuje odjinud než z registry.npmjs.org", () => {
    const lockfily = sledovane("*package-lock.json");
    expect(lockfily.length, "ve stromu není žádný package-lock.json — brána by měřila prázdno").toBeGreaterThan(5);
    const nalezy: string[] = [];
    let resolvedCelkem = 0;
    for (const soubor of lockfily) {
      const lock = JSON.parse(readFileSync(join(ROOT, soubor), "utf8"));
      resolvedCelkem += Object.values((lock.packages ?? {}) as Record<string, { resolved?: string }>).filter((z) => z?.resolved).length;
      for (const n of resolvedMimoVerejnyRegistr(lock)) nalezy.push(`${soubor}: ${n}`);
    }
    expect(resolvedCelkem, "lockfily nenesou žádné `resolved` — měřidlo čte špatné soubory").toBeGreaterThan(1000);
    expect(
      nalezy.slice(0, 40),
      `Lockfile stahuje z jiného registru než ${VEREJNY_REGISTR} (${nalezy.length} záznamů).\n` +
        "Tarbally cizích balíků jsou na npmjs pod touž cestou a `integrity` se nemění —\n" +
        "přepiš hostitele v `resolved`. Vlastní balík patří do workspace, ne do registru.",
    ).toEqual([]);
  });

  it("tokeny v .npmrc build-time NEJSOU — prázdný token je snesitelný, únik ne", () => {
    // Druhá strana kontraktu z doby, kdy `.npmrc` registr mapoval: pověření
    // označené build-time pošle Coolify jako `--build-arg` a hodnota skončí
    // v metadatech obrazu napořád. Platí dál pro jakýkoli `.npmrc` ve stromu.
    const regex = buildTimeRegex();
    const tokeny: string[] = [];
    for (const soubor of sledovane("*.npmrc")) {
      for (const radek of readFileSync(join(ROOT, soubor), "utf8").split("\n")) {
        const cisty = radek.replace(/^\s*[#;].*$/, "").trim();
        if (!/(?:_authToken|_auth|_password)\s*=/.test(cisty)) continue;
        for (const m of cisty.matchAll(/\$\{([A-Z0-9_]+)\}/g)) {
          if (regex.test(m[1])) tokeny.push(`${soubor}: ${m[1]} (${cisty.split("=")[0]}=…)`);
        }
      }
    }
    expect(
      tokeny,
      "Pověření z `.npmrc` označené build-time pošle Coolify jako `--build-arg`\n" +
        "a hodnota skončí v metadatech obrazu napořád.\n" +
        "Náprava: klíč z `coolify_buildtime_key_regex()` VYNDAT. Je-li pověření\n" +
        "opravdu potřeba, patří přes `--mount=type=secret`, ne přes build arg.\n  " +
        tokeny.join("\n  "),
    ).toEqual([]);
  });

  it("negativní sonda: registr se pozná v globální i scope podobě, komentář a jiné volby ne", () => {
    const obsah = [
      "# @aisha:registry=${VERDACCIO_URL}", // komentář
      "; registry=https://x.example/", // komentář středníkem
      "legacy-peer-deps=true", // jiná volba
      "@aisha:registry=${VERDACCIO_URL}", // scope
      "registry=https://npm.example.com/", // globální
      "  @evymo:registry = https://y.example/", // mezery
    ].join("\n");
    expect(radkyRegistru(obsah)).toEqual([
      "@aisha:registry=${VERDACCIO_URL}",
      "registry=https://npm.example.com/",
      "@evymo:registry = https://y.example/",
    ]);
    expect(radkyRegistru("")).toEqual([]);
  });

  it("negativní sonda: cizí host je nález; npmjs, workspace link, file: a záznam bez resolved ne", () => {
    const lock = {
      packages: {
        "": { name: "root" },
        "node_modules/a": { resolved: "https://registry.npmjs.org/a/-/a-1.0.0.tgz" },
        "node_modules/b": { resolved: "https://npm.example.com/b/-/b-1.0.0.tgz" },
        "node_modules/@x/ws": { resolved: "packages/ws", link: true },
        "node_modules/c": { resolved: "file:../vendor/c" },
        "node_modules/d": { version: "1.0.0" },
      },
    };
    expect(resolvedMimoVerejnyRegistr(lock)).toEqual(["node_modules/b ← https://npm.example.com/b/-/b-1.0.0.tgz"]);
    expect(resolvedMimoVerejnyRegistr({})).toEqual([]);
    expect(resolvedMimoVerejnyRegistr(null)).toEqual([]);
  });
});
