/**
 * Brána: PROSTŘEDÍ BĚHU má jeden domov (CLASS gate) — PR2 izolace cold-startu
 *
 * TŘÍDA VADY: otázku „je tohle produkce, jaký prefix, jaký env soubor, odkud se smí
 * doplňovat" si každý skript odpovídal sám, a každý jinak. NAMĚŘENO 2026-09-24/26
 * (fork, staging na sdíleném Coolify, incident 24. 9. + harness PR1):
 *   - discovery (generate-coolify-context.mjs): „začíná na STAG?" → `<story>-staging`
 *     četl PRODUKČNÍ deklarace serverů (COOLIFY_PROD_SERVER_*) a vydával
 *     COOLIFY_PROD_PROJECT_UUID se stagingovým UUID;
 *   - cold-start, env-doctor, preflight-compose, sync-envs, deploy-init, doktor C/D:
 *     `.env.coolify` napevno → stagingový běh přepsal produkční zdroj pravdy na
 *     stanovišti obsluhy, převzal z něj produkční tajemství (preserve_or_gen)
 *     a env-doctor doplňoval externí klíče ze `.env-prod-backup`.
 *
 * INVARIANT:
 *   1. odpověď žije v `scripts/lib/prostredi-behu.sh` a `.mjs` a obě dávají TOTÉŽ
 *      (tabulka tvarů AISHA_ENV, jeden podproces bash);
 *   2. konzumenti ji používají — žádná vlastní kopie mapování ani napevno `.env.coolify`
 *      jako výchozí cíl;
 *   3. env-doctor v ne-produkčním běhu (chování, ne text): píše do `.env.<env>`,
 *      doplňuje JEN ze zálohy toho prostředí a produkční zálohu ani produkční env
 *      soubor nepřijme.
 * Běh celého cold-startu proti falešnému Coolify měří `cold-start-izolace-prostredi`.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { pbEnvSoubor, pbJeProd, pbPrefix, pbZdrojDoplneni } from "../../../scripts/lib/prostredi-behu.mjs";
import { envWithoutGitLocation } from "../../../scripts/lib/git-worktree-health.mjs";

const ROOT = process.cwd();
const LIB = join(ROOT, "scripts/lib/prostredi-behu.sh");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const bezKomentaru = (src: string) =>
  src.split("\n").filter((r) => !/^\s*(#|\/\/|\*|\/\*)/.test(r)).join("\n");

const ENVY = ["", "production", "prod", "staging", "stg", "inst-staging", "inst-stg", "inst-prod", "acme-production", "divny"];
const REPO = "/repo";

describe("jeden domov: bash a Node dávají totéž", () => {
  // Jeden podproces pro celou tabulku (lehká dráha).
  const radky = (() => {
    const skript = [
      `. "${LIB}"`,
      `for e in ${ENVY.map((e) => `'${e}'`).join(" ")}; do`,
      '  if pb_je_prod "$e"; then p=1; else p=0; fi',
      '  x="$(pb_prefix "$e")" || x="<chyba>"',
      `  s="$(pb_env_soubor "${REPO}" "$e")" || s="<chyba>"`,
      `  z1="$(pb_zdroj_doplneni "${REPO}" "$e" "")" || z1="<chyba>"`,
      `  z2="$(pb_zdroj_doplneni "${REPO}" "$e" "${REPO}/.env-stg-backup")" || z2="<chyba>"`,
      `  z3="$(pb_zdroj_doplneni "${REPO}" "$e" "${REPO}/.env-prod-backup")" || z3="<chyba>"`,
      `  z4="$(pb_zdroj_doplneni "${REPO}" "$e" ".env.coolify")" || z4="<chyba>"`,
      '  printf "%s|%s|%s|%s|%s|%s|%s|%s\\n" "$e" "$p" "$x" "$s" "$z1" "$z2" "$z3" "$z4"',
      "done",
    ].join("\n");
    const r = spawnSync("bash", ["-c", skript], { encoding: "utf8" });
    return { r, radky: r.stdout.trim().split("\n") };
  })();
  const abs = (v: string | null) => (v === null ? "<chyba>" : v);

  test("bash tabulku spočítal", () => {
    expect(radky.r.status, radky.r.stderr).toBe(0);
    expect(radky.radky).toHaveLength(ENVY.length);
  });

  test.each(ENVY.map((e, i) => [e === "" ? "(prázdné)" : e, i]))("%s", (_popis, i) => {
    const e = ENVY[i as number];
    const ocekavano = [
      e,
      pbJeProd(e) ? "1" : "0",
      abs(pbPrefix(e)),
      abs(pbEnvSoubor(REPO, e)),
      abs(pbZdrojDoplneni(REPO, e, "")),
      abs(pbZdrojDoplneni(REPO, e, `${REPO}/.env-stg-backup`)),
      abs(pbZdrojDoplneni(REPO, e, `${REPO}/.env-prod-backup`)),
      abs(pbZdrojDoplneni(REPO, e, ".env.coolify")),
    ];
    const bash = radky.radky[i as number].split("|");
    // Relativní záloha: bash ji vrací, jak ji dostal; porovnává se rozřešená cesta.
    if (bash[7] !== "<chyba>") bash[7] = resolve(REPO, bash[7]);
    expect(bash, "bash a Node se v odpovědi rozešly — dvě pravdy o prostředí").toEqual(ocekavano);
  });

  test("tabulka říká, co má (kontrola měřidla)", () => {
    expect(pbPrefix("inst-staging")).toBe("COOLIFY_INST_STAGING_");
    expect(pbJeProd("inst-staging")).toBe(false);
    expect(pbEnvSoubor(REPO, "inst-staging")).toBe(`${REPO}/.env.inst-staging`);
    expect(pbEnvSoubor(REPO, "stg")).toBe(`${REPO}/.env.staging`);
    expect(pbEnvSoubor(REPO, "production")).toBe(`${REPO}/.env.coolify`);
    expect(pbZdrojDoplneni(REPO, "inst-staging", `${REPO}/.env-prod-backup`)).toBeNull();
    expect(pbZdrojDoplneni(REPO, "inst-staging", "")).toBeNull();
    expect(pbZdrojDoplneni(REPO, "", "")).toBe(`${REPO}/.env-prod-backup`);
  });
});

describe("konzumenti se ptají jednoho domova", () => {
  test("obal: prefix z pb_prefix, ne vlastní case", () => {
    const src = bezKomentaru(read("scripts/aisha-cold-start-env.sh"));
    expect(src).toMatch(/prostredi-behu\.sh/);
    expect(src).toMatch(/pb_prefix/);
    expect(src, "obal má vlastní kopii mapování prostředí → prefix").not.toMatch(/prefix="COOLIFY_PROD_"/);
  });

  test("cold-start: env soubor a produkčnost z domova", () => {
    const src = bezKomentaru(read("scripts/aisha-cold-start.sh"));
    expect(src).toMatch(/prostredi-behu\.sh/);
    expect(src, "cold-start zapisuje napevno do produkčního .env.coolify").not.toMatch(/ENV_COOLIFY="\$\{REPO_ROOT\}\/\.env\.coolify"/);
    expect(src).toMatch(/ENV_COOLIFY="\$\(pb_env_soubor /);
    expect(src).toMatch(/pb_zdroj_doplneni/);
  });

  test("discovery: prefix z pbPrefix, ne „začíná na STAG“", () => {
    const src = bezKomentaru(read("scripts/generate-coolify-context.mjs"));
    expect(src).toMatch(/prostredi-behu\.mjs/);
    expect(src, "discovery má vlastní mapování (<story>-staging → COOLIFY_PROD_*)").not.toMatch(/startsWith\(['"]STAG/);
  });

  test.each([
    ["scripts/preflight-compose.sh"],
    ["scripts/coolify-sync-envs.sh"],
    ["scripts/coolify-deploy-init.sh"],
    ["scripts/cold-start-doctor.sh"],
  ])("%s: výchozí env soubor z pb_env_soubor", (soubor) => {
    const src = bezKomentaru(read(soubor));
    expect(src).toMatch(/pb_env_soubor/);
    expect(
      src,
      `${soubor} bere napevno $ROOT/.env.coolify jako výchozí env soubor — ve stagingu je to produkční soubor`,
    ).not.toMatch(/(ENV_FILE="\$\{ENV_FILE:-\$(ROOT|PROJECT_ROOT|REPO_ROOT)\/\.env\.coolify\}"|load_env_file "\$PROJECT_ROOT\/\.env\.coolify"|"\$REPO_ROOT\/\.env\.coolify")/);
  });
});

/**
 * env-doctor jako CHOVÁNÍ: `--report` nic nezapisuje a vypíše cíl (`Target:`) i zdroj
 * doplnění (`External source …: <cesta>`). Dočasný adresář drží zálohy; skutečný
 * `.env.coolify` repa se nečte ani nepíše (ne-produkce ho odmítne, produkce dostane
 * ENV_FILE do dočasného adresáře).
 */
describe("env-doctor v ne-produkčním běhu (chování)", () => {
  const d = mkdtempSync(join(tmpdir(), "prostredi-behu-"));
  writeFileSync(join(d, ".env-stg-backup"), "COHERE_API_KEY=jen-staging\n", { mode: 0o600 });
  writeFileSync(join(d, "cil"), "", { mode: 0o600 });
  const doktor = (env: Record<string, string>) => {
    const r = spawnSync(process.execPath, [join(ROOT, "scripts/aisha-env-doctor.mjs"), "--report"], {
      encoding: "utf8",
      // AISHA_PROFILE: env-doctor bez něj končí dřív, než dojde na izolaci — odmítnutí
      // by pak prošlo z nesprávného důvodu (kontrola měřidla to 2026-09-27 chytila).
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", NO_COLOR: "1", AISHA_PROFILE: "cloud-multi", ...env },
      timeout: 60_000,
    });
    const vystup = stripVTControlCharacters(`${r.stdout ?? ""}${r.stderr ?? ""}`);
    return {
      status: r.status,
      vystup,
      cil: vystup.match(/Target:\s+(\S+)/)?.[1] ?? null,
      zdroj: vystup.match(/External source (?:loaded|not found):\s+(\S+)/)?.[1] ?? null,
    };
  };

  test("bez zálohy prostředí odmítne — nedoplňuje z produkce", () => {
    const r = doktor({ AISHA_ENV: "inst-staging", ENV_FILE: join(d, "cil") });
    expect(r.status, r.vystup).not.toBe(0);
    expect(r.vystup).toMatch(/IZOLACE: .*inst-staging.*nemá zálohu SVÉHO prostředí/);
    expect(r.zdroj, "doplňoval by z produkční zálohy").toBeNull();
  });

  test("produkční záloha v ne-produkčním běhu → odmítne", () => {
    const r = doktor({ AISHA_ENV: "inst-staging", ENV_FILE: join(d, "cil"), ENV_PROD_BACKUP: join(ROOT, ".env-prod-backup") });
    expect(r.status, r.vystup).not.toBe(0);
    expect(r.vystup).toMatch(/IZOLACE: .*nemá zálohu SVÉHO prostředí/);
    expect(r.zdroj).toBeNull();
  });

  test("produkční env soubor jako cíl v ne-produkčním běhu → odmítne", () => {
    const r = doktor({ AISHA_ENV: "inst-staging", ENV_FILE: join(ROOT, ".env.coolify"), ENV_PROD_BACKUP: join(d, ".env-stg-backup") });
    expect(r.status, r.vystup).not.toBe(0);
    expect(r.vystup).toMatch(/IZOLACE: .*PRODUKČNÍ env soubor/);
    expect(r.cil).toBeNull();
  });

  test("se zálohou prostředí: cíl i zdroj jsou stagingové (kontrola měřidla)", () => {
    const r = doktor({ AISHA_ENV: "inst-staging", ENV_FILE: join(d, "cil"), ENV_PROD_BACKUP: join(d, ".env-stg-backup") });
    expect(r.cil, r.vystup).toBe(join(d, "cil"));
    expect(r.zdroj, r.vystup).toBe(join(d, ".env-stg-backup"));
  });

  test("produkční běh beze změny: bez ENV_PROD_BACKUP doplňuje z <repo>/.env-prod-backup", () => {
    const r = doktor({ ENV_FILE: join(d, "cil") });
    expect(r.cil, r.vystup).toBe(join(d, "cil"));
    expect(r.zdroj, r.vystup).toBe(join(ROOT, ".env-prod-backup"));
  });
});

/**
 * JEDNA BRÁNA ZÁPISŮ (PR2, bod 4): coolify_api je jediná cesta, kudy cold-start do Coolify
 * píše, a ne-produkční běh před KAŽDÝM zápisem ověří, že míří na svůj připnutý projekt.
 * Funkce se spouští PŘÍMO ze skriptu proti falešnému `curl` (zaznamená, co odešlo).
 */
describe("cold-start: jedna brána zápisů do Coolify", () => {
  const src = read("scripts/aisha-cold-start.sh");
  const funkce = (jmeno: string) => src.match(new RegExp(`^${jmeno}\\(\\) \\{\\n[\\s\\S]*?\\n\\}\\n`, "m"))?.[0] ?? "";
  const vyber = ["cs_je_prod_env", "cs_coolify_je_zapis", "cs_zapis_povolen", "coolify_api"].map((f) => {
    const t = funkce(f) || src.match(new RegExp(`^${f}\\(\\) \\{[^\\n]*\\}\\n`, "m"))?.[0] || "";
    return [f, t] as const;
  });

  const SCENARE: [string, Record<string, string>, string, string, boolean][] = [
    // popis, prostředí, metoda, cesta, má odejít?
    ["ne-prod, cíl = pin: DELETE odejde", { AISHA_ENV: "inst-staging", PIN: "proj-stg", CIL: "proj-stg" }, "DELETE", "/applications/a", true],
    ["ne-prod, cíl ≠ pin: DELETE NEODEJDE", { AISHA_ENV: "inst-staging", PIN: "proj-stg", CIL: "proj-prod" }, "DELETE", "/applications/a", false],
    ["ne-prod, pin = produkce: PATCH NEODEJDE", { AISHA_ENV: "inst-staging", PIN: "proj-prod", CIL: "proj-prod", PROD: "proj-prod" }, "PATCH", "/applications/a", false],
    ["ne-prod bez pinu: POST NEODEJDE", { AISHA_ENV: "inst-staging", PIN: "", CIL: "proj-stg" }, "POST", "/applications/dockercompose", false],
    ["ne-prod, cíl ≠ pin: GET /deploy (mutuje) NEODEJDE", { AISHA_ENV: "inst-staging", PIN: "proj-stg", CIL: "proj-prod" }, "GET", "/deploy?uuid=a", false],
    ["ne-prod, cíl ≠ pin: GET …/restart NEODEJDE", { AISHA_ENV: "inst-staging", PIN: "proj-stg", CIL: "proj-prod" }, "GET", "/applications/a/restart", false],
    ["ne-prod, cíl ≠ pin: čtení GET /projects odejde", { AISHA_ENV: "inst-staging", PIN: "proj-stg", CIL: "proj-prod" }, "GET", "/projects", true],
    ["produkce: DELETE odejde (beze změny)", { AISHA_ENV: "production", PIN: "", CIL: "proj-prod" }, "DELETE", "/applications/a", true],
  ];

  const vysledky = (() => {
    const d = mkdtempSync(join(tmpdir(), "brana-zapisu-"));
    writeFileSync(join(d, "curl"), `#!/bin/sh\necho "$*" >> "${d}/odeslano"\necho '{}'\n`, { mode: 0o755 });
    const telo = [
      `PATH="${d}:$PATH"`,
      `. "${LIB}"`,
      'err() { echo "ERR $*" >&2; }',
      ...vyber.map(([, t]) => t),
      ...SCENARE.map(([, env, metoda, cesta], i) =>
        [
          `( AISHA_ENV='${env.AISHA_ENV}'; CS_PROJEKT_PIN='${env.PIN}'; CS_PROD_PROJEKT_ZVENKU='${env.PROD ?? ""}'`,
          `  COOLIFY_PROJECT_UUID='${env.CIL}'; COOLIFY_URL=http://coolify.invalid; COOLIFY_API_TOKEN=t`,
          `  : > "${d}/odeslano"; coolify_api ${metoda} '${cesta}' >/dev/null 2>"${d}/err${i}"; echo $? > "${d}/rc${i}"`,
          `  if [ -s "${d}/odeslano" ]; then echo 1 > "${d}/odeslo${i}"; else echo 0 > "${d}/odeslo${i}"; fi )`,
        ].join("\n"),
      ),
    ].join("\n");
    const r = spawnSync("bash", ["-c", telo], { encoding: "utf8" });
    const rd = (f: string) => readFileSync(join(d, f), "utf8").trim();
    return { r, sc: SCENARE.map((_, i) => ({ rc: Number(rd(`rc${i}`)), odeslo: rd(`odeslo${i}`) === "1", err: rd(`err${i}`) })) };
  })();

  test("funkce brány ve skriptu jsou", () => {
    for (const [f, t] of vyber) expect(t, `cold-start nemá funkci ${f} — test by nic neměřil`).not.toBe("");
    expect(vysledky.r.status, vysledky.r.stderr).toBe(0);
  });

  test.each(SCENARE.map((s, i) => [s[0], i]))("%s", (_popis, i) => {
    const [, , , , maOdejit] = SCENARE[i as number];
    const v = vysledky.sc[i as number];
    expect(v.odeslo, v.err).toBe(maOdejit);
    if (!maOdejit) {
      expect(v.rc).toBe(97);
      expect(v.err).toMatch(/IZOLACE \(zápis do Coolify/);
    }
  });

  test("žádný zápis do Coolify mimo coolify_api", () => {
    const telo = funkce("coolify_api");
    const mimo = bezKomentaru(src.replace(telo, ""))
      .split("\n")
      .filter((r) => /curl/.test(r) && /COOLIFY_(URL|BASE_URL)|\/api\/v1/.test(r))
      .filter((r) => /\s-X\s|--request|\s-d\s|--data/.test(r));
    expect(mimo, "zápis do Coolify obchází jednu bránu (coolify_api)").toEqual([]);
  });
});

/**
 * CLI přes cestu se SYMLINKEM (PR2): stráž „běžím jako skript?" porovnávala cestu bez
 * symlinků s rozřešenou — přes symlink (macOS /var → /private/var) se CLI tiše přeskočilo
 * a skončilo 0. NAMĚŘENO 2026-09-27 v bráně izolace: prázdný BUNDLE_CONSUMER_ROLES →
 * prázdný env soubor; PKI_BUNDLE_REQUIRED dosazeno. Měří se CHOVÁNÍ přes symlink.
 */
describe("odvozovače cold-startu běží i přes cestu se symlinkem", () => {
  const d = mkdtempSync(join(tmpdir(), "cli-symlink-"));
  const odkaz = join(d, "repo");
  spawnSync("ln", ["-s", ROOT, odkaz]);
  const pust = (rel: string, ...a: string[]) =>
    spawnSync(process.execPath, [join(odkaz, rel), ...a], { encoding: "utf8", cwd: d, timeout: 60_000, env: envWithoutGitLocation() });

  test("derive-bundle-consumers vypíše role", () => {
    const r = pust("scripts/lib/derive-bundle-consumers.mjs");
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim(), "přes symlink nic nevypsal — cold-start by vygeneroval prázdný env").not.toBe("");
  });

  test("derive-pki-bundle-required vypíše true/false", () => {
    const r = pust("scripts/lib/derive-pki-bundle-required.mjs", "--manifest", join(ROOT, "coolify/manifests/aisha.manifest"));
    expect(r.stdout.trim(), `přes symlink nic nevypsal (stderr: ${r.stderr})`).toMatch(/^(true|false)$/);
  });

  test.each([
    ["scripts/lib/derive-bundle-consumers.mjs"],
    ["scripts/lib/derive-pki-bundle-required.mjs"],
    ["scripts/aisha-env-doctor.mjs"],
    ["scripts/db/provision-operators.mjs"],
  ])("%s: stráž CLI přes isDirectRun (cli-entry.mjs)", (soubor) => {
    expect(bezKomentaru(read(soubor))).toMatch(/isDirectRun\(import\.meta\.url\)/);
  });
});
