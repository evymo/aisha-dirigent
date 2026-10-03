/**
 * `fmt` se nesmí kompilovat lokálním Clangem.
 *
 * ⛔ CO SE STALO. Podfile odvozuje OBĚ prebuilt cesty — `RCT_USE_RN_DEP`
 * (vendored C++: folly, glog, boost, fmt) i `RCT_USE_PREBUILT_RNCORE` (jádro) —
 * z jediné vlastnosti `ios.buildReactNativeFromSource`. Držíme ji na 'true'
 * kvůli dSYM, takže Podfile nenastaví ANI JEDNU. Plugin to dorovnával přes
 * `process.env`, jenže ta hodnota žije jen v procesu prebuildu: `pod install`
 * spuštěný ručně je jiný proces a nezdědí ji.
 *
 * NAMĚŘENO 2026-09-06 (Xcode 26.6): pět chyb `call to consteval function …
 * is not a constant expression` v `Pods/fmt/include/fmt/format-inl.h`. Pád byl
 * daleko od příčiny a vypadal jako vada fmt nebo Xcode.
 *
 * Tenhle test měří VÝSLEDEK úpravy Podfile, ne to, že se někde v pluginu
 * vyskytuje slovo `RCT_USE_RN_DEP` — zmínka v komentáři nebo v `console.log`
 * by test neuspokojila.
 */
import { zajistiRctUseRnDep } from "../../plugins/withBuildSettings.js";

const PODFILE_VZOR = [
  "require File.join(File.dirname(`node --print \"require.resolve('expo/package.json')\"`), \"scripts/autolinking\")",
  "platform :ios, podfile_properties['ios.deploymentTarget'] || '15.1'",
  "prepare_react_native_project!",
].join("\n");

describe("vendorované C++ se bere z hotových artefaktů", () => {
  it("do Podfile zapíše vynucení RCT_USE_RN_DEP", () => {
    const vysledek = zajistiRctUseRnDep(PODFILE_VZOR);
    expect(vysledek).not.toBeNull();
    expect(vysledek).toContain("ENV['RCT_USE_RN_DEP'] ||= '1'");
  });

  it("vynucení stojí PŘED čímkoli, co Podfile dělá", () => {
    // `pod install` čte Podfile shora dolů. Kdyby přiřazení stálo až za
    // `prepare_react_native_project!`, přišlo by pozdě.
    const vysledek = zajistiRctUseRnDep(PODFILE_VZOR) as string;
    const kdeEnv = vysledek.indexOf("ENV['RCT_USE_RN_DEP']");
    const kdePrvniPrikaz = vysledek.indexOf("require File.join");
    expect(kdeEnv).toBeGreaterThanOrEqual(0);
    expect(kdeEnv).toBeLessThan(kdePrvniPrikaz);
  });

  it("nechá původní obsah Podfile beze změny", () => {
    const vysledek = zajistiRctUseRnDep(PODFILE_VZOR) as string;
    expect(vysledek).toContain(PODFILE_VZOR);
  });

  it("je idempotentní — druhý běh už nic nepřidá", () => {
    const prvni = zajistiRctUseRnDep(PODFILE_VZOR) as string;
    expect(zajistiRctUseRnDep(prvni)).toBeNull();
  });

  it("používá `||=`, aby nepřebilo vlastní volbu vývojáře", () => {
    // Kdo si `RCT_USE_RN_DEP=0` nastaví sám, má na to mít právo — třeba když
    // ladí právě ten vendorovaný kód.
    const vysledek = zajistiRctUseRnDep(PODFILE_VZOR) as string;
    expect(vysledek).toMatch(/ENV\['RCT_USE_RN_DEP'\]\s*\|\|=/);
    expect(vysledek).not.toMatch(/ENV\['RCT_USE_RN_DEP'\]\s*=[^|]/);
  });
});
