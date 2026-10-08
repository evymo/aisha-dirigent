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
 * ⛔ NEDŮVĚŘIVÉ ČTENÍ 2026-10-03 (nálezy 1d a 2): měřítko se vybíralo podle URL, ale
 * TIP deploy větve ne — bral se z remote zvykového jména, jinak z místní větve
 * téhož jména. Ve fork checkoutu to zvykové jméno ukazuje na upstream. A větev
 * sama se četla vlastním awk (první výskyt, bez komentářů, bez odsazení), tedy
 * jiným pravidlem než story-init, který ji do Coolify zapisuje. Testy (11)–(16):
 * větev dává jeden výklad deklarace, tip jen sledovací reference remote, který
 * JE nasazovaný repozitář (podle identity URL); cokoli jiného je NEZMĚŘENO.
 * Testy (17)–(18): i upstream a odkaz na PR čte týž výklad (vlastní awk nad
 * manifestem tu nezůstal žádný) — stejná pravidla, chybějící klíč není chyba.
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

  it("8) sledovací reference deploy větve na remote nasazovaného repozitáře neexistuje → NEZMĚŘENO", () => {
    const man = manifest("branch: neni/takova\nupstream_repo: aisha/evymo-ai-orchestrator\n");
    expect(mer(repo(), man).verdikt).toMatch(/^FAIL .*NEZMĚŘENO.*sledovací reference 'origin\/neni\/takova'.*neexistuje/);
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

  it("11) fork checkout: tip se bere z remote nasazovaného repozitáře, NE ze zvykového jména", () => {
    // Zvykové jméno remote ukazuje na upstream (tvar fork checkoutu) a nese větev
    // téhož jména, která je předkem upstreamu — čtení podle jména by řeklo
    // „už nic nenese“. Repozitář, ze kterého se staví, je pod jiným jménem.
    const r = repo();
    r.g("remote", "remove", "origin");
    r.g("remote", "remove", "zdroj");
    r.g("remote", "add", "origin", UPSTREAM);
    r.g("update-ref", "refs/remotes/origin/main", r.U);
    r.g("update-ref", "refs/remotes/origin/nasazeni/x", r.A);
    r.g("remote", "add", "vlastni", FORK);
    r.g("update-ref", "refs/remotes/vlastni/nasazeni/x", r.D);
    const { verdikt, out } = mer(r, manifest(NESE));
    expect(verdikt).toMatch(/^WARN .*nese 1 commit\(ů\) navíc proti origin\/main/);
    expect(out).toMatch(/oprava ceka na sliti/);
  });

  it("12) místní větev téhož jména měřítkem NENÍ: bez sledovací reference → NEZMĚŘENO", () => {
    const r = repo();
    r.g("update-ref", "-d", "refs/remotes/origin/nasazeni/x");
    // Kontrola stanoviště: místní větev existuje a odchylku nese.
    expect(r.g("rev-parse", "refs/heads/nasazeni/x")).toBe(r.D);
    expect(mer(r, manifest(NESE)).verdikt).toMatch(
      /^FAIL .*NEZMĚŘENO.*sledovací reference 'origin\/nasazeni\/x'.*neexistuje.*místní větev téhož jména měřítkem není/,
    );
  });

  it("13) žádný remote není nasazovaný repozitář → NEZMĚŘENO s důvodem", () => {
    const r = repo();
    r.g("remote", "remove", "origin");
    expect(mer(r, manifest(NESE)).verdikt).toMatch(
      /^FAIL .*NEZMĚŘENO.*tip větve 'nasazeni\/x' nemám odkud vzít.*žádný remote checkoutu neukazuje na nasazovaný repozitář/,
    );
  });

  it("14) nevyložitelná deklarace větve → NEZMĚŘENO, ne `main`", () => {
    // Dřív: awk vzal první řádek, prázdnou hodnotu četl jako main → „bez odchylky“.
    for (const [radky, vzor] of [
      ["branch: main\nbranch: nasazeni/x\n", /nejednoznačná/],
      ["branch:\n", /PRÁZDNOU hodnotou/],
    ] as const) {
      const v = mer(repo(), manifest(radky)).verdikt;
      expect(v, radky).toMatch(/^FAIL deploy větev NEZMĚŘENO — deklaraci manifestu nejde vyložit/);
      expect(v, radky).toMatch(vzor);
    }
  });

  it("15) větev čte týž výklad jako story-init: odsazení, komentář za hodnotou, uvozovky", () => {
    // Dřív: odsazený řádek awk neviděl (→ main, „bez odchylky“) a komentář přilepil k větvi.
    // Cesta upstreamu z téže adresy, kterou nese šablona repozitáře (remote `zdroj`).
    const upstream = new URL(UPSTREAM).pathname.replace(/^\/|\.git$/g, "");
    for (const radek of ["  branch: nasazeni/x", "branch: nasazeni/x   # odchylka čeká na slití", 'branch: "nasazeni/x"']) {
      const man = manifest(`${radek}\nupstream_repo: ${upstream}\n`);
      expect(mer(repo(), man).verdikt, radek).toMatch(/^WARN deploy větev 'nasazeni\/x' nese 1 commit/);
    }
  });

  it("16) s deklarovanou adresou Forgeja rozhoduje celá identita (hostitel i cesta)", () => {
    expect(mer(repo(), manifest(NESE), { FORGEJO_URL: "https://repo.example.test" }).verdikt).toMatch(/^WARN .*nese 1 commit/);
    // Táž cesta na jiném hostiteli není repozitář, ze kterého se staví.
    expect(mer(repo(), manifest(NESE), { FORGEJO_URL: "https://jinde.example.test" }).verdikt).toMatch(
      /^FAIL .*NEZMĚŘENO.*žádný remote checkoutu neukazuje na nasazovaný repozitář https:\/\/jinde\.example\.test\//,
    );
  });

  it("17) upstream čte týž výklad: odsazení, uvozovky a komentář za hodnotou nevadí; odkaz na PR smí nést `#` v uvozovkách", () => {
    // Dřív (awk): odsazený řádek neviděl, uvozovky nechal v hodnotě a odkaz na PR uřízl u druhé dvojtečky.
    const upstream = new URL(UPSTREAM).pathname.replace(/^\/|\.git$/g, "");
    const man = manifest(`branch: nasazeni/x\n  upstream_repo: "${upstream}"   # rodič\nupstream_pr: "PR #12: oprava"\n`);
    const { verdikt } = mer(repo(), man);
    expect(verdikt).toMatch(/^WARN .*nese 1 commit\(ů\) navíc proti zdroj\/main/);
    expect(verdikt).toMatch(/Ruší ji: PR #12: oprava\./);
  });

  it("18) nevyložitelný upstream → NEZMĚŘENO; chybějící odkaz na PR chyba není", () => {
    const upstream = new URL(UPSTREAM).pathname.replace(/^\/|\.git$/g, "");
    const dvakrat = mer(repo(), manifest(`branch: nasazeni/x\nupstream_repo: ${upstream}\nupstream_repo: jiny/zdroj\n`)).verdikt;
    expect(dvakrat).toMatch(/^FAIL deploy větev NEZMĚŘENO — deklaraci manifestu nejde vyložit.*2 řádky `upstream_repo:`/);
    const neparova = mer(repo(), manifest(`branch: nasazeni/x\nupstream_repo: "${upstream}\n`)).verdikt;
    expect(neparova).toMatch(/^FAIL deploy větev NEZMĚŘENO — deklaraci manifestu nejde vyložit.*NEPÁROVOU uvozovkou/);
    // Bez odkazu na PR: měří se dál, jen věta o PR chybí.
    const bezPr = mer(repo(), manifest(`branch: nasazeni/x\nupstream_repo: ${upstream}\n`)).verdikt;
    expect(bezPr).toMatch(/^WARN .*nese 1 commit/);
    expect(bezPr).not.toMatch(/Ruší ji/);
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
