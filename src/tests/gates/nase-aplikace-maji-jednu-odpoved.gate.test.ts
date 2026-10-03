/**
 * Brána: „které aplikace jsou NAŠE" je jedna otázka s jednou odpovědí
 *
 * ⛔ NAMĚŘENO 2026-08-16 živě. Doktor si flotilu vybíral podle `name` s prefixem
 * `aisha` a napočítal 33 aplikací. `coolify-sync-envs.sh`, který se ptá podle
 * PROJEKTU, jich obsloužil 32. Ten rozdíl vypadal jako díra v syncu — a nebyl:
 *
 *     aisha-registry  rkkwkksw08c4g8s4ocs4ws4w  projekt a1sh4   ← CIZÍ nájemník
 *     aisha-registry  wyotm8kdmc2rjf3nuckg2kqx  projekt aisha   ← naše
 *
 * Coolify je multi-tenant a prefix jména si může zvolit kdokoli. Následky byly
 * dva, oba tiché:
 *
 *   1. čísla doktora sčítala cizí expozici s naší — „aisha-registry: 80
 *      tajemství v buildu" byl cizí případ, který se v našem souhrnu tvářil
 *      jako náš nejhorší a nedařilo se ho opravit. Po správném rozsahu má náš
 *      projekt 141 hodnot navíc a 32 tajemství, ne 384 a 112;
 *   2. doktor přitom četl env metadata cizího nájemníka přes API — to není
 *      jen špatné počítání, to je zbytečný dosah na cizí data.
 *
 * INVARIANT: identita je PROJEKT (+ prostředí), ne prefix jména. Odpověď má
 * JEDEN domov (`scripts/lib/coolify-our-apps.sh`) a ten při nemožnosti zjistit
 * rozsah vrací NIC a hlásí to — nikdy tichou náhradu za jméno.
 *
 * Je to táž vada jako verdikt „žije to" se čtyřmi domovy (#168): dvě místa se
 * ptala na totéž a odpovídala si jinak. Rozdíl si nikdo nevšiml, protože se
 * ta dvě čísla nikdy nepotkala vedle sebe.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import * as path from "node:path";

const ROOT = process.cwd();
const DOMOV = path.join(ROOT, "scripts/lib/coolify-our-apps.sh");

/** Řádky bez komentářů — zmínka v poznámce není zapojení. */
const kod = (text: string) => text.split("\n").filter((r) => !/^\s*#/.test(r)).join("\n");

/**
 * ⛔ NAMĚŘENO 2026-08-16: 4 místa si ještě vybírala flotilu podle prefixu jména
 * (cold-start ×2, sync-envs vnitřní filtr nad UŽ zúženou množinou, resolve-uuid).
 * 2026-09-13: cold-start ×2 pryč — souhrn kroku 7 i kontrola existence aplikací
 * v kroku 3 se ptají projektu (coolify-project-scope), ne globálního seznamu.
 * Smí jen KLESAT. Nula by znamenala, že identitu nikde nesupluje jméno.
 */
const ROHATKA_VYBER_PODLE_JMENA = 2;

describe("brána: naše aplikace mají jednu odpověď", () => {
  it("domov odpovědi existuje a při nemožnosti zjistit rozsah MLČÍ NAHLAS", () => {
    expect(existsSync(DOMOV), "scripts/lib/coolify-our-apps.sh chybí").toBe(true);
    const domov = readFileSync(DOMOV, "utf8");
    expect(domov, "rozsah se musí brát z projektu, ne z prefixu").toMatch(
      /COOLIFY_PROJECT_UUID/,
    );
    expect(
      domov,
      "bez rozsahu se NESMÍ tiše sáhnout po jméně — musí to být hlášené selhání",
    ).toMatch(/return 1/);
    expect(
      domov,
      "prázdná odpověď API se nesmí tvářit jako „projekt nemá aplikace\"",
    ).toMatch(/NEZMĚŘENO/);
    // A samotný domov si nesmí pomoct prefixem jména — to by tu vadu vrátilo.
    expect(
      kod(domov),
      "domov sám nesmí vybírat podle prefixu jména — tím by obcházel vlastní pravidlo",
    ).not.toMatch(/startswith\(/);
  });

  it("doktor i sync se ptají TÉHOŽ domova", () => {
    for (const rel of ["scripts/cold-start-doctor.sh", "scripts/coolify-sync-envs.sh"]) {
      const text = kod(readFileSync(path.join(ROOT, rel), "utf8"));
      expect(text, `${rel} nepoužívá sdílený domov — dvě odpovědi na jednu otázku`).toMatch(
        /coolify_our_applications/,
      );
    }
  });

  it("doktor NEmíchá cizí nájemníky do svých čísel", () => {
    // Konkrétní regrese: fáze X iterovala `select(.name | startswith($p))` nad
    // celým /applications. Po opravě iteruje nad množinou z domova, která je
    // už zúžená projektem — žádný filtr podle jména tam nepatří.
    const doctor = kod(readFileSync(path.join(ROOT, "scripts/cold-start-doctor.sh"), "utf8"));
    const faze = doctor.slice(doctor.indexOf("should_run_phase X"));
    expect(
      faze,
      "fáze X nesmí vybírat aplikace podle prefixu jména — na sdíleném Coolify " +
        "to není identita a přičte cizí expozici k naší",
    ).not.toMatch(/select\(\.name \| startswith/);
  });

  it("duplicitní jméno se hledá UVNITŘ našeho projektu, ne napříč instalací", () => {
    const domov = readFileSync(DOMOV, "utf8");
    expect(domov, "chybí detekce duplicit").toMatch(/coolify_duplicate_app_names/);
    // Vstupem musí být UŽ zúžená množina — jinak by to hlásilo cizí jmenovce.
    const doctor = kod(readFileSync(path.join(ROOT, "scripts/cold-start-doctor.sh"), "utf8"));
    expect(
      doctor,
      "duplicity se musí hledat nad množinou z domova (`$_apps`), ne nad /applications",
    ).toMatch(/coolify_duplicate_app_names "\$_apps"/);
  });

  it("doktor zná ZÁMĚR běhu — nebrání operaci, která tu vadu odstraní", () => {
    // ⛔ NAMĚŘENO 2026-08-16: doktor blokoval `--wipe` kvůli DVĚMA aplikacím
    // téhož jména. Jenže `wipe_orphan_apps` smaže VŠECHNY aplikace projektu a
    // manifest založí právě jednu — ta duplicita je tedy popis výchozího stavu,
    // ne překážka běhu. Fail-closed na podmínku, kterou právě spuštěná operace
    // ruší; táž třída jako „fail-closed musí respektovat pozici ve vlně".
    const doctor = readFileSync(path.join(ROOT, "scripts/cold-start-doctor.sh"), "utf8");
    const coldStart = readFileSync(path.join(ROOT, "scripts/aisha-cold-start.sh"), "utf8");

    expect(kod(doctor), "doktor musí umět přijmout záměr běhu").toMatch(/--wipe-planned/);
    expect(
      kod(coldStart),
      "cold-start musí svůj záměr PŘEDAT — jinak je příznak jen napsaný, ne zapojený",
    ).toMatch(/--wipe-planned/);
    expect(
      kod(coldStart),
      "předává se JEN při skutečném wipu, ne vždy",
    ).toMatch(/\[ "\$WIPE" = "1" \].*--wipe-planned/);

    // HRANICE: úleva platí jen pro nálezy uvnitř NAŠEHO projektu. Kolize aliasů
    // s CIZÍM nájemníkem musí zůstat blokující i s wipem — náš wipe na cizí
    // projekt nesahá, takže po něm bude ta kolize pořád tam.
    const faze = kod(doctor).slice(kod(doctor).indexOf("WIPE_PLANNED"));
    const kolize = faze.slice(faze.indexOf("nárokuje víc kontejnerů") - 400);
    expect(
      kolize.slice(0, 600),
      "kolize s cizím nájemníkem se NESMÍ zmírnit podle záměru wipu",
    ).not.toMatch(/WIPE_PLANNED/);
  });

  it("rohatka: výběr flotily podle prefixu jména smí jen KLESAT", () => {
    const soubory: string[] = [];
    for (const dir of ["scripts", "scripts/lib"]) {
      for (const f of readdirSync(path.join(ROOT, dir))) {
        if (/\.(sh|mjs)$/.test(f)) soubory.push(path.join(dir, f));
      }
    }
    const nalezy: string[] = [];
    for (const rel of soubory) {
      if (rel.endsWith("coolify-our-apps.sh")) continue;
      const radky = readFileSync(path.join(ROOT, rel), "utf8").split("\n");
      radky.forEach((r, i) => {
        if (/^\s*#/.test(r)) return;
        if (/select\(\.name \| startswith/.test(r)) nalezy.push(`${rel}:${i + 1}`);
      });
    }
    expect(
      nalezy.length,
      `Míst, kde jméno supluje identitu: ${nalezy.length} (rohatka ${ROHATKA_VYBER_PODLE_JMENA}).\n` +
        "Na sdíleném Coolify si prefix může zvolit kdokoli — takový výběr vtáhne\n" +
        "cizí nájemníky do našich čísel i do našich zápisů:\n  " + nalezy.join("\n  "),
    ).toBeLessThanOrEqual(ROHATKA_VYBER_PODLE_JMENA);
    expect(
      nalezy.length,
      `Kleslo na ${nalezy.length} — utáhni ROHATKA_VYBER_PODLE_JMENA, jinak brána\n` +
        "dovolí regresi zpátky.",
    ).toBeGreaterThanOrEqual(ROHATKA_VYBER_PODLE_JMENA);
  });
});
