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
 * kategorii X nečte compose“. Pro stovky textových bran je to staticky
 * nedokazatelné a pokus by byl jen další špatný regex. Úplnost zaručuje PLNÝ
 * BĚH V CI (Web: Brány, rozhodnutí majitele 2026-10-05 „plné sady jen v CI“);
 * výběr má být fail-closed a užitečný, nic víc. Že pre-push z výběru opravdu
 * pouští jen dotčené (a při nejistotě širší dráhu), měří prepush-vyber-je-cileny.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { envWithoutGitLocation } from "../../../scripts/lib/git-worktree-health.mjs";
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const GATES = path.join(ROOT, "src/tests/gates");
const SELEKTOR = path.join(ROOT, "scripts/test/brany-dotcene.mjs");
const LANES = JSON.parse(readFileSync(path.join(GATES, "lanes.json"), "utf-8")) as {
  kategorie: Record<string, { zmenene: string[]; brany: string[]; vzdy?: boolean }>;
  ignorovat: { vzory: string[] };
  oblasti: { vzory: { vzor: string; kotva: number; krome?: string[] }[] };
};

/**
 * ⛔ ČISTÉ PROSTŘEDÍ. Hook exportuje GIT_DIR/GIT_INDEX_FILE a ty by prosákly do
 * dočasného repa, takže by se měřilo repo tohoto projektu. Týž důvod, jaký má
 * `zmena-sluzby-dosahne-na-svuj-stack`.
 */
const CISTE = envWithoutGitLocation();

/** Postaví dočasné git repo s jedním commitem měnícím dané cesty a zeptá se selektoru. */
function zeptejSe(cesty: string[]): { rezim: string; brany: string[]; neznameCesty: string[]; zdroje: { odkaz: number; zmeneneBrany: number; import: number } } {
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

/** Třídní brány (kategorie s `vzdy`) jako relativní cesty ve stromu. */
function tridni(): string[] {
  const jmena = new Set(Object.values(LANES.kategorie).filter((k) => k.vzdy).flatMap((k) => k.brany));
  return vsechnyBrany(GATES).filter((p) => jmena.has(path.basename(p, ".gate.test.ts"))).map((p) => path.relative(ROOT, p)).sort();
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

  it("ignorovaná cesta nespustí nic kromě třídních bran a NEZPŮSOBÍ pád na celou dráhu", () => {
    // Jméno se SKLÁDÁ: výběr odkazem pouští bránu, která dokument jmenuje — a doslovná
    // cesta tady v testu by z téhle brány udělala „bránu, která ho jmenuje".
    const r = zeptejSe([["docs", "nikym-nejmenovany-zapis.md"].join("/")]);
    expect(r.rezim, "výčet ignorovaných je uzavřený a doložený — smí zůstat výběrem").toBe("vyber");
    expect(r.brany.sort(), "změna dokumentace pustí jen třídní brány (ty běží vždy)").toEqual(tridni());
  });

  it("smíšená změna (známá + neznámá) je fail-closed — jedna neznámá stačí", () => {
    const r = zeptejSe(["docker-compose.coolify-neco.yml", "uplne/neznama/cesta.bin"]);
    expect(
      r.rezim,
      "částečná znalost není znalost: kdyby se neznámá cesta jen ignorovala, " +
        "výběr by tvrdil víc, než ví",
    ).toBe("VSE_LEHKE");
  });

  it("změna v pracovním prostoru je ZNÁMÁ a vybere brány, které ho jmenují — ne celý strom", () => {
    // Kotva = kořen pracovního prostoru (`oblasti` v lanes.json). Vybírá se z TÉHOŽ stromu
    // bran, takže očekávání se počítá ze zdroje bran, ne z ručně opsaného seznamu.
    const kotva = "packages/security";
    const jmenuji = vsechnyBrany(GATES).filter((p) => /packages\/security(?![A-Za-z0-9_.-])/.test(readFileSync(p, "utf-8")));
    expect(jmenuji.length, "kontrolní vzorek: nějaká brána musí balíček jmenovat, jinak test neměří nic").toBeGreaterThan(0);
    const r = zeptejSe([`${kotva}/src/zbrusu-novy-modul.ts`]);
    expect(r.rezim, "změna uvnitř deklarované oblasti nesmí padat na celou dráhu").toBe("vyber");
    expect(r.brany.sort()).toEqual([...new Set([...jmenuji.map((p) => path.relative(ROOT, p)), ...tridni()])].sort());
    expect(r.brany.length).toBeLessThan(vsechnyBrany(GATES).length / 4);
  });

  it("změněná brána se vybere SAMA — kdo mění bránu, musí ji pustit", () => {
    const brana = path.relative(ROOT, path.join(GATES, "vyber-bran-je-fail-closed.gate.test.ts"));
    const r = zeptejSe([brana]);
    expect(r.rezim).toBe("vyber");
    expect(r.brany).toContain(brana);
    expect(r.zdroje.zmeneneBrany).toBe(1);
  });

  it("testovací infrastruktura (src/test/**) je fail-closed i uvnitř oblasti src/**", () => {
    const r = zeptejSe(["src/test/zbrusu-novy-setup.ts"]);
    expect(r.rezim, "setup obou vitest konfigurací se dotýká všeho — úzký výběr by lhal").toBe("VSE_LEHKE");
    expect(r.neznameCesty).toContain("src/test/zbrusu-novy-setup.ts");
  });

  it("změna v libovolném skriptu → ve výběru jsou VŠECHNY třídní brány (trida-repo)", () => {
    // Kotva: třídní brány jsou neprázdné a obsahují ty, které výběr 2026-10-05 minul.
    const t = tridni();
    expect(t.length, "bez třídních bran by tahle vlastnost neměřila nic").toBeGreaterThan(20);
    for (const nutna of ["neznamy-prepinac-neni-vychozi-chovani", "git-v-testech-bez-prostredi", "silent-degradation", "drahy-bran-manifest"]) {
      expect(t.some((p) => path.basename(p, ".gate.test.ts") === nutna), `${nutna} musí být třídní`).toBe(true);
    }
    const r = zeptejSe(["scripts/zbrusu-novy-nastroj.mjs"]);
    expect(t.filter((p) => !r.brany.includes(p)), "třídní brána chybí ve výběru pro nový skript").toEqual([]);
  });

  it("mutant „bez třídních“ (selektor přestane přidávat kategorie s vzdy) tu vlastnost poruší", async () => {
    const zdroj = readFileSync(SELEKTOR, "utf-8");
    const kotva = "    if (!k.vzdy) continue;";
    expect(zdroj, "kotva mutace v selektoru chybí — mutant by neměřil nic").toContain(kotva);
    const d = mkdtempSync(path.join(tmpdir(), "vyber-bran-mutant-"));
    try {
      // Mutant leží mimo strom (jinak by ho viděly brány nad stromem); relativní import pomocníka
      // se proto přepíše na absolutní URL.
      const mutant = zdroj
        .replace(kotva, "    continue; // mutant: bez třídních")
        .replace('"../lib/cli-entry.mjs"', JSON.stringify(pathToFileURL(path.join(ROOT, "scripts/lib/cli-entry.mjs")).href));
      const soubor = path.join(d, "brany-dotcene-mutant.mjs");
      writeFileSync(soubor, mutant);
      const m = await import(pathToFileURL(soubor).href);
      const puvodni = await import(pathToFileURL(SELEKTOR).href);
      const zmena = ["scripts/zbrusu-novy-nastroj.mjs"];
      const chybi = (v: { brany: string[] }) => tridni().filter((p) => !v.brany.includes(p));
      expect(chybi(puvodni.vyberBranVeStromu(zmena, ROOT)), "kontrolní vzorek: originál třídní brány vybere").toEqual([]);
      expect(chybi(m.vyberBranVeStromu(zmena, ROOT)).length, "vlastnost mutanta bez třídních nepoznala").toBeGreaterThan(0);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("každá brána, která si univerzum bere z `git ls-files`, je třídní (jinak by ji výběr minul)", () => {
    const t = new Set(tridni().map((p) => path.basename(p, ".gate.test.ts")));
    const bezKomentaru = (s: string) => s.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    const lsFiles = vsechnyBrany(GATES).filter((p) => /["'`]ls-files["'`]|git ls-files/.test(bezKomentaru(readFileSync(p, "utf-8"))));
    expect(lsFiles.length, "detektor nenašel žádnou bránu nad `git ls-files` — je slepý").toBeGreaterThan(20);
    const mimo = lsFiles.map((p) => path.basename(p, ".gate.test.ts")).filter((n) => !t.has(n));
    expect(mimo, "brána nad celým repem (git ls-files) mimo trida-repo — přidej ji do lanes.json kategorie trida-repo").toEqual([]);
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
    for (const o of LANES.oblasti.vzory) {
      const r = naRegex(o.vzor);
      if (!soubory.some((f) => r.test(f))) mrtveVzory.push(`oblasti: ${o.vzor}`);
    }
    expect(mrtveVzory, "vzor, který přestal na cokoli sedět, tiše vypne celou kategorii").toEqual([]);
    expect(chybejiciBrany, "mapa odkazující na neexistující bránu vybírá naslepo").toEqual([]);
  });
});
