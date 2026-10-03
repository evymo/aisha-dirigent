/**
 * ECDSA P-256 ověření zaťukání — ODMÍTNUTÍ ≠ PORUCHA OVĚŘOVATELE
 *
 * ⛔ NAMĚŘENO 2026-09-03. `nodeCrypto.ecdsaP256Verify` je primitivum, na kterém
 * stojí průkaz zařízení u dveří — a NEMĚLO ŽÁDNÝ TEST. Jeho `try` přitom
 * obepínal dvě různé události a obě končily `return false`:
 *
 *   · `createPublicKey` vyhodí na neplatném bodu křivky → vlastnost VSTUPU,
 *     tedy ODMÍTNUTÍ. `false` je správně.
 *   · `verify` vyhodit nemá. Když vyhodí, je rozbitý OVĚŘOVATEL (jiný
 *     algoritmus, změna API Node, došlá paměť). `false` z toho udělá „neplatný
 *     podpis" — dveře se tváří, že klíč nesedí, zatímco ve skutečnosti NIKDO
 *     NEMĚŘÍ. A protože odmítnutí je tu ČEKANÝ stav, nikdo si toho nevšimne.
 *
 * ⭐ Poslední tvrzení je to podstatné: hlídá ROZSAH `try`. Kdyby ho někdo zase
 * rozšířil přes `verify`, porucha ověřovatele se znovu vydává za odmítnutí
 * a tenhle test zčervená.
 */
import { describe, expect, test, vi, afterEach } from "vitest";
import crypto from "node:crypto";
import { nodeCrypto } from "../../../packages/knock-protocol/src/node.js";

/** Pár klíčů + podpis v `ieee-p1363` (syrové r||s), jak je vydá Secure Enclave. */
function pripravVzorek() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  // SEC1 nekomprimovaný bod je posledních 65 bajtů SPKI DER.
  const sec1 = new Uint8Array(publicKey.export({ format: "der", type: "spki" })).slice(-65);
  const zprava = new Uint8Array(Buffer.from("zaťukání na dveře"));
  const podpis = new Uint8Array(
    crypto.createSign("SHA256").update(Buffer.from(zprava)).sign({ key: privateKey, dsaEncoding: "ieee-p1363" }),
  );
  return { sec1, zprava, podpis };
}

/**
 * ⛔ `ecdsaP256Verify` je v `KnockCrypto` VOLITELNÉ — mobilní aplikace si
 * primitivum dodává sama. Node adaptér ho ale mít MUSÍ: bez něj nemají dveře
 * čím ověřit průkaz zařízení. Absence je proto NÁLEZ, ne důvod k přeskočení.
 */
function overit(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  const f = nodeCrypto.ecdsaP256Verify;
  if (!f) throw new Error("nodeCrypto.ecdsaP256Verify chybí — Node adaptér nesplňuje kontrakt dveří");
  return f(publicKey, message, signature);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("knock: ecdsaP256Verify", () => {
  test("platný podpis projde", () => {
    const { sec1, zprava, podpis } = pripravVzorek();
    expect(sec1.length).toBe(65);
    expect(sec1[0]).toBe(0x04);
    expect(overit(sec1, zprava, podpis)).toBe(true);
  });

  test("zkažený podpis, cizí zpráva a špatné délky se odmítnou", () => {
    const { sec1, zprava, podpis } = pripravVzorek();
    const zkazeny = new Uint8Array(podpis);
    zkazeny[10] ^= 0xff;
    expect(overit(sec1, zprava, zkazeny)).toBe(false);
    expect(overit(sec1, new Uint8Array(Buffer.from("jiná zpráva")), podpis)).toBe(false);
    expect(overit(new Uint8Array(64), zprava, podpis)).toBe(false);
    expect(overit(sec1, zprava, new Uint8Array(63))).toBe(false);
  });

  test("bod mimo křivku je ODMÍTNUTÍ (false), a je slyšet", () => {
    const { zprava, podpis } = pripravVzorek();
    const mimoKrivku = new Uint8Array(65);
    mimoKrivku[0] = 0x04;
    mimoKrivku.fill(0x11, 1);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(overit(mimoKrivku, zprava, podpis)).toBe(false);
    // Tichá cesta na bezpečnostní hranici je vada sama o sobě.
    expect(warn).toHaveBeenCalled();
  });

  test("PORUCHA OVĚŘOVATELE PROPADNE NAHORU — nesmí se vydávat za odmítnutí", () => {
    const { sec1, zprava, podpis } = pripravVzorek();
    vi.spyOn(crypto, "createVerify").mockImplementation(() => {
      throw new Error("ověřovatel je rozbitý (simulace změny API / došlé paměti)");
    });
    expect(() => overit(sec1, zprava, podpis)).toThrow(/rozbitý/);
  });
});
