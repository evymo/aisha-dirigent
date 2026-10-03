/**
 * Brána: sonda tvrdí, CO má přijít — ne že „něco tam je"
 *
 * INVARIANT: sonda dosažitelnosti musí ověřit IDENTITU odpovídajícího.
 * Odpověď, která jen vrací otázku (přesměrování zpět na týž host), není
 * důkaz o službě.
 *
 * ⛔ NAMĚŘENO 2026-08-13/15 na všech čtyřech hostech: search doména vrací pro
 * LIBOVOLNÉ neznámé jméno adresu síťové appliance, a ta na jakýkoli Host
 * odpoví 302 s ECHEM toho Hostu. Řetěz je pak tenhle:
 *
 *     mrtvá vnitřní služba → Docker DNS jméno nezná → propadne na hostitelský
 *     resolver → wildcard → appliance → 302 místo čistého 502
 *
 * Doktor to hlásil jako tvrdou vadu prostředí (`NOT READY`), jenže wildcard
 * sám o sobě vadit NEMUSÍ: víme, JAKÁ odpověď má přijít, ne jen že něco
 * přišlo. Vada byla v sondě, která brala `status > 0` jako důkaz — a to je
 * na takovém hostu splněné vždy, i pro službu, která neběží.
 *
 * Tahle brána pinuje obě strany:
 *   · odražeč (302 → týž host) NEPROJDE u žádného druhu služby,
 *   · legitimní odpovědi (401/403 brány, přesměrování na IdP, 200 registry
 *     s vlastní hlavičkou, běžné backendové 404 s tělem) projít MUSÍ —
 *     jinak by přísnost zavřela zdravé nasazení.
 */
import { describe, it, expect } from "vitest";
import {
  expectedSignal,
  isEchoRedirect,
  isTraefikDefault404,
  judgeResponse,
} from "../../../scripts/lib/routing-probe.mjs";

const HOST = "auth.priklad.cz";
const odpoved = (status: number, headers: Record<string, string> = {}, bodyLen: number | null = null) => ({
  status,
  headers,
  bodyLen,
});

describe("brána: sonda tvrdí, co má přijít", () => {
  it("přesměrování zpátky na TOTÉŽ je odražeč, ne služba", () => {
    // Naměřený podpis: `Location` ukazuje na tutéž adresu, na kterou jsme se ptali.
    expect(isEchoRedirect(odpoved(302, { location: `https://${HOST}/` }), HOST, "/")).toBe(true);
    expect(isEchoRedirect(odpoved(302, { location: "/" }), HOST, "/")).toBe(true);
    // Schéma je jediný rozdíl — přesně tvar, který appliance vydá po HTTP.
    expect(isEchoRedirect(odpoved(301, { location: `http://${HOST}/` }), HOST, "/")).toBe(true);
    // Koncové lomítko je kosmetika, ne postup.
    expect(isEchoRedirect(odpoved(302, { location: `https://${HOST}/health/` }), HOST, "/health")).toBe(true);
  });

  it("přesměrování JINAM odražeč není (skutečný přihlašovací tok)", () => {
    expect(isEchoRedirect(odpoved(302, { location: "https://idp.jinam.cz/auth" }), HOST, "/")).toBe(false);
  });

  it("týž host s JINOU cestou je POSTUP, ne odraz", () => {
    // ⛔ NAMĚŘENO 2026-08-15: podpis appliance je `http://X/ → https://X/`, tedy
    // BEZ posunu cesty. Porovnávat jen hostname by zavřelo zdravé nasazení —
    // NocoDB i Appsmith odpovídají na `/` přesměrováním do své aplikace, a
    // `smoke-routing.sh` pro ně dodnes výslovně přijímá `200,302`.
    expect(
      isEchoRedirect(odpoved(302, { location: `https://${HOST}/dashboard` }), HOST, "/"),
      "aplikace, která nás někam VEDE, je živá služba",
    ).toBe(false);
    expect(isEchoRedirect(odpoved(302, { location: "/prihlaseni" }), HOST, "/")).toBe(false);
    expect(
      expectedSignal("http").accept(odpoved(302, { location: `https://${HOST}/dashboard` }), HOST),
      "přísnost nesmí zavřít službu, která přesměrovává do vlastní aplikace",
    ).toBe(true);
  });

  it("odražeč neprojde ani jako oauth2, ani jako http", () => {
    const echo = odpoved(302, { location: `https://${HOST}/` });
    expect(
      expectedSignal("oauth2").accept(echo, HOST),
      "302 zpět na sebe NENÍ přihlašovací tok — takhle odpovídá appliance za wildcardem",
    ).toBe(false);
    expect(
      expectedSignal("http").accept(echo, HOST),
      "`status > 0` byl důkaz o ničem; na hostu s wildcardem je splněný vždy",
    ).toBe(false);
  });

  it("legitimní odpovědi projdou — přísnost nesmí zavřít zdravé nasazení", () => {
    const o = expectedSignal("oauth2");
    expect(o.accept(odpoved(401), HOST), "brána smí odmítnout přímo").toBe(true);
    expect(o.accept(odpoved(403), HOST)).toBe(true);
    expect(o.accept(odpoved(302, { location: "https://idp.jinam.cz/auth" }), HOST), "redirect na IdP").toBe(true);

    const h = expectedSignal("http");
    expect(h.accept(odpoved(200, { "content-type": "text/html" }, 1024), HOST)).toBe(true);
    expect(h.accept(odpoved(404, { "content-type": "text/html" }, 900), HOST), "backendové 404 s tělem").toBe(true);
    expect(h.accept(odpoved(502), HOST), "502 je odpověď edge, ne odražeče").toBe(true);

    const r = expectedSignal("registry");
    expect(
      r.accept(odpoved(200, { "docker-distribution-api-version": "registry/2.0" }), HOST),
      "registry se hlásí vlastní hlavičkou",
    ).toBe(true);
  });

  it("výchozí 404 Traefiku zůstává nálezem (neregresi)", () => {
    const def404 = odpoved(404, { "content-type": "text/plain" }, 19);
    expect(isTraefikDefault404(def404)).toBe(true);
    expect(expectedSignal("http").accept(def404, HOST)).toBe(false);
  });

  it("relativní Location se rozvíjí proti dotázané cestě; chybějící důkaz není", () => {
    // Relativní cíl se rozvine proti tomu, NA CO jsme se ptali. `::x::` je
    // validní relativní cesta, ne rozbitá URL — a jako cesta je jiná než `/`,
    // takže postup, ne odraz.
    expect(isEchoRedirect(odpoved(302, { location: "::nesmysl::" }), HOST, "/")).toBe(false);
    // Prázdný relativní cíl ukazuje zpátky na tutéž cestu — odraz.
    expect(isEchoRedirect(odpoved(302, { location: "" }), HOST, "/"), "prázdný Location").toBe(false);
    // Bez Location se nedá tvrdit nic — a nic se netvrdí.
    expect(isEchoRedirect(odpoved(302, {}), HOST, "/"), "chybějící Location").toBe(false);
  });

  it("kurátorovaný nárok volajícího NEPŘEBIJE diskvalifikaci", () => {
    // Jádro sjednocení (#168): `stack-health.sh` i `smoke-routing.sh` dodnes
    // pro nocodb/appsmith/pki čekají „200,302". Kdyby seznam kódů rozhodoval
    // sám, 302 od appliance by prošlo jako zdraví.
    const odraz = odpoved(302, { location: `https://${HOST}/` });
    expect(
      judgeResponse(odraz, { host: HOST, path: "/", expect: [200, 302] }).routed,
      "očekávaný kód je nárok na to, CO má přijít — ne povolení přijmout odpověď od appliance",
    ).toBe(false);
    // A táž kladná půlka musí zůstat plnohodnotná: skutečná 302 od služby projde.
    expect(
      judgeResponse(odpoved(302, { location: `https://${HOST}/dashboard` }), {
        host: HOST,
        path: "/",
        expect: [200, 302],
      }).routed,
    ).toBe(true);
    // Výchozí 404 edge se taky nedá „očekat" do zdraví.
    expect(
      judgeResponse(odpoved(404, { "content-type": "text/plain" }, 19), {
        host: HOST,
        path: "/",
        expect: [200, 404],
      }).routed,
      "výchozí 404 edge znamená, že hostitele nechytil žádný router",
    ).toBe(false);
  });

  it("zná-li se tvář IdP, přihlašovací tok se ověří CÍLEM, ne jen tím, že vede jinam", () => {
    // Krok od černé listiny k bílé. Bez deklarace IdP umíme říct nanejvýš
    // „tohle není appliance"; s ní se dá tvrdit „tohle je NAŠE brána".
    const naIdP = odpoved(302, { location: "https://auth.priklad.cz/realms/x/protocol/openid-connect/auth" });
    const jinam = odpoved(302, { location: "https://cizi-idp.example/auth" });

    expect(judgeResponse(naIdP, { host: HOST, kind: "oauth2", path: "/", idpHost: "auth.priklad.cz" }).routed).toBe(
      true,
    );
    const v = judgeResponse(jinam, { host: HOST, kind: "oauth2", path: "/", idpHost: "auth.priklad.cz" });
    expect(v.routed, "přesměrování na CIZÍ IdP není důkaz o našem přihlašovacím toku").toBe(false);
    expect(v.reason).toMatch(/deklarovaný IdP/);

    // Bez deklarace se netvrdí nic navíc — mlčení nesmí vyrobit červenou.
    expect(
      judgeResponse(jinam, { host: HOST, kind: "oauth2", path: "/" }).routed,
      "neznámý IdP znamená 'nevím', ne 'špatně'",
    ).toBe(true);
  });

  it("nárok volajícího je BOHATŠÍ než druh služby — sjednocení ho nesmí zahodit", () => {
    // Kdyby sjednocení nahradilo kurátorované kódy hrubým druhem `http`,
    // ověřování by ZESLÁBLO: `/health`, které vrátí 500, by prošlo jako „žije".
    const chyba = odpoved(500, { "content-type": "application/json" }, 40);
    expect(expectedSignal("http").accept(chyba, HOST), "druh 'http' bere i 500").toBe(true);
    expect(
      judgeResponse(chyba, { host: HOST, path: "/health", expect: [200] }).routed,
      "kdo čeká 200 od /health, nesmí dostat zelenou za 500",
    ).toBe(false);
  });
});
