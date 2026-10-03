import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * E2e scénáře musí spouštět TU appku, kterou stavíme.
 *
 * ⛔ NAMĚŘENO 2026-09-04. Všech pět scénářů mělo `appId: cz.id3a.aisha.app`
 * natvrdo — tedy PLATFORMNÍ aplikaci. My přitom stavíme `cz.riq.app`
 * a `cz.riq.ridic`. Testy tak nemohly NIKDY spadnout na naší appce, protože
 * ji nikdy nespustily.
 *
 * ⭐ Je to nejostřejší podoba třídy, kterou tenhle repo potkává pořád:
 * měřidlo, jehož univerzum míjí svět. Tady neměřilo ani ten správný PROGRAM —
 * a zelený běh přitom vypadal jako důkaz.
 *
 * ⭐ MĚŘÍ SE VLASTNOST: `appId` musí být DOSAZOVANÉ, ne literál. Brána nezná
 * jména našich balíčků; ptá se, jestli scénář o appce rozhoduje sám. Nová
 * appka je tím pokrytá bez zásahu.
 */
const ROOT = join(__dirname, "../../..");
const FLOWS = join(ROOT, "mobile-app/e2e/flows");

function vsechnySoubory(dir: string, vzor: RegExp): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? vsechnySoubory(join(dir, e.name), vzor)
      : vzor.test(e.name)
        ? [join(dir, e.name)]
        : [],
  );
}

function scenare(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? scenare(join(dir, e.name)) : e.name.endsWith(".yaml") ? [join(dir, e.name)] : [],
  );
}

describe("e2e testuje naši appku", () => {
  it("žádný scénář nemá bundle id natvrdo", () => {
    const nalezy: string[] = [];
    for (const f of scenare(FLOWS)) {
      const radek = readFileSync(f, "utf8")
        .split("\n")
        .find((r) => /^appId:/.test(r.trim()));
      if (!radek) {
        nalezy.push(`${f.replace(ROOT + "/", "")}: chybí appId`);
        continue;
      }
      // Literál = cokoli, co nedosazuje. `${...}` je dosazení.
      if (!/\$\{/.test(radek))
        nalezy.push(
          `${f.replace(ROOT + "/", "")}: ${radek.trim()} — bundle id natvrdo, ` +
            "takže scénář poběží proti JINÉ appce, než jakou stavíme",
        );
    }
    expect(nalezy).toEqual([]);
  });

  it("scénáře sahají jen na testID, které v appce OPRAVDU jsou", () => {
    // ⛔ Scénář odkazující na neexistující prvek je test, který nemůže projít —
    // a pozná se to až na simulátoru, tedy nejdráž. Brána to chytí ze zdroje.
    const zdroje = ["src/app", "src/components", "src/extranet"]
      .flatMap((d) => vsechnySoubory(join(ROOT, "mobile-app", d), /\.tsx?$/))
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    // ⛔ NEJEN `testID=`. Záložky je předávají jako `tabBarButtonTestID:`
    // v registru — první verze téhle brány je proto neviděla a hlásila, že
    // navigace nemá žádné háčky. Chyba byla v MĚŘIDLE, ne v appce
    // (naměřeno 2026-09-04).
    const existujici = new Set(
      [...zdroje.matchAll(/(?:testID|tabBarButtonTestID)\s*[=:]\s*\{?["'`]([^"'`]+)/g)].map(
        (m) => m[1],
      ),
    );
    // Dynamické testID (`step-card-${...}`) berou prefix — porovnává se s ním.
    const prefixy = [...existujici].map((t) => t.replace(/\$\{.*/, ""));

    const nalezy: string[] = [];
    for (const f of scenare(FLOWS)) {
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(/^\s*id:\s*([a-z0-9-]+)\s*$/gim)) {
        const id = m[1];
        if (!prefixy.some((p) => id === p || id.startsWith(p)))
          nalezy.push(`${f.replace(ROOT + "/", "")}: id \`${id}\` v appce není`);
      }
    }
    expect(nalezy).toEqual([]);
  });

  it("řidičova PRÁCE je pokrytá, ne jen přihlášení", () => {
    // ⛔ NAMĚŘENO 2026-09-04: e2e mělo login, logout a přepínání záložek —
    // tedy nic z toho, čím ta appka existuje. Předání dodávky, podpis a
    // odeslání jsou jediná cesta, kterou se práce odbaví; selhání tam znamená,
    // že řidič stojí u rampy.
    const vse = scenare(FLOWS).map((f) => readFileSync(f, "utf8")).join("\n");
    const chybi = ["kroky-podat-k-podpisu", "moment-podpisu", "kroky-submit"].filter(
      (id) => !vse.includes(id),
    );
    expect(chybi).toEqual([]);
  });

  it("runner appku ODVOZUJE z profilu a bez něj SE ZASTAVÍ", () => {
    const runner = readFileSync(join(ROOT, "mobile-app/e2e/scripts/run-e2e.sh"), "utf8")
      .split("\n")
      .filter((r) => !/^\s*#/.test(r))
      .join("\n");
    const chyby: string[] = [];
    if (!/bundleId/.test(runner)) chyby.push("runner nečte bundleId z profilu instance");
    // ⛔ NESTAČÍ „někde v souboru je exit 1". Runner jich má víc (třeba kontrola
    // Maestra), takže odebrání TÉ SPRÁVNÉ zastávky by bránu neshodilo — ověřeno
    // mutací 2026-09-04, kdy tenhle test mutaci PŘEŽIL. Měří se proto úsek od
    // rozhodnutí o profilu po jeho konec.
    const usek = runner.slice(runner.indexOf("PROFIL"), runner.indexOf("export APP_ID"));
    if (!usek) chyby.push("runner nemá úsek, kde se profil rozhoduje");
    else {
      const zastavek = (usek.match(/exit 1/g) ?? []).length;
      if (zastavek < 2)
        chyby.push(
          `úsek rozhodování o profilu má ${zastavek} zastávek, čekány 2 ` +
            "(chybí profil · profil neuvádí bundleId) — bez nich se hádané " +
            "bundle id promítne do testu cizí appky",
        );
    }

    expect(chyby).toEqual([]);
  });
});
