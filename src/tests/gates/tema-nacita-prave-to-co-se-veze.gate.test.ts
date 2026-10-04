/**
 * Brána: co téma Keycloaku NAČÍTÁ a co se do něj VEZE, musí být totéž.
 *
 * ⛔ NAMĚŘENO 2026-08-18 skutečným buildem — dvě chyby proti sobě:
 *
 *     adapter.css   Dockerfile ho VEZL   `styles=` ho NEUVÁDĚL   → nikdy se nenačetl
 *     esdk.css      `styles=` ho uváděl  cesta v Dockerfilu byla `packages/extranet-sdk-ui/`,
 *                                        což je adresář s NULA soubory v gitu → build padal
 *
 * `adapter.css` mapuje krátká jména SDK (`--s4`) na jména jazyka (`--space-4`).
 * Ležel v obrazu, komentář v `theme.properties` tvrdil, že přichází s `esdk.css`,
 * a přesto se nenačetl ani jednou — protože ho nikdo neuvedl v `styles=` a
 * `esdk.css` ho neimportuje. Táž třída jako „kód s testy, který nikdo nevolá":
 * artefakt existuje, vypadá dodaně a nic ho nespotřebovává.
 *
 * PROČ TO NEJDE POZNAT OČIMA
 * Chybějící mapování se neprojeví prázdnou stránkou. Projeví se tím, že část
 * odstupů a rádiusů sedne na výchozí hodnoty prohlížeče místo na značku —
 * stránka vypadá skoro správně. To je horší než pád: pád si někdo všimne.
 *
 * CO BRÁNA TVRDÍ
 * Pro každý soubor v `styles=` musí existovat cesta, kterou se do obrazu
 * dostane: buď leží v repu (platformní CSS), nebo ho tam kopíruje `COPY`
 * v `Dockerfile.keycloak`. A obráceně: co Dockerfile do `resources/css/`
 * kopíruje, to musí být buď v `styles=`, nebo to musí někdo importovat.
 *
 * ⚠️ O instančním overlayi brána NIC netvrdí — přichází z cizího repa za běhu
 * nasazení a v gitu není. `COPY --from=theme-overlay` se proto přeskakuje;
 * hádat o obsahu, který odsud není vidět, by vyrábělo falešné nálezy.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";

const ROOT = join(__dirname, "../../..");
const TEMA = "keycloak/themes/aisha/login";
const DOCKERFILE = "Dockerfile.keycloak";

/** Soubory vyjmenované v `styles=` v theme.properties, relativně k `resources/`. */
function stylesZTemaProperties(): string[] {
  const cesta = join(ROOT, TEMA, "theme.properties");
  const radky = readFileSync(cesta, "utf8").split("\n");
  const radek = radky.find((r) => /^styles=/.test(r.trim()));
  expect(radek, `${TEMA}/theme.properties nemá řádek \`styles=\` — brána by měřila prázdno`).toBeTruthy();
  return radek!.replace(/^styles=/, "").trim().split(/\s+/).filter(Boolean);
}

/**
 * Cíle `COPY` instrukcí Dockerfile.keycloak, které míří do `resources/css/`.
 * Vrací dvojice [cíl, celý řádek] — cíl může být soubor i adresář (končí `/`).
 */
function copyCileDoCss(): { cil: string; zdroje: string[]; zOverlaye: boolean }[] {
  const obsah = readFileSync(join(ROOT, DOCKERFILE), "utf8");
  // Spojí pokračovací řádky, ať se dá číst celá instrukce najednou.
  const instrukce = obsah.replace(/\\\n\s*/g, " ").split("\n");
  const vysledek: { cil: string; zdroje: string[]; zOverlaye: boolean }[] = [];
  for (const radek of instrukce) {
    if (!/^COPY\s/.test(radek.trim())) continue;
    if (!radek.includes("login/resources/css")) continue;
    const casti = radek.trim().split(/\s+/).slice(1).filter((c) => !c.startsWith("--"));
    const prepinace = radek.match(/--from=(\S+)/)?.[1] ?? "";
    const cil = casti[casti.length - 1];
    vysledek.push({ cil, zdroje: casti.slice(0, -1), zOverlaye: prepinace === "theme-overlay" });
  }
  return vysledek;
}

/**
 * Balíky, ze kterých si build CSS tahá — ODVOZENÉ z volání fetch-locked-package
 * v Dockerfilu, ne vyjmenované. Nový balík se pod bránu dostane bez zásahu.
 */
function balikyZeStagu(): string[] {
  // Komentáře pryč dřív, než se slučují pokračovací řádky: věta v komentáři
  // („…fetch-locked-package.mjs kopíruje…") se jinak četla jako jméno balíku.
  const obsah = readFileSync(join(ROOT, DOCKERFILE), "utf8")
    .split("\n")
    .filter((radek) => !/^\s*#/.test(radek))
    .join("\n")
    .replace(/\\\n\s*/g, " ");
  const baliky = new Set<string>();
  for (const m of obsah.matchAll(/fetch-locked-package\.mjs\s+((?:--\S+\s+)*)(\S+)/g)) {
    baliky.add(m[2]);
  }
  return [...baliky];
}

describe("téma Keycloaku načítá právě to, co se do něj veze", () => {
  it("každý soubor v `styles=` má cestu, kterou se do obrazu dostane", () => {
    const styles = stylesZTemaProperties();
    const kopie = copyCileDoCss();

    // Sonda musí doložit, že měřila — na obou stranách.
    expect(styles.length, "`styles=` je prázdné — verdikt by nic neznamenal").toBeGreaterThan(2);
    expect(kopie.length, `${DOCKERFILE} nekopíruje do resources/css nic — verdikt by nic neznamenal`).toBeGreaterThan(0);

    const bezDodavky: string[] = [];
    for (const styl of styles) {
      // 1. leží přímo v repu?
      if (existsSync(join(ROOT, TEMA, "resources", styl))) continue;
      // 2. veze ho nějaký COPY? Cíl je buď přesně ten soubor, nebo adresář,
      //    do kterého se kopíruje zdroj téhož jména.
      const jmeno = basename(styl);
      const vezeSe = kopie.some(({ cil, zdroje }) => {
        if (cil.endsWith(`/${styl}`)) return true;
        if (!cil.endsWith("/")) return false;
        // Cíl je adresář — sedí, když jeho konec odpovídá adresáři stylu
        // a mezi zdroji je soubor toho jména. Cesty v `styles=` jsou relativní
        // k `resources/`, takže `css/` v nich UŽ JE — přidávat ho podruhé by
        // hledalo `…/css/css/esdk/` a nenašlo nic.
        const adresarStylu = styl.includes("/") ? `${styl.slice(0, styl.lastIndexOf("/"))}/` : "";
        if (!cil.endsWith(`/${adresarStylu}`)) return false;
        return zdroje.some((z) => basename(z) === jmeno);
      });
      if (!vezeSe) bezDodavky.push(styl);
    }

    expect(
      bezDodavky,
      "Soubor uvedený v `styles=`, který se do obrazu nedostane, znamená 404 při\n" +
        "každém zobrazení přihlašovací stránky — a Keycloak kvůli němu nespadne.\n" +
        "Stránka vypadá skoro správně, jen část vzhledu chybí.\n" +
        `Náprava: buď ho do ${TEMA}/resources/css/ přidat, nebo ho vézt \`COPY\` v ${DOCKERFILE}.\n  ` +
        bezDodavky.join("\n  "),
    ).toEqual([]);
  });

  it("každé CSS, které Dockerfile veze, také někdo načte", () => {
    const styles = stylesZTemaProperties();
    const kopie = copyCileDoCss().filter((k) => !k.zOverlaye);

    // ⛔ TADY BYLA ÚNIKOVÁ VĚTEV `if (cil.endsWith("/") && zdroje.length > 1)
    // continue` — pro případ, že se do adresáře kopíruje víc souborů najednou.
    // Jenže to je právě náš případ, takže se test PŘESKAKOVAL celý a zeleně
    // tvrdil, že `adapter.css` někdo načítá, i když jsem ho z `styles=` schválně
    // vyndal. Fail-open uvnitř brány proti fail-openu. Import se proto dohledává
    // doopravdy — v nainstalovaném balíku, ze kterého se ty soubory vezou.
    //
    // `styles.map(basename)` NE: `map` posílá i index a `basename` ho vezme
    // jako druhý argument (`suffix`) — spadne na typu, nebo tiše ustřihne jméno.
    const zBalikuImportuje = new Map<string, string[]>();
    for (const balik of balikyZeStagu()) {
      const korenBaliku = join(ROOT, "node_modules", balik);
      expect(
        existsSync(korenBaliku),
        `${balik} není nainstalovaný (${korenBaliku}) — bez něj nejde @import graf ZMĚŘIT.\n` +
          "Brána raději spadne, než by mlčky prohlásila neměřené za v pořádku. Spusť `npm ci`.",
      ).toBe(true);
      for (const soubor of readdirSync(korenBaliku).filter((f) => f.endsWith(".css"))) {
        const cile: string[] = [];
        for (const m of readFileSync(join(korenBaliku, soubor), "utf8").matchAll(
          /@import\s+(?:url\()?\s*["']([^"')]+)["']/g,
        )) {
          if (/^https?:/i.test(m[1])) continue; // externí — ty build odstraňuje
          cile.push(basename(m[1]));
        }
        zBalikuImportuje.set(soubor, cile);
      }
    }

    // Uzávěr: co je v `styles=`, plus všechno, co si to řetězem přitáhne.
    const nacitane = new Set(styles.map((s) => basename(s)));
    for (let roste = true; roste; ) {
      roste = false;
      for (const [soubor, cile] of zBalikuImportuje) {
        if (!nacitane.has(soubor)) continue;
        for (const cil of cile) {
          if (!nacitane.has(cil)) {
            nacitane.add(cil);
            roste = true;
          }
        }
      }
    }

    const nenacitane: string[] = [];
    for (const { zdroje, cil } of kopie) {
      for (const zdroj of zdroje) {
        const jmeno = basename(zdroj);
        if (!jmeno.endsWith(".css")) continue;
        // Přejmenování při kopii: cíl nese jiné jméno než zdroj.
        const cilovéJmeno = cil.endsWith("/") ? jmeno : basename(cil);
        if (nacitane.has(cilovéJmeno)) continue;
        nenacitane.push(`${cilovéJmeno} (veze ${DOCKERFILE}, ale není v \`styles=\` ani ho nikdo neimportuje)`);
      }
    }

    expect(
      nenacitane,
      "CSS, které se do obrazu veze a nikdo ho nenačte, je artefakt bez spotřebitele:\n" +
        "vypadá dodaně a nedělá nic. Přesně takhle se `adapter.css` vezl do obrazu a\n" +
        "mapování krátkých jmen SDK se nikdy nedělo (naměřeno 2026-08-18).\n" +
        "Náprava: doplnit do `styles=`, nebo přestat vézt.\n  " +
        nenacitane.join("\n  "),
    ).toEqual([]);
  });
});
