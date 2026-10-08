import { afterEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DECLARATION_ENV, OVERLAY_ENV, REQUIRED_ENV } from "./instance-overlay.mjs";
import {
  dniOd,
  drzeniInstance,
  hlaskaDrzeno,
  nactiDeklaraci,
  PATICKA_TSV,
  polozkaZDrzenych,
  PRVNI_DRZITELNA_VLNA,
  primeAplikace,
  SOUBOR,
  validuj,
  vlnyZPoradi,
} from "./nasazeni-drzene.mjs";

const vlny = new Map([["pki", 2], ["core", 3], ["edge", 6], ["local-ingest", 7], ["extranet", 7], ["web-render", 10]]);
const prime = new Set(["core", "edge", "extranet"]);
const K = { vlny, prime, dnes: "2026-10-02" };
const polozka = (o = {}) => ({
  aplikace: "web-render",
  duvod: "Coolify převádí holý ${VAR} bind na prázdný svazek",
  rozhodnuti: { kdo: "majitel", datum: "2026-09-28", odkaz: "rozhodnutí 2026-09-28" },
  ...o,
});

describe("validace deklarace držení", () => {
  it("platná položka → aplikace, vlna a stáří ve dnech", () => {
    const v = validuj([polozka()], K);
    expect(v.chyby).toEqual([]);
    expect(v.polozky).toEqual([
      { aplikace: "web-render", duvod: "Coolify převádí holý ${VAR} bind na prázdný svazek", kdo: "majitel", datum: "2026-09-28", odkaz: "rozhodnutí 2026-09-28", vlna: 10, dni: 4 },
    ]);
  });

  it("prázdné pole = nic drženo", () => {
    expect(validuj([], K)).toEqual({ polozky: [], chyby: [] });
  });

  it("⛔ bez důvodu, bez rozhodnutí nebo bez odkazu = chyba, ne tichá platnost", () => {
    expect(validuj([polozka({ duvod: "  " })], K).chyby.join()).toMatch(/chybí důvod/);
    expect(validuj([polozka({ rozhodnuti: undefined })], K).chyby.join()).toMatch(/chybí „rozhodnuti“/);
    expect(validuj([polozka({ rozhodnuti: { kdo: "majitel", datum: "2026-09-28" } })], K).chyby.join()).toMatch(/chybí odkaz/);
    expect(validuj([polozka({ rozhodnuti: { datum: "2026-09-28", odkaz: "x" } })], K).chyby.join()).toMatch(/KDO/);
  });

  it("⛔ aplikace přímé úlohy nebo vln 0–2 = chyba (deklarace by ji nezastavila)", () => {
    expect(validuj([polozka({ aplikace: "core" })], K).chyby.join()).toMatch(/PŘÍMÁ úloha/);
    expect(validuj([polozka({ aplikace: "extranet" })], K).chyby.join()).toMatch(/PŘÍMÁ úloha/);
    expect(validuj([polozka({ aplikace: "pki" })], K).chyby.join()).toMatch(/vlna 2 běží před deploy-zacatek/);
    expect(PRVNI_DRZITELNA_VLNA).toBe(3);
  });

  it("⛔ neznámá aplikace, dvojitá položka, neznámý klíč (překlep) = chyba", () => {
    expect(validuj([polozka({ aplikace: "web-rendr" })], K).chyby.join()).toMatch(/WAVES neznají/);
    expect(validuj([polozka(), polozka()], K).chyby.join()).toMatch(/dvakrát/);
    expect(validuj([{ ...polozka(), duvood: "x" }], K).chyby.join()).toMatch(/neznámý klíč „duvood“/);
    expect(validuj([polozka({ rozhodnuti: { kdo: "m", datum: "2026-09-28", odkaz: "x", platnost: "2027" } })], K).chyby.join()).toMatch(/neznámý klíč rozhodnutí/);
  });

  it("⛔ datum: jen platné YYYY-MM-DD a ne v budoucnosti", () => {
    expect(validuj([polozka({ rozhodnuti: { kdo: "m", datum: "28. 9. 2026", odkaz: "x" } })], K).chyby.join()).toMatch(/není YYYY-MM-DD/);
    expect(validuj([polozka({ rozhodnuti: { kdo: "m", datum: "2026-02-30", odkaz: "x" } })], K).chyby.join()).toMatch(/není YYYY-MM-DD/);
    // `dnes` je UTC: rozhodnutí zapsané po místní půlnoci na východ od UTC nese už zítřejší datum.
    // Zítřek je proto platný (stáří 0 dní, ne záporné); budoucnost začíná pozítřím.
    const zitra = validuj([polozka({ rozhodnuti: { kdo: "m", datum: "2026-10-03", odkaz: "x" } })], K);
    expect(zitra.chyby).toEqual([]);
    expect(zitra.polozky[0].dni).toBe(0);
    expect(validuj([polozka({ rozhodnuti: { kdo: "m", datum: "2026-10-04", odkaz: "x" } })], K).chyby.join()).toMatch(/v budoucnosti/);
  });

  it("⛔ jedna neplatná položka zneplatní celou deklaraci (žádné částečné držení)", () => {
    const v = validuj([polozka(), polozka({ aplikace: "local-ingest", duvod: "" })], K);
    expect(v.chyby.length).toBeGreaterThan(0);
    expect(v.polozky).toEqual([]);
  });

  it("deklarace, která není pole, je chyba", () => {
    expect(validuj({ drzene: [] }, K).chyby).toEqual(["deklarace musí být pole položek"]);
  });
});

describe("měřidla deklarace", () => {
  it("přímé úlohy z ci.yml: volání deploy-and-verify.sh <suffix>, komentář není volání", () => {
    const ci = [
      "        run: bash scripts/ci/deploy-and-verify.sh core --fronta-s 1500",
      "          bash scripts/ci/deploy-and-verify.sh edge \\",
      "      # bash scripts/ci/deploy-and-verify.sh web-render",
      "          bash scripts/ci/nasad-podle-vln.sh --aplikace x",
    ].join("\n");
    expect([...primeAplikace(ci)].sort()).toEqual(["core", "edge"]);
  });

  it("⛔ přímé adresování v Coolify (resolve podle sufixu) je taky přímá úloha — držení by ji nezastavilo", () => {
    const ci = [
      '          UUID=$(bash scripts/lib/coolify-resolve-uuid.sh "${APP_PREFIX}-orchestration" 2>&1 || true)',
      '          bash scripts/lib/coolify-resolve-uuid.sh "$APP_NAME_PREFIX-model"',
      '          # bash scripts/lib/coolify-resolve-uuid.sh "${APP_PREFIX}-web-render"',
      '          UUID=$(bash scripts/lib/coolify-resolve-uuid.sh "$CIL")',
    ].join("\n");
    expect([...primeAplikace(ci)].sort()).toEqual(["model", "orchestration"]);
    const K2 = { ...K, prime: primeAplikace(ci), vlny: new Map([...K.vlny, ["orchestration", 5]]) };
    expect(validuj([polozka({ aplikace: "orchestration" })], K2).chyby.join()).toMatch(/PŘÍMÁ úloha/);
  });

  it("vlny z --print-waves včetně sloupce stropu", () => {
    expect([...vlnyZPoradi("0\tnetinit\n7\tdomain-services\t3600\n10\tweb-render\n").entries()]).toEqual([
      ["netinit", 0],
      ["domain-services", 7],
      ["web-render", 10],
    ]);
  });

  it("stáří držení ve dnech (UTC)", () => {
    expect(dniOd("2026-09-28", "2026-10-02")).toBe(4);
    expect(dniOd("2026-10-02", "2026-10-02")).toBe(0);
  });
});

describe("CLI", () => {
  const cli = (args) => spawnSync(process.execPath, ["scripts/lib/nasazeni-drzene.mjs", ...args], { encoding: "utf8" });
  const soubor = (obsah) => {
    const d = mkdtempSync(join(tmpdir(), "drzene-"));
    const p = join(d, "nasazeni-drzene.json");
    writeFileSync(p, typeof obsah === "string" ? obsah : JSON.stringify(obsah));
    return p;
  };

  it("chybějící soubor = nic drženo ([]), kód 0", () => {
    const r = cli(["--soubor", join(tmpdir(), "neni-tu", "nasazeni-drzene.json"), "--dnes", "2026-10-02"]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe("[]");
  });

  it("platná deklarace nad SKUTEČNÝMI vlnami a ci.yml → kompaktní JSON", () => {
    const r = cli(["--soubor", soubor([polozka()]), "--dnes", "2026-10-02"]);
    expect(r.status, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ aplikace: "web-render", dni: 4 });
    expect(r.stdout.trim().split("\n")).toHaveLength(1);
  });

  it("⛔ nečitelný JSON a neplatná položka → kód 1 s ::error, nic na stdout", () => {
    const n = cli(["--soubor", soubor("{nejde"), "--dnes", "2026-10-02"]);
    expect(n.status).toBe(1);
    expect(n.stderr).toMatch(/deklarace držení NEČITELNÁ/);
    expect(n.stdout).toBe("");
    const p = cli(["--soubor", soubor([polozka({ aplikace: "core" })]), "--dnes", "2026-10-02"]);
    expect(p.status).toBe(1);
    expect(p.stderr).toMatch(/deklarace držení NEPLATNÁ.*PŘÍMÁ úloha/);
    // nad SKUTEČNÝM ci.yml: aplikaci, kterou úloha po vydání uzlů n8n restartuje přímo, držet nejde
    const o = cli(["--soubor", soubor([polozka({ aplikace: "orchestration" })]), "--dnes", "2026-10-02"]);
    expect(o.status).toBe(1);
    expect(o.stderr).toMatch(/deklarace držení NEPLATNÁ.*PŘÍMÁ úloha/);
  });

  it("chybný vstup → kód 2", () => {
    expect(cli([]).status).toBe(2);
    expect(cli(["--soubor", "x", "--dnes", "zítra"]).status).toBe(2);
  });
});

// ── Cesty mimo CI: studený start, redeploy, zápis konfigurace, doktor ─────────
/** Overlay instance na disku: adresář, volitelně s deklarací (objekt → JSON, řetězec → doslova). */
function overlay(obsah) {
  const d = mkdtempSync(join(tmpdir(), "drzeni-overlay-"));
  if (obsah !== undefined) writeFileSync(join(d, SOUBOR), typeof obsah === "string" ? obsah : JSON.stringify(obsah));
  return d;
}

describe("hláška DRŽENO — jeden text pro všechny cesty", () => {
  it("jde najít jedním grepem „DRŽENO: <aplikace>“ a nese důvod, rozhodnutí a stáří", () => {
    const [p] = validuj([polozka()], K).polozky;
    expect(hlaskaDrzeno(p)).toBe(
      "DRŽENO: web-render — Coolify převádí holý ${VAR} bind na prázdný svazek — rozhodnutí majitel 2026-09-28 (rozhodnutí 2026-09-28); drženo od 2026-09-28 (4 dní)",
    );
  });
});

describe("čtení deklarace ze souboru (nactiDeklaraci) — nehází, chyby vrací", { timeout: 60_000 }, () => {
  it("soubor není = nic drženo, bez chyb", () => {
    expect(nactiDeklaraci(join(overlay(), SOUBOR), { dnes: "2026-10-02" })).toMatchObject({ polozky: [], chyby: [], existuje: false });
  });

  it("platná deklarace nad SKUTEČNÝMI vlnami a ci.yml", () => {
    const d = nactiDeklaraci(join(overlay([polozka()]), SOUBOR), { dnes: "2026-10-02" });
    expect(d.chyby).toEqual([]);
    expect(d.polozky).toHaveLength(1);
    expect(d.polozky[0]).toMatchObject({ aplikace: "web-render", vlna: 10, dni: 4 });
  });

  it("⛔ nečitelný JSON a neplatná položka → chyby s titulkem, žádné položky", () => {
    const n = nactiDeklaraci(join(overlay("{nejde"), SOUBOR), { dnes: "2026-10-02" });
    expect(n.titulek).toBe("deklarace držení NEČITELNÁ");
    expect(n.chyby).toHaveLength(1);
    expect(n.polozky).toEqual([]);
    const p = nactiDeklaraci(join(overlay([polozka({ aplikace: "core" })]), SOUBOR), { dnes: "2026-10-02" });
    expect(p.titulek).toBe("deklarace držení NEPLATNÁ");
    expect(p.chyby.join()).toMatch(/PŘÍMÁ úloha/);
    expect(p.polozky).toEqual([]);
  });
});

describe("deklarace TÉTO instance (drzeniInstance) — overlay si domov obstará sám", { timeout: 60_000 }, () => {
  afterEach(() => vi.unstubAllEnvs());
  // Vynucení se vypíná výslovně: lane „brány nad overlayem“ běží s AISHA_OVERLAY_REQUIRED=1.
  const bezOverlaye = () => {
    vi.stubEnv(OVERLAY_ENV, "");
    vi.stubEnv(DECLARATION_ENV, "");
    vi.stubEnv(REQUIRED_ENV, "");
  };

  it("instance bez overlaye = nic drženo, a řekne proč", () => {
    bezOverlaye();
    const d = drzeniInstance("test", { dnes: "2026-10-02" });
    expect(d.polozky).toEqual([]);
    expect(d.popis).toMatch(/instance nemá overlay .* nic drženo/);
  });

  it("overlay bez souboru = nic drženo; se souborem = položky a výčet v popisu", () => {
    bezOverlaye();
    vi.stubEnv(OVERLAY_ENV, overlay());
    expect(drzeniInstance("test", { dnes: "2026-10-02" })).toMatchObject({ polozky: [], popis: expect.stringMatching(/nemá — nic drženo/) });
    vi.stubEnv(OVERLAY_ENV, overlay([polozka(), polozka({ aplikace: "local-ingest" })]));
    const d = drzeniInstance("test", { dnes: "2026-10-02" });
    expect(d.polozky.map((p) => p.aplikace)).toEqual(["web-render", "local-ingest"]);
    expect(d.popis).toMatch(/drženo 2 \(web-render, local-ingest\)/);
  });

  it("⛔ nečitelná nebo neplatná deklarace = VÝJIMKA s důvody, nikdy „nic drženo“", () => {
    bezOverlaye();
    for (const [obsah, titulek] of [
      ["{nejde", "deklarace držení NEČITELNÁ"],
      [[polozka({ duvod: "" })], "deklarace držení NEPLATNÁ"],
      [[polozka({ aplikace: "pki" })], "deklarace držení NEPLATNÁ"],
    ]) {
      vi.stubEnv(OVERLAY_ENV, overlay(obsah));
      let chyba;
      try {
        drzeniInstance("test", { dnes: "2026-10-02" });
      } catch (e) {
        chyba = e;
      }
      expect(chyba?.titulek, JSON.stringify(obsah)).toBe(titulek);
      expect(chyba.chyby.length).toBeGreaterThan(0);
    }
  });

  it("⛔ „jen vlny 3+ bez přímé úlohy“ platí i mimo CI — deklarace je jedna a musí ji naplnit každá cesta", () => {
    bezOverlaye();
    // vlna 0 (warmup), vlna 2 (kořen důvěry), přímá úloha v CI: studený start by je držet uměl, CI ne.
    for (const aplikace of ["netinit-backend", "pki", "edge", "orchestration"]) {
      vi.stubEnv(OVERLAY_ENV, overlay([polozka({ aplikace })]));
      expect(() => drzeniInstance("test", { dnes: "2026-10-02" }), aplikace).toThrow(/deklarace držení NEPLATNÁ/);
    }
  });

  it("⛔ deklarovaný a NEDOSTUPNÝ overlay = výjimka (fail-closed), ne „instance nemá overlay“", () => {
    bezOverlaye();
    vi.stubEnv(DECLARATION_ENV, `file://${join(overlay(), "neexistuje.git")}#main`);
    let chyba;
    try {
      drzeniInstance("test", { dnes: "2026-10-02" });
    } catch (e) {
      chyba = e;
    }
    expect(chyba?.titulek).toBe("deklarace držení NEČITELNÁ");
    expect(chyba.chyby.join()).toMatch(/nejde ho získat/);
    expect(chyba.chyby.join()).toMatch(/fail-open/);
  });

  it("⛔ samostatně spuštěný nástroj: deklaraci overlaye vezme ze souboru prostředí instance — a do prostředí ji jen PROPŮJČÍ", () => {
    bezOverlaye();
    const d = overlay();
    const envSoubor = join(d, "env.instance");
    writeFileSync(envSoubor, `JINY_KLIC=x\n${DECLARATION_ENV}=file://${join(d, "neexistuje.git")}#main\n`);
    // bez souboru prostředí by nástroj o overlayi nevěděl → „nic drženo“ (fail-open na cestě ručního nasazení)
    expect(drzeniInstance("test", { dnes: "2026-10-02" }).popis).toMatch(/instance nemá overlay/);
    // se souborem prostředí o něm ví → nedostupný overlay je výjimka
    expect(() => drzeniInstance("test", { dnes: "2026-10-02", envSoubory: [envSoubor] })).toThrow(/deklarace držení NEČITELNÁ/);
    expect(process.env[DECLARATION_ENV], "propůjčená deklarace v prostředí procesu nezůstala").toBe("");
    // soubor bez deklarace = instance bez overlaye
    const bez = join(d, "env.bez");
    writeFileSync(bez, "JINY_KLIC=x\n");
    expect(drzeniInstance("test", { dnes: "2026-10-02", envSoubory: [bez] }).popis).toMatch(/instance nemá overlay/);
  });
});

describe("dotaz nad ověřenou deklarací (polozkaZDrzenych)", () => {
  const overena = JSON.stringify(validuj([polozka()], K).polozky);

  it("držená → položka; nedržená → null", () => {
    expect(polozkaZDrzenych(overena, "web-render")).toMatchObject({ aplikace: "web-render", dni: 4 });
    expect(polozkaZDrzenych(overena, "core")).toBeNull();
    expect(polozkaZDrzenych("[]", "web-render")).toBeNull();
  });

  it("⛔ prázdná, nečitelná nebo jinak tvarovaná hodnota je chyba, ne „není držená“", () => {
    for (const vadna of ["", "{nejde", '{"aplikace":"web-render"}', '[{"aplikace":"web-render"}]', "[null]"]) {
      expect(() => polozkaZDrzenych(vadna, "web-render"), vadna).toThrow(/deklarace držení/);
    }
  });
});

describe("CLI mimo CI: --instance, --tvar tsv, dotaz --drzene/--aplikace", { timeout: 60_000 }, () => {
  /** Čisté prostředí: jen to, co test deklaruje (žádný overlay ze stroje, kde test běží). */
  const cli = (args, env = {}) =>
    spawnSync(process.execPath, ["scripts/lib/nasazeni-drzene.mjs", ...args], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", TMPDIR: process.env.TMPDIR ?? "", ...env },
    });

  it("instance bez overlaye: JSON [] / TSV jen patička s nulou a důvodem", () => {
    const j = cli(["--instance", "test"]);
    expect(j.status, j.stderr).toBe(0);
    expect(j.stdout.trim()).toBe("[]");
    const t = cli(["--instance", "test", "--tvar", "tsv"]);
    expect(t.status, t.stderr).toBe(0);
    expect(t.stdout.split("\n").filter(Boolean)).toEqual([expect.stringMatching(new RegExp(`^${PATICKA_TSV}\t0\tinstance nemá overlay`))]);
  });

  it("TSV: řádek „aplikace<TAB>hláška DRŽENO“ na aplikaci a patička s počtem", () => {
    const t = cli(["--instance", "test", "--tvar", "tsv", "--dnes", "2026-10-02"], { [OVERLAY_ENV]: overlay([polozka(), polozka({ aplikace: "local-ingest" })]) });
    expect(t.status, t.stderr).toBe(0);
    const radky = t.stdout.split("\n").filter(Boolean);
    expect(radky).toHaveLength(3);
    expect(radky[0]).toMatch(/^web-render\tDRŽENO: web-render — .* \(4 dní\)$/);
    expect(radky[1]).toMatch(/^local-ingest\tDRŽENO: local-ingest — /);
    expect(radky[2]).toMatch(new RegExp(`^${PATICKA_TSV}\t2\t`));
  });

  it("⛔ neplatná deklarace a nedostupný overlay → kód 1, ::error, PRÁZDNÝ stdout (ani patička)", () => {
    const n = cli(["--instance", "test", "--tvar", "tsv"], { [OVERLAY_ENV]: overlay([polozka({ aplikace: "core" })]) });
    expect(n.status).toBe(1);
    expect(n.stdout).toBe("");
    expect(n.stderr).toMatch(/::error title=deklarace držení NEPLATNÁ::core: nasazuje ji PŘÍMÁ úloha/);
    const u = cli(["--instance", "test", "--tvar", "tsv"], { [DECLARATION_ENV]: `file://${join(overlay(), "neexistuje.git")}#main` });
    expect(u.status).toBe(1);
    expect(u.stdout).toBe("");
    expect(u.stderr).toMatch(/::error title=deklarace držení NEČITELNÁ::test: instance deklaruje vlastní overlay/);
  });

  it("--env-soubor: deklarace overlaye ze souboru prostředí instance", () => {
    const d = overlay();
    const envSoubor = join(d, "env.instance");
    writeFileSync(envSoubor, `${DECLARATION_ENV}=file://${join(d, "neexistuje.git")}#main\n`);
    expect(cli(["--instance", "test"]).stdout.trim()).toBe("[]");
    const r = cli(["--instance", "test", "--env-soubor", envSoubor]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/deklarace držení NEČITELNÁ/);
  });

  it("dotaz --drzene/--aplikace: 0 = držená (hláška), 3 = není, 1 = nevíme", () => {
    const overena = JSON.stringify(validuj([polozka()], K).polozky);
    const ano = cli(["--drzene", overena, "--aplikace", "web-render"]);
    expect(ano.status, ano.stderr).toBe(0);
    expect(ano.stdout.trim()).toMatch(/^DRŽENO: web-render — /);
    const ne = cli(["--drzene", overena, "--aplikace", "core"]);
    expect(ne.status).toBe(3);
    expect(ne.stdout).toBe("");
    // ztracený output úlohy, která deklaraci četla (prázdná hodnota) = nevíme
    for (const vadna of ["", "{nejde", "{}"]) {
      const r = cli(["--drzene", vadna, "--aplikace", "web-render"]);
      expect(r.status, vadna).toBe(1);
      expect(r.stderr).toMatch(/::error title=deklarace držení::/);
    }
  });

  it("⛔ neznámý přepínač a nejednoznačné zadání → kód 2 (překlep nesmí vybrat jiný režim)", () => {
    expect(cli(["--instanc", "test"]).status).toBe(2);
    expect(cli(["--instance", "test", "--soubor", "x"]).status).toBe(2);
    expect(cli(["--instance", "test", "--tvar", "csv"]).status).toBe(2);
    expect(cli(["--soubor", "x", "--env-soubor", "y"]).status).toBe(2);
    expect(cli(["--drzene", "[]"]).status).toBe(2);
    expect(cli(["--drzene", "[]", "--aplikace", "x", "--instance", "test"]).status).toBe(2);
  });
});

// ── D3 jako měřidlo + mutanti MD3 (nečitelná = prázdný seznam) a m12 (nedostupný overlay = nic drženo) ──
describe("⛔ „nevím, co je drženo“ nikdy není „nic drženo“ — a mutant, který to splete, propadne", { timeout: 60_000 }, () => {
  afterEach(() => vi.unstubAllEnvs());
  const LIB = dirname(fileURLToPath(import.meta.url));

  /** MĚŘIDLO D3 nad libovolným modulem (skutečným i mutantem): seznam případů, kdy se „nevím“ přečetlo jako „nic drženo“. */
  function poruseniD3(modul) {
    const out = [];
    const zkus = (popis, priprav) => {
      vi.stubEnv(OVERLAY_ENV, "");
      vi.stubEnv(DECLARATION_ENV, "");
      vi.stubEnv(REQUIRED_ENV, "");
      priprav();
      try {
        const d = modul.drzeniInstance("test", { dnes: "2026-10-02" });
        out.push(`${popis}: vrátilo ${JSON.stringify(d.polozky)} („${d.popis}“) místo výjimky`);
      } catch (e) {
        if (!Array.isArray(e?.chyby) || !e.chyby.length) out.push(`${popis}: výjimka bez důvodů (${e?.message})`);
      }
      vi.unstubAllEnvs();
    };
    zkus("nečitelný JSON", () => vi.stubEnv(OVERLAY_ENV, overlay("{nejde")));
    zkus("položka bez důvodu", () => vi.stubEnv(OVERLAY_ENV, overlay([polozka({ duvod: "" })])));
    zkus("overlay nastavený a nedostupný", () => vi.stubEnv(DECLARATION_ENV, `file://${join(overlay(), "neexistuje.git")}#main`));
    zkus("ruční přebití míří na neexistující adresář", () => vi.stubEnv(OVERLAY_ENV, join(overlay(), "neni-tu")));
    zkus("deklarace overlaye nejde přečíst jako adresa", () => vi.stubEnv(DECLARATION_ENV, "::nejde-precist::"));
    zkus("overlay vynucený a chybí", () => vi.stubEnv(REQUIRED_ENV, "1"));
    return out;
  }

  /**
   * Text důvodů výjimky v jednom stavu. Deklarovaný overlay je zároveň vynucený, takže
   * mutant jedné vrstvy výjimku nezruší — zamlčí ale skutečnou příčinu. Měří se proto důvod.
   */
  function pricina(modul, priprav) {
    vi.stubEnv(OVERLAY_ENV, "");
    vi.stubEnv(DECLARATION_ENV, "");
    vi.stubEnv(REQUIRED_ENV, "");
    priprav();
    try {
      modul.drzeniInstance("test", { dnes: "2026-10-02" });
      return "nevyhodilo";
    } catch (e) {
      return (e.chyby ?? []).join(" ");
    } finally {
      vi.unstubAllEnvs();
    }
  }

  /** Kopie domova s pozměněným zdrojem; relativní importy míří na skutečné sousedy. */
  async function mutant(z, na) {
    const zdroj = readFileSync(join(LIB, "nasazeni-drzene.mjs"), "utf8");
    expect(zdroj.includes(z), `mutace se nemá čeho chytit: ${z}`).toBe(true);
    const dir = mkdtempSync(join(tmpdir(), "mutant-drzeni-"));
    const cesta = join(dir, "nasazeni-drzene.mjs");
    writeFileSync(
      cesta,
      zdroj
        .replace(z, na)
        .replaceAll('from "./', `from "${pathToFileURL(LIB).href}/`)
        // REPO_ROOT se v kopii počítá z umístění souboru — připnout na skutečný kořen
        .replace('const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");', `const REPO_ROOT = ${JSON.stringify(join(LIB, "..", ".."))};`),
    );
    return import(pathToFileURL(cesta).href);
  }

  it("skutečný domov: nula porušení (a kotva: platná deklarace se načte)", async () => {
    expect(poruseniD3({ drzeniInstance })).toEqual([]);
    vi.stubEnv(DECLARATION_ENV, "");
    vi.stubEnv(REQUIRED_ENV, "");
    vi.stubEnv(OVERLAY_ENV, overlay([polozka()]));
    expect(drzeniInstance("test", { dnes: "2026-10-02" }).polozky).toHaveLength(1);
  });

  it("MD3: mutant „nečitelná deklarace = prázdný seznam“ na měřidle propadne", async () => {
    const m = await mutant('      titulek: "deklarace držení NEČITELNÁ",\n      chyby: [`${soubor}: ${e.message}', '      titulek: "",\n      chyby: [],\n      puvodni: [`${soubor}: ${e.message}');
    expect(poruseniD3(m).some((p) => p.startsWith("nečitelný JSON"))).toBe(true);
  });

  it("MD3b: mutant, který chyby validace zahodí (neplatná položka = nic drženo), propadne", async () => {
    const m = await mutant("  if (d.chyby.length) throw selhani(d.titulek, d.chyby);", "  if (false) throw selhani(d.titulek, d.chyby);");
    const p = poruseniD3(m);
    expect(p.some((x) => x.startsWith("nečitelný JSON"))).toBe(true);
    expect(p.some((x) => x.startsWith("položka bez důvodu"))).toBe(true);
  });

  it("m12: nedostupný overlay — výjimka jmenuje PŘÍČINU; mutant „nedostupný = instance bez overlaye“ ji ztratí", async () => {
    const nedostupny = () => vi.stubEnv(DECLARATION_ENV, `file://${join(overlay(), "neexistuje.git")}#main`);
    expect(pricina({ drzeniInstance }, nedostupny)).toMatch(/nejde ho získat/);
    const m = await mutant(
      '    throw selhani("deklarace držení NEČITELNÁ", [`${e.message} Nevíme, co je drženo',
      '    dir = null; if (false) throw selhani("deklarace držení NEČITELNÁ", [`${e.message} Nevíme, co je drženo',
    );
    expect(poruseniD3(m)).toEqual([]);
    expect(pricina(m, nedostupny)).not.toMatch(/nejde ho získat/);
  });

  it("m13: mutant „ruční přebití, které neexistuje, se přeskočí“ propadne", async () => {
    const m = await mutant("  if (rucni && !overlayDir()) throw nevime(", "  if (false) throw nevime(");
    expect(poruseniD3(m)).toEqual([expect.stringMatching(/^ruční přebití míří na neexistující adresář: vrátilo \[\]/)]);
  });

  it("m14: nečitelná adresa overlaye — výjimka jmenuje PŘÍČINU; mutant, který tu kontrolu vynechá, ji ztratí", async () => {
    const necitelna = () => vi.stubEnv(DECLARATION_ENV, "::nejde-precist::");
    expect(pricina({ drzeniInstance }, necitelna)).toMatch(/nejde přečíst jako adresa repozitáře/);
    const m = await mutant("    if (overlayDeclared() && !deklarovanyOverlayRepo()) throw nevime(", "    if (false) throw nevime(");
    expect(poruseniD3(m)).toEqual([]);
    expect(pricina(m, necitelna)).not.toMatch(/nejde přečíst jako adresa repozitáře/);
  });

  it("m15: mutant „vynucený overlay, který chybí = nic drženo“ propadne", async () => {
    const m = await mutant("  if (!dir && vynuceno) throw nevime(", "  if (false) throw nevime(");
    expect(poruseniD3(m)).toEqual([expect.stringMatching(/^overlay vynucený a chybí: vrátilo \[\]/)]);
  });
});
