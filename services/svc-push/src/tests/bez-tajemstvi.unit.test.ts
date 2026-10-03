/**
 * Unit testy — kód se do push oznámení nedostane.
 *
 * Zadání majitele: „kód ne, ten pošleme přes telegram, jen upozornění v pushce."
 *
 * Co se tu drží:
 *   1. jména, která tajemství ZNAMENAJÍ, stráž zastaví
 *   2. ⛔ jména, která tajemství jen PŘIPOMÍNAJÍ (`step_code`, `country_code`),
 *      projdou — jinak by stráž zakázala legitimní data a obcházela se výjimkami
 *   3. stráž nepadá na prázdném ani nestandardním vstupu
 */
import { describe, it, expect } from 'vitest';
import { zkontrolujPayloadBezTajemstvi, KodVPushiError } from '../lib/bez-tajemstvi.js';

const KDE = 'test';

describe('zkontrolujPayloadBezTajemstvi', () => {
  it.each([
    ['code', { code: '123456' }],
    ['kod', { kod: '4821' }],
    ['otp', { otp: '99887' }],
    ['pin', { pin: '0000' }],
    ['knock_code', { knock_code: 'abc123', type: 'knock' }],
    ['verification_code', { verification_code: '55' }],
    ['heslo', { heslo: 'tajne' }],
    ['device_token', { device_token: 'eyJ…' }],
    ['api_secret', { api_secret: 'x' }],
  ])('⛔ zastaví klíč %s', (klic, payload) => {
    expect(() => zkontrolujPayloadBezTajemstvi(payload, KDE)).toThrowError(KodVPushiError);
    try {
      zkontrolujPayloadBezTajemstvi(payload, KDE);
    } catch (e) {
      expect((e as KodVPushiError).klic).toBe(klic);
      expect((e as Error).message).toContain('Telegram');
    }
  });

  it('legitimní data projdou — jméno tajemství jen PŘIPOMÍNÁ', () => {
    // `step_code` nese skutečné upozornění na krok workflow; kdyby ho stráž
    // zakázala, začaly by se psát výjimky a přestala by platit.
    const payload = {
      type: 'workflow_step',
      step_code: 'predani',
      country_code: 'CZ',
      locale_code: 'cs',
      link: '/kroky',
      count: '2',
    };
    expect(() => zkontrolujPayloadBezTajemstvi(payload, KDE)).not.toThrow();
  });

  it('upozornění na změnu kódu projde, dokud nenese kód', () => {
    // Přesně ten tvar, který se má posílat: pozvánka k akci, obsah jinde.
    const payload = { type: 'knock_code_changed', link: '/dvere' };
    expect(() => zkontrolujPayloadBezTajemstvi(payload, KDE)).not.toThrow();
  });

  it('prázdný a nestandardní vstup stráž nerozbije', () => {
    expect(() => zkontrolujPayloadBezTajemstvi(undefined, KDE)).not.toThrow();
    expect(() => zkontrolujPayloadBezTajemstvi(null, KDE)).not.toThrow();
    expect(() => zkontrolujPayloadBezTajemstvi('řetězec', KDE)).not.toThrow();
    expect(() => zkontrolujPayloadBezTajemstvi({}, KDE)).not.toThrow();
  });

  it('velikost písmen a mezery nepomohou', () => {
    expect(() => zkontrolujPayloadBezTajemstvi({ ' OTP ': '1' }, KDE)).toThrowError(KodVPushiError);
    expect(() => zkontrolujPayloadBezTajemstvi({ Code: '1' }, KDE)).toThrowError(KodVPushiError);
  });
});
