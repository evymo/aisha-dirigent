/**
 * Relace tabletu (F2) — podepsaný požadavek musí projít TÍMŽ ověřením jako u brány
 * (`verifyDeviceRequest`, AISHA-REQ1), odpovědi brány se musí přeložit na stavy obrazovky
 * a zdroj tokenu nesmí zahltit bránu (strop relací na průkaz) ani ztratit identitu
 * tabletu při výpadku sítě (offline fronta by pak předání odmítla jako cizí).
 */
import crypto from "node:crypto";
import { describe, expect, it } from "@jest/globals";
import {
  kidZKlice,
  parseDeviceRequestHeaders,
  verifyDeviceRequest,
  type KnockCrypto,
} from "@aisha/knock-protocol";
import { DEVICE_AUDIENCE, type TabletDeps } from "../lib/ohlaseniTabletu";
import { CESTA_RELACE, REZERVA_OBNOVY_S, vezmiRelaci, vytvorZdrojRelace, type VysledekRelace } from "../lib/relaceTabletu";
import type { PovereniZarizeni } from "../lib/poverovani-zarizeni";

const TED = 1_790_000_000;
const UCET = "11111111-2222-4333-8444-555555555555";

function tablet(): PovereniZarizeni {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const pubHex = Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(jwk.x, "base64url"),
    Buffer.from(jwk.y, "base64url"),
  ]).toString("hex");
  return {
    kid: kidZKlice(pubHex),
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }) as string,
    publicKeyHex: pubHex,
    scope: "ops",
  };
}

const overovac: KnockCrypto = {
  hmacSha256: (k, m) => new Uint8Array(crypto.createHmac("sha256", Buffer.from(k)).update(Buffer.from(m)).digest()),
  randomBytes: (n) => new Uint8Array(crypto.randomBytes(n)),
  scryptSync: (p, s, l, o) => new Uint8Array(crypto.scryptSync(Buffer.from(p), Buffer.from(s), l, o)),
  ecdsaP256Verify: (pub, zprava, podpis) => {
    const b = Buffer.from(pub);
    const klic = crypto.createPublicKey({
      format: "jwk",
      key: { crv: "P-256", kty: "EC", x: b.subarray(1, 33).toString("base64url"), y: b.subarray(33).toString("base64url") },
    });
    return crypto.verify("sha256", Buffer.from(zprava), { dsaEncoding: "ieee-p1363", key: klic }, Buffer.from(podpis));
  },
};

interface Zachyceno {
  url: string;
  init: RequestInit;
}

function deps(odpoved: () => Response | Promise<Response>, zachyceno: Zachyceno[], ted = { s: TED }): TabletDeps {
  return {
    crypto: { randomBytes: (n) => new Uint8Array(crypto.randomBytes(n)) },
    fetch: (async (url: string, init: RequestInit) => {
      zachyceno.push({ init, url });
      return odpoved();
    }) as unknown as typeof fetch,
    nowSec: () => ted.s,
    podepis: (pem, zprava) =>
      new Uint8Array(crypto.createSign("SHA256").update(Buffer.from(zprava)).sign({ dsaEncoding: "ieee-p1363", key: pem })),
    zakladUrl: async () => "https://api.example.test/",
  };
}

const okOdpoved = (kid: string, exp = TED + 900) =>
  Response.json({ access_token: `tok-${exp}`, expires_at: exp, expires_in: 900, kid, token_type: "bearer", user: { id: UCET } });

describe("vezmiRelaci — jeden podepsaný požadavek", () => {
  it("podpis projde ověřením brány; úspěch nese token, konec a účet tabletu", async () => {
    const p = tablet();
    const z: Zachyceno[] = [];
    const v = await vezmiRelaci(p, deps(() => okOdpoved(p.kid), z));
    expect(v).toEqual({ relace: { kid: p.kid, token: `tok-${TED + 900}`, uzivatel: UCET, vyprsi: TED + 900 }, stav: "ok" });
    expect(z[0].url).toBe(`https://api.example.test${CESTA_RELACE}`);
    expect(z[0].init.method).toBe("POST");
    const verdikt = verifyDeviceRequest(
      { audience: DEVICE_AUDIENCE, body: new Uint8Array(0), method: "POST", target: CESTA_RELACE },
      parseDeviceRequestHeaders(z[0].init.headers as Record<string, string>),
      p.publicKeyHex,
      { audience: DEVICE_AUDIENCE, claimNonce: () => true, crypto: overovac, now: TED, windowSec: 300 },
    );
    expect(verdikt).toMatchObject({ kid: p.kid, ok: true });
    expect(JSON.stringify(z[0])).not.toContain("PRIVATE KEY");
  });

  const pripady: Array<[number, Record<string, string>, VysledekRelace]> = [
    [403, { error: "dvere_zavrene" }, { stav: "dvere-zavrene" }],
    [403, { error: "neschvaleno", duvod: "ceka" }, { duvod: "ceka", stav: "neschvaleno" }],
    [403, { error: "neschvaleno", duvod: "odvolano" }, { duvod: "odvolano", stav: "neschvaleno" }],
    [404, { error: "nezname" }, { stav: "nezname" }],
    [429, { error: "prilis_casto" }, { stav: "prilis-casto" }],
    [401, { error: "podpis", duvod: "replay" }, { duvod: "HTTP 401 podpis: replay", stav: "selhalo" }],
    [200, { neco: "jineho" }, { duvod: "HTTP 200", stav: "selhalo" }],
  ];
  it.each(pripady)("HTTP %i %j → %j", async (kod, telo, cekam) => {
    const p = tablet();
    expect(await vezmiRelaci(p, deps(() => Response.json(telo, { status: kod }), []))).toEqual(cekam);
  });

  const poruchyCesty: Array<[number, Record<string, unknown>, VysledekRelace]> = [
    // Server bez nasazeného F2 (naměřeno na riq 29. 9.): cesta neexistuje.
    [404, { message: "Route POST:/auth/v1/device/session not found", error: "Not Found", statusCode: 404 },
      { duvod: "HTTP 404 Not Found", stav: "selhalo" }],
    // Proxy / WAF před bránou.
    [403, { error: "Forbidden" }, { duvod: "HTTP 403 Forbidden", stav: "selhalo" }],
    [404, {}, { duvod: "HTTP 404", stav: "selhalo" }],
  ];
  it.each(poruchyCesty)("⛔ porucha cesty HTTP %i %j NENÍ verdikt o průkazu → %j", async (kod, telo, cekam) => {
    const p = tablet();
    expect(await vezmiRelaci(p, deps(() => Response.json(telo, { status: kod }), []))).toEqual(cekam);
  });

  it("výpadek sítě = selhalo s důvodem, ne výjimka", async () => {
    const p = tablet();
    const v = await vezmiRelaci(p, deps(() => Promise.reject(new Error("Network request failed")), []));
    expect(v).toEqual({ duvod: "Network request failed", stav: "selhalo" });
  });
});

describe("zdroj relace — mezipaměť, jeden požadavek naráz, identita přes výpadek", () => {
  it("souběžné dotazy vyrobí JEDNU relaci; do rezervy se token drží, pak se obnoví", async () => {
    const p = tablet();
    const z: Zachyceno[] = [];
    const ted = { s: TED };
    const zdroj = vytvorZdrojRelace({ ...deps(() => okOdpoved(p.kid, ted.s + 900), z, ted), nactiPovereni: async () => p });
    const tokeny = await Promise.all([zdroj.token(), zdroj.token(), zdroj.token()]);
    expect(new Set(tokeny)).toEqual(new Set([`tok-${TED + 900}`]));
    expect(z).toHaveLength(1);

    ted.s = TED + 900 - REZERVA_OBNOVY_S - 1;
    expect(await zdroj.token()).toBe(`tok-${TED + 900}`);
    expect(z).toHaveLength(1);

    ted.s = TED + 900 - REZERVA_OBNOVY_S + 1;
    expect(await zdroj.token()).toBe(`tok-${ted.s + 900}`);
    expect(z).toHaveLength(2);
    expect(zdroj.uzivatel()).toBe(UCET);
  });

  it("⛔ server bez cesty relace (404 Route not found) identitu tabletu NEZAHODÍ", async () => {
    const p = tablet();
    let nasazeno = true;
    const ted = { s: TED };
    const zdroj = vytvorZdrojRelace({
      ...deps(
        () => (nasazeno
          ? okOdpoved(p.kid, ted.s + 900)
          : Response.json({ error: "Not Found", message: "Route POST:/auth/v1/device/session not found" }, { status: 404 })),
        [],
        ted,
      ),
      nactiPovereni: async () => p,
    });
    await zdroj.token();
    nasazeno = false;
    ted.s += 900;
    expect(await zdroj.token()).toBeNull();
    expect(zdroj.posledni()).toEqual({ duvod: "HTTP 404 Not Found", stav: "selhalo" });
    expect(zdroj.uzivatel()).toBe(UCET);
  });

  it("⛔ výpadek sítě token zahodí, ale identitu tabletu NE (offline fronta)", async () => {
    const p = tablet();
    let sit = true;
    const ted = { s: TED };
    const zdroj = vytvorZdrojRelace({
      ...deps(() => (sit ? okOdpoved(p.kid, ted.s + 900) : Promise.reject(new Error("offline"))), [], ted),
      nactiPovereni: async () => p,
    });
    await zdroj.token();
    sit = false;
    ted.s += 900;
    expect(await zdroj.token()).toBeNull();
    expect(zdroj.posledni()).toEqual({ duvod: "offline", stav: "selhalo" });
    expect(zdroj.uzivatel()).toBe(UCET);
  });

  it("⛔ odvolání (neschvaleno) a ztráta klíče identitu tabletu ukončí", async () => {
    const p = tablet();
    let odpoved: () => Response = () => okOdpoved(p.kid);
    const ted = { s: TED };
    let povereni: PovereniZarizeni | null = p;
    const zdroj = vytvorZdrojRelace({ ...deps(() => odpoved(), [], ted), nactiPovereni: async () => povereni });
    await zdroj.token();
    odpoved = () => Response.json({ duvod: "odvolano", error: "neschvaleno" }, { status: 403 });
    ted.s += 900;
    expect(await zdroj.token()).toBeNull();
    expect(zdroj.uzivatel()).toBeNull();

    odpoved = () => okOdpoved(p.kid, ted.s + 900);
    await zdroj.token();
    expect(zdroj.uzivatel()).toBe(UCET);
    povereni = null;
    ted.s += 900;
    expect(await zdroj.token()).toBeNull();
    expect(zdroj.posledni()).toEqual({ stav: "bez-klice" });
    expect(zdroj.uzivatel()).toBeNull();
  });
});
