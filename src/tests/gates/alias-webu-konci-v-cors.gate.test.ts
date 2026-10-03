/**
 * Brána: veřejná tvář webu musí skončit v ALLOWED_ORIGINS.
 *
 * PROČ (naměřeno 2026-08-11 v prohlížeči nad nasazenou instancí)
 * -------------------------------------------------------------
 * `corp.<public_tld>` servíroval SPA a API mu odmítalo VŠECHNO — osm RPC
 * neprošlo CORS preflightem:
 *
 *   Access to fetch at '…/rpc/get_branding_for_hostname' from origin
 *   'https://corp.…' has been blocked by CORS policy: No
 *   'Access-Control-Allow-Origin' header is present
 *
 * Prohlížeč ukázal PRÁZDNOU STRÁNKU. HTTP 200, žádná chyba v logu, `curl -I`
 * spokojený. Vada je vidět jen tam, kde obsah dokresluje JavaScript.
 *
 * PŘÍČINA: `AISHA_WEB_PUBLIC_ALIASES` se promítne do `docker_compose_domains`
 * (Coolify alias SMĚRUJE), ale `ALLOWED_ORIGINS` se skládal z APP_DOMAIN + API
 * + AUTH + SURFACE_ORIGINS — alias mezi nimi nebyl. Dva seznamy téhož a nic je
 * neporovnávalo.
 *
 * ⭐ TŘETÍ VÝSKYT TÉŽE TŘÍDY, DRUHÝM KANÁLEM. 2026-07-28 to potkalo POVRCHY —
 * `aisha-cold-start.sh` (krok 5c) to má zapsané doslova: „the surface's public
 * hostname was likewise underived, ALLOWED_ORIGINS never contained it". Tehdy
 * se to opravilo emisí `SURFACE_ORIGINS`. Aliasy webu zůstaly stranou.
 *
 * ⚠️ RUČNÍ ZÁPLATA NEPŘEŽIJE. Hodnota je odvozená; po jednom `aisha-redeploy.mjs`
 * byl alias z env zase pryč (ověřeno). Brána `cors-allowlist-is-generated`
 * ruční hostname přímo zakazuje. Opravit to lze JEDINĚ v odvození.
 *
 * CO SE MĚŘÍ
 * ----------
 * Ne přítomnost řádku ve zdrojáku. Derivér se SPUSTÍ se syntetickým aliasem,
 * jeho výstup se složí s `ALLOWED_ORIGINS` z `config/domains.env` (včetně
 * shellové expanze `${X:+,${X}}`) a hledá se, jestli tam ten alias JE.
 */
import { describe, expect, test, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const ALIAS_SONDY = "sondaalias";

let vars: Map<string, string>;

/** Spustí derivér se syntetickým aliasem a vrátí emitované proměnné. */
beforeAll(async () => {
  process.env.AISHA_WEB_PUBLIC_ALIASES = `web,${ALIAS_SONDY}`;
  const m = await import(join(ROOT, "scripts/lib/derive-domains.mjs"));
  const topo = m.buildTopology({ profileId: "cloud-single", meshEnabled: false });
  const out = String(m.formatShellExports(topo));
  vars = new Map();
  for (const radek of out.split("\n")) {
    const mm = /^(?:export\s+)?([A-Z0-9_]+)=(.*)$/.exec(radek.trim());
    if (mm) vars.set(mm[1], mm[2].replace(/^["']|["']$/g, ""));
  }
});

/** Minimální shellová expanze `${X}` a `${X:+,${X}}` nad známými proměnnými. */
function expanduj(sablona: string, svet: Map<string, string>): string {
  let v = sablona;
  for (let i = 0; i < 8 && /\$\{/.test(v); i++) {
    v = v.replace(/\$\{([A-Z0-9_]+):\+([^}]*(?:\{[^}]*\}[^}]*)*)\}/g, (_, jmeno, telo) => {
      const h = svet.get(jmeno) ?? "";
      return h ? telo.replace(/\$\{([A-Z0-9_]+)\}/g, (__: string, n: string) => svet.get(n) ?? "") : "";
    });
    v = v.replace(/\$\{([A-Z0-9_]+)\}/g, (_, jmeno) => svet.get(jmeno) ?? "");
  }
  return v;
}

/** Řádek ALLOWED_ORIGINS ze šablony config/domains.env. */
function sablonaAllowedOrigins(): string {
  const text = readFileSync(join(ROOT, "config/domains.env"), "utf8");
  const m = /^ALLOWED_ORIGINS=(.*)$/m.exec(text);
  expect(m, "v config/domains.env není řádek ALLOWED_ORIGINS — brána ztratila předmět").not.toBeNull();
  return m![1];
}

describe("veřejná tvář webu končí v ALLOWED_ORIGINS (brána)", () => {
  test("měřidlo funguje — derivér vydal PRIMÁRNÍ tvář", () => {
    // Kdyby derivér nevydal nic, tvrzení níž by byla vakuová: prázdno by
    // „neobsahovalo alias" ze špatného důvodu.
    expect(vars.get("APP_DOMAIN"), "derivér nevydal APP_DOMAIN — harness se rozešel").toBeTruthy();
  });

  test("alias z AISHA_WEB_PUBLIC_ALIASES se objeví mezi odvozenými origins", () => {
    const origins = vars.get("WEB_ALIAS_ORIGINS") ?? "";
    expect(
      origins,
      "derivér nevydal veřejnou tvář pro alias deklarovaný v AISHA_WEB_PUBLIC_ALIASES.\n" +
        "Coolify ten host SMĚRUJE (docker_compose_domains), takže se na něm SPA načte —\n" +
        "a bez tohohle bude každé volání API odmítnuto na CORS preflightu.\n" +
        "Prohlížeč pak ukáže prázdnou stránku při HTTP 200.",
    ).toContain(ALIAS_SONDY);
  });

  test("a SKUTEČNĚ skončí ve složeném ALLOWED_ORIGINS", () => {
    // Tohle je to podstatné tvrzení: emitovat proměnnou nestačí, když ji
    // skladba v config/domains.env nepoužije. Přesně tak vypadala vada —
    // hodnota existovala (AISHA_WEB_PUBLIC_ALIASES), spotřebitel existoval
    // (CORS), a spoj mezi nimi chyběl.
    const slozene = expanduj(sablonaAllowedOrigins(), vars);
    expect(
      slozene,
      `ALLOWED_ORIGINS se složil na:\n  ${slozene}\n\n` +
        "Alias v něm NENÍ. Derivér ho možná vydává, ale skladba v config/domains.env\n" +
        "ho nepřipojuje — a nepoužitá proměnná je k nerozeznání od neexistující.",
    ).toContain(ALIAS_SONDY);
  });

  test("primární tvář v něm zůstává — alias ji nesmí vytlačit", () => {
    const slozene = expanduj(sablonaAllowedOrigins(), vars);
    expect(slozene, "APP_DOMAIN ze složeného seznamu zmizel").toContain(vars.get("APP_DOMAIN") ?? "###");
  });

  test("žádný literální hostname — hodnota musí zůstat ODVOZENÁ", () => {
    // Brána `cors-allowlist-is-generated` hlídá totéž ve své rovině; tady jde
    // o to, aby oprava nesklouzla k dopsání konkrétní domény do šablony.
    expect(
      sablonaAllowedOrigins(),
      "do ALLOWED_ORIGINS se dostal literální hostname. Ruční hodnota nepřežije " +
        "regeneraci env (ověřeno 2026-08-11) a zafixovala by nasazení do platformy.",
    ).not.toMatch(/https?:\/\/[a-z0-9-]+\.[a-z0-9.-]*[a-z]{2,}/i);
  });
});
