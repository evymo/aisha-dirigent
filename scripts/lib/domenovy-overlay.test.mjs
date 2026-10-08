/**
 * domenovy-overlay — který doménový overlay instance, kde leží a co deklaruje o WEB_FQDNS.
 *
 * ⛔ NAMĚŘENO 2026-10-05: redeploy srovnává domény s prostředím z `.env.coolify`,
 * WEB_FQDNS tam nebyl (žije jen v overlayi) a env-doktor overlay najít neuměl.
 * Měří se tu jeden rozklad pro obal cold-startu (`--pozadovany`), cold-start
 * (`--soubor`) i env-doktora (`deklaraceWebFqdns`) — a hlavně rozlišení
 * „prázdné (jedna značka)" × „nevím (nic nevydat)".
 *
 * Repo i overlay jsou dočasné adresáře; jména jsou vymyšlená.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  KOD_NENALEZENO,
  KOD_NEVIM,
  deklaraceWebFqdns,
  pozadovanyDomenovyOverlay,
  rozlozDomenovyOverlay,
} from "./domenovy-overlay.mjs";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "domenovy-overlay.mjs");
const docasne = [];
afterAll(() => {
  for (const d of docasne) rmSync(d, { recursive: true, force: true });
});

/** Adresář se soubory `{ "config/x.env": "obsah" }`. */
function strom(soubory = {}) {
  const d = mkdtempSync(path.join(tmpdir(), "domenovy-overlay-"));
  docasne.push(d);
  for (const [jmeno, obsah] of Object.entries(soubory)) {
    mkdirSync(path.dirname(path.join(d, jmeno)), { recursive: true });
    writeFileSync(path.join(d, jmeno), obsah);
  }
  return d;
}

const PROSTREDI_SOUBOR = [
  "COOLIFY_PROD_DOMAINS_FILE=${COOLIFY_PROD_DOMAINS_FILE:-config/domains.env}",
  "COOLIFY_STAGING_DOMAINS_FILE=${COOLIFY_STAGING_DOMAINS_FILE:-config/domains-staging.env}",
  "",
].join("\n");
const SABLONA = "APP_DOMAIN=${APP_DOMAIN:-}\nWEB_FQDNS=${WEB_FQDNS:-}\n";
const ZNACKY = "https://znacka-a.example,https://znacka-b.example,https://znacka-c.example";

describe("pozadovanyDomenovyOverlay — týž výpočet jako obal cold-startu", () => {
  const repo = strom({ "config/coolify-environments.env": PROSTREDI_SOUBOR, "config/domains-inst-staging.env": "" });

  it("produkce: výchozí z config/coolify-environments.env (`${X:-výchozí}`)", () => {
    expect(pozadovanyDomenovyOverlay({ repo, env: "", prostredi: {} })).toEqual({
      znamo: true, pozadovany: "config/domains.env", deklarovany: "config/domains.env",
    });
  });

  it("deklarace z prostředí přebije soubor (jako `set -a; .` nad prostředím)", () => {
    const r = pozadovanyDomenovyOverlay({ repo, env: "production", prostredi: { COOLIFY_PROD_DOMAINS_FILE: "config/domains-x.env" } });
    expect(r).toMatchObject({ pozadovany: "config/domains-x.env", deklarovany: "config/domains-x.env" });
  });

  it("slot bez deklarace: config/domains-<env>.env, existuje-li v repu; jinak nic", () => {
    expect(pozadovanyDomenovyOverlay({ repo, env: "inst-staging", prostredi: {} })).toEqual({
      znamo: true, pozadovany: "config/domains-inst-staging.env", deklarovany: "",
    });
    expect(pozadovanyDomenovyOverlay({ repo, env: "jina-staging", prostredi: {} })).toEqual({
      znamo: true, pozadovany: "", deklarovany: "",
    });
  });

  it("neznámý tvar prostředí → nevím", () => {
    expect(pozadovanyDomenovyOverlay({ repo, env: "nesmysl", prostredi: {} })).toMatchObject({ znamo: false });
  });

  it("⛔ B1: nerozbalitelný odkaz v deklaraci (soubor i prostředí) → NEVÍM, ne „overlay nežádán“", () => {
    const repoOdkaz = strom({ "config/coolify-environments.env": "COOLIFY_PROD_DOMAINS_FILE=${INSTANCE_DOMAINS}\n" });
    const zeSouboru = pozadovanyDomenovyOverlay({ repo: repoOdkaz, env: "", prostredi: {} });
    expect(zeSouboru.znamo).toBe(false);
    expect(zeSouboru.duvod).toMatch(/INSTANCE_DOMAINS/);
    // S hodnotou odkaz projde.
    expect(pozadovanyDomenovyOverlay({ repo: repoOdkaz, env: "", prostredi: { INSTANCE_DOMAINS: "config/domains-x.env" } })).toMatchObject({
      znamo: true, pozadovany: "config/domains-x.env",
    });
    expect(pozadovanyDomenovyOverlay({ repo, env: "", prostredi: { COOLIFY_PROD_DOMAINS_FILE: "${NIC}" } }).znamo).toBe(false);
    expect(deklaraceWebFqdns({ repo: repoOdkaz, prostredi: {}, ulozena: ZNACKY }).znamo).toBe(false);
  });
});

describe("rozlozDomenovyOverlay — instance-data, pak repo (jako cold-start)", () => {
  const repo = strom({ "config/domains.env": SABLONA, "config/jen-repo.env": "" });
  const overlay = strom({ "config/domains.env": `WEB_FQDNS=${ZNACKY}\n` });

  it("instance-data má přednost; chybí-li tam, repo", () => {
    expect(rozlozDomenovyOverlay({ pozadovany: "config/domains.env", overlayDir: overlay, repo })).toBe(path.join(overlay, "config/domains.env"));
    expect(rozlozDomenovyOverlay({ pozadovany: "config/jen-repo.env", overlayDir: overlay, repo })).toBe(path.join(repo, "config/jen-repo.env"));
    expect(rozlozDomenovyOverlay({ pozadovany: "config/domains.env", overlayDir: "", repo })).toBe(path.join(repo, "config/domains.env"));
  });

  it("absolutní cesta platí, jak je; nenalezeno / nic nežádáno → null", () => {
    const abs = path.join(overlay, "config/domains.env");
    expect(rozlozDomenovyOverlay({ pozadovany: abs, overlayDir: "", repo })).toBe(abs);
    expect(rozlozDomenovyOverlay({ pozadovany: "config/neni.env", overlayDir: overlay, repo })).toBeNull();
    expect(rozlozDomenovyOverlay({ pozadovany: "", overlayDir: overlay, repo })).toBeNull();
  });
});

describe("deklaraceWebFqdns — vrstvy jako cold-start, „nevím“ ≠ prázdno", () => {
  const repo = strom({ "config/coolify-environments.env": PROSTREDI_SOUBOR, "config/domains.env": SABLONA });
  const zOverlaye = (soubory) => {
    const overlay = strom(soubory);
    return () => overlay;
  };

  it("overlay instance deklaruje značky → hodnota i zdroj", () => {
    const r = deklaraceWebFqdns({ repo, prostredi: {}, ulozena: "", ziskejOverlayDir: zOverlaye({ "config/domains.env": `APP_DOMAIN=web.example\nWEB_FQDNS=${ZNACKY}\n` }) });
    expect(r).toMatchObject({ znamo: true, hodnota: ZNACKY });
    expect(r.zdroj).toMatch(/doménový overlay .*config\/domains\.env/);
  });

  it("overlay bez WEB_FQDNS / bez souboru / bez instance-data → ZNÁMÉ prázdno (jedna značka)", () => {
    for (const ziskej of [zOverlaye({ "config/domains.env": "APP_DOMAIN=web.example\n" }), zOverlaye({}), () => null]) {
      expect(deklaraceWebFqdns({ repo, prostredi: {}, ulozena: "", ziskejOverlayDir: ziskej })).toEqual({
        znamo: true, hodnota: "", zdroj: "instance víc značek nedeklaruje",
      });
    }
  });

  it("sebeodkaz `WEB_FQDNS=${WEB_FQDNS:-}` čte PŘEDCHOZÍ vrstvu, ne prostředí volajícího", () => {
    // Prostředí volajícího (redeploy po `. .env.coolify`) nese starou hodnotu — nesmí se vrátit.
    const r = deklaraceWebFqdns({ repo, prostredi: { WEB_FQDNS: "https://stara.example" }, ulozena: "", ziskejOverlayDir: () => null });
    expect(r).toMatchObject({ znamo: true, hodnota: "" });
  });

  it("poslední přiřazení vyhrává: soubor prostředí z repa, pak overlay", () => {
    const repo2 = strom({ "config/domains-x.env": "WEB_FQDNS=https://z-repa.example\n" });
    const zRepa = deklaraceWebFqdns({ repo: repo2, prostredi: { COOLIFY_PROD_DOMAINS_FILE: "config/domains-x.env" }, ulozena: "", ziskejOverlayDir: () => null });
    expect(zRepa).toMatchObject({ znamo: true, hodnota: "https://z-repa.example" });
    const prebito = deklaraceWebFqdns({
      repo: repo2,
      prostredi: { COOLIFY_PROD_DOMAINS_FILE: "config/domains-x.env" },
      ulozena: "",
      ziskejOverlayDir: zOverlaye({ "config/domains-x.env": `export WEB_FQDNS="${ZNACKY}"\n` }),
    });
    expect(prebito).toMatchObject({ znamo: true, hodnota: ZNACKY });
  });

  it("⛔ B2: DOPOČTENÝ požadavek (bez cold-startu) nesmí ubrat uložené značky → NEVÍM", () => {
    const trinact = Array.from({ length: 13 }, (_, i) => `https://znacka${i}.example`).join(",");
    // Kontext bez overlaye (jiné AISHA_ENV, chybějící export…) dá prázdno — se 13 uloženými značkami = nevím.
    const prazdno = deklaraceWebFqdns({ repo, prostredi: {}, ziskejOverlayDir: () => null, ulozena: trinact });
    expect(prazdno.znamo).toBe(false);
    expect(prazdno.duvod).toMatch(/DOPOČTENÝ.*vyprázdnil by.*13 z 13/);
    // Ubrat jedinou značku taky ne.
    const ubrat = deklaraceWebFqdns({
      repo, prostredi: {}, ulozena: `${ZNACKY},https://znacka-d.example`,
      ziskejOverlayDir: zOverlaye({ "config/domains.env": `WEB_FQDNS=${ZNACKY}\n` }),
    });
    expect(ubrat.znamo).toBe(false);
    expect(ubrat.duvod).toMatch(/ubral by.*znacka-d\.example/);
    // Přidat smí (nová značka v overlayi), i se srovnáním velikosti písmen a koncového `/`.
    const pridat = deklaraceWebFqdns({
      repo, prostredi: {}, ulozena: "HTTPS://Znacka-A.example/",
      ziskejOverlayDir: zOverlaye({ "config/domains.env": `WEB_FQDNS=${ZNACKY}\n` }),
    });
    expect(pridat).toMatchObject({ znamo: true, hodnota: ZNACKY });
  });

  it("kotva B2: VÝSLOVNÝ požadavek cold-startu s prázdnou deklarací zúžit SMÍ", () => {
    const r = deklaraceWebFqdns({ repo, prostredi: { DOMAINS_OVERLAY_REQUESTED: "config/domains.env" }, ziskejOverlayDir: () => null, ulozena: ZNACKY });
    expect(r).toEqual({ znamo: true, hodnota: "", zdroj: "instance víc značek nedeklaruje" });
  });

  it("⛔ klíč v cílovém souboru CHYBÍ + dopočtený požadavek → NEVÍM, i s neprázdným overlayem (není s čím porovnat)", () => {
    for (const ziskej of [() => null, zOverlaye({ "config/domains.env": `WEB_FQDNS=${ZNACKY}\n` })]) {
      const r = deklaraceWebFqdns({ repo, prostredi: {}, ziskejOverlayDir: ziskej });
      expect(r.znamo).toBe(false);
      expect(r.duvod).toMatch(/CHYBÍ.*DOPOČTENÝ/);
    }
  });

  it("kotva: výslovný požadavek cold-startu chybějící klíč ZALOŽÍ (i prázdný)", () => {
    expect(deklaraceWebFqdns({ repo, prostredi: { DOMAINS_OVERLAY_REQUESTED: "config/domains.env" }, ziskejOverlayDir: () => null })).toEqual({
      znamo: true, hodnota: "", zdroj: "instance víc značek nedeklaruje",
    });
  });

  it("trezor: výslovně PRÁZDNÝ WEB_FQDNS je deklarace operátora (jako cold-start) — smí i zúžit", () => {
    const r = deklaraceWebFqdns({
      repo, prostredi: {}, ulozena: ZNACKY, trezor: new Map([["WEB_FQDNS", ""]]),
      ziskejOverlayDir: zOverlaye({ "config/domains.env": `WEB_FQDNS=${ZNACKY}\n` }),
    });
    expect(r).toEqual({ znamo: true, hodnota: "", zdroj: "deklarace operátora (trezor)" });
  });

  it("⛔ odkaz v seznamu, který vyjde prázdný — tvrdý i volitelný — je NEVÍM (značka by tiše vypadla)", () => {
    for (const odkaz of ["${ZNACKA_B:-}", "${ZNACKA_B}"]) {
      const r = deklaraceWebFqdns({ repo, prostredi: {}, ziskejOverlayDir: zOverlaye({ "config/domains.env": `WEB_FQDNS=https://a.example,${odkaz}\n` }) });
      expect(r.znamo, odkaz).toBe(false);
      expect(r.duvod, odkaz).toMatch(/ZNACKA_B/);
    }
    // Výchozí hodnota u odkazu značku nese — projde.
    const sVychozi = deklaraceWebFqdns({ repo, prostredi: {}, ulozena: "", ziskejOverlayDir: zOverlaye({ "config/domains.env": "WEB_FQDNS=https://a.example,${ZNACKA_B:-https://b.example}\n" }) });
    expect(sVychozi).toMatchObject({ znamo: true, hodnota: "https://a.example,https://b.example" });
  });

  it("trezor operátora má poslední slovo", () => {
    const r = deklaraceWebFqdns({
      repo, prostredi: {}, ziskejOverlayDir: zOverlaye({ "config/domains.env": `WEB_FQDNS=${ZNACKY}\n` }),
      trezor: new Map([["WEB_FQDNS", "https://z-trezoru.example"]]),
    });
    expect(r).toMatchObject({ znamo: true, hodnota: "https://z-trezoru.example", zdroj: "deklarace operátora (trezor)" });
  });

  it("odkaz v hodnotě se rozbalí z dodaného hledání (topologie, trezor)", () => {
    const r = deklaraceWebFqdns({
      repo, prostredi: {}, ulozena: "", ziskejOverlayDir: zOverlaye({ "config/domains.env": "WEB_FQDNS=https://${APP_DOMAIN},https://b.example\n" }),
      najdi: (n) => (n === "APP_DOMAIN" ? "web.example" : ""),
    });
    expect(r).toMatchObject({ znamo: true, hodnota: "https://web.example,https://b.example" });
  });

  it("⛔ overlay vyžádaný a nenalezený → NEVÍM (žádná hodnota)", () => {
    const r = deklaraceWebFqdns({ repo, prostredi: { COOLIFY_PROD_DOMAINS_FILE: "config/domains-chybi.env" }, ziskejOverlayDir: zOverlaye({}) });
    expect(r.znamo).toBe(false);
    expect(r).not.toHaveProperty("hodnota");
    expect(r.duvod).toMatch(/domains-chybi\.env.*vyžádaný/);
  });

  it("⛔ deklarovaný overlay instance nejde získat → NEVÍM s příčinou", () => {
    const r = deklaraceWebFqdns({ repo, prostredi: {}, ziskejOverlayDir: () => { throw new Error("overlay nejde naklonovat"); } });
    expect(r).toEqual({ znamo: false, duvod: "overlay nejde naklonovat" });
  });

  it("⛔ odkaz v WEB_FQDNS, který nejde rozbalit → NEVÍM", () => {
    const r = deklaraceWebFqdns({ repo, prostredi: {}, ziskejOverlayDir: zOverlaye({ "config/domains.env": "WEB_FQDNS=https://${NIKDE}\n" }) });
    expect(r.znamo).toBe(false);
    expect(r.duvod).toMatch(/NIKDE/);
  });

  it("⛔ neznámý tvar prostředí → NEVÍM", () => {
    expect(deklaraceWebFqdns({ repo, env: "nesmysl", prostredi: {} }).znamo).toBe(false);
  });

  it("cold-start exportuje vlastní požadavek: prázdný = overlay nežádán → známé prázdno bez dopočtu", () => {
    const r = deklaraceWebFqdns({
      repo, prostredi: { DOMAINS_OVERLAY_REQUESTED: "" },
      ziskejOverlayDir: zOverlaye({ "config/domains.env": `WEB_FQDNS=${ZNACKY}\n` }),
    });
    // Repo šablona (deklarovaná vrstva) se čte i tak — hodnota je prázdná, overlay se nesourcoval.
    expect(r).toMatchObject({ znamo: true, hodnota: "" });
  });
});

describe("CLI pro obal a cold-start — verdikt je kód", () => {
  it("--soubor: nalezeno → cesta (0); nenalezeno → kód 3, stdout prázdný", () => {
    const overlay = strom({ "config/domains-a.env": "" });
    const cli = (pozadovany) =>
      spawnSync(process.execPath, [CLI, "--soubor", pozadovany], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", AISHA_INSTANCE_CONFIG_DIR: overlay } });
    const ok = cli("config/domains-a.env");
    expect(ok.status).toBe(0);
    expect(ok.stdout).toBe(`${path.join(overlay, "config/domains-a.env")}\n`);
    const ne = cli("config/domains-neni.env");
    expect(ne.status).toBe(KOD_NENALEZENO);
    expect(ne.stdout).toBe("");
  });

  it("--pozadovany: produkce z config/coolify-environments.env tohohle repa; neznámý tvar → kód 2", () => {
    const prod = spawnSync(process.execPath, [CLI, "--pozadovany", "production"], { encoding: "utf8", env: { PATH: process.env.PATH ?? "" } });
    expect(prod.status).toBe(0);
    expect(prod.stdout).toBe("config/domains.env\n");
    const deklarovany = spawnSync(process.execPath, [CLI, "--pozadovany", "staging"], {
      encoding: "utf8", env: { PATH: process.env.PATH ?? "", COOLIFY_STAGING_DOMAINS_FILE: "config/domains-z-prostredi.env" },
    });
    expect(deklarovany.stdout).toBe("config/domains-z-prostredi.env\n");
    const nesmysl = spawnSync(process.execPath, [CLI, "--pozadovany", "nesmysl"], { encoding: "utf8", env: { PATH: process.env.PATH ?? "" } });
    expect(nesmysl.status).toBe(KOD_NEVIM);
    expect(nesmysl.stdout).toBe("");
  });
});
