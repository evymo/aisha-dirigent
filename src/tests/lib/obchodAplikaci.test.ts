import { describe, expect, it } from "vitest";
import { obchodyKZobrazeni } from "@/lib/web/obchodAplikaci";
import { platformaNavstevnika } from "@/lib/zarizeni/platforma";

const UA = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  ipadOs: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
};

describe("obchod s aplikací podle zařízení návštěvníka", () => {
  it("rozezná iPhone, Android i iPad, který se hlásí jako Mac", () => {
    expect(platformaNavstevnika({ userAgent: UA.iphone })).toBe("ios");
    expect(platformaNavstevnika({ userAgent: UA.android })).toBe("android");
    expect(platformaNavstevnika({ userAgent: UA.ipadOs, maxTouchPoints: 5 })).toBe("ios");
    expect(platformaNavstevnika({ userAgent: UA.ipadOs, maxTouchPoints: 0 })).toBe("jina"); // Mac
    expect(platformaNavstevnika({ userAgent: UA.windows })).toBe("jina");
  });

  it("telefon dostane svůj obchod, počítač oba; chybějící odkaz se nenabídne", () => {
    const oba = { ios: "https://apps.apple.com/x", android: "https://play.google.com/x" };
    expect(obchodyKZobrazeni("ios", oba)).toEqual(["ios"]);
    expect(obchodyKZobrazeni("android", oba)).toEqual(["android"]);
    expect(obchodyKZobrazeni("jina", oba)).toEqual(["ios", "android"]);
    expect(obchodyKZobrazeni("android", { ios: "https://apps.apple.com/x" })).toEqual(["ios"]);
    expect(obchodyKZobrazeni("jina", { ios: " ", android: "" })).toEqual([]);
  });
});
