/**
 * Ohlášení tabletu bez přihlášeného člověka — podepsaný požadavek musí projít
 * TÍMŽ ověřením, které dělá brána (`verifyDeviceRequest`, AISHA-REQ1).
 *
 * Testuje se ČISTÉ JÁDRO: síť i podpis jsou parametry. Podpis je skutečný
 * P-256 z node:crypto, takže test měří kompatibilitu s bránou, ne jen tvar.
 */
import crypto from "node:crypto";
import { describe, expect, it } from "@jest/globals";
import {
  kidZKlice,
  parseDeviceRequestHeaders,
  verifyDeviceRequest,
  type KnockCrypto,
} from "@aisha/knock-protocol";
import {
  CESTA_OHLASENI,
  CESTA_STAVU,
  DEVICE_AUDIENCE,
  ohlasTablet,
  zjistiStavTabletu,
  type TabletDeps,
} from "../lib/ohlaseniTabletu";
import type { PovereniZarizeni } from "../lib/poverovani-zarizeni";

const TED = 1_790_000_000;

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

/** Ověřovací krypto brány: surový SEC1 klíč → JWK → ECDSA (r||s). */
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

function deps(odpoved: () => Response, zachyceno: Zachyceno[]): TabletDeps {
  return {
    crypto: { randomBytes: (n) => new Uint8Array(crypto.randomBytes(n)) },
    fetch: (async (url: string, init: RequestInit) => {
      zachyceno.push({ init, url });
      return odpoved();
    }) as unknown as typeof fetch,
    nowSec: () => TED,
    podepis: (pem, zprava) =>
      new Uint8Array(crypto.createSign("SHA256").update(Buffer.from(zprava)).sign({ dsaEncoding: "ieee-p1363", key: pem })),
    zakladUrl: async () => "https://api.example.test/",
  };
}

/** Ověří zachycený požadavek přesně jako brána. */
function overJakoBrana(z: Zachyceno, target: string, publicKeyHex: string) {
  const telo = typeof z.init.body === "string" ? new TextEncoder().encode(z.init.body) : new Uint8Array(0);
  return verifyDeviceRequest(
    { audience: DEVICE_AUDIENCE, body: telo, method: String(z.init.method), target },
    parseDeviceRequestHeaders(z.init.headers as Record<string, string>),
    publicKeyHex,
    { audience: DEVICE_AUDIENCE, claimNonce: () => true, crypto: overovac, now: TED, windowSec: 300 },
  );
}

describe("ohlášení tabletu", () => {
  it("pošle klíč s podpisem, který brána přijme, a vrátí ČEKAJÍCÍ stav", async () => {
    const p = tablet();
    const z: Zachyceno[] = [];
    const v = await ohlasTablet(p, { ridic: "1.1.1 (15)" }, deps(() => Response.json({ kid: p.kid, stav: "ceka" }), z));

    expect(v).toEqual({ kid: p.kid, stav: "ceka" });
    expect(z[0].url).toBe(`https://api.example.test${CESTA_OHLASENI}`);
    expect(JSON.parse(String(z[0].init.body))).toEqual({
      kid: p.kid, publicKeyHex: p.publicKeyHex, scope: "ops", verze: { ridic: "1.1.1 (15)" },
    });
    expect(overJakoBrana(z[0], CESTA_OHLASENI, p.publicKeyHex)).toMatchObject({ kid: p.kid, ok: true });
  });

  it("⛔ soukromý klíč neodejde ani v těle, ani v hlavičkách", async () => {
    const p = tablet();
    const z: Zachyceno[] = [];
    await ohlasTablet(p, {}, deps(() => Response.json({ stav: "ceka" }), z));
    const vse = JSON.stringify(z[0]);
    expect(vse).not.toContain("PRIVATE KEY");
    expect(vse).not.toContain(p.privateKeyPem.split("\n")[1]);
  });

  it("zavřené dveře (403 dvere_zavrene od brány) se hlásí jako takové, ne jako obecné selhání", async () => {
    const v = await ohlasTablet(
      tablet(),
      {},
      deps(() => Response.json({ detail: "…", error: "dvere_zavrene" }, { status: 403 }), []),
    );
    expect(v).toEqual({ stav: "dvere-zavrene" });
  });

  it("⛔ 403 bez odpovědi brány (proxy, WAF) NENÍ „dveře zavřené“", async () => {
    const v = await ohlasTablet(tablet(), {}, deps(() => Response.json({ error: "Forbidden" }, { status: 403 }), []));
    expect(v).toEqual({ duvod: "HTTP 403 Forbidden", stav: "selhalo" });
    const prazdna = await ohlasTablet(tablet(), {}, deps(() => new Response(null, { status: 403 }), []));
    expect(prazdna).toEqual({ duvod: "HTTP 403", stav: "selhalo" });
  });

  it("důvod od brány se nese dál celý", async () => {
    const v = await ohlasTablet(
      tablet(),
      {},
      deps(() => Response.json({ duvod: "replay", error: "podpis" }, { status: 401 }), []),
    );
    expect(v).toEqual({ duvod: "HTTP 401 podpis: replay", stav: "selhalo" });
  });

  it("⛔ neznámý stav od brány se nepřevezme", async () => {
    const v = await ohlasTablet(tablet(), {}, deps(() => Response.json({ stav: "schvaleno-asi" }), []));
    expect(v.stav).toBe("selhalo");
  });

  it("výpadek sítě shodí jen tenhle pokus, ne appku", async () => {
    const d = deps(() => Response.json({}), []);
    d.fetch = (async () => {
      throw new Error("Network request failed");
    }) as unknown as typeof fetch;
    expect(await ohlasTablet(tablet(), {}, d)).toEqual({ duvod: "Network request failed", stav: "selhalo" });
  });
});

describe("stav průkazu", () => {
  it("podepsaný dotaz bez těla projde ověřením brány a vrátí schválení", async () => {
    const p = tablet();
    const z: Zachyceno[] = [];
    const v = await zjistiStavTabletu(p, deps(() => Response.json({ kid: p.kid, stav: "schvaleno" }), z));
    expect(v).toEqual({ kid: p.kid, stav: "schvaleno" });
    expect(z[0].init.method).toBe("GET");
    expect(z[0].init.body).toBeUndefined();
    expect(overJakoBrana(z[0], CESTA_STAVU, p.publicKeyHex)).toMatchObject({ ok: true });
  });

  it("neznámý průkaz (404 nezname od brány)", async () => {
    expect(await zjistiStavTabletu(tablet(), deps(() => Response.json({ error: "nezname" }, { status: 404 }), []))).toEqual({
      stav: "nezname",
    });
  });

  it("⛔ server bez nasazené cesty (404 Route not found) NENÍ „tablet neznámý“", async () => {
    const v = await zjistiStavTabletu(
      tablet(),
      deps(() => Response.json({ error: "Not Found", message: "Route GET:/auth/v1/device/stav not found" }, { status: 404 }), []),
    );
    expect(v).toEqual({ duvod: "HTTP 404 Not Found", stav: "selhalo" });
  });
});
