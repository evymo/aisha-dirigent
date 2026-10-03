/**
 * trezor-sifra.ts — šifrování relací federovaného zdroje (ADR-004, bod 2).
 *
 * Token uživatele u zdroje má jeho plná práva (u zdroje bez expirace platí, dokud ho
 * někdo výslovně neodhlásí). Šifruje ho BROKER, ne databáze:
 *   - klíč sloupců i klíč trezoru platformy jsou v DB jako GUC (`ALTER DATABASE … SET`,
 *     `PGOPTIONS`) — čitelné relacemi se SQL; klíč v DB by token nechránil;
 *   - obecné `aisha_decrypt_column_audited` je granted authenticated a pouští admin/staff.
 * Klíč FEDERATION_VAULT_KEY žije jen v tajemstvích brokeru; do DB se nedostane nikdy
 * (brána A15). Databáze drží jen neprůhledné bajty.
 *
 * FORMÁT: 0x01 | nonce (12 B) | tag (16 B) | šifrový text
 * AAD:    `${provider}|${userId}|${sessionId}|v1` — šifrový text nejde přenést k jinému
 *         uživateli ani relaci (výměna řádků v DB = selhání ověření tagu).
 * NONCE:  náhodné 96 bitů pro KAŽDÉ šifrování. Pod jedním key_id se nesmí opakovat
 *         (opakované nonce u GCM prozradí autentizační klíč) → klíč se rotuje dřív, než
 *         pod ním proběhne 2^32 šifrování (nástroj rotace: PR C, key_id).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERZE = 0x01;
const NONCE_B = 12;
const TAG_B = 16;

export class TrezorSifraError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TrezorSifraError';
  }
}

export interface KlicTrezoru {
  readonly keyId: string;
  readonly klic: Buffer;
}

/** Klíč z prostředí brokeru. Chybějící nebo krátký klíč = chyba, žádná výchozí hodnota. */
export function klicZProstredi(env: NodeJS.ProcessEnv = process.env): KlicTrezoru {
  const hex = (env.FEDERATION_VAULT_KEY ?? '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new TrezorSifraError('FEDERATION_VAULT_KEY chybí nebo nemá 64 hex znaků (32 B)');
  }
  const keyId = (env.FEDERATION_VAULT_KEY_ID ?? '').trim() || 'k1';
  return { keyId, klic: Buffer.from(hex, 'hex') };
}

/** AAD váže šifrový text na zdroj, uživatele a relaci. */
export function aadRelace(provider: string, userId: string, sessionId: string): Buffer {
  if (!provider || !userId || !sessionId) throw new TrezorSifraError('AAD potřebuje provider, userId i sessionId');
  return Buffer.from(`${provider}|${userId}|${sessionId}|v1`, 'utf8');
}

export function zasifruj(k: KlicTrezoru, otevreny: string, aad: Buffer): Buffer {
  const nonce = randomBytes(NONCE_B);
  const c = createCipheriv('aes-256-gcm', k.klic, nonce);
  c.setAAD(aad);
  const telo = Buffer.concat([c.update(otevreny, 'utf8'), c.final()]);
  return Buffer.concat([Buffer.from([VERZE]), nonce, c.getAuthTag(), telo]);
}

export function desifruj(k: KlicTrezoru, keyIdRadku: string, blob: Buffer, aad: Buffer): string {
  if (keyIdRadku !== k.keyId) {
    throw new TrezorSifraError(`key_id relace (${keyIdRadku}) neodpovídá klíči brokeru (${k.keyId})`);
  }
  if (blob.length < 1 + NONCE_B + TAG_B || blob[0] !== VERZE) {
    throw new TrezorSifraError('šifrový text relace nemá očekávaný tvar');
  }
  const nonce = blob.subarray(1, 1 + NONCE_B);
  const tag = blob.subarray(1 + NONCE_B, 1 + NONCE_B + TAG_B);
  const telo = blob.subarray(1 + NONCE_B + TAG_B);
  const d = createDecipheriv('aes-256-gcm', k.klic, nonce);
  d.setAAD(aad);
  d.setAuthTag(tag);
  try {
    return Buffer.concat([d.update(telo), d.final()]).toString('utf8');
  } catch {
    // Chyba ověření: jiný klíč, jiná AAD (přenesený řádek) nebo pozměněné bajty.
    throw new TrezorSifraError('šifrový text relace neprošel ověřením (klíč, AAD nebo obsah)');
  }
}
