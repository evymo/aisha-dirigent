/**
 * Podpis HTTP požadavku PRŮKAZEM ZAŘÍZENÍ — týmž klíčem P-256, kterým zařízení
 * klepe rámcem VER 2.
 *
 * ⭐ PROČ TO EXISTUJE
 * Zaťukání otevře dveře ADRESE, ne požadavku. Za dveřmi pak servis neví, které
 * zařízení mluví — a spravované zařízení (tablet s hlídačem) potřebuje mluvit
 * SAMO ZA SEBE, i když na něm nikdo není přihlášený nebo appka padá. Podpis
 * každého požadavku týmž klíčem dává identitu bez druhého tajemství: server
 * drží jen veřejnou půlku, kterou už zná ze schváleného průkazu.
 *
 * ⛔ PROČ TADY, A NE V SERVISU A V APPCE ZVLÁŠŤ
 * Kanonizace je drátový formát. Dvě kopie (jedna v servisu, druhá v zařízení)
 * se rozejdou a projeví se to jediným způsobem: KAŽDÝ podpis vyjde jako
 * neplatný — k nerozeznání od cizího klíče. Proto jeden zdroj a zamražené
 * vektory v testech.
 *
 * ⛔ NEBERE KLÍČ, BERE FUNKCI — stejně jako `encodeFrameDevice`. Klíč drží
 * Keystore / Secure Enclave a balíček se k soukromé půlce nedostane ani typově.
 */
import { bytesToHex, concat, hexToBytes, utf8Encode, writeUint32BE, writeUint64BE } from './bytes.js';
import type { KnockCrypto } from './crypto.js';
import { SIG_BYTES } from './frame.js';
import { kidZKlice, PUBKEY_BYTES } from './verify.js';

/**
 * Oddělení domén. Rámec zaťukání začíná `SPA1`, tohle `AISHA-REQ1`: podpis
 * rámce proto nikdy nemůže projít jako podpis požadavku a naopak, i když je
 * klíč týž. ⛔ Změna = nový formát = nová konstanta, nikdy úprava té staré.
 */
export const REQUEST_MAGIC = 'AISHA-REQ1';
export const REQUEST_NONCE_BYTES = 16;

/** Jména hlaviček — malými písmeny, jak je doručí Node i Fastify. */
export const DEVICE_REQUEST_HEADERS = {
  kid: 'x-device-kid',
  ts: 'x-device-ts',
  nonce: 'x-device-nonce',
  signature: 'x-device-signature',
} as const;

export interface DeviceRequest {
  /**
   * Komu je požadavek určený (např. jméno servisu). Váže podpis na příjemce:
   * požadavek zachycený u jednoho servisu neprojde u jiného, který ověřuje
   * týmž průkazem.
   */
  audience: string;
  method: string;
  /** Cesta včetně query, přesně jak odešla: `/v1/sync?x=1`. */
  target: string;
  /** Tělo přesně v bajtech, jak odešlo. Bez těla = prázdné. */
  body?: Uint8Array;
}

export interface DeviceRequestIdentity {
  kid: string;
  /** Unixové sekundy. */
  ts: number;
  /** 16 B hex; bez něj se vyrobí náhodný. */
  nonceHex?: string;
}

export type DeviceRequestHeaders = Record<
  (typeof DEVICE_REQUEST_HEADERS)[keyof typeof DEVICE_REQUEST_HEADERS],
  string
>;

const AUDIENCE_RE = /^[a-z0-9][a-z0-9.-]{0,254}$/;
const METHOD_RE = /^[A-Z]{1,16}$/;
// Tisknutelné ASCII bez mezery: cíl s mezerou nebo řídicím znakem by se po
// cestě přes proxy mohl přepsat a podpis by nesedl z důvodu, který nejde vidět.
const TARGET_RE = /^\/[\x21-\x7e]{0,8191}$/;
const HEX_RE = /^[0-9a-f]+$/;

function vadaVstupu(input: DeviceRequest & DeviceRequestIdentity): string | null {
  if (!AUDIENCE_RE.test(input.audience)) return 'audience';
  if (!METHOD_RE.test(input.method)) return 'method';
  if (!TARGET_RE.test(input.target)) return 'target';
  const kidB = utf8Encode(input.kid);
  if (kidB.length === 0 || kidB.length > 255) return 'kid';
  if (!Number.isSafeInteger(input.ts) || input.ts < 0) return 'ts';
  if (
    input.nonceHex !== undefined &&
    (input.nonceHex.length !== REQUEST_NONCE_BYTES * 2 || !HEX_RE.test(input.nonceHex))
  )
    return 'nonce';
  return null;
}

/**
 * Bajty, které podpis kryje. Každé pole s proměnnou délkou nese délku před
 * sebou, takže dvě různé sady polí nemůžou dát tytéž bajty (`/a` + tělo `b`
 * vs. `/ab` + prázdné tělo).
 *
 * Vyhazuje na vadném vstupu: podepsat vadný požadavek je chyba volajícího,
 * ne stav, který se má odeslat a selhat až na druhé straně.
 */
export function deviceRequestSigningBytes(
  input: DeviceRequest & DeviceRequestIdentity & { nonceHex: string },
): Uint8Array {
  const vada = vadaVstupu(input);
  if (vada) throw new Error(`požadavek k podpisu má vadné pole: ${vada}`);
  const audienceB = utf8Encode(input.audience);
  const methodB = utf8Encode(input.method);
  const targetB = utf8Encode(input.target);
  const kidB = utf8Encode(input.kid);
  const body = input.body ?? new Uint8Array(0);
  return concat(
    utf8Encode(REQUEST_MAGIC),
    Uint8Array.from([audienceB.length]),
    audienceB,
    Uint8Array.from([methodB.length]),
    methodB,
    writeUint32BE(targetB.length),
    targetB,
    Uint8Array.from([kidB.length]),
    kidB,
    writeUint64BE(input.ts),
    hexToBytes(input.nonceHex),
    writeUint32BE(body.length),
    body,
  );
}

/**
 * Podepíše požadavek a vrátí hlavičky.
 *
 * `podepis` je SYNCHRONNÍ jako u `encodeFrameDevice`. Kdo podepisuje
 * asynchronně (nativní Keystore), složí si to sám: `deviceRequestSigningBytes`
 * → podpis → `deviceRequestHeadersFrom`.
 */
export function signDeviceRequest(
  crypto: Pick<KnockCrypto, 'randomBytes'>,
  input: DeviceRequest & DeviceRequestIdentity,
  podepis: (zprava: Uint8Array) => Uint8Array,
): DeviceRequestHeaders {
  const nonceHex = input.nonceHex ?? bytesToHex(crypto.randomBytes(REQUEST_NONCE_BYTES));
  const bytes = deviceRequestSigningBytes({ ...input, nonceHex });
  return deviceRequestHeadersFrom({ kid: input.kid, ts: input.ts, nonceHex }, podepis(bytes));
}

export function deviceRequestHeadersFrom(
  identity: Required<DeviceRequestIdentity>,
  signature: Uint8Array,
): DeviceRequestHeaders {
  // Délka se hlídá u odesílatele — na druhé straně už není vidět, kdo podpis vyrobil.
  if (signature.length !== SIG_BYTES)
    throw new Error(`podpis musí mít ${SIG_BYTES} bajtů (r||s), dostal ${signature.length}`);
  return {
    [DEVICE_REQUEST_HEADERS.kid]: identity.kid,
    [DEVICE_REQUEST_HEADERS.ts]: String(identity.ts),
    [DEVICE_REQUEST_HEADERS.nonce]: identity.nonceHex,
    [DEVICE_REQUEST_HEADERS.signature]: bytesToHex(signature),
  } as DeviceRequestHeaders;
}

export interface ParsedDeviceRequestHeaders {
  kid: string;
  ts: number;
  nonceHex: string;
  signature: Uint8Array;
}

/**
 * Rozloží hlavičky. `null` = hlavičky chybí nebo nemají tvar — požadavek se
 * odmítne jako `malformed` dřív, než se sáhne do databáze pro klíč.
 */
export function parseDeviceRequestHeaders(
  headers: Record<string, string | string[] | undefined>,
): ParsedDeviceRequestHeaders | null {
  const jedna = (name: string): string | null => {
    const v = headers[name];
    return typeof v === 'string' && v.length > 0 ? v : null;
  };
  const kid = jedna(DEVICE_REQUEST_HEADERS.kid);
  const tsRaw = jedna(DEVICE_REQUEST_HEADERS.ts);
  const nonceHex = jedna(DEVICE_REQUEST_HEADERS.nonce);
  const sigHex = jedna(DEVICE_REQUEST_HEADERS.signature);
  if (kid === null || tsRaw === null || nonceHex === null || sigHex === null) return null;
  if (utf8Encode(kid).length > 255) return null;
  if (!/^[0-9]{1,15}$/.test(tsRaw)) return null;
  if (nonceHex.length !== REQUEST_NONCE_BYTES * 2 || !HEX_RE.test(nonceHex)) return null;
  if (sigHex.length !== SIG_BYTES * 2 || !HEX_RE.test(sigHex)) return null;
  return { kid, ts: Number(tsRaw), nonceHex, signature: hexToBytes(sigHex) };
}

export type DeviceRequestRejectReason =
  | 'malformed'
  /** Průkaz s tímhle `kid` není schválený, je odvolaný, nebo neexistuje. */
  | 'unknown-kid'
  /** Uložený klíč nemá tvar nebo k němu nesedí `kid` — vada NAŠICH dat. */
  | 'credential-unusable'
  | 'verifier-incapable'
  | 'bad-sig'
  | 'ts-window'
  | 'replay';

/** Tvar jako u `verifyFrame`: důvod je vždy přítomný, i u úspěchu. */
export type DeviceRequestVerdict =
  | { ok: true; reason: 'ok'; kid: string }
  | { ok: false; reason: DeviceRequestRejectReason };

export interface DeviceRequestVerifyContext {
  audience: string;
  crypto: KnockCrypto;
  now: number;
  windowSec: number;
  /**
   * Zabere nonce pro `kid`. `false` = už byl použitý. Volá se AŽ PO ověření
   * podpisu, aby cizí požadavek nemohl spálit nonce, který teprve přijde.
   * ⛔ Povinné: ověření bez ochrany proti přehrání by vypadalo úplně stejně
   * jako ověření s ní.
   */
  claimNonce: (kid: string, nonceHex: string) => boolean;
}

/**
 * Ověří podepsaný požadavek.
 *
 * `publicKeyHex` dodá volající — z průkazu, který je SCHVÁLENÝ a NEODVOLANÝ
 * (`null`, když takový není). Vyhledání je asynchronní věc servisu, ověření
 * zůstává čisté a synchronní.
 *
 * Pořadí je jako u `verifyFrame`: podpis dřív než časové okno, aby
 * `ts-window` i `replay` znamenaly „odesílatel klíč DRŽÍ".
 */
export function verifyDeviceRequest(
  request: DeviceRequest,
  parsed: ParsedDeviceRequestHeaders | null,
  publicKeyHex: string | null,
  ctx: DeviceRequestVerifyContext,
): DeviceRequestVerdict {
  if (parsed === null) return { ok: false, reason: 'malformed' };

  // ⛔ Vadná `audience` je NAŠE konfigurace, ne vada požadavku — musí být slyšet,
  // jinak by každý požadavek tiše vycházel jako `malformed`.
  if (!AUDIENCE_RE.test(ctx.audience)) throw new Error(`ověřovatel má vadnou audience: ${ctx.audience}`);

  const vstup = { ...request, audience: ctx.audience, kid: parsed.kid, ts: parsed.ts, nonceHex: parsed.nonceHex };
  // Vadná metoda nebo cíl z VNĚJŠÍHO požadavku = odmítnutí vstupu. Kontroluje se
  // PŘEDEM, ne chycením výjimky: skládání bajtů pak vyhodí jen na chybě kódu.
  if (vadaVstupu(vstup) !== null) return { ok: false, reason: 'malformed' };
  const bytes = deviceRequestSigningBytes(vstup);

  if (publicKeyHex === null) return { ok: false, reason: 'unknown-kid' };
  const pk = publicKeyHex.toLowerCase();
  if (pk.length !== PUBKEY_BYTES * 2 || !HEX_RE.test(pk) || !pk.startsWith('04') || kidZKlice(pk) !== parsed.kid)
    return { ok: false, reason: 'credential-unusable' };

  if (!ctx.crypto.ecdsaP256Verify) return { ok: false, reason: 'verifier-incapable' };
  if (!ctx.crypto.ecdsaP256Verify(hexToBytes(pk), bytes, parsed.signature))
    return { ok: false, reason: 'bad-sig' };

  if (Math.abs(ctx.now - parsed.ts) > ctx.windowSec) return { ok: false, reason: 'ts-window' };
  if (!ctx.claimNonce(parsed.kid, parsed.nonceHex)) return { ok: false, reason: 'replay' };
  return { ok: true, reason: 'ok', kid: parsed.kid };
}
