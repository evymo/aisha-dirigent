/**
 * Seznam klientů, kterým `/mcp` věří, je POVINNÁ hodnota prostředí — služba ho v kódu nemá.
 *
 * ⛔ Do 2026-10-04 nesl `config.ts` výchozí výčet (`?? 'aisha-app,aisha-dirigent-device'`)
 * a compose jádra službě proměnnou nepředával: platil výčet z kódu, druhý domov vedle
 * deklarace realmu. Hodnotu skládá `aisha-env-doctor` z deklarovaných klientů (pravidlo
 * v scripts/lib/povoleni-klienti.mjs) a doručuje ji compose; když nedorazí, služba se
 * odmítne spustit stejně jako u ostatních povinných hodnot (`requireEnv`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('KC_ALLOWED_CLIENTS je povinná — služba si seznam klientů nedosazuje', () => {
  let puvodni: string | undefined;

  beforeEach(() => {
    puvodni = process.env.KC_ALLOWED_CLIENTS;
    vi.resetModules();
  });

  afterEach(() => {
    if (puvodni === undefined) delete process.env.KC_ALLOWED_CLIENTS;
    else process.env.KC_ALLOWED_CLIENTS = puvodni;
  });

  it('bez proměnné se konfigurace nenačte — služba nenastartuje', async () => {
    delete process.env.KC_ALLOWED_CLIENTS;
    await expect(import('../config.js')).rejects.toThrow(/KC_ALLOWED_CLIENTS není nastavená/);
  });

  it.each([
    ['prázdná', ''],
    ['jen mezery', '   '],
  ])('%s hodnota je totéž co chybějící — nenastartuje', async (_popis, hodnota) => {
    process.env.KC_ALLOWED_CLIENTS = hodnota;
    await expect(import('../config.js')).rejects.toThrow(/KC_ALLOWED_CLIENTS není nastavená/);
  });

  // Kotva: s doručenou hodnotou se konfigurace načte a nese právě doručená jména.
  it('kotva: doručená hodnota se načte — jména bez mezer, nic navíc', async () => {
    process.env.KC_ALLOWED_CLIENTS = 'priklad-klienta, jiny-klient';
    const { config } = await import('../config.js');
    expect(config.kcAllowedClients).toEqual(['priklad-klienta', 'jiny-klient']);
  });

  it('seznam bez jediného jména projde startem prázdný — a prázdný seznam nevěří nikomu', async () => {
    process.env.KC_ALLOWED_CLIENTS = ' , ';
    const { config } = await import('../config.js');
    // Že prázdný seznam odmítne každý token, měří auth-helpers.unit.test.ts.
    expect(config.kcAllowedClients).toEqual([]);
  });
});
