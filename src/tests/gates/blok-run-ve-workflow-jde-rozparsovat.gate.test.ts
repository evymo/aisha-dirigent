/**
 * Každý blok `run:` ve workflow se dá ROZPARSOVAT
 *
 * ── PRAVIDLO ──────────────────────────────────────────────────────────────────
 * `run:` je SHELLOVÝ KÓD. Před runnerem ho nikdo nespustí a žádný linter ho
 * nečte — syntaktická chyba se pozná až v běhu. U hlídky, která běží podle
 * rozvrhu, jen když se někdo podívá, PROČ je červená.
 *
 * ── PROČ (naměřeno 2026-10-03) ────────────────────────────────────────────────
 * Denní hlídka „každý připnutý obraz jde stáhnout“ byla červená od svého
 * založení: 7 běhů ze 7 v dohledné historii. Měření přitom prošlo —
 *     Souhrn: 65 obrazů · dostupných 65 · CHYBÍ 0 · NEZMĚŘENO 0
 * a hned za ním shell:
 *     unexpected EOF while looking for matching `"'
 * V řetězci v dvojitých uvozovkách stála typografická otevírací uvozovka a za
 * ní ASCII `"` jako koncová. Pro shell je ASCII uvozovka KONEC ŘETĚZCE; zbytek
 * řádku otevřel další řetězec a ten už nikdo nezavřel. Hlídka, která je červená
 * vždy, nehlásí nic: ztrátu obrazu by od překlepu nikdo neodlišil.
 *
 * ── CO SHELL SKUTEČNĚ DOSTANE ─────────────────────────────────────────────────
 * Brána nečte zdrojový text, ale to, co z YAMLu VYPADNE (skládané skaláry,
 * odsazení). Výrazy `${{ … }}` dosazuje runner PŘED shellem; brána je nahradí
 * neutrálním slovem — měří syntaxi bloku, ne hodnotu, kterou výraz za běhu
 * přinese.
 *
 * Shell, který brána změřit neumí, je NÁLEZ, ne mlčení: „přeskočeno“ by
 * vypadalo stejně jako „v pořádku“.
 */
import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { parse } from "yaml";

const ROOT = process.cwd();
const ADRESARE = [".forgejo/workflows", ".github/workflows"];

/** Shelly, jejichž syntaxi brána umí změřit: jméno ve workflow → čím se měří. */
const MERITELNE: Record<string, string> = { bash: "bash", sh: "sh" };

type Nalez = { soubor: string; uloha: string; krok: string; chyba: string };
type Blok = { soubor: string; uloha: string; krok: string; shell: string; kod: string };
type Krok = { name?: unknown; run?: unknown; shell?: unknown };
type Vychozi = { defaults?: { run?: { shell?: unknown } } };
type Uloha = Vychozi & { steps?: unknown };
type Workflow = Vychozi & { jobs?: Record<string, Uloha | null> };

/** Runner dosadí `${{ … }}` dřív, než blok dostane shell — jediná transformace. */
function jakToUvidiShell(kod: string): string {
  return kod.replace(/\$\{\{[\s\S]*?\}\}/g, "VYRAZ");
}

/** První slovo šablony shellu (`bash -e {0}` → `bash`); bez udání platí bash. */
function shellKroku(krok: Krok, uloha: Uloha, wf: Workflow): string {
  const s = krok.shell ?? uloha.defaults?.run?.shell ?? wf.defaults?.run?.shell ?? "bash";
  return String(s).trim().split(/\s+/)[0];
}

/** Bloky `run:` jednoho workflow tak, jak vypadnou z YAMLu; nečitelný YAML je nález. */
function blokyVeWorkflow(soubor: string, text: string): { bloky: Blok[]; nalezy: Nalez[] } {
  let wf: Workflow;
  try {
    wf = (parse(text) ?? {}) as Workflow;
  } catch (e) {
    return { bloky: [], nalezy: [{ soubor, uloha: "(celý soubor)", krok: "yaml", chyba: String(e).slice(0, 200) }] };
  }
  const bloky: Blok[] = [];
  for (const [uloha, def] of Object.entries(wf.jobs ?? {})) {
    const kroky = Array.isArray(def?.steps) ? (def.steps as Krok[]) : [];
    kroky.forEach((krok, i) => {
      if (typeof krok?.run !== "string") return;
      bloky.push({
        soubor,
        uloha,
        krok: typeof krok.name === "string" ? krok.name : `krok ${i + 1}`,
        shell: shellKroku(krok, def as Uloha, wf),
        kod: krok.run,
      });
    });
  }
  return { bloky, nalezy: [] };
}

/**
 * JEDEN podproces na celou dávku. Podproces na blok (235× z node) stál pod
 * zátěží 8,6 s — nad prahem lehké dráhy; smyčka v shellu je o řád levnější.
 * Přípona souboru je shell z MERITELNE (výčet v kódu, ne vstup z workflow).
 */
const DAVKA = 'for f in "$1"/*.bash "$1"/*.sh; do [ -e "$f" ] || continue; "${f##*.}" -n "$f" 2>"$f.err" || : >"$f.zle"; done';

/** Syntaktické nálezy nad bloky; shell, který brána změřit neumí, je nález taky. */
function zmer(bloky: Blok[]): Nalez[] {
  const nalezy: Nalez[] = [];
  const meritelne: Blok[] = [];
  for (const b of bloky) {
    if (MERITELNE[b.shell]) meritelne.push(b);
    else {
      const chyba = `shell „${b.shell}“ brána změřit neumí — doplň ho vědomě mezi měřitelné, nebo blok přepiš`;
      nalezy.push({ soubor: b.soubor, uloha: b.uloha, krok: b.krok, chyba });
    }
  }
  if (meritelne.length === 0) return nalezy;

  const dir = mkdtempSync(path.join(tmpdir(), "bloky-run-"));
  try {
    const cesta = (b: Blok, i: number) => path.join(dir, `${String(i).padStart(4, "0")}.${MERITELNE[b.shell]}`);
    meritelne.forEach((b, i) => writeFileSync(cesta(b, i), jakToUvidiShell(b.kod)));
    execFileSync("bash", ["-c", DAVKA, "davka", dir], { stdio: ["ignore", "ignore", "pipe"] });
    meritelne.forEach((b, i) => {
      const f = cesta(b, i);
      if (!existsSync(`${f}.zle`)) return;
      const prvni = readFileSync(`${f}.err`, "utf8").trim().split("\n")[0].replace(`${f}: `, "");
      nalezy.push({ soubor: b.soubor, uloha: b.uloha, krok: b.krok, chyba: prvni || `${MERITELNE[b.shell]} -n selhal` });
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return nalezy;
}

/** Jedno workflow od textu k nálezům — táž cesta pro strom i pro kotvu. */
function nalezyVeWorkflow(soubor: string, text: string): { nalezy: Nalez[]; prohlednuto: number } {
  const { bloky, nalezy } = blokyVeWorkflow(soubor, text);
  return { nalezy: [...nalezy, ...zmer(bloky)], prohlednuto: bloky.length };
}

describe("každý blok run: ve workflow se dá rozparsovat", () => {
  const soubory = ADRESARE.filter((d) => existsSync(path.join(ROOT, d))).flatMap((d) =>
    readdirSync(path.join(ROOT, d))
      .filter((f) => /\.ya?ml$/.test(f))
      .sort()
      .map((f) => `${d}/${f}`),
  );

  it("workflow se vůbec našly", () => {
    // Mlčení sondy je samo nálezem: po přesunu adresáře by brána „prošla“
    // s nulou prohlédnutých souborů.
    expect(soubory.length, "nenašlo se skoro ŽÁDNÉ workflow — brána neměří").toBeGreaterThan(5);
  });

  it("žádný blok run: nepadá na syntaxi", () => {
    const nalezy: Nalez[] = [];
    const bloky: Blok[] = [];
    for (const soubor of soubory) {
      const r = blokyVeWorkflow(soubor, readFileSync(path.join(ROOT, soubor), "utf8"));
      nalezy.push(...r.nalezy);
      bloky.push(...r.bloky);
    }
    nalezy.push(...zmer(bloky));
    const prohlednuto = bloky.length;

    // Kdyby se rozbil extraktor (jiný tvar kroků), prohlédnuto by kleslo k nule
    // a prázdný seznam nálezů by vypadal stejně jako čistý strom.
    expect(
      prohlednuto,
      "brána neprohlédla prakticky žádný blok — extraktor je rozbitý, ne strom čistý",
    ).toBeGreaterThan(100);

    expect(
      nalezy.map((n) => `${n.soubor} :: ${n.uloha} :: ${n.krok} → ${n.chyba}`),
      "Blok `run:` se nerozparsuje — úloha spadne až v runneru, a to i tehdy, když\n" +
        "příkazy před chybou doběhly v pořádku. Nejčastější příčina: ASCII uvozovka\n" +
        'uvnitř řetězce v dvojitých uvozovkách (typografická otevírací + `"` jako\n' +
        "koncová). Piš obě typografické, nebo řetězec uzavři do apostrofů.",
    ).toEqual([]);
  });
});

describe("kotva: rozbitý blok brána POZNÁ", () => {
  /** Nejmenší workflow s jedním krokem; `navic` jsou další klíče kroku. */
  const vzor = (blok: string, navic: string[] = []) =>
    [
      "name: vzor",
      "on: push",
      "jobs:",
      "  hlidka:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - name: Změřit",
      ...navic.map((r) => `        ${r}`),
      "        run: |",
      ...blok.split("\n").map((r) => `          ${r}`),
      "",
    ].join("\n");

  it("typografická otevírací uvozovka s ASCII koncovou = nález se jménem úlohy a kroku", () => {
    // Přesný tvar naměřené vady: měření nad chybou je v pořádku, padá až echo.
    const blok = 'rc=0\nif [ "$rc" -eq 2 ]; then echo "::warning::výsledek není „dostupné"."; fi';
    const { nalezy, prohlednuto } = nalezyVeWorkflow("vzor.yml", vzor(blok));
    expect(prohlednuto).toBe(1);
    expect(nalezy).toHaveLength(1);
    expect(nalezy[0]).toMatchObject({ soubor: "vzor.yml", uloha: "hlidka", krok: "Změřit" });
    expect(nalezy[0].chyba).toMatch(/unexpected EOF|unterminated|syntax error/i);
  });

  it("týž blok s oběma typografickými uvozovkami projde", () => {
    const blok = 'rc=0\nif [ "$rc" -eq 2 ]; then echo "::warning::výsledek není „dostupné“."; fi';
    expect(nalezyVeWorkflow("vzor.yml", vzor(blok))).toEqual({ nalezy: [], prohlednuto: 1 });
  });

  it("výraz runneru se nahradí dřív, než blok uvidí shell", () => {
    const blok = [
      "if [ \"${{ needs.a.result == 'success' && 'ano' || 'ne' }}\" = \"ano\" ]; then",
      "  echo \"nasazeno: ${{ needs.a.outputs.seznam || '(nic' }}\"",
      "fi",
      "POPIS=${{ toJSON(",
      "  github.event.head_commit.message) }}",
    ].join("\n");
    const videno = jakToUvidiShell(blok);
    expect(videno, "výraz zůstal v textu, který dostane shell").not.toContain("${{");
    expect(videno, "víceřádkový výraz se nenahradil celý").toContain("POPIS=VYRAZ");
    expect(nalezyVeWorkflow("vzor.yml", vzor(blok))).toEqual({ nalezy: [], prohlednuto: 1 });
  });

  it("shell, který brána změřit neumí, je nález — ne mlčení", () => {
    const { nalezy, prohlednuto } = nalezyVeWorkflow("vzor.yml", vzor('print("ahoj")', ["shell: python"]));
    expect(prohlednuto).toBe(1);
    expect(nalezy.map((n) => n.chyba).join("\n")).toContain("python");
  });

  it("výchozí shell úlohy i workflow se ctí (šablona `sh -e {0}` → sh)", () => {
    const wf = [
      "name: vzor",
      "on: push",
      "defaults:",
      "  run:",
      "    shell: python",
      "jobs:",
      "  hlidka:",
      "    runs-on: ubuntu-latest",
      "    defaults:",
      "      run:",
      "        shell: sh -e {0}",
      "    steps:",
      "      - run: echo ok",
      "",
    ].join("\n");
    // Výchozí shell úlohy (sh) má přednost před výchozím shellem workflow (python).
    expect(nalezyVeWorkflow("vzor.yml", wf)).toEqual({ nalezy: [], prohlednuto: 1 });
  });

  it("nečitelný YAML je nález, ne prázdný výsledek", () => {
    const { nalezy } = nalezyVeWorkflow("vzor.yml", "jobs:\n  a: [\n");
    expect(nalezy).toHaveLength(1);
    expect(nalezy[0].krok).toBe("yaml");
  });
});
