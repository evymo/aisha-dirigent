/**
 * Brána: výběr dotčených bran ZUŽUJE, a co nezná, to nezamlčí
 *
 * ⛔ PROČ ORÁKULUM A NE ČTENÍ KÓDU: táž třída mapy (změněné cesty → co spustit)
 * se v `.forgejo/workflows/ci.yml` zdokumentovaně spletla TŘIKRÁT — chyběly
 * `apps/`, pak `docker-compose*.yml` + `config/`, pak `packages/`. Pokaždé to
 * znamenalo, že „zelená znamenala NEMĚŘENO“: PR svítil zeleně s osmi běhy
 * z dvaceti sedmi. Mapa, kterou nikdo nespouští proti skutečným změnám, je
 * jen dobře míněný regex. Tahle brána proto selektor SPOUŠTÍ nad syntetickými
 * commity a měří jeho odpovědi.
 *
 * CO SE MĚŘÍ (vlastnost, ne vzorek):
 *   1. ZUŽUJE — známá změna vybere hrstku bran, ne celý strom. Selektor, který
 *      vždycky řekne „všechno“, je mrtvá váha a nikdo si toho nevšimne.
 *   2. FAIL-CLOSED — neznámá cesta vrátí VSE_LEHKE. Tohle je celé jádro:
 *      mlčky prohlásit neznámou cestu za nedotčenou je přesně ta chyba, která
 *      v CI vznikla třikrát.
 *   3. NEZKAZILA SE MAPA — každý vzor v mapě má ve stromu aspoň jeden soubor
 *      a každá jmenovaná brána existuje. Vzor, který přestal na cokoli sedět,
 *      tiše vypne kategorii.
 *
 * HRANICE UNIVERZA — brána NETVRDÍ ÚPLNOST, tedy že „žádná brána mimo
 * kategorii X nečte compose“. Pro 501 textových bran je to staticky
 * nedokazatelné a pokus by byl jen další špatný regex. Úplnost zaručuje PLNÝ
 * BĚH NA POZADÍ; výběr má být fail-closed a užitečný, nic víc.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { envWithoutGitLocation } from "../../../scripts/lib/git-worktree-health.mjs";
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const GATES = path.join(ROOT, "src/tests/gates");
const SELEKTOR = path.join(ROOT, "scripts/test/brany-dotcene.mjs");
const LANES = JSON.parse(readFileSync(path.join(GATES, "lanes.json"), "utf-8")) as {
  kategorie: Record<string, { zmenene: string[]; brany: string[] }>;
  ignorovat: { vzory: string[] };
};

/**
 * ⛔ ČISTÉ PROSTŘEDÍ. Hook exportuje GIT_DIR/GIT_INDEX_FILE a ty by prosákly do
 * dočasného repa, takže by se měřilo repo tohoto projektu. Týž důvod, jaký má
 * `zmena-sluzby-dosahne-na-svuj-stack`.
 */
const CISTE = envWithoutGitLocation();

/** Postaví dočasné git repo s jedním commitem měnícím dané cesty a zeptá se selektoru. */
function zeptejSe(cesty: string[]): { rezim: string; brany: string[]; neznameCesty: string[] } {
  const d = mkdtempSync(path.join(tmpdir(), "vyber-bran-"));
  const git = (...a: string[]) => execFileSync("git", a, { cwd: d, env: CISTE, encoding: "utf-8" });
  git("init", "-q");
  git("config", "user.email", "brana@test.invalid");
  git("config", "user.name", "brana");
  writeFileSync(path.join(d, "zaklad.txt"), "z\n");
  git("add", "-A");
  git("commit", "-qm", "zaklad");
  for (const c of cesty) {
    const p = path.join(d, c);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, "zmena\n");
  }
  git("add", "-A");
  git("commit", "-qm", "zmena");

  // Selektor čte lanes.json a strom bran z ROOT (cwd), ale rozsah změn z repa
  // v `d` — proto se pouští s cwd=d a s GIT_* vyčištěnými.
  const out = execFileSync(
    "node",
    [SELEKTOR, "--base=HEAD~1", "--head=HEAD"],
    { cwd: ROOT, env: { ...CISTE, GIT_DIR: path.join(d, ".git"), GIT_WORK_TREE: d }, encoding: "utf-8" },
  );
  return JSON.parse(out);
}

function vsechnyBrany(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...vsechnyBrany(p));
    else if (e.name.endsWith(".gate.test.ts")) out.push(p);
  }
  return out;
}

describe("výběr dotčených bran", () => {
  it("známá změna ZUŽUJE — vybere hrstku, ne celý strom", () => {
    const r = zeptejSe(["docker-compose.coolify-neco.yml"]);
    expect(r.rezim, "změna compose je v mapě, takže se nesmí padat na celou dráhu").toBe("vyber");
    expect(r.brany.length).toBeGreaterThan(0);
    expect(
      r.brany.length,
      "selektor, který vždycky řekne „všechno“, je mrtvá váha — a nikdo si toho nevšimne",
    ).toBeLessThan(vsechnyBrany(GATES).length / 4);
  });

  it("NEZNÁMÁ cesta padá na celou lehkou dráhu (fail-closed)", () => {
    const r = zeptejSe(["zbrusu/novy/adresar/soubor.txt"]);
    expect(
      r.rezim,
      "mlčky prohlásit neznámou cestu za nedotčenou je přesně ta chyba, která " +
        "v ci.yml vznikla třikrát — „zelená znamenala neměřeno“",
    ).toBe("VSE_LEHKE");
    expect(r.neznameCesty.join(" ")).toContain("zbrusu/novy/adresar/soubor.txt");
  });

  it("ignorovaná cesta nespustí nic a NEZPŮSOBÍ pád na celou dráhu", () => {
    const r = zeptejSe(["docs/nejaky-zapis.md"]);
    expect(r.rezim, "výčet ignorovaných je uzavřený a doložený — smí zůstat výběrem").toBe("vyber");
    expect(r.brany, "změna dokumentace nemá co spouštět").toEqual([]);
  });

  it("smíšená změna (známá + neznámá) je fail-closed — jedna neznámá stačí", () => {
    const r = zeptejSe(["docker-compose.coolify-neco.yml", "uplne/neznama/cesta.bin"]);
    expect(
      r.rezim,
      "částečná znalost není znalost: kdyby se neznámá cesta jen ignorovala, " +
        "výběr by tvrdil víc, než ví",
    ).toBe("VSE_LEHKE");
  });

  it("mapa neshnila — každý vzor na něco ve stromu sedí a každá brána existuje", () => {
    const soubory = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf-8" })
      .split("\n").map((s) => s.trim()).filter(Boolean);
    const naRegex = (vzor: string) => {
      const esc = vzor.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`^${esc.replace(/\*\*/g, " ").replace(/\*/g, "[^/]*").replace(/ /g, ".*")}$`);
    };
    const mrtveVzory: string[] = [];
    const chybejiciBrany: string[] = [];
    const jmena = new Set(vsechnyBrany(GATES).map((p) => path.basename(p, ".gate.test.ts")));
    for (const [jm, k] of Object.entries(LANES.kategorie)) {
      for (const v of k.zmenene) {
        const r = naRegex(v);
        if (!soubory.some((f) => r.test(f))) mrtveVzory.push(`${jm}: ${v}`);
      }
      for (const b of k.brany) if (!jmena.has(b)) chybejiciBrany.push(`${jm}: ${b}`);
    }
    expect(mrtveVzory, "vzor, který přestal na cokoli sedět, tiše vypne celou kategorii").toEqual([]);
    expect(chybejiciBrany, "mapa odkazující na neexistující bránu vybírá naslepo").toEqual([]);
  });
});
