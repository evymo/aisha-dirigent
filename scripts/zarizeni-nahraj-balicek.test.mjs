import { describe, it, expect } from "vitest";
import { plan } from "./zarizeni-nahraj-balicek.mjs";

/**
 * Vlastnost: nahrává se JEN deklarované, a jen proti otisku z deklarace.
 * Skript nesmí být cestou, jak do úložiště dostat cokoli.
 */
const D = {
  apk: { sha256: "A".repeat(64) },
  appky: [{ balicek: "cz.riq.ridic", versionCode: 12, versionName: "1.0.0", sha256: "b".repeat(64) }],
};

describe("plán nahrání", () => {
  it("hlídač míří na svou trasu a nese otisk z deklarace (malá písmena)", () => {
    expect(plan(D, "https://x/storage/v1", { hlidac: "/tmp/h.apk" })).toEqual([
      { co: "hlídač", url: "https://x/storage/v1/zarizeni/hlidac", soubor: "/tmp/h.apk", ocekavanySha256: "a".repeat(64) },
    ]);
  });

  it("appka míří na svou trasu podle jména balíčku", () => {
    const p = plan(D, "https://x/storage/v1", { appky: { "cz.riq.ridic": "/tmp/r.apk" } });
    expect(p[0].url).toBe("https://x/storage/v1/zarizeni/appky/cz.riq.ridic");
    expect(p[0].ocekavanySha256).toBe("b".repeat(64));
  });

  it("⛔ NEDEKLAROVANÁ appka se nenahraje — skript není cesta, jak tam dostat cokoli", () => {
    expect(() => plan(D, "https://x", { appky: { "cz.cizi.app": "/tmp/x.apk" } })).toThrow(/není v deklaraci/);
  });

  it("⛔ bez otisku v deklaraci se NENAHRÁVÁ", () => {
    expect(() => plan({ apk: {} }, "https://x", { hlidac: "/tmp/h.apk" })).toThrow(/apk.sha256/);
  });

  it("prázdné zadání je chyba, ne tichý úspěch", () => {
    expect(() => plan(D, "https://x", {})).toThrow(/nic k nahrání/);
  });
});
