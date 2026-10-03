/**
 * Cross-document linking over the STRUCTURED Money pull. This is the F1 value: a
 * delivery note and its invoice, both mapped from Money GraphQL, expose the same
 * `references.orderRef` so a deterministic matcher (li_links / link_rules) can join
 * them WITHOUT OCR and WITHOUT semantic search. Proves the join-key parity the
 * downstream producer (F3) relies on.
 *
 * ⚠️ PARITA JMEN NENÍ PARITA VÝSKYTU: on a delivery note the order reference exists
 * ONLY as the user-defined field `CisloObjednavky_UserData` (a bare `CisloObjednavky`
 * is not on that type at all), whereas the invoice carries it under its own name.
 * The keys therefore line up — but measured over all 20 566 delivery notes the field
 * is filled in 0,3 % of them, so this join fires for a handful of documents and the
 * invoice↔delivery-note bridge stays probabilistic (IČO + time window + tonnage).
 * These tests lock the KEY PARITY, not a claim that the join covers the corpus.
 */
import { describe, test, expect } from 'vitest';
import { mapDeliveryNote } from '../mapping';
import { mapIssuedInvoice } from '../invoice-mapping';

const ORDER = 'OBJ-2026-42';

const DELIVERY = {
  ID: 'd0000000-0000-4000-8000-000000000001',
  CisloDokladu: 'DLT23188',
  DatumVystaveni: '2026-01-10T00:00:00',
  CisloObjednavky_UserData: ORDER, // ← na dodáku JEN takto (viz hlavička)
  AdresaNazev: 'DAP. a.s.',
};

const INVOICE = {
  ID: 'f0000000-0000-4000-8000-000000000002',
  CisloDokladu: 'FV2026001',
  DatumVystaveni: '2026-01-15T00:00:00',
  CisloObjednavky: ORDER,
  VariabilniSymbol: '2026001',
  SumaCelkem: 12100,
  Firma: { ICO: '12345678', DIC: 'CZ12345678' },
};

describe('structured doc↔doc join keys', () => {
  test('invoice and its delivery note share references.orderRef (the ① join)', () => {
    const dn = mapDeliveryNote(DELIVERY);
    const inv = mapIssuedInvoice(INVOICE);
    expect(dn.references?.orderRef).toBe(ORDER);
    expect(inv.references?.orderRef).toBe(ORDER);
    // the match a deterministic linker would make: same order ref, both issued docs
    expect(inv.references?.orderRef).toBe(dn.references?.orderRef);
  });

  test('invoice exposes VS for the invoice↔bank-statement join', () => {
    const inv = mapIssuedInvoice(INVOICE);
    expect(inv.references?.variableSymbol).toBe('2026001');
    // VS is also present as a financial attribute — same value, different semantics
    expect(inv.financial?.variableSymbol).toBe('2026001');
  });

  test('missing order ref degrades to null (no false-positive match on empty)', () => {
    const dn = mapDeliveryNote({ ID: 'x', CisloDokladu: 'DL2', DatumVystaveni: '2026-02-01T00:00:00' });
    const inv = mapIssuedInvoice({ ID: 'y', CisloDokladu: 'FV2', DatumVystaveni: '2026-02-02T00:00:00' });
    expect(dn.references?.orderRef).toBeNull();
    expect(inv.references?.orderRef).toBeNull();
    // two nulls must NOT be treated as a match by any downstream linker
    expect(dn.references?.orderRef === null && inv.references?.orderRef === null).toBe(true);
  });
});
