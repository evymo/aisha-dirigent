/**
 * Brána: čekání ve FRONTĚ Coolify nespotřebuje čas PRÁCE nasazení.
 *
 * PROČ (naměřeno 2026-09-26, <fork>, vlna 7 — 6 appek naráz, Coolify staví 2 souběžně)
 * ---------------------------------------------------------------------------
 * Fronta / stavba+start: openclaw 36 / 7 min, source-broker 43 / 7 min,
 * orchestration 10 / 25 min, domain-services 10 / 37 min. `deploy-and-verify.sh`
 * měl JEDEN strop 1800 s od zařazení, takže „NEDOBĚHLO V ČASE" hlásil i appkám,
 * které se postavily za 7 minut — jen čekaly, až na ně přijde řada. Skript vln pak
 * správně zastavil vlny 8+ a kolo se muselo dotahovat ručně.
 *
 * Tvrzení:
 *   1. `queued` se měří proti FRONTA_S, TIMEOUT_S běží až od opuštění fronty;
 *      hláška řekne, KTERÝ strop došel (nezačalo × práce nedoběhla).
 *   2. Strop práce těžké appky má JEDEN domov (STROP_PRACE_S vedle WAVES), vydá ho
 *      `--print-waves` a skript vln ho opravdu předá jako `--timeout-s`.
 *
 * CHOVÁNÍ, ne text: funkce se vyjme ze SKUTEČNÉHO skriptu a spustí s podstrčeným
 * `curl` (Coolify), `date` a `sleep` (virtuální hodiny) — bez sítě a bez čekání.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { envWithoutGitLocation } from "../../../scripts/lib/git-worktree-health.mjs";

const ROOT = join(__dirname, "../../..");
const SKRIPT = readFileSync(join(ROOT, "scripts/ci/deploy-and-verify.sh"), "utf8");
const REDEPLOY = readFileSync(join(ROOT, "scripts/aisha-redeploy.mjs"), "utf8");

/**
 * Spustí `cekej_na_nasazeni` na virtuálních hodinách. Coolify odpovídá podle času:
 * do `fronta` s `queued`, dalších `prace` s `in_progress`, pak `konecny`.
 * `prazdne` = odpověď bez stavu po celou dobu (nečitelné).
 */
function cekej(o: { fronta: number; prace: number; konecny?: string; frontaS: number; timeoutS: number; opakovat?: boolean; prazdne?: boolean }) {
  const fn = /(cekej_na_nasazeni\(\) \{[\s\S]*?\n\})/.exec(SKRIPT)?.[1];
  if (!fn) throw new Error("funkce cekej_na_nasazeni ve skriptu není");
  const dir = mkdtempSync(join(tmpdir(), "cekej-nasazeni-"));
  writeFileSync(join(dir, "t"), "1000000\n");
  const q = 1_000_000 + o.fronta;
  const w = q + o.prace;
  const harness = [
    "set -uo pipefail",
    `date() { cat "${dir}/t"; }`,
    `sleep() { echo $(( $(cat "${dir}/t") + $1 )) > "${dir}/t"; }`,
    o.prazdne
      ? "curl() { echo ''; }"
      : `curl() { local t; t=$(cat "${dir}/t"); if [ "$t" -lt ${q} ]; then echo '{"status":"queued"}'; elif [ "$t" -lt ${w} ]; then echo '{"status":"in_progress"}'; else echo '{"status":"${o.konecny ?? "finished"}"}'; fi; }`,
    "diagnostikuj_neuplny_prenos() { :; }",
    o.opakovat ? "dalsi_pokus() { return 0; }" : "dalsi_pokus() { return 1; }",
    `APP=x-svc; NASAZENI=NAS1XXXXXXXX; COOLIFY_URL=https://coolify.invalid; COOLIFY_API_TOKEN=x; TIMEOUT_S=${o.timeoutS}; FRONTA_S=${o.frontaS}`,
    fn,
    'cekej_na_nasazeni; echo "NAVRAT STAV=$STAV"',
  ].join("\n");
  const r = spawnSync("bash", ["-c", harness], { cwd: ROOT, encoding: "utf8", timeout: 60_000 });
  rmSync(dir, { recursive: true, force: true });
  return { rc: r.status, out: `${r.stdout}${r.stderr}` };
}

describe("cekej_na_nasazeni — fronta a práce mají každá svůj strop", () => {
  it("fronta 90 s + práce 90 s při stropech 120/120 DOBĚHNE (jeden strop od zařazení by hlásil nedoběhlo)", () => {
    const r = cekej({ fronta: 90, prace: 90, frontaS: 120, timeoutS: 120 });
    expect(r.rc, r.out).toBe(0);
    expect(r.out).toContain("NAVRAT STAV=finished");
    expect(r.out).toMatch(/opustilo frontu po \d+s — od teď běží strop práce 120s/);
  });

  it("nasazení nikdy neopustí frontu → kód 4 a hláška NEZAČALO (fronta), ne „práce nedoběhla“", () => {
    const r = cekej({ fronta: 10_000, prace: 0, frontaS: 120, timeoutS: 120 });
    expect(r.rc, r.out).toBe(4);
    expect(r.out).toContain("NEZAČALO (fronta Coolify)");
    expect(r.out).not.toContain("NAVRAT");
  });

  it("práce přetáhne svůj strop → kód 4 a hláška o PRÁCI; fronta se do něj nepočítá", () => {
    const r = cekej({ fronta: 100, prace: 10_000, frontaS: 120, timeoutS: 120 });
    expect(r.rc, r.out).toBe(4);
    expect(r.out).toContain("PRÁCE je po 120s stále 'in_progress'");
  });

  it("pád bez doložené přechodné příčiny → kód 1 (SELHALO), žádné opakování", () => {
    const r = cekej({ fronta: 30, prace: 30, konecny: "failed", frontaS: 120, timeoutS: 120 });
    expect(r.rc, r.out).toBe(1);
    expect(r.out).toContain("nasazení SELHALO");
  });

  it("pád s verdiktem „opakovat“ → vrátí 0 se STAV=opakovat (další pokus řídí volající)", () => {
    const r = cekej({ fronta: 30, prace: 30, konecny: "failed", frontaS: 120, timeoutS: 120, opakovat: true });
    expect(r.rc, r.out).toBe(0);
    expect(r.out).toContain("NAVRAT STAV=opakovat");
  });

  it("stav nečitelný po celou dobu → kód 1 (nevíme ani, že běží), ne 4", () => {
    const r = cekej({ fronta: 0, prace: 0, frontaS: 120, timeoutS: 120, prazdne: true });
    expect(r.rc, r.out).toBe(1);
    expect(r.out).toContain("nedosáhlo terminálního stavu");
  });
});

/** Pořadí vln z TÉHOŽ zdroje, ze kterého ho čte skript v CI. */
const PORADI = execFileSync(process.execPath, [join(ROOT, "scripts/aisha-redeploy.mjs"), "--print-waves"], {
  cwd: ROOT,
  encoding: "utf8",
  env: { PATH: process.env.PATH ?? "" },
});
const STROPY = new Map(
  PORADI.trim()
    .split("\n")
    .map((r) => r.split("\t"))
    .filter((c) => c.length > 2)
    .map((c) => [c[1], Number(c[2])] as [string, number]),
);

describe("strop práce těžké appky — jeden domov, opravdu doručený", () => {
  it("každý klíč STROP_PRACE_S je appka z WAVES a --print-waves ho vydá (jinak mrtvá konfigurace)", () => {
    const blok = /const STROP_PRACE_S = \{([^}]*)\};/.exec(REDEPLOY)?.[1];
    expect(blok, "STROP_PRACE_S v aisha-redeploy.mjs chybí").toBeTruthy();
    const klice = [...(blok ?? "").matchAll(/"(aisha-[a-z0-9-]+)"\s*:\s*(\d+)/g)].map((m) => m[1].replace(/^aisha-/, ""));
    expect(klice.length).toBeGreaterThan(0);
    expect([...STROPY.keys()].sort()).toEqual([...klice].sort());
  });

  it("strop těžké appky je VĚTŠÍ než výchozí TIMEOUT_S skriptu (jinak nemá smysl)", () => {
    const vychozi = Number(/^TIMEOUT_S=(\d+)\s*$/m.exec(SKRIPT)?.[1] ?? NaN);
    for (const [app, s] of STROPY) expect(s, app).toBeGreaterThan(vychozi);
  });

  let repo = "";
  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "vlny-strop-"));
    mkdirSync(join(repo, "scripts/ci"), { recursive: true });
    copyFileSync(join(ROOT, "scripts/ci/nasad-podle-vln.sh"), join(repo, "scripts/ci/nasad-podle-vln.sh"));
    writeFileSync(
      join(repo, "scripts/aisha-redeploy.mjs"),
      `if (!process.argv.includes("--print-waves")) process.exit(9);\nprocess.stdout.write(${JSON.stringify(PORADI)});\n`,
    );
    const stub = join(repo, "scripts/ci/deploy-and-verify.sh");
    writeFileSync(stub, '#!/usr/bin/env bash\necho "$*" >> "$ZAPIS"\necho "nasazeno $1"\n');
    chmodSync(stub, 0o755);
  });
  afterAll(() => {
    if (repo) rmSync(repo, { recursive: true, force: true });
  });

  it("skript vln předá strop jen appce, která ho má; ostatní jdou s výchozím", () => {
    const [tezka] = [...STROPY.keys()];
    const lehka = "ai-chat";
    const zapis = join(repo, "zapis.txt");
    const r = spawnSync("bash", ["scripts/ci/nasad-podle-vln.sh", "--aplikace", `,${tezka},${lehka},`], {
      cwd: repo,
      encoding: "utf8",
      env: envWithoutGitLocation({ PATH: process.env.PATH ?? "", ZAPIS: zapis }),
      timeout: 30_000,
    });
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    const volani = existsSync(zapis) ? readFileSync(zapis, "utf8").trim().split("\n") : [];
    expect(volani).toContain(`${tezka} --optional --timeout-s ${STROPY.get(tezka)}`);
    expect(volani).toContain(`${lehka} --optional`);
  });
});
