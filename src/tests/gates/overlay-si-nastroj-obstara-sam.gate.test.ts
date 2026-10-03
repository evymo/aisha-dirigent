/**
 * Brána: deklarovaný overlay si nástroj obstará SÁM (CLASS gate)
 *
 * ⛔ NAMĚŘENO 2026-09-20 při výpadku produkce. Overlay uměl získat JEDINÝ nástroj
 * (`aisha-cold-start.sh` → `_fetch_instance_overlay`); ostatní čtenáři topologie
 * čekali, že jim cestu předá operátor v `AISHA_INSTANCE_CONFIG_DIR`. Když v 04:49
 * UTC spadlo nasazení jádra a veřejné API instance vracelo 502, obnova naším
 * vlastním skriptem NEPROBĚHLA: `aisha-redeploy` zastavil env-doktor hláškou
 * „instance deklaruje vlastní overlay, ale AISHA_INSTANCE_CONFIG_DIR není
 * nastavená". Výpadek se prodloužil o dobu, než člověk doplnil proměnnou ručně.
 *
 * Deklarace bez plniče je ornament: `AISHA_INSTANCE_DATA_GIT_URL` říká, KDE
 * overlay leží, takže si ho nástroj má vzít.
 *
 * INVARIANT:
 *   1. deklarovaný overlay → cesta i BEZ `AISHA_INSTANCE_CONFIG_DIR`;
 *   2. proměnná zůstává PŘEBITÍM (když ukazuje na checkout, vyhraje);
 *   3. nedostupný deklarovaný overlay → výjimka, NIKDY šablona cizí instance;
 *   4. bez deklarace se nic neklonuje (komunitní instalace běží na šabloně).
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { envWithoutGitLocation } from "../../../scripts/lib/git-worktree-health.mjs";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const LIB = join(ROOT, "scripts", "lib", "instance-overlay.mjs");

/** Postaví lokální git repo, které hraje overlay instance (bez sítě). */
function overlayRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "overlay-zdroj-"));
  mkdirSync(join(dir, "profiles"), { recursive: true });
  writeFileSync(join(dir, "profiles", "znamka.txt"), "overlay instance\n");
  // ⛔ NAMĚŘENO 2026-09-20 v pre-pushi: `git add -A` tu padlo na „this operation
  // must be run in a work tree", přestože běželo v čerstvém dočasném repu.
  // Husky pouští hook s nastaveným `GIT_DIR`/`GIT_WORK_TREE`, a ty se dědí do
  // KAŽDÉHO potomka — takže git v dočasném adresáři mluvil o repu, který ho
  // spustil. Fixtura, která si nese prostředí volajícího, neměří sebe.
  const bezGitProstredi = envWithoutGitLocation();
  const git = (...a: string[]) =>
    execFileSync("git", a, { cwd: dir, encoding: "utf-8", env: bezGitProstredi });
  git("init", "--quiet", "-b", "main");
  git("config", "user.email", "gate@local");
  git("config", "user.name", "gate");
  git("add", "-A");
  git("commit", "--quiet", "-m", "overlay");
  return dir;
}

/** Zavolá knihovnu v ČISTÉM procesu — jen s proměnnými, které test deklaruje. */
function zavolej(env: Record<string, string>, vyraz: string): { out: string; err: string; rc: number } {
  const r = execFileSync(process.execPath, ["--input-type=module", "-e",
    `const m = await import(${JSON.stringify(LIB)});\n` +
    `try { console.log(String(${vyraz})); } catch (e) { console.log("CHYBA: " + e.message); }`,
  ], {
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", TMPDIR: process.env.TMPDIR ?? "", ...env },
    encoding: "utf-8",
  });
  return { out: r.trim(), err: "", rc: 0 };
}

describe("deklarovaný overlay si nástroj obstará sám", () => {
  test("bez proměnné, jen z deklarace — vrátí cestu s obsahem overlaye", () => {
    const zdroj = overlayRepo();
    const { out } = zavolej(
      { AISHA_INSTANCE_DATA_GIT_URL: `file://${zdroj}#main` },
      `m.overlayDirOrRequired("brána")`,
    );
    expect(out, "cesta se má vrátit i bez AISHA_INSTANCE_CONFIG_DIR").not.toBe("null");
    expect(out).not.toMatch(/^CHYBA/);
    const obsah = execFileSync("cat", [join(out, "profiles", "znamka.txt")], { encoding: "utf-8" });
    expect(obsah.trim(), "musí to být OBSAH deklarovaného overlaye").toBe("overlay instance");
  });

  test("proměnná zůstává přebitím — vyhraje předaný checkout", () => {
    const zdroj = overlayRepo();
    const jiny = mkdtempSync(join(tmpdir(), "overlay-rucni-"));
    const { out } = zavolej(
      { AISHA_INSTANCE_DATA_GIT_URL: `file://${zdroj}#main`, AISHA_INSTANCE_CONFIG_DIR: jiny },
      `m.overlayDirOrRequired("brána")`,
    );
    expect(out, "ruční deklarace operátora má přednost").toBe(jiny);
  });

  test("nedostupný deklarovaný overlay = výjimka, ne šablona", () => {
    const { out } = zavolej(
      { AISHA_INSTANCE_DATA_GIT_URL: "file:///neexistuje/aisha/nic.git#main" },
      `m.overlayDirOrRequired("brána")`,
    );
    expect(out, "fail-closed: cizí šablona není náhrada").toMatch(/^CHYBA/);
    expect(out, "hláška musí říct, KDO ho potřeboval").toContain("brána");
    expect(out, "a nesmí nést přihlašovací údaje").not.toMatch(/https?:\/\/[^@\s]+@/);
  });

  test("bez deklarace se nic neklonuje (komunitní instalace)", () => {
    const { out } = zavolej({}, `m.ziskejDeklarovanyOverlay("brána")`);
    expect(out).toBe("null");
  });

  /**
   * ⛔ OPRAVENO PO REVIZI 2026-09-20. První verze tohohle testu hledala vzor
   * `git (clone|fetch).*INSTANCE_DATA_GIT_URL` a byla PRÁZDNÁ KONTROLA: ten
   * vzor nesplňuje ani kanonický soubor sám (klonuje přes `execFileSync('git',
   * […])`, ne shellovým `git clone`), takže výsledek byl vždy prázdný a
   * vyloučení kanonického souboru bylo no-op. Měřila TVAR zápisu, ne vlastnost
   * — a obejít ji šlo i bez zlého úmyslu: stačilo psát kód stejně jako ona.
   *
   * Teď se měří VLASTNOST: soubor, který jmenuje deklaraci a zároveň umí
   * klonovat (jakýmkoli zápisem — shellové `git clone`, `klonuj` z git-klon.sh
   * i `execFileSync("git", …)`), JE domov overlaye.
   *
   * A měří se RÁČNOU, ne nulou, protože nula by byla lež. Domovy jsou dnes
   * ČTYŘI a leží ve DVOU běhových prostředích:
   *   · `scripts/lib/instance-overlay.mjs` — kanonický, pro nástroje v node;
   *   · `scripts/lib/instance-data-url.sh`, `scripts/vault-restore.sh`,
   *     `scripts/deploy/instance-data-hook.sh` — shell, z toho poslední běží
   *     UVNITŘ migračního kontejneru, kde na node knihovnu v repu nedosáhne.
   *
   * Ráčna smí jen KLESAT. Každý zbývající domov musí při nedostupném overlayi
   * SELHAT, ne pokračovat — druhé chování při selhání je ta vada, která
   * 2026-09-20 protáhla výpadek produkce a která tiše brala roster odjinud.
   */
  test("domovů overlaye nepřibývá a kanonický mezi nimi JE (ráčna)", () => {
    const RACNA = 4;
    const KANON = "scripts/lib/instance-overlay.mjs";
    // ⛔ VOLÁNÍ, NE ZMÍNKA. První měření napočítalo SEDM, protože se trefovalo
    // i do komentářů: `aisha-redeploy.mjs` má v poznámce „`git clone` overlay
    // repa", `aisha-cold-start.sh` v próze popisuje, co se klonuje, a
    // `aisha-env-doctor.mjs` volá `git remote` (což není klon). Text, který
    // POPISUJE kód, se tu použil jako kód — táž třída jako komentář v compose
    // čtený jako direktiva. Komentáře se proto odstraní a git přes spawn se
    // počítá jen tehdy, když v TÉMŽE volání stojí `clone` nebo `fetch`.
    //
    // ⛔ A DRUHÁ OPRAVA TÉHOŽ MĚŘIDLA: vzor vázaný na `execFileSync("git", […])`
    // NEVIDĚL ani kanonický soubor, protože ten si git volá přes vlastní
    // obálku `const git = (...a) => execFileSync("git", a)`. Chytila to až
    // kontrola univerza o pár řádků níž — přesně proto tam je. Měří se tedy
    // dvě nezávislé věci zvlášť: že soubor SPOUŠTÍ proces, a že v něm stojí
    // `clone`/`fetch` jako argument. Obálku to přežije, `git remote` ne.
    //
    // ⛔ A POTŘETÍ TÁŽ TŘÍDA: po odstranění komentářů zbyl v `aisha-cold-start.sh`
    // HLÁŠKA `err "… git clone selže (401 unauthorized) …"`. Text pro člověka
    // uvnitř řetězce není příkaz. Shell se proto měří na POZICI PŘÍKAZU
    // (začátek řádku, za `;`, `&&`, `|`, `$(`), ne kdekoli v textu.
    const KLON_SHELL = /(?:^|[;&|(]\s*|\$\(\s*)(?:git\s+(?:clone|fetch)\b|klonuj\s)|(?:^|\s)\.\s+\S*git-klon\.sh/m;
    const KLON_JS = /["'`](?:clone|fetch)["'`]/;
    const SPUSTI_JS = /execFileSync|spawnSync|execSync/;
    const KLONUJE = (t: string, shell: boolean) =>
      shell ? KLON_SHELL.test(t) : SPUSTI_JS.test(t) && KLON_JS.test(t);

    /** Text bez komentářů — zmínka v poznámce není zapojení. */
    const kod = (text: string, shell: boolean) =>
      (shell
        ? text.split("\n").filter((r) => !/^\s*#/.test(r))
        : text.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((r) => !/^\s*(\/\/|\*)/.test(r))
      ).join("\n");

    const soubory: string[] = [];
    (function chod(dir: string) {
      for (const jmeno of readdirSync(dir)) {
        if (jmeno === "node_modules") continue;
        const cesta = join(dir, jmeno);
        if (statSync(cesta).isDirectory()) chod(cesta);
        else soubory.push(cesta);
      }
    })(join(ROOT, "scripts"));

    const domovy = soubory
      .filter((f) => {
        const shell = /\.sh$/.test(f);
        const t = kod(readFileSync(f, "utf-8"), shell);
        return t.includes("AISHA_INSTANCE_DATA_GIT_URL") && KLONUJE(t, shell);
      })
      .map((f) => relative(ROOT, f))
      .sort();

    // Univerzum: kdyby měřidlo přestalo vidět i vlastní referenční kód, byla by
    // zelená jen tím, že se nedívá. Přesně tak selhala první verze.
    expect(
      domovy,
      "měřidlo osleplo — nevidí ani kanonický domov, takže nevidí nic",
    ).toContain(KANON);

    expect(
      domovy.length,
      `Domovů deklarovaného overlaye je ${domovy.length}, ráčna je ${RACNA}:\n` +
        domovy.map((d) => `  ${d}`).join("\n") +
        `\nNový domov znamená DRUHÉ chování při selhání. Snížit je vždy v pořádku; ` +
        `zvýšit jen s měřením a s důvodem, proč to v tom běhovém prostředí jinak nejde.`,
    ).toBeLessThanOrEqual(RACNA);
  });
});
