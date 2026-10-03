/**
 * Mapping from Money S5 `IssuedDeliveryNote` (and its items) onto the
 * source-agnostic `DocumentRecord`. All the Money-specific field-name knowledge
 * lives HERE (the seam) so nothing downstream learns Money's schema.
 *
 * Field choices verified against a live instance (docs/MONEY_S5_API.md):
 *   - counterparty ← `AdresaNazev` (the relation `Firma` is null in data; the
 *     name is the denormalised address snapshot on the header)
 *   - quantity     ← `Mnozstvi`   (NOT `IPMnozstvi` — that is intrastat, ~0)
 *   - date         ← `DatumVystaveni`
 *
 * USER-DEFINED FIELDS (`*_UserData`): Money exposes per-agenda „Uživatelské
 * proměnné" as ordinary GraphQL scalars suffixed `_UserData`. The names come
 * from the instance's own schema documentation (`/GraphQLDoc`, graphdoc export —
 * introspection is disabled) and were verified live (probe doc `DLT23188`:
 * driver, plate, carrier, destination station, order no., delivered flag all
 * readable). A bare `CisloObjednavky` does NOT exist on this type — the order
 * reference lives ONLY as the user field, which is why `references.orderRef`
 * reads `CisloObjednavky_UserData`.
 *
 * Linking keys (DocumentRecord.references) let a delivery note be joined to its
 * invoice deterministically (shared order ref) over the STRUCTURED pull — not only
 * over OCR docs. `VariabilniSymbol` is verified (probe HLAVICKA).
 *
 * Transport facts go out VERBATIM (`DocumentRecord.transport`) — plate spacing
 * and name variants are the ingest engine's normalisation job
 * (`vehicle_plate_normalize`), never the adapter's.
 *
 * `delivered` ← `Dodano_UserData` is the source's OWN handover flag and it is
 * measured `false` on all 20 566 documents — NOT because the field is unused,
 * but because nothing has written to it yet: this is the field the platform will
 * flip to true once a driver confirms the handover (write-back, next step). It is
 * therefore mapped and read as a fact of the source, never derived: while the
 * write-back is not live, `false` means "no confirmation has been recorded in
 * Money", which is exactly what it says. Once write-back ships, a document
 * arriving with `true` is the source telling us the handover already happened —
 * so a consumer must treat it as state to reconcile against, not as a default.
 */
import type { DocumentRecord, DocumentReferences, DocumentTransport } from '@aisha/audience-types';

/** GraphQL selection set that feeds mapDeliveryNote — keep in sync with the mapper. */
export const DELIVERY_NOTE_FIELDS = `
  ID
  CisloDokladu
  DatumVystaveni
  VariabilniSymbol
  AdresaNazev
  Firma { Nazev }
  JmenoRidice_UserData
  RZVozidla_UserData
  ObchodniJmPreprav_UserData
  StaniceUrceni_UserData
  CisloObjednavky_UserData
  Dodano_UserData
  Polozky {
    Nazev
    Mnozstvi
    Jednotka
    Katalog
  }
`;

interface RawItem {
  Nazev?: string | null;
  Mnozstvi?: number | string | null;
  Jednotka?: string | null;
  Katalog?: string | null;
}

export interface RawDeliveryNote {
  ID?: string | null;
  CisloDokladu?: string | null;
  DatumVystaveni?: string | null;
  VariabilniSymbol?: string | null;
  AdresaNazev?: string | null;
  Firma?: { Nazev?: string | null } | null;
  JmenoRidice_UserData?: string | null;
  RZVozidla_UserData?: string | null;
  ObchodniJmPreprav_UserData?: string | null;
  StaniceUrceni_UserData?: string | null;
  CisloObjednavky_UserData?: string | null;
  Dodano_UserData?: boolean | null;
  Polozky?: RawItem[] | null;
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function nonEmpty(v: string | null | undefined): string | null {
  return v !== undefined && v !== null && v.trim() !== '' ? v : null;
}

/** Map one Money `IssuedDeliveryNote` to the generic DocumentRecord. */
export function mapDeliveryNote(raw: RawDeliveryNote): DocumentRecord {
  const references: DocumentReferences = {
    orderRef: nonEmpty(raw.CisloObjednavky_UserData),
    variableSymbol: nonEmpty(raw.VariabilniSymbol),
  };
  const transport: DocumentTransport = {
    driverName: nonEmpty(raw.JmenoRidice_UserData),
    vehicleRegistration: nonEmpty(raw.RZVozidla_UserData),
    carrierName: nonEmpty(raw.ObchodniJmPreprav_UserData),
    destinationStation: nonEmpty(raw.StaniceUrceni_UserData),
    delivered: typeof raw.Dodano_UserData === 'boolean' ? raw.Dodano_UserData : null,
  };
  return {
    externalId: raw.ID ?? '',
    documentNumber: raw.CisloDokladu ?? '',
    documentType: 'delivery_note',
    documentDate: (raw.DatumVystaveni ?? '').slice(0, 10) || null,
    counterparty: nonEmpty(raw.AdresaNazev) ?? nonEmpty(raw.Firma?.Nazev) ?? null,
    lines: (raw.Polozky ?? []).map((p) => ({
      description: p.Nazev ?? '',
      quantity: toNumber(p.Mnozstvi),
      unit: nonEmpty(p.Jednotka),
      catalog: nonEmpty(p.Katalog),
      // Delivery notes are non-monetary — no per-line price is queried, so the
      // realised value lives on the matching invoice, not here.
      lineTotal: null,
    })),
    references,
    transport,
    raw,
  };
}
