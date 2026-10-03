/**
 * Brána: selhavší dotaz nesmí mluvit o obsahu Keycloaku — a token nesmí vypršet uprostřed práce.
 *
 * TŘÍDA VADY: skript se zeptá vzdálené služby, dotaz selže, `curl -sf` na to
 * MLČÍ — a prázdný výstup se vyhodnotí jako ODPOVĚĎ. Z „nepodařilo se zeptat"
 * se stane „ta věc tam není".
 *
 * NAMĚŘENO 2026-08-14 na živé aishe, celý řetěz od kořene:
 *
 *   1. Keycloak dává admin tokenu master/admin-cli životnost 60 s (expires_in=60).
 *   2. provision-sso.sh si ho vzal JEDNOU a pak obešel 10 klientů, každého třemi
 *      HTTPS okružními cestami na vzdálený KC. Zhruba od třetího klienta 401.
 *   3. `curl -sf … | grep -o '"id":"…'` → prázdno → `fail "Client 'X' not found
 *      in Keycloak realm 'aisha'"`. Tvrzení o OBSAHU realmy ze selhání DOTAZU.
 *   4. Důkaz opaku ve stejné chvíli: GET /clients?max=200 vrátil 23 klientů,
 *      včetně všech osmi „nenalezených".
 *   5. Cena: přeskočil se zápis secretu klienta `netbird-backend`. Keycloak si
 *      nechal svůj (32 znaků hex), stack nesl náš (43 znaků base64url) —
 *      naměřeno hashem. NetBird se neautentizoval → mesh nenaběhl → *_MESH_IP
 *      neznámé → edge nemá kudy na core → veřejné tváře 503 → každý stack se
 *      sidecarem hlásí unhealthy.
 *
 * Komentář přímo v tom souboru přitom dokumentuje TÝŽ symptom z 2026-08-10 a
 * opravil tehdy ZÁPIS. Lookup nikdo neopravil, tak se vada vrátila jinými dveřmi.
 *
 * CO SE TU MĚŘÍ: spuštěním proti Keycloaku, který se chová jako ten živý —
 * vydá token a po pár dotazech ho přestane uznávat. Skript musí dojít až k
 * poslednímu klientovi. Kdo si token nechá zestárnout, ten sem nedojde.
 *
 * Spouští se přes: npm run test:gates
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer, type Server, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const SSO = join(ROOT, "scripts/provision-sso.sh");

/** Kolik admin dotazů token přežije, než ho tenhle Keycloak přestane uznávat. */
const DOTAZU_NA_TOKEN = 3;

/**
 * Keycloak, který tokenu dává KRÁTKOU platnost — modeluje `expires_in: 60`
 * u nástroje, který dělá desítky okružních cest. Kdo si token neobnoví,
 * dostane 401 a dál se nedostane.
 */
function keycloakSKratkymTokenem() {
  let vydanoTokenu = 0;
  let platny = "";
  let pouzito = 0;

  const json = (res: ServerResponse, code: number, body: unknown) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const server = createServer((req, res) => {
    const url = req.url ?? "";
    if (url.includes("/protocol/openid-connect/token")) {
      vydanoTokenu += 1;
      platny = `token-${vydanoTokenu}`;
      pouzito = 0;
      return json(res, 200, { access_token: platny, expires_in: 60 });
    }
    if (url.includes("/health/ready")) return json(res, 200, {});

    const bearer = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    pouzito += 1;
    if (bearer !== platny || pouzito > DOTAZU_NA_TOKEN) {
      return json(res, 401, { error: "HTTP 401 Unauthorized" });
    }

    // ── Odpovědi, které stačí, aby skript prošel celou smyčkou klientů ──
    const clientId = /clientId=([^&]+)/.exec(url)?.[1];
    if (clientId) return json(res, 200, [{ id: `u-${clientId}`, clientId }]);
    if (/\/clients\/u-[^/]+\/client-secret$/.test(url)) return json(res, 200, { value: "x" });
    if (/\/clients\/u-[^/?]+$/.test(url)) {
      const id = /\/clients\/(u-[^/?]+)/.exec(url)?.[1] ?? "u-x";
      return json(res, 200, { id, clientId: id.slice(2), publicClient: false });
    }
    if (url.includes("/client-scopes")) {
      return json(res, 200, [
        { id: "sc-groups", name: "groups" },
        { id: "sc-roles", name: "roles" },
      ]);
    }
    return json(res, 200, []);
  });

  return { server, tokenu: () => vydanoTokenu };
}

let harness: ReturnType<typeof keycloakSKratkymTokenem>;
let base = "";

beforeAll(async () => {
  harness = keycloakSKratkymTokenem();
  await new Promise<void>((r) => harness.server.listen(0, "127.0.0.1", r));
  const addr = harness.server.address();
  if (addr && typeof addr === "object") base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => (harness.server as Server).close(() => r()));
});

// POZOR na past, na kterou tenhle test sám narazil: falešný Keycloak běží ve
// STEJNÉM procesu jako test. Kdyby se skript spustil synchronně
// (`execFileSync`), zablokoval by smyčku událostí a server by nestihl
// odpovědět — curl by skončil na timeoutu a test by měřil vlastní past, ne
// chování skriptu. Proto asynchronně.
const spustPrikaz = promisify(execFile);

async function spustSso(): Promise<string> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    KEYCLOAK_URL: base,
    KEYCLOAK_ADMIN: "admin",
    KEYCLOAK_ADMIN_PASSWORD: "heslo",
    KEYCLOAK_REALM: "aisha",
    // Povinné hodnoty prod větve — samotné řetězce jsou nepodstatné.
    KEYCLOAK_CLIENT_SECRET: "x",
    APPSMITH_OIDC_SECRET: "x",
    NOCODB_OIDC_SECRET: "x",
    LANGFUSE_OIDC_SECRET: "x",
    STUDIO_OIDC_SECRET: "x",
    N8N_OIDC_SECRET: "x",
    OPENCLAW_OIDC_SECRET: "x",
    NETBIRD_MGMT_SECRET: "x",
    APPSMITH_INTRANET_OIDC_SECRET: "x",
    EXTRANET_OIDC_SECRET: "x",
    INTRANET_DOMAIN: "intranet.test",
    EXTRANET_DOMAIN: "extranet.test",
    APPSMITH_DOMAIN: "appsmith.test",
    NOCODB_DOMAIN: "nocodb.test",
    LANGFUSE_DOMAIN: "langfuse.test",
    STUDIO_DOMAIN: "studio.test",
    N8N_DOMAIN: "n8n.test",
  };
  try {
    const { stdout, stderr } = await spustPrikaz("bash", [SSO, "--prod", "--keycloak-only"], {
      encoding: "utf-8",
      env,
    });
    return `${stdout}${stderr}`;
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string };
    return `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
}

describe("token nesmí zestárnout uprostřed práce", () => {
  test("skript dojde až k netbird-backend — na jeho secretu visí celý mesh", async () => {
    const out = await spustSso();
    expect(out, "skript vůbec nedoběhl").not.toBe("");
    // netbird-backend je osmý v pořadí; s jedním tokenem na celý průchod se na
    // něj nikdy nedostane. A právě jeho secret rozhoduje, jestli vstane mesh.
    // Nestačí, že se jméno v logu OBJEVÍ — objeví se i v chybové hlášce.
    // Měří se, že se u něj zápis secretu ověřeně POVEDL.
    expect(out, "u netbird-backend musí zápis secretu projít a být ověřený").toMatch(
      /netbird-backend'? secret set \+ verified/,
    );
    expect(
      out,
      "„not found\" je tvrzení o OBSAHU Keycloaku; z vypršelého tokenu se vyslovit nesmí",
    ).not.toMatch(/not found in Keycloak realm/);
    expect(
      harness.tokenu(),
      "jeden token na celý průchod nestačí — musel se cestou obnovit",
    ).toBeGreaterThan(1);
  });

  test("práh obnovy je kratší než životnost, kterou Keycloak tokenu dává", () => {
    const sh = readFileSync(SSO, "utf-8");
    expect(sh).toMatch(/KC_TOKEN_MAX_AGE_S/);
    const prah = Number(/KC_TOKEN_MAX_AGE_S:-(\d+)/.exec(sh)?.[1] ?? "0");
    expect(prah, "práh obnovy musí být kladný").toBeGreaterThan(0);
    expect(prah, "a menší než 60 s, které Keycloak vydává").toBeLessThan(60);
  });

  test("žádný curl v tomhle skriptu nejde bez lhůty", () => {
    // Dřív se tu měřilo `curl … ${KC_URL}/admin` na jednom řádku. Po sjednocení
    // do kc_api ta adresa na řádku není (`${KC_URL}${path}`), takže by kontrola
    // neměla co najít a prošla by i nad skriptem plným bezlhůtových dotazů.
    // Ptá se proto na VLASTNOST: každé volání curlu má lhůtu.
    const sh = readFileSync(SSO, "utf-8");
    const bezLhuty = sh
      .split("\n")
      .filter((r) => /(^|[^#])\bcurl\b/.test(r) && !r.trim().startsWith("#"))
      .filter((r) => !/--max-time/.test(r));
    expect(bezLhuty, "dotaz bez --max-time umí viset, a `-sf` z toho udělá ticho").toEqual([]);
  });
});
