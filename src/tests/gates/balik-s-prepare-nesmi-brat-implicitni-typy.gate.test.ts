/**
 * Brána: balík, který se staví PŘI INSTALACI (`prepare`), nesmí spoléhat na
 * implicitní `@types`.
 *
 * PROČ (naměřeno 2026-08-10)
 * -------------------------
 * Nasazení `<prefix>-edge` PADALO a web proto tři dny servíroval starý bundle.
 * Obraz `web` se přitom postavil úspěšně — shodila to jiná služba téhož compose:
 *
 *   #46 [svc-knock build 6/8] RUN … npm ci --workspace=@aisha/svc-knock --omit=dev
 *   npm error path /app/packages/knock-protocol
 *   npm error command sh -c tsc
 *   error TS2688: Cannot find type definition file for 'aria-query'
 *                                          … 'babel__core', 'chai', 'estree', 'resolve' …
 *
 * ⭐ Compose je JEDEN CELEK: spadne-li jedna služba, nevymění se ŽÁDNÝ kontejner.
 * Vada v `svc-knock` tedy držela starý WEB — dvě věci, které spolu nesouvisejí.
 *
 * MECHANISMUS
 * -----------
 * Bez `types` v tsconfigu si `tsc` implicitně načte KAŽDÝ balík z
 * `node_modules/@types`. Produkční krok dělá `npm ci --omit=dev`, takže vývojové
 * `@types/*` tam nejsou celé — a `tsc` spadne na typech, které s tímhle balíkem
 * nemají nic společného.
 *
 * Proč zrovna `knock-protocol`: je to JEDINÝ balík se skriptem
 * `"prepare": "npm run build"`. Sousedi (`security`, `observability`, `api-core`)
 * ho nemají, takže se staví jen tehdy, když je někdo zavolá výslovně — a to je
 * vždycky s plnými závislostmi. Jejich tsconfigy jsou přitom BAJTOVĚ IDENTICKÉ;
 * rozdíl nedělá konfigurace, ale KDY se build spouští.
 *
 * ZMĚŘENO A/B (stejně oříznuté `@types`, `packages/knock-protocol`):
 *   bez `types`         → exit 2, TS2688
 *   `"types": ["node"]` → exit 0, čistě
 *
 * CO SE MĚŘÍ
 * ----------
 * Univerzum se bere Z DISKU: každý `packages/<x>/package.json` se skriptem
 * `prepare`, který staví. Takový balík MUSÍ mít v tsconfigu explicitní `types`.
 * Balíky bez `prepare` se neomezují — u nich je implicitní scan neškodný.
 */
import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const PACKAGES = join(ROOT, "packages");

/** Balíky, jejichž `prepare` spouští build (tedy se staví i při `npm ci`). */
function balikySPrepareBuildem(): string[] {
  return readdirSync(PACKAGES)
    .filter((d) => existsSync(join(PACKAGES, d, "package.json")))
    .filter((d) => {
      const pkg = JSON.parse(readFileSync(join(PACKAGES, d, "package.json"), "utf8"));
      const prepare = String(pkg.scripts?.prepare ?? "");
      return /\bbuild\b|\btsc\b/.test(prepare);
    })
    .sort();
}

/** `types` z tsconfigu balíku; `null` = soubor není, `undefined` = klíč chybí. */
function typyBaliku(jmeno: string): string[] | null | undefined {
  const cesta = join(PACKAGES, jmeno, "tsconfig.json");
  if (!existsSync(cesta)) return null;
  // tsconfig smí mít komentáře — pro tenhle účel stačí odstranit řádkové.
  const surovy = readFileSync(cesta, "utf8").replace(/^\s*\/\/.*$/gm, "");
  return JSON.parse(surovy).compilerOptions?.types;
}

describe("balík stavěný přes prepare nesmí brát implicitní @types (brána)", () => {
  const baliky = balikySPrepareBuildem();

  test("univerzum není prázdné — jinak je tvrzení níž vakuové", () => {
    expect(
      baliky.length,
      "žádný balík v packages/ nemá `prepare`, který staví — brána ztratila předmět, " +
        "nebo se změnil způsob, jakým se balíky staví při instalaci"
    ).toBeGreaterThan(0);
  });

  test.each([["knock-protocol"]])("regrese, kvůli které brána vznikla: %s", (jmeno) => {
    expect(
      baliky,
      `${jmeno} má mít \`prepare\`, který staví — na tom stojí celý důvod téhle brány`
    ).toContain(jmeno);
  });

  test("každý takový balík má v tsconfigu explicitní `types`", () => {
    const bez: string[] = [];
    for (const b of baliky) {
      const t = typyBaliku(b);
      if (t === null) continue; // bez tsconfigu se `tsc` nespouští
      if (!Array.isArray(t)) bez.push(b);
    }
    expect(
      bez,
      `tyhle balíky se staví PŘI INSTALACI (\`prepare\`), ale jejich tsconfig nemá \`types\`.\n` +
        `\`tsc\` si pak implicitně načte každý balík z node_modules/@types — jenže produkční\n` +
        `krok dělá \`npm ci --omit=dev\`, takže vývojové @types tam nejsou celé a build spadne\n` +
        `na TS2688 u typů, které s balíkem nesouvisejí.\n` +
        `Naměřeno 2026-08-10: přesně tohle shodilo nasazení celého edge stacku a web tři dny\n` +
        `servíroval starý bundle. Doplň "types": ["node"] (nebo výslovný seznam).`
    ).toEqual([]);
  });
});
