/**
 * Zařízení zapsané generátorem rosteru MUSÍ projít vrátným.
 *
 * ⛔ PROČ TAHLE BRÁNA VZNIKLA (2026-09-09). VER 2 měl obě strany hotové —
 * `verify.ts` uměl ověřit podpis zařízení a telefon si uměl pár vyrobit — ale
 * mezi nimi nevedla CESTA: `knock-roster.mjs` uměl jen `--device`, tedy VER 1 se
 * sdíleným tajemstvím, které `operatorDefects` u VER 2 výslovně zakazuje.
 * Schopnost bez cesty vypadá v testech úplně stejně jako schopnost zapojená.
 *
 * ⭐ MĚŘÍ SE HRANICE MEZI DVĚMA PROGRAMY, ne funkce uvnitř jednoho. Roster
 * vyrábí Node skript, rámec skládá appka, ověřuje služba — a rozejít se můžou
 * ve třech věcech naráz: tvaru veřejného klíče, odvození `kid` a kódování
 * podpisu. Každá z nich se projeví JEDNÍM ZPŮSOBEM: dveře mlčí. Uvnitř
 * jednoho programu je to neviditelné.
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decodeFrame, encodeFrameDevice } from "../../../packages/knock-protocol/src/frame.js";
import { verifyFrame, type Operator } from "../../../packages/knock-protocol/src/verify.js";
import { nodeCrypto } from "../../../packages/knock-protocol/src/node.js";

const KOREN = path.resolve(__dirname, "..", "..", "..");
const SKRIPT = path.join(KOREN, "scripts", "knock-roster.mjs");

/** Náhrada telefonu: pár vznikne tady a soukromá půlka test neopustí. */
function telefon(): { pubHex: string; podepis: (m: Uint8Array) => Uint8Array } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const b = (s: string): Buffer => Buffer.from(s, "base64url");
  return {
    pubHex: Buffer.concat([Buffer.from([0x04]), b(jwk.x), b(jwk.y)]).toString("hex"),
    // ⛔ `ieee-p1363` = syrové r||s (64 B). Výchozí DER má proměnnou délku a
    // rámec by ho ani nesestavil — přesně tohle kódování drží nativní adaptér.
    podepis: (m) =>
      new Uint8Array(crypto.createSign("SHA256").update(m).sign({ key: privateKey, dsaEncoding: "ieee-p1363" })),
  };
}

function zapisDoRosteru(pubHex: string, scope: string): Record<string, Operator> {
  const out = execFileSync(
    process.execPath,
    [SKRIPT, "--pubkey", pubHex, "--owned-by", "zkouska", "--scope", scope],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return JSON.parse(Buffer.from(out.trim(), "base64").toString("utf8")) as Record<string, Operator>;
}

const ted = (): number => Math.floor(Date.now() / 1000);

describe("zařízení zapsané do rosteru projde dveřmi", () => {
  it("otisk, klíč i podpis na sebe sedí — rámec z telefonu vrátný přijme", () => {
    const t = telefon();
    const roster = zapisDoRosteru(t.pubHex, "drive");

    // `kid` si NEVYMÝŠLÍME: bereme ten, který zapsal skript, a rámec jím
    // podepíšeme. Kdyby se odvození obou stran rozešlo, projeví se to tady.
    const [kid] = Object.keys(roster);
    const { frame } = encodeFrameDevice(nodeCrypto, { kid, ts: ted(), scope: "drive" }, t.podepis);

    const vysledek = verifyFrame(decodeFrame(frame), {
      operators: roster, crypto: nodeCrypto, now: ted(), windowSec: 30, otpStep: 30, otpDigits: 6,
    });

    expect(vysledek).toEqual({ ok: true, reason: "ok" });
  });

  it("⛔ zapsaný záznam NENESE žádné sdílené tajemství — jinak VER 2 nemá smysl", () => {
    const t = telefon();
    const roster = zapisDoRosteru(t.pubHex, "ops");
    const [zaznam] = Object.values(roster);

    // Kdyby server tajemství měl, mohl by ťukat ZA zařízení — a věta „klíč
    // neopustil telefon" by byla tvrzení, které data popírají.
    expect(zaznam.hmacKeyHex).toBeUndefined();
    expect(zaznam.otpSeedHex).toBeUndefined();
    expect(zaznam.publicKeyHex).toBe(t.pubHex);
    expect(zaznam.ownedBy).toBe("zkouska");
  });

  it("scope z rosteru PLATÍ — jiný scope vrátný odmítne", () => {
    const t = telefon();
    const roster = zapisDoRosteru(t.pubHex, "drive");
    const [kid] = Object.keys(roster);

    // Bez tohohle by „zapsané zařízení" znamenalo „smí všude", což je přesně
    // ten tichý default, kvůli kterému je `scopes` povinné.
    const { frame } = encodeFrameDevice(nodeCrypto, { kid, ts: ted(), scope: "ops" }, t.podepis);
    const vysledek = verifyFrame(decodeFrame(frame), {
      operators: roster, crypto: nodeCrypto, now: ted(), windowSec: 30, otpStep: 30, otpDigits: 6,
    });

    expect(vysledek).toEqual({ ok: false, reason: "scope-denied" });
  });
});
