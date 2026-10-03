/**
 * Unit tests for the Money S5 source adapter — no network, no live instance.
 * Fixtures mirror a real instance response (docs/MONEY_S5_API.md): the custom
 * `{Data,Status,RowCount}` envelope and the field names that actually carry data.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createDataSource, MoneyS5Client, MoneyApiError } from '../index';
import { mapDeliveryNote } from '../mapping';
import type { DocumentRecord } from '@aisha/audience-types';

const RAW_NOTE = {
  ID: '7e186eca-f1ab-4668-af68-0005cdca8eec',
  CisloDokladu: 'DLT23188',
  DatumVystaveni: '2023-06-28T00:00:00',
  VariabilniSymbol: '2026001',
  AdresaNazev: 'DAP. a.s.',
  Firma: null,
  // Uživatelské proměnné (`*_UserData`) — ordinary scalars per /GraphQLDoc;
  // a bare `CisloObjednavky` does NOT exist on IssuedDeliveryNote (verified live).
  JmenoRidice_UserData: 'p. Novák',
  RZVozidla_UserData: '5SH 1052',
  ObchodniJmPreprav_UserData: 'Vlastní doprava',
  StaniceUrceni_UserData: 'Praha Krčského nádraží',
  CisloObjednavky_UserData: 'OBJ-2026-42',
  Dodano_UserData: false,
  Polozky: [
    { Nazev: 'lipovská mozaika 6x6x4 cm', Mnozstvi: 271, Jednotka: 'm2', Katalog: '5101MOZ664L', IPMnozstvi: 0 },
    { Nazev: 'Doprava', Mnozstvi: 271, Jednotka: 'x', Katalog: 'dopr' },
  ],
};

const CONNECTION = {
  endpointUrl: 'http://money-s5.example.com:81',
  authMethod: 'oauth2',
  authSecretRef: 'MONEY_TEST_SECRET',
  dataSensitivity: 'confidential',
};

/** A fetch stub answering /connect/token and /graphql from a fixture envelope. */
function stubFetch(graphqlData: unknown, opts: { status?: number; envStatus?: number; message?: string } = {}) {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    calls.push(String(url));
    if (String(url).endsWith('/connect/token')) {
      return new Response(JSON.stringify({ access_token: 'tok-abc', expires_in: 3600 }), { status: 200 });
    }
    if (String(url).endsWith('/graphql')) {
      const body = JSON.stringify({
        PageCount: 1,
        RowCount: 20216,
        Data: graphqlData,
        Status: opts.envStatus ?? 1,
        Message: opts.message ?? '',
        StackTrace: '',
      });
      return new Response(body, { status: opts.status ?? 200 });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('mapDeliveryNote', () => {
  test('maps the fields that actually carry data', () => {
    const rec = mapDeliveryNote(RAW_NOTE);
    expect(rec.externalId).toBe('7e186eca-f1ab-4668-af68-0005cdca8eec');
    expect(rec.documentNumber).toBe('DLT23188');
    expect(rec.documentType).toBe('delivery_note');
    expect(rec.documentDate).toBe('2023-06-28'); // sliced from DatumVystaveni
    expect(rec.counterparty).toBe('DAP. a.s.'); // AdresaNazev, not the null Firma
    expect(rec.lines).toHaveLength(2);
    expect(rec.lines[0].quantity).toBe(271); // Mnozstvi, not IPMnozstvi(0)
    expect(rec.lines[0].unit).toBe('m2');
    expect(rec.lines[0].catalog).toBe('5101MOZ664L');
  });

  test('carries the cross-document join keys (order ref + VS) for structured matching', () => {
    const rec = mapDeliveryNote(RAW_NOTE);
    expect(rec.references?.orderRef).toBe('OBJ-2026-42'); // ← CisloObjednavky_UserData
    expect(rec.references?.variableSymbol).toBe('2026001');
  });

  test('carries transport facts verbatim (user-defined fields; the engine normalises)', () => {
    const rec = mapDeliveryNote(RAW_NOTE);
    expect(rec.transport).toEqual({
      driverName: 'p. Novák',
      vehicleRegistration: '5SH 1052', // spacing preserved — vehicle_plate_normalize is ingest's job
      carrierName: 'Vlastní doprava',
      destinationStation: 'Praha Krčského nádraží',
      delivered: false,
    });
  });

  test('whitespace-only user fields read as null, missing delivered flag reads as null', () => {
    const rec = mapDeliveryNote({
      ...RAW_NOTE,
      JmenoRidice_UserData: '',
      RZVozidla_UserData: '  ',
      Dodano_UserData: undefined,
    });
    expect(rec.transport?.driverName).toBeNull();
    expect(rec.transport?.vehicleRegistration).toBeNull();
    expect(rec.transport?.delivered).toBeNull();
    // an unbound document is still a valid document — nothing else degrades
    expect(rec.documentNumber).toBe('DLT23188');
  });
});

describe('MoneyS5Client', () => {
  test('token uses client_credentials + scope=S5Api, then parses the envelope', async () => {
    const bodies: string[] = [];
    const impl = (async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/connect/token')) {
        bodies.push(String(init?.body));
        return new Response(JSON.stringify({ access_token: 't', expires_in: 60 }), { status: 200 });
      }
      return new Response(JSON.stringify({ Data: { Version: '1.15.2.7500' }, Status: 1 }), { status: 200 });
    }) as unknown as typeof fetch;

    const client = new MoneyS5Client({ baseUrl: 'http://h:81', credentials: { clientId: 'cid', clientSecret: 'sec' }, fetchImpl: impl });
    const data = await client.graphql<{ Version: string }>('{ Version }');
    expect(data.Version).toBe('1.15.2.7500');
    expect(bodies[0]).toMatch(/grant_type=client_credentials/);
    expect(bodies[0]).toMatch(/scope=S5Api/);
    expect(bodies[0]).toMatch(/client_id=cid/);
  });

  test('non-1 Status throws MoneyApiError (not a silent empty)', async () => {
    const { impl } = stubFetch(null, { envStatus: 3, message: 'boom' });
    const client = new MoneyS5Client({ baseUrl: 'http://h:81', credentials: { clientId: 'c', clientSecret: 's' }, fetchImpl: impl });
    await expect(client.graphql('{ x }')).rejects.toThrow(MoneyApiError);
    await expect(client.graphql('{ x }')).rejects.toThrow(/boom/);
  });
});

describe('MoneyS5DataSource (via createDataSource)', () => {
  beforeEach(() => {
    process.env.MONEY_TEST_SECRET = 'cid:sec';
  });
  afterEach(() => {
    delete process.env.MONEY_TEST_SECRET;
  });

  test('getEntity(document, GUID) returns a mapped DocumentRecord', async () => {
    const { impl, calls } = stubFetch({ IssuedDeliveryNote: RAW_NOTE });
    const ds = createDataSource({ fetchImpl: impl });
    const res = await ds.getEntity('document', RAW_NOTE.ID, { userId: 'operator', tier: 'admin' as never }, CONNECTION);
    const rec = res.entity as DocumentRecord;
    expect(rec.documentNumber).toBe('DLT23188');
    expect(rec.counterparty).toBe('DAP. a.s.');
    expect(res.callerScope.allowedReason).toBe('operator_source_read');
    expect(calls.some((c) => c.endsWith('/connect/token'))).toBe(true);
    expect(calls.some((c) => c.endsWith('/graphql'))).toBe(true);
  });

  test('listEntities(document) maps a batch', async () => {
    const { impl } = stubFetch({ IssuedDeliveryNotes: [RAW_NOTE, { ...RAW_NOTE, CisloDokladu: 'DLD23384' }] });
    const ds = createDataSource({ fetchImpl: impl });
    const list = await ds.listEntities!('document', CONNECTION, { limit: 10 });
    expect(list).toHaveLength(2);
    expect(list[1].documentNumber).toBe('DLD23384');
  });

  test('unsupported entity type is a clean null, not a throw', async () => {
    const ds = createDataSource();
    const res = await ds.getEntity('actor', 'x', { userId: 'o', tier: 'admin' as never }, CONNECTION);
    expect(res.entity).toBeNull();
    expect(res.callerScope.allowedReason).toBe('unsupported_entity_type');
  });

  test('missing secret ref fails loud', async () => {
    delete process.env.MONEY_TEST_SECRET;
    const ds = createDataSource();
    await expect(
      ds.getEntity('document', RAW_NOTE.ID, { userId: 'o', tier: 'admin' as never }, CONNECTION),
    ).rejects.toThrow(/secret ref env 'MONEY_TEST_SECRET' is empty/);
  });
});
