/**
 * Pruh doporučení identit — co smí a co NESMÍ.
 * Nejdůležitější tvrzení: pruh nikdy nic nespojí (volá jen návrhovou funkci)
 * a nikdy neposílá do jádra porovnávanou hodnotu (PII zůstane v paměti).
 */
import { describe, expect, it, vi } from 'vitest';
import type { IDataSource } from '@aisha/audience-types';
import { declaredMatches, navrhniShodyIdentit, type MatchPg } from '../clients/identity-match-lane.js';

const CONN = { endpointUrl: '', authMethod: 'pg_dsn', authSecretRef: 'env:X', dataSensitivity: 'confidential' };
const DEKLARACE = [{ kind: 'email', fromSource: 'raynet', refKind: 'person.email', toSource: 'source-federation', confidence: 0.9 }];

function adapter(
  identityMatches: IDataSource['config']['identityMatches'],
  match?: (kind: string, values: string[]) => Promise<Array<{ value: string; externalId: string }>>,
): IDataSource {
  return {
    config: { slug: 'test', displayName: 't', version: '0', capabilities: [], authKind: 'pg_dsn', identityMatches },
    initialize: async () => undefined,
    fetchAggregateSnapshots: async function* () { /* nic */ },
    getEntity: async () => ({ entity: null, callerScope: { userId: '', tier: 'guest' as never, allowedReason: '' } }),
    probe: async () => ({ status: 'healthy', checkedAt: '' }),
    shutdown: async () => undefined,
    ...(match ? { matchIdentities: match } : {}),
  } as IDataSource;
}

function pg(kandidati: Array<{ ref_id: string; twin_id: string; value: string }>, navrh: (twin: string) => object =
  () => ({ state: 'proposed', already: false })) {
  const volani: Array<{ sql: string; params: unknown[] }> = [];
  const client: MatchPg = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      volani.push({ sql, params: params ?? [] });
      if (sql.includes('twin_identity_match_candidates')) return { rows: [{ items: kandidati }] } as never;
      return { rows: [{ r: navrh(String(params?.[0])) }] } as never;
    }),
  };
  return { client, volani };
}

const log = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

describe('identity-match-lane', () => {
  it('adaptér bez matchIdentities: žádné volání jádra', async () => {
    const { client, volani } = pg([]);
    const r = await navrhniShodyIdentit(adapter(DEKLARACE), CONN, client, 'src', log());
    expect(volani).toHaveLength(0);
    expect(r).toEqual({ kinds: [], proposed: 0, errors: 0 });
  });

  it('nález → NÁVRH (nikdy potvrzení) a do jádra jde jen identita, ne porovnávaná hodnota', async () => {
    const kandidati = [{ ref_id: 'r1', twin_id: 't1', value: 'jana@example.org' }];
    const { client, volani } = pg(kandidati);
    // typovaná podpis mocku: bez parametrů má `mock.calls` prázdnou n-tici a tsc padne
    const match = vi.fn(async (_kind: string, _values: string[]) => [{ value: 'jana@example.org', externalId: 'u-1' }]);
    const r = await navrhniShodyIdentit(adapter(DEKLARACE, match), CONN, client, 'zdroj-a', log());

    expect(match.mock.calls[0][0]).toBe('email');
    expect(match.mock.calls[0][1]).toEqual(['jana@example.org']);
    const zapis = volani.filter((v) => v.sql.includes('twin_identity_propose_match'));
    expect(zapis).toHaveLength(1);
    expect(zapis[0].params).toEqual(['t1', 'source-federation', 'u-1', 'primary_id', 'rule:email', 0.9]);
    // potvrzovací cesta se NIKDY nevolá
    expect(volani.some((v) => /confirm_binding|submit_evidence_review/.test(v.sql))).toBe(false);
    // hodnota (PII) se do jádra nedostane
    expect(JSON.stringify(zapis[0].params)).not.toContain('jana@example.org');
    expect(r.proposed).toBe(1);
  });

  it('zamítnutý pár se nepočítá jako návrh — lidské „ne" se nepřehlasuje', async () => {
    const { client } = pg([{ ref_id: 'r1', twin_id: 't1', value: 'a@b.cz' }], () => ({ state: 'skipped_rejected' }));
    const r = await navrhniShodyIdentit(
      adapter(DEKLARACE, async () => [{ value: 'a@b.cz', externalId: 'u-9' }]), CONN, client, 's', log());
    expect(r.kinds[0].skippedRejected).toBe(1);
    expect(r.proposed).toBe(0);
  });

  it('hodnota bez nálezu nezaloží nic; táž hodnota u dvou dvojčat dá dva návrhy', async () => {
    const { client, volani } = pg([
      { ref_id: 'r1', twin_id: 't1', value: 'spolecna@dum.cz' },
      { ref_id: 'r2', twin_id: 't2', value: 'spolecna@dum.cz' },
      { ref_id: 'r3', twin_id: 't3', value: 'nikdo@nikde.cz' },
    ]);
    const r = await navrhniShodyIdentit(
      adapter(DEKLARACE, async () => [{ value: 'spolecna@dum.cz', externalId: 'u-7' }]), CONN, client, 's', log());
    const zapis = volani.filter((v) => v.sql.includes('twin_identity_propose_match'));
    expect(zapis.map((z) => z.params[0])).toEqual(['t1', 't2']);
    expect(r.proposed).toBe(2);
  });

  it('prázdná fronta kandidátů se zdroje vůbec neptá', async () => {
    const match = vi.fn(async (_kind: string, _values: string[]) => [] as Array<{ value: string; externalId: string }>);
    const { client } = pg([]);
    const r = await navrhniShodyIdentit(adapter(DEKLARACE, match), CONN, client, 's', log());
    expect(match).not.toHaveBeenCalled();
    expect(r.kinds[0]).toMatchObject({ candidates: 0, matched: 0, proposed: 0 });
  });

  it('vadná deklarace se přeskočí a započítá jako chyba', async () => {
    const a = adapter([
      DEKLARACE[0],
      { ...DEKLARACE[0] },                                   // duplicita
      { kind: 'E-mail', fromSource: 'raynet', refKind: 'person.email', toSource: 'x' }, // špatný slug
      { kind: 'email', fromSource: 'raynet', refKind: '   ', toSource: 'x' },           // prázdný ref_kind
    ], async () => []);
    expect(declaredMatches(a)).toEqual([DEKLARACE[0]]);
    const { client } = pg([]);
    expect((await navrhniShodyIdentit(a, CONN, client, 's', log())).errors).toBe(3);
  });

  it('chyba zdroje nezastaví takt, jen se započítá', async () => {
    const { client } = pg([{ ref_id: 'r1', twin_id: 't1', value: 'a@b.cz' }]);
    const l = log();
    const r = await navrhniShodyIdentit(
      adapter(DEKLARACE, async () => { throw new Error('permission denied for table core_appuser'); }),
      CONN, client, 's', l);
    expect(r.errors).toBe(1);
    expect(r.kinds[0].error).toMatch(/permission denied/);
    expect(l.error).toHaveBeenCalled();
  });
});
