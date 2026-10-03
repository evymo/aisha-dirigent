/**
 * Drátový formát zaťukání — jedno místo pravdy pro bránu, UDP kontejner i mobil.
 *
 * Rámec (big-endian):
 *   MAGIC(4)='SPA1' | VER(1) | KIDLEN(1) | KID | TS(8, u64 sekund) | NONCE(16) |
 *   SCOPELEN(1) | SCOPE | IPFAM(1: 0=vezmi zdrojovou, 4=v4, 6=v6) | IP(0/4/16) |
 *   OTP(4, u32) | TAG(32)
 *
 * TAG = HMAC-SHA256(klíč, všechny předchozí bajty).
 *
 * ⭐ PROČ SE FORMÁT DRŽÍ, I KDYŽ TEĎ POJEDE PO HTTPS
 * První fáze doručuje rámec HTTPS dotazem, protože vynucení je zatím aplikační.
 * Fáze s tichým UDP přijde později. Kdyby se pro HTTPS zvolil jiný tvar
 * pověření, znamenal by přechod na UDP PŘEREGISTROVAT KAŽDÉ ZAŘÍZENÍ. Takhle je
 * to změna přepravy, ne změna pověření: co appka dostane dnes, bude platit i pak.
 */
import {
  concat, hexToBytes, readUint32BE, readUint64BE, utf8Decode, utf8Encode,
  writeUint32BE, writeUint64BE,
} from './bytes.js';
import type { KnockCrypto } from './crypto.js';

export const MAGIC = Uint8Array.from([0x53, 0x50, 0x41, 0x31]); // 'SPA1'
/** Člověk: tag je HMAC-SHA256 ze sdíleného tajemství odvozeného z KÓDU. */
export const VER = 1;
/**
 * Zařízení: tag je ECDSA P-256 podpis a `OTP` v rámci NENÍ.
 *
 * ⛔ OTP tu nechybí kvůli místu. `otpSeedHex` je SDÍLENÉ SYMETRICKÉ tajemství —
 * kdyby zůstalo, klíč by sice telefon neopustil, ale server by pořád držel
 * tajemství, kterým se dá za zařízení zaťukat, a celý smysl VER 2 by padl.
 * Ochranu proti opakování přitom už nese `TS` (okno) + `NONCE` (`nonceSeen`),
 * takže OTP je tu navíc i technicky.
 *
 * ⭐ Ponechat ho jako „rezervované pole" by bylo horší než ho vypustit: prázdné
 * povinné pole svádí k tomu, aby ho někdo později „opravil" zpátky k životu.
 */
export const VER_DEVICE = 2;
export const NONCE_BYTES = 16;
export const TAG_BYTES = 32;
/** ECDSA P-256 podpis v syrovém tvaru r||s — co vrací WebCrypto i Secure Enclave. */
export const SIG_BYTES = 64;

/** 0 = otevři adresu, ze které rámec přišel; 4/6 = otevři adresu uvedenou v rámci. */
export type IpFamily = 0 | 4 | 6;

export interface FrameFields {
  kid: string;
  ts: number;
  nonce: string;
  scope: string;
  ipFam: IpFamily;
  ip: string | null;
  otp: number;
}

export interface DecodedFrame extends Omit<FrameFields, 'otp'> {
  ver: number;
  /** `null` u VER 2 — zařízení OTP neposílá (viz `VER_DEVICE`). */
  otp: number | null;
  tag: Uint8Array;
  /** Bajty, které TAG podepisuje — verifikace je musí dostat přesně takhle. */
  signed: Uint8Array;
}

function ipv4ToBytes(ip: string): Uint8Array {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255))
    throw new Error(`neplatná IPv4: ${ip}`);
  return Uint8Array.from(p);
}

function bytesToIpv4(b: Uint8Array): string {
  return `${b[0]}.${b[1]}.${b[2]}.${b[3]}`;
}

export interface EncodeInput {
  kid: string;
  ts: number;
  scope: string;
  otp: number;
  /** Hex; když chybí, vygeneruje se. Předává se jen v testech a při opakování. */
  nonce?: string;
  ipFam?: IpFamily;
  /** IPv4 v tečkované podobě, IPv6 jako 32 hex znaků. */
  ip?: string | null;
}

export function encodeFrame(
  crypto: KnockCrypto,
  input: EncodeInput,
  hmacKey: Uint8Array,
): { frame: Uint8Array; nonceHex: string } {
  const { kid, ts, scope, otp, ipFam = 0 } = input;
  const kidB = utf8Encode(kid);
  const scopeB = utf8Encode(scope);
  if (kidB.length > 255) throw new Error('kid je delší než 255 bajtů');
  if (scopeB.length > 255) throw new Error('scope je delší než 255 bajtů');

  const nonceB = input.nonce ? hexToBytes(input.nonce) : crypto.randomBytes(NONCE_BYTES);
  if (nonceB.length !== NONCE_BYTES) throw new Error(`nonce musí mít ${NONCE_BYTES} bajtů`);

  // Typ se anotuje: od TS 5.7 je `Uint8Array` generický přes typ bufferu a
  // `new Uint8Array(0)` by se zúžilo na `ArrayBuffer`, kdežto `subarray`/`hexToBytes`
  // vracejí `ArrayBufferLike`. Bez anotace se to nesejde.
  let ipB: Uint8Array = new Uint8Array(0);
  if (ipFam === 4) ipB = ipv4ToBytes(input.ip ?? '');
  else if (ipFam === 6) ipB = hexToBytes(input.ip ?? '');
  if (ipFam === 6 && ipB.length !== 16) throw new Error('IPv6 musí mít 16 bajtů');

  const signed = concat(
    MAGIC,
    Uint8Array.from([VER, kidB.length]),
    kidB,
    writeUint64BE(ts),
    nonceB,
    Uint8Array.from([scopeB.length]),
    scopeB,
    Uint8Array.from([ipFam]),
    ipB,
    writeUint32BE(otp),
  );
  const tag = crypto.hmacSha256(hmacKey, signed);
  return { frame: concat(signed, tag), nonceHex: bytesToHexLocal(nonceB) };
}

/**
 * Rámec ZAŘÍZENÍ (VER 2). Tělo se skládá stejně jako u VER 1, jen bez `OTP`
 * a s podpisem místo HMACu.
 *
 * ⛔ NEBERE KLÍČ, BERE FUNKCI. Kdyby tahle funkce přijímala soukromý klíč,
 * musel by ho volající odněkud vytáhnout — a tvrzení „klíč nikdy neopustí
 * telefon" by popíral vlastní kód. `podepis` je proto callback: na telefonu ho
 * obslouží Secure Enclave, která podepíše a klíč nevydá. Balíček se tak k
 * soukromé půlce nedostane ANI TYPOVĚ, natož omylem.
 *
 * `podepis` dostane přesně ty bajty, které má podpis krýt, a vrací 64 B (r||s).
 */
export function encodeFrameDevice(
  crypto: KnockCrypto,
  input: Omit<EncodeInput, 'otp'>,
  podepis: (zprava: Uint8Array) => Uint8Array,
): { frame: Uint8Array; nonceHex: string } {
  const { kid, ts, scope, ipFam = 0 } = input;
  const kidB = utf8Encode(kid);
  const scopeB = utf8Encode(scope);
  if (kidB.length > 255) throw new Error('kid je delší než 255 bajtů');
  if (scopeB.length > 255) throw new Error('scope je delší než 255 bajtů');

  const nonceB = input.nonce ? hexToBytes(input.nonce) : crypto.randomBytes(NONCE_BYTES);
  if (nonceB.length !== NONCE_BYTES) throw new Error(`nonce musí mít ${NONCE_BYTES} bajtů`);

  let ipB: Uint8Array = new Uint8Array(0);
  if (ipFam === 4) ipB = ipv4ToBytes(input.ip ?? '');
  else if (ipFam === 6) ipB = hexToBytes(input.ip ?? '');
  if (ipFam === 6 && ipB.length !== 16) throw new Error('IPv6 musí mít 16 bajtů');

  const signed = concat(
    MAGIC,
    Uint8Array.from([VER_DEVICE, kidB.length]),
    kidB,
    writeUint64BE(ts),
    nonceB,
    Uint8Array.from([scopeB.length]),
    scopeB,
    Uint8Array.from([ipFam]),
    ipB,
  );
  const sig = podepis(signed);
  // Délka se kontroluje TADY, ne až u ověřovatele: rámec se špatně dlouhým
  // podpisem by se dal odeslat a selhal by až na druhé straně, kde už není
  // vidět, co ho vyrobilo.
  if (sig.length !== SIG_BYTES)
    throw new Error(`podpis musí mít ${SIG_BYTES} bajtů, dostal ${sig.length}`);
  return { frame: concat(signed, sig), nonceHex: bytesToHexLocal(nonceB) };
}

function bytesToHexLocal(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s;
}

/**
 * Rozebere rámec. Při jakékoli odchylce hodí výjimku — nečitelný rámec se
 * NEDOPLŇUJE domněnkou o tom, co asi odesílatel myslel.
 */
export function decodeFrame(buf: Uint8Array): DecodedFrame {
  let o = 0;
  const need = (n: number): void => {
    if (o + n > buf.length) throw new Error('rámec je useknutý');
  };

  need(4);
  for (let i = 0; i < 4; i++) if (buf[i] !== MAGIC[i]) throw new Error('cizí značka rámce');
  o += 4;

  need(1);
  const ver = buf[o++];
  // ⭐ Verze se čte DŘÍV, než se čte cokoli, co na ní závisí. Rámce se liší
  // koncem (VER 1: OTP + 32 B tag · VER 2: rovnou 64 B podpis), takže tudy
  // vede jediná větev a nedá se „doplnit domněnkou".
  if (ver !== VER && ver !== VER_DEVICE) throw new Error(`neznámá verze rámce: ${ver}`);

  need(1);
  const kidLen = buf[o++];
  need(kidLen);
  const kid = utf8Decode(buf.subarray(o, o + kidLen));
  o += kidLen;

  need(8);
  const ts = readUint64BE(buf, o);
  o += 8;

  need(NONCE_BYTES);
  const nonce = bytesToHexLocal(buf.subarray(o, o + NONCE_BYTES));
  o += NONCE_BYTES;

  need(1);
  const scopeLen = buf[o++];
  need(scopeLen);
  const scope = utf8Decode(buf.subarray(o, o + scopeLen));
  o += scopeLen;

  need(1);
  const ipFamRaw = buf[o++];
  let ip: string | null = null;
  if (ipFamRaw === 4) { need(4); ip = bytesToIpv4(buf.subarray(o, o + 4)); o += 4; }
  else if (ipFamRaw === 6) { need(16); ip = bytesToHexLocal(buf.subarray(o, o + 16)); o += 16; }
  else if (ipFamRaw !== 0) throw new Error(`neznámá rodina adres: ${ipFamRaw}`);
  const ipFam = ipFamRaw as IpFamily;

  // VER 1 nese OTP, VER 2 ne — viz `VER_DEVICE`.
  let otp: number | null = null;
  if (ver === VER) {
    need(4);
    otp = readUint32BE(buf, o);
    o += 4;
  }

  const tagLen = ver === VER_DEVICE ? SIG_BYTES : TAG_BYTES;
  need(tagLen);
  const signed = buf.subarray(0, o);
  const tag = buf.subarray(o, o + tagLen);
  o += tagLen;

  // Přebytečné bajty na konci nejsou neškodné: znamenají, že se rámec skládá
  // jinak, než si myslíme, a podpis pak nekryje všechno, co dorazilo.
  if (o !== buf.length) throw new Error('za rámcem jsou přebytečné bajty');

  return { ver, kid, ts, nonce, scope, ipFam, ip, otp, tag, signed };
}
