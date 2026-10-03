/**
 * trezor-sifra — šifrování relací federovaného zdroje (ADR-004, bod 2).
 * Měří VLASTNOSTI: token se vrátí jen se správným klíčem, key_id a AAD; přenesený řádek
 * (jiný uživatel / relace), pozměněné bajty i jiný klíč selžou; nonce se neopakuje;
 * šifrový text nenese otevřený token.
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { aadRelace, desifruj, klicZProstredi, TrezorSifraError, zasifruj } from '../lib/trezor-sifra.js';

const KLIC = klicZProstredi({ FEDERATION_VAULT_KEY: randomBytes(32).toString('hex'), FEDERATION_VAULT_KEY_ID: 'k7' });
const TOKEN = `sentinel-token-${randomBytes(8).toString('hex')}`;
const AAD = aadRelace('zdroj-x', 'u-1', 's-1');

describe('trezor-sifra', () => {
  it('správný klíč, key_id a AAD vrátí token (kontrola měřidla)', () => {
    expect(desifruj(KLIC, 'k7', zasifruj(KLIC, TOKEN, AAD), AAD)).toBe(TOKEN);
  });

  it('šifrový text nenese otevřený token', () => {
    expect(zasifruj(KLIC, TOKEN, AAD).includes(Buffer.from(TOKEN))).toBe(false);
  });

  it('řádek přenesený k jinému uživateli nebo relaci neprojde (AAD)', () => {
    const ct = zasifruj(KLIC, TOKEN, AAD);
    expect(() => desifruj(KLIC, 'k7', ct, aadRelace('zdroj-x', 'u-2', 's-1'))).toThrow(TrezorSifraError);
    expect(() => desifruj(KLIC, 'k7', ct, aadRelace('zdroj-x', 'u-1', 's-2'))).toThrow(TrezorSifraError);
    expect(() => desifruj(KLIC, 'k7', ct, aadRelace('zdroj-y', 'u-1', 's-1'))).toThrow(TrezorSifraError);
  });

  it('pozměněný bajt neprojde', () => {
    const ct = zasifruj(KLIC, TOKEN, AAD);
    const zmena = Buffer.from(ct);
    zmena[zmena.length - 1] ^= 0x01;
    expect(() => desifruj(KLIC, 'k7', zmena, AAD)).toThrow(TrezorSifraError);
  });

  it('jiný klíč i nesouhlasné key_id neprojdou', () => {
    const ct = zasifruj(KLIC, TOKEN, AAD);
    const jiny = klicZProstredi({ FEDERATION_VAULT_KEY: randomBytes(32).toString('hex'), FEDERATION_VAULT_KEY_ID: 'k7' });
    expect(() => desifruj(jiny, 'k7', ct, AAD)).toThrow(TrezorSifraError);
    expect(() => desifruj(KLIC, 'k6', ct, AAD)).toThrow(/key_id/);
  });

  it('nonce je pro každé šifrování nové (96 b, bez opakování na vzorku)', () => {
    const nonces = new Set<string>();
    for (let i = 0; i < 2000; i += 1) nonces.add(zasifruj(KLIC, TOKEN, AAD).subarray(1, 13).toString('hex'));
    expect(nonces.size).toBe(2000);
  });

  it('klíč z prostředí: chybějící nebo krátký = chyba, žádná výchozí hodnota', () => {
    expect(() => klicZProstredi({})).toThrow(TrezorSifraError);
    expect(() => klicZProstredi({ FEDERATION_VAULT_KEY: 'ab'.repeat(16) })).toThrow(TrezorSifraError);
    expect(klicZProstredi({ FEDERATION_VAULT_KEY: 'ab'.repeat(32) }).keyId).toBe('k1');
  });
});
