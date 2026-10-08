/**
 * Bezpečnostní knoflíky runneru: nečitelná hodnota = služba nenastartuje (fail-closed),
 * prázdno = výchozí hodnota (compose předává `${X:-}`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { celeKladneCislo, uzivatelBehu } from '../config-validace.js';

const JMENO = 'TEST_RUNNER_KNOFLIK';
afterEach(() => {
  delete process.env[JMENO];
});

describe('celeKladneCislo', () => {
  it('nenastaveno nebo prázdno → výchozí', () => {
    expect(celeKladneCislo(JMENO, 128)).toBe(128);
    process.env[JMENO] = '';
    expect(celeKladneCislo(JMENO, 128)).toBe(128);
    process.env[JMENO] = '   ';
    expect(celeKladneCislo(JMENO, 128)).toBe(128);
  });

  it('kladné celé číslo se přečte', () => {
    process.env[JMENO] = '256';
    expect(celeKladneCislo(JMENO, 128)).toBe(256);
  });

  it.each(['0', '-1', 'abc', '1.5', '12a', '0128'])('%j → výjimka (ne tiché dosazení)', (v) => {
    process.env[JMENO] = v;
    expect(() => celeKladneCislo(JMENO, 128)).toThrow(JMENO);
  });

  it('nad horní mezí → výjimka', () => {
    process.env[JMENO] = '70000';
    expect(() => celeKladneCislo(JMENO, 3031, 65535)).toThrow(/≤ 65535/);
  });
});

describe('uzivatelBehu', () => {
  it('nenastaveno → výchozí; číselné uid[:gid] projde', () => {
    expect(uzivatelBehu(JMENO, '1000')).toBe('1000');
    process.env[JMENO] = '10001:10001';
    expect(uzivatelBehu(JMENO, '1000')).toBe('10001:10001');
  });

  it.each(['0', 'root', 'node', '0:0', '1000:0', '-5'])('%j → výjimka (root nebo jméno)', (v) => {
    process.env[JMENO] = v;
    expect(() => uzivatelBehu(JMENO, '1000')).toThrow(/root/);
  });

  it('výchozí hodnota, která sama není bezpečná, se odmítne taky', () => {
    expect(() => uzivatelBehu(JMENO, 'root')).toThrow();
  });
});

describe('config runneru — povinné bezpečnostní hodnoty (2026-10-06, volba A)', () => {
  it('bez BROKER_PROXY_ALIAS runner NENASTARTUJE (žádná „vypnutá proxy → broker přímo“); kotva: s aliasem ano', async () => {
    vi.resetModules();
    vi.stubEnv('BROKER_PROXY_ALIAS', '');
    await expect(import('../config.js')).rejects.toThrow(/BROKER_PROXY_ALIAS/);
    vi.resetModules();
    vi.stubEnv('BROKER_PROXY_ALIAS', 'inst-plugin-broker');
    const { config } = await import('../config.js');
    expect(config.brokerProxyAlias).toBe('inst-plugin-broker');
    vi.unstubAllEnvs();
  });

  it('nečitelný BROKER_PROXY_PORT nebo uživatel root → runner NENASTARTUJE', async () => {
    for (const [k, v] of [['BROKER_PROXY_PORT', 'abc'], ['BROKER_PROXY_PORT', '70000'], ['EXEC_RUN_USER', '0'], ['CLAUDE_RUN_USER', 'root'], ['EXEC_PIDS_LIMIT', '0']] as const) {
      vi.resetModules();
      vi.stubEnv(k, v);
      await expect(import('../config.js'), `${k}=${v}`).rejects.toThrow(k);
      vi.unstubAllEnvs();
    }
  });
});
