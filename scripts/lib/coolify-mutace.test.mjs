/**
 * coolify-mutace.mjs — jediný domov mutace aplikace v Coolify.
 *
 * Měří se CHOVÁNÍ: co domov Coolify opravdu pošle (falešný klient / falešný server
 * na loopbacku), ne text. Kontrakt (D = případ, MD = mutace, která ho musí shodit):
 *   D1  držená aplikace → žádné volání, „DRŽENO: …“                 (MD1)
 *   D2  táž aplikace bez deklarace → volání odejde (kotva)
 *   D3  nečitelná deklarace / nedostupný overlay → žádná mutace, kód ≠ 0 (MD3)
 *   D4  držená + --force → pořád držená                              (MD4)
 *   D5  restart, start, stop i návrat držené → nevolá se             (MD2)
 *   T9  jméno se porovnává přesně, ne podřetězcem                    (MD7)
 * Mutanti jsou v testu: kopie modulu s pozměněným zdrojem musí na TÉMŽE měřidle
 * propadnout — jinak měřidlo neměří.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AKCE, adresaWebhooku, drzenaPolozka, externiPolozka, mutujAplikaci, roleAplikace } from "./coolify-mutace.mjs";
import { DECLARATION_ENV, OVERLAY_ENV } from "./instance-overlay.mjs";
import { KOD_DRZENO, SOUBOR } from "./nasazeni-drzene.mjs";

const LIB = dirname(fileURLToPath(import.meta.url));
const ROOT = join(LIB, "..", "..");

/** Ověřená položka deklarace (tvar výstupu validace). */
const drzi = (aplikace) => ({ aplikace, duvod: "zkušební důvod držení", kdo: "majitel", datum: "2026-09-28", odkaz: "rozhodnutí 2026-09-28", vlna: 10, dni: 4 });

/**
 * Falešný klient Coolify. `volani` = MUTACE (vše kromě GET), `cteni` = GET. Čtení
 * aplikace a nasazení odpovídá jménem `vlastnik` (párování uuid ↔ jméno, revize cb N2).
 */
function klient(vlastnik = "inst-edge", { nasazeniPatri = vlastnik } = {}) {
  const volani = [];
  const cteni = [];
  const volej = async (cesta, volby) => {
    if (volby?.method === "GET") {
      cteni.push(cesta);
      if (/^\/applications\/[^/]+$/.test(cesta)) return { uuid: cesta.split("/")[2], name: vlastnik };
      // null = odpověď bez jména aplikace (nejde zjistit, komu nasazení patří)
      if (/^\/deployments\/[^/]+$/.test(cesta)) return nasazeniPatri === null ? { status: "finished" } : { application_name: nasazeniPatri };
      throw new Error(`falešný klient: neznámé čtení ${cesta}`);
    }
    volani.push({ cesta, ...volby });
    return { deployments: [{ deployment_uuid: "dep-1" }] };
  };
  return { volani, cteni, volej };
}

const VSECHNY_AKCE = [
  { akce: "deploy", uuid: "uuid1", force: true },
  { akce: "restart", uuid: "uuid1" },
  { akce: "start", uuid: "uuid1" },
  { akce: "stop", uuid: "uuid1" },
  { akce: "navrat", uuid: "uuid1", nasazeni: "dep0" },
  { akce: "restart", uuid: "uuid1", nasazeni: "dep0" },
];

/**
 * MĚŘIDLO kontraktu nad libovolným modulem (skutečným i mutantem): vrátí seznam
 * porušení. Prázdný = modul kontrakt drží.
 */
async function poruseni(modul) {
  const out = [];
  // D1 + D5: držená aplikace — žádná akce neodejde
  for (const z of VSECHNY_AKCE) {
    const k = klient("inst-web-render");
    const v = await modul.mutujAplikaci({ ...z, jmeno: "inst-web-render", prefix: "inst" }, { kdo: "test", volej: k.volej, drzene: [drzi("web-render")] });
    if (k.volani.length || v.drzeno !== true) out.push(`D1/D5 ${z.akce}: držená aplikace dostala volání (${k.volani.map((x) => x.cesta).join(", ") || "drzeno≠true"})`);
    else if (!/^DRŽENO: web-render — zkušební důvod držení/.test(v.hlaska)) out.push(`D1 ${z.akce}: hláška není „DRŽENO: <aplikace> — <důvod>“`);
  }
  // D2: táž aplikace bez deklarace — volání odejde (kotva: měřidlo volání vidí)
  for (const z of VSECHNY_AKCE) {
    const k = klient("inst-web-render");
    const v = await modul.mutujAplikaci({ ...z, jmeno: "inst-web-render", prefix: "inst" }, { kdo: "test", volej: k.volej, drzene: [] });
    if (k.volani.length !== 1 || v.drzeno !== false) out.push(`D2 ${z.akce}: nedržená aplikace volání nedostala`);
  }
  // D4: --force držení nepřebije
  {
    const k = klient("inst-web-render");
    await modul.mutujAplikaci({ akce: "deploy", uuid: "uuid1", force: true, jmeno: "inst-web-render", prefix: "inst" }, { kdo: "test", volej: k.volej, drzene: [drzi("web-render")] });
    if (k.volani.length) out.push("D4: force=true držení přebil");
  }
  // T9: přesná shoda jména — podobné jméno držené není, a držené není „podobné“
  for (const [drzena, jmeno, maBytDrzena] of [
    ["web", "inst-web-render", false],
    ["web-render", "inst-web", false],
    ["render", "inst-web-render", false],
    ["web-render", "inst-web-render-2", false],
    ["web-render", "inst-web-render", true],
  ]) {
    const k = klient(jmeno);
    await modul.mutujAplikaci({ akce: "deploy", uuid: "uuid1", jmeno, prefix: "inst" }, { kdo: "test", volej: k.volej, drzene: [drzi(drzena)] });
    if ((k.volani.length === 0) !== maBytDrzena) out.push(`T9: drženo „${drzena}“, aplikace „${jmeno}“ → ${k.volani.length ? "nasazena" : "držena"} (má být ${maBytDrzena ? "držena" : "nasazena"})`);
  }
  // N1: bez prefixu nebo se jménem mimo instanci se role určit nedá — nic neodejde
  for (const [jmeno, prefix] of [["inst-web-render", ""], ["web-render", "inst"], ["jina-web-render", "inst"]]) {
    const k = klient(jmeno);
    let vyjimka = false;
    try {
      await modul.mutujAplikaci({ akce: "deploy", uuid: "uuid1", jmeno, prefix }, { kdo: "test", volej: k.volej, drzene: [drzi("web-render")] });
    } catch {
      vyjimka = true;
    }
    if (!vyjimka || k.volani.length) out.push(`N1: jméno „${jmeno}“ s prefixem „${prefix}“ → ${k.volani.length ? "mutace odešla" : "bez výjimky"}`);
  }
  // N2: uuid (nebo nasazení) patří JINÉ aplikaci, než na kterou se stráž ptala — nic neodejde
  for (const [z, k, popis] of [
    [{ akce: "deploy", uuid: "uuid1" }, klient("inst-web-render"), "uuid držené aplikace pod jménem nedržené"],
    [{ akce: "navrat", uuid: "uuid1", nasazeni: "dep0" }, klient("inst-edge", { nasazeniPatri: "inst-web-render" }), "nasazení držené aplikace"],
    [{ akce: "restart", uuid: "uuid1", nasazeni: "dep0" }, klient("inst-edge", { nasazeniPatri: null }), "nasazení, jehož aplikaci nejde zjistit"],
  ]) {
    let vyjimka = false;
    try {
      await modul.mutujAplikaci({ ...z, jmeno: "inst-edge", prefix: "inst" }, { kdo: "test", volej: k.volej, drzene: [drzi("web-render")] });
    } catch {
      vyjimka = true;
    }
    if (!vyjimka || k.volani.length) out.push(`N2: ${popis} → ${k.volani.length ? "mutace odešla" : "bez výjimky"}`);
  }
  return out;
}

/** Kopie domova s pozměněným zdrojem; relativní importy míří na skutečné sousedy. */
async function mutant(z, na) {
  const zdroj = readFileSync(join(LIB, "coolify-mutace.mjs"), "utf8");
  expect(zdroj.includes(z), `mutace se nemá čeho chytit: ${z}`).toBe(true);
  const dir = mkdtempSync(join(tmpdir(), "mutant-mutace-"));
  const cesta = join(dir, "coolify-mutace.mjs");
  writeFileSync(cesta, zdroj.replace(z, na).replaceAll('from "./', `from "${pathToFileURL(LIB).href}/`));
  return import(pathToFileURL(cesta).href);
}

describe("mutujAplikaci: držená aplikace nedostane ŽÁDNOU mutaci", () => {
  it("skutečný domov kontrakt drží (D1, D2, D4, D5, T9, N1, N2)", async () => {
    expect(await poruseni({ mutujAplikaci })).toEqual([]);
  });

  it("cesty a metoda: POST na jediné místo, kde se cesta mutace skládá", async () => {
    const cesty = [];
    for (const z of VSECHNY_AKCE) {
      const k = klient();
      await mutujAplikaci({ ...z, jmeno: "inst-edge", prefix: "inst" }, { kdo: "test", volej: k.volej, drzene: [] });
      expect(k.volani[0].method).toBe("POST");
      cesty.push(k.volani[0].cesta);
    }
    expect(cesty).toEqual([
      "/deploy?uuid=uuid1&force=true",
      "/applications/uuid1/restart",
      "/applications/uuid1/start",
      "/applications/uuid1/stop",
      "/deployments/dep0/restart?force=true",
      "/applications/uuid1/restart?deployment_uuid=dep0&force=true",
    ]);
    expect(AKCE.deploy({ uuid: "uuid1" })).toBe("/deploy?uuid=uuid1&force=false");
  });

  it("⛔ MD1: mutant, který se domova držení neptá, na měřidle propadne (D1)", async () => {
    const m = await mutant("if (polozka) return { drzeno: true, hlaska: hlaskaDrzeno(polozka), polozka };", "if (false) return { drzeno: true, hlaska: hlaskaDrzeno(polozka), polozka };");
    expect((await poruseni(m)).filter((p) => p.startsWith("D1/D5 deploy")).length).toBeGreaterThan(0);
  });

  it("⛔ MD2: mutant, který držení čte jen pro deploy, propadne na restartu, startu i stopu (D5)", async () => {
    const m = await mutant("  const polozka = drzenaPolozka(z, k);\n  if (polozka) return { drzeno: true", '  const polozka = z.akce === "deploy" ? drzenaPolozka(z, k) : null;\n  if (polozka) return { drzeno: true');
    const p = await poruseni(m);
    for (const akce of ["restart", "start", "stop", "navrat"]) expect(p.some((x) => x.startsWith(`D1/D5 ${akce}`)), akce).toBe(true);
    expect(p.some((x) => x.startsWith("D1/D5 deploy"))).toBe(false);
  });

  it("⛔ MD4: mutant, u kterého force držení přebije, propadne (D4)", async () => {
    const m = await mutant("if (polozka) return { drzeno: true, hlaska: hlaskaDrzeno(polozka), polozka };", "if (polozka && !z.force) return { drzeno: true, hlaska: hlaskaDrzeno(polozka), polozka };");
    expect((await poruseni(m)).some((p) => p.startsWith("D4"))).toBe(true);
  });

  it("⛔ MD7: mutant, který jméno porovnává podřetězcem, propadne na podobných jménech (T9)", async () => {
    const m = await mutant("polozky.find((p) => p.aplikace === role || p.aplikace === jmeno)", "polozky.find((p) => role.includes(p.aplikace) || p.aplikace.includes(role))");
    const p = await poruseni(m);
    expect(p.filter((x) => x.startsWith("T9")).length).toBeGreaterThanOrEqual(3);
  });

  it("⛔ N1 (revize cb): mutant „jméno mimo instanci projde“ propadne — role by byla celé jméno a deklarace by ji minula", async () => {
    const m = await mutant("  if (!jmeno.startsWith(`${prefix}-`)) throw new Error(", "  if (false) throw new Error(");
    const p = await poruseni(m);
    expect(p.some((x) => x.startsWith("N1: jméno „web-render“ s prefixem „inst“"))).toBe(true);
    expect(p.some((x) => x.startsWith("N1: jméno „jina-web-render“ s prefixem „inst“"))).toBe(true);
  });

  it("N1: prázdný prefix jmenuje PŘÍČINU (druhá stráž by ho chytila taky, jen s matoucím důvodem)", async () => {
    const k = klient("inst-web-render");
    await expect(mutujAplikaci({ akce: "deploy", uuid: "uuid1", jmeno: "inst-web-render", prefix: " " }, { kdo: "test", volej: k.volej, drzene: [] })).rejects.toThrow(/chybí prefix instance/);
    expect([...k.volani, ...k.cteni]).toEqual([]);
  });

  it("⛔ N2 (revize cb): mutant, který párování uuid ↔ jméno neověří, propadne", async () => {
    const m = await mutant("  await overParovani(z, k);\n", "");
    const p = await poruseni(m);
    expect(p.filter((x) => x.startsWith("N2:")).length).toBe(3);
  });

  it("párování se čte PŘED mutací, jen u nedržené aplikace, a nasazení se ověřuje jen s nasazením", async () => {
    const k = klient("inst-edge");
    await mutujAplikaci({ akce: "restart", uuid: "uuid1", nasazeni: "dep0", jmeno: "inst-edge", prefix: "inst" }, { kdo: "test", volej: k.volej, drzene: [] });
    expect(k.cteni).toEqual(["/applications/uuid1", "/deployments/dep0"]);
    const d = klient("inst-web-render");
    await mutujAplikaci({ akce: "deploy", uuid: "uuid1", jmeno: "inst-web-render", prefix: "inst" }, { kdo: "test", volej: d.volej, drzene: [drzi("web-render")] });
    expect(d.cteni, "držená aplikace nepotřebuje ani čtení").toEqual([]);
  });

  it("⛔ bez jména aplikace, s neznámou akcí nebo vadným identifikátorem se NEODEŠLE nic", async () => {
    for (const z of [
      { akce: "deploy", uuid: "uuid1", jmeno: "" },
      { akce: "deploy", uuid: "uuid1" },
      { akce: "smazat", uuid: "uuid1", jmeno: "inst-edge" },
      { akce: "webhook", uuid: "uuid1", jmeno: "inst-edge" },
      { akce: "deploy", uuid: "a b&force=true", jmeno: "inst-edge" },
      { akce: "navrat", uuid: "uuid1", jmeno: "inst-edge" },
    ]) {
      const k = klient();
      await expect(mutujAplikaci({ prefix: "inst", ...z }, { kdo: "test", volej: k.volej, drzene: [] }), JSON.stringify(z)).rejects.toThrow(/coolify-mutace/);
      expect(k.volani, JSON.stringify(z)).toEqual([]);
    }
    const k = klient();
    await expect(mutujAplikaci({ akce: "deploy", uuid: "uuid1", jmeno: "inst-edge", prefix: "inst" }, { kdo: "test", volej: k.volej, drzene: "[]" })).rejects.toThrow(/není pole/);
    expect(k.volani).toEqual([]);
  });

  it("chyba klienta (síť, HTTP) se propouští beze změny — není to „drženo“ ani úspěch", async () => {
    const chyba = Object.assign(new Error("HTTP 429 fronta"), { backpressure: true });
    await expect(
      mutujAplikaci({ akce: "deploy", uuid: "uuid1", jmeno: "inst-edge", prefix: "inst" }, { kdo: "test", drzene: [], volej: async () => Promise.reject(chyba) }),
    ).rejects.toBe(chyba);
  });
});

describe("pomocné funkce domova", () => {
  it("externiPolozka bez profilu (ani AISHA_PROFILE): null + priNezmereno s důvodem — nikdy tiché „vlastní“", () => {
    const puvodni = process.env.AISHA_PROFILE;
    delete process.env.AISHA_PROFILE;
    try {
      const duvody = [];
      expect(externiPolozka({ jmeno: "inst-keycloak", prefix: "inst" }, { priNezmereno: (d) => duvody.push(d) })).toBeNull();
      expect(duvody).toEqual([expect.stringMatching(/profil prostředí nedeklarován .* externí služby nerozliším/)]);
      // s mapou od volajícího se neptá na profil vůbec
      expect(externiPolozka({ jmeno: "inst-keycloak", prefix: "inst" }, { externi: new Map([["keycloak", "auth.cizi.example"]]) })).toMatchObject({ role: "keycloak", domena: "auth.cizi.example" });
    } finally {
      if (puvodni === undefined) delete process.env.AISHA_PROFILE;
      else process.env.AISHA_PROFILE = puvodni;
    }
  });

  it("role = jméno bez prefixu instance; cizí nebo žádný prefix jméno nemění", () => {
    expect(roleAplikace("inst-web-render", "inst")).toBe("web-render");
    expect(roleAplikace("instx-web-render", "inst")).toBe("instx-web-render");
    expect(roleAplikace("web-render", "inst")).toBe("web-render");
    expect(roleAplikace("inst-web-render", "")).toBe("inst-web-render");
  });

  it("drzenaPolozka: přesná shoda role; bez jména výjimka", () => {
    expect(drzenaPolozka({ jmeno: "inst-web-render", prefix: "inst" }, { kdo: "t", drzene: [drzi("web-render")] })).toMatchObject({ aplikace: "web-render" });
    expect(drzenaPolozka({ jmeno: "inst-web", prefix: "inst" }, { kdo: "t", drzene: [drzi("web-render")] })).toBeNull();
    expect(() => drzenaPolozka({ jmeno: " ", prefix: "inst" }, { kdo: "t", drzene: [] })).toThrow(/chybí jméno aplikace/);
  });

  it("webhook je mutace odložená na cizí ruku: držené aplikaci se adresa NEVYDÁ", () => {
    const k = { kdo: "t", zaklad: "http://127.0.0.1:1/" };
    expect(adresaWebhooku({ jmeno: "inst-edge", prefix: "inst", uuid: "uuid1" }, { ...k, drzene: [drzi("web-render")] })).toEqual({
      drzeno: false,
      adresa: "http://127.0.0.1:1/api/v1/deploy?uuid=uuid1&force=false",
    });
    const d = adresaWebhooku({ jmeno: "inst-web-render", prefix: "inst", uuid: "uuid1" }, { ...k, drzene: [drzi("web-render")] });
    expect(d.drzeno).toBe(true);
    expect(d.adresa).toBeUndefined();
    expect(d.hlaska).toMatch(/^DRŽENO: web-render — /);
    expect(() => adresaWebhooku({ jmeno: "inst-edge", prefix: "inst", uuid: "uuid1" }, { kdo: "t", drzene: [], zaklad: "" })).toThrow(/chybí adresa Coolify/);
  });
});

// ── CLI a shellový obal proti falešnému Coolify (jen loopback) ─────────────────
let server;
let zaklad = "";
/** @type {Array<{ metoda: string, url: string, autorizace: string }>} MUTACE (vše kromě GET) */
let pozadavky = [];
/** @type {string[]} čtení (GET) — párování uuid ↔ jméno */
let cteni = [];
let odpovedServeru = { kod: 200, telo: { deployments: [{ deployment_uuid: "dep-cli" }] } };
/** Čí je uuid podle falešného Coolify (párování, revize cb N2). */
let jmenoNaServeru = "inst-edge";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? "";
    if (req.method === "GET") {
      cteni.push(url);
      const a = /^\/api\/v1\/applications\/([^/?]+)$/.exec(url);
      res.writeHead(a ? 200 : 404, { "content-type": "application/json" });
      res.end(JSON.stringify(a ? { uuid: a[1], name: jmenoNaServeru } : { message: "neznámé čtení" }));
      return;
    }
    pozadavky.push({ metoda: req.method ?? "", url, autorizace: req.headers.authorization ?? "" });
    res.writeHead(odpovedServeru.kod, { "content-type": "application/json" });
    res.end(JSON.stringify(odpovedServeru.telo));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  zaklad = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

function overlay(obsah) {
  const d = mkdtempSync(join(tmpdir(), "mutace-overlay-"));
  if (obsah !== undefined) writeFileSync(join(d, SOUBOR), typeof obsah === "string" ? obsah : JSON.stringify(obsah));
  return d;
}
const deklarace = (aplikace = "web-render") => [{ aplikace, duvod: "zkušební důvod držení", rozhodnuti: { kdo: "majitel", datum: "2026-09-28", odkaz: "rozhodnutí 2026-09-28" } }];

/** Spustí příkaz v ČISTÉM prostředí (jen co test deklaruje) a počká — server testu běží dál. */
function spust(prikaz, args, env = {}, vlastnik = "inst-edge") {
  pozadavky = [];
  cteni = [];
  jmenoNaServeru = vlastnik;
  odpovedServeru = { kod: 200, telo: { deployments: [{ deployment_uuid: "dep-cli" }] } };
  return new Promise((ok) => {
    const p = spawn(prikaz, args, {
      cwd: ROOT,
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", TMPDIR: process.env.TMPDIR ?? "", COOLIFY_URL: zaklad, COOLIFY_API_TOKEN: "fixture-token", ...env },
    });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (rc) => ok({ rc, out, err, pozadavky: [...pozadavky] }));
  });
}
const cli = (args, env) => {
  const i = args.indexOf("--jmeno");
  return spust(process.execPath, ["scripts/lib/coolify-mutace.mjs", ...args], env, i >= 0 ? args[i + 1] : "inst-edge");
};
const zakladni = (akce, jmeno = "inst-web-render") => ["--akce", akce, "--jmeno", jmeno, "--prefix", "inst", "--uuid", "uuid1", "--kdo", "test"];

describe("CLI: kód 100 = DRŽENO, nezaměnitelný s úspěchem ani s chybou sítě", { timeout: 60_000 }, () => {
  it("D2 (kotva): instance bez overlaye i overlay bez souboru → mutace ODEJDE, kód 0, odpověď na stdout", async () => {
    for (const env of [{}, { [OVERLAY_ENV]: overlay() }]) {
      const r = await cli([...zakladni("deploy"), "--force", "true"], env);
      expect(r.rc, r.err).toBe(0);
      expect(r.pozadavky).toEqual([{ metoda: "POST", url: "/api/v1/deploy?uuid=uuid1&force=true", autorizace: "Bearer fixture-token" }]);
      expect(JSON.parse(r.out)).toEqual({ deployments: [{ deployment_uuid: "dep-cli" }] });
    }
  });

  // Revize integrátora 2026-10-04 (bod 3): ruční dispatch deploy.yml volá domov BEZ --profil.
  // Externí služby se pak rozlišit nedají — připnuto: řekne to ::warning a mutace odejde jen
  // na aplikaci, kterou volající jmenoval UUID z projektu instance. Změna tohohle chování
  // (např. předávat profil z vars.AISHA_PROFILE) musí tenhle test vědomě přepsat.
  it("bez profilu prostředí (ruční deploy.yml): externí se NEROZLIŠÍ — ::warning nahlas, mutace odejde (připnutý stav)", async () => {
    const r = await cli([...zakladni("deploy"), "--force", "true"], {});
    expect(r.rc, r.err).toBe(0);
    expect(r.err).toMatch(
      /::warning title=vlastnictví aplikací::coolify-mutace: profil prostředí nedeklarován \(AISHA_PROFILE \/ --profil\) — externí služby nerozliším — mutuji jen aplikaci, která v projektu instance existuje/,
    );
    expect(r.pozadavky).toHaveLength(1);
  });

  it("D1 + D5: držená aplikace → kód 100, hláška DRŽENO, NULA požadavků — pro deploy, restart, start i stop", async () => {
    expect(KOD_DRZENO).toBe(100);
    const env = { [OVERLAY_ENV]: overlay(deklarace()) };
    for (const akce of ["deploy", "restart", "start", "stop"]) {
      const r = await cli(zakladni(akce), env);
      expect(r.rc, `${akce}: ${r.err}`).toBe(KOD_DRZENO);
      expect(r.out).toMatch(/^DRŽENO: web-render — zkušební důvod držení — rozhodnutí majitel 2026-09-28/);
      expect(r.pozadavky, akce).toEqual([]);
    }
    // nedržená aplikace téže instance projde (kotva v témže overlayi)
    const jina = await cli(zakladni("restart", "inst-edge"), env);
    expect(jina.rc, jina.err).toBe(0);
    expect(jina.pozadavky.map((p) => `${p.metoda} ${p.url}`)).toEqual(["POST /api/v1/applications/uuid1/restart"]);
  });

  it("D4: --force držení nepřebije a přepínač, který by ho přebil, neexistuje", async () => {
    const env = { [OVERLAY_ENV]: overlay(deklarace()) };
    const force = await cli([...zakladni("deploy"), "--force", "true"], env);
    expect(force.rc).toBe(KOD_DRZENO);
    expect(force.pozadavky).toEqual([]);
    for (const obchvat of ["--i-drzene", "--ignore-hold", "--no-hold"]) {
      const r = await cli([...zakladni("deploy"), obchvat, "true"], env);
      expect(r.rc, obchvat).toBe(2);
      expect(r.pozadavky, obchvat).toEqual([]);
      expect(r.err).toMatch(/neznámý přepínač/);
    }
  });

  it("D3: nečitelná nebo neplatná deklarace → žádná mutace, kód 2 (ne 0, ne 100)", async () => {
    for (const obsah of ["{nejde", deklarace("core"), [{ aplikace: "web-render" }]]) {
      const r = await cli(zakladni("deploy", "inst-edge"), { [OVERLAY_ENV]: overlay(obsah) });
      expect(r.rc, JSON.stringify(obsah)).toBe(2);
      expect(r.pozadavky).toEqual([]);
      expect(r.err).toMatch(/::error title=deklarace držení (NEČITELNÁ|NEPLATNÁ)::/);
    }
  });

  it("D3/T3: overlay, který instance MÁ nastavený, ale nejde načíst → žádná mutace, kód 2 — zvlášť od „soubor chybí“", async () => {
    const nedostupny = await cli(zakladni("deploy", "inst-edge"), { [DECLARATION_ENV]: `file://${join(overlay(), "neexistuje.git")}#main` });
    expect(nedostupny.rc).toBe(2);
    expect(nedostupny.pozadavky).toEqual([]);
    expect(nedostupny.err).toMatch(/instance deklaruje vlastní overlay/);
    // deklarace overlaye jen v souboru prostředí instance (samostatně spuštěný nástroj) — platí totéž
    const d = overlay();
    writeFileSync(join(d, "env.instance"), `${DECLARATION_ENV}=file://${join(d, "neexistuje.git")}#main\n`);
    const zeSouboru = await cli([...zakladni("deploy", "inst-edge"), "--env-soubor", join(d, "env.instance")]);
    expect(zeSouboru.rc).toBe(2);
    expect(zeSouboru.pozadavky).toEqual([]);
  });

  it("ověřená deklarace od úlohy, která ji četla (--drzene): držená = 100; ztracený output = 2; nic drženo = mutace", async () => {
    const overena = JSON.stringify([drzi("web-render")]);
    const d = await cli([...zakladni("deploy"), "--drzene", overena]);
    expect(d.rc).toBe(KOD_DRZENO);
    expect(d.pozadavky).toEqual([]);
    for (const vadna of ["", "{nejde", "{}"]) {
      const r = await cli([...zakladni("deploy", "inst-edge"), "--drzene", vadna]);
      expect(r.rc, vadna).toBe(2);
      expect(r.pozadavky, vadna).toEqual([]);
    }
    const nic = await cli([...zakladni("deploy"), "--drzene", "[]", "--force", "false"]);
    expect(nic.rc, nic.err).toBe(0);
    expect(nic.pozadavky.map((p) => p.url)).toEqual(["/api/v1/deploy?uuid=uuid1&force=false"]);
  });

  it("chyba Coolify → kód 1 (jiný než DRŽENO i úspěch); chybné zadání a chybějící pověření → kód 2 bez požadavku", async () => {
    pozadavky = [];
    cteni = [];
    jmenoNaServeru = "inst-edge";
    const p = spawn(process.execPath, ["scripts/lib/coolify-mutace.mjs", ...zakladni("deploy", "inst-edge")], {
      cwd: ROOT,
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", COOLIFY_URL: zaklad, COOLIFY_API_TOKEN: "fixture-token" },
    });
    odpovedServeru = { kod: 500, telo: { message: "boom" } };
    const rc = await new Promise((r) => p.on("close", r));
    expect(rc).toBe(1);
    expect(pozadavky).toHaveLength(1);
    expect(cteni).toEqual(["/api/v1/applications/uuid1"]);

    // N2: uuid patří jiné aplikaci → kód 1, mutace NEODEJDE
    const cizi = await spust(process.execPath, ["scripts/lib/coolify-mutace.mjs", ...zakladni("deploy", "inst-edge")], {}, "inst-web-render");
    expect(cizi.rc).toBe(1);
    expect(cizi.pozadavky).toEqual([]);
    expect(cizi.err).toMatch(/uuid uuid1 patří aplikaci „inst-web-render“, ne „inst-edge“/);
    // N1: prázdný prefix → kód 2 bez požadavku
    const bezPrefixu = await cli(["--akce", "deploy", "--jmeno", "inst-edge", "--prefix", "", "--uuid", "uuid1", "--kdo", "test"]);
    expect(bezPrefixu.rc, bezPrefixu.err).toBe(2);
    expect([...bezPrefixu.pozadavky, ...cteni]).toEqual([]);

    expect((await cli(["--akce", "deploy", "--uuid", "uuid1", "--kdo", "test"])).rc).toBe(2);
    expect((await cli(["--akce", "smazat", "--jmeno", "inst-edge", "--uuid", "uuid1", "--kdo", "test"])).rc).toBe(2);
    expect((await cli([...zakladni("deploy", "inst-edge"), "--force", "ano"])).rc).toBe(2);
    const bezTokenu = await cli(zakladni("deploy", "inst-edge"), { COOLIFY_API_TOKEN: "" });
    expect(bezTokenu.rc).toBe(2);
    expect(bezTokenu.pozadavky).toEqual([]);
  });

  it("webhook: adresa pro nedrženou, kód 100 a žádná adresa pro drženou; nic se neodesílá", async () => {
    const env = { [OVERLAY_ENV]: overlay(deklarace()) };
    const ano = await cli(zakladni("webhook", "inst-edge"), env);
    expect(ano.rc, ano.err).toBe(0);
    expect(ano.out.trim()).toBe(`${zaklad}/api/v1/deploy?uuid=uuid1&force=false`);
    const ne = await cli(zakladni("webhook"), env);
    expect(ne.rc).toBe(KOD_DRZENO);
    expect(ne.out).not.toMatch(/api\/v1/);
    expect([...ano.pozadavky, ...ne.pozadavky]).toEqual([]);
  });
});

describe("shellový obal coolify_mutace je obal TÉŽE logiky", { timeout: 60_000 }, () => {
  const obal = (skript, env) => spust("bash", ["-c", `set -euo pipefail\n. "${join(LIB, "coolify-mutace.sh")}"\n${skript}`], env);

  it("nedržená → POST odejde; držená → kód COOLIFY_MUTACE_DRZENO a hláška; číslo je totéž jako v domově", async () => {
    const env = { [OVERLAY_ENV]: overlay(deklarace()) };
    const ano = await obal('coolify_mutace deploy inst-edge uuid1 --kdo test --prefix inst --force true; echo "RC=$?"', env);
    expect(ano.out).toMatch(/RC=0/);
    expect(ano.pozadavky.map((p) => `${p.metoda} ${p.url}`)).toEqual(["POST /api/v1/deploy?uuid=uuid1&force=true"]);
    const ne = await obal('rc=0; out="$(coolify_mutace stop inst-web-render uuid1 --kdo test --prefix inst)" || rc=$?; echo "RC=$rc DRZENO=$COOLIFY_MUTACE_DRZENO"; echo "$out"', env);
    expect(ne.out).toMatch(new RegExp(`RC=${KOD_DRZENO} DRZENO=${KOD_DRZENO}`));
    expect(ne.out).toMatch(/DRŽENO: web-render — /);
    expect(ne.pozadavky).toEqual([]);
  });

  it("bez tří povinných argumentů neodešle nic (kód 2)", async () => {
    const r = await obal('rc=0; coolify_mutace deploy inst-edge || rc=$?; echo "RC=$rc"');
    expect(r.out).toMatch(/RC=2/);
    expect(r.pozadavky).toEqual([]);
  });
});
