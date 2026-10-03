/**
 * Unit tests for the Money S5 ISSUED-INVOICE source adapter — no network, no live
 * instance. Fixtures mirror the real `{Data,Status,RowCount}` envelope and the S5
 * field names that carry invoice data (docs/MONEY_S5_API.md). Focus areas beyond
 * the delivery-note adapter: the FINANCIAL block, party identity, and the
 * fail-LOUD paged lookup that must never return a silent partial miss.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createInvoiceDataSource, mapIssuedInvoice } from '../invoices';
import type { DocumentRecord } from '@aisha/audience-types';

const RAW_INVOICE = {
  ID: '9f2c1e77-aaaa-4bbb-8ccc-000000000001',
  CisloDokladu: 'FV2026001',
  DatumVystaveni: '2026-01-15T00:00:00',
  DatumSplatnosti: '2026-01-29T00:00:00',
  CisloObjednavky: 'OBJ-2026-42',
  Stav: 'Vystaveno',
  VariabilniSymbol: '2026001',
  SumaZaklad: 10000,
  SumaDan: 2100,
  SumaCelkem: 12100,
  Mena: { Nazev: 'CZK' },
  AdresaNazev: 'DAP. a.s.',
  Firma: { Nazev: 'DAP a.s.', ICO: '12345678', DIC: 'CZ12345678', Email: 'faktury@dap.cz' },
  Polozky: [
    { Poradi: 1, Nazev: 'Dlažba', Katalog: 'DL01', Mnozstvi: 100, Jednotka: 'm2', JednCena: 100, CelkovaCena: 10000 },
  ],
};

const CONNECTION = {
  endpointUrl: 'http://money-s5.example.com:81',
  authMethod: 'oauth2',
  authSecretRef: 'MONEY_TEST_SECRET',
  dataSensitivity: 'confidential',
};

interface GqlReq {
  query: string;
  variables: { id?: string; from?: number; count?: number; changeFrom?: string | null };
}

/**
 * A fetch stub answering /connect/token and /graphql. `handler(vars, query)`
 * returns the Data payload for each GraphQL call, so a test can page or vary by ID.
 */
function stubFetch(handler: (vars: GqlReq['variables'], query: string) => unknown) {
  const calls: string[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push(String(url));
    if (String(url).endsWith('/connect/token')) {
      return new Response(JSON.stringify({ access_token: 'tok-abc', expires_in: 3600 }), { status: 200 });
    }
    if (String(url).endsWith('/graphql')) {
      const req = JSON.parse(String(init?.body)) as GqlReq;
      const data = handler(req.variables ?? {}, req.query);
      return new Response(
        JSON.stringify({ PageCount: 1, RowCount: 20216, Data: data, Status: 1, Message: '', StackTrace: '' }),
        { status: 200 },
      );
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('mapIssuedInvoice', () => {
  test('maps header, financial totals, party identity and lines', () => {
    const rec = mapIssuedInvoice(RAW_INVOICE);
    expect(rec.documentType).toBe('invoice');
    expect(rec.documentNumber).toBe('FV2026001');
    expect(rec.documentDate).toBe('2026-01-15');
    expect(rec.counterparty).toBe('DAP. a.s.');
    // financial block
    expect(rec.financial?.totalAmount).toBe(12100);
    expect(rec.financial?.baseAmount).toBe(10000);
    expect(rec.financial?.vatAmount).toBe(2100);
    expect(rec.financial?.currency).toBe('CZK');
    expect(rec.financial?.variableSymbol).toBe('2026001');
    expect(rec.financial?.dueDate).toBe('2026-01-29');
    // no DatumUhrady on this fixture → unpaid (paidDate null), NOT a fabricated date
    expect(rec.financial?.paidDate).toBeNull();
    expect(rec.financial?.status).toBe('Vystaveno');
    // party identity (IČO/DIČ — for matching to a customer)
    expect(rec.party?.ico).toBe('12345678');
    expect(rec.party?.dic).toBe('CZ12345678');
    expect(rec.party?.email).toBe('faktury@dap.cz');
    // cross-document join keys (order ref → delivery note, VS → bank statement)
    expect(rec.references?.orderRef).toBe('OBJ-2026-42');
    expect(rec.references?.variableSymbol).toBe('2026001');
    // lines
    expect(rec.lines).toHaveLength(1);
    expect(rec.lines[0].quantity).toBe(100);
    expect(rec.lines[0].unit).toBe('m2');
    expect(rec.lines[0].catalog).toBe('DL01');
    // per-line value (Money `CelkovaCena`) → realised price per unit downstream
    expect(rec.lines[0].lineTotal).toBe(10000);
  });

  test('paidDate: real DatumUhrady passes through, sentinel past-date → null (unpaid)', () => {
    // A settled invoice carries a real payment date.
    const paid = mapIssuedInvoice({ ...RAW_INVOICE, DatumUhrady: '2026-02-10T00:00:00' });
    expect(paid.financial?.paidDate).toBe('2026-02-10');
    // Money S5 writes a far-past sentinel (not empty) on an OPEN invoice — map it to
    // null so "unpaid" is not mistaken for "paid in 1753".
    for (const sentinel of ['1753-01-01T00:00:00', '0001-01-01T00:00:00']) {
      const open = mapIssuedInvoice({ ...RAW_INVOICE, DatumUhrady: sentinel });
      expect(open.financial?.paidDate).toBeNull();
    }
  });

  test('tolerates missing money/party fields (nullable, no throw)', () => {
    const rec = mapIssuedInvoice({ ID: 'x', CisloDokladu: 'FV2', DatumVystaveni: '2026-02-01T00:00:00' });
    expect(rec.financial?.totalAmount).toBeNull();
    expect(rec.financial?.currency).toBeNull();
    expect(rec.financial?.dueDate).toBeNull();
    expect(rec.party?.ico).toBeNull();
    expect(rec.lines).toHaveLength(0);
  });
});

describe('MoneyS5IssuedInvoiceSource (via createInvoiceDataSource)', () => {
  beforeEach(() => {
    process.env.MONEY_TEST_SECRET = 'cid:sec';
  });
  afterEach(() => {
    delete process.env.MONEY_TEST_SECRET;
  });

  test('getEntity(document, GUID) returns a mapped invoice with financial block', async () => {
    const { impl, calls } = stubFetch((vars) => ({ IssuedInvoice: vars.id === RAW_INVOICE.ID ? RAW_INVOICE : null }));
    const ds = createInvoiceDataSource({ fetchImpl: impl });
    const res = await ds.getEntity('document', RAW_INVOICE.ID, { userId: 'operator', tier: 'admin' as never }, CONNECTION);
    const rec = res.entity as DocumentRecord;
    expect(rec.documentNumber).toBe('FV2026001');
    expect(rec.financial?.totalAmount).toBe(12100);
    expect(res.callerScope.allowedReason).toBe('operator_source_read');
    expect(calls.some((c) => c.endsWith('/connect/token'))).toBe(true);
    expect(calls.some((c) => c.endsWith('/graphql'))).toBe(true);
  });

  test('listEntities(document) maps a batch of invoices', async () => {
    const { impl } = stubFetch(() => ({ IssuedInvoices: [RAW_INVOICE, { ...RAW_INVOICE, CisloDokladu: 'FV2026002' }] }));
    const ds = createInvoiceDataSource({ fetchImpl: impl });
    const list = await ds.listEntities!('document', CONNECTION, { limit: 10 });
    expect(list).toHaveLength(2);
    expect(list[1].documentNumber).toBe('FV2026002');
  });

  test('lookup by number finds a match on a later page (paged, not fixed window)', async () => {
    // Target sits on the 3rd page (from=200); pages before it are full and non-matching.
    const target = { ...RAW_INVOICE, CisloDokladu: 'FV2026777' };
    const filler = (from: number) =>
      Array.from({ length: 100 }, (_, i) => ({ ...RAW_INVOICE, CisloDokladu: `PAD${from + i}` }));
    const { impl } = stubFetch((vars) => {
      const from = vars.from ?? 0;
      if (from === 200) return { IssuedInvoices: [target, ...filler(from).slice(1)] };
      return { IssuedInvoices: filler(from) }; // full page → keep paging
    });
    const ds = createInvoiceDataSource({ fetchImpl: impl });
    const res = await ds.getEntity('document', 'FV2026777', { userId: 'o', tier: 'admin' as never }, CONNECTION);
    expect((res.entity as DocumentRecord).documentNumber).toBe('FV2026777');
  });

  test('lookup by number returns null only when evidence is EXHAUSTED (short page)', async () => {
    const { impl } = stubFetch((vars) => {
      const from = vars.from ?? 0;
      // First page short (< 100) → exhausted, genuinely not found.
      return { IssuedInvoices: from === 0 ? [{ ...RAW_INVOICE, CisloDokladu: 'OTHER' }] : [] };
    });
    const ds = createInvoiceDataSource({ fetchImpl: impl });
    const res = await ds.getEntity('document', 'FV_NOPE', { userId: 'o', tier: 'admin' as never }, CONNECTION);
    expect(res.entity).toBeNull();
  });

  test('lookup fails LOUD at the scan cap (never a silent partial miss → no double invoice)', async () => {
    // Every page is FULL and never matches → cap reached without exhaustion → throw.
    const { impl } = stubFetch((vars) => {
      const from = vars.from ?? 0;
      return { IssuedInvoices: Array.from({ length: 100 }, (_, i) => ({ ...RAW_INVOICE, CisloDokladu: `X${from + i}` })) };
    });
    const ds = createInvoiceDataSource({ fetchImpl: impl });
    await expect(
      ds.getEntity('document', 'FV_MISSING', { userId: 'o', tier: 'admin' as never }, CONNECTION),
    ).rejects.toThrow(/scan cap/);
  });

  test('unsupported entity type is a clean null, not a throw', async () => {
    const ds = createInvoiceDataSource();
    const res = await ds.getEntity('actor', 'x', { userId: 'o', tier: 'admin' as never }, CONNECTION);
    expect(res.entity).toBeNull();
    expect(res.callerScope.allowedReason).toBe('unsupported_entity_type');
  });

  test('missing secret ref fails loud', async () => {
    delete process.env.MONEY_TEST_SECRET;
    const ds = createInvoiceDataSource();
    await expect(
      ds.getEntity('document', RAW_INVOICE.ID, { userId: 'o', tier: 'admin' as never }, CONNECTION),
    ).rejects.toThrow(/secret ref env 'MONEY_TEST_SECRET' is empty/);
  });

  test('config declares the invoice slug + batch-pull capability', () => {
    const ds = createInvoiceDataSource();
    expect(ds.config.slug).toBe('money-s5-issued-invoices');
    expect(ds.config.capabilities).toContain('batch-pull');
    expect(ds.config.authKind).toBe('oauth2');
  });
});
