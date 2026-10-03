import { describe, expect, it } from "vitest";

import { buildFontFaceCss } from "@/lib/branding/fontFaceCss";
import type { BrandingProfile, FontFace } from "@/lib/schemas/brandingProfileSchemas";

/** Minimal profile carrying only the font_faces the function reads. */
function profileWith(faces: FontFace[] | null | undefined): BrandingProfile {
  return { font_faces: faces } as unknown as BrandingProfile;
}

describe("buildFontFaceCss (per-instance self-hosted webfont seam)", () => {
  it("emits nothing when font_faces is absent / null / empty", () => {
    expect(buildFontFaceCss(profileWith(undefined))).toBe("");
    expect(buildFontFaceCss(profileWith(null))).toBe("");
    expect(buildFontFaceCss(profileWith([]))).toBe("");
  });

  it("emits a well-formed @font-face for a valid instance font (e.g. private Avenir)", () => {
    const css = buildFontFaceCss(
      profileWith([
        { family: "Avenir", src_url: "https://assets.example.com/avenir.woff2", weight: "400 800" },
      ]),
    );
    expect(css).toContain("@font-face");
    expect(css).toContain("font-family: 'Avenir';");
    expect(css).toContain("src: url('https://assets.example.com/avenir.woff2') format('woff2');");
    expect(css).toContain("font-weight: 400 800;");
    expect(css).toContain("font-style: normal;");
    expect(css).toContain("font-display: swap;");
  });

  it("accepts root-relative URLs and defaults weight/style", () => {
    const css = buildFontFaceCss(
      profileWith([{ family: "Avenir", src_url: "/branding/avenir.woff2" }]),
    );
    expect(css).toContain("src: url('/branding/avenir.woff2') format('woff2');");
    expect(css).toContain("font-weight: 400 800;"); // default variable range
    expect(css).toContain("font-style: normal;");
  });

  it("honours italic style and a valid unicode-range", () => {
    const css = buildFontFaceCss(
      profileWith([
        {
          family: "Avenir",
          src_url: "/a.woff2",
          style: "italic",
          unicode_range: "U+0000-00FF,U+0100-017F",
        },
      ]),
    );
    expect(css).toContain("font-style: italic;");
    expect(css).toContain("unicode-range: U+0000-00FF,U+0100-017F;");
  });

  // ── Security: CSS-injection attempts must be skipped, not emitted ──────────
  it("skips entries whose src_url could break out of url(...)", () => {
    const attacks = [
      "https://x/a.woff2'); } body{display:none} @font-face{src:url('x", // quote/paren/brace breakout
      "https://x/a.woff2\"); color:red", // double-quote breakout
      "javascript:alert(1)", // wrong scheme
      "http://x/a.woff2", // non-https absolute
      "/a.woff2; background:url(evil)", // semicolon breakout
      "/a.woff2 )", // whitespace + paren
    ];
    for (const src_url of attacks) {
      expect(buildFontFaceCss(profileWith([{ family: "Avenir", src_url }]))).toBe("");
    }
  });

  it("skips entries whose family contains CSS-breaking characters", () => {
    const badFamilies = ["Avenir'; }", "Avenir}", "A{x", 'A"B', "A;B"];
    for (const family of badFamilies) {
      expect(buildFontFaceCss(profileWith([{ family, src_url: "/a.woff2" }]))).toBe("");
    }
  });

  it("ignores malformed weight / unicode-range but still emits the face", () => {
    const css = buildFontFaceCss(
      profileWith([
        { family: "Avenir", src_url: "/a.woff2", weight: "bold; }", unicode_range: "); }" },
      ]),
    );
    expect(css).toContain("@font-face");
    expect(css).toContain("font-weight: 400 800;"); // bad weight → safe default
    expect(css).not.toContain("unicode-range"); // bad range → omitted
    // exactly one block delimiter pair → no injected braces escaped through
    expect((css.match(/\{/g) ?? []).length).toBe(1);
    expect((css.match(/\}/g) ?? []).length).toBe(1);
  });

  it("emits one block per valid face and drops invalid ones in a mixed list", () => {
    const css = buildFontFaceCss(
      profileWith([
        { family: "Avenir", src_url: "/ok.woff2" },
        { family: "Bad}", src_url: "/x.woff2" },
        { family: "AvenirNext", src_url: "https://h/y.woff2" },
      ]),
    );
    expect(css.match(/@font-face/g) ?? []).toHaveLength(2);
    expect(css).toContain("'Avenir'");
    expect(css).toContain("'AvenirNext'");
    expect(css).not.toContain("Bad");
  });
});
