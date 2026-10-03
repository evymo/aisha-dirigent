/**
 * Release build nesmí zůstat podepsaný ladicím klíčem šablony.
 *
 * ⛔ CO SE STALO (NAMĚŘENO 2026-09-18). Šablona React Native dává release
 * buildu `signingConfig signingConfigs.debug` a nikdo to nepřepsal: APK Řidiče
 * neslo podpis `CN=Android Debug` — veřejný klíč, který má každý se šablonou.
 * Google Play takový build odmítne a mimo obchod ho může „aktualizovat" kdokoli.
 * `.env.build.example` přitom `ANDROID_KEYSTORE_*` vyjmenovával, jen je nikdo
 * nečetl.
 *
 * Test měří VÝSLEDNÝ `build.gradle`, ne to, že se v pluginu vyskytuje slovo.
 */
import { PROMENNE, ZNACKA, zapojReleasePodpis } from "../../plugins/withReleaseSigning.js";

/** Výřez `android/app/build.gradle`, jak ho vyrobí `expo prebuild` (Expo 54). */
const SABLONA = [
  "android {",
  "    signingConfigs {",
  "        debug {",
  "            storeFile file('debug.keystore')",
  "            storePassword 'android'",
  "            keyAlias 'androiddebugkey'",
  "            keyPassword 'android'",
  "        }",
  "    }",
  "    buildTypes {",
  "        debug {",
  "            signingConfig signingConfigs.debug",
  "        }",
  "        release {",
  "            // Caution! In production, you need to generate your own keystore file.",
  "            signingConfig signingConfigs.debug",
  "            minifyEnabled enableMinifyInReleaseBuilds",
  "        }",
  "    }",
  "}",
].join("\n");

function blok(gradle: string, zacatek: string): string {
  const i = gradle.indexOf(zacatek);
  let hloubka = 0;
  for (let j = gradle.indexOf("{", i); j < gradle.length; j++) {
    if (gradle[j] === "{") hloubka++;
    if (gradle[j] === "}" && --hloubka === 0) return gradle.slice(i, j + 1);
  }
  throw new Error(`blok ${zacatek} nemá konec`);
}

describe("release podpis z prostředí", () => {
  const vysledek = zapojReleasePodpis(SABLONA) as string;
  const buildTypes = blok(vysledek, "buildTypes {");
  const releaseBuild = blok(buildTypes, "release {");
  const debugBuild = blok(buildTypes, "debug {");

  it("release build vybere vlastní klíč, jakmile je v prostředí", () => {
    expect(releaseBuild).toContain(
      `signingConfig System.getenv('${PROMENNE.cesta}') ? signingConfigs.release : signingConfigs.debug`,
    );
    expect(releaseBuild).not.toMatch(/^\s*signingConfig signingConfigs\.debug\s*$/m);
  });

  it("signingConfigs.release čte všechny čtyři hodnoty z prostředí", () => {
    const podpis = blok(blok(vysledek, "signingConfigs {"), "release {");
    for (const jmeno of Object.values(PROMENNE)) {
      expect(podpis).toContain(`System.getenv('${jmeno}')`);
    }
  });

  it("⛔ do souboru se nepíše žádné heslo ani cesta — jen čtení z prostředí", () => {
    const podpis = blok(blok(vysledek, "signingConfigs {"), "release {");
    expect(podpis).not.toMatch(/storePassword\s+'/);
    expect(podpis).not.toMatch(/keyPassword\s+'/);
    expect(podpis).not.toMatch(/storeFile file\('/);
  });

  it("ladicí build se nemění", () => {
    expect(debugBuild).toContain("signingConfig signingConfigs.debug");
    expect(debugBuild).not.toContain("System.getenv");
  });

  it("druhý průchod prebuildu nic nezdvojí", () => {
    expect(zapojReleasePodpis(vysledek)).toBeNull();
    expect(vysledek.split(ZNACKA).length - 1).toBe(2);
  });

  it("⛔ šablona bez ladicího podpisu v release je výjimka, ne tiché pokračování", () => {
    const jina = SABLONA.replace(
      /(release \{[\s\S]*?)signingConfig signingConfigs\.debug/,
      "$1signingConfig signingConfigs.release",
    );
    expect(() => zapojReleasePodpis(jina)).toThrow(/šablona se změnila/);
  });

  it("⛔ build.gradle bez signingConfigs je výjimka", () => {
    expect(() => zapojReleasePodpis("android {\n    buildTypes {\n    }\n}")).toThrow(/signingConfigs/);
  });
});
