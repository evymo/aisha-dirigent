/**
 * Balíčky se staví NAD CELOU INSTALACÍ a v pořadí závislostí
 *
 * ── PRAVIDLO ──────────────────────────────────────────────────────────────────
 * 1. Kroky instalace ve workflow, které balíčky vydává, po sobě nechají
 *    nainstalované VŠECHNY balíčky workspace. `npm ci` v adresáři balíčku se
 *    nesmí vrátit.
 * 2. Pořadí sestavení se odvozuje z grafu závislostí jedním modulem
 *    (scripts/lib/poradi-sestaveni-balicku.mjs) a čte ho každý, kdo balíčky staví.
 * 3. Skript vydávání jde v témž pořadí. Balíček, jehož závislost z repa se
 *    v běhu nevydala, se POZDRŽÍ; nezávislé vyjdou; opakovaný běh dovydá jen
 *    to, co v registru chybí.
 * 4. Co je v registru, jde nainstalovat MIMO pracovní prostor: závislost na
 *    balíček z repa zapsaná cestou (`file:../…`) jde ven jako rozsah verze;
 *    zdrojový package.json cestu nese dál.
 * 5. Balíček, jehož package.json se liší od gitu, běh vydávání zastaví dřív,
 *    než cokoli vyjde (zbytek po zabitém běhu se nevydá ani nepřepíše).
 *
 * ── PROČ (naměřeno 2026-10-03) ────────────────────────────────────────────────
 * Vydávání balíčků v CI končilo pádem pokaždé, když bylo co vydat: u každého
 * balíčku se závislostmi „build failed (exit 2)“. Doloženo logy běhů od
 * 2026-06-11 do 2026-10-04; registr mezitím dostával verze jen ručním vydáním
 * po pádu, naposledy 2026-08-12. Věrná reprodukce kroků workflow:
 *     po instalaci v kořeni ......................... 779 položek v node_modules
 *     po smyčce `npm ci` přes adresáře balíčků ...... 2
 * npm v adresáři balíčku pozná workspace a provede `ci` nad KOŘENEM jen pro ten
 * jeden balíček: kořenové node_modules smaže a nainstaluje závislosti jediného
 * workspace. Smyčka vznikla dva dny před zavedením workspaces — tentýž příkaz
 * pak znamenal něco jiného a podmínka „balíček nemá node_modules“ platila vždy.
 *
 * Samotné odstranění smyčky nestačí: balíček, který závisí na jiném balíčku
 * z repa, hledá jeho vstupní bod v `dist/`, a to vznikne až sestavením. Pořadí
 * přitom nikdo neřídil (abecedně, případně „opakuj, dokud to neprojde“).
 *
 * Vydávání šlo abecedně také: závislý balíček vyšel DŘÍV než jeho závislost
 * (změřeno 2026-10-04 nad skutečným stromem: llm-dispatch před security, oba
 * k vydání). Když pak vydání závislosti spadlo, zůstal v registru balíček
 * sestavený proti kódu, který nikdy nevyšel — „zastaralý registr“, kvůli kterému
 * skript vydávání vznikl.
 *
 * A vydaný balíček nesl závislost cestou tak, jak ji má v repu. Změřeno
 * 2026-10-04 proti registru (anonymně, prázdný adresář): `npm install` skončí
 * kódem 0, závislost se NENAINSTALUJE a balíček při načtení spadne
 * (`npm ls`: UNMET DEPENDENCY …@file:../security). Čtyři verze v registru.
 *
 * ── JAK SE MĚŘÍ ───────────────────────────────────────────────────────────────
 * CHOVÁNÍM, ne textem. Nad malým vzorem workspace (tři balíčky bez závislostí
 * z registru, npm bez sítě) běží SKUTEČNÉ kroky instalace vyjmuté z workflow
 * a skutečný scripts/ci/build-packages.sh. Vzor má závislost abecedně až ZA
 * závislým balíčkem — abecední pořadí na něm neprojde.
 *
 * Skutečný skript vydávání běží nad týmž vzorem proti falešnému registru na
 * 127.0.0.1 (čtení balíčku, přijetí nebo odmítnutí vydání) se skutečným
 * `npm publish`. Přihlášení má tvar z workflow: v souboru npm jen odkaz na
 * proměnnou prostředí. Registr vydané balíčky i VYDÁVÁ, takže se pak vzor
 * instaluje skutečným `npm install` v prázdném adresáři mimo pracovní prostor.
 * Kód instalace se neměří (prochází i rozbitá) — měří se, že závislost
 * v node_modules JE a přišla z registru.
 *
 * Kotvy: stará smyčka vzor prokazatelně rozbije a balíček postavený před svou
 * závislostí prokazatelně spadne. Bez nich by brána prošla i tehdy, kdyby
 * instalace ani pořadí nic neřídily.
 *
 * CO NEMĚŘÍ: balíček, který skutečný registr přijme a npm přesto skončí chybou
 * (výpadek uprostřed nahrávání) — vzor zná jen „přijato“ a „odmítnuto“.
 *
 * TĚŽKÁ DRÁHA: starty procesů npm nad vzorem — celá váha jsou ony. Viz lanes.json.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFile, spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { parse } from "yaml";
import { poradiSestaveni } from "../../../scripts/lib/poradi-sestaveni-balicku.mjs";

const ROOT = process.cwd();
const WORKFLOW = ".forgejo/workflows/aisha-packages-publish.yml";
const RUNNER = "scripts/aisha-packages-publish.mjs";

const ZAKLAD = mkdtempSync(path.join(tmpdir(), "vzor-workspace-"));
const SABLONA = path.join(ZAKLAD, "sablona");
const NAINSTALOVANO = path.join(ZAKLAD, "nainstalovano");
const VSECHNY = ["a-klient", "m-samostatny", "z-jadro"];

/** npm bez sítě a bez cizího nastavení (uživatelské .npmrc může mířit na registr). */
const ENV = {
  PATH: process.env.PATH ?? "",
  HOME: path.join(ZAKLAD, "domov"),
  npm_config_offline: "true",
  npm_config_audit: "false",
  npm_config_fund: "false",
  npm_config_update_notifier: "false",
};

const spust = (prikaz: string, argumenty: string[], cwd: string) =>
  spawnSync(prikaz, argumenty, { cwd, env: ENV, encoding: "utf8" });
const bash = (kod: string, cwd: string) => spust("bash", ["-c", kod], cwd);
/** Git nad vzorem — skript vydávání se ptá, jestli se package.json liší od gitu. */
const git = (cwd: string, ...argumenty: string[]) =>
  spust("git", ["-c", "user.name=vzor", "-c", "user.email=vzor@example.invalid", ...argumenty], cwd);
const potvrd = (cwd: string) => {
  const r = git(cwd, "commit", "-q", "-a", "-m", "zmena vzoru");
  expect(r.status, `commit změny vzoru selhal: ${r.stderr}`).toBe(0);
};

/** Balíčky vzoru, které má kořen nainstalované (odkazy v node_modules/@vzor). */
const nainstalovane = (dir: string): string[] => {
  const d = path.join(dir, "node_modules", "@vzor");
  return existsSync(d) ? readdirSync(d).sort() : [];
};

/** Čistá kopie; relativní odkazy workspace zůstanou relativní. */
const kopie = (odkud: string, jmeno: string): string => {
  const kam = path.join(ZAKLAD, jmeno);
  cpSync(odkud, kam, { recursive: true, verbatimSymlinks: true });
  return kam;
};

/** Nainstalovaný vzor se SKUTEČNÝMI skripty (sestavení, vydávání) a modulem pořadí na stejných cestách jako v repu. */
const seSkriptem = (jmeno: string): string => {
  const dir = kopie(NAINSTALOVANO, jmeno);
  for (const rel of [
    "scripts/ci/build-packages.sh",
    RUNNER,
    "scripts/lib/poradi-sestaveni-balicku.mjs",
    "scripts/lib/cli-entry.mjs",
    "scripts/lib/razeni.mjs",
  ]) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    cpSync(path.join(ROOT, rel), path.join(dir, rel));
  }
  return dir;
};

/** Runner dosadí `${{ … }}` dřív, než blok dostane shell. */
const jakToUvidiShell = (kod: string) => kod.replace(/\$\{\{[\s\S]*?\}\}/g, "VYRAZ");

/** Smyčka, která ve workflow stála do 2026-10-03 — doslova. */
const STARA_SMYCKA = [
  "for d in packages/*/; do",
  '  if [ -f "$d/package.json" ] && [ ! -d "$d/node_modules" ]; then',
  '    (cd "$d" && npm ci --ignore-scripts --no-audit --no-fund) || \\',
  '      (cd "$d" && npm install --ignore-scripts --no-audit --no-fund)',
  "  fi",
  "done",
].join("\n");

beforeAll(() => {
  mkdirSync(ENV.HOME, { recursive: true });
  const zapis = (rel: string, obsah: string) => {
    mkdirSync(path.dirname(path.join(SABLONA, rel)), { recursive: true });
    writeFileSync(path.join(SABLONA, rel), obsah);
  };
  // „Sestavení“ = ověř, že závislosti jdou načíst (jejich vstupní bod je v dist/), a vyrob vlastní dist/.
  zapis(
    "postav.cjs",
    "const fs = require('fs');\nfor (const z of process.argv.slice(2)) require(z);\n" +
      "fs.mkdirSync('dist', { recursive: true });\nfs.writeFileSync('dist/index.js', 'module.exports = 1;\\n');\n",
  );
  const balicek = (adresar: string, zavislosti: string[]) =>
    zapis(
      `packages/${adresar}/package.json`,
      JSON.stringify({
        name: `@vzor/${adresar}`,
        version: "1.0.0",
        main: "dist/index.js",
        scripts: { build: ["node", "../../postav.cjs", ...zavislosti].join(" ") },
        // Bez publishConfig skript vydávání balíček nevydává (souhlas vlastníka).
        publishConfig: { access: "restricted" },
        // Cestou, jak ji balíčky v repu opravdu deklarují.
        dependencies: Object.fromEntries(zavislosti.map((z) => [z, `file:../${z.replace("@vzor/", "")}`])),
      }),
    );
  zapis("package.json", JSON.stringify({ name: "vzor-koren", version: "1.0.0", private: true, workspaces: ["packages/*"] }));
  balicek("a-klient", ["@vzor/z-jadro"]);
  balicek("m-samostatny", []);
  balicek("z-jadro", []);

  const zamek = spust("npm", ["install", "--package-lock-only", "--ignore-scripts"], SABLONA);
  expect(zamek.status, `zámek vzoru nevznikl: ${zamek.stderr}`).toBe(0);

  cpSync(SABLONA, NAINSTALOVANO, { recursive: true });
  const instalace = spust("npm", ["ci", "--ignore-scripts"], NAINSTALOVANO);
  expect(instalace.status, `instalace vzoru v kořeni selhala: ${instalace.stderr}`).toBe(0);
  expect(nainstalovane(NAINSTALOVANO), "instalace v kořeni má nést všechny balíčky vzoru").toEqual(VSECHNY);

  // Vzor je repozitář (jako checkout v CI); node_modules a dist/ zůstávají nesledované.
  for (const argumenty of [["init", "-q"], ["add", "package.json", "package-lock.json", "postav.cjs", "packages"], ["commit", "-q", "-m", "vzor"]]) {
    const r = git(NAINSTALOVANO, ...argumenty);
    expect(r.status, `git ${argumenty[0]} nad vzorem selhal: ${r.stderr}`).toBe(0);
  }
});

afterAll(() => rmSync(ZAKLAD, { recursive: true, force: true }));

describe("instalace před vydáváním balíčků", () => {
  it(
    "kotva: stará smyčka `npm ci` přes adresáře balíčků instalaci v kořeni rozbije",
    () => {
      const dir = kopie(NAINSTALOVANO, "stara-smycka");
      const r = bash(STARA_SMYCKA, dir);
      expect(r.status, r.stderr).toBe(0);
      // Zbyde jen to, co potřebuje POSLEDNÍ balíček — ostatní z kořene zmizí.
      expect(nainstalovane(dir)).toEqual(["z-jadro"]);
    },
  );

  it(
    "kroky instalace z workflow vydávání nechají nainstalované všechny balíčky",
    () => {
      const wf = parse(readFileSync(path.join(ROOT, WORKFLOW), "utf8")) as {
        jobs?: Record<string, { steps?: { name?: string; run?: unknown }[] }>;
      };
      const kroky = Object.values(wf.jobs ?? {})
        .flatMap((j) => j.steps ?? [])
        .filter((k): k is { name?: string; run: string } => typeof k.run === "string" && /\bnpm\s+(ci|install|i)\b/.test(k.run));
      // Mlčení sondy je nález: bez kroku instalace by brána „prošla“ nad ničím.
      expect(kroky.length, `${WORKFLOW}: nenašel se žádný krok instalace — brána neměří`).toBeGreaterThan(0);

      const dir = kopie(SABLONA, "kroky-workflow");
      for (const k of kroky) {
        const r = bash(jakToUvidiShell(k.run), dir);
        expect(r.status, `krok „${k.name ?? "bez jména"}“ nad vzorem selhal: ${r.stderr}`).toBe(0);
      }
      expect(
        nainstalovane(dir),
        "Po krocích instalace chybí v kořeni balíčky workspace. `npm ci` (nebo `npm install`)\n" +
          "spuštěné v adresáři balíčku pracuje nad KOŘENEM jen pro ten jeden balíček a ostatní\n" +
          "odstraní — sestavení pak padá na chybějících závislostech. Instaluj jen v kořeni.",
      ).toEqual(VSECHNY);
    },
  );
});

describe("pořadí sestavení balíčků", () => {
  it(
    "kotva: balíček postavený před svou závislostí spadne",
    () => {
      const dir = kopie(NAINSTALOVANO, "spatne-poradi");
      const r = spust("npm", ["run", "build"], path.join(dir, "packages", "a-klient"));
      expect(r.status, "a-klient se postavil bez sestavené závislosti — vzor pořadí neměří").not.toBe(0);
      expect(`${r.stdout}${r.stderr}`).toContain("@vzor/z-jadro");
    },
  );

  it("modul dá nad vzorem závislost před závislý balíček, i když je abecedně až za ním", () => {
    expect(poradiSestaveni(NAINSTALOVANO)).toEqual(["packages/z-jadro", "packages/a-klient", "packages/m-samostatny"]);
  });

  it(
    "build-packages.sh bere pořadí z modulu: vzor postaví PRVNÍM průchodem",
    () => {
      const dir = seSkriptem("build-packages");
      const r = spust("bash", ["scripts/ci/build-packages.sh"], dir);
      expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
      // Abecední pořadí by a-klient postavilo až druhým průchodem (závislost je za ním).
      expect(r.stdout, "balíčky se postavily až opakováním — pořadí neřídí modul").toContain("(pass 1)");
      expect(r.stdout, "prvním průchodem postavený strom nemá hlásit nedeklarovanou závislost").not.toContain("built only on a retry");
      for (const b of VSECHNY) expect(existsSync(path.join(dir, "packages", b, "dist", "index.js")), `${b} bez dist/`).toBe(true);
    },
  );

  it(
    "síť průchodů díru NEZAKRYJE: balíček s nedeklarovanou závislostí se postaví až opakováním a skript ho jmenuje",
    () => {
      const dir = seSkriptem("nedeklarovana-zavislost");
      // a-klient závislost dál POTŘEBUJE (sestavení ji načítá), ale v package.json ji už nemá.
      const pj = path.join(dir, "packages", "a-klient", "package.json");
      const pkg = JSON.parse(readFileSync(pj, "utf8")) as { dependencies?: unknown };
      delete pkg.dependencies;
      writeFileSync(pj, JSON.stringify(pkg));
      expect(poradiSestaveni(dir), "bez deklarace nemá graf hranu — pořadí je abecední").toEqual([
        "packages/a-klient",
        "packages/m-samostatny",
        "packages/z-jadro",
      ]);

      const r = spust("bash", ["scripts/ci/build-packages.sh"], dir);
      expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
      expect(r.stdout).toContain("(pass 2)");
      expect(r.stdout, "opakování postavilo balíček mlčky — síť zakryla nedeklarovanou závislost").toMatch(
        /built only on a retry: packages\/a-klient\b/,
      );
      expect(r.stdout).toMatch(/::warning title=build:packages::undeclared repo dependency.*packages\/a-klient/);
    },
  );
});

describe("skript vydávání nad vzorem a falešným registrem", () => {
  const TOKEN = "token-vzoru";
  type Manifest = { dist?: { tarball?: string }; dependencies?: Record<string, string> };
  /** Falešný registr: co v něm je (i s archivy), o co se kdo pokusil a co má odmítnout. */
  const registr = {
    verze: new Map<string, Map<string, Manifest>>(),
    archivy: new Map<string, Buffer>(),
    pokusy: [] as string[],
    odmitni: new Set<string>(),
    vloz(jmeno: string, verze: string, manifest: Manifest = {}) {
      if (!this.verze.has(jmeno)) this.verze.set(jmeno, new Map());
      this.verze.get(jmeno)!.set(verze, manifest);
    },
    vydane(): string[] {
      return [...this.verze].flatMap(([jmeno, vs]) => [...vs.keys()].map((v) => `${jmeno}@${v}`)).sort();
    },
    vynuluj() {
      this.verze.clear();
      this.archivy.clear();
      this.pokusy.length = 0;
      this.odmitni.clear();
    },
  };
  let server: Server;
  let adresa = "";

  beforeAll(async () => {
    server = createServer((req, res) => {
      const odpovez = (kod: number, telo: unknown) => {
        res.writeHead(kod, { "Content-Type": "application/json" });
        res.end(JSON.stringify(telo));
      };
      const cesta = decodeURIComponent((req.url ?? "").split("?")[0]);
      const jmeno = cesta.slice(1);
      if (req.method === "GET") {
        const archiv = registr.archivy.get(cesta);
        if (archiv) {
          res.writeHead(200, { "Content-Type": "application/octet-stream" });
          return res.end(archiv);
        }
        const vs = registr.verze.get(jmeno);
        if (!vs || vs.size === 0) return odpovez(404, { error: "no such package available" });
        return odpovez(200, {
          name: jmeno,
          "dist-tags": { latest: [...vs.keys()].pop() },
          versions: Object.fromEntries([...vs].map(([v, m]) => [v, { ...m, name: jmeno, version: v }])),
        });
      }
      if (req.method === "PUT") {
        const kusy: Buffer[] = [];
        req.on("data", (c: Buffer) => kusy.push(c));
        req.on("end", () => {
          const telo = JSON.parse(Buffer.concat(kusy).toString("utf8") || "{}") as {
            versions?: Record<string, Manifest>;
            _attachments?: Record<string, { data: string }>;
          };
          const vs = Object.entries(telo.versions ?? {});
          registr.pokusy.push(...vs.map(([v]) => `${jmeno}@${v}`));
          if (registr.odmitni.has(jmeno)) return odpovez(403, { error: "forbidden" });
          const archiv = Object.values(telo._attachments ?? {})[0];
          for (const [v, m] of vs) {
            registr.vloz(jmeno, v, m);
            if (archiv && m.dist?.tarball) registr.archivy.set(decodeURIComponent(new URL(m.dist.tarball).pathname), Buffer.from(archiv.data, "base64"));
          }
          odpovez(201, { ok: true, success: true });
        });
        return;
      }
      odpovez(404, { error: "not found" });
    });
    await new Promise<void>((hotovo) => server.listen(0, "127.0.0.1", hotovo));
    adresa = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    // Tvar, který po sobě nechává krok přihlášení: v souboru jen odkaz na proměnnou.
    writeFileSync(path.join(ZAKLAD, "vydavatel.npmrc"), `//${adresa.replace(/^https?:\/\//, "")}/:_authToken=\${NODE_AUTH_TOKEN}\n`);
    writeFileSync(path.join(ZAKLAD, "odberatel.npmrc"), "");
  });

  afterAll(async () => {
    await new Promise<void>((hotovo) => server.close(() => hotovo()));
  });

  type Beh = { kod: number; vystup: string };
  /** Asynchronně — registr žije v témž procesu a musí stihnout odpovědět. Výstup bez barev. */
  // ESC se skládá z kódu znaku — regex literál s řídicím znakem odmítá lint (no-control-regex).
  const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
  const spustAsync = (prikaz: string, argumenty: string[], cwd: string, env: Record<string, string>): Promise<Beh> =>
    new Promise((hotovo) => {
      execFile(prikaz, argumenty, { cwd, env, encoding: "utf8" }, (chyba, stdout, stderr) => {
        const c = chyba as (Error & { code?: number }) | null;
        hotovo({ kod: c ? (typeof c.code === "number" ? c.code : 1) : 0, vystup: `${stdout}${stderr}`.replace(ANSI, "") });
      });
    });
  const NPM_TICHO = { npm_config_audit: "false", npm_config_fund: "false", npm_config_update_notifier: "false" };

  /** Skutečný skript vydávání nad vzorem. */
  const vydej = (dir: string, navic: Record<string, string> = {}): Promise<Beh> =>
    spustAsync("node", [RUNNER], dir, {
      PATH: ENV.PATH,
      HOME: ENV.HOME,
      ...NPM_TICHO,
      NPM_CONFIG_USERCONFIG: path.join(ZAKLAD, "vydavatel.npmrc"),
      NODE_AUTH_TOKEN: TOKEN,
      VERDACCIO_TOKEN: TOKEN,
      VERDACCIO_URL: adresa,
      ...navic,
    });

  const zavislostVeZdroji = (dir: string) =>
    (JSON.parse(readFileSync(path.join(dir, "packages", "a-klient", "package.json"), "utf8")) as Manifest).dependencies?.["@vzor/z-jadro"];

  describe("pád uprostřed, dohnání druhým během a instalace mimo pracovní prostor", () => {
    let dir = "";
    let prvni: Beh;
    let druhy: Beh;
    let poPrvnim = { pokusy: [] as string[], vydane: [] as string[] };
    let pokusyDruheho: string[] = [];

    beforeAll(async () => {
      registr.vynuluj();
      registr.odmitni.add("@vzor/z-jadro");
      dir = seSkriptem("vydani-pad-uprostred");
      prvni = await vydej(dir);
      poPrvnim = { pokusy: [...registr.pokusy], vydane: registr.vydane() };
      registr.odmitni.clear();
      druhy = await vydej(dir);
      pokusyDruheho = registr.pokusy.slice(poPrvnim.pokusy.length);
    }, 180_000);

    it("první běh: závislý balíček se pozdrží, nezávislý vyjde, kód 1", () => {
      expect(prvni.kod, `běh s nevydaným balíčkem má skončit kódem 1:\n${prvni.vystup}`).toBe(1);
      // Závislost jde PRVNÍ (abecedně je poslední); a-klient se o vydání ani nepokusil.
      expect(poPrvnim.pokusy, prvni.vystup).toEqual(["@vzor/z-jadro@1.0.0", "@vzor/m-samostatny@1.0.0"]);
      expect(
        poPrvnim.vydane,
        "V registru je závislý balíček bez své závislosti — pád závislosti má závislé balíčky pozdržet.",
      ).toEqual(["@vzor/m-samostatny@1.0.0"]);
      expect(prvni.vystup, "pozdržený balíček má jmenovat, na co čeká").toMatch(
        /@vzor\/a-klient 1\.0\.0 — held back: @vzor\/z-jadro did not ship in this run/,
      );
    });

    it("druhý běh dovydá jen to, co chybí — a závislost dřív", () => {
      expect(druhy.kod, druhy.vystup).toBe(0);
      expect(pokusyDruheho).toEqual(["@vzor/z-jadro@1.0.0", "@vzor/a-klient@1.0.0"]);
      expect(registr.vydane()).toEqual(VSECHNY.map((b) => `@vzor/${b}@1.0.0`));
    });

    it("závislost cestou jde ven jako rozsah verze; zdrojový package.json cestu nese dál", () => {
      expect(registr.verze.get("@vzor/a-klient")?.get("1.0.0")?.dependencies).toEqual({ "@vzor/z-jadro": "^1.0.0" });
      expect(zavislostVeZdroji(dir), "vydání přepsalo zdrojový package.json a nevrátilo ho").toBe("file:../z-jadro");
    });

    it("co je v registru, jde nainstalovat mimo pracovní prostor — závislost přijde z registru", async () => {
      const odberatel = path.join(ZAKLAD, "odberatel");
      mkdirSync(odberatel);
      writeFileSync(path.join(odberatel, "package.json"), JSON.stringify({ name: "odberatel", version: "1.0.0", private: true }));
      const r = await spustAsync("npm", ["install", "@vzor/a-klient", "--registry", adresa, "--ignore-scripts"], odberatel, {
        PATH: ENV.PATH,
        HOME: ENV.HOME,
        ...NPM_TICHO,
        NPM_CONFIG_USERCONFIG: path.join(ZAKLAD, "odberatel.npmrc"),
        npm_config_cache: path.join(ZAKLAD, "cache-odberatele"),
      });
      expect(r.kod, r.vystup).toBe(0);
      // Kód 0 nestačí: instalace balíčku se závislostí cestou projde taky — jen bez té závislosti.
      expect(
        existsSync(path.join(odberatel, "node_modules", "@vzor", "z-jadro", "package.json")),
        "Balíček se nainstaloval, jeho závislost z repa ne — vydaný manifest ji nese cestou, která\n" +
          `mimo pracovní prostor neexistuje.\n${r.vystup}`,
      ).toBe(true);
      const zamek = JSON.parse(readFileSync(path.join(odberatel, "package-lock.json"), "utf8")) as {
        packages: Record<string, { resolved?: string }>;
      };
      expect(zamek.packages["node_modules/@vzor/z-jadro"]?.resolved ?? "", "závislost nepřišla z registru").toContain(adresa);
    });
  });

  it("závislost, která se v běhu nevydává, se přesto sestaví — jinak by se závislý balíček nepostavil", async () => {
    registr.vynuluj();
    registr.vloz("@vzor/z-jadro", "1.0.0");
    const dir = seSkriptem("vydani-zavislost-uz-vysla");

    const r = await vydej(dir);
    expect(r.kod, r.vystup).toBe(0);
    expect(registr.pokusy).toEqual(["@vzor/a-klient@1.0.0", "@vzor/m-samostatny@1.0.0"]);
    expect(existsSync(path.join(dir, "packages", "z-jadro", "dist", "index.js")), "závislost se nesestavila").toBe(true);
  });

  it("cesta na balíček, který se nevydává, je chyba vydání se jménem obou — nejde splnit", async () => {
    registr.vynuluj();
    const dir = seSkriptem("vydani-cesta-na-nevydavany");
    const pj = path.join(dir, "packages", "z-jadro", "package.json");
    writeFileSync(pj, JSON.stringify({ ...(JSON.parse(readFileSync(pj, "utf8")) as object), private: true }));
    potvrd(dir);

    const r = await vydej(dir);
    expect(r.kod, r.vystup).toBe(1);
    expect(registr.pokusy, "balíček s nesplnitelnou závislostí se nemá o vydání ani pokusit").toEqual(["@vzor/m-samostatny@1.0.0"]);
    expect(r.vystup).toMatch(
      /@vzor\/a-klient 1\.0\.0 — dependencies: @vzor\/z-jadro is a path \(file:\.\.\/z-jadro\) but @vzor\/z-jadro is not publishable \(private:true\)/,
    );
  });

  it("suchý běh vypíše, jak závislosti půjdou ven, a nic nevydá", async () => {
    registr.vynuluj();
    const dir = seSkriptem("vydani-suchy-beh");

    const r = await vydej(dir, { DRY_RUN: "1" });
    expect(r.kod, r.vystup).toBe(0);
    expect(registr.pokusy).toEqual([]);
    expect(r.vystup).toMatch(/@vzor\/a-klient 1\.0\.0 — goes out with dependencies: @vzor\/z-jadro file:\.\.\/z-jadro → \^1\.0\.0/);
    expect(zavislostVeZdroji(dir)).toBe("file:../z-jadro");

    // Rozsah bez omezení na balíček z repa se nechává, jak ho autor napsal — ale je vidět.
    const pj = path.join(dir, "packages", "a-klient", "package.json");
    writeFileSync(pj, JSON.stringify({ ...(JSON.parse(readFileSync(pj, "utf8")) as object), dependencies: { "@vzor/z-jadro": "*" } }));
    potvrd(dir);
    const bezOmezeni = await vydej(dir, { DRY_RUN: "1" });
    expect(bezOmezeni.kod, bezOmezeni.vystup).toBe(0);
    expect(bezOmezeni.vystup).toMatch(
      /@vzor\/a-klient 1\.0\.0 — goes out with dependencies: @vzor\/z-jadro \* \(range without bounds, left as declared\)/,
    );
  });

  it("package.json, který se liší od gitu, běh zastaví dřív, než cokoli vyjde", async () => {
    registr.vynuluj();
    const dir = seSkriptem("vydani-zbytek-po-zabitem-behu");
    // Zbytek po zabitém běhu: manifest přepsaný pro vydání, který se nevrátil.
    const pj = path.join(dir, "packages", "a-klient", "package.json");
    writeFileSync(pj, JSON.stringify({ ...(JSON.parse(readFileSync(pj, "utf8")) as object), dependencies: { "@vzor/z-jadro": "^1.0.0" } }));

    const r = await vydej(dir);
    expect(r.kod, r.vystup).toBe(2);
    expect(registr.pokusy, "běh nad změněným manifestem nemá vydat nic — ani balíčky, kterých se změna netýká").toEqual([]);
    expect(r.vystup).toMatch(/package manifest\(s\) differ from git — nothing is published/);
    expect(r.vystup).toContain("- packages/a-klient/package.json");
    expect(
      (JSON.parse(readFileSync(pj, "utf8")) as { dependencies: Record<string, string> }).dependencies["@vzor/z-jadro"],
      "běh nemá zbytek po zabitém běhu přepisovat",
    ).toBe("^1.0.0");
  });
});
