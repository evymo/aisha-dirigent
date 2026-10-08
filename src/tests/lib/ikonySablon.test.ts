/**
 * Ikony šablon webu (`<i class="ti ti-…">`) jako SVG — 2026-10-02.
 *
 * Písmo Tabler Icons se na web nikdy nenačítalo (a CSP `font-src 'self'` by ho
 * z CDN zablokovala): ikona měla nulovou šířku a „Download“ v hero nešel
 * vystředit. Styl teď kreslí známé ikony maskou se SVG z lucide.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getPageEditorConfig } from "@/lib/builder/editorConfig";

const ROOT = join(__dirname, "../../..");
const css = readFileSync(join(ROOT, "src/styles/ikony-sablon.css"), "utf-8");

describe("ikony šablon webu", () => {
  it("ikony ze šablony webu (download, users) mají SVG masku", () => {
    for (const ikona of ["download", "users"]) {
      expect(css).toMatch(new RegExp(`\\.ti\\.ti-${ikona} \\{ --ti-ikona: url\\("data:image/svg\\+xml,`));
    }
  });

  it("neznámá ikona nevykreslí plný čtverec — styl jen pro známé třídy", () => {
    const pravidla = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(pravidla).not.toMatch(/(^|\n)\.ti\s*\{/);
    expect(pravidla).not.toMatch(/(^|[\s,])\.ti\s*[,{]/);
  });

  it("nic se nenačítá zvenku (CSP webu: jen data:)", () => {
    const pravidla = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(pravidla).not.toMatch(/url\(["']?(https?:)?\/\//);
  });

  it("web i plátno editoru načítají tentýž soubor", () => {
    expect(readFileSync(join(ROOT, "src/index.css"), "utf-8")).toContain("@import './styles/ikony-sablon.css';");
    // Vitest CSS soubory nahrazuje prázdnými moduly (i `?url`), proto se propojení
    // ověřuje ve zdroji; odkaz za běhu dodá build (Vite `?url`).
    const zdroj = readFileSync(join(ROOT, "src/lib/builder/editorConfig.ts"), "utf-8");
    expect(zdroj).toContain('import ikonySablonCssUrl from "@/styles/ikony-sablon.css?url";');
    expect(zdroj).toMatch(/styles:\s*\[ikonySablonCssUrl\]/);
    expect(getPageEditorConfig().canvas?.styles).toHaveLength(1);
  });
});
