import { describe, it, expect } from "vitest";
import { jeNaseUloziste, ohniskoZClanku, vyrezObrazku } from "@/lib/media/verejnaAdresaObrazku";

const NASE = "https://api.example.test/storage/v1/object/public/page-assets/u/x.jpg";

describe("adresa výřezu obrázku", () => {
  it("naše adresa dostane w/h; výchozí ohnisko a přiblížení se neposílají", () => {
    expect(vyrezObrazku(NASE, { w: 640, h: 360 })).toBe(`${NASE}?w=640&h=360`);
    expect(vyrezObrazku(NASE, { w: 640, h: 360, fx: 0.5, fy: 0.5, zoom: 1 })).toBe(`${NASE}?w=640&h=360`);
  });
  it("ohnisko a přiblížení se přidají s pevným počtem míst", () => {
    expect(vyrezObrazku(NASE, { w: 640, h: 360, fx: 0.25, fy: 0.75, zoom: 2 })).toBe(`${NASE}?w=640&h=360&fx=0.250&fy=0.750&z=2.00`);
  });
  it("mimo meze se sevře, rozměry se zaokrouhlí", () => {
    expect(vyrezObrazku(NASE, { w: 640.4, h: 0, fx: 1.5, fy: -1, zoom: 9 })).toBe(`${NASE}?w=640&h=1&fx=1.000&fy=0.000&z=4.00`);
  });
  it("cizí adresa (import) se nemění; prázdná je null", () => {
    const cizi = "https://www.example.org/wp-content/uploads/2020/03/foto.jpg";
    expect(vyrezObrazku(cizi, { w: 640, h: 360, fx: 0.2 })).toBe(cizi);
    expect(vyrezObrazku(null, { w: 1, h: 1 })).toBeNull();
    expect(vyrezObrazku("", { w: 1, h: 1 })).toBeNull();
    expect(jeNaseUloziste(cizi)).toBe(false);
  });
  it("existující parametry se přepíší, ne zdvojí", () => {
    expect(vyrezObrazku(`${NASE}?w=10&h=10&fx=0.100`, { w: 640, h: 360 })).toBe(`${NASE}?w=640&h=360`);
  });
});

describe("ohnisko ze sloupců článku", () => {
  it("null = výchozí střed a bez přiblížení (to je i DB DEFAULT)", () => {
    expect(ohniskoZClanku({})).toEqual({ fx: 0.5, fy: 0.5, zoom: 1 });
    expect(ohniskoZClanku({ image_focus_x: null, image_focus_y: null, image_zoom: null })).toEqual({ fx: 0.5, fy: 0.5, zoom: 1 });
  });
  it("hodnoty projdou a sevřou se", () => {
    expect(ohniskoZClanku({ image_focus_x: 0.2, image_focus_y: 0.9, image_zoom: 3 })).toEqual({ fx: 0.2, fy: 0.9, zoom: 3 });
    expect(ohniskoZClanku({ image_focus_x: 2, image_zoom: 0 })).toEqual({ fx: 1, fy: 0.5, zoom: 1 });
  });
});
