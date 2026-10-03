/**
 * Ověření rámce — a klasifikace důvodů, proč byl odmítnut.
 *
 * Pořadí kontrol je součást návrhu, ne detail implementace: od nejlevnějšího
 * zahození k nejdražšímu, a hlavně tak, aby se dalo z DŮVODU odmítnutí poznat,
 * jestli odesílatel drží klíč. Na tom stojí rozhodnutí, koho zabanovat.
 */
import { timingSafeEquals, hexToBytes } from './bytes.js';
import type { KnockCrypto } from './crypto.js';
import { VER_DEVICE, type DecodedFrame } from './frame.js';
import { totp } from './otp.js';

/** Minimum, pod které se materiál pověření nesmí dostat. */
export const MIN_HMAC_BYTES = 32;
export const MIN_SEED_BYTES = 16;
/** SEC1 nekomprimovaný bod P-256: 0x04 || X(32) || Y(32). */
export const PUBKEY_BYTES = 65;

/**
 * `kid` zařízení SE ODVOZUJE Z KLÍČE, negeneruje se náhodně.
 *
 * ⛔ BYDLÍ TO TADY, PROTOŽE TO POTŘEBUJÍ OBĚ STRANY. Telefon si takhle pojmenuje
 * sám sebe, roster musí pod týmž jménem najít veřejný klíč — a kdyby si to každá
 * strana odvozovala po svém, rozešly by se první úpravou a projevilo by se to
 * jako `unknown-kid`, tedy MLČENÍM k nerozeznání od zavřených dveří.
 *
 * ⛔ NÁHODNÉ `kid` BY ROZBILO SCHVALOVÁNÍ. Jedno zařízení by mohlo vystupovat
 * pod víc identitami; schvaluje se KLÍČ, ne jméno, které si zařízení vymyslelo.
 * Otisk je 16 hex znaků veřejného klíče (za předponou `04`), tedy 64 bitů —
 * na roster o desítkách položek bezpečné.
 */
export function kidZKlice(publicKeyHex: string): string {
  return `dev-${publicKeyHex.slice(2, 18)}`;
}

export interface Operator {
  hmacKeyHex: string;
  otpSeedHex: string;
  /** Povinné a neprázdné — chybějící seznam by znamenal „jakýkoli scope". */
  scopes: string[];
  /** Nepovinné omezení, ze kterých adres smí tenhle kid otevírat. */
  allowedIps?: string[];
  /**
   * Veřejný klíč zařízení, SEC1 nekomprimovaný (0x04 || X || Y = 65 B).
   * Platí JEN pro `kind: 'device'` a nahrazuje `hmacKeyHex`/`otpSeedHex`.
   */
  publicKeyHex?: string;
  kind?: 'person' | 'device';
  device?: string;
  ownedBy?: string;
}

/**
 * Proč je pověření nepoužitelné. Prázdné pole = v pořádku.
 *
 * ⛔ Prázdný nebo krátký klíč NENÍ „volnější nastavení", je to CHYBĚJÍCÍ vstup.
 * HMAC s prázdným klíčem je pořád platný HMAC, takže se nic nerozbije a nic
 * nezakřičí — a kdokoli bez jakéhokoli tajemství projde (změřeno na PoC
 * 2026-08-04, sonda B). Proto se to kontroluje dvakrát: při zavedení i před
 * každým ověřením.
 */
export function operatorDefects(kid: string, op: Partial<Operator> | undefined): string[] {
  const bad: string[] = [];
  const hex = (v: unknown): string | null =>
    typeof v === 'string' && /^[0-9a-fA-F]*$/.test(v) ? v : null;

  // ── PRŮKAZ VER 2 ─────────────────────────────────────────────────────────
  // ⛔ ROZLIŠUJE PŘÍTOMNÝ MATERIÁL, NE `kind`. `kind: 'device'` už význam MÁ:
  // zařízení se serverem vydanými náhodnými HMAC klíči (`freshDeviceSecrets`,
  // `knock-roster.mjs --device`), tedy VER 1. Kdyby se rozlišovalo podle něj,
  // předefinovalo by se existující jméno na nový význam a KAŽDÉ dosud zavedené
  // zařízení by se rázem stalo vadným — tiše, bez jediné změny v datech.
  // Naměřeno 2026-09-02: sedm testů VER 1 na tom padlo.
  if (op?.publicKeyHex != null) {
    const pk = hex(op?.publicKeyHex);
    if (pk === null) bad.push(`${kid}: publicKeyHex chybí nebo není hex`);
    else if (pk.length !== PUBKEY_BYTES * 2)
      bad.push(`${kid}: publicKeyHex má ${pk.length / 2} B, čeká se ${PUBKEY_BYTES} (SEC1 0x04||X||Y)`);
    else if (!pk.toLowerCase().startsWith('04'))
      bad.push(`${kid}: publicKeyHex není nekomprimovaný bod (chybí 0x04)`);

    // ⛔ TOHLE JE TA VLASTNOST, KVŮLI KTERÉ VER 2 EXISTUJE. Kdyby zařízení mělo
    // vedle veřejného klíče i `hmacKeyHex` nebo `otpSeedHex`, znamenalo by to, že
    // server DRŽÍ tajemství, kterým se dá za to zařízení zaťukat — a „klíč nikdy
    // neopustil telefon" by bylo tvrzení, které data popírají. Kontroluje se to,
    // protože slib, který nikdo neměří, se dřív nebo později poruší při migraci.
    if (op?.hmacKeyHex != null)
      bad.push(`${kid}: zařízení NESMÍ mít hmacKeyHex — sdílené tajemství ruší smysl VER 2`);
    if (op?.otpSeedHex != null)
      bad.push(`${kid}: zařízení NESMÍ mít otpSeedHex — sdílené tajemství ruší smysl VER 2`);

    if (!Array.isArray(op?.scopes) || op.scopes.length === 0)
      bad.push(`${kid}: scopes musí být neprázdný seznam (chybějící seznam by znamenal „jakýkoli scope")`);
    return bad;
  }

  const h = hex(op?.hmacKeyHex);
  const s = hex(op?.otpSeedHex);
  if (h === null) bad.push(`${kid}: hmacKeyHex chybí nebo není hex`);
  else if (h.length / 2 < MIN_HMAC_BYTES)
    bad.push(`${kid}: hmacKeyHex má ${h.length / 2} B, minimum je ${MIN_HMAC_BYTES}`);
  if (s === null) bad.push(`${kid}: otpSeedHex chybí nebo není hex`);
  else if (s.length / 2 < MIN_SEED_BYTES)
    bad.push(`${kid}: otpSeedHex má ${s.length / 2} B, minimum je ${MIN_SEED_BYTES}`);
  if (!Array.isArray(op?.scopes) || op.scopes.length === 0)
    bad.push(`${kid}: scopes musí být neprázdný seznam (chybějící seznam by znamenal „jakýkoli scope")`);
  return bad;
}

export type VerifyReason =
  | 'ok' | 'unknown-kid' | 'operator-unusable' | 'bad-hmac'
  | 'ts-window' | 'replay' | 'bad-otp' | 'scope-denied'
  /** VER 2: podpis nesedí k veřejnému klíči zařízení. Analogie `bad-hmac`. */
  | 'bad-sig'
  /** Rámec je jiné verze, než pověření umí ověřit (člověk × zařízení). */
  | 'ver-mismatch'
  /** Ověřovatel nemá čím podpis zkontrolovat — chybějící schopnost, ne vada rámce. */
  | 'verifier-incapable';

/**
 * Důvody odmítnutí, které PROKAZUJÍ držení klíče.
 *
 * ⭐ Plyne to z POŘADÍ kontrol níž, ne z domněnky:
 *   unknown-kid → operator-unusable → ver-mismatch → bad-hmac│bad-sig
 *     → ts-window → replay → bad-otp → scope-denied
 * Cokoli za `bad-hmac`/`bad-sig` je dosažitelné až POTÉ, co podpis prošel — HMAC
 * se ověřuje klíčem z rosteru v konstantním čase, podpis veřejným klíčem zařízení.
 * Kdo klíč nemá, se sem nedostane; padne dřív.
 *
 * ⛔ `bad-sig` v seznamu ZÁMĚRNĚ NENÍ — je to analogie `bad-hmac`, tedy důvod,
 * který držení klíče NEPROKAZUJE. `verifier-incapable` tam taky nepatří: to je
 * vada NAŠE, ne odesílatelova, a banovat za ni by trestalo oprávněného.
 *
 * ⇒ Tyhle důvody NESMÍ vést k banu. Jinak by se zařízení s rozejitými hodinami
 * nebo se zastaralým kódem zabanovalo SAMO — a to je přesně okamžik, kdy mu
 * potřebujeme pomoct, ne zavřít dveře.
 */
export const REASONS_PROVING_KEY: readonly VerifyReason[] = Object.freeze([
  'ts-window',    // rozejité hodiny nebo pomalá síť
  'replay',       // už jsme to viděli — držitel klíče, jen opakuje
  'bad-otp',      // platný klíč, neplatný kód → tady se posílá nový
  'scope-denied', // má klíč, nemá právo na tenhle rozsah — jiná věc než útok
]);

export function provesKeyPossession(reason: string): boolean {
  return (REASONS_PROVING_KEY as readonly string[]).includes(reason);
}

/**
 * Zaslouží si tenhle důvod doručení nového kódu?
 *
 * JEN `bad-otp` a `ts-window` — obojí znamená „klíč sedí, kód ne". `replay` ne:
 * držitel právě něco poslal dvakrát a nový kód mu nepomůže. `scope-denied` taky
 * ne: nemá PRÁVO, a to se novým kódem neřeší.
 */
export function deservesFreshCode(reason: string): boolean {
  return reason === 'bad-otp' || reason === 'ts-window';
}

export interface VerifyContext {
  crypto: KnockCrypto;
  operators: Record<string, Operator>;
  now: number;
  windowSec: number;
  otpStep: number;
  otpDigits: number;
  otpSkew?: number;
  /** Vrací true, když už tenhle nonce byl. Chybí-li, anti-replay se NEDĚLÁ. */
  nonceSeen?: (nonce: string) => boolean;
}

export function verifyFrame(
  frame: DecodedFrame,
  ctx: VerifyContext,
): { ok: boolean; reason: VerifyReason } {
  const op = ctx.operators[frame.kid];
  if (!op) return { ok: false, reason: 'unknown-kid' };

  // Druhá obrana: i kdyby vadné pověření prošlo zavedením, tady se nedostane
  // dál. Musí to být PŘED HMACem — jinak by prázdný klíč prošel jako platný podpis.
  if (operatorDefects(frame.kid, op).length) return { ok: false, reason: 'operator-unusable' };

  // ── Rámec a pověření se musí shodnout ve VERZI ───────────────────────────
  // ⛔ Křížení je vada, ne varianta: rámec člověka ověřený klíčem zařízení (nebo
  // naopak) by znamenalo, že jedna z těch dvou cest se dá obejít druhou.
  // Rozhoduje MATERIÁL, ne popiska — viz `operatorDefects`.
  const maVerejnyKlic = op.publicKeyHex != null;
  const ramecZarizeni = frame.ver === VER_DEVICE;
  if (maVerejnyKlic !== ramecZarizeni) return { ok: false, reason: 'ver-mismatch' };

  if (ramecZarizeni) {
    // Ověřovatel bez asymetrické operace NESMÍ propustit — a NESMÍ ani mlčky
    // spadnout do HMAC větve. Chybějící schopnost je vlastní důvod, aby bylo
    // z logu poznat „nemám čím" od „podpis nesedí".
    if (!ctx.crypto.ecdsaP256Verify) return { ok: false, reason: 'verifier-incapable' };
    const pub = hexToBytes(op.publicKeyHex ?? '');
    if (!ctx.crypto.ecdsaP256Verify(pub, frame.signed, frame.tag))
      return { ok: false, reason: 'bad-sig' };
  } else {
    const key = hexToBytes(op.hmacKeyHex ?? '');
    const expect = ctx.crypto.hmacSha256(key, frame.signed);
    if (!timingSafeEquals(frame.tag, expect)) return { ok: false, reason: 'bad-hmac' };
  }

  if (Math.abs(ctx.now - frame.ts) > ctx.windowSec) return { ok: false, reason: 'ts-window' };

  if (ctx.nonceSeen && ctx.nonceSeen(frame.nonce)) return { ok: false, reason: 'replay' };

  // ⭐ OTP se u zařízení PŘESKAKUJE, protože v rámci VER 2 není (viz `VER_DEVICE`).
  // Není to úleva: podpis kryje `TS` i `NONCE`, takže opakování řeší kontroly výš.
  if (ramecZarizeni) {
    if (!op.scopes.includes(frame.scope)) return { ok: false, reason: 'scope-denied' };
    return { ok: true, reason: 'ok' };
  }

  const seed = hexToBytes(op.otpSeedHex ?? '');
  const skew = ctx.otpSkew ?? 1;
  let otpOk = false;
  for (let d = -skew; d <= skew; d++) {
    if (totp(ctx.crypto, seed, frame.ts + d * ctx.otpStep, ctx.otpStep, ctx.otpDigits) === frame.otp) {
      otpOk = true;
      break;
    }
  }
  if (!otpOk) return { ok: false, reason: 'bad-otp' };

  // Seznam je povinný (viz operatorDefects), takže „chybí" znamená DENY,
  // ne „jakýkoli scope".
  if (!op.scopes.includes(frame.scope)) return { ok: false, reason: 'scope-denied' };

  return { ok: true, reason: 'ok' };
}
