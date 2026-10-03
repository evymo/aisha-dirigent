import { mkdtemp, readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  barvaZOdpovedi,
  cestaProSlug,
  vychozíJazyk,
  rozeberSkorapku,
  slozStranku,
  uklidOsirele,
  vytahniObrazky,
  zapisStranku,
} from "./render.js";

const SKORAPKA = {
  skripty: ['<script type="module" crossorigin src="/assets/vendor-abc.js"></script>'],
  styly: ['<link rel="stylesheet" crossorigin href="/assets/shared-def.css">'],
  ostatniHlava: ['<link rel="icon" href="/favicon.ico">'],
};

const STRANKA = {
  slug: "index",
  title: "Example App",
  description: "Popis",
  canvasHtml: "<header>ahoj</header>",
  canvasCss: ".nav{background:blue}",
};

async function docasny() {
  return mkdtemp(join(tmpdir(), "render-test-"));
}

describe("vytahniObrazky", () => {
  it("vytáhne base64 do souboru a přepíše odkaz", async () => {
    const dir = await docasny();
    // 1×1 px PNG
    const b64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const html = `<img src="data:image/png;base64,${b64}">`;

    const { html: out, pocetObrazku } = await vytahniObrazky(html, join(dir, "_img"), "/_img");

    expect(pocetObrazku).toBe(1);
    expect(out).not.toContain("base64");
    expect(out).toMatch(/src="\/_img\/[0-9a-f]{16}\.png"/);
    const soubory = await readdir(join(dir, "_img"));
    expect(soubory).toHaveLength(1);
  });

  it("týž obrázek dvakrát = jeden soubor (hash z obsahu)", async () => {
    const dir = await docasny();
    const b64 = Buffer.from("stejná data").toString("base64");
    const html = `<img src="data:image/webp;base64,${b64}"><img src="data:image/webp;base64,${b64}">`;

    const { pocetObrazku } = await vytahniObrazky(html, join(dir, "_img"), "/_img");

    expect(pocetObrazku).toBe(1);
    expect(await readdir(join(dir, "_img"))).toHaveLength(1);
  });

  it("neznámý MIME nechá inline — radši větší stránka než rozbitý obrázek", async () => {
    const dir = await docasny();
    const html = `<embed src="data:application/pdf;base64,${Buffer.from("x").toString("base64")}">`;

    const { html: out, pocetObrazku } = await vytahniObrazky(html, join(dir, "_img"), "/_img");

    expect(pocetObrazku).toBe(0);
    expect(out).toContain("base64");
  });
});

describe("rozeberSkorapku", () => {
  it("vytáhne skripty, styly a ikony z reálného tvaru dist/index.html", () => {
    const shell = `<!doctype html><html><head>
      <link rel="icon" type="image/x-icon" href="/favicon.ico">
      <link rel="manifest" href="/manifest.webmanifest">
      <script type="module" crossorigin src="/assets/vendor-X.js"></script>
      <script type="module" crossorigin src="/assets/shared-Y.js"></script>
      <link rel="stylesheet" crossorigin href="/assets/vendor-Z.css">
      </head><body><div id="root"></div></body></html>`;

    const r = rozeberSkorapku(shell);

    expect(r.skripty).toHaveLength(2);
    expect(r.styly).toHaveLength(1);
    expect(r.ostatniHlava.join()).toContain("favicon.ico");
    expect(r.ostatniHlava.join()).toContain("manifest");
    // ⛔ Jména souborů se NESMÍ hádat — Vite je hashuje. Test to drží tím,
    // že vytažené značky musí nést přesně ty hashe ze vstupu.
    expect(r.skripty.join()).toContain("vendor-X.js");
    expect(r.skripty.join()).toContain("shared-Y.js");
  });
});

describe("slozStranku", () => {
  it("statický obsah je MIMO #root — jinak ho React při startu smaže", () => {
    const html = slozStranku({ stranka: STRANKA, branding: {}, skorapka: SKORAPKA });

    const iStatic = html.indexOf('id="static-page"');
    const iRoot = html.indexOf('id="root"');
    expect(iStatic).toBeGreaterThan(-1);
    expect(iRoot).toBeGreaterThan(iStatic);
    // obsah smí být jen ve static-page, ne v root
    expect(html).toContain('<div id="static-page" data-slug="index"><header>ahoj</header></div>');
    expect(html).toContain('<div id="root"></div>');
  });

  // ⛔ NAPSÁNO ČERVENÉ proti dřívějšímu triku `media="print" onload=…`
  // (naměřeno 2026-09-03 na produkci): edge posílá CSP `script-src 'self'
  // 'wasm-unsafe-eval'` bez nonce, takže prohlížeč vložený handler odmítl,
  // stylesheet zůstal `print` a vše, co vykreslí React, přišlo o Tailwind.
  it("CSS stránky je inline; stylesheet aplikace je holý <link> bez vloženého skriptu", () => {
    const html = slozStranku({ stranka: STRANKA, branding: {}, skorapka: SKORAPKA });

    expect(html).toContain("<style>.nav{background:blue}</style>");
    expect(html).toContain('<link rel="stylesheet" crossorigin href="/assets/shared-def.css">');
    expect(html).not.toContain('media="print"');
    expect(html).not.toContain("<noscript>");
    // stylesheet stojí až za #root — blokuje jen obsah za sebou, a ten není
    expect(html.indexOf("shared-def.css")).toBeGreaterThan(html.indexOf('id="root"'));
  });

  it("v celém HTML není žádný vložený handler událostí — CSP by ho zahodila", () => {
    const html = slozStranku({ stranka: STRANKA, branding: {}, skorapka: SKORAPKA });

    expect(html).not.toMatch(/\son[a-z]+=["']/i);
  });

  // ⛔ NAPSÁNO ČERVENÉ (naměřeno 2026-09-03): statická kopie se po hydrataci
  // neodstraňovala a stránka byla dvakrát pod sebou. Aplikace ji odstraní
  // (PageRenderer); tohle je pojistka v HTML pro případ, že by efekt nepřišel.
  it("jakmile je v #root obsah, statická kopie se skryje i bez JS aplikace", () => {
    const html = slozStranku({ stranka: STRANKA, branding: {}, skorapka: SKORAPKA });

    expect(html).toContain("body:has(#root:not(:empty)) #static-page{display:none}");
  });

  it("barva prvního vykreslení jde z brandingu; bez ní se blok nevydá", () => {
    const s = slozStranku({
      stranka: STRANKA,
      branding: { primary: "213 82% 50%" },
      skorapka: SKORAPKA,
    });
    expect(s).toContain("--primary:213 82% 50%");

    const bez = slozStranku({ stranka: STRANKA, branding: {}, skorapka: SKORAPKA });
    expect(bez).not.toContain("--primary:");
  });

  it("titulek a popis se escapují — obsah stránky je vstup, ne kód", () => {
    const html = slozStranku({
      stranka: { ...STRANKA, title: 'A"B<script>', description: "x & y" },
      branding: {},
      skorapka: SKORAPKA,
    });

    expect(html).toContain("<title>A&quot;B&lt;script&gt;</title>");
    expect(html).toContain('content="x &amp; y"');
    expect(html).not.toContain("<title>A\"B<script>");
  });
});

describe("cestaProSlug", () => {
  it("index jde do kořene, ostatní do vlastního adresáře", () => {
    expect(cestaProSlug("/out", "index")).toBe("/out/index.html");
    expect(cestaProSlug("/out", "features")).toBe("/out/features/index.html");
  });
});

describe("uklidOsirele", () => {
  it("smaže stránku, která už v DB není", async () => {
    const dir = await docasny();
    await zapisStranku(dir, "features", "<html></html>");
    await zapisStranku(dir, "zruseno", "<html></html>");
    await mkdir(join(dir, "_img"), { recursive: true });
    await writeFile(join(dir, "_img", "a.webp"), "x");

    const smazano = await uklidOsirele(dir, ["index", "features"]);

    expect(smazano).toBe(1);
    const zbylo = (await readdir(dir)).sort();
    expect(zbylo).toContain("features");
    expect(zbylo).not.toContain("zruseno");
    // ⛔ _img se nesmí smazat — obrázky sdílí víc stránek
    expect(zbylo).toContain("_img");
  });

  it("neexistující adresář není chyba (první běh)", async () => {
    expect(await uklidOsirele("/naprosto/neexistujici", ["index"])).toBe(0);
  });
});

describe("zapisStranku", () => {
  it("vytvoří adresář a zapíše obsah", async () => {
    const dir = await docasny();
    const cesta = await zapisStranku(dir, "gdpr", "<html>x</html>");
    expect(await readFile(cesta, "utf8")).toBe("<html>x</html>");
  });
});

describe("barvaZOdpovedi", () => {
  // Barva je VNOŘENÁ v klíči `profile` — původní čtečka brala vršek, takže
  // `primary` zůstával prázdný a blok barvy prvního vykreslení se nikdy nezapsal.
  it("bere barvu z vnořeného profilu", () => {
    expect(barvaZOdpovedi({ primary_route: "/skupina", profile: { color_primary: "169 62% 14%" } })).toBe(
      "169 62% 14%",
    );
  });

  it("plochý tvar čte dál (zpětná kompatibilita)", () => {
    expect(barvaZOdpovedi({ color_primary: "156 39% 40%" })).toBe("156 39% 40%");
  });

  it("vnořený profil má přednost před vršekem", () => {
    expect(barvaZOdpovedi({ color_primary: "0 0% 0%", profile: { color_primary: "187 24% 93%" } })).toBe(
      "187 24% 93%",
    );
  });

  it("pole rozbaluje po prvním řádku", () => {
    expect(barvaZOdpovedi([{ profile: { color_primary: "157 41% 30%" } }])).toBe("157 41% 30%");
  });

  // ⛔ Jazyk v odpovědi brandingu NENÍ a nesmí se odtud brát, ani kdyby tam
  // něco takového bylo — `branding_profiles` sloupec s jazykem nemá.
  it("NULL, nesmysl i chybějící pole dávají prázdnou barvu", () => {
    expect(barvaZOdpovedi(null)).toBe("");
    expect(barvaZOdpovedi("ahoj")).toBe("");
    expect(barvaZOdpovedi({})).toBe("");
    expect(barvaZOdpovedi({ profile: { color_primary: 42 } })).toBe("");
  });
});

describe("vychozíJazyk", () => {
  it("bere první řádek, protože RPC řadí is_default DESC", () => {
    expect(
      vychozíJazyk([
        { code: "cs", is_default: true },
        { code: "en", is_default: false },
      ]),
    ).toBe("cs");
  });

  it("prázdná nabídka jazyků = prázdný jazyk, ne 'en'", () => {
    expect(vychozíJazyk([])).toBe("");
    expect(vychozíJazyk(null)).toBe("");
    expect(vychozíJazyk({})).toBe("");
    expect(vychozíJazyk([{ is_default: true }])).toBe("");
  });

  it("snese i holý řetězec nebo jediný objekt (starší tvary odpovědi)", () => {
    expect(vychozíJazyk("th")).toBe("th");
    expect(vychozíJazyk({ code: "fr" })).toBe("fr");
  });
});
