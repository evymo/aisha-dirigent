import { describe, expect, it } from 'vitest';
import { clientIpFrom, jeDuveryhodna, normalizeIp, parseChain, parseTrusted } from '../client-ip.js';

const PROXY = parseTrusted(['10.0.0.0/8', '172.16.0.0/12', '203.0.113.7']);

describe('normalizeIp — srovnání zápisů', () => {
  it('nechá holou IPv4 být', () => {
    expect(normalizeIp('1.2.3.4')).toBe('1.2.3.4');
  });

  it('odřízne port u IPv4', () => {
    expect(normalizeIp('1.2.3.4:51820')).toBe('1.2.3.4');
  });

  it('rozbalí IPv4 mapovanou do IPv6 — jinak by porovnání se seznamem proxy tiše míjelo', () => {
    expect(normalizeIp('::ffff:10.0.0.1')).toBe('10.0.0.1');
    expect(normalizeIp('::FFFF:10.0.0.1')).toBe('10.0.0.1');
  });

  it('sundá hranaté závorky a port u IPv6', () => {
    expect(normalizeIp('[2001:db8::1]:443')).toBe('2001:db8::1');
  });

  it('zahodí adresu s oktetem nad 255 — „skoro adresa" se neopravuje', () => {
    expect(normalizeIp('1.2.3.400')).toBeNull();
  });

  it('zahodí prázdno a nesmysl', () => {
    expect(normalizeIp('')).toBeNull();
    expect(normalizeIp('   ')).toBeNull();
    expect(normalizeIp('unknown')).toBeNull();
  });
});

describe('parseTrusted / jeDuveryhodna', () => {
  it('CIDR chytí adresu uvnitř rozsahu a mine tu vně', () => {
    expect(jeDuveryhodna('10.42.0.9', PROXY)).toBe(true);
    expect(jeDuveryhodna('172.18.0.3', PROXY)).toBe(true);
    expect(jeDuveryhodna('192.168.1.1', PROXY)).toBe(false);
  });

  it('přesná adresa se pozná', () => {
    expect(jeDuveryhodna('203.0.113.7', PROXY)).toBe(true);
    expect(jeDuveryhodna('203.0.113.8', PROXY)).toBe(false);
  });

  it('nečitelný záznam v seznamu se zahodí, ne aby shodil zbytek', () => {
    const t = parseTrusted(['nesmysl', '10.0.0.0/33', '10.0.0.0/8', '']);
    expect(jeDuveryhodna('10.1.2.3', t)).toBe(true);
    expect(jeDuveryhodna('11.1.2.3', t)).toBe(false);
  });

  it('/0 znamená „všechno" a musí se tak chovat', () => {
    expect(jeDuveryhodna('8.8.8.8', parseTrusted(['0.0.0.0/0']))).toBe(true);
  });
});

describe('clientIpFrom — klient se bere ZPRAVA', () => {
  it('⛔ podvržená položka zleva NESMÍ vyhrát (to je celý důvod téhle funkce)', () => {
    // Návštěvník si pošle vlastní hlavičku; naše proxy k ní připíše jeho adresu.
    const hlavicka = '1.2.3.4, 198.51.100.20, 10.0.0.5';
    expect(clientIpFrom(hlavicka, PROXY)).toBe('198.51.100.20');
    // Kontrolně: stará („zleva") logika by vrátila právě tu vymyšlenou.
    expect(hlavicka.split(',')[0].trim()).toBe('1.2.3.4');
  });

  it('jedna proxy v cestě: klient je položka před ní', () => {
    expect(clientIpFrom('198.51.100.20, 10.0.0.5', PROXY)).toBe('198.51.100.20');
  });

  it('bez proxy v hlavičce vrátí, co v ní je', () => {
    expect(clientIpFrom('198.51.100.20', PROXY)).toBe('198.51.100.20');
  });

  it('samé důvěryhodné proxy → null, protože klient prostě není znám', () => {
    expect(clientIpFrom('10.0.0.5, 172.18.0.3', PROXY)).toBeNull();
  });

  it('chybějící hlavička → null', () => {
    expect(clientIpFrom(undefined, PROXY)).toBeNull();
  });

  it('nečitelná hlavička → null, ne dohad', () => {
    expect(clientIpFrom('unknown, garbage', PROXY)).toBeNull();
  });

  it('hlavička jako pole je týž řetěz', () => {
    expect(clientIpFrom(['1.2.3.4', '198.51.100.20, 10.0.0.5'], PROXY)).toBe('198.51.100.20');
  });

  it('mapovaná IPv4 od proxy se pozná jako proxy', () => {
    expect(clientIpFrom('198.51.100.20, ::ffff:10.0.0.5', PROXY)).toBe('198.51.100.20');
  });

  it('⚠️ prázdný seznam proxy vrátí NAŠI proxy — fail-safe, ale pro dveře nepoužitelné', () => {
    // Zdokumentované chování: zprava se nedá nic přeskočit, takže vyjde poslední
    // položka = adresa našeho prvku. Pro rate-limit je to jen přísné (všichni
    // v jednom kbelíku), pro řízení přístupu je to fail-open a volající to musí
    // odmítnout, ne přijmout.
    expect(clientIpFrom('1.2.3.4, 198.51.100.20, 10.0.0.5', parseTrusted([]))).toBe('10.0.0.5');
  });

  it('útočník ovládá jen levý konec — ať přidá cokoli, výsledek se nezmění', () => {
    const utok = '9.9.9.9, 8.8.8.8, 7.7.7.7, 198.51.100.20, 10.0.0.5';
    expect(clientIpFrom(utok, PROXY)).toBe('198.51.100.20');
  });
});

describe('parseChain', () => {
  it('vyhodí nečitelné položky, ale pořadí zbytku zachová', () => {
    expect(parseChain('unknown, 1.2.3.4, , 10.0.0.5')).toEqual(['1.2.3.4', '10.0.0.5']);
  });
});
