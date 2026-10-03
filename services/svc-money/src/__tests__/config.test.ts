/**
 * Kontrakt prostředí — tajemství JEN z env, nic v obrazu, prázdno ≠ nastaveno.
 */
import { describe, it, expect } from 'vitest';
import { loadConfig, parseAgendas, configDefects } from '../config.js';

const AGENDY = JSON.stringify([
  { key: 'MN', label: 'Moravská nemovitostní a.s.', port: 87, clientId: 'a', clientSecret: 'b' },
]);

const UPLNE: NodeJS.ProcessEnv = {
  MONEY_HOST: '192.168.83.10',
  VPN_PROFILE_B64: Buffer.from('remote 1.2.3.4 443\n').toString('base64'),
  VPN_AUTH_USER: 'u',
  VPN_AUTH_PASS: 'p',
  MONEY_AGENDAS: AGENDY,
};

describe('konfigurace je fail-closed', () => {
  it('úplné prostředí projde', () => {
    expect(loadConfig(UPLNE).agendas).toHaveLength(1);
    expect(configDefects(UPLNE)).toEqual([]);
  });

  it('⭐ chybějící tajemství NEMÁ výchozí hodnotu — služba to řekne, ne mlčí', () => {
    for (const k of ['MONEY_HOST', 'VPN_PROFILE_B64', 'VPN_AUTH_USER',
                     'VPN_AUTH_PASS', 'MONEY_AGENDAS']) {
      const bez = { ...UPLNE };
      delete bez[k];
      expect(() => loadConfig(bez), `bez ${k} se konfigurace nesmí tvářit jako platná`).toThrow(k);
    }
  });

  it('prázdný řetězec se počítá jako chybějící', () => {
    expect(() => loadConfig({ ...UPLNE, VPN_AUTH_USER: '   ' })).toThrow(/VPN_AUTH_USER/);
  });

  it('vypnutý tunel nevyžaduje profil (lokální zkouška proti běžícímu tunelu)', () => {
    const bez: NodeJS.ProcessEnv = { ...UPLNE, VPN_ENABLED: 'false' };
    delete bez.VPN_PROFILE_B64;
    delete bez.VPN_AUTH_USER;
    expect(loadConfig(bez).vpn.enabled).toBe(false);
  });

  it('⛔ chybějící VPN_ENABLED NENÍ „vypnuto" — tunel se musí vypnout výslovně', () => {
    expect(loadConfig(UPLNE).vpn.enabled).toBe(true);
  });
});

describe('agendy', () => {
  it('nevalidní JSON je chyba se jménem proměnné', () => {
    expect(() => parseAgendas('{neni json')).toThrow(/MONEY_AGENDAS/);
  });

  it('prázdné pole agend je chyba — služba bez agendy nemá co dělat', () => {
    expect(() => parseAgendas('[]')).toThrow(/neprázdné/);
  });

  it('⭐ dvě agendy na TÉMŽ portu = chyba (port je jediný rozlišovač)', () => {
    const dve = JSON.stringify([
      { key: 'A', label: 'A s.r.o.', port: 87, clientId: 'x', clientSecret: 'y' },
      { key: 'B', label: 'B s.r.o.', port: 87, clientId: 'x', clientSecret: 'y' },
    ]);
    expect(() => parseAgendas(dve)).toThrow(/port 87/);
  });

  it('chybějící label je chyba — jde do owner_company', () => {
    const bez = JSON.stringify([{ key: 'A', port: 87, clientId: 'x', clientSecret: 'y' }]);
    expect(() => parseAgendas(bez)).toThrow(/label/);
  });

  it('neplatný port se odmítne, ne dosadí', () => {
    const spatny = JSON.stringify([
      { key: 'A', label: 'A', port: 'osmdesatsedm', clientId: 'x', clientSecret: 'y' },
    ]);
    expect(() => parseAgendas(spatny)).toThrow(/port/);
  });

  it('agenda bez pověření je chyba', () => {
    const bez = JSON.stringify([{ key: 'A', label: 'A', port: 87, clientId: '', clientSecret: '' }]);
    expect(() => parseAgendas(bez)).toThrow(/clientId/);
  });
});

describe('⛔ prázdná číselná proměnná NESMÍ projít jako NaN', () => {
  // NAMĚŘENO 2026-08-29 na produkci: `VPN_IDLE_MS=` (doručená, ale PRÁZDNÁ).
  // `??` chytá jen null/undefined, takže prázdný řetězec prošel a
  // `parseInt('')` dal NaN. `NaN <= 0` je false → přeskočila se i ochrana
  // „nula = drž trvale" → `setTimeout(…, NaN)` = 0 → tunel se ZAVŘEL IHNED
  // po každém dotazu. Další dotaz trefil openvpn uprostřed vypínání a hlásil
  // „openvpn skončil, aniž by cesta naběhla" nebo `fetch failed`.
  // Vypadalo to na zavřené porty u dodavatele. Bylo to prázdno u nás.
  const zaklad = {
    MONEY_HOST: '10.0.0.1',
    MONEY_AGENDAS: JSON.stringify([{ key: 'a', label: 'A', port: 81, clientId: 'i', clientSecret: 's' }]),
    VPN_ENABLED: 'false',
  } as NodeJS.ProcessEnv;

  it('prázdno = VÝCHOZÍ hodnota, ne NaN', () => {
    const cfg = loadConfig({ ...zaklad, VPN_IDLE_MS: '' });
    expect(Number.isFinite(cfg.vpn.idleMs), 'NaN by tunel zavíral okamžitě').toBe(true);
    expect(cfg.vpn.idleMs).toBe(300_000);
  });

  it('chybějící = VÝCHOZÍ hodnota', () => {
    expect(loadConfig({ ...zaklad }).vpn.idleMs).toBe(300_000);
  });

  it('platné číslo se respektuje (i nula = drž trvale)', () => {
    expect(loadConfig({ ...zaklad, VPN_IDLE_MS: '0' }).vpn.idleMs).toBe(0);
    expect(loadConfig({ ...zaklad, VPN_IDLE_MS: '60000' }).vpn.idleMs).toBe(60_000);
  });

  it('strop života výpůjčky: výchozí 15 min, nula a záporné padají', () => {
    expect(loadConfig({ ...zaklad }).vpn.leaseTtlMs).toBe(900_000);
    expect(loadConfig({ ...zaklad, VPN_LEASE_TTL_MS: '' }).vpn.leaseTtlMs).toBe(900_000);
    expect(loadConfig({ ...zaklad, VPN_LEASE_TTL_MS: '60000' }).vpn.leaseTtlMs).toBe(60_000);
    expect(() => loadConfig({ ...zaklad, VPN_LEASE_TTL_MS: '0' }), 'bez stropu = únik').toThrow(/VPN_LEASE_TTL_MS/);
    expect(() => loadConfig({ ...zaklad, VPN_LEASE_TTL_MS: '-5' })).toThrow(/VPN_LEASE_TTL_MS/);
  });

  it('⛔ NEPRÁZDNÝ nesmysl padá NAHLAS, nedosazuje se potichu', () => {
    expect(() => loadConfig({ ...zaklad, VPN_IDLE_MS: 'pet minut' })).toThrow(/VPN_IDLE_MS/);
  });

  it('táž ochrana u ostatních číselných proměnných', () => {
    expect(loadConfig({ ...zaklad, MONEY_REQUEST_TIMEOUT_MS: '' }).requestTimeoutMs).toBe(60_000);
    expect(loadConfig({ ...zaklad, MONEY_PAGE_SIZE: '' }).pageSize).toBe(500);
    expect(loadConfig({ ...zaklad, VPN_CONNECT_RETRY_MAX: '' }).vpn.connectRetryMax).toBe(3);
  });
});
