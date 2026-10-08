/**
 * vlastnictvi-aplikaci.mjs + vlastnictvi.sh — jeden domov odpovědi „které aplikace
 * manifestu toto prostředí vlastní“. Měří se CHOVÁNÍ: parser řádků `app:`, rozdělení
 * podle profilu prostředí (external_domain po dosazení ${VAR} z prostředí), fail-closed
 * stavy domova i shellového obalu (nenačteno, bez profilu, uříznutý výstup) a kódy
 * domova mutace (externí 101 ≠ držená 100) nad podvrženým klientem Coolify.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aplikaceManifestu, dosadExterniDomenu, externiZProfilu, KOD_EXTERNI, PATICKA_TSV, prirazeniVSouborech, rozdelVlastnictvi, tsv } from "./vlastnictvi-aplikaci.mjs";
import { KOD_DRZENO } from "./nasazeni-drzene.mjs";

const ROOT = process.cwd();
const DOMOV = join(ROOT, "scripts/lib/vlastnictvi-aplikaci.mjs");
const LIB = join(ROOT, "scripts/lib/vlastnictvi.sh");
const MUTACE = join(ROOT, "scripts/lib/coolify-mutace.mjs");

const MANIFEST = [
  "story: inst",
  "repo: org/repo",
  "app: keycloak:frontend:docker-compose.coolify-keycloak.yml:bluegreen=on   # komentář",
  "app: core:frontend:docker-compose.coolify.yml",
  "# app: zakomentovana:frontend:x.yml",
  "",
].join("\n");

/** Overlay s profilem `inst` (keycloak external_domain = ${KC_EXTERNI}) a manifestem. */
function overlay({ profil, manifest = MANIFEST } = {}) {
  const d = mkdtempSync(join(tmpdir(), "vlastnictvi-"));
  mkdirSync(join(d, "profiles"));
  mkdirSync(join(d, "manifests"));
  writeFileSync(
    join(d, "profiles", "inst.json"),
    JSON.stringify(profil ?? { id: "inst", service_overrides: { keycloak: { placement: "frontend", external_domain: "${KC_EXTERNI}" }, core: { placement: "frontend" } } }),
  );
  writeFileSync(join(d, "manifests", "inst.manifest"), manifest);
  return { dir: d, manifest: join(d, "manifests", "inst.manifest") };
}

const cisteEnv = (navic = {}) => ({ PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", TMPDIR: process.env.TMPDIR ?? "", ...navic });

function domov(args, env) {
  const r = spawnSync("node", [DOMOV, ...args], { cwd: ROOT, encoding: "utf8", env: cisteEnv(env), timeout: 60_000 });
  return { rc: r.status, out: r.stdout, err: r.stderr };
}

function bash(skript, env = {}, cestaNavic = "") {
  const r = spawnSync("bash", ["-c", `set -euo pipefail\n. "${LIB}"\n${skript}`], {
    cwd: ROOT,
    encoding: "utf8",
    env: cisteEnv({ ...env, PATH: `${cestaNavic ? `${cestaNavic}:` : ""}${process.env.PATH ?? ""}` }),
    timeout: 60_000,
  });
  return { rc: r.status, out: r.stdout, err: r.stderr };
}

describe("parser řádků app: (jediný v repu)", () => {
  it("čte role, slot, compose a volby; komentáře a jiné klíče ignoruje", () => {
    expect(aplikaceManifestu(MANIFEST)).toEqual([
      { role: "keycloak", slot: "frontend", compose: "docker-compose.coolify-keycloak.yml", volby: "bluegreen=on", radek: 3 },
      { role: "core", slot: "frontend", compose: "docker-compose.coolify.yml", volby: "", radek: 4 },
    ]);
  });

  it("řádek app: jiného tvaru je CHYBA, ne „není tam“", () => {
    expect(() => aplikaceManifestu("app: keycloak\n")).toThrow(/vadné řádky app:/);
    expect(() => aplikaceManifestu("app: Velka:frontend:x.yml\n")).toThrow(/ř\. 1/);
  });
});

describe("dosazení external_domain: nenastavená ≠ prázdná", () => {
  it("prostředí (i prázdná hodnota) → soubor → výchozí ${VAR:-…} → jinak výjimka", () => {
    expect(dosadExterniDomenu("${A}", { sluzba: "s", env: { A: "x.example" } })).toBe("x.example");
    expect(dosadExterniDomenu("${A}", { sluzba: "s", env: { A: "" } })).toBe("");
    expect(dosadExterniDomenu("${A:-vychozi.example}", { sluzba: "s", env: {} })).toBe("vychozi.example");
    expect(dosadExterniDomenu("${A:-vychozi.example}", { sluzba: "s", env: { A: "" } }), "jako derive-domains: nastavená prázdná přebije výchozí").toBe("");
    expect(dosadExterniDomenu("pevna.example", { sluzba: "s", env: {} })).toBe("pevna.example");
    expect(dosadExterniDomenu(undefined, { sluzba: "s", env: {} })).toBeUndefined();
    expect(() => dosadExterniDomenu("${A}", { sluzba: "keycloak", env: {} })).toThrow(/external_domain služby keycloak odkazuje na \$\{A\}.*NEDEKLARUJE/);
  });

  it("prirazeniVSouborech: poslední přiřazení vyhrává, prázdné JE nalezené, komentáře a uvozovky se odříznou", () => {
    const d = mkdtempSync(join(tmpdir(), "vlastnictvi-env-"));
    const a = join(d, "a");
    const b = join(d, "b");
    writeFileSync(a, "# KC=komentar\nexport KC='prvni.example' # pozn\n");
    writeFileSync(b, "KC=\n");
    expect(prirazeniVSouborech("KC", [a])).toMatchObject({ nalezeno: true, hodnota: "prvni.example" });
    expect(prirazeniVSouborech("KC", [a, b])).toMatchObject({ nalezeno: true, hodnota: "" });
    expect(prirazeniVSouborech("JINY", [a, b])).toEqual({ nalezeno: false, hodnota: "" });
    expect(prirazeniVSouborech("KC", [join(d, "neni")])).toEqual({ nalezeno: false, hodnota: "" });
    // nerozvinutá šablona nic nedeklaruje (jako parseEnvFile) — zůstane předchozí přiřazení, nebo „nic“
    const c = join(d, "c");
    writeFileSync(c, "KC=${JINA}\n");
    expect(prirazeniVSouborech("KC", [c])).toEqual({ nalezeno: false, hodnota: "" });
    expect(prirazeniVSouborech("KC", [a, c])).toMatchObject({ nalezeno: true, hodnota: "prvni.example" });
    // hodnota jako ze `source`: uvozený JSON se dekóduje, ne jen ořízne
    const j = join(d, "j");
    writeFileSync(j, 'KC="{\\"a\\":1}"\n');
    expect(prirazeniVSouborech("KC", [j]).hodnota).toBe('{"a":1}');
  });
});

describe("rozdělení podle profilu prostředí", () => {
  it("external_domain = externí; prázdná nebo chybějící = vlastní", () => {
    const ext = externiZProfilu({ service_overrides: { keycloak: { external_domain: " auth.cizi.example " }, core: { external_domain: "" }, web: {} } });
    expect([...ext]).toEqual([["keycloak", "auth.cizi.example"]]);
    const v = rozdelVlastnictvi(aplikaceManifestu(MANIFEST), ext, "inst");
    expect(v.vlastni.map((a) => a.role)).toEqual(["core"]);
    expect(v.externi).toEqual([{ role: "keycloak", domena: "auth.cizi.example", hlaska: expect.stringMatching(/^EXTERNÍ: keycloak — auth\.cizi\.example — .*nevlastním$/) }]);
  });

  it("TSV nese patičku s počtem řádků (důkaz úplnosti)", () => {
    const t = tsv({ profil: "inst", ...rozdelVlastnictvi(aplikaceManifestu(MANIFEST), new Map([["keycloak", "auth.cizi.example"]]), "inst") });
    const radky = t.split("\n");
    expect(radky.at(-1)).toMatch(new RegExp(`^${PATICKA_TSV}\\t2\\t`));
    expect(radky[0]).toBe("vlastni\tcore\tfrontend\tdocker-compose.coolify.yml\t");
  });
});

describe("CLI domova: prostředí rozhoduje, profil se nekopíruje", () => {
  it("staging (proměnná s adresou) → keycloak externí; produkce (VÝSLOVNĚ prázdná) → vlastní", () => {
    const o = overlay();
    const staging = domov(["--manifest", o.manifest], { AISHA_INSTANCE_CONFIG_DIR: o.dir, AISHA_PROFILE: "inst", KC_EXTERNI: "auth.cizi.example" });
    expect(staging.rc).toBe(0);
    expect(staging.out).toMatch(/^externi\tkeycloak\tauth\.cizi\.example\t/m);
    expect(staging.out).not.toMatch(/^vlastni\tkeycloak/m);
    const produkce = domov(["--manifest", o.manifest], { AISHA_INSTANCE_CONFIG_DIR: o.dir, AISHA_PROFILE: "inst", KC_EXTERNI: "" });
    expect(produkce.rc).toBe(0);
    expect(produkce.out).toMatch(/^vlastni\tkeycloak\tfrontend\tdocker-compose\.coolify-keycloak\.yml\tbluegreen=on$/m);
  });

  it("⛔ proměnná v external_domain NENASTAVENÁ = „nevím“ (kód 2), ne „vlastní“ — i když jinak vše sedí", () => {
    const o = overlay();
    const r = domov(["--manifest", o.manifest], { AISHA_INSTANCE_CONFIG_DIR: o.dir, AISHA_PROFILE: "inst" });
    expect(r.rc).toBe(2);
    expect(r.out).toBe("");
    expect(r.err).toMatch(/external_domain služby keycloak odkazuje na \$\{KC_EXTERNI\}, ale prostředí procesu ji NEDEKLARUJE/);
    expect(r.err).toMatch(/prázdná hodnota \(KC_EXTERNI=\) = vlastní/);
  });

  it("proměnnou smí deklarovat soubor prostředí (čteno jako data): adresa = externí, `VAR=` = vlastní; prostředí procesu má přednost", () => {
    const o = overlay();
    const ext = join(o.dir, "env-ext");
    const prazdna = join(o.dir, "env-prazdna");
    writeFileSync(ext, "# domény\nKC_EXTERNI=auth.cizi.example\n");
    writeFileSync(prazdna, "KC_EXTERNI=\n");
    const z = (soubor, navic = {}) => domov(["--manifest", o.manifest, "--env-soubor", soubor], { AISHA_INSTANCE_CONFIG_DIR: o.dir, AISHA_PROFILE: "inst", ...navic });
    expect(z(ext).out).toMatch(/^externi\tkeycloak\tauth\.cizi\.example\t/m);
    expect(z(prazdna).out).toMatch(/^vlastni\tkeycloak\t/m);
    expect(z(ext, { KC_EXTERNI: "" }).out, "prostředí procesu přebije soubor").toMatch(/^vlastni\tkeycloak\t/m);
    expect(z(join(o.dir, "neni")).rc, "chybějící soubor nic nedeklaruje").toBe(2);
  });

  it("„nevím“ není „vlastním“: bez profilu, s neznámým profilem nebo bez manifestu = kód 2", () => {
    const o = overlay();
    expect(domov(["--manifest", o.manifest], { AISHA_INSTANCE_CONFIG_DIR: o.dir }).rc).toBe(2);
    expect(domov(["--manifest", o.manifest], { AISHA_INSTANCE_CONFIG_DIR: o.dir, AISHA_PROFILE: "neni" }).rc).toBe(2);
    expect(domov(["--manifest", join(o.dir, "neni.manifest")], { AISHA_INSTANCE_CONFIG_DIR: o.dir, AISHA_PROFILE: "inst" }).rc).toBe(2);
  });

  it("profil ze souboru prostředí instance, když v prostředí procesu není (čte se jako data)", () => {
    const o = overlay();
    const env = join(o.dir, "env");
    writeFileSync(env, "AISHA_PROFILE=inst\nNEVYKONAT=$(touch " + join(o.dir, "vykonano") + ")\n");
    const r = domov(["--manifest", o.manifest, "--env-soubor", env], { AISHA_INSTANCE_CONFIG_DIR: o.dir, KC_EXTERNI: "auth.cizi.example" });
    expect(r.rc).toBe(0);
    expect(r.out).toMatch(/^externi\tkeycloak/m);
    expect(spawnSync("test", ["-e", join(o.dir, "vykonano")]).status, "soubor prostředí se vykonal").not.toBe(0);
  });

  it("profil legacy (bez topologie) = vlastní celý manifest, a řekne to", () => {
    const o = overlay();
    const r = domov(["--manifest", o.manifest, "--profil", "legacy"], { AISHA_INSTANCE_CONFIG_DIR: o.dir });
    expect(r.rc).toBe(0);
    expect(r.out).toMatch(/topologie se neodvozuje.*vlastní celý manifest \(2\)/);
  });
});

describe("vlastnictvi.sh — fail-closed shellový obal", () => {
  const o = overlay();
  const env = { AISHA_INSTANCE_CONFIG_DIR: o.dir, AISHA_PROFILE: "inst", KC_EXTERNI: "auth.cizi.example" };

  it("načte, odpovídá a vypíše vlastní aplikace i s volbami", () => {
    const r = bash(`vlastnictvi_nacti "${o.manifest}"; externi keycloak && echo EXT; vlastni core && echo VL; vlastni keycloak || echo NEVL; vlastni_aplikace; vlastnictvi_hlaska keycloak`, env);
    expect(r.rc, r.err).toBe(0);
    expect(r.out).toMatch(/^EXT$/m);
    expect(r.out).toMatch(/^VL$/m);
    expect(r.out).toMatch(/^NEVL$/m);
    expect(r.out).toMatch(/^core\tfrontend\tdocker-compose\.coolify\.yml\t$/m);
    expect(r.out).toMatch(/^EXTERNÍ: keycloak — auth\.cizi\.example/m);
  });

  it("dotaz před načtením skript UKONČÍ (odpověď nenačteného vlastnictví by byla fail-open)", () => {
    const r = bash(`vlastni core; echo POKRACOVAL`, env);
    expect(r.rc).not.toBe(0);
    expect(r.out).not.toMatch(/POKRACOVAL/);
    expect(r.err).toMatch(/vlastnictví nebylo načteno/);
  });

  it("výstup domova bez patičky nebo s nesedícím počtem = nenačteno", () => {
    for (const vystup of ["vlastni\tcore\tfrontend\tx.yml\t\n", `vlastni\tcore\tfrontend\tx.yml\t\n${PATICKA_TSV}\t5\tpopis\n`]) {
      const bin = mkdtempSync(join(tmpdir(), "vlastnictvi-node-"));
      writeFileSync(join(bin, "vystup.txt"), vystup);
      writeFileSync(join(bin, "node"), `#!/bin/sh\ncat "${join(bin, "vystup.txt")}"\nexit 0\n`);
      chmodSync(join(bin, "node"), 0o755);
      const r = bash(`vlastnictvi_nacti "${o.manifest}" || { echo SELHALO; exit 0; }; echo NACTENO`, env, bin);
      expect(r.out, vystup).toMatch(/SELHALO/);
    }
  });
});

describe("domov mutace: externí aplikace = kód 101, nic se neodešle", () => {
  it("kódy se liší a CLI externí aplikaci odmítne dřív, než sáhne po pověření", () => {
    expect(KOD_EXTERNI).toBe(101);
    expect(KOD_DRZENO).toBe(100);
    const o = overlay();
    const r = spawnSync("node", [MUTACE, "--akce", "deploy", "--jmeno", "inst-keycloak", "--prefix", "inst", "--uuid", "abc", "--kdo", "test", "--drzene", "[]"], {
      cwd: ROOT,
      encoding: "utf8",
      // Bez COOLIFY_URL/TOKEN: kdyby se mutace odesílala, skončí kódem 2 (chybí pověření), ne 101.
      env: cisteEnv({ AISHA_INSTANCE_CONFIG_DIR: o.dir, AISHA_PROFILE: "inst", KC_EXTERNI: "auth.cizi.example" }),
      timeout: 60_000,
    });
    expect(r.status, r.stderr).toBe(KOD_EXTERNI);
    expect(r.stdout).toMatch(/^EXTERNÍ: keycloak — auth\.cizi\.example/);
  });

  it("vlastní aplikace projde k odeslání (kotva: bez pověření pak kód 2, ne 101)", () => {
    const o = overlay();
    const r = spawnSync("node", [MUTACE, "--akce", "deploy", "--jmeno", "inst-keycloak", "--prefix", "inst", "--uuid", "abc", "--kdo", "test", "--drzene", "[]"], {
      cwd: ROOT,
      encoding: "utf8",
      // KC_EXTERNI výslovně prázdná = vlastní; nenastavená by byla „nevím“ (taky kód 2 — jiný důvod)
      env: cisteEnv({ AISHA_INSTANCE_CONFIG_DIR: o.dir, AISHA_PROFILE: "inst", KC_EXTERNI: "" }),
      timeout: 60_000,
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/COOLIFY_API_TOKEN/);
    expect(r.stderr).not.toMatch(/NEDEKLARUJE/);
  });

  it("⛔ A-N1: proměnná external_domain JEN v souboru prostředí (--env-soubor) → domov mutace ji vidí: externí = 101, `VAR=` = vlastní, bez souboru = nevím (2)", () => {
    const o = overlay();
    const ext = join(o.dir, "env-ext");
    const prazdna = join(o.dir, "env-prazdna");
    writeFileSync(ext, "KC_EXTERNI=auth.cizi.example\n");
    writeFileSync(prazdna, "KC_EXTERNI=\n");
    const mutace = (navic) =>
      spawnSync("node", [MUTACE, "--akce", "deploy", "--jmeno", "inst-keycloak", "--prefix", "inst", "--uuid", "abc", "--kdo", "test", "--drzene", "[]", ...navic], {
        cwd: ROOT,
        encoding: "utf8",
        // KC_EXTERNI v prostředí procesu NENÍ — jediný zdroj je soubor; bez pověření Coolify
        env: cisteEnv({ AISHA_INSTANCE_CONFIG_DIR: o.dir, AISHA_PROFILE: "inst" }),
        timeout: 60_000,
      });
    const externi = mutace(["--env-soubor", ext]);
    expect(externi.status, externi.stderr).toBe(KOD_EXTERNI);
    expect(externi.stdout).toMatch(/^EXTERNÍ: keycloak — auth\.cizi\.example/);
    const vlastni = mutace(["--env-soubor", prazdna]);
    expect(vlastni.status, "vlastní projde k odeslání a skončí až na chybějícím pověření").toBe(2);
    expect(vlastni.stderr).toMatch(/COOLIFY_API_TOKEN/);
    expect(vlastni.stderr).not.toMatch(/NEDEKLARUJE/);
    const nevim = mutace([]);
    expect(nevim.status).toBe(2);
    expect(nevim.stderr).toMatch(/NEDEKLARUJE/);
  });

  it("A-N1: cache externích služeb v procesu nese i soubory prostředí — týž profil s jiným souborem = jiná odpověď", () => {
    const o = overlay();
    const ext = join(o.dir, "env-ext");
    const prazdna = join(o.dir, "env-prazdna");
    writeFileSync(ext, "KC_EXTERNI=auth.cizi.example\n");
    writeFileSync(prazdna, "KC_EXTERNI=\n");
    // Cache žije v procesu domova mutace: tři dotazy jdou v JEDNOM dceřiném procesu s vlastním
    // prostředím (overlay jen tam). Proces testu proměnnou overlaye nečte ani nemění —
    // k overlayi vedou jedny dveře (brána overlay-jde-jen-jednemi-dvermi).
    const skript = [
      `const { externiPolozka } = await import(${JSON.stringify(MUTACE)});`,
      `const z = { jmeno: "inst-keycloak", prefix: "inst" };`,
      `const dotaz = (soubor) => externiPolozka(z, { profil: "inst", envSoubory: [soubor] });`,
      `console.log(JSON.stringify([dotaz(${JSON.stringify(ext)}), dotaz(${JSON.stringify(prazdna)}), dotaz(${JSON.stringify(ext)})]));`,
    ].join("\n");
    const r = spawnSync("node", ["--input-type=module", "-e", skript], {
      cwd: ROOT,
      encoding: "utf8",
      env: cisteEnv({ AISHA_INSTANCE_CONFIG_DIR: o.dir }),
      timeout: 60_000,
    });
    expect(r.status, r.stderr).toBe(0);
    const [prvni, druhy, opakovany] = JSON.parse(r.stdout.trim().split("\n").pop() ?? "null");
    expect(prvni).toMatchObject({ role: "keycloak", domena: "auth.cizi.example" });
    expect(druhy, "týž profil, jiný soubor prostředí = jiná odpověď (klíč cache nese soubory)").toBeNull();
    expect(opakovany, "opakovaný dotaz z cache").toMatchObject({ domena: "auth.cizi.example" });
  });

  it("mutujAplikaci: externí se zeptá PŘED voláním — volej se nezavolá", async () => {
    const { mutujAplikaci } = await import("./coolify-mutace.mjs");
    const volani = [];
    const v = await mutujAplikaci(
      { akce: "deploy", jmeno: "inst-keycloak", prefix: "inst", uuid: "abc" },
      { kdo: "test", drzene: [], externi: new Map([["keycloak", "auth.cizi.example"]]), volej: async (c) => { volani.push(c); return {}; } },
    );
    expect(v).toMatchObject({ externi: true, drzeno: false });
    expect(volani).toEqual([]);
  });
});
