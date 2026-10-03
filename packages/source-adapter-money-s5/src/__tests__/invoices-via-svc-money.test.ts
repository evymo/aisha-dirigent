/**
 * Faktury přes `svc-money` — jeden tunel, jeden vlastník.
 *
 * Měří se dvě věci, které se nesmějí rozejít:
 *   1. dotaz jde na `svc-money`, ne přímo na Money (jinak by broker potřeboval
 *      vlastní tunel a protistrana nesnese souběžná sezení téhož účtu);
 *   2. agenda se NEODVOZUJE — Money rozlišuje firmy portem a dosadit „tu první"
 *      by tiše smíchalo doklady dvou firem.
 */
import { describe, expect, it, vi } from 'vitest';
import { createDataSource, agendaZEndpointu } from '../invoices-via-svc-money.js';
import type { SourceConnection } from '@aisha/audience-types';

const SPOJENI = (endpointUrl: string): SourceConnection => ({
  endpointUrl,
  authMethod: 'oauth2',
  authSecretRef: null,
  dataSensitivity: 'internal',
});

describe('agenda se čte z endpointu, nedosazuje', () => {
  it('platný tvar vydá klíč agendy', () => {
    expect(agendaZEndpointu('svc-money://moravska-nemovitostni-a-s')).toBe('moravska-nemovitostni-a-s');
    expect(agendaZEndpointu('svc-money://irisa/')).toBe('irisa');
  });

  it.each(['', '   ', 'http://192.168.83.10:87', 'svc-money://'])(
    'neplatný tvar %j SELŽE NAHLAS (nedosadí se nic)',
    (vstup) => {
      expect(
        () => agendaZEndpointu(vstup),
        'tichá výchozí agenda by smíchala doklady dvou firem — to je horší než pád',
      ).toThrow();
    },
  );
});

describe('dotaz jde přes svc-money, ne přímo na Money', () => {
  it('volá /query na SVC_MONEY_URL a nese klíč agendy', async () => {
    process.env.SVC_MONEY_URL = 'http://stack-svc-money:3016';
    process.env.SVC_MONEY_API_TOKEN = 'TOKEN_KE_SLUZBE';

    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ Data: { IssuedInvoices: [] }, RowCount: 0, Status: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const zdroj = createDataSource({ fetchImpl });
    await zdroj.listEntities('document', SPOJENI('svc-money://irisa'), { limit: 5 });

    const volani = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(volani.length, 'musí se sáhnout právě jednou').toBe(1);
    const [url, init] = volani[0] as [string, RequestInit];
    expect(url, 'cíl je svc-money, ne Money').toBe('http://stack-svc-money:3016/query');

    const telo = JSON.parse(String(init.body));
    expect(telo.agenda, 'agenda musí jít s dotazem — jinak neví, KTERÁ firma').toBe('irisa');
    expect(String(telo.query), 'ptáme se na vystavené faktury').toContain('IssuedInvoices');
    expect(
      String((init.headers as Record<string, string>).authorization),
      'pověření je KE SLUŽBĚ, ne k Money',
    ).toBe('Bearer TOKEN_KE_SLUZBE');
  });
});
