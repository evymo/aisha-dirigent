/**
 * Brána: deploy větev mimo `main` musí NÉST důvod — a měřítko se bere z URL.
 *
 * Manifest instance smí deklarovat jinou deploy větev než `main` (cold-start
 * krok 2b2 ji z něj bere). Je to legitimní dočasná odchylka — dokud něco nese.
 * Až se slije do upstreamu, nenese nic a nasazovat z ní dál znamená stavět ze
 * stavu, který se přestal hýbat. Ta chvíle nastane TIŠE; proto ji měří doktor
 * (fáze E) přes `scripts/lib/deploy-vetev-odchylka.sh` a tahle brána spouští
 * TENTÝŽ domov nad dočasnými repozitáři.
 *
 * Měří se VLASTNOST (tip větve je/není předkem upstreamu), ne stáří. Měřítko se
 * vybírá podle URL remote, ne podle jména (`upstream` může ukazovat na mezifork).
 *
 * ⛔ NAMĚŘENO 2026-09-25 (<fork>): první verze brala upstream i z FORGEJO_REPO.
 * To je ale repo, ZE KTERÉHO Coolify staví — u forku fork sám. Samostatný doktor
 * ho v prostředí neměl a vyšel správně; uvnitř cold-startu, který env načítá, by
 * měřil odchylku proti vlastnímu `main`. Test (5) to drží.
 *
 * Remote-tracking refy se nastavují `update-ref`, síť se nepotřebuje.
 */
import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { originRepo } from "../../../scripts/lib/git-origin.mjs";
import { envWithoutGitLocation } from "../../../scripts/lib/git-worktree-health.mjs";

const ROOT = process.cwd();
const LIB = join(ROOT, "scripts/lib/deploy-vetev-odchylka.sh");
const UPSTREAM = "https://repo.example.test/aisha/evymo-ai-orchestrator.git";
const FORK = "https://oauth2:tajne@repo.example.test/aisha/testfork-orchestrator.git";
const MEZIFORK = "https://repo.example.test/jiny/mezifork.git";

type Repo = { dir: string; g: (...a: string[]) => string; commit: (zprava: string) => string };

function gitV(dir: string) {
  return (...a: string[]) =>
    execFileSync("git", ["-C", dir, "-c", "user.name=brana", "-c", "user.email=brana@example.invalid", ...a], {
      encoding: "utf8",
      // ⛔ Pod pre-push hookem git exportuje GIT_DIR: `git -C <tmp> init` by bez
      // tohohle mířil do SKUTEČNÉHO repa (naměřeno 2026-09-25, commit selhal jen
      // proto, že GIT_DIR neměl pracovní strom).
      env: envWithoutGitLocation(),
    }).trim();
}

/**
 * main: A; deploy větev nasazeni/x: A → D („oprava čeká na slití"); upstream main: A → U.
 * Postaví se JEDNOU a testy dostanou kopii — dvanáct volání gitu na test by bránu
 * vytlačilo nad práh lehké dráhy, aniž by měřila víc.
 */
const SABLONA = (() => {
  const dir = mkdtempSync(join(tmpdir(), "deploy-vetev-sablona-"));
  const g = gitV(dir);
  const commit = (zprava: string) => {
    g("commit", "-q", "--allow-empty", "-m", zprava);
    return g("rev-parse", "HEAD");
  };
  g("init", "-q", "-b", "main");
  const A = commit("zaklad");
  g("checkout", "-q", "-b", "nasazeni/x");
  const D = commit("oprava ceka na sliti");
  g("checkout", "-q", "main");
  const U = commit("upstream se pohnul");
  g("remote", "add", "origin", FORK);
  g("remote", "add", "zdroj", UPSTREAM);
  g("update-ref", "refs/remotes/origin/nasazeni/x", D);
  g("update-ref", "refs/remotes/origin/main", A);
  g("update-ref", "refs/remotes/zdroj/main", U);
  return { dir, A, D, U };
})();

function repo(): Repo & { A: string; D: string; U: string } {
  const dir = mkdtempSync(join(tmpdir(), "deploy-vetev-"));
  cpSync(SABLONA.dir, dir, { recursive: true });
  const g = gitV(dir);
  const commit = (zprava: string) => {
    g("commit", "-q", "--allow-empty", "-m", zprava);
    return g("rev-parse", "HEAD");
  };
  return { dir, g, commit, A: SABLONA.A, D: SABLONA.D, U: SABLONA.U };
}

function manifest(radky: string): string {
  const f = join(mkdtempSync(join(tmpdir(), "deploy-vetev-manifest-")), "x.manifest");
  writeFileSync(f, `repo: aisha/testfork-orchestrator\n${radky}`);
  return f;
}

/** Spustí domov s podvrženými ok/warn/fail; vrátí řádky s verdiktem. */
function mer(r: { dir: string }, man: string, env: Record<string, string> = {}) {
  const skript = 'ok(){ echo "OK $*"; }; warn(){ echo "WARN $*"; }; fail(){ echo "FAIL $*"; }; . "$0"; deploy_vetev_odchylka "$1" "$2"';
  const p = spawnSync("bash", ["-c", skript, LIB, r.dir, man], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
  });
  const out = p.stdout ?? "";
  const verdikt = out.split("\n").find((l) => /^(OK|WARN|FAIL) /.test(l)) ?? `(žádný verdikt) ${p.stderr}`;
  return { verdikt, out };
}

const NESE = "branch: nasazeni/x\nupstream_repo: aisha/evymo-ai-orchestrator\nupstream_pr: PR 1234\n";

describe("deploy větev mimo main musí nést důvod", () => {
  it("1) branch: main → bez odchylky", () => {
    expect(mer(repo(), manifest("branch: main\n")).verdikt).toMatch(/^OK .*bez odchylky/);
  });

  it("2) větev nese commit, který upstream nemá → hlasité varování s výčtem a odkazem na PR", () => {
    const { verdikt, out } = mer(repo(), manifest(NESE));
    expect(verdikt).toMatch(/^WARN .*nese 1 commit\(ů\) navíc proti zdroj\/main/);
    expect(verdikt).toMatch(/Ruší ji: PR 1234/);
    expect(out, "výčet musí jmenovat, co odchylka nese").toMatch(/oprava ceka na sliti/);
  });

  it("3) odchylka je slitá (tip je předkem upstreamu) → ČERVENÁ, přepni zpět na main", () => {
    const r = repo();
    r.g("checkout", "-q", "-b", "slito", r.D);
    const S = r.commit("upstream slil opravu");
    r.g("update-ref", "refs/remotes/zdroj/main", S);
    expect(mer(r, manifest(NESE)).verdikt).toMatch(/^FAIL .*UŽ NIC NENESE.*zdroj\/main/);
  });

  it("4) upstream není deklarovaný → NEZMĚŘENO je červená, ne zelená", () => {
    expect(mer(repo(), manifest("branch: nasazeni/x\n")).verdikt).toMatch(/^FAIL .*NEZMĚŘENO.*není deklarované/);
  });

  it("5) FORGEJO_REPO (fork, ze kterého Coolify staví) NENÍ měřítko", () => {
    // S manifestem se měří proti upstreamu, ne proti forku z prostředí.
    const s = mer(repo(), manifest(NESE), { FORGEJO_REPO: "aisha/testfork-orchestrator" });
    expect(s.verdikt).toMatch(/^WARN .*proti zdroj\/main/);
    // A sám o sobě upstream nedeklaruje.
    const bez = mer(repo(), manifest("branch: nasazeni/x\n"), { FORGEJO_REPO: "aisha/testfork-orchestrator" });
    expect(bez.verdikt).toMatch(/^FAIL .*NEZMĚŘENO/);
  });

  it("6) měřítko podle URL, ne podle jména: remote `upstream` na meziforku se ignoruje", () => {
    const r = repo();
    // Mezifork už opravu má — měření podle jména by řeklo „už nic nenese".
    r.g("remote", "add", "upstream", MEZIFORK);
    r.g("checkout", "-q", "-b", "mezi", r.D);
    r.g("update-ref", "refs/remotes/upstream/main", r.commit("mezifork slil"));
    expect(mer(r, manifest(NESE)).verdikt).toMatch(/^WARN .*proti zdroj\/main/);
  });

  it("7) deklarovaný upstream, ale žádný remote s jeho URL → NEZMĚŘENO", () => {
    const r = repo();
    r.g("remote", "remove", "zdroj");
    expect(mer(r, manifest(NESE)).verdikt).toMatch(/^FAIL .*NEZMĚŘENO.*žádný remote neodpovídá/);
  });

  it("8) deploy větev neexistuje lokálně ani na originu → NEZMĚŘENO", () => {
    const man = manifest("branch: neni/takova\nupstream_repo: aisha/evymo-ai-orchestrator\n");
    expect(mer(repo(), man).verdikt).toMatch(/^FAIL .*NEZMĚŘENO.*neexistuje/);
  });

  it("9) AISHA_UPSTREAM_REPO má přednost před manifestem", () => {
    const r = repo();
    r.g("remote", "add", "jiny", MEZIFORK);
    r.g("update-ref", "refs/remotes/jiny/main", r.A);
    expect(mer(r, manifest(NESE), { AISHA_UPSTREAM_REPO: "jiny/mezifork" }).verdikt).toMatch(/^WARN .*proti jiny\/main/);
  });

  it("10) deklarace i s hostitelem se trefí celá", () => {
    const man = manifest("branch: nasazeni/x\nupstream_repo: repo.example.test/aisha/evymo-ai-orchestrator\n");
    expect(mer(repo(), man).verdikt).toMatch(/^WARN .*proti zdroj\/main/);
  });
});

describe("originRepo: jedna identita repozitáře, ať ho kdo zapsal jakkoli", () => {
  const CIL = "repo.id3a.cz/aisha/evymo-ai-orchestrator";
  it.each([
    ["https://oauth2:TOKEN@repo.id3a.cz/Aisha/Evymo-AI-Orchestrator.git", CIL],
    ["git@repo.id3a.cz:aisha/evymo-ai-orchestrator.git", CIL],
    ["ssh://git@repo.id3a.cz:2222/aisha/evymo-ai-orchestrator.git", CIL],
    ["https://repo.id3a.cz/aisha/evymo-ai-orchestrator/", CIL],
    // Pořadí ořezu: lomítka první, jinak `.git/` projde kolem `\.git$`.
    ["https://repo.id3a.cz/aisha/evymo-ai-orchestrator.git/", CIL],
    ["", ""],
    ["aisha/evymo-ai-orchestrator", ""],
  ])("%j → %j", (vstup, cekam) => {
    expect(originRepo(vstup)).toBe(cekam);
  });
});
