/**
 * Adaptér pro Node — jediné místo v balíčku, které smí importovat `node:crypto`.
 *
 * Jádro (`frame`, `otp`, `verify`, `derive`) je záměrně bez krypto závislosti,
 * aby běželo i v React Native. Kdo jede na Node, importuje
 * `@aisha/knock-protocol/node` a dostane hotové primitivy; mobilní aplikace si
 * dodá vlastní přes `KnockCrypto`.
 */
import crypto from 'node:crypto';
import type { KnockCrypto } from './crypto.js';
import { bytesToHex } from './bytes.js';
import { MIN_HMAC_BYTES, MIN_SEED_BYTES } from './verify.js';
import { deriveFromPassword as deriveCore } from './derive.js';

export const nodeCrypto: KnockCrypto = {
  hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
    return new Uint8Array(crypto.createHmac('sha256', key).update(message).digest());
  },
  randomBytes(n: number): Uint8Array {
    return new Uint8Array(crypto.randomBytes(n));
  },
  // scrypt je teď součástí primitiv — kód člověka se odvozuje v jádru
  // (`deriveFromPassword(crypto, …)`), aby týž kód běžel i v appce.
  scryptSync(password, salt, length, opts): Uint8Array {
    return new Uint8Array(crypto.scryptSync(Buffer.from(password), Buffer.from(salt), length, opts));
  },
  /**
   * Ověření podpisu zařízení (VER 2). Jen OVĚŘENÍ — podepisovat Node neumí a
   * nemá, soukromý klíč zůstává v Secure Enclave telefonu.
   *
   * ⭐ `dsaEncoding: 'ieee-p1363'` je podstatné: Node ve výchozím stavu čeká
   * podpis v DER, kdežto WebCrypto i Secure Enclave vracejí syrové `r||s`.
   * Bez toho by KAŽDÝ platný podpis vyšel jako neplatný — a vypadalo by to jako
   * špatný klíč, ne jako špatný formát.
   *
   * Veřejný klíč přichází jako SEC1 bod, proto se skládá přes JWK: `createPublicKey`
   * syrový bod nepřijme a obcházet to ručním DER prefixem by znamenalo psát si
   * vlastní ASN.1, což je zbytečná plocha na chyby.
   */
  ecdsaP256Verify(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
    if (publicKey.length !== 65 || publicKey[0] !== 0x04) return false;
    if (signature.length !== 64) return false;
    // ⛔ ROZSAH `try` JE ROZHODNUTÍ, NE FORMALITA.
    //
    // Dřív obepínal OBOJE — sestavení klíče i ověření — a obojí končilo
    // `return false`. Jenže to jsou DVĚ RŮZNÉ UDÁLOSTI:
    //
    //   · `createPublicKey` vyhodí na NEPLATNÉM BODU křivky. To je vlastnost
    //     VSTUPU, tedy ODMÍTNUTÍ podpisu — `false` je správná odpověď.
    //   · `verify` vyhodit NEMÁ. Když vyhodí, je rozbitý OVĚŘOVATEL: jiný
    //     algoritmus, změna API Node, došlá paměť. Vrátit na to `false` znamená
    //     vydat PORUCHU za „neplatný podpis" — a na bezpečnostní cestě je to
    //     ta nejhorší možná záměna: dveře se tváří, že klíč nesedí, zatímco ve
    //     skutečnosti nikdo neměří. Nikdo si toho nevšimne, protože odmítnutí
    //     je tu ČEKANÝ stav.
    //
    // Ověření proto běží MIMO `try` a případná výjimka propadne nahoru.
    let key: crypto.KeyObject;
    try {
      const b64u = (b: Uint8Array): string => Buffer.from(b).toString('base64url');
      key = crypto.createPublicKey({
        key: { kty: 'EC', crv: 'P-256', x: b64u(publicKey.subarray(1, 33)), y: b64u(publicKey.subarray(33, 65)) },
        format: 'jwk',
      });
    } catch (e) {
      // KLÍČ POCHÁZÍ Z NAŠEHO ROSTERU, ne od odesílatele. Když se ho nepodaří
      // načíst, je to NAŠE vada konfigurace, ne útok — a musí být slyšet.
      // Zahlcení nehrozí: vstup není útočníkem ovlivnitelný a roster je malý.
      // Materiál se NEVYPISUJE, jen délka a důvod. (Formulace převzata z #281,
      // které tuhle větev rozebralo lépe než původní znění tady.)
      console.warn(
        `[knock] neplatný veřejný klíč v rosteru (${publicKey.length} B): ${(e as Error).message}`,
      );
      return false;
    }
    return crypto.createVerify('SHA256').update(message).verify(
      { key, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature),
    );
  },
};

// KDF a `deriveFromPassword` se PŘESTĚHOVALY do jádra (`./derive`), protože je
// appka potřebuje a scrypt jde injektovat. Re-export drží zpětnou kompatibilitu
// importů z `/node`.
export { KDF } from './derive.js';

/**
 * KÓD ČLOVĚKA → materiál pověření, Node varianta.
 *
 * Tenký obal nad jádrem: dosadí `nodeCrypto`, takže volající na Node nemusí
 * primitiva řešit. Appka volá jádro přímo se svým `KnockCrypto`.
 */
export function deriveFromPassword(password: string, kid: string): { hmacKeyHex: string; otpSeedHex: string } {
  return deriveCore(nodeCrypto, password, kid);
}

/** ZAŘÍZENÍ: náhodné klíče, ne odvozené z hesla. Vydávají se jednou, za dveřmi. */
export function freshDeviceSecrets(): { hmacKeyHex: string; otpSeedHex: string } {
  return {
    hmacKeyHex: bytesToHex(new Uint8Array(crypto.randomBytes(MIN_HMAC_BYTES))),
    otpSeedHex: bytesToHex(new Uint8Array(crypto.randomBytes(MIN_SEED_BYTES + 4))),
  };
}
