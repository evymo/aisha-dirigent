import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * iOS a Android musí umět TÝŽ instanční vstup.
 *
 * ⛔ PROČ EXISTUJE — jeden den, ČTYŘI výskyty téže vady
 * 2026-09-04, při prvním Androidu appky pro řidiče. Pokaždé „iOS to umí,
 * Android ne", a pokaždé to prošlo bez povšimnutí, protože Android se prostě
 * tak dlouho nestavěl:
 *
 *   · `instance-env-derive.sh` volal jen iOS → Android padl na chybějící bráně
 *   · `.env.build.local` četl jen iOS → a bydlí v něm `AISHA_INSTANCE_ENV`
 *   · `AISHA_FIREBASE_*_FILE` znal jen iOS → APK by vzniklo BEZ Firebase
 *   · overlay (identita, ikona, BARVY) → APK v barvách PLATFORMY, ne instance
 *
 * ⭐ POSLEDNÍ DVĚ BY NEKŘIČELY. Build o barvách ani o Firebase nic netvrdí,
 * takže by se to poznalo až na zařízení v terénu — u appky, kterou má řidič
 * jako jediný nástroj.
 *
 * ⭐ MĚŘÍ SE VLASTNOST, NE SEZNAM. Brána nezná jména jednotlivých oprav; ptá
 * se, jestli obě platformy berou týž vstup. Nový instanční vstup je tedy
 * pokrytý sám od sebe — a to je smysl: seznam by zastaral, vlastnost ne.
 */
const ROOT = join(__dirname, "../../..");
const cti = (f: string) => readFileSync(join(ROOT, "mobile-app/scripts", f), "utf8");

/** Komentáře pryč — zmínka v textu není totéž co použití v kódu. */
const kod = (s: string) =>
  s.split("\n").filter((r) => !/^\s*#/.test(r)).join("\n");

const IOS = kod(cti("build-ios.sh"));
const ANDROID = kod(cti("build-android.sh"));

/** Sdílené skripty, které si platforma přitáhne `. "$SCRIPT_DIR/…"`. */
function sVolanymi(zdroj: string): string {
  let vse = zdroj;
  for (const m of zdroj.matchAll(/\.\s+"\$SCRIPT_DIR\/([a-z0-9-]+\.sh)"/g)) {
    try {
      vse += "\n" + kod(cti(m[1]));
    } catch {
      /* skript nemusí existovat — to řeší jiný test */
    }
  }
  return vse;
}

describe("iOS a Android si jsou rovny v instančních vstupech", () => {
  it("žádný AISHA_* vstup neumí jen jedna platforma", () => {
    const iosVse = sVolanymi(IOS);
    const androidVse = sVolanymi(ANDROID);

    const vstupy = (s: string) =>
      new Set([...s.matchAll(/AISHA_[A-Z_]+/g)].map((m) => m[0]));

    // Vstupy, které jsou z podstaty jednoplatformní — a MUSÍ být pojmenované,
    // ne mlčky vynechané: výjimka bez důvodu je díra, kterou nikdo nepřezkoumá.
    const JEN_IOS = new Set(["AISHA_FIREBASE_IOS_FILE"]);
    const JEN_ANDROID = new Set(["AISHA_FIREBASE_ANDROID_FILE", "AISHA_ANDROID_ABI"]);

    const ios = vstupy(iosVse);
    const android = vstupy(androidVse);

    const chybiAndroidu = [...ios].filter((v) => !android.has(v) && !JEN_IOS.has(v)).sort();
    const chybiIosu = [...android].filter((v) => !ios.has(v) && !JEN_ANDROID.has(v)).sort();

    const nalezy = [
      ...chybiAndroidu.map((v) => `${v}: umí iOS, Android NE`),
      ...chybiIosu.map((v) => `${v}: umí Android, iOS NE`),
    ];
    expect(nalezy).toEqual([]);
  });

  it("overlay instance je JEDEN soubor, ne kopie v každé platformě", () => {
    // ⛔ Kopie by se rozešly — přesně jako build čísla (14 vs 24), když
    // identita bydlela na dvou místech.
    const chyby: string[] = [];
    for (const [jmeno, zdroj] of [["build-ios.sh", IOS], ["build-android.sh", ANDROID]] as [string, string][]) {
      if (!/instance-overlay-apply\.sh/.test(zdroj))
        chyby.push(`${jmeno} nevolá sdílený instance-overlay-apply.sh`);
      // Vlastní kopie pravidla se pozná podle toho, že si sama sahá na overlay.
      if (/OV_TOKENS=|OV_VERSION=/.test(zdroj))
        chyby.push(`${jmeno} má VLASTNÍ kopii overlay logiky místo sdíleného skriptu`);
    }
    expect(chyby).toEqual([]);
  });
});
