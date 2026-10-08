/**
 * domeny-webu — jeden výklad „veřejné domény webu instance".
 *
 * ⛔ NAMĚŘENO 2026-10-04 (cold-start forku s víc značkami): doktor domén neznal
 * WEB_FQDNS a krokem 4 zúžil `web` na jediné APP_DOMAIN. Tady se měří pravidlo
 * domova: deklarovaný seznam vyhraje pořadím, nic z dnešních jmen se neztratí,
 * „nevím" (deklarace se nenačetla) se nikdy nepřevleče za užší seznam a neplatná
 * deklarace se neohýbá. Plus CLI, které volá deploy-init: verdikt je kód.
 *
 * Jména jsou vymyšlená (`.example`); jádro nenese data žádné instance.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { normalizeApexMode } from "./derive-domains.mjs";
import { KLICE_DEKLARACE_WEBU, KOD_NEPLATNE, KOD_NEVIM, duvodyNeslozeni, rezimApexu, verejneDomenyWebu } from "./domeny-webu.mjs";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "domeny-webu.mjs");

/** Instance s jednou značkou, jak ji vidí cold-start (WEB_FQDNS deklarovaný prázdný). */
const ZAKLAD = Object.freeze({
  WEB_FQDNS: "",
  APP_DOMAIN: "web.zona.example",
  PUBLIC_TLD: "zona.example",
  AISHA_WEB_APEX_MODE: "redirect",
});
const TRINACT = Array.from({ length: 13 }, (_, i) => `https://znacka${i + 1}.example`);

describe("verejneDomenyWebu — deklarovaný seznam značek (WEB_FQDNS)", () => {
  it("víc jmen: všechna v deklarovaném pořadí, pak kanonický host", () => {
    const r = verejneDomenyWebu({ ...ZAKLAD, WEB_FQDNS: TRINACT.join(",") });
    expect(r).toEqual({ znamo: true, zdroj: "WEB_FQDNS", domeny: [...TRINACT, "https://web.zona.example"] });
  });

  it("kanonický host uvnitř seznamu se neopakuje — výsledek = seznam znak po znaku", () => {
    const seznam = [...TRINACT.slice(0, 6), "https://web.zona.example", ...TRINACT.slice(6)];
    const r = verejneDomenyWebu({ ...ZAKLAD, WEB_FQDNS: seznam.join(",") });
    expect(r.znamo && r.domeny).toEqual(seznam);
  });

  it("nic z dnešních jmen se neztratí: seznam + aliasy + apex (serve) dohromady", () => {
    const r = verejneDomenyWebu({
      ...ZAKLAD,
      WEB_FQDNS: "https://znacka1.example",
      AISHA_WEB_PUBLIC_ALIASES: "corp",
      AISHA_WEB_APEX_MODE: "serve",
    });
    expect(r.znamo && r.domeny).toEqual([
      "https://znacka1.example",
      "https://web.zona.example",
      "https://corp.zona.example",
      "https://zona.example",
    ]);
  });

  it("schéma i hostitel bez ohledu na velikost písmen; výchozí port pryč (normalizuje URL)", () => {
    const r = verejneDomenyWebu({ ...ZAKLAD, WEB_FQDNS: "HTTPS://Znacka1.EXAMPLE,Http://Znacka2.Example:8080/,https://znacka3.example:443" });
    expect(r.znamo && r.domeny).toEqual([
      "https://znacka1.example",
      "http://znacka2.example:8080",
      "https://znacka3.example",
      "https://web.zona.example",
    ]);
  });

  it("mezery, prázdné položky, velká písmena, koncové / a duplicity se srovnají", () => {
    const r = verejneDomenyWebu({ ...ZAKLAD, WEB_FQDNS: " https://Znacka1.Example/ ,, https://znacka1.example,https://znacka2.example:8443" });
    expect(r.znamo && r.domeny).toEqual(["https://znacka1.example", "https://znacka2.example:8443", "https://web.zona.example"]);
  });
});

describe("verejneDomenyWebu — bez seznamu (jedna značka)", () => {
  it("prázdný WEB_FQDNS = jen kanonický host", () => {
    expect(verejneDomenyWebu(ZAKLAD)).toEqual({ znamo: true, zdroj: "APP_DOMAIN", domeny: ["https://web.zona.example"] });
  });

  it("aliasy pod veřejnou zónou (malými písmeny, ořezané)", () => {
    const r = verejneDomenyWebu({ ...ZAKLAD, AISHA_WEB_PUBLIC_ALIASES: " Corp , studio" });
    expect(r.znamo && r.domeny).toEqual(["https://web.zona.example", "https://corp.zona.example", "https://studio.zona.example"]);
  });

  it("nepřítomné aliasy = žádné (volitelná data operátora)", () => {
    const { AISHA_WEB_PUBLIC_ALIASES: _, ...bez } = { ...ZAKLAD, AISHA_WEB_PUBLIC_ALIASES: "x" };
    expect(verejneDomenyWebu(bez).znamo).toBe(true);
  });

  it("apex: serve → web ho dostane; redirect / nepřítomný / prázdný → ne (patří edge-proxy)", () => {
    expect(verejneDomenyWebu({ ...ZAKLAD, AISHA_WEB_APEX_MODE: "serve" })).toMatchObject({ domeny: ["https://web.zona.example", "https://zona.example"] });
    for (const rezim of ["redirect", "", undefined]) {
      expect(verejneDomenyWebu({ ...ZAKLAD, AISHA_WEB_APEX_MODE: rezim }), String(rezim)).toMatchObject({ domeny: ["https://web.zona.example"] });
    }
  });

  it("apex shodný s APP_DOMAIN se v serve nepřidá podruhé", () => {
    const r = verejneDomenyWebu({ ...ZAKLAD, APP_DOMAIN: "zona.example", AISHA_WEB_APEX_MODE: "serve" });
    expect(r.znamo && r.domeny).toEqual(["https://zona.example"]);
  });
});

describe("verejneDomenyWebu — „nevím“ není užší seznam", () => {
  it("⛔ WEB_FQDNS v prostředí NENÍ (overlay se nenačetl) → nevydá nic", () => {
    const { WEB_FQDNS: _, ...bezOverlaye } = ZAKLAD;
    const r = verejneDomenyWebu(bezOverlaye);
    expect(r.znamo).toBe(false);
    expect(r).not.toHaveProperty("domeny");
    expect(r.nevim.join("\n")).toMatch(/WEB_FQDNS v prostředí NENÍ/);
  });

  it("⛔ WEB_FQDNS nerozbalená šablona (doktor bez exportu čte domains.env doslova) → nevím", () => {
    const r = verejneDomenyWebu({ ...ZAKLAD, WEB_FQDNS: "${WEB_FQDNS:-}" });
    expect(r.znamo).toBe(false);
    expect(r.nevim.join("\n")).toMatch(/nerozbalená šablona/);
  });

  it("APP_DOMAIN chybí, je prázdný nebo nerozbalený → nevím", () => {
    for (const app of [undefined, "", "${APP_DOMAIN:-}"]) {
      const r = verejneDomenyWebu({ ...ZAKLAD, APP_DOMAIN: app });
      expect(r.znamo, String(app)).toBe(false);
      expect(r.nevim.join("\n")).toMatch(/APP_DOMAIN chybí/);
    }
  });

  it("aliasy nebo serve bez veřejné zóny → nevím; bez nich zóna potřeba není", () => {
    for (const navic of [{ AISHA_WEB_PUBLIC_ALIASES: "corp" }, { AISHA_WEB_APEX_MODE: "serve" }]) {
      for (const zona of [undefined, "", "${PUBLIC_TLD:-}"]) {
        const r = verejneDomenyWebu({ ...ZAKLAD, ...navic, PUBLIC_TLD: zona });
        expect(r.znamo, `${JSON.stringify(navic)} zona=${zona}`).toBe(false);
        expect(r.nevim.join("\n")).toMatch(/PUBLIC_TLD chybí/);
      }
    }
    expect(verejneDomenyWebu({ ...ZAKLAD, PUBLIC_TLD: undefined }).znamo).toBe(true);
  });

  it("nerozbalené aliasy nebo režim apexu → nevím", () => {
    expect(verejneDomenyWebu({ ...ZAKLAD, AISHA_WEB_PUBLIC_ALIASES: "${AISHA_WEB_PUBLIC_ALIASES}" }).znamo).toBe(false);
    expect(verejneDomenyWebu({ ...ZAKLAD, AISHA_WEB_APEX_MODE: "${AISHA_WEB_APEX_MODE}" }).znamo).toBe(false);
  });
});

describe("verejneDomenyWebu — neplatná deklarace se neohýbá", () => {
  it.each([
    ["holý hostitel bez schématu", "znacka1.example"],
    ["cesta", "https://znacka1.example/cesta"],
    ["dotaz", "https://znacka1.example?x=1"],
    ["podtržítko v hostiteli", "https://zna_cka.example"],
    ["jeden štítek", "https://localhost"],
    ["port mimo rozsah", "https://znacka1.example:70000"],
    ["jiné schéma", "ftp://znacka1.example"],
    ["zástupný znak", "https://*.znacka.example"],
    ["schéma bez //", "https:znacka1.example"],
    ["přihlašovací údaje", "https://kdo@znacka1.example"],
    ["fragment", "https://znacka1.example#x"],
    ["dvojí lomítko (cesta)", "https://znacka1.example//"],
  ])("WEB_FQDNS: %s → nic, důvod pojmenovaný", (_, polozka) => {
    const r = verejneDomenyWebu({ ...ZAKLAD, WEB_FQDNS: `https://znacka2.example,${polozka}` });
    expect(r.znamo).toBe(false);
    expect(r.neplatne.join("\n")).toContain(polozka);
  });

  it("alias, který není jeden DNS štítek → nic (dřív se potichu přeskočil)", () => {
    for (const alias of ["corp.studio", "-corp", "co rp", "corp_"]) {
      const r = verejneDomenyWebu({ ...ZAKLAD, AISHA_WEB_PUBLIC_ALIASES: `web,${alias}` });
      expect(r.znamo, alias).toBe(false);
      expect(r.neplatne.join("\n")).toMatch(/AISHA_WEB_PUBLIC_ALIASES/);
    }
  });

  it("režim apexu čte TENTÝŽ normalizátor jako derivace (import, ne kopie): web/spa/SERVE → serve, neznámý → redirect", () => {
    for (const rezim of ["serve", "redirect", "web", "spa", "SERVE", " serve ", "Web", "vypnuto", "", undefined]) {
      const ocekavany = normalizeApexMode(rezim);
      expect(rezimApexu({ AISHA_WEB_APEX_MODE: rezim }), JSON.stringify(rezim)).toBe(ocekavany);
      const r = verejneDomenyWebu({ ...ZAKLAD, AISHA_WEB_APEX_MODE: rezim });
      expect(r.znamo, JSON.stringify(rezim)).toBe(true);
      expect(r.domeny.includes("https://zona.example"), JSON.stringify(rezim)).toBe(ocekavany === "serve");
    }
    expect(normalizeApexMode("web")).toBe("serve");
    expect(normalizeApexMode("vypnuto")).toBe("redirect");
  });

  it("APP_DOMAIN se schématem nebo cestou → nic", () => {
    for (const app of ["https://web.zona.example", "web.zona.example/x"]) {
      expect(verejneDomenyWebu({ ...ZAKLAD, APP_DOMAIN: app }).znamo, app).toBe(false);
    }
  });

  it("duvodyNeslozeni vyjmenuje neplatné i neznámé, u složených nic", () => {
    const r = verejneDomenyWebu({ ...ZAKLAD, WEB_FQDNS: undefined, AISHA_WEB_PUBLIC_ALIASES: "co.rp" });
    const d = duvodyNeslozeni(r);
    expect(d.some((x) => x.startsWith("NEPLATNÉ: AISHA_WEB_PUBLIC_ALIASES"))).toBe(true);
    expect(d.some((x) => x.startsWith("NEVÍM: WEB_FQDNS"))).toBe(true);
    expect(duvodyNeslozeni(verejneDomenyWebu(ZAKLAD))).toEqual([]);
  });
});

describe("KLICE_DEKLARACE_WEBU — výsledek závisí jen na nich", () => {
  it("klíč mimo seznam výsledek nezmění", () => {
    const s = verejneDomenyWebu({ ...ZAKLAD, WEB_FQDNS: TRINACT.join(",") });
    const sCizim = verejneDomenyWebu({ ...ZAKLAD, WEB_FQDNS: TRINACT.join(","), API_DOMAIN_PUBLIC: "api.zona.example", WEB_DOMAINS: "https://x.example" });
    expect(sCizim).toEqual(s);
    expect([...KLICE_DEKLARACE_WEBU].sort()).toEqual(["AISHA_WEB_APEX_MODE", "AISHA_WEB_PUBLIC_ALIASES", "APP_DOMAIN", "PUBLIC_TLD", "WEB_FQDNS"]);
  });
});

describe("CLI pro shell (deploy-init) — verdikt je kód", () => {
  const cli = (env) => spawnSync(process.execPath, [CLI, "--csv"], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", ...env } });

  it("složeno → kód 0, CSV na stdout = funkce", () => {
    const env = { ...ZAKLAD, WEB_FQDNS: TRINACT.join(","), AISHA_WEB_PUBLIC_ALIASES: "corp" };
    const r = cli(env);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe(`${verejneDomenyWebu(env).domeny.join(",")}\n`);
  });

  it("nevím → kód 2, stdout prázdný (shell nesmí dostat užší seznam)", () => {
    const { WEB_FQDNS: _, ...bez } = ZAKLAD;
    const r = cli(bez);
    expect(r.status).toBe(KOD_NEVIM);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/NEVÍM: WEB_FQDNS/);
  });

  it("neplatná deklarace → kód 1, stdout prázdný", () => {
    const r = cli({ ...ZAKLAD, WEB_FQDNS: "znacka1.example" });
    expect(r.status).toBe(KOD_NEPLATNE);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/NEPLATNÉ: WEB_FQDNS/);
  });

  it("--rezim-apexu → normalizovaný režim (kód 0); nerozbalená šablona → kód 2, stdout prázdný", () => {
    const rezim = (hodnota) =>
      spawnSync(process.execPath, [CLI, "--rezim-apexu"], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", AISHA_WEB_APEX_MODE: hodnota } });
    expect(rezim("web").stdout).toBe("serve\n");
    expect(rezim("redirect").stdout).toBe("redirect\n");
    const sablona = rezim("${AISHA_WEB_APEX_MODE}");
    expect(sablona.status).toBe(KOD_NEVIM);
    expect(sablona.stdout).toBe("");
  });

  it("neznámý argument → kód 64 (žádný výchozí režim)", () => {
    const r = spawnSync(process.execPath, [CLI], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", ...ZAKLAD } });
    expect(r.status).toBe(64);
    expect(r.stdout).toBe("");
  });
});
