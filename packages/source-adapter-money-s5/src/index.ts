/**
 * @aisha/source-adapter-money-s5 — a generic svc-source-broker plugin (a
 * SourceAdapterModule) for the Money (Seyfor) **S5 API**.
 *
 * Ecosystem posture: first-party connector maintained WITH the stack, delivered
 * through the broker plugin seam (plugin-host dynamic-imports the built entry and
 * calls createDataSource()). Any instance binds its OWN Money endpoint + credential
 * via the story spine (instance_endpoint_bindings → audience_resolve_source_binding);
 * nothing instance-specific lives in this package.
 *
 * Scope (phase 1): READ of operational documents ('document' entity) — delivery
 * notes. getEntity(one) + listEntities(batch). Write-back (upload a signed PDF to
 * Money) is a deferred capability — IDataSource has no write method yet.
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
import { mapDeliveryNote, DELIVERY_NOTE_FIELDS, type RawDeliveryNote } from './mapping.js';

const SLUG = 'money-s5-delivery-notes';

const GET_BY_ID = `query ($id: ID!) { IssuedDeliveryNote(ID: $id) { ${DELIVERY_NOTE_FIELDS} } }`;
const LIST = `query ($from: Int, $count: Int, $changeFrom: DateTime) {
  IssuedDeliveryNotes(From: $from, Count: $count, ChangeFrom: $changeFrom) { ${DELIVERY_NOTE_FIELDS} }
}`;

class MoneyS5DataSource implements IDataSource {
  constructor(private readonly fetchImpl?: typeof fetch) {}

  readonly config: DataSourceConfig = {
    slug: SLUG,
    displayName: 'Money (Seyfor S5) — delivery notes',
    version: '0.1.0',
    capabilities: ['batch-pull'],
    authKind: 'oauth2',
  };

  async initialize(): Promise<void> {
    // Stateless: every read is handed a freshly-resolved SourceConnection, so
    // there is nothing to open here. Credential/endpoint validity is proven on
    // the first real read (fail-loud) — same posture as probe() being conn-less.
  }

  // Delivery notes are not ActorAggregateSnapshots — the audience batch path is a
  // clean no-op here; batch document pulls go through listEntities().
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
    const client = clientFor(sourceConnection, SLUG, this.fetchImpl);

    let note: RawDeliveryNote | null;
    if (UUID_RE.test(externalId)) {
      const data = await client.graphql<{ IssuedDeliveryNote: RawDeliveryNote | null }>(GET_BY_ID, {
        id: externalId,
      });
      note = data.IssuedDeliveryNote ?? null;
    } else {
      // Lookup by human document number (QR scan): Money's Filter syntax is not yet
      // confirmed, so scan a bounded recent window and match CisloDokladu. Replace
      // with a server-side Filter once its grammar is verified.
      const list = await this.listEntities('document', sourceConnection, { limit: 200 });
      const found = list.find((d) => d.documentNumber === externalId);
      return {
        entity: (found ?? null) as T | null,
        callerScope: scope,
      };
    }

    return {
      entity: (note ? (mapDeliveryNote(note) as unknown as T) : null),
      callerScope: scope,
    };
  }

  async listEntities(
    entityType: EntityType,
    sourceConnection: SourceConnection,
    opts?: { since?: Date; limit?: number; offset?: number },
  ): Promise<DocumentRecord[]> {
    if (entityType !== 'document') return [];
    const client = clientFor(sourceConnection, SLUG, this.fetchImpl);
    const data = await client.graphql<{ IssuedDeliveryNotes: RawDeliveryNote[] | null }>(LIST, {
      from: opts?.offset ?? 0,
      count: opts?.limit ?? 50,
      changeFrom: opts?.since ? opts.since.toISOString() : null,
    });
    return (data.IssuedDeliveryNotes ?? []).map(mapDeliveryNote);
  }

  async probe(): Promise<ProbeResult> {
    // Connection-less by contract (registry.probeAll passes none), so this is a
    // self health signal only; the live auth/endpoint check happens on first read.
    return { status: 'healthy', checkedAt: new Date().toISOString() };
  }

  async shutdown(): Promise<void> {
    /* stateless — nothing to close */
  }
}

/**
 * SourceAdapterModule entry — the broker's plugin-host calls this with no args
 * (global fetch). `opts.fetchImpl` lets a host inject an SSRF-guarded fetch and
 * unit tests a stub, without changing the zero-arg plugin contract.
 */
export function createDataSource(opts?: { fetchImpl?: typeof fetch }): IDataSource {
  return new MoneyS5DataSource(opts?.fetchImpl);
}

export { MoneyS5Client, MoneyApiError } from './money-s5-client.js';
export { mapDeliveryNote } from './mapping.js';
