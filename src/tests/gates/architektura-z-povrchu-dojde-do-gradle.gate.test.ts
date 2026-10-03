/**
 * Architektura deklarovaná POVRCHEM musí dojít až do `gradle.properties`.
 *
 * ⛔ PROČ TAHLE BRÁNA VZNIKLA (2026-09-18). `post-prebuild-android.sh` četl
 * `$VERSION_FILE`, ale nikdo mu ho nenastavil: `app-profile.sh` ho vyváží jako
 * obyčejnou proměnnou a `build-android.sh` ten skript spouští jako PODPROCES.
 * Skript tedy grepoval prázdnou cestu, `ABI` vyšel prázdný a zvolila se větev
 * „povrch architekturu neuvedl" — přestože `surfaces/<fork>-ridic/version.json`
 * uvádí `brand.androidAbi: arm64-v8a`.
 *
 * ⭐ NEJDE POZNAT Z BĚHU. Build je zelený, hláška zní jako legitimní stav
 * („nechávám, jak je dal generátor") a vada je vidět až na artefaktu:
 * naměřeno 258 MB APK, z toho 232 MB nativních knihoven se čtyřmi
 * architekturami — včetně x86 a x86_64, které na žádném tabletu neběží.
 * U řidičů na LTE je to zaplacená data za kód, který se nespustí.
 *
 * ⭐ MĚŘÍ SE VLASTNOST, NE TEXT: brána SPUSTÍ skutečný skript nad dočasným
 * projektem a přečte, co v `gradle.properties` zůstalo. Kontrola „soubor
 * sourcuje app-profile.sh" by prošla i tehdy, kdyby se cesta k profilu
 * rozešla podruhé jinudy.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const KOREN = path.resolve(__dirname, "..", "..", "..");
const SKRIPTY = path.join(KOREN, "mobile-app", "scripts");

/** Sada, kterou dává generátor Expo — tedy to, co se má zúžit. */
const GENERATOR = "armeabi-v7a,arm64-v8a,x86,x86_64";

let docasne: string[] = [];

afterEach(() => {
  for (const d of docasne) rmSync(d, { force: true, recursive: true });
  docasne = [];
});

/**
 * Dočasný projekt: kopie obou skriptů, `android/gradle.properties` po
 * generátoru a profil appky. Kopie proto, že skript si `PROJECT_DIR` odvozuje
 * z vlastního umístění a zapisuje vedle sebe — nad skutečným stromem by
 * přepsal rozdělaný build.
 */
function projekt(profil: Record<string, unknown>): { koren: string; gradle: string; verze: string } {
  const koren = mkdtempSync(path.join(os.tmpdir(), "abi-povrch-"));
  docasne.push(koren);
  mkdirSync(path.join(koren, "scripts"), { recursive: true });
  mkdirSync(path.join(koren, "android", "app"), { recursive: true });
  for (const s of ["post-prebuild-android.sh", "app-profile.sh"]) {
    cpSync(path.join(SKRIPTY, s), path.join(koren, "scripts", s));
  }
  const gradle = path.join(koren, "android", "gradle.properties");
  writeFileSync(
    gradle,
    ["org.gradle.jvmargs=-Xmx4g", "android.useAndroidX=true", `reactNativeArchitectures=${GENERATOR}`, "hermesEnabled=true"].join("\n") + "\n",
  );
  const verze = path.join(koren, "verze.json");
  // `xcodeName` nese KAŽDÝ skutečný povrch (identita appky má jeden zdroj) a
  // `app-profile.sh` bez něj build zastaví. Fixtura bez něj tedy neměřila
  // architekturu — umřela dřív, a brána byla červená od svého vzniku.
  writeFileSync(verze, JSON.stringify({ brand: { xcodeName: "testfork", ...profil } }, null, 2) + "\n");
  return { koren, gradle, verze };
}

function spust(koren: string, verze: string): string {
  return execFileSync("bash", [path.join(koren, "scripts", "post-prebuild-android.sh")], {
    encoding: "utf-8",
    env: { ...process.env, AISHA_APP_VERSION_FILE: verze },
  });
}

function architektury(gradle: string): string {
  const radek = readFileSync(gradle, "utf-8")
    .split("\n")
    .find((r) => r.startsWith("reactNativeArchitectures="));
  return radek?.slice("reactNativeArchitectures=".length) ?? "";
}

describe("architektura z povrchu dojde do gradle.properties", () => {
  it("povrch s `brand.androidAbi` sadu ZÚŽÍ — tohle je ta naměřená vada", () => {
    const { koren, gradle, verze } = projekt({ xcodeName: "Test", androidAbi: "arm64-v8a" });
    const vystup = spust(koren, verze);
    expect(architektury(gradle)).toBe("arm64-v8a");
    expect(vystup).toContain("arm64-v8a");
  });

  it("⛔ nezůstane tam emulátorová architektura — kvůli ní APK rostlo o stovky MB", () => {
    const { koren, gradle, verze } = projekt({ xcodeName: "Test", androidAbi: "arm64-v8a" });
    spust(koren, verze);
    expect(architektury(gradle)).not.toContain("x86");
  });

  it("povrch BEZ `brand.androidAbi` nechá sadu generátoru a řekne to", () => {
    const { koren, gradle, verze } = projekt({ xcodeName: "Test" });
    const vystup = spust(koren, verze);
    expect(architektury(gradle)).toBe(GENERATOR);
    expect(vystup).toContain("Povrch neuvádí");
  });

  it("povrch s jinou architekturou dostane přesně ji — hodnota se neodhaduje", () => {
    const { koren, gradle, verze } = projekt({ xcodeName: "Test", androidAbi: "armeabi-v7a,arm64-v8a" });
    spust(koren, verze);
    expect(architektury(gradle)).toBe("armeabi-v7a,arm64-v8a");
  });
});
