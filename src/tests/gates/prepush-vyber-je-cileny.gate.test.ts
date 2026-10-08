/**
 * Brána: pre-push pouští CÍLENĚ — a při nejistotě ŠIRŠÍ dráhu, nikdy „nic"
 *
 * ⭐ ROZHODNUTÍ MAJITELE 2026-10-05: „plné sady jen v CI". Celá sada bran, unit,
 * services i build běží na runneru; místně jen cílené testy změněných částí a slučuje
 * se podle závěrů jobů v CI (`npm run ci:verdikt`). Stroj s 11+ relacemi se dusil
 * (swap 9,5/11 GB, load 250+) a pre-push integrační dávky — která šla vždy celou
 * sadou, protože „merge commit v rozsahu = vše" — spadl na 37 timeoutech zátěže.
 *
 * CO SE MĚŘÍ: CHOVÁNÍ skutečných skriptů (scripts/ci/prepush-vyber.sh →
 * scripts/ci/prepush-cilene.mjs --plan, tatáž roura jako v .husky/pre-push) nad
 * dočasným gitem s malou fixturou (balíčky, brány, lanes.json ze stromu):
 *   (a) změna v jednom balíčku → jen jeho sada + brány, které ho jmenují + třídní
 *       brány (trida-repo: zákon nad celou třídou souborů, běží vždy)
 *   (b) integrační dávka s merge commitem → rozdíl proti bázi (společný předek
 *       s origin/main), ne „vše" a ne to, co dávka stáhla z mainu
 *   (c) neznámá cesta → ŠIRŠÍ dráha (celá lehká dráha bran) a cesta ve výpisu
 *   (d) pád směrovače i pád výběru bran → ŠIRŠÍ dráha, ne „nic"
 * Kotvy (měřidlo umí říct NE): mutant „merge = vše" (vrácené chování před
 * 2026-10-05) shodí (b); mutant „neznámá = nic" v selektoru i v plánovači shodí (c).
 * Hák sám: plná sada a zápis do cache zelených stromů (`--rezim vse`) JEN
 * s AISHA_PREPUSH_VSE=1; cílený i nouzový běh zapisují jiný režim, takže
 * scripts/lib/ci-zelene.mjs je nezapíše (měřeno nad podstrčeným node/npm).
 *
 * HERMETIČNOST: podprocesy dostávají prostředí BEZ přepínačů sady (PROMENNE_SADY,
 * AISHA_SMOKE_*, AISHA_PREPUSH_*, AISHA_CI_ZNOVU) a co potřebují, mají výslovně.
 * ⛔ NAMĚŘENO 2026-10-05 při pushi dávky 4a: tahle brána běžela UVNITŘ cíleného háku,
 * který už exportoval AISHA_SMOKE_SKIP_*=1, a simulovaný hák je zdědil. Kotva
 * „hermetičnost" proto pouští tytéž scénáře s prostředím volajícího plným přepínačů.
 *
 * Bez verdiktu na uplynulém čase: vše jsou ano/ne výsledky logiky nad daným vstupem.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { envWithoutGitLocation } from "../../../scripts/lib/git-worktree-health.mjs";
import { prostrediBezPrepinacuSady } from "../../../scripts/lib/ci-zelene.mjs";

const ROOT = join(__dirname, "../../..");
const ZERO = "0".repeat(40);
const SKRIPTY = [
  "scripts/ci/zmenene-cesty.sh",
  "scripts/ci/prepush-vyber.sh",
  "scripts/ci/prepush-cilene.mjs",
  "scripts/test/brany-dotcene.mjs",
  "scripts/test/run-service-tests.mjs",
  "scripts/lib/cli-entry.mjs",
  ".husky/pre-push",
];
const LANES = JSON.parse(readFileSync(join(ROOT, "src/tests/gates/lanes.json"), "utf8")) as {
  kategorie: Record<string, { brany: string[]; vzdy?: boolean }>;
};
/** Třídní brány (trida-repo, `vzdy`) jdou do KAŽDÉHO výběru; ve fixtuře jsou to stuby. */
const TRIDNI = Object.values(LANES.kategorie).filter((k) => k.vzdy).flatMap((k) => k.brany).map((b) => `src/tests/gates/${b}.gate.test.ts`);
/** Očekávaný výběr bran při změně v packages/demo: brána, která ho jmenuje, + třídní. */
const BRANY_DEMO = [...new Set(["src/tests/gates/hlida-demo.gate.test.ts", ...TRIDNI])].sort();
const GIT_ENV = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

const docasne: string[] = [];
let SABLONA = "";

function zapis(dir: string, rel: string, obsah: string): void {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), obsah);
}

function gitV(dir: string) {
  return (...a: string[]): string => {
    // Hook (pre-push) exportuje GIT_DIR & spol. — bez čistého env by dočasný git sáhl na repo volajícího.
    const r = spawnSync("git", a, { cwd: dir, encoding: "utf8", env: envWithoutGitLocation({ ...process.env, ...GIT_ENV }) });
    if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
}

/** Šablona: skutečné skripty, lanes.json ze stromu, stuby bran z kategorií, dva balíčky, web. */
function postavSablonu(): string {
  const koren = mkdtempSync(join(tmpdir(), "prepush-cileny-"));
  docasne.push(koren);
  const dir = join(koren, "repo");
  const remote = join(koren, "remote.git");
  mkdirSync(dir);
  spawnSync("git", ["init", "-q", "--bare", remote], { env: envWithoutGitLocation() });
  const git = gitV(dir);
  git("init", "-q", "--initial-branch=main");
  for (const s of SKRIPTY) {
    zapis(dir, s, readFileSync(join(ROOT, s), "utf8"));
    chmodSync(join(dir, s), 0o755);
  }
  zapis(dir, "src/tests/gates/lanes.json", readFileSync(join(ROOT, "src/tests/gates/lanes.json"), "utf8"));
  // Mapa musí ukazovat na existující brány (jinak je „shnilá“ a výběr padá na lehkou dráhu).
  for (const k of Object.values(LANES.kategorie)) for (const b of k.brany) zapis(dir, `src/tests/gates/${b}.gate.test.ts`, "// stub\n");
  zapis(dir, "src/tests/gates/hlida-demo.gate.test.ts", 'const P = "packages/demo/package.json";\n');
  zapis(dir, "src/tests/gates/hlida-jiny.gate.test.ts", 'const P = "packages/jiny";\n');
  for (const b of ["demo", "jiny"]) {
    zapis(dir, `packages/${b}/package.json`, JSON.stringify({ name: `@aisha/${b}`, scripts: { test: "vitest run" } }));
    zapis(dir, `packages/${b}/vitest.config.ts`, "export default {};\n");
    zapis(dir, `packages/${b}/src/a.ts`, "export const a = 1;\n");
    zapis(dir, `packages/${b}/src/a.test.ts`, 'import { a } from "./a";\n');
  }
  zapis(dir, "tsconfig.app.json", JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }));
  zapis(dir, "src/lib/x.ts", "export const x = 1;\n");
  zapis(dir, "src/lib/y.ts", "export const y = 1;\n");
  zapis(dir, "src/tests/lib/x.test.ts", 'import { x } from "@/lib/x";\n');
  zapis(dir, "src/tests/lib/y.test.ts", 'import { y } from "@/lib/y";\n');
  git("add", "-A");
  git("commit", "-qm", "zaklad");
  git("remote", "add", "origin", remote);
  git("push", "-q", "origin", "main");
  return koren;
}

/** Čerstvá kopie šablony (repo + remote; origin míří relativně ke kopii). */
function fixtura(): { dir: string; git: (...a: string[]) => string } {
  const koren = mkdtempSync(join(tmpdir(), "prepush-cileny-k-"));
  docasne.push(koren);
  cpSync(SABLONA, koren, { recursive: true });
  const dir = join(koren, "repo");
  const git = gitV(dir);
  git("remote", "set-url", "origin", join(koren, "remote.git"));
  return { dir, git };
}

type Plan = {
  rezim: string;
  duvody: string[];
  slouceni: number;
  brany: { draha: string | null; soubory: string[] };
  workspace: { adresare: string[] };
  testy: { jmeno: string; soubory: string[] }[];
};

/** Tatáž roura jako hák: prepush-vyber.sh → prepush-cilene.mjs --plan. */
function plan(dir: string, refs: string, env: Record<string, string> = {}, zaklad: NodeJS.ProcessEnv = process.env): { rc: number; plan: Plan | null; vypis: string } {
  const r = spawnSync("bash", ["-c", "bash scripts/ci/prepush-vyber.sh origin | node scripts/ci/prepush-cilene.mjs --plan"], {
    // Hermeticky: bez git lokace a bez přepínačů sady volajícího; co test chce, nastaví výslovně.
    cwd: dir, encoding: "utf8", input: refs, env: envWithoutGitLocation({ ...prostrediBezPrepinacuSady(zaklad), ...env }),
  });
  let p: Plan | null = null;
  try { p = JSON.parse(r.stdout); } catch { p = null; }
  return { rc: r.status ?? -1, plan: p, vypis: `${r.stderr}` };
}

const refT = (git: (...a: string[]) => string) => `refs/heads/t ${git("rev-parse", "HEAD")} refs/heads/t ${ZERO}\n`;

// ── Vlastnosti (vrací seznam porušení; prázdný = drží). Mutanti je musí porušit. ──
function porusuje_b(v: ReturnType<typeof plan>): string[] {
  const out: string[] = [];
  if (v.rc !== 0 || !v.plan) return [`plán nevznikl (kód ${v.rc}) — výpis: ${v.vypis.slice(-300)}`];
  if (v.plan.rezim !== "vyber") out.push(`rezim=${v.plan.rezim}, čekán cílený výběr`);
  if (v.plan.slouceni !== 1) out.push(`merge commitů v rozsahu ${v.plan.slouceni}, čekán 1`);
  if (JSON.stringify(v.plan.workspace.adresare) !== JSON.stringify(["packages/demo"])) out.push(`sady ${v.plan.workspace.adresare}, čekáno jen packages/demo (jiny přišel z mainu)`);
  if (JSON.stringify(v.plan.brany.soubory) !== JSON.stringify(BRANY_DEMO)) out.push(`brány ${v.plan.brany.soubory.length} ≠ ${BRANY_DEMO.length} (hlida-demo + třídní)`);
  return out;
}
function porusuje_c(v: ReturnType<typeof plan>): string[] {
  const out: string[] = [];
  if (v.rc !== 0 || !v.plan) return [`plán nevznikl (kód ${v.rc})`];
  if (v.plan.rezim !== "sirsi") out.push(`rezim=${v.plan.rezim}, čekána širší dráha`);
  if (v.plan.brany.draha !== "light") out.push(`dráha bran ${v.plan.brany.draha}, čekána celá lehká`);
  if (!/neznámá cesta: zbrusu\/novy\.txt/.test(v.vypis)) out.push("neznámá cesta není ve výpisu");
  if (!v.plan.workspace.adresare.includes("packages/demo")) out.push("unit dotčeného workspace se z širší dráhy vytratila");
  return out;
}

beforeAll(() => { SABLONA = postavSablonu(); });
afterAll(() => { for (const d of docasne.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("cílený výběr nad dočasným gitem", () => {
  it("(a) změna v jednom balíčku → jen jeho sada, brány, které ho jmenují, a třídní brány; zbytek se vypíše jako CI", () => {
    const { dir, git } = fixtura();
    git("checkout", "-qb", "t");
    zapis(dir, "packages/demo/src/a.ts", "export const a = 2;\n");
    git("commit", "-qam", "demo");
    const v = plan(dir, refT(git));
    expect(v.rc, v.vypis).toBe(0);
    expect(v.plan).toMatchObject({ rezim: "vyber", brany: { draha: null, soubory: BRANY_DEMO }, workspace: { adresare: ["packages/demo"] } });
    expect(v.plan!.testy.every((t) => t.soubory.length === 0), "webu se změna netýká").toBe(true);
    expect(v.vypis).toMatch(/PŘESKOČENO místně/);
    expect(v.vypis).toMatch(/bran mimo výběr .*dokryje CI: Web: Brány/);
  });

  it("(a') změna modulu webu → jen testy, které ho přímo importují (alias z tsconfig)", () => {
    const { dir, git } = fixtura();
    git("checkout", "-qb", "t");
    zapis(dir, "src/lib/x.ts", "export const x = 2;\n");
    git("commit", "-qam", "web");
    const v = plan(dir, refT(git));
    expect(v.rc, v.vypis).toBe(0);
    expect(v.plan!.rezim).toBe("vyber");
    expect(v.plan!.testy.find((t) => t.jmeno === "web")!.soubory).toEqual(["src/tests/lib/x.test.ts"]);
    expect(v.plan!.workspace.adresare).toEqual([]);
  });

  it("(b) integrační dávka s merge commitem → rozdíl proti bázi, ne vše a ne to, co stáhla z mainu", () => {
    const { dir, git } = fixtura();
    git("checkout", "-qb", "t");
    zapis(dir, "packages/demo/src/a.ts", "export const a = 2;\n");
    git("commit", "-qam", "demo");
    git("checkout", "-q", "main");
    zapis(dir, "packages/jiny/src/a.ts", "export const a = 3;\n");
    git("commit", "-qam", "jiny na mainu");
    git("push", "-q", "origin", "main");
    git("checkout", "-q", "t");
    git("merge", "-q", "--no-ff", "-m", "integrace: main do t", "main");
    const v = plan(dir, refT(git));
    expect(porusuje_b(v), v.vypis).toEqual([]);
    expect(v.vypis).toMatch(/merge commitů: posuzuje se rozdíl proti bázi/);
  });

  it("(c) neznámá cesta → ŠIRŠÍ dráha (celá lehká) a cesta ve výpisu; unit dotčeného workspace zůstává", () => {
    const { dir, git } = fixtura();
    git("checkout", "-qb", "t");
    zapis(dir, "packages/demo/src/a.ts", "export const a = 2;\n");
    zapis(dir, "zbrusu/novy.txt", "x\n");
    git("add", "-A");
    git("commit", "-qm", "neznama");
    const v = plan(dir, refT(git));
    expect(porusuje_c(v), v.vypis).toEqual([]);
    expect(v.vypis).toMatch(/těžká dráha bran mimo výběr .*dokryje CI/);
  });

  it("(d) pád směrovače → ŠIRŠÍ dráha, ne nic", () => {
    const { dir, git } = fixtura();
    const s = join(dir, "scripts/ci/zmenene-cesty.sh");
    const puvodni = readFileSync(s, "utf8");
    const rozbity = puvodni.replace("CHANGED=$(cat)\n", "CHANGED=$(cat)\nexit 3\n");
    expect(rozbity, "mutace nesedí na směrovač").not.toBe(puvodni);
    writeFileSync(s, rozbity);
    git("commit", "-qam", "rozbity smerovac");
    git("push", "-q", "origin", "main");
    git("checkout", "-qb", "t");
    zapis(dir, "packages/demo/src/a.ts", "export const a = 2;\n");
    git("commit", "-qam", "demo");
    const v = plan(dir, refT(git));
    expect(v.rc, v.vypis).toBe(0);
    expect(v.plan).toMatchObject({ rezim: "sirsi", brany: { draha: "light" }, workspace: { adresare: ["packages/demo"] } });
    expect(v.plan!.duvody.join(" ")).toMatch(/směrování/);
  });

  it("(d') pád výběru bran (modul nejde ani nahrát) → ŠIRŠÍ dráha, ne nic a ne pád háku", () => {
    const { dir, git } = fixtura();
    writeFileSync(join(dir, "scripts/test/brany-dotcene.mjs"), 'throw new Error("rozbity selektor");\n');
    git("commit", "-qam", "rozbity selektor");
    git("push", "-q", "origin", "main");
    git("checkout", "-qb", "t");
    zapis(dir, "packages/demo/src/a.ts", "export const a = 2;\n");
    git("commit", "-qam", "demo");
    const v = plan(dir, refT(git));
    expect(v.rc, v.vypis).toBe(0);
    expect(v.plan).toMatchObject({ rezim: "sirsi", brany: { draha: "light" } });
    expect(v.vypis).toMatch(/výběr bran nejde nahrát/);
  });
});

describe("kotvy: měřidlo umí říct NE", () => {
  it("mutant „merge = vše“ (chování před 2026-10-05) shodí (b)", () => {
    const { dir, git } = fixtura();
    const s = join(dir, "scripts/ci/prepush-vyber.sh");
    const puvodni = readFileSync(s, "utf8");
    const kotva = '  diff=$(bash scripts/ci/zmenene-cesty.sh --seznam "$base" "$local_sha"';
    expect(puvodni, "kotva mutace v prepush-vyber.sh chybí — mutant by neměřil nic").toContain(kotva);
    writeFileSync(s, puvodni.replace(kotva, `  [ "$merges" = "0" ] || { echo "rezim=vse"; echo "duvod=merge commit v rozsahu"; exit 0; }\n${kotva}`));
    git("commit", "-qam", "mutant merge=vse");
    git("push", "-q", "origin", "main");
    git("checkout", "-qb", "t");
    zapis(dir, "packages/demo/src/a.ts", "export const a = 2;\n");
    git("commit", "-qam", "demo");
    git("checkout", "-q", "main");
    zapis(dir, "packages/jiny/src/a.ts", "export const a = 3;\n");
    git("commit", "-qam", "jiny na mainu");
    git("push", "-q", "origin", "main");
    git("checkout", "-q", "t");
    git("merge", "-q", "--no-ff", "-m", "integrace", "main");
    expect(porusuje_b(plan(dir, refT(git))).length, "vlastnost (b) mutanta nepoznala").toBeGreaterThan(0);
  });

  it.each([
    ["selektor zapomene neznámou cestu", "scripts/test/brany-dotcene.mjs", "if (!znama) nezname.push(f);", "if (!znama) { /* mutant: neznámá = nic */ }"],
    ["plánovač neznámou cestu nerozšíří", "scripts/ci/prepush-cilene.mjs", ': { draha: "light", soubory: vyber.brany.filter(jeTezka) };', ": { draha: null, soubory: [] };"],
  ])("mutant „neznámá = nic“ (%s) shodí (c)", (_popis, soubor, kotva, mutace) => {
    const { dir, git } = fixtura();
    const s = join(dir, soubor);
    const puvodni = readFileSync(s, "utf8");
    expect(puvodni, `kotva mutace v ${soubor} chybí — mutant by neměřil nic`).toContain(kotva);
    writeFileSync(s, puvodni.replace(kotva, mutace));
    git("commit", "-qam", "mutant neznama=nic");
    git("push", "-q", "origin", "main");
    git("checkout", "-qb", "t");
    zapis(dir, "packages/demo/src/a.ts", "export const a = 2;\n");
    zapis(dir, "zbrusu/novy.txt", "x\n");
    git("add", "-A");
    git("commit", "-qm", "neznama");
    expect(porusuje_c(plan(dir, refT(git))).length, "vlastnost (c) mutanta nepoznala").toBeGreaterThan(0);
  });
});

/**
 * Hák nad podstrčeným `node`/`npm` (zapisují volání do deníku a končí 0; `--over` = MISS).
 * `bash`, `git` i oba skripty výběru jsou skutečné — měří se, CO hák pustí a JAK zapíše cache.
 */
function hak(dir: string, refs: string, env: Record<string, string> = {}, zaklad: NodeJS.ProcessEnv = process.env): { rc: number; denik: string; out: string } {
  const stuby = join(dir, "..", "stuby");
  const denik = join(dir, "..", "denik.txt");
  mkdirSync(stuby, { recursive: true });
  writeFileSync(denik, "");
  const zaznam = `#!/bin/sh
printf '%s|%s|skip=%s,%s,%s,%s,%s\\n' "$(basename "$0")" "$*" "\${AISHA_SMOKE_SKIP_GATES:-}" "\${AISHA_SMOKE_SKIP_UNIT:-}" "\${AISHA_SMOKE_SKIP_SERVICES:-}" "\${AISHA_SMOKE_SKIP_PREFLIGHT:-}" "\${AISHA_SMOKE_SKIP_OFFLINE:-}" >> "${denik}"
case "$*" in *prepush-cilene.mjs*) sed 's/^/  vstup|/' >> "${denik}" ;; esac
case "$*" in *--over*) exit 1 ;; esac
exit 0
`;
  for (const n of ["node", "npm"]) { writeFileSync(join(stuby, n), zaznam); chmodSync(join(stuby, n), 0o755); }
  const r = spawnSync("sh", [".husky/pre-push", "origin"], {
    cwd: dir, encoding: "utf8", input: refs,
    env: envWithoutGitLocation({ ...prostrediBezPrepinacuSady(zaklad), PATH: `${stuby}:${process.env.PATH}`, HOME: join(dir, ".."), ...env }),
  });
  return { rc: r.status ?? -1, denik: readFileSync(denik, "utf8"), out: `${r.stdout}\n${r.stderr}` };
}

describe("hák: plná sada a zápis do cache jen na vynucení", () => {
  it("bez vynucení: celé sady přeskočené a vypsané, cílená dráha dostane plán, cache zapíše jiný režim než vse", () => {
    const { dir, git } = fixtura();
    git("checkout", "-qb", "t");
    zapis(dir, "packages/demo/src/a.ts", "export const a = 2;\n");
    git("commit", "-qam", "demo");
    const h = hak(dir, refT(git));
    expect(h.rc, h.out).toBe(0);
    expect(h.denik).toMatch(/^npm\|run test:stack:ci\|skip=1,1,1,,$/m);
    expect(h.denik).toMatch(/^node\|scripts\/ci\/prepush-cilene\.mjs\|/m);
    expect(h.denik, "cílená dráha musí dostat plán i se změněnými cestami").toMatch(/^ {2}vstup\|cesta=packages\/demo\/src\/a\.ts$/m);
    expect(h.denik).toMatch(/--zapis --beh \d+ --rezim vyber/);
    expect(h.denik, "cílený běh nesmí jít do cache jako plná sada").not.toMatch(/--rezim vse/);
    expect(h.denik, "build je v CI").not.toMatch(/^npm\|run build/m);
  });

  it("AISHA_PREPUSH_VSE=1: plná sada bez přeskoků (extension, n8n, pluginy, build) a zápis --rezim vse", () => {
    const { dir, git } = fixtura();
    git("checkout", "-qb", "t");
    zapis(dir, "packages/demo/src/a.ts", "export const a = 2;\n");
    git("commit", "-qam", "demo");
    const h = hak(dir, refT(git), { AISHA_PREPUSH_VSE: "1" });
    expect(h.rc, h.out).toBe(0);
    expect(h.denik).toMatch(/^npm\|run test:stack:ci\|skip=,,,,$/m);
    for (const krok of [/^npm\|--prefix extensions\/aisha-dirigent test/m, /^npm\|--prefix packages\/n8n-nodes-aisha test/m, /^npm\|run test:plugins/m, /^npm\|run build/m]) expect(h.denik).toMatch(krok);
    expect(h.denik).not.toMatch(/prepush-cilene/);
    expect(h.denik).toMatch(/--zapis --beh \d+ --rezim vse/);
  });

  it("pád výběru v háku → ŠIRŠÍ dráha (cílená dráha dostane rezim=sirsi), cache zapíše sirsi", () => {
    const { dir, git } = fixtura();
    writeFileSync(join(dir, "scripts/ci/prepush-vyber.sh"), "#!/usr/bin/env bash\nexit 7\n");
    git("checkout", "-qb", "t");
    git("commit", "-qam", "rozbity vyber");
    const h = hak(dir, refT(git));
    expect(h.rc, h.out).toBe(0);
    expect(h.denik).toMatch(/^ {2}vstup\|rezim=sirsi$/m);
    expect(h.denik).toMatch(/^npm\|run test:stack:ci\|skip=1,1,1,,$/m);
    expect(h.denik).toMatch(/--zapis --beh \d+ --rezim sirsi/);
  });
});

/** Prostředí volajícího plné přepínačů sady — tak, jak ho dědí brána běžící uvnitř háku. */
const ZNECISTENE: NodeJS.ProcessEnv = {
  ...process.env,
  AISHA_SMOKE_SKIP_GATES: "1", AISHA_SMOKE_SKIP_UNIT: "1", AISHA_SMOKE_SKIP_SERVICES: "1",
  AISHA_SMOKE_SKIP_PREFLIGHT: "1", AISHA_SMOKE_SKIP_OFFLINE: "1",
  AISHA_PREPUSH_VSE: "1", AISHA_PREPUSH_MAX_SOUBORU: "1", AISHA_PREPUSH_STROP_TESTU: "0", AISHA_CI_ZNOVU: "1",
};

describe("hák: vynucená plná sada je plná i s přeskoky v shellu", () => {
  it("uživatel má v shellu AISHA_SMOKE_SKIP_*=1: AISHA_PREPUSH_VSE=1 je vynuluje (stack-smoke i klíč cache bez přeskoků)", () => {
    const { dir, git } = fixtura();
    git("checkout", "-qb", "t");
    zapis(dir, "packages/demo/src/a.ts", "export const a = 2;\n");
    git("commit", "-qam", "demo");
    // Výslovně (ne z prostředí volajícího): právě tohle by měl uživatel v shellu.
    const h = hak(dir, refT(git), {
      AISHA_PREPUSH_VSE: "1", AISHA_SMOKE_SKIP_GATES: "1", AISHA_SMOKE_SKIP_UNIT: "1",
      AISHA_SMOKE_SKIP_SERVICES: "1", AISHA_SMOKE_SKIP_PREFLIGHT: "1", AISHA_SMOKE_SKIP_OFFLINE: "1",
    });
    expect(h.rc, h.out).toBe(0);
    expect(h.denik).toMatch(/^npm\|run test:stack:ci\|skip=,,,,$/m);
    expect(h.denik, "žádný krok plné sady (ani klíč cache) nesmí vidět přeskok").not.toMatch(/\|skip=[^\n]*1/);
    expect(h.denik).toMatch(/--zapis --beh \d+ --rezim vse/);
  });
});

describe("hermetičnost: brána měří totéž, ať ji pustí kdokoli", () => {
  it("(a) s prostředím volajícího plným přepínačů sady → týž cílený plán", () => {
    const { dir, git } = fixtura();
    git("checkout", "-qb", "t");
    zapis(dir, "packages/demo/src/a.ts", "export const a = 2;\n");
    git("commit", "-qam", "demo");
    const v = plan(dir, refT(git), {}, ZNECISTENE);
    expect(v.rc, v.vypis).toBe(0);
    expect(v.plan).toMatchObject({ rezim: "vyber", brany: { draha: null, soubory: BRANY_DEMO }, workspace: { adresare: ["packages/demo"] } });
  });

  it("hák s prostředím volajícího plným přepínačů: bez výslovného vynucení cílený běh, s ním plná sada bez přeskoků", () => {
    const { dir, git } = fixtura();
    git("checkout", "-qb", "t");
    zapis(dir, "packages/demo/src/a.ts", "export const a = 2;\n");
    git("commit", "-qam", "demo");
    const cileny = hak(dir, refT(git), {}, ZNECISTENE);
    expect(cileny.rc, cileny.out).toBe(0);
    expect(cileny.denik).toMatch(/^npm\|run test:stack:ci\|skip=1,1,1,,$/m);
    expect(cileny.denik).toMatch(/--zapis --beh \d+ --rezim vyber/);
    const plna = hak(dir, refT(git), { AISHA_PREPUSH_VSE: "1" }, ZNECISTENE);
    expect(plna.rc, plna.out).toBe(0);
    expect(plna.denik).toMatch(/^npm\|run test:stack:ci\|skip=,,,,$/m);
    expect(plna.denik).toMatch(/--zapis --beh \d+ --rezim vse/);
  });
});
