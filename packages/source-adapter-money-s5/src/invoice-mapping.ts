/**
 * Mapping from Money S5 `IssuedInvoice` (vydaná faktura) + items onto the
 * source-agnostic `DocumentRecord`. All Money-specific field-name knowledge lives
 * HERE (the seam) so nothing downstream learns Money's schema.
 *
 * Same header shape as the delivery-note mapper (see mapping.ts) — an invoice adds
 * the FINANCIAL block (`DocumentRecord.financial`) and party identity
 * (`DocumentRecord.party`, IČO/DIČ), which a delivery note leaves undefined.
 *
 * Field provenance (docs/MONEY_S5_API.md — verified against a live instance):
 *   VERIFIED (present in the probe's HLAVICKA, checked against /GraphQLDoc):
 *     CisloDokladu, DatumVystaveni, Stav, VariabilniSymbol, SumaZaklad, SumaDan,
 *     SumaCelkem, Mena{Nazev}, AdresaNazev, Firma{Nazev,ICO,DIC,Email}, Polozky{…}
 *   ASSUMED — CONFIRM LIVE against /GraphQLDoc before relying on these:
 *     DatumSplatnosti (invoice due date) and CisloObjednavky (order/PO ref, the
 *     invoice→delivery-note join key). Both are conventional Money S5 fields but
 *     are NOT in the verified delivery-note set. GraphQL fails the whole query
 *     (Status≠1) on an unknown field, so if introspection shows a different name,
 *     edit the single line marked [ASSUMED] below — nothing else changes.
 */
import type {
  DocumentRecord,
  DocumentFinancials,
  DocumentParty,
  DocumentReferences,
} from '@aisha/audience-types';

/**
 * GraphQL selection set feeding mapIssuedInvoice — keep in sync with the mapper.
 * `DatumSplatnosti` is the one [ASSUMED] field (see file header).
 */
export const INVOICE_FIELDS = `
  ID
  CisloDokladu
  DatumVystaveni
  DatumSplatnosti
  DatumUhrady
  CisloObjednavky
  Stav
  VariabilniSymbol
  SumaZaklad
  SumaDan
  SumaCelkem
  Mena { Nazev }
  AdresaNazev
  Firma { Nazev ICO DIC Email }
  Polozky {
    Poradi
    Nazev
    Katalog
    Mnozstvi
    Jednotka
    JednCena
    CelkovaCena
  }
`;

interface RawItem {
  Nazev?: string | null;
  Mnozstvi?: number | string | null;
  Jednotka?: string | null;
  Katalog?: string | null;
  CelkovaCena?: number | string | null;
}

export interface RawInvoice {
  ID?: string | null;
  CisloDokladu?: string | null;
  DatumVystaveni?: string | null;
  DatumSplatnosti?: string | null;
  DatumUhrady?: string | null;
  CisloObjednavky?: string | null;
  Stav?: string | null;
  VariabilniSymbol?: string | null;
  SumaZaklad?: number | string | null;
  SumaDan?: number | string | null;
  SumaCelkem?: number | string | null;
  Mena?: { Nazev?: string | null } | null;
  AdresaNazev?: string | null;
  Firma?: { Nazev?: string | null; ICO?: string | null; DIC?: string | null; Email?: string | null } | null;
  Polozky?: RawItem[] | null;
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function nonEmpty(v: string | null | undefined): string | null {
  return v !== undefined && v !== null && v !== '' ? v : null;
}

/** ISO datetime → date (YYYY-MM-DD), or null when absent. */
function isoDate(v: string | null | undefined): string | null {
  const d = (v ?? '').slice(0, 10);
  return d || null;
}

/**
 * Payment date → date, or null when the invoice is UNPAID. Money S5 does not
 * leave `DatumUhrady` empty on an open invoice; it writes a sentinel far in the
 * past (seen live: 1753-01-01 and 0001-01-01). Any year before 2000 is treated
 * as "never paid" so downstream sees a clean null instead of a bogus 18th-century
 * date. A real settlement date passes through unchanged.
 */
function settledDate(v: string | null | undefined): string | null {
  const d = isoDate(v);
  if (!d) return null;
  const year = Number(d.slice(0, 4));
  return Number.isFinite(year) && year >= 2000 ? d : null;
}

/** Map one Money `IssuedInvoice` to the generic DocumentRecord (with financial + party). */
export function mapIssuedInvoice(raw: RawInvoice): DocumentRecord {
  const financial: DocumentFinancials = {
    totalAmount: toNumber(raw.SumaCelkem),
    baseAmount: toNumber(raw.SumaZaklad),
    vatAmount: toNumber(raw.SumaDan),
    currency: nonEmpty(raw.Mena?.Nazev),
    variableSymbol: nonEmpty(raw.VariabilniSymbol),
    dueDate: isoDate(raw.DatumSplatnosti),
    paidDate: settledDate(raw.DatumUhrady),
    status: nonEmpty(raw.Stav),
  };
  const party: DocumentParty = {
    ico: nonEmpty(raw.Firma?.ICO),
    dic: nonEmpty(raw.Firma?.DIC),
    email: nonEmpty(raw.Firma?.Email),
  };
  const references: DocumentReferences = {
    orderRef: nonEmpty(raw.CisloObjednavky),
    variableSymbol: nonEmpty(raw.VariabilniSymbol),
  };
  return {
    externalId: raw.ID ?? '',
    documentNumber: raw.CisloDokladu ?? '',
    documentType: 'invoice',
    documentDate: isoDate(raw.DatumVystaveni),
    counterparty: nonEmpty(raw.AdresaNazev) ?? nonEmpty(raw.Firma?.Nazev) ?? null,
    lines: (raw.Polozky ?? []).map((p) => ({
      description: p.Nazev ?? '',
      quantity: toNumber(p.Mnozstvi),
      unit: nonEmpty(p.Jednotka),
      catalog: nonEmpty(p.Katalog),
      lineTotal: toNumber(p.CelkovaCena),
    })),
    financial,
    party,
    references,
    raw,
  };
}
