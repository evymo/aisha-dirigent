/**
 * Brána: co si mobilní build ČTE z prostředí, to mu někdo musí VYRÁBĚT.
 *
 * ⛔ NAMĚŘENO 2026-08-19 — build 1.0.11 (13) odešel do TestFlightu bez dveří:
 *
 *     zmínky EXPO_PUBLIC_KNOCK_* v build logu:  0
 *     soubory, které je nastavují:             žádný
 *
 * `mobile-app/src/config/knock.ts` je čte přes `Constants.expoConfig.extra`,
 * `app.config.ts` je z prostředí propouští, existují na ně testy — a NIKDO je
 * do prostředí nedával. `maDvere()` proto vrátilo false a appka nabídku klepání
 * vůbec nezobrazila. Táž třída jako `rebrand.mjs existuje a nikdo ho nevolá`:
 * artefakt vypadá dodaně, má testy, a nemá producenta.
 *
 * PROČ TO NEJDE POZNAT Z BUILDU
 * Chybějící hodnota se neprojeví pádem. `knock.ts` je zásadně nedosazuje (viz
 * jeho hlavička: uhodnutý `kid` je sůl odvození klíče, server mlčky odmítne),
 * takže se funkce jen SKRYJE. Build je zelený, appka nainstalovaná, a teprve
 * člověk u telefonu zjistí, že tam nabídka není — bez jediného vodítka proč.
 *
 * CO BRÁNA TVRDÍ
 * Pro každý klíč, který `app.config.ts` propouští z `process.env` do `extra`,
 * musí existovat alespoň jedno místo v repu, které ho do prostředí NASTAVUJE
 * (export / přiřazení v build skriptu). Univerzum si brána HLEDÁ v gitu, ne
 * vypisuje — nový `EXPO_PUBLIC_*` klíč se pod ni dostane bez zásahu.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const ROOT = join(__dirname, "../../..");

function souboryVGitu(vzor: RegExp): string[] {
  return execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf-8" })
    .split("\n")
    .filter((p) => vzor.test(p));
}

/** Klíče, které app.config.ts propouští z prostředí do `extra` — tedy co build KONZUMUJE. */
function konzumovaneKlice(): string[] {
  const cesta = join(ROOT, "mobile-app/app.config.ts");
  const obsah = readFileSync(cesta, "utf8");
  const klice = new Set<string>();
  for (const m of obsah.matchAll(/([A-Z][A-Z0-9_]*)\s*:\s*process\.env\.([A-Z][A-Z0-9_]*)/g)) {
    // Zajímá nás jméno v prostředí (pravá strana) — do `extra` se může mapovat jinak.
    if (m[2].startsWith("EXPO_PUBLIC_")) klice.add(m[2]);
  }
  return [...klice].sort();
}

/**
 * Klíče, které nějaký skript v repu do prostředí NASTAVUJE. Hledá se
 * PŘIŘAZENÍ nebo `export`, ne pouhá zmínka — `# viz EXPO_PUBLIC_X` v komentáři
 * není doručení a brána, která by ho uznala, by měřila pravopis.
 */
function vyrabeneKlice(): Map<string, string[]> {
  const kde = new Map<string, string[]>();
  for (const soubor of souboryVGitu(/\.(sh|mjs|js|ts|yml|yaml)$/)) {
    if (soubor.includes("/__tests__/") || soubor.includes("src/tests/")) continue;
    let obsah: string;
    try { obsah = readFileSync(join(ROOT, soubor), "utf8"); } catch { continue; }
    for (const m of obsah.matchAll(
      // `X=…`, `: "${X:=…}"` (shell default-assign), `export X`, `X: process.env…` NE
      /(?:^|\s|\{)(EXPO_PUBLIC_[A-Z0-9_]+)(?:=|:=)|export\s+((?:EXPO_PUBLIC_[A-Z0-9_]+\s*)+)/gm,
    )) {
      for (const j of [m[1], ...(m[2]?.trim().split(/\s+/) ?? [])].filter(Boolean)) {
        const seznam = kde.get(j as string) ?? [];
        if (!seznam.includes(soubor)) seznam.push(soubor);
        kde.set(j as string, seznam);
      }
    }
  }
  return kde;
}

describe("mobilní konfigurace musí mít producenta", () => {
  it("každý EXPO_PUBLIC_* klíč, který build konzumuje, někdo do prostředí nastavuje", () => {
    const konzumovane = konzumovaneKlice();
    const vyrabene = vyrabeneKlice();

    // Sonda musí doložit, že měřila — na OBOU stranách.
    expect(
      konzumovane.length,
      "app.config.ts nepropouští žádný EXPO_PUBLIC_* klíč — verdikt by nic neznamenal",
    ).toBeGreaterThan(3);
    expect(
      vyrabene.size,
      "žádný skript v repu nenastavuje EXPO_PUBLIC_* — verdikt by nic neznamenal",
    ).toBeGreaterThan(0);

    const bezProducenta = konzumovane.filter((k) => !vyrabene.has(k));

    // ⚠️ RATCHET, ne amnestie. Tyhle tři se ze SoT instance odvodit NEDAJÍ:
    // `SENTRY_ENV` je volba prostředí, `GOOGLE_CLOUD_PROJECT_NUMBER` patří k
    // Firebase účtu (žije v brandu vedle plistu), `BOOTSTRAP_URL` zatím nemá
    // v `.env.coolify` protějšek. Zůstávají v netrackovaném `mobile-app/.env`,
    // takže build z čistého stromu je nemá — což je dluh, ne stav v pořádku.
    // Seznam se smí jen ZKRACOVAT: cokoli nového pod bránu spadne.
    const ZNAMY_DLUH = new Set([
      "EXPO_PUBLIC_SENTRY_ENV",
      "EXPO_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER",
      "EXPO_PUBLIC_BOOTSTRAP_URL",
    ]);
    const nove = bezProducenta.filter((k) => !ZNAMY_DLUH.has(k));

    // Ratchet nesmí zrezivět: co se opravilo, musí ze seznamu zmizet, jinak by
    // dál kryl budoucí regresi téhož jména.
    const zbytecne = [...ZNAMY_DLUH].filter((k) => !bezProducenta.includes(k));
    expect(
      zbytecne,
      "Tyhle klíče už producenta MAJÍ — vyškrtni je ze ZNAMY_DLUH, jinak by\n" +
        "ratchet kryl jejich příští regresi.\n  " + zbytecne.join("\n  "),
    ).toEqual([]);

    expect(
      nove,
      "Klíč, který si build čte a nikdo mu ho nevyrábí, se do appky nedostane —\n" +
        "a protože `knock.ts` (a spol.) zásadně nedosazují výchozí hodnoty, funkce se\n" +
        "jen TIŠE SKRYJE. Build zelený, appka v TestFlightu, funkce chybí a nikde není\n" +
        "napsáno proč. Přesně takhle odešel build 13 bez dveří (naměřeno 2026-08-19).\n" +
        "Náprava: doplnit derivaci do mobile-app/scripts/build-ios.sh (blok\n" +
        "`Instance-env derivation`), a hodnotu vyrábět z instance — ne konstantou.\n  " +
        bezProducenta.join("\n  "),
    ).toEqual([]);
  });

  it("dveře se odvozují z JEDNOHO místa — build i roster berou týž kid a scope", () => {
    // ⛔ Kotva proti „opravě" tím, že se hodnoty dopíšou natvrdo do build skriptu.
    // `kid` je SŮL odvození klíče (`deriveFromPassword(kód, kid)`): kdyby ho build
    // a roster odvozovaly každý po svém, telefon by vyrobil jiné klíče, než server
    // čeká, a zaťukání by padalo na `unknown-kid` — tedy MLČENÍM, k nerozeznání
    // od zavřených dveří. Shoda musí plynout z konstrukce, ne ze shody dvou zápisů.
    const provision = readFileSync(join(ROOT, "scripts/knock-provision.mjs"), "utf8");
    // ⛔ NAMĚŘENO 2026-08-19: tady stála CESTA `mobile-app/scripts/build-ios.sh`.
    // Když se odvozování vytáhlo do `instance-env-derive.sh` (správný refaktor),
    // brána spadla — přestože vlastnost platila dál. Připnutá cesta měří, KDE to
    // je, ne ŽE to je. Univerzum se proto HLEDÁ mezi build skripty appky.
    const buildSkripty = execFileSync("git", ["ls-files", "mobile-app/scripts"], {
      cwd: ROOT, encoding: "utf-8",
    })
      .split("\n")
      .filter((f) => f.endsWith(".sh"))
      .map((f) => readFileSync(join(ROOT, f), "utf8"));
    expect(buildSkripty.length, "nenašel se ANI JEDEN build skript — brána osleplá").toBeGreaterThan(0);

    for (const klic of ["SPA_KNOCK_MOBILE_KID", "SPA_KNOCK_MOBILE_SCOPE", "SPA_KNOCK_PUBLIC_HOST"]) {
      expect(provision.includes(klic), `knock-provision.mjs neodvozuje ${klic}`).toBe(true);
      expect(
        buildSkripty.some((t) => t.includes(klic)),
        `žádný build skript nečte ${klic} z instance — hrozí, že si hodnotu appka dosadí sama`,
      ).toBe(true);
    }
    // Roster smí vyrábět JEDINÝ nástroj; druhá implementace by odvozovala klíče po svém.
    expect(
      provision.includes("knock-roster.mjs"),
      "knock-provision.mjs musí roster delegovat na knock-roster.mjs, ne odvozovat klíče sám",
    ).toBe(true);
  });
});
