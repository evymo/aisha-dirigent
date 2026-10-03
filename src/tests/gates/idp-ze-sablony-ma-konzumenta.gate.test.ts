/**
 * Brána: federovaný provider deklarovaný v šabloně realmu musí mít KONZUMENTA.
 *
 * TŘÍDA VADY: konfigurace tvrdí stav, který nikdy nenastal. `ENABLE_GOOGLE_OAUTH`
 * i `ENABLE_APPLE_OAUTH` byly v SoT ZAPNUTÉ, šablona realmu oba providery
 * deklarovala, `docs/deploy/OAUTH_PROVIDERS.md` popisoval celé nastavení —
 * a přihlašovací stránka nabízela JEN heslo.
 *
 * ⛔ NAMĚŘENO 2026-08-20: ty vlajky NIKDO V KÓDU NEČETL. Jediné výskyty byly
 * v dokumentaci a v `.env.coolify.example`. Zapnutá vlajka bez konzumenta je
 * horší než chybějící: chybějící si někdo všimne, zapnutá aktivně TVRDÍ, že
 * něco funguje — a udrží to, protože ji nic neměří. Majitel proto čekal, že
 * přihlášení Googlem je hotové.
 *
 * CO SE MĚŘÍ (vlastnost, ne pravopis): univerzum = aliasy `identityProviders`
 * v šabloně realmu. Ta se HLEDÁ, nevypisuje — nový provider se pod bránu
 * dostane bez zásahu. Pro každý alias musí existovat kód (mimo dokumentaci
 * a příklady), který jeho vlajku nebo pověření ČTE.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");
const SABLONA = "keycloak/aisha-realm.json";

/** Aliasy providerů — univerzum se HLEDÁ v šabloně. */
export function aliasyZeSablony(zdroj: string): string[] {
  const t = JSON.parse(zdroj) as { identityProviders?: Array<{ alias?: string }> };
  return (t.identityProviders ?? []).map((p) => p.alias).filter((a): a is string => !!a);
}

/**
 * Smí ten soubor VYRÁBĚT chování?
 *
 * ⭐ Jedno místo pravdy. Dřív filtroval jen `zivyKod()`, zatímco `bezKonzumenta`
 * dostávala `cesta` a NIKDY ji nepoužila — fixtura proto tvrdila „dokumentace
 * nepočítá", ale detektor to netvrdil a fixtura padala. Tvrzení o cestě patří
 * k detektoru, ne k tomu, kdo mu sype vstup.
 */
export function smiVyrabetChovani(cesta: string): boolean {
  if (/\.md$/.test(cesta)) return false; // dokumentace ten dojem právě vyrobila
  if (/\.example$/.test(cesta)) return false; // vzorové soubory nikdo nespouští
  // Brána sama sebe za konzumenta nepovažuje — jinak by stačilo ji napsat.
  if (cesta.endsWith("idp-ze-sablony-ma-konzumenta.gate.test.ts")) return false;
  return true;
}

/** Soubory, které smějí VYRÁBĚT chování — dokumentace a příklady nepočítají. */
function zivyKod(): string[] {
  return execFileSync("git", ["ls-files", "scripts", "services", "src"], { cwd: ROOT, encoding: "utf-8" })
    .split("\n")
    .filter(Boolean)
    .filter(smiVyrabetChovani);
}

/** Aliasy, jejichž vlajku ani pověření nikdo v živém kódu nečte. */
export function bezKonzumenta(aliasy: string[], soubory: Array<{ cesta: string; text: string }>): string[] {
  const sirotci: string[] = [];
  for (const alias of aliasy) {
    const UP = alias.toUpperCase().replace(/-/g, "_");
    // Stačí, že kód pracuje s vlajkou NEBO s pověřením — obojí je konzumace.
    const vzor = new RegExp(`ENABLE_${UP}_OAUTH|OAUTH_${UP}_CLIENT_(ID|SECRET)`);
    if (!soubory.some((s) => smiVyrabetChovani(s.cesta) && vzor.test(s.text))) sirotci.push(alias);
  }
  return sirotci;
}

describe("federovaný provider ze šablony má konzumenta", () => {
  test("detektor pozná tvar, kvůli kterému brána vznikla", () => {
    const aliasy = ["google", "apple"];
    // Přesně stav do 2026-08-20: jen dokumentace, žádný kód. Musí padnout OBA —
    // právě tohle je tvrzení, kvůli kterému brána vznikla.
    expect(bezKonzumenta(aliasy, [{ cesta: "docs/x.md", text: "ENABLE_GOOGLE_OAUTH=true" }]))
      .toEqual(["google", "apple"]);
    // A totéž pro `.example` — druhé místo, kde ta vlajka tehdy svítila.
    expect(bezKonzumenta(["google"], [{ cesta: ".env.coolify.example", text: "ENABLE_GOOGLE_OAUTH=true" }]))
      .toEqual(["google"]);
    // Konzument vlajky stačí.
    expect(bezKonzumenta(["google"], [{ cesta: "scripts/a.sh", text: 'ENABLE_GOOGLE_OAUTH' }])).toEqual([]);
    // Konzument pověření taky.
    expect(bezKonzumenta(["apple"], [{ cesta: "scripts/a.sh", text: 'OAUTH_APPLE_CLIENT_SECRET' }])).toEqual([]);
    // Pomlčka v aliasu → podtržítko v proměnné.
    expect(bezKonzumenta(["sign-in"], [{ cesta: "s.sh", text: "OAUTH_SIGN_IN_CLIENT_ID" }])).toEqual([]);
  });

  test("univerzum není prázdné — jinak brána neměří nic", () => {
    const a = aliasyZeSablony(readFileSync(join(ROOT, SABLONA), "utf-8"));
    expect(
      a.length,
      `${SABLONA} neuvádí ŽÁDNÝ identityProvider — buď se změnil tvar šablony, ` +
        "nebo se rozbilo její čtení; brána by tiše prošla nad prázdnem",
    ).toBeGreaterThan(0);
  });

  test("každý provider ze šablony má v živém kódu konzumenta", () => {
    const aliasy = aliasyZeSablony(readFileSync(join(ROOT, SABLONA), "utf-8"));
    const soubory = zivyKod().map((c) => ({ cesta: c, text: readFileSync(join(ROOT, c), "utf-8") }));
    const sirotci = bezKonzumenta(aliasy, soubory);
    expect(
      sirotci,
      "šablona realmu ten provider deklaruje, ale jeho vlajku ani pověření nikdo v kódu NEČTE.\n" +
        "Zapnutá vlajka bez konzumenta tvrdí, že přihlášení funguje — a udrží to, protože ji nic\n" +
        "neměří. Přesně tak se 2026-08-20 ukázalo, že Google i Apple byly „zapnuté\" a přihlašovací\n" +
        "stránka nabízela jen heslo.\n\n" +
        "CO S TÍM: buď providera obsluž (viz fáze identity providerů v `scripts/instance-rollout.sh`,\n" +
        "která podobu bere ZE ŠABLONY a pověření z prostředí), nebo ho ze šablony odstraň.\n" +
        "NEDĚLEJ: nepřidávej výjimku a nespoléhej na dokumentaci — `.md` a `.example` se sem\n" +
        "úmyslně nepočítají, protože právě ony ten dojem vytvořily.\n\n" +
        "BEZ KONZUMENTA:\n  " + sirotci.join("\n  "),
    ).toEqual([]);
  });

  // ── Pověření musí přežít wipe ───────────────────────────────────────────────
  //
  // ⛔ NAMĚŘENO 2026-08-20, hodinu po zprovoznění Googlu i Applu: vlajky
  // `ENABLE_GOOGLE_OAUTH` / `ENABLE_APPLE_OAUTH` v heredocu cold-startu BYLY,
  // ale ANI JEDNO pověření tam nebylo. Hodnoty žily jen v `.env.coolify`, kam
  // je někdo dopsal. Soubor vypadal správně a všechno fungovalo — jenže
  // `.env.coolify` je GENEROVANÝ ARTEFAKT: wipe ho staví heredocem od nuly.
  //
  // Po wipu by tedy zbyla přesně ta výchozí vada: vlajka svítí, za ní prázdno,
  // přihlašovací stránka nabízí jen heslo. A vypadalo by to jako regrese
  // právě dokončené práce.
  //
  // Univerzum se HLEDÁ dvakrát: aliasy ze šablony realmu, a u aliasu, jehož
  // secret se razí, i klíče, které si raznice sama vyžádá (`--required-env`).
  // Ruční seznam by spolkl přesně to, co v něm chybí.
  test("pověření každého providera přežije wipe", () => {
    const COLD_START = "scripts/aisha-cold-start.sh";
    const coldStart = readFileSync(join(ROOT, COLD_START), "utf-8");
    const spravovane = new Set(
      execFileSync("node", [join(ROOT, "scripts/generate-secrets.mjs"), "--print-keys"],
        { cwd: ROOT, encoding: "utf-8" }).split("\n").filter(Boolean),
    );

    const aliasy = aliasyZeSablony(readFileSync(join(ROOT, SABLONA), "utf-8"));
    const potrebne = new Set<string>();
    for (const alias of aliasy) {
      const UP = alias.toUpperCase().replace(/-/g, "_");
      potrebne.add(`OAUTH_${UP}_CLIENT_ID`);
      potrebne.add(`OAUTH_${UP}_CLIENT_SECRET`);
      // Razí-li se secret, potřebuje raznice další klíče — zeptáme se JÍ.
      const raznice = join(ROOT, `keycloak/mint-${alias}-secret.py`);
      if (existsSync(raznice)) {
        for (const k of execFileSync("python3", [raznice, "--required-env"], { encoding: "utf-8" })
          .split("\n").filter(Boolean)) potrebne.add(k);
      }
    }

    const chybi = [...potrebne].filter(
      (k) => !new RegExp(`^${k}=`, "m").test(coldStart) || !spravovane.has(k),
    );
    expect(
      chybi.sort(),
      "tenhle klíč federovaného přihlášení NEPŘEŽIJE wipe.\n\n" +
        `Musí být OBOJE: řádek \`KLIC=\${KLIC:-}\` v heredocu \`${COLD_START}\` (jinak ho\n` +
        "přegenerovaný `.env.coolify` neobsahuje) A `emit()` v `scripts/generate-secrets.mjs`\n" +
        "(jinak se hodnota nezachová a nedostane se ani do trezoru — `--print-keys` je\n" +
        "zdroj pravdy pro reverzní sync).\n\n" +
        "CO S TÍM: `emit('KLIC', preservedValue('KLIC'));` + řádek do heredocu vedle vlajek.\n" +
        "NEDĚLEJ: nedopisuj hodnotu rukou do `.env.coolify` — je to generovaný artefakt,\n" +
        "vypadá to hotově a wipe to smaže. Přesně tak tahle vada vznikla.\n\n" +
        "NEPŘEŽIJE WIPE:\n  " + chybi.join("\n  "),
    ).toEqual([]);
  });
});
