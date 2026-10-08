import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { envWithoutGitLocation } from "../../../scripts/lib/git-worktree-health.mjs";
import { prostrediBezPrepinacuSady } from "../../../scripts/lib/ci-zelene.mjs";

/**
 * Směrování podle cest má JEDEN DOMOV a pre-push je FAIL-CLOSED.
 *
 * ⛔ PROČ EXISTUJE
 * Do 2026-09-25 žila pravidla „které cesty rozsvítí který příznak" inline v ci.yml.
 * Pre-push hook je potřebuje taky (spouští jen to, čeho se změna týká — plná sada
 * trvá naprázdno ≈ 10 min a pod zátěží 27–79 min), a druhá kopie by se rozešla
 * tiše. Třikrát se už stalo, že předfiltr byl slepý přesně na PR, kvůli kterým
 * existuje (packages/ u `app` 2026-08-09, heals.sql u `db_change` 2026-09-11,
 * packages/ u `services_change` 2026-09-05). Proto: ci.yml i hook volají
 * scripts/ci/zmenene-cesty.sh a tahle brána měří, že (a) kopie nikde nezůstala,
 * (b) směrovač dává na kontrolních vzorcích to, co má, (c) výběr je fail-closed:
 * nová větev bez báze, příliš velká změna nebo rozpor směrování → ŠIRŠÍ cílená
 * dráha (`rezim=sirsi`), plná sada jen na vynucení člověkem (AISHA_PREPUSH_VSE=1).
 * Od rozhodnutí majitele 2026-10-05 („plné sady jen v CI") merge commit NENÍ
 * nejistota: báze = společný předek s origin/main. Chování cílené dráhy (co se
 * z plánu pustí) měří brána prepush-vyber-je-cileny.
 *
 * ⭐ KONTROLNÍ VZOREK JE ORIGINÁL, NE VYMYŠLENÝ SEZNAM. `fixtures/smerovani/pr-943.txt`
 * = `git diff --name-only` merge commitu upstream PR #943 (400 cest; běh 3592 hlásil
 * `Changed files (390)` a zároveň `app=false mobile_app=false surfaces=false`).
 * Nad tímhle seznamem MUSÍ směrovač rozsvítit app, mobile_app, surfaces, db_change
 * i services_change — jinak měří něco jiného než tu vadu.
 *
 * Bez verdiktu na uplynulém čase: vše jsou ano/ne výsledky logiky nad daným vstupem.
 */
const ROOT = join(__dirname, "../../..");
const SMEROVAC = join(ROOT, "scripts/ci/zmenene-cesty.sh");
const VYBER = join(ROOT, "scripts/ci/prepush-vyber.sh");
const CI = join(ROOT, ".forgejo/workflows/ci.yml");
const HOOK = join(ROOT, ".husky/pre-push");

/** Spustí směrovač nad seznamem cest; vrací příznaky + návratový kód. */
function smeruj(cesty: string, cwd = ROOT): { rc: number; p: Record<string, string>; stderr: string } {
  const r = spawnSync("bash", [SMEROVAC], { cwd, encoding: "utf8", input: cesty, env: envWithoutGitLocation() });
  const p: Record<string, string> = {};
  for (const l of (r.stdout ?? "").split("\n")) {
    const m = l.match(/^([a-z0-9_]+)=(true|false)$/);
    if (m) p[m[1]!] = m[2]!;
  }
  return { rc: r.status ?? -1, p, stderr: r.stderr ?? "" };
}

describe("směrování podle cest má jeden domov", () => {
  it("ci.yml už nenese vlastní kopii směrovače a volá skript", () => {
    const ci = readFileSync(CI, "utf8");
    expect(ci, "krok Detect changed paths musí volat scripts/ci/zmenene-cesty.sh").toContain("scripts/ci/zmenene-cesty.sh");
    const kopie = ci.split("\n").filter((l) => /<<< "\$CHANGED(_BEZ_SUBMODULU)?" && [A-Z_]+=true \|\| [A-Z_]+=false/.test(l));
    expect(kopie, "řádky směrovače v ci.yml = druhá kopie pravidel, která se rozejde tiše").toEqual([]);
    expect(ci, "sebekontrola směrování patří do skriptu, ne do ci.yml").not.toContain("ROUTING_BUG");
    // Seznam změn se sestavuje TAKÉ ve skriptu (`--seznam`: --no-renames, quotePath=false).
    // Přímý `git diff --name-only` v kroku Detect by přesun ze services/ ukázal jen cílovou cestou.
    const detect = ci.split("\n").slice(ci.split("\n").findIndex((l) => l.includes("name: Detect changed paths")));
    const krok = detect.slice(0, detect.findIndex((l, i) => i > 0 && /^\s*- name:/.test(l)));
    expect(krok.filter((l) => /git diff --name-only/.test(l) && !/^\s*#/.test(l)), "Detect diffuje napřímo").toEqual([]);
    expect(krok.join("\n")).toContain("zmenene-cesty.sh --seznam");
  });

  it("--seznam diffuje bez detekce přejmenování a bez uvozování cest", () => {
    const zdroj = readFileSync(SMEROVAC, "utf8");
    const radek = zdroj.split("\n").find((l) => /^\s*exec git .*diff --name-only/.test(l)) ?? "";
    expect(radek, "přesun by jinak vypsal jen cílovou cestu").toContain("--no-renames");
    expect(radek, "cesta s diakritikou by jinak přišla v uvozovkách").toContain("core.quotePath=false");
  });

  it("hook volá výběr a výběr volá směrovač — týž skript jako CI", () => {
    expect(readFileSync(HOOK, "utf8")).toContain("scripts/ci/prepush-vyber.sh");
    expect(readFileSync(VYBER, "utf8")).toContain("scripts/ci/zmenene-cesty.sh");
  });

  it("směrovač vypisuje všechny klíče, které ci.yml čte jako výstupy detekce", () => {
    const ci = readFileSync(CI, "utf8");
    const ctene = new Set([...ci.matchAll(/steps\.changes\.outputs\.([a-z0-9_]+)/g)].map((m) => m[1]!));
    expect([...ctene].length, "ci.yml musí číst aspoň jeden výstup detekce — jinak měřím prázdno").toBeGreaterThan(5);
    const { rc, p } = smeruj("src/App.tsx\n");
    expect(rc).toBe(0);
    for (const k of ctene) expect(p[k], `ci.yml čte outputs.${k}, směrovač ho nevypsal`).toMatch(/^(true|false)$/);
  });
});

describe("směrovač na kontrolních vzorcích", () => {
  it("PR #943 (400 cest): rozsvítí app, mobile_app, surfaces, db_change, services_change", () => {
    const seznam = readFileSync(join(__dirname, "fixtures/smerovani/pr-943.txt"), "utf8");
    expect(seznam.split("\n").filter(Boolean).length, "vzorek se nesmí zmenšit potichu").toBeGreaterThanOrEqual(390);
    const { rc, p } = smeruj(seznam);
    expect(rc, "směrování si nesmí protiřečit").toBe(0);
    expect([p.app, p.mobile_app, p.surfaces, p.db_change, p.services_change]).toEqual(["true", "true", "true", "true", "true"]);
    expect(p.docs_only).toBe("false");
  });

  it("změna jen ve službě: app=false, services_change=true (to je celá úspora pre-pushe)", () => {
    const { rc, p } = smeruj("services/svc-money/src/routes/money.ts\nservices/svc-money/package.json\n");
    expect(rc).toBe(0);
    expect(p).toMatchObject({ app: "false", services_change: "true", surfaces: "false", mobile_app: "false", docs_only: "false", db_change: "false" });
  });

  it("jen dokumentace: docs_only=true a nic dalšího nesvítí", () => {
    const { rc, p } = smeruj("docs/navrh.md\nREADME.md\n");
    expect(rc).toBe(0);
    expect(p.docs_only).toBe("true");
    expect(Object.entries(p).filter(([k, v]) => k !== "docs_only" && v === "true"), "dokumentace nesmí spustit žádnou dráhu").toEqual([]);
  });

  it("prázdný seznam = záchranná síť: bezpečnostní dráhy svítí, nic se nepřeskočí", () => {
    const { rc, p } = smeruj("");
    expect(rc).toBe(0);
    expect(p).toMatchObject({ db_change: "true", security_change: "true", services_change: "true", surfaces: "true", infra_core: "true", app: "true" });
  });

  it("negativní kontrola: směrovač, kterému vypadne cesta ze vzoru, skončí 1 (sebekontrola)", () => {
    // Mutace = odebrat `scripts/` z filtru `app`. Sebekontrola (`case`) tu cestu dál čeká,
    // takže výsledek si protiřečí a skript MUSÍ skončit 1 — volající pak spustí vše.
    const dir = mkdtempSync(join(tmpdir(), "smerovani-mutace-"));
    try {
      mkdirSync(join(dir, "scripts/ci"), { recursive: true });
      const puvodni = readFileSync(SMEROVAC, "utf8");
      const zmutovany = puvodni.replace("|scripts/|extensions/aisha-dirigent-claude/", "|extensions/aisha-dirigent-claude/");
      expect(zmutovany, "mutace nesedí na skript — negativní kontrola by neměřila nic").not.toBe(puvodni);
      const cesta = join(dir, "scripts/ci/zmenene-cesty.sh");
      writeFileSync(cesta, zmutovany);
      const r = spawnSync("bash", [cesta], { cwd: dir, encoding: "utf8", input: "scripts/x.sh\n", env: envWithoutGitLocation() });
      expect(r.status, `mutant měl spadnout na sebekontrole, stderr: ${r.stderr}`).toBe(1);
      expect(r.stderr).toContain("směrování si protiřečí");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/** Dočasné repo s remote `origin` a `origin/main`, oba směrovací skripty committnuté. */
function repo(): { dir: string; git: (...a: string[]) => string; remote: string } {
  const dir = mkdtempSync(join(tmpdir(), "prepush-vyber-"));
  const remote = mkdtempSync(join(tmpdir(), "prepush-vyber-remote-"));
  const git = (...a: string[]): string => {
    // Hook (pre-push) exportuje GIT_DIR & spol. — bez čistého env by dočasný git sáhl na repo volajícího.
    const r = spawnSync("git", a, { cwd: dir, encoding: "utf8", env: envWithoutGitLocation({ ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" }) });
    if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  spawnSync("git", ["init", "-q", "--bare", remote], { env: envWithoutGitLocation() });
  git("init", "-q", "--initial-branch=main");
  mkdirSync(join(dir, "scripts/ci"), { recursive: true });
  copyFileSync(SMEROVAC, join(dir, "scripts/ci/zmenene-cesty.sh"));
  copyFileSync(VYBER, join(dir, "scripts/ci/prepush-vyber.sh"));
  chmodSync(join(dir, "scripts/ci/zmenene-cesty.sh"), 0o755);
  chmodSync(join(dir, "scripts/ci/prepush-vyber.sh"), 0o755);
  writeFileSync(join(dir, "README.md"), "x\n");
  git("add", "-A"); git("commit", "-qm", "zaklad");
  git("remote", "add", "origin", remote);
  git("push", "-q", "origin", "main");
  return { dir, git, remote };
}

function vyber(dir: string, stdin: string, env: Record<string, string> = {}): { rc: number; p: Record<string, string>; out: string } {
  // Hermeticky: brána často běží UVNITŘ pre-pushe (AISHA_PREPUSH_*, AISHA_SMOKE_* v prostředí);
  // výběr smí vidět jen to, co test nastaví výslovně (viz prostrediBezPrepinacuSady).
  const r = spawnSync("bash", ["scripts/ci/prepush-vyber.sh", "origin"], { cwd: dir, encoding: "utf8", input: stdin, env: envWithoutGitLocation({ ...prostrediBezPrepinacuSady(process.env), ...env }) });
  const p: Record<string, string> = {};
  for (const l of (r.stdout ?? "").split("\n")) { const i = l.indexOf("="); if (i > 0) p[l.slice(0, i)] = l.slice(i + 1); }
  return { rc: r.status ?? -1, p, out: `${r.stdout}\n${r.stderr}` };
}
const ZERO = "0".repeat(40);

describe("pre-push výběr je fail-closed: nejistota = širší dráha (měřeno nad dočasným gitem)", () => {
  it("nová větev s jedním commitem jen ve službě → výběr: app=false, services_change=true", () => {
    const { dir, git, remote } = repo();
    try {
      git("checkout", "-qb", "t");
      mkdirSync(join(dir, "services/svc-x/src"), { recursive: true });
      writeFileSync(join(dir, "services/svc-x/src/a.ts"), "export const a = 1;\n");
      git("add", "-A"); git("commit", "-qm", "sluzba");
      const sha = git("rev-parse", "HEAD");
      const r = vyber(dir, `refs/heads/t ${sha} refs/heads/t ${ZERO}\n`);
      expect(r.rc, r.out).toBe(0);
      expect(r.p).toMatchObject({ rezim: "vyber", zmeneno: "1", app: "false", services_change: "true" });
    } finally { rmSync(dir, { recursive: true, force: true }); rmSync(remote, { recursive: true, force: true }); }
  });

  it("necommitnutá změna v pracovním stromu se počítá (pre-push testuje disk, ne HEAD)", () => {
    const { dir, git, remote } = repo();
    try {
      git("checkout", "-qb", "t");
      mkdirSync(join(dir, "services/svc-x/src"), { recursive: true });
      writeFileSync(join(dir, "services/svc-x/src/a.ts"), "export const a = 1;\n");
      git("add", "-A"); git("commit", "-qm", "sluzba");
      writeFileSync(join(dir, "src-necommitnute.txt"), "x\n"); // netrackované, mimo vzory
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "src/App.tsx"), "x\n");           // netrackované v src/ → app=true
      const sha = git("rev-parse", "HEAD");
      const r = vyber(dir, `refs/heads/t ${sha} refs/heads/t ${ZERO}\n`);
      expect(r.rc, r.out).toBe(0);
      expect(r.p).toMatchObject({ rezim: "vyber", zmeneno: "3", app: "true" });
    } finally { rmSync(dir, { recursive: true, force: true }); rmSync(remote, { recursive: true, force: true }); }
  });

  it("přesun ze services/ do docs/ (commitem) → services_change=true, ne docs_only", () => {
    const { dir, git, remote } = repo();
    try {
      mkdirSync(join(dir, "services/svc-x/src"), { recursive: true });
      writeFileSync(join(dir, "services/svc-x/src/a.ts"), "export const a = 1;\n");
      git("add", "-A"); git("commit", "-qm", "sluzba"); git("push", "-q", "origin", "main");
      git("checkout", "-qb", "t");
      mkdirSync(join(dir, "docs"), { recursive: true });
      git("mv", "services/svc-x/src/a.ts", "docs/a.ts");
      git("commit", "-qm", "presun");
      const sha = git("rev-parse", "HEAD");
      const r = vyber(dir, `refs/heads/t ${sha} refs/heads/t ${ZERO}\n`);
      expect(r.rc, r.out).toBe(0);
      expect(r.p).toMatchObject({ rezim: "vyber", services_change: "true", docs_only: "false", zmeneno: "2" });
    } finally { rmSync(dir, { recursive: true, force: true }); rmSync(remote, { recursive: true, force: true }); }
  });

  it("přesun ze services/ do docs/ v pracovním stromu (git mv, necommitnuto) → services_change=true", () => {
    const { dir, git, remote } = repo();
    try {
      mkdirSync(join(dir, "services/svc-x/src"), { recursive: true });
      writeFileSync(join(dir, "services/svc-x/src/a.ts"), "export const a = 1;\n");
      git("add", "-A"); git("commit", "-qm", "sluzba"); git("push", "-q", "origin", "main");
      git("checkout", "-qb", "t");
      writeFileSync(join(dir, "README.md"), "y\n"); git("add", "-A"); git("commit", "-qm", "t1");
      mkdirSync(join(dir, "docs"), { recursive: true });
      git("mv", "services/svc-x/src/a.ts", "docs/a.ts");
      const sha = git("rev-parse", "HEAD");
      const r = vyber(dir, `refs/heads/t ${sha} refs/heads/t ${ZERO}\n`);
      expect(r.rc, r.out).toBe(0);
      expect(r.p).toMatchObject({ rezim: "vyber", services_change: "true", docs_only: "false" });
    } finally { rmSync(dir, { recursive: true, force: true }); rmSync(remote, { recursive: true, force: true }); }
  });

  it("mutant bez --no-renames by přesun ze services/ NEVIDĚL (měřidlo umí říct ne)", () => {
    const { dir, git, remote } = repo();
    try {
      const cesta = join(dir, "scripts/ci/zmenene-cesty.sh");
      const puvodni = readFileSync(cesta, "utf8");
      const mutant = puvodni.replace(" --no-renames", "");
      expect(mutant, "mutace nesedí na skript").not.toBe(puvodni);
      writeFileSync(cesta, mutant);
      git("add", "-A"); git("commit", "-qm", "mutant");
      mkdirSync(join(dir, "services/svc-x/src"), { recursive: true });
      writeFileSync(join(dir, "services/svc-x/src/a.ts"), "export const a = 1;\n");
      git("add", "-A"); git("commit", "-qm", "sluzba"); git("push", "-q", "origin", "main");
      git("checkout", "-qb", "t");
      mkdirSync(join(dir, "docs"), { recursive: true });
      git("mv", "services/svc-x/src/a.ts", "docs/a.ts");
      git("commit", "-qm", "presun");
      const sha = git("rev-parse", "HEAD");
      const r = vyber(dir, `refs/heads/t ${sha} refs/heads/t ${ZERO}\n`);
      expect(r.p, "s detekcí přejmenování vidí jen docs/a.ts").toMatchObject({ rezim: "vyber", services_change: "false", docs_only: "true" });
    } finally { rmSync(dir, { recursive: true, force: true }); rmSync(remote, { recursive: true, force: true }); }
  });

  it("merge commit v rozsahu → výběr proti bázi (společný předek s origin/main), ne plná sada", () => {
    const { dir, git, remote } = repo();
    try {
      git("checkout", "-qb", "t");
      writeFileSync(join(dir, "docs.md"), "t\n"); git("add", "-A"); git("commit", "-qm", "t1");
      git("checkout", "-q", "main");
      writeFileSync(join(dir, "jiny.md"), "m\n"); git("add", "-A"); git("commit", "-qm", "m1");
      git("push", "-q", "origin", "main");
      git("checkout", "-q", "t");
      git("merge", "-q", "--no-ff", "-m", "merge main", "main");
      const sha = git("rev-parse", "HEAD");
      const r = vyber(dir, `refs/heads/t ${sha} refs/heads/t ${ZERO}\n`);
      expect(r.rc, r.out).toBe(0);
      expect(r.p, r.out).toMatchObject({ rezim: "vyber", slouceni: "1", zmeneno: "1", cesta: "docs.md" });
      expect(r.out, "co přinesl main, už v mainu je — do rozsahu nepatří").not.toMatch(/^cesta=jiny\.md$/m);
    } finally { rmSync(dir, { recursive: true, force: true }); rmSync(remote, { recursive: true, force: true }); }
  });

  it("nová větev bez origin/main → ŠIRŠÍ dráha (báze neznámá), ne plná sada a ne nic", () => {
    const { dir, git, remote } = repo();
    try {
      git("update-ref", "-d", "refs/remotes/origin/main");
      git("checkout", "-qb", "t");
      writeFileSync(join(dir, "a.md"), "x\n"); git("add", "-A"); git("commit", "-qm", "t1");
      const sha = git("rev-parse", "HEAD");
      const r = vyber(dir, `refs/heads/t ${sha} refs/heads/t ${ZERO}\n`);
      expect(r.p.rezim).toBe("sirsi");
      expect(r.p.duvod).toMatch(/báze neznámá/);
    } finally { rmSync(dir, { recursive: true, force: true }); rmSync(remote, { recursive: true, force: true }); }
  });

  it("remote sha, které lokálně neznáme: báze z origin/main; bez origin/main → ŠIRŠÍ dráha", () => {
    const { dir, git, remote } = repo();
    try {
      git("checkout", "-qb", "t");
      mkdirSync(join(dir, "services/svc-x"), { recursive: true });
      writeFileSync(join(dir, "services/svc-x/a.ts"), "x\n"); git("add", "-A"); git("commit", "-qm", "t1");
      const sha = git("rev-parse", "HEAD");
      const radek = `refs/heads/t ${sha} refs/heads/t ${"1".repeat(40)}\n`;
      expect(vyber(dir, radek).p, "neznámé remote sha nevadí, když je báze z origin/main").toMatchObject({ rezim: "vyber", services_change: "true" });
      git("update-ref", "-d", "refs/remotes/origin/main");
      const r = vyber(dir, radek);
      expect(r.p.rezim).toBe("sirsi");
      expect(r.p.duvod).toMatch(/báze neznámá/);
    } finally { rmSync(dir, { recursive: true, force: true }); rmSync(remote, { recursive: true, force: true }); }
  });

  it("víc cest než strop → ŠIRŠÍ; AISHA_PREPUSH_VSE=1 → PLNÁ sada; mazání větve → ŠIRŠÍ (nic k posouzení)", () => {
    const { dir, git, remote } = repo();
    try {
      git("checkout", "-qb", "t");
      mkdirSync(join(dir, "docs"), { recursive: true });
      writeFileSync(join(dir, "docs/a.md"), "x\n"); writeFileSync(join(dir, "docs/b.md"), "y\n");
      git("add", "-A"); git("commit", "-qm", "t1");
      const sha = git("rev-parse", "HEAD");
      const radek = `refs/heads/t ${sha} refs/heads/t ${ZERO}\n`;
      expect(vyber(dir, radek, { AISHA_PREPUSH_MAX_SOUBORU: "1" }).p).toMatchObject({ rezim: "sirsi", duvod: expect.stringMatching(/> 1/) });
      expect(vyber(dir, radek, { AISHA_PREPUSH_MAX_SOUBORU: "x" }).p).toMatchObject({ rezim: "sirsi", duvod: expect.stringMatching(/není číslo/) });
      expect(vyber(dir, radek, { AISHA_PREPUSH_VSE: "1" }).p).toMatchObject({ rezim: "vse", duvod: expect.stringMatching(/vynucena/) });
      expect(vyber(dir, `(delete) ${ZERO} refs/heads/t ${sha}\n`).p).toMatchObject({ rezim: "sirsi", duvod: expect.stringMatching(/mazání/) });
      expect(vyber(dir, radek).p, "kontrolní vzorek: bez omezení projde výběr").toMatchObject({ rezim: "vyber", docs_only: "true" });
    } finally { rmSync(dir, { recursive: true, force: true }); rmSync(remote, { recursive: true, force: true }); }
  });
});
