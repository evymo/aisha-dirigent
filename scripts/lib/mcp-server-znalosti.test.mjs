import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mergeMcpJson } from "./mcp-json-merge.mjs";
import { verejniKlientiRealmu } from "./povoleni-klienti.mjs";
import {
  JMENO_SERVERU_ZNALOSTI,
  KLIENT_MCP,
  PROMENNA_ADRESY,
  PROMENNA_TOKENU,
  doslovneAdresyAPovereni,
  nactiRealm,
  oauthKlientaMcp,
  serverZnalostiProStroj,
  serverZnalostiZProstredi,
} from "./mcp-server-znalosti.mjs";

const KOREN = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const korenovyMcpJson = () => JSON.parse(readFileSync(join(KOREN, ".mcp.json"), "utf-8"));

/** Deklarace klienta MCP v realmu — to, co se skutečně naimportuje do Keycloaku. */
const klientVRealmu = () => nactiRealm().clients.find((k) => k.clientId === KLIENT_MCP);

/** Realm s jediným klientem MCP a zadanými návratovými adresami — pro kotvy odvození. */
const realmSAdresami = (redirectUris) => ({ clients: [{ clientId: KLIENT_MCP, redirectUris }] });

// ⛔ NAMĚŘENO 2026-10-03 (mapa mezer, nález G20): kořenový `.mcp.json` nesl adresu jedné
// instance — klon repa mířil na cizí instanci.
// Přihlášení je OAuth u Keycloaku instance (rozhodnutí majitele 2026-10-04): výchozí záznam
// nenese hlavičku Authorization; statický token je jen záznam pro stroje bez člověka.
describe("záznam serveru znalostí v .mcp.json", () => {
  it("výchozí záznam: adresa z prostředí, přihlášení přes OAuth, žádná hlavička Authorization", () => {
    const zaznam = serverZnalostiZProstredi();
    expect(zaznam).toEqual({
      type: "http",
      url: "${" + PROMENNA_ADRESY + "}",
      oauth: { clientId: KLIENT_MCP, callbackPort: expect.any(Number) },
    });
    expect(zaznam).not.toHaveProperty("headers");
    expect(JSON.stringify(zaznam)).not.toContain(PROMENNA_TOKENU);
    expect(PROMENNA_ADRESY).toBe("AISHA_MCP_URL");
  });

  it("zapsaný kořenový .mcp.json je to, co píše generátor", () => {
    const zapsany = korenovyMcpJson().mcpServers[JMENO_SERVERU_ZNALOSTI];
    expect(zapsany, "po změně záznamu přegeneruj: npm run dirigent:bootstrap:mcp").toEqual(serverZnalostiZProstredi());
  });

  it("generátor přepíše starý záznam (doslovná adresa, statický token) a cizí servery nechá být", () => {
    for (const stary of [
      { type: "http", url: "https://api.example.com/functions/v1/mcp-knowledge-server" },
      serverZnalostiProStroj(),
    ]) {
      const puvodni = JSON.stringify({
        mcpServers: { [JMENO_SERVERU_ZNALOSTI]: stary, "muj-server": { command: "node", args: ["server.mjs"] } },
      });
      const novy = JSON.parse(mergeMcpJson(puvodni, JMENO_SERVERU_ZNALOSTI, serverZnalostiZProstredi()));
      expect(novy.mcpServers[JMENO_SERVERU_ZNALOSTI]).toEqual(serverZnalostiZProstredi());
      expect(novy.mcpServers["muj-server"]).toEqual({ command: "node", args: ["server.mjs"] });
      expect(doslovneAdresyAPovereni(novy)).toEqual([]);
    }
  });

  it("záznam pro stroj: adresa i token z prostředí, bez OAuth", () => {
    expect(serverZnalostiProStroj()).toEqual({
      type: "http",
      url: "${" + PROMENNA_ADRESY + "}",
      headers: { Authorization: "Bearer ${" + PROMENNA_TOKENU + "}" },
    });
    expect(PROMENNA_TOKENU).toBe("AISHA_TOKEN");
    expect(doslovneAdresyAPovereni({ mcpServers: { stroj: serverZnalostiProStroj() } })).toEqual([]);
  });
});

// Klient, kterého záznam jmenuje, musí v realmu existovat v tom tvaru, který přihlášení
// potřebuje — jinak záznam ukazuje na klienta, přes kterého se přihlásit nedá.
describe("klient realmu pro klienty MCP", () => {
  it("je veřejný: žádné tajemství, žádný servisní účet", () => {
    const klient = klientVRealmu();
    expect(klient, `keycloak/aisha-realm.json nedeklaruje klienta ${KLIENT_MCP}`).toBeDefined();
    expect(klient.enabled).toBe(true);
    expect(klient.publicClient).toBe(true);
    expect(klient).not.toHaveProperty("secret");
    expect(klient.serviceAccountsEnabled).toBe(false);
  });

  it("smí jen autorizační kód s PKCE S256 — žádný implicitní, heslový ani zařízením vydaný token", () => {
    const klient = klientVRealmu();
    expect(klient.standardFlowEnabled).toBe(true);
    expect(klient.implicitFlowEnabled).toBe(false);
    expect(klient.directAccessGrantsEnabled).toBe(false);
    expect(klient.attributes?.["pkce.code.challenge.method"]).toBe("S256");
    expect(klient.attributes?.["oauth2.device.authorization.grant.enabled"]).toBeUndefined();
  });

  it("návratové adresy jsou jen smyčka s pevným portem a cestou /callback — bez zástupných znaků", () => {
    const { callbackPort } = oauthKlientaMcp(nactiRealm());
    expect(klientVRealmu().redirectUris).toEqual([
      `http://localhost:${callbackPort}/callback`,
      `http://127.0.0.1:${callbackPort}/callback`,
    ]);
    expect(klientVRealmu().webOrigins).toEqual([]);
  });

  it("záznam nese klienta a port Z DEKLARACE realmu", () => {
    const { oauth } = serverZnalostiZProstredi();
    expect(oauth.clientId).toBe(klientVRealmu().clientId);
    expect(klientVRealmu().redirectUris).toContain(`http://localhost:${oauth.callbackPort}/callback`);
    // Jiný port v deklaraci → jiný port v záznamu (nikde není druhá kopie čísla).
    expect(serverZnalostiZProstredi(realmSAdresami(["http://localhost:50123/callback"])).oauth.callbackPort).toBe(50123);
  });

  // Pravidlo, kterým vzniká KC_ALLOWED_CLIENTS (scripts/lib/povoleni-klienti.mjs — volá ho
  // env-doktor i místní presety): bez něj by `/mcp` token tohoto klienta odmítl (403).
  it("je mezi klienty, ze kterých se skládá KC_ALLOWED_CLIENTS", () => {
    expect(verejniKlientiRealmu(nactiRealm())).toContain(KLIENT_MCP);
  });

  // Kotva: co nejde odvodit jednoznačně, se odmítne — žádný tichý port ani klient.
  it.each([
    ["klient v realmu není", { clients: [{ clientId: "jiny-klient" }] }, /nedeklaruje klienta/],
    ["realm bez klientů", {}, /nedeklaruje klienta/],
    ["žádná návratová adresa", realmSAdresami([]), /žádnou návratovou adresu/],
    ["adresa mimo smyčku", realmSAdresami(["https://app.example.com/callback"]), /port z ní odvodit nejde/],
    ["zástupný port", realmSAdresami(["http://localhost:*"]), /port z ní odvodit nejde/],
    ["jiná cesta", realmSAdresami(["http://localhost:50123/oauth"]), /port z ní odvodit nejde/],
    ["dva různé porty", realmSAdresami(["http://localhost:50123/callback", "http://127.0.0.1:50124/callback"]), /neshodnou na portu/],
    ["chybí tvar s localhost", realmSAdresami(["http://127.0.0.1:50123/callback"]), /chybí návratová adresa s hostitelem localhost/],
    ["port mimo rozsah", realmSAdresami(["http://localhost:70000/callback"]), /není platný port/],
  ])("kotva: %s → odvození se odmítne s důvodem", (_popis, realm, duvod) => {
    expect(() => oauthKlientaMcp(realm)).toThrow(duvod);
  });
});

// Návod (.claude/commands/aisha-setup.md) ukazuje oba záznamy doslova — musí to být tytéž,
// které píše generátor, jinak návod vede k záznamu, který se nepřipojí.
describe("návod ukazuje záznamy, které platí", () => {
  const navod = readFileSync(join(KOREN, ".claude", "commands", "aisha-setup.md"), "utf-8");
  const zaznamyVNavodu = [...navod.matchAll(/```json\n([\s\S]*?)```/g)]
    .map((blok) => JSON.parse(blok[1]))
    .filter((obsah) => obsah?.mcpServers?.[JMENO_SERVERU_ZNALOSTI])
    .map((obsah) => obsah.mcpServers[JMENO_SERVERU_ZNALOSTI]);

  it("první záznam v návodu je výchozí (OAuth), druhý je pro stroje (token)", () => {
    expect(zaznamyVNavodu).toEqual([serverZnalostiZProstredi(), serverZnalostiProStroj()]);
  });

  it("doba nečinnosti relace v návodu je ta, kterou deklaruje realm", () => {
    const minuty = /after (\d+) minutes\s+without use/.exec(navod)?.[1];
    expect(minuty, "návod neříká, po jaké době nečinnosti relace vyprší").toBeDefined();
    expect(Number(minuty) * 60).toBe(nactiRealm().ssoSessionIdleTimeout);
  });

  it("návratová adresa v návodu má port z deklarace realmu", () => {
    const { callbackPort } = oauthKlientaMcp(nactiRealm());
    const adresyVNavodu = [...navod.matchAll(/http:\/\/localhost:(\d+)\/callback/g)].map((shoda) => Number(shoda[1]));
    expect(adresyVNavodu.length, "návod návratovou adresu vůbec neuvádí").toBeGreaterThan(0);
    expect(new Set(adresyVNavodu)).toEqual(new Set([callbackPort]));
  });
});

describe("kořenový .mcp.json nenese adresu žádné instance ani pověření", () => {
  it("žádný server v zapsaném souboru nemá doslovnou adresu ani doslovné pověření", () => {
    const obsah = korenovyMcpJson();
    expect(Object.keys(obsah.mcpServers ?? {}).length, "soubor bez serverů by kontrolu nechal projít naprázdno").toBeGreaterThan(0);
    expect(doslovneAdresyAPovereni(obsah)).toEqual([]);
  });

  it("zapsaný záznam serveru znalostí nenese hlavičku Authorization — statický token do sdíleného souboru nepatří", () => {
    const hlavicky = Object.keys(korenovyMcpJson().mcpServers[JMENO_SERVERU_ZNALOSTI].headers ?? {});
    expect(hlavicky.map((h) => h.toLowerCase())).not.toContain("authorization");
  });

  // Kotva: kontrola musí vidět každý tvar, kterým se adresa nebo token do souboru dostane.
  it.each([
    ["doslovná adresa", { url: "https://api.example.com/functions/v1/mcp-knowledge-server" }, /url nese adresu doslova/],
    ["adresa schovaná ve výchozí hodnotě", { url: "${AISHA_MCP_URL:-https://api.example.com}/mcp" }, /url nese adresu doslova/],
    ["host za proměnnou", { url: "${SCHEMA}://api.example.com/mcp" }, /url nese adresu doslova/],
    ["doslovný token", { url: "${AISHA_MCP_URL}", headers: { Authorization: "Bearer priklad-tokenu" } }, /pověření doslova/],
    ["token ve výchozí hodnotě", { url: "${AISHA_MCP_URL}", headers: { authorization: "Bearer ${AISHA_TOKEN:-priklad}" } }, /pověření doslova/],
    [
      "adresa autorizačního serveru",
      { url: "${AISHA_MCP_URL}", oauth: { clientId: "priklad-klienta", authServerMetadataUrl: "https://auth.example.com/.well-known/openid-configuration" } },
      /authServerMetadataUrl nese adresu autorizačního serveru/,
    ],
  ])("kotva: %s se najde", (_popis, server, nalez) => {
    const nalezy = doslovneAdresyAPovereni({ mcpServers: { zkouska: { type: "http", ...server } } });
    expect(nalezy).toHaveLength(1);
    expect(nalezy[0]).toMatch(nalez);
  });

  it("nález nevypisuje hodnotu adresy ani pověření", () => {
    const nalezy = doslovneAdresyAPovereni({
      mcpServers: {
        zkouska: {
          url: "https://api.example.com/neverejna-cesta",
          headers: { Authorization: "Bearer priklad-tokenu" },
          oauth: { authServerMetadataUrl: "https://auth.example.com/neverejna-cesta" },
        },
      },
    });
    expect(nalezy).toHaveLength(3);
    expect(nalezy.join("\n")).not.toMatch(/neverejna-cesta|priklad-tokenu|example\.com/);
  });

  it("odkaz na proměnnou s cestou, klient OAuth bez adresy a server spouštěný příkazem projdou", () => {
    expect(
      doslovneAdresyAPovereni({
        mcpServers: {
          a: { type: "http", url: "${API_ZAKLAD}/functions/v1/mcp-knowledge-server", headers: { Authorization: "Bearer ${TOKEN}", "X-Klient": "claude" } },
          b: { command: "node", args: ["server.mjs"] },
          c: { type: "http", url: "${AISHA_MCP_URL}", oauth: { clientId: "priklad-klienta", callbackPort: 50123 } },
        },
      }),
    ).toEqual([]);
  });
});
