import { describe, it, expect, afterEach } from "vitest";
import { appPrefix, toStoryApp, stripStoryPrefix } from "./story-app.mjs";

const ORIGINAL = process.env.APP_NAME_PREFIX;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.APP_NAME_PREFIX;
  else process.env.APP_NAME_PREFIX = ORIGINAL;
});

describe("story-app prefix remap", () => {
  // ⛔ ZMĚNA KONTRAKTU 2026-08-24. Tenhle test dřív tvrdil, že se bez
  // deklarace DOSADÍ „aisha" — a přesně to bylo nebezpečné: na sdíleném
  // Coolify běží víc instancí vedle sebe, takže nedeklarovaná identita
  // znamenala TICHÝ zápis do cizího nájemníka (naměřeno 2026-07-21: běh bez
  // APP_NAME_PREFIX poslal cizí .env.coolify do 8 aisha-* aplikací).
  //
  // Nová vlastnost je opak: neznámá identita = STOP. Upstream ji deklaruje
  // stejně jako kdokoli jiný (`APP_NAME_PREFIX=aisha`).
  it("bez deklarace ODMÍTÁ hádat, čí aplikace to jsou", () => {
    delete process.env.APP_NAME_PREFIX;
    expect(() => appPrefix()).toThrow(/APP_NAME_PREFIX není deklarovaný/);
    expect(() => toStoryApp("aisha-core")).toThrow(/APP_NAME_PREFIX není deklarovaný/);
  });

  it("upstream se deklaruje stejně jako fork", () => {
    process.env.APP_NAME_PREFIX = "aisha";
    expect(appPrefix()).toBe("aisha");
    expect(toStoryApp("aisha-core")).toBe("aisha-core");
  });

  it("remaps upstream app names to this deploy's prefix", () => {
    process.env.APP_NAME_PREFIX = "acme";
    expect(toStoryApp("aisha-core")).toBe("acme-core");
    expect(stripStoryPrefix("acme-core")).toBe("core");
  });

  it("leaves non-aisha names alone (safe over mixed arrays)", () => {
    process.env.APP_NAME_PREFIX = "acme";
    expect(toStoryApp("registry-cache")).toBe("registry-cache");
    expect(toStoryApp(undefined)).toBe(undefined);
  });

  it("honours an explicitly passed env object", () => {
    process.env.APP_NAME_PREFIX = "acme";
    // explicit env overrides the ambient prefix
    expect(toStoryApp("aisha-core", { APP_NAME_PREFIX: "beta" })).toBe("beta-core");
  });

  // REGRESSION (2026-07-16): Array.map passes (element, INDEX, array), so a bare
  // `.map(toStoryApp)` bound `env` to a NUMBER — appPrefix read APP_NAME_PREFIX off
  // `0`, got undefined, and fell back to "aisha". aisha-redeploy.mjs remapped its
  // wave DAG that way, so on a fork every wave logged "(no targets)" and not a single
  // container deployed; the downstream Keycloak/NetBird smokes then failed on services
  // nothing had brought up. Invisible upstream, where the no-op looks correct.
  it("survives being used directly as a .map() callback (index-as-env)", () => {
    process.env.APP_NAME_PREFIX = "acme";
    expect(["aisha-registry", "aisha-core", "aisha-edge"].map(toStoryApp)).toEqual([
      "acme-registry",
      "acme-core",
      "acme-edge",
    ]);
    expect(["acme-core", "acme-edge"].map(stripStoryPrefix)).toEqual(["core", "edge"]);
  });

  it("ignores a non-object env instead of silently yielding the upstream prefix", () => {
    process.env.APP_NAME_PREFIX = "acme";
    for (const bogus of [0, 1, "prod", true, null]) {
      expect(appPrefix(bogus)).toBe("acme");
    }
  });
});
