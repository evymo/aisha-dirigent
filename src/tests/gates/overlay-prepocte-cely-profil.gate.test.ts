/**
 * Po výměně identity overlayem se profil appky přepočítá CELÝ — ne opisem.
 *
 * ⛔ PROČ TAHLE BRÁNA VZNIKLA (2026-09-23). `instance-overlay-apply.sh` měl blok
 * „přepočet identity patří sem", který po výměně `version.json` přepočítával
 * VYJMENOVANÉ proměnné (`XCODE_NAME`, `APP_VERSION`, `BUILD_NUMBER`). 22. 9.
 * přibyly do `app-profile.sh` nativní schopnosti (`AISHA_SKIP_*` z
 * `brand.nativniSchopnosti`) — a do výčtu se nedopsaly.
 *
 * ⭐ NEJDE POZNAT Z BĚHU. Build byl zelený a dokonce vypsal správnou hlášku
 * „značka vyřazuje nativní schopnosti: hovory OCR grafy" — jenže v PODPROCESU
 * prebuildu. Gradle zdědil prostředí z `build-android.sh`, kde se profil načetl
 * na ř. 27 z PLATFORMNÍHO `version.json`, a slinkoval všechno. Vada byla vidět
 * až na artefaktu: řidič 1.1.0 (14) měl 89,6 MB místo ~50 MB a o čtyři nativní
 * knihovny víc než verze na tabletech (WebRTC, ML Kit OCR, Skia, noise).
 *
 * Co se tu drží:
 *   1. CHOVÁNÍ: profil načtený podruhé nad jiným `version.json` přepočítá
 *      schopnosti — to je mechanismus, na kterém oprava stojí (`${X:-…}` bere
 *      prázdnou hodnotu z prvního načtení jako nenastavenou).
 *   2. Hodnota, kterou volající nastavil SÁM, vyhrává i při druhém načtení.
 *   3. POŘADÍ: overlay načítá profil znovu AŽ PO výměně `version.json`.
 *      (Overlay celý nespouštíme — přegenerovává motiv ze značky a potřebuje
 *      tokeny; skutečný důkaz end-to-end je velikost a knihovny artefaktu.)
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const KOREN = path.resolve(__dirname, "..", "..", "..");
const SKRIPTY = path.join(KOREN, "mobile-app", "scripts");

let docasne: string[] = [];
afterEach(() => {
  for (const d of docasne) rmSync(d, { force: true, recursive: true });
  docasne = [];
});

/** Minimální profil, který `app-profile.sh` přijme (bez `xcodeName` skončí). */
function verze(nativniSchopnosti?: Record<string, boolean>): string {
  return JSON.stringify({
    version: "1.0.0",
    build: 1,
    brand: { xcodeName: "TestApp", slug: "test-app", ...(nativniSchopnosti ? { nativniSchopnosti } : {}) },
  });
}

/**
 * Načte profil nad PLATFORMNÍM version.json (bez deklarace), pak přepne
 * `AISHA_APP_VERSION_FILE` na instanční a načte ho ZNOVU — přesně to, co teď
 * dělá overlay. Vrátí AISHA_SKIP_* po druhém načtení.
 */
function dvaNacteni(prostredi: Record<string, string> = {}): string {
  const koren = mkdtempSync(path.join(os.tmpdir(), "profil-dvakrat-"));
  docasne.push(koren);
  mkdirSync(path.join(koren, "scripts"), { recursive: true });
  cpSync(path.join(SKRIPTY, "app-profile.sh"), path.join(koren, "scripts", "app-profile.sh"));
  writeFileSync(path.join(koren, "version.json"), verze());
  const instancni = path.join(koren, "instance-version.json");
  writeFileSync(instancni, verze({ hovory: false, ocrVZarizeni: false, grafy: false }));

  const skript = `
    set -e
    SCRIPT_DIR="${koren}/scripts"; PROJECT_DIR="${koren}"
    . "$SCRIPT_DIR/app-profile.sh" >/dev/null
    PRVNI="$AISHA_SKIP_LIVEKIT|$AISHA_SKIP_MLKIT|$AISHA_SKIP_SKIA"
    export AISHA_APP_VERSION_FILE="${instancni}"
    . "$SCRIPT_DIR/app-profile.sh" >/dev/null
    echo "$PRVNI>$AISHA_SKIP_LIVEKIT|$AISHA_SKIP_MLKIT|$AISHA_SKIP_SKIA"
  `;
  return execFileSync("bash", ["-c", skript], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...prostredi },
  }).trim();
}

describe("overlay přepočte celý profil appky", () => {
  it("druhé načtení nad instančním version.json přepočítá nativní schopnosti", () => {
    // Před přepnutím: platformní profil nic nevyřazuje. Po přepnutí: všechny tři.
    expect(dvaNacteni()).toBe("||>1|1|1");
  });

  it("hodnota nastavená volajícím vyhrává i při druhém načtení", () => {
    // Volající si vynutil linkování hovorů — značka ho nesmí přebít.
    expect(dvaNacteni({ AISHA_SKIP_LIVEKIT: "0" })).toBe("0||>0|1|1");
  });

  it("overlay načítá profil znovu AŽ PO výměně version.json", () => {
    const overlay = readFileSync(path.join(SKRIPTY, "instance-overlay-apply.sh"), "utf8").split("\n");
    const bezKomentaru = overlay.map((r) => (/^\s*#/.test(r) ? "" : r));
    const vymena = bezKomentaru.findIndex((r) => /cp\s+"\$OV_VERSION"\s+"\$VERSION_FILE"/.test(r));
    const nacteni = bezKomentaru
      .map((r, i) => (/^\s*\.\s+"\$SCRIPT_DIR\/app-profile\.sh"/.test(r) ? i : -1))
      .filter((i) => i >= 0);

    expect(vymena, "overlay už nevyměňuje version.json — brána měří neexistující krok").toBeGreaterThan(-1);
    expect(
      nacteni.some((i) => i > vymena),
      "overlay po výměně version.json profil znovu NENAČÍTÁ — odvozené údaje (např. AISHA_SKIP_*) " +
        "zůstanou z platformního version.json a gradle je zdědí. Viz hlavička téhle brány.",
    ).toBe(true);
  });
});
