/**
 * Ikona okna instance (2026-10-02, naměřeno na instanci): index.html nese dvě ikony platformy
 * (favicon.ico + favicon.png) a nastavení přepisovalo jen první — ikona AISHA
 * mohla v prohlížeči vyhrát.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { nastavIkonuOkna, sVerzi, typIkony } from "@/lib/branding/ikonaOkna";

const ADRESA = "https://api.example.test/storage/v1/object/public/page-assets/u/abc_favicon.png";

function hlavaJakoIndexHtml() {
  document.head.innerHTML = `
    <link rel="icon" type="image/x-icon" href="/favicon.ico">
    <link rel="icon" type="image/png" href="/favicon.png">
    <link rel="apple-touch-icon" href="/apple-touch-icon.png">`;
}

describe("nastavIkonuOkna", () => {
  beforeEach(hlavaJakoIndexHtml);

  it("přepíše VŠECHNY ikony okna na ikonu instance se správným typem", () => {
    nastavIkonuOkna(document, ADRESA, 7);
    const ikony = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'));
    expect(ikony).toHaveLength(2);
    for (const l of ikony) {
      expect(l.href).toBe(`${ADRESA}?v=7`);
      expect(l.type).toBe("image/png");
    }
  });

  it("rastrová ikona jde i na plochu telefonu, SVG ne", () => {
    nastavIkonuOkna(document, ADRESA, 1);
    expect(document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')!.href).toBe(`${ADRESA}?v=1`);

    hlavaJakoIndexHtml();
    nastavIkonuOkna(document, "https://cdn.test/ikona.svg", 1);
    expect(document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')!.getAttribute("href")).toBe("/apple-touch-icon.png");
    expect(document.querySelector<HTMLLinkElement>('link[rel~="icon"]')!.type).toBe("image/svg+xml");
  });

  it("bez odkazu v hlavě ho založí", () => {
    document.head.innerHTML = "";
    nastavIkonuOkna(document, ADRESA, null);
    const l = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    expect(l?.href).toBe(ADRESA);
  });
});

describe("pomocníci", () => {
  it("typ podle přípony, query a fragment se ignorují", () => {
    expect(typIkony("/a/b.PNG?x=1#y")).toBe("image/png");
    expect(typIkony("/a/ikona.ico")).toBe("image/x-icon");
    expect(typIkony("/a.b/ikona")).toBeNull();
  });

  it("verze zachová existující query i fragment", () => {
    expect(sVerzi("/i.png", 3)).toBe("/i.png?v=3");
    expect(sVerzi("/i.png?w=32#x", 3)).toBe("/i.png?w=32&v=3#x");
    expect(sVerzi("/i.png", undefined)).toBe("/i.png");
  });
});
