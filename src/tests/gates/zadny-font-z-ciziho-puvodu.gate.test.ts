/**
 * Brána: odkaz na styl/font z cizího původu musí projít NASAZENOU CSP.
 *
 * PROČ (naměřeno 2026-08-10 v prohlížeči nad nasazenou instancí)
 * -------------------------------------------------------------
 * `index.html` načítal Google Fonts (DM Sans + Playfair Display) a
 * `instances/_default/public/tokens.css` je `@import`oval (Archivo, Inter,
 * IBM Plex Mono). CSP, kterou servíruje `docker/nginx.conf`, má ale
 * `style-src 'self' 'unsafe-inline'` — prohlížeč oba odmítl:
 *
 *   Loading the stylesheet 'https://fonts.googleapis.com/css2?…' violates the
 *   following Content Security Policy directive: "style-src 'self' 'unsafe-inline'"
 *
 * ⭐ NA ČEM ZÁLEŽÍ: nespadlo nic. Stránka se načte, HTTP 200, `curl` spokojený —
 * jen se kreslí systémovým fallbackem. Značková typografie prostě mlčky není.
 * A protože `index.html` a `_default` jsou GENERICKÁ část stacku, měl tuhle vadu
 * KAŽDÝ fork, ne jedna instance.
 *
 * CO SE MĚŘÍ
 * ----------
 * Ne výskyt slova „google" — to by prošlo u jiné CDN a padalo by u komentáře.
 * Brána si CSP PŘEČTE z `docker/nginx.conf` (to je politika, která se opravdu
 * posílá), vytáhne `style-src` a `font-src`, a proti nim porovná KAŽDÝ cizí
 * původ, na který se odkazují dodávané HTML/CSS soubory.
 *
 * ⇒ Když někdo CDN do CSP legitimně přidá, brána ho pustí. Když přidá odkaz
 * a CSP nechá být, brána ho zastaví. Pravidlo se odvozuje, nepíše se dvakrát.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const NGINX = join(ROOT, "docker/nginx.conf");

/** Povolené původy dané direktivy v nasazené CSP. */
function csp(direktiva: string): string[] {
  const t = readFileSync(NGINX, "utf8");
  const m = t.match(/Content-Security-Policy\s+"([^"]+)"/);
  expect(
    m,
    "v docker/nginx.conf se nenašla hlavička Content-Security-Policy — brána ztratila " +
      "zdroj pravdy o tom, co prohlížeč pustí. Oprav ji, NEODSTRAŇUJ ji.",
  ).not.toBeNull();
  const blok = m![1].split(";").map((x) => x.trim()).find((x) => x.startsWith(direktiva + " "));
  return blok ? blok.slice(direktiva.length).trim().split(/\s+/) : [];
}

/** Pustí CSP tenhle absolutní URL? (Zajímají nás jen cizí původy.) */
function povoleno(url: string, zdroje: string[]): boolean {
  if (zdroje.includes("*")) return true;
  if (zdroje.includes("https:") ) return url.startsWith("https://");
  return zdroje.some((z) => {
    if (!z.startsWith("http")) return false;              // 'self', 'unsafe-inline', data: …
    const host = z.replace(/^https?:\/\//, "").replace(/\/$/, "");
    return url.replace(/^https?:\/\//, "").startsWith(host);
  });
}

function souboryVe(dir: string, pripony: string[], out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".git" || e === "dist") continue;
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) souboryVe(p, pripony, out);
    else if (pripony.some((x) => e.endsWith(x))) out.push(p);
  }
  return out;
}

/** Dodávané HTML/CSS — to, co se opravdu dostane do prohlížeče. */
function dodavaneSoubory(): string[] {
  const out: string[] = [];
  const idx = join(ROOT, "index.html");
  if (existsSync(idx)) out.push(idx);
  for (const d of ["src", "instances", "public", "domains"]) {
    out.push(...souboryVe(join(ROOT, d), [".css", ".html"]));
  }
  return out;
}

interface Nalez { soubor: string; radek: number; url: string; smer: string }

/** Odkazy na cizí původ: <link rel=stylesheet href>, @import url(), src: url() ve @font-face. */
function ciziOdkazy(soubor: string): Nalez[] {
  const out: Nalez[] = [];
  const radky = readFileSync(soubor, "utf8").split("\n");
  radky.forEach((r, i) => {
    // komentáře (CSS i HTML) nejsou instrukce pro prohlížeč — tahle brána měří ČIN
    const cisty = r.replace(/\/\*.*?\*\//g, "").replace(/<!--[\s\S]*?-->/g, "");
    if (/^\s*(\*|\/\/|#)/.test(cisty) || /^\s*$/.test(cisty)) return;

    for (const m of cisty.matchAll(/@import\s+url\(\s*["']?(https?:\/\/[^"')]+)/gi))
      out.push({ soubor, radek: i + 1, url: m[1], smer: "style-src" });
    for (const m of cisty.matchAll(/<link[^>]*rel=["']?stylesheet["']?[^>]*href=["'](https?:\/\/[^"']+)/gi))
      out.push({ soubor, radek: i + 1, url: m[1], smer: "style-src" });
    for (const m of cisty.matchAll(/<link[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*rel=["']?stylesheet/gi))
      out.push({ soubor, radek: i + 1, url: m[1], smer: "style-src" });
    for (const m of cisty.matchAll(/src:\s*url\(\s*["']?(https?:\/\/[^"')]+)/gi))
      out.push({ soubor, radek: i + 1, url: m[1], smer: "font-src" });
  });
  return out;
}

describe("odkaz na cizí původ musí projít nasazenou CSP (brána)", () => {
  test("CSP se dá z nginx.conf přečíst — jinak je tvrzení níž vakuové", () => {
    const s = csp("style-src");
    const f = csp("font-src");
    expect(s.length, "style-src se v CSP nenašel — parser přestal sedět").toBeGreaterThan(0);
    expect(f.length, "font-src se v CSP nenašel — parser přestal sedět").toBeGreaterThan(0);
  });

  test("univerzum souborů není prázdné", () => {
    expect(
      dodavaneSoubory().length,
      "nenašel se žádný dodávaný HTML/CSS soubor — brána by neměřila nic",
    ).toBeGreaterThan(5);
  });

  test("žádný dodávaný soubor neodkazuje na původ, který CSP zakazuje", () => {
    const styleSrc = csp("style-src");
    const fontSrc = csp("font-src");
    const spatne: string[] = [];

    for (const f of dodavaneSoubory()) {
      for (const n of ciziOdkazy(f)) {
        const zdroje = n.smer === "font-src" ? fontSrc : styleSrc;
        if (!povoleno(n.url, zdroje)) {
          spatne.push(
            `${relative(ROOT, n.soubor)}:${n.radek} → ${n.url.slice(0, 70)}\n` +
              `      ${n.smer} = ${zdroje.join(" ")}`,
          );
        }
      }
    }

    expect(
      spatne,
      "tyhle soubory odkazují na cizí původ, který NASAZENÁ CSP (docker/nginx.conf)\n" +
        "zakazuje. Prohlížeč je odmítne a NIC nespadne — jen se kreslí fallbackem.\n" +
        "Naměřeno 2026-08-10: index.html + instances/_default/public/tokens.css takhle\n" +
        "tahaly pět rodin z Google Fonts na KAŽDÉM forku a značková typografie nebyla nikde.\n\n" +
        "Buď font přibal (vzor: public/fonts/nunito-sans/, subsety + unicode-range),\n" +
        "nebo použij instanční kanál branding_profiles.font_faces\n" +
        "(docs/branding/PER_INSTANCE_WEBFONTS.md). Rozšiřovat CSP je až poslední možnost\n" +
        "— a pak patří změna do docker/nginx.conf, ať brána měří totéž, co prohlížeč.",
    ).toEqual([]);
  });
});
