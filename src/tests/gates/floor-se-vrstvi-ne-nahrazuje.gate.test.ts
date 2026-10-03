import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Build-time floor se VRSTVÍ, nenahrazuje.
 *
 * ⛔ NAMĚŘENO 2026-09-06: `vite.config.ts` četl `i18n.json` z JEDNOHO adresáře —
 * z `AISHA_INSTANCE_DIR`. Když je overlay přítomen, Dockerfile tam ukáže na
 * `/app/instances/_overlay`, takže `instances/_default/i18n.json` se nepoužil
 * VŮBEC. Byla to volba, ne sloučení.
 *
 * Stálo to takhle: doplnil jsem 32 platformních klíčů `app.mc.*` do `_default`
 * jako pojistku pro selhané načtení překladů z DB. Do RIQ, který overlay má, se
 * nedostal ANI JEDEN — a `t()` řeší `runtime[locale] ?? runtime[en] ??
 * floor[locale] ?? floor[en] ?? key`, takže při nedostupné DB by Mission Control
 * vykreslil SYROVÝ KLÍČ. Tedy horší stav než čeština, kterou ta práce nahradila.
 *
 * ⭐ PROČ VRSTVENÍ A NE KOPIE DO OVERLAYŮ. Opsat platformní klíče do každého
 * overlaye by udělalo druhého zapisovatele týchž slov: každý nový generický klíč
 * by se musel ručně roznést do všech instancí a kdo to zapomene, dostane syrové
 * klíče. Generické slovo má JEDEN domov; overlay říká jen to, co je jinak.
 *
 * ⭐ MĚŘÍ SE VLASTNOST, NE PRAVOPIS: brána netvrdí, jak se funkce jmenuje. Tvrdí,
 * že se čtou OBA slovníky a že overlay je v pořadí druhý (tedy vyhrává).
 *
 * Doloženo koncem řetězu (v commitu): shell postavený proti skutečnému RIQ
 * overlayi, který `app.mc.*` NEMÁ, nese po téhle změně v bundlu
 * `app.mc.colTask` — a zároveň dál `RIQ Investments` z overlaye.
 */
const ROOT = join(__dirname, "../../..");
const CONFIG = join(ROOT, "apps/workbench-shell/vite.config.ts");

describe("floor surface se vrství, nenahrazuje", () => {
  const src = readFileSync(CONFIG, "utf8");

  it("čte platformní bázi `instances/_default`, ne jen instanční adresář", () => {
    expect(
      src,
      "vite.config.ts nečte `instances/_default` — platformní klíče se do instance " +
        "s overlayem nedostanou a `t()` u nich při nedostupné DB vykreslí syrový klíč.",
    ).toMatch(/instances\/_default/);
  });

  it("slučuje OBA slovníky do jednoho floor", () => {
    // Dvě čtení nestačí: musí se potkat v jedné hodnotě, kterou dostane bundle.
    const cteni = [...src.matchAll(/readJson\(\s*path\.join\(\s*(\w+)\s*,\s*'i18n\.json'/g)].map(
      (m) => m[1],
    );
    expect(
      new Set(cteni).size,
      `i18n.json se čte z ${new Set(cteni).size} adresáře(ů): ${[...new Set(cteni)].join(", ")}. ` +
        "Vrstvení potřebuje DVA — platformní bázi a instanční overlay.",
    ).toBeGreaterThanOrEqual(2);
  });

  it("overlay PŘEBÍJÍ platformní bázi, ne naopak", () => {
    // Kdyby se pořadí otočilo, instance by ztratila vlastní znění (a `app.title`
    // by z „RIQ Investments" spadlo zpět na generické) — tichá regrese značky.
    const volani = src.match(/vrstven[^(]*\(\s*(\w+)\s*,\s*(\w+)\s*\)/);
    expect(volani, "nejde najít sloučení dvou slovníků").not.toBeNull();
    expect(
      volani![1].toLowerCase(),
      "první argument sloučení má být PLATFORMNÍ báze (přebíjí se, nepřebíjí)",
    ).toContain("platform");
    expect(
      volani![2].toLowerCase(),
      "druhý argument má být OVERLAY — ten vyhrává",
    ).toContain("overlay");
  });

  it("klíče začínající `_` nejsou jazyk (nesou prózu pro člověka)", () => {
    // `instances/_default/i18n.json` má `_note`. Bez téhle výjimky by se
    // z komentáře stal „jazyk" a jeho znaky by se vlily do bundlu.
    expect(
      src,
      "sloučení nepřeskakuje klíče začínající `_` — `_note` by se stalo jazykem",
    ).toMatch(/startsWith\('_'\)|startsWith\("_"\)/);
  });
});
