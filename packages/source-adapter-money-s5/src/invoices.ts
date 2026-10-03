/**
 * @aisha/source-adapter-money-s5/invoices — a second svc-source-broker plugin
 * entry over the SAME Money S5 client, serving ISSUED INVOICES (vydané faktury).
 *
 * Why a separate entry (not a second document kind on the delivery-note source):
 * the broker dispatches BY STORY (SourceRegistry) and resolves ONE binding per
 * story. Invoices are a different Money entity with a different binding/approval,
 * so they are their OWN source story with their OWN slug — this module is the
 * plugin entry the host loads for that story. It shares the client + auth plumbing
 * (source-common.ts, money-s5-client.ts); only the query + mapping differ.
 *
 * Scope (phase 1): READ of issued invoices as the generic 'document' entity, now
 * carrying `DocumentRecord.financial` (totals/VAT/currency/VS/due) + `.party`
 * (IČO/DIČ). getEntity(one) + listEntities(batch). Write-back is deferred (no
 * write method on IDataSource).
 */
import type {
  IDataSource,
  DataSourceConfig,
  EntityType,
  ScopedEntityResult,
  ActorAggregateSnapshot,
  ProbeResult,
  SourceConnection,
  DocumentRecord,
  MemberTier,
} from '@aisha/audience-types';
import { clientFor, operatorScope, UUID_RE } from './source-common.js';
import { mapIssuedInvoice, INVOICE_FIELDS, type RawInvoice } from './invoice-mapping.js';

const SLUG = 'money-s5-issued-invoices';

const GET_BY_ID = `query ($id: ID!) { IssuedInvoice(ID: $id) { ${INVOICE_FIELDS} } }`;
const LIST = `query ($from: Int, $count: Int, $changeFrom: DateTime) {
  IssuedInvoices(From: $from, Count: $count, ChangeFrom: $changeFrom) { ${INVOICE_FIELDS} }
}`;

/**
 * Lookup-by-document-number safety. Money's server-side `Filter` grammar is not
 * yet verified (docs/MONEY_S5_API.md), so we page CLIENT-side and match
 * CisloDokladu. The cap exists to bound the scan; hitting it WITHOUT exhausting
 * the evidence is a fail-LOUD, never a silent null — a silent partial miss could
 * make a caller believe an existing invoice does not exist and issue a duplicate.
 */
const LOOKUP_PAGE = 100;
const LOOKUP_MAX_SCAN = 5000;

/**
 * Jak se pro dané spojení vyrobí klient. Výchozí je přímé spojení na Money;
 * nasazení, které tunel nevlastní, si sem podstrčí klienta přes `svc-money`
 * (jeden tunel, jeden vlastník — viz `svc-money-client.ts`).
 *
 * Mapování ani stránkování se tím NEDUPLIKUJE: mění se jen to, KUDY dotaz jde.
 */
export type ClientFactory = (
  connection: SourceConnection,
  slug: string,
  fetchImpl?: typeof fetch,
) => ReturnType<typeof clientFor>;

class MoneyS5IssuedInvoiceSource implements IDataSource {
  constructor(
    private readonly fetchImpl?: typeof fetch,
    private readonly vyrobKlienta: ClientFactory = clientFor,
  ) {}

  readonly config: DataSourceConfig = {
    slug: SLUG,
    displayName: 'Money (Seyfor S5) — issued invoices',
    version: '0.1.0',
    capabilities: ['batch-pull'],
    authKind: 'oauth2',
  };

  async initialize(): Promise<void> {
    // Stateless — every read is handed a freshly-resolved SourceConnection.
  }

  // Invoices are documents, not ActorAggregateSnapshots — clean no-op batch path.
  // eslint-disable-next-line require-yield
  async *fetchAggregateSnapshots(): AsyncIterable<ActorAggregateSnapshot> {
    return;
  }

  async getEntity<T = unknown>(
    entityType: EntityType,
    externalId: string,
    callerContext: { userId: string; tier: MemberTier },
    sourceConnection?: SourceConnection,
  ): Promise<ScopedEntityResult<T>> {
    const scope = operatorScope(callerContext);
    if (entityType !== 'document') {
      return { entity: null, callerScope: { ...scope, allowedReason: 'unsupported_entity_type' } };
    }
    if (!sourceConnection) throw new Error(`money-s5: getEntity requires a resolved SourceConnection`);
    const client = this.vyrobKlienta(sourceConnection, SLUG, this.fetchImpl);

    if (UUID_RE.test(externalId)) {
      const data = await client.graphql<{ IssuedInvoice: RawInvoice | null }>(GET_BY_ID, { id: externalId });
      const note = data.IssuedInvoice ?? null;
      return { entity: (note ? (mapIssuedInvoice(note) as unknown as T) : null), callerScope: scope };
    }

    // Lookup by human invoice number (e.g. QR scan / VS) — paged, fail-loud on cap.
    const found = await this.findByNumber(client, externalId);
    return { entity: (found ? (found as unknown as T) : null), callerScope: scope };
  }

  async listEntities(
    entityType: EntityType,
    sourceConnection: SourceConnection,
    opts?: { since?: Date; limit?: number; offset?: number },
  ): Promise<DocumentRecord[]> {
    if (entityType !== 'document') return [];
    const client = this.vyrobKlienta(sourceConnection, SLUG, this.fetchImpl);
    const data = await client.graphql<{ IssuedInvoices: RawInvoice[] | null }>(LIST, {
      from: opts?.offset ?? 0,
      count: opts?.limit ?? 50,
      changeFrom: opts?.since ? opts.since.toISOString() : null,
    });
    return (data.IssuedInvoices ?? []).map(mapIssuedInvoice);
  }

  /**
   * Page through issued invoices matching CisloDokladu. Returns the mapped record,
   * or null only when the evidence is EXHAUSTED (a short page) without a match.
   * Throws if the scan cap is reached while pages are still full — a bounded scan
   * that cannot prove absence must not pretend the invoice is absent.
   */
  private async findByNumber(
    client: ReturnType<typeof clientFor>,
    documentNumber: string,
  ): Promise<DocumentRecord | null> {
    for (let from = 0; from < LOOKUP_MAX_SCAN; from += LOOKUP_PAGE) {
      const data = await client.graphql<{ IssuedInvoices: RawInvoice[] | null }>(LIST, {
        from,
        count: LOOKUP_PAGE,
        changeFrom: null,
      });
      const page = data.IssuedInvoices ?? [];
      const hit = page.find((inv) => inv.CisloDokladu === documentNumber);
      if (hit) return mapIssuedInvoice(hit);
      if (page.length < LOOKUP_PAGE) return null; // exhausted — genuinely not found
    }
    throw new Error(
      `money-s5: invoice '${documentNumber}' not found within ${LOOKUP_MAX_SCAN}-row scan cap ` +
        `and the evidence was not exhausted — refusing a silent miss (use the GUID, or a ` +
        `verified server-side Filter). See docs/MONEY_S5_API.md.`,
    );
  }

  async probe(): Promise<ProbeResult> {
    return { status: 'healthy', checkedAt: new Date().toISOString() };
  }

  async shutdown(): Promise<void> {
    /* stateless */
  }
}

/**
 * SourceAdapterModule entry — the broker's plugin-host imports this module and
 * calls createDataSource() with no args. `opts.fetchImpl` lets a host inject an
 * SSRF-guarded fetch (and unit tests a stub) without changing the zero-arg contract.
 */
export function createDataSource(opts?: {
  fetchImpl?: typeof fetch;
  clientFactory?: ClientFactory;
}): IDataSource {
  return new MoneyS5IssuedInvoiceSource(opts?.fetchImpl, opts?.clientFactory);
}

/** Named alias for direct wiring / tests. */
export const createInvoiceDataSource = createDataSource;

export { mapIssuedInvoice, INVOICE_FIELDS } from './invoice-mapping.js';
