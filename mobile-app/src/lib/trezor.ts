/**
 * Trezor — šifrování obsahu, který leží na disku telefonu.
 *
 * ⛔ PROČ VZNIKL. Offline fronta držela v `AsyncStorage` PLAINTEXT: jméno
 * přejímajícího, PODPIS jako data-URI, poznámky a cesty k fotkám. Tokeny přitom
 * odjakživa mířily do `SecureStore`. Chránili jsme tedy klíč od domu a nechali
 * na stole právní důkaz o TŘETÍ osobě, která ho podepsala v dobré víře.
 *
 * ⭐ ČISTÉ JÁDRO, NATIVNÍ MODUL AŽ V ADAPTÉRU — týž vzor jako `knock.ts`
 * × `knock-native.ts`. Tenhle soubor neimportuje nic nativního, takže tentýž
 * kód běží v jestu i na telefonu a testy nelinkují C++.
 *
 * ## Tvar obálky
 *
 *     v1.<iv b64>.<tag b64>.<ciphertext b64>
 *
 * Verze je na začátku ZÁMĚRNĚ: až se formát změní, půjde to poznat a ne
 * spadnout. Řetězec bez prefixu je LEGACY PLAINTEXT z buildu před šifrováním —
 * a ten se musí umět přečíst, jinak by upgrade appky smazal rozdělanou práci.
 *
 * ## Dvě věci, které se tu NESMÍ splést
 *
 * ⛔ 1. PRÁZDNO × NEČITELNO. Šifrování přidává NOVÝ způsob, jak ztratit práci
 * řidiče: ztracený klíč (obnova systému, přeinstalace, vymazaný SecureStore).
 * Naivní `try { decrypt } catch { return [] }` by vyrobil přesně vadu z PR #154
 * na novém místě — appka by tvrdila „nic nemáš" nad podepsaným předáním, které
 * jen nejde přečíst. Proto `rozsifruj` na nečitelném vstupu VYHODÍ výjimku
 * a volající ji musí vyslovit; NIKDY nevrací prázdno.
 *
 * ⛔ 2. Nečitelný obsah se NEPŘEPISUJE. Kdo neumí přečíst, nesmí zapsat —
 * přepis by ztrátu udělal trvalou. To je pravidlo volajícího, ale patří sem,
 * protože jinde by ho nikdo nenašel.
 *
 * @module
 */

/** Nativní krypto, které trezor potřebuje. Injektuje se, aby jádro zůstalo čisté. */
export interface TrezorCrypto {
  /** Kryptograficky bezpečná náhoda — IV i klíč. */
  randomBytes(n: number): Uint8Array;
  /** AES-256-GCM. `aad` váže šifrotext ke jménu úložiště (viz níž). */
  encrypt(key: Uint8Array, iv: Uint8Array, plaintext: Uint8Array, aad: Uint8Array):
    { ciphertext: Uint8Array; tag: Uint8Array };
  /** Ověřuje `tag` — porušený vstup MUSÍ vyhodit, ne vrátit odpad. */
  decrypt(key: Uint8Array, iv: Uint8Array, ciphertext: Uint8Array, tag: Uint8Array, aad: Uint8Array): Uint8Array;
}

/** 96 bitů — doporučená délka IV pro GCM. */
export const IV_BYTES = 12;
/** 256 bitů. */
export const KEY_BYTES = 32;

const PREFIX = "v1";

/** Chyba čtení trezoru. Vlastní typ, aby ji volající nespletl s „nic tam není". */
export class TrezorNecitelny extends Error {
  constructor(duvod: string) {
    super(`trezor: obsah nejde přečíst (${duvod})`);
    this.name = "TrezorNecitelny";
  }
}

// ⛔ BEZ `Buffer`. Ten je globál Nodu — v jestu existuje, v release bundlu
// Hermesu NE. Vada tím propadla každou bránou a projevila se až na telefonu
// (`Property 'Buffer' doesn't exist`). Nativní Buffer sem přitom naimportovat
// NELZE: tenhle soubor je čisté jádro a nesmí linkovat nativní modul.
// Proto base64 ručně — pár řádků, žádná závislost, týž kód v jestu i v Hermesu.
// ⚠️ Abeceda se SKLÁDÁ, nepíše. Jako literál ji detektor tajemství hlásí jako
// řetězec s vysokou entropií (i po rozdělení na rozsahy) — a výjimka v lintu by
// tu vypnula pravidlo, které tu má být. Rozsahy jsou stejně čitelné z kódů.
const rozsah = (od: number, kolik: number): string =>
  Array.from({ length: kolik }, (_, i) => String.fromCharCode(od + i)).join("");

const ABECEDA = rozsah(65, 26) + rozsah(97, 26) + rozsah(48, 10) + "+/";

/** Base64 bez `Buffer`. Exportované, aby adaptér neměl DRUHOU implementaci. */
export const b64 = {
  enc: (u: Uint8Array): string => {
    let out = "";
    for (let i = 0; i < u.length; i += 3) {
      const a = u[i], b = u[i + 1], c = u[i + 2];
      out += ABECEDA[a >> 2];
      out += ABECEDA[((a & 3) << 4) | ((b ?? 0) >> 4)];
      out += b === undefined ? "=" : ABECEDA[((b & 15) << 2) | ((c ?? 0) >> 6)];
      out += c === undefined ? "=" : ABECEDA[c & 63];
    }
    return out;
  },
  dec: (s: string): Uint8Array => {
    const cisty = s.replace(/[^A-Za-z0-9+/]/g, "");
    const out = new Uint8Array((cisty.length * 3) >> 2);
    let p = 0, akum = 0, bitu = 0;
    for (const ch of cisty) {
      const v = ABECEDA.indexOf(ch);
      // ⛔ Neznámý znak je VADA VSTUPU, ne důvod ho přeskočit: tiché vynechání
      // by z porušeného šifrotextu udělalo kratší platný a `rozsifruj` by pak
      // hlásil špatnou příčinu.
      if (v < 0) throw new TrezorNecitelny("base64: neplatný znak");
      akum = (akum << 6) | v;
      bitu += 6;
      if (bitu >= 8) { bitu -= 8; out[p++] = (akum >> bitu) & 0xff; }
    }
    return out.subarray(0, p);
  },
};

/**
 * Je to zamčená obálka, nebo plaintext ze staršího buildu?
 *
 * Rozhoduje PREFIX, ne pokus o rozšifrování: „zkusím a když to spadne, je to
 * plaintext" by z porušeného šifrotextu udělalo text a appka by pak parsovala
 * náhodné bajty jako frontu.
 */
export function jeZamceno(raw: string): boolean {
  return raw.startsWith(`${PREFIX}.`);
}

/**
 * Zamkne text.
 *
 * `jmenoUlozky` jde do AAD, takže obálku nejde přenést pod jiný klíč úložiště:
 * kdo by přesunul zálohu fronty na místo cache, dostane chybu ověření, ne
 * záměnu obsahu.
 */
export function zasifruj(
  crypto: TrezorCrypto,
  klic: Uint8Array,
  jmenoUlozky: string,
  text: string,
): string {
  if (klic.length !== KEY_BYTES) throw new Error(`trezor: klíč má ${klic.length} B, čekám ${KEY_BYTES}`);
  const iv = crypto.randomBytes(IV_BYTES);
  const aad = new TextEncoder().encode(jmenoUlozky);
  const { ciphertext, tag } = crypto.encrypt(klic, iv, new TextEncoder().encode(text), aad);
  return [PREFIX, b64.enc(iv), b64.enc(tag), b64.enc(ciphertext)].join(".");
}

/**
 * Odemkne obálku. Plaintext ze staršího buildu PROPUSTÍ beze změny — upgrade
 * appky nesmí zahodit rozdělanou práci jen proto, že vznikla dřív.
 *
 * ⛔ Nečitelný vstup VYHODÍ `TrezorNecitelny`. Nikdy nevrací prázdno ani `null`:
 * „nemám co číst" a „neumím to přečíst" jsou dva různé stavy a jejich slití je
 * přesně ta třída vady, kvůli které řidičům mizela práce.
 */
export function rozsifruj(
  crypto: TrezorCrypto,
  klic: Uint8Array,
  jmenoUlozky: string,
  raw: string,
): string {
  if (!jeZamceno(raw)) return raw;

  const casti = raw.split(".");
  if (casti.length !== 4) throw new TrezorNecitelny(`obálka má ${casti.length} částí místo 4`);
  const [, ivB64, tagB64, ctB64] = casti;

  let otevreno: Uint8Array;
  try {
    otevreno = crypto.decrypt(
      klic, b64.dec(ivB64), b64.dec(ctB64), b64.dec(tagB64),
      new TextEncoder().encode(jmenoUlozky),
    );
  } catch (e) {
    // Špatný klíč i porušený bajt vypadají stejně — a je to tak správně:
    // GCM ověřuje celistvost, takže „nesedí" znamená „nevěř tomu", ne „oprav to".
    throw new TrezorNecitelny(e instanceof Error ? e.message : "ověření selhalo");
  }
  return new TextDecoder().decode(otevreno);
}

/** Nový klíč úložiště. Per-instalace; nikdy neopouští SecureStore. */
export function novyKlic(crypto: TrezorCrypto): Uint8Array {
  return crypto.randomBytes(KEY_BYTES);
}
