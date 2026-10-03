/**
 * Unit tests for kc-client-secret. Deterministic — a fake fetchImpl stands in
 * for Keycloak (no network). Also locks CLIENT_REGISTRY parity with the SoT
 * (provision-sso.sh) so a new OIDC client can't silently escape reconciliation.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CLIENT_REGISTRY, getClientSecret, getClientUuid, getKcAdminToken } from "./kc-client-secret.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Build a fake fetch returning a scripted response per URL matcher. */
function fakeFetch(routes) {
  return async (url, opts) => {
    for (const [match, res] of routes) {
      if (url.includes(match)) {
        const body = typeof res.body === "function" ? res.body(url, opts) : res.body;
        return {
          ok: res.ok ?? true,
          status: res.status ?? 200,
          text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
        };
      }
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
}

describe("getKcAdminToken", () => {
  it("posts an admin-cli password grant and returns the access token", async () => {
    let seen;
    const fetchImpl = async (url, opts) => {
      seen = { url, body: opts.body };
      return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: "TOKEN123" }) };
    };
    const token = await getKcAdminToken({
      kcUrl: "https://auth.example.com/",
      admin: "admin",
      password: "pw",
      fetchImpl,
    });
    expect(token).toBe("TOKEN123");
    expect(seen.url).toBe("https://auth.example.com/realms/master/protocol/openid-connect/token");
    expect(seen.body).toContain("grant_type=password");
    expect(seen.body).toContain("client_id=admin-cli");
  });

  it("throws on a non-OK response", async () => {
    const fetchImpl = fakeFetch([["token", { ok: false, status: 401, body: "nope" }]]);
    await expect(getKcAdminToken({ kcUrl: "https://k", admin: "a", password: "p", fetchImpl })).rejects.toThrow(/401/);
  });

  it("throws when access_token is absent", async () => {
    const fetchImpl = fakeFetch([["token", { body: { not_a_token: 1 } }]]);
    await expect(getKcAdminToken({ kcUrl: "https://k", admin: "a", password: "p", fetchImpl })).rejects.toThrow(/access_token/);
  });
});

// Naměřeno 2026-09-19: redeploy core restartuje DB, kterou sdílí Keycloak, a
// admin token hned nato vrátí 500 (pool se obnovuje). Přechodnou chybu okno
// transientRetryMs přečká; trvalou (4xx) ani vyčerpané okno neschová.
describe("getKcAdminToken — přechodné chyby", () => {
  /** fetch, který vrací skriptované odpovědi po řadě; Error = síťová chyba. */
  function poRade(odpovedi) {
    const volani = [];
    const fetchImpl = async (url) => {
      const o = odpovedi[Math.min(volani.length, odpovedi.length - 1)];
      volani.push(url);
      if (o instanceof Error) throw o;
      return { ok: o.status < 400, status: o.status, text: async () => JSON.stringify(o.body ?? {}) };
    };
    return { fetchImpl, volani };
  }
  const bezCekani = { sleep: async () => {} };
  const OK = { status: 200, body: { access_token: "T" } };
  const KC500 = { status: 500, body: { error: "unknown_error" } };

  it("5xx v okně zopakuje a vrátí token", async () => {
    const { fetchImpl, volani } = poRade([KC500, KC500, OK]);
    const opakovani = [];
    const token = await getKcAdminToken({
      kcUrl: "https://k", admin: "a", password: "p", fetchImpl, transientRetryMs: 60_000, ...bezCekani,
      onRetry: (i) => opakovani.push(i.pokus),
    });
    expect(token).toBe("T");
    expect(volani).toHaveLength(3);
    expect(opakovani).toEqual([1, 2]);
  });

  it("síťová chyba je přechodná", async () => {
    const { fetchImpl, volani } = poRade([new TypeError("fetch failed"), OK]);
    expect(await getKcAdminToken({ kcUrl: "https://k", admin: "a", password: "p", fetchImpl, transientRetryMs: 60_000, ...bezCekani })).toBe("T");
    expect(volani).toHaveLength(2);
  });

  it("4xx se neopakuje ani s oknem", async () => {
    const { fetchImpl, volani } = poRade([{ status: 401, body: { error: "invalid_grant" } }, OK]);
    await expect(
      getKcAdminToken({ kcUrl: "https://k", admin: "a", password: "p", fetchImpl, transientRetryMs: 60_000, ...bezCekani }),
    ).rejects.toThrow(/401/);
    expect(volani).toHaveLength(1);
  });

  it("vyčerpané okno pustí poslední 5xx nahlas", async () => {
    const { fetchImpl, volani } = poRade([KC500]);
    await expect(
      getKcAdminToken({ kcUrl: "https://k", admin: "a", password: "p", fetchImpl, transientRetryMs: 10_000, ...bezCekani }),
    ).rejects.toThrow(/500/);
    // prodlevy 2 s + 4 s = 6 s ≤ 10 s, další (6 s) by okno přetekla → 3 pokusy
    expect(volani).toHaveLength(3);
  });

  it("bez okna (výchozí) jediný pokus jako dřív", async () => {
    const { fetchImpl, volani } = poRade([KC500, OK]);
    await expect(getKcAdminToken({ kcUrl: "https://k", admin: "a", password: "p", fetchImpl, ...bezCekani })).rejects.toThrow(/500/);
    expect(volani).toHaveLength(1);
  });
});

describe("getClientUuid / getClientSecret", () => {
  const base = { kcUrl: "https://k", realm: "aisha", token: "t" };

  it("resolves the client UUID from clientId", async () => {
    const fetchImpl = fakeFetch([["clients?clientId=netbird-backend", { body: [{ id: "uuid-123" }] }]]);
    expect(await getClientUuid({ ...base, clientId: "netbird-backend", fetchImpl })).toBe("uuid-123");
  });

  it("returns null when the client does not exist", async () => {
    const fetchImpl = fakeFetch([["clients?clientId=", { body: [] }]]);
    expect(await getClientUuid({ ...base, clientId: "ghost", fetchImpl })).toBeNull();
    expect(await getClientSecret({ ...base, clientId: "ghost", fetchImpl })).toBeNull();
  });

  it("reads the confidential client secret value", async () => {
    const fetchImpl = fakeFetch([
      ["clients?clientId=langfuse", { body: [{ id: "uuid-lf" }] }],
      ["clients/uuid-lf/client-secret", { body: { type: "secret", value: "s3cr3t-value" } }],
    ]);
    expect(await getClientSecret({ ...base, clientId: "langfuse", fetchImpl })).toBe("s3cr3t-value");
  });

  it("returns null for a public client (empty secret)", async () => {
    const fetchImpl = fakeFetch([
      ["clients?clientId=pub", { body: [{ id: "uuid-pub" }] }],
      ["client-secret", { body: { value: "" } }],
    ]);
    expect(await getClientSecret({ ...base, clientId: "pub", fetchImpl })).toBeNull();
  });
});

describe("CLIENT_REGISTRY parity with provision-sso.sh (SoT)", () => {
  it("covers exactly the clients that provision-sso.sh sets secrets for", () => {
    const sso = readFileSync(resolve(ROOT, "scripts/provision-sso.sh"), "utf8");

    // ⛔ EXTRAKCE MUSÍ UMĚT NÁSLEDOVAT INDIREKCI. Naměřeno 2026-08-20: skript
    // přestal volat `set_client_secret` přímo a začal ho volat přes obal, který
    // sbírá nezdary (dřív tam stálo `|| true` a razítkování mohlo tiše selhat).
    // Extrakce hledala doslovné `set_client_secret "<jméno>"`, takže si z těla
    // obalu vytáhla POZIČNÍ PARAMETR `$1` a považovala ho za jméno klienta —
    // zatímco skutečná jména, teď stojící u obalu, přestala být vidět úplně.
    //
    // Proto se obaly HLEDAJÍ, ne jmenují: každá funkce, v jejímž těle se
    // `set_client_secret` vyskytuje, je razítkovací cesta. Přejmenování obalu
    // tím nic nerozbije. `$…` se zahazuje — poziční parametr není jméno klienta.
    const razitkovaci = new Set(["set_client_secret"]);
    // Obal bývá ODSAZENÝ (žije uvnitř jiné funkce), takže i jeho uzavírací
    // závorka je odsazená — kotva na `\n}` na začátku řádku ho mine.
    for (const m of sso.matchAll(/^[ \t]*([A-Za-z_][A-Za-z0-9_]*)\s*\(\)\s*\{([\s\S]*?)\n[ \t]*\}/gm)) {
      if (/\bset_client_secret\b/.test(m[2])) razitkovaci.add(m[1]);
    }

    const provisioned = new Set();
    for (const fn of razitkovaci) {
      for (const m of sso.matchAll(new RegExp(`\\b${fn}\\s+"([^"]+)"`, "g"))) {
        if (m[1].startsWith("$")) continue; // poziční parametr uvnitř obalu
        provisioned.add(m[1]);
      }
    }
    const registered = new Set(CLIENT_REGISTRY.map((r) => r.clientId));

    const missing = [...provisioned].filter((c) => !registered.has(c));
    const extra = [...registered].filter((c) => !provisioned.has(c));
    expect(provisioned.size).toBeGreaterThan(0);
    expect(missing, `clients provisioned but NOT in CLIENT_REGISTRY: ${missing.join(", ")}`).toEqual([]);
    expect(extra, `clients in CLIENT_REGISTRY but NOT provisioned: ${extra.join(", ")}`).toEqual([]);
  });

  it("maps every client to a distinct, non-empty env key", () => {
    const keys = CLIENT_REGISTRY.map((r) => r.envKey);
    expect(keys.every((k) => /^[A-Z][A-Z0-9_]*$/.test(k))).toBe(true);
    expect(new Set(keys).size).toBe(keys.length); // no two clients share an env key
  });
});
