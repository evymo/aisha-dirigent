/**
 * Odvození materiálu pověření z KÓDU ČLOVĚKA.
 *
 * ⭐ PROČ V JÁDRU, NE V NODE ADAPTÉRU
 * Tady bydlela `deriveFromPassword` do 2026-08-08 s poznámkou „scrypt v React
 * Native není a být nemusí, protože appka tuhle cestu nepoužívá". Obě půlky té
 * věty přestaly platit: appka kód člověka POUŽÍVÁ (uživatel ho zadá a vědomě
 * zaklepe — ťukat smí jen člověk, viz zákon instance), a `react-native-quick-crypto`
 * scrypt MÁ (`scryptSync`). Derivace je přitom čistá funkce nad primitivy
 * `KnockCrypto` — patří tedy k formátu, ne k jedné platformě, jinak by appka
 * nesla vlastní kopii a dvě kopie KDF se rozejdou (a rozejít KDF = zneplatnit
 * všechna vydaná hesla).
 *
 * ⭐ DVĚ TAJEMSTVÍ, DVĚ CESTY (beze změny proti dřívějšku)
 *   ČLOVĚK   → klíče se ODVODÍ z kódu (tady). Nic se na jeho stroji neukládá,
 *              funguje i PŘED přihlášením — je to break-glass a onboarding.
 *   ZAŘÍZENÍ → NÁHODNÉ klíče vydané jednou zevnitř (freshDeviceSecrets v node).
 *              Změna kódu člověka telefonem nehne.
 */
import type { KnockCrypto } from './crypto.js';
import { bytesToHex } from './bytes.js';
import { MIN_HMAC_BYTES, MIN_SEED_BYTES } from './verify.js';

/**
 * Parametry odvození. MUSÍ být stejné na obou stranách, proto bydlí u formátu a
 * ne u klienta. Změna kterékoli z nich zneplatní VŠECHNA dosud vydaná hesla —
 * nesmí se ladit „od oka".
 *
 * `maxmem` je součást parametrů schválně: quick-crypto v React Native má výchozí
 * strop 32 MB a náš profil (N=16384, r=8) potřebuje 128*r*N = 16 MiB práce, což
 * se stropem 64 MiB projde s rezervou i tam. Spoléhat na to, že Node má default
 * vyšší, by byla tichá past mezi platformami.
 */
export const KDF = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

/** Kolik bajtů scrypt vydá: HMAC klíč + OTP seed + rezerva. */
const DERIVED_BYTES = MIN_HMAC_BYTES + MIN_SEED_BYTES + 4;

/**
 * KÓD ČLOVĚKA → materiál pověření.
 *
 * Sůl je odvozená od `kid`, aby totéž heslo dalo u dvou lidí různé klíče —
 * předpočítaná tabulka pro jednoho pak nepomůže u druhého. Prefix `spa1|`
 * verzuje schéma soli, aby šla někdy vyměnit bez kolize se starou.
 *
 * `crypto.scryptSync` je povinné právě pro tuhle cestu; když ho platforma
 * nedodá (samotný UDP kontejner), je to chyba použití, ne běhu — hlásí se hned.
 */
export function deriveFromPassword(
  crypto: KnockCrypto,
  password: string,
  kid: string,
): { hmacKeyHex: string; otpSeedHex: string } {
  if (typeof password !== 'string' || !password) throw new Error('kód člověka chybí');
  if (typeof kid !== 'string' || !kid) throw new Error('kid chybí');
  if (!crypto.scryptSync) {
    throw new Error('KnockCrypto.scryptSync není dodán — kód člověka bez scryptu odvodit nelze');
  }
  const salt = new TextEncoder().encode(`spa1|${kid}`);
  const out = crypto.scryptSync(
    new TextEncoder().encode(password),
    salt,
    DERIVED_BYTES,
    KDF,
  );
  return {
    hmacKeyHex: bytesToHex(out.subarray(0, MIN_HMAC_BYTES)),
    otpSeedHex: bytesToHex(out.subarray(MIN_HMAC_BYTES)),
  };
}
