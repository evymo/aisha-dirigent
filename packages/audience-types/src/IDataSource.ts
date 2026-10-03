/**
 * IDataSource — generic interface for external data backends.
 *
 * Renamed from IConnector to reflect the architectural decision (verified):
 * source-api is a BACKEND we are a client of, not an MCP "connector".
 *
 * Pattern: each external backend has its own broker microservice (parallel
 * svc-github-app, svc-stripe, svc-packeta, svc-source-broker). This interface
 * describes the contract an ADAPTER implements. An adapter may be in-process
 * (e.g. the NullDataSource default that ships upstream so the stack runs with
 * NO external source configured) OR plugin-delivered via svc-plugin-system
 * (a fork's source — a tenant — packages its adapter as a verified,
 * capability-scoped plugin that uses the stack's capabilities). The broker
 * (svc-source-broker) hosts the IDataSourceRegistry and dispatches by slug.
 *
 * A federated source IS a story: registered as a partner_stories row,
 * materialised on an instance (story_instances), its connection endpoint +
 * credential REFERENCE in instance_endpoint_bindings (endpoint_role +
 * endpoint_url + auth_secret_ref). The broker resolves the binding via
 * public.audience_resolve_source_binding(story_id) and the secret from the ref
 * against its own secret store — no hardcoded SOURCE_PG_URL, no per-source env.
 * A source is readable only once approved (audience_admin_approve_source).
 *
 * DISPATCH IS BY STORY, NOT SLUG. Each adapter binds to exactly one story via
 * config.storyId; the registry indexes adapters by that storyId and the /source
 * routes dispatch getForStory(storyId). The slug is a human display handle only.
 * Per read the broker hands the adapter the freshly-resolved SourceConnection
 * (endpoint + credential reference), so credential rotation needs no re-register.
 */

import type { MemberTier } from './member-tier.js';

// ----------------------------------------------------------------------------
// Entity types — universal
// ----------------------------------------------------------------------------

/** Which period statistic to compute. Closed on purpose: a kind is a contract. */
export type StatKind = 'topic' | 'event';

/** One topic created in the month — mirrors the operator's CSV export columns. */
export interface TopicStatRow {
  kind: 'topic';
  month: string;                 // 'YYYY-MM'
  externalId: string;
  title: string;
  /** Čitelné jméno: jméno → e-mail → id (zdroj sám dává '<id> - <first> <last>'). */
  createdBy: string;
  /** Stabilní identita zakladatele — popisek se může měnit, tohle ne. */
  createdById: string;
  createdAt: string;             // ISO
  deleted: boolean;
  private: boolean;
  followCount: number;
  postsCount: number;
  tags: string;                  // ', '-joined tag names (source order)
}

/** One event created in the month — mirrors the operator's CSV export columns. */
export interface EventStatRow {
  kind: 'event';
  month: string;
  externalId: string;
  title: string;
  /** Čitelné jméno: e-mail → id. */
  createdBy: string;
  /** Stabilní identita zakladatele. */
  createdById: string;
  createdAt: string;
  dateFrom: string | null;
  dateTo: string | null;
  official: boolean;
  cancelled: boolean;
  online: boolean;
  followCount: number;
  tags: string;
}

export type StatRow = TopicStatRow | EventStatRow;

// ----------------------------------------------------------------------------
// Source catalogs — whole sets of source records the surface reads from the core
// ----------------------------------------------------------------------------

/**
 * Jak se katalog v jádru udržuje.
 *  - `snapshot`: adaptér vydá VŽDY CELOU množinu (nadcházející akce, místa,
 *    členové). Co ve zdroji zmizelo, zmizí i v jádru.
 *  - `series`: adaptér vydá jen přírůstek (denní snímek KPI s `externalId`
 *    = den). Starší řádky zůstávají — tak vzniká historie, kterou zdroj
 *    sám nedrží.
 */
export type SourceCatalogMode = 'snapshot' | 'series';

/**
 * Deklarace katalogu v konfiguraci adaptéru. `kind` je slug instance
 * (`^[a-z][a-z0-9_]{1,39}$`) — platforma nezná jména věcí zdroje; tvar řádků
 * promítá až pohled instance.
 */
export interface SourceCatalogDeclaration {
  kind: string;
  mode: SourceCatalogMode;
}

/**
 * Deklarace POROVNÁNÍ identit napříč světy: co z ingestu porovnat proti zdroji
 * a jak se z nálezu stane návrh vazby. Doporučení, ne vazba — potvrzení je
 * výhradně lidské (ratifikační fronta kokpitu).
 */
export interface SourceIdentityMatchDeclaration {
  /** Co se porovnává; slug instance, např. 'email'. Adaptér ho dostane v matchIdentities. */
  kind: string;
  /** Zdroj referencí, které čekají na porovnání (svět ingestu), např. 'raynet'. */
  fromSource: string;
  /** Druh reference nesoucí porovnávanou hodnotu, např. 'person.email'. */
  refKind: string;
  /** Zdroj, do kterého nález ukazuje (svět účtů), např. 'source-federation'. */
  toSource: string;
  /** Druh navržené reference; výchozí 'primary_id'. */
  toRefKind?: string;
  /** Síla důkazu 0–1 pro frontu ratifikace (řazení a text položky). */
  confidence?: number;
}

/** Hodnota pole katalogu — jen skaláry; vnořené struktury patří do jiného katalogu. */
export type SourceCatalogValue = string | number | boolean | null;

/**
 * Jeden záznam katalogu. `occurredAt` je časová osa pro pohledy (akce: začátek
 * konání; KPI: den snímku; člen: vstup do komunity), `fields` nese zbytek.
 */
export interface SourceCatalogRow {
  externalId: string;
  occurredAt: string | null;
  fields: Record<string, SourceCatalogValue>;
}

export type EntityType =
  | 'actor'
  | 'organization'
  | 'event'
  | 'engagement_metric'
  | 'role_assignment'
  | 'communication'
  // Operational record/document sources (ERP delivery notes, invoices, orders…).
  // Generic: any adapter reading transactional documents from an external system
  // (Money/Seyfor, SAP, …) serves them as 'document' via getEntity + listEntities.
  | 'document';

// ----------------------------------------------------------------------------
// Capabilities — what each data source supports
// ----------------------------------------------------------------------------

export type DataSourceCapability =
  | 'batch-pull'        // Scheduled cron sync
  | 'realtime-fdw'      // Live query via postgres_fdw to readonly replica
  | 'stored-procs'      // Source exposes SECURITY DEFINER SQL functions
  | 'webhook-push'      // Source pushes change events to /webhook endpoint
  | 'cdc-stream'        // Change-data-capture stream (Debezium-style)
  | 'write-back';       // Bidirectional sync (rare)

// ----------------------------------------------------------------------------
// Configuration (no secrets — only a REFERENCE resolved by the broker)
// ----------------------------------------------------------------------------

export interface DataSourceConfig {
  slug: string;                          // e.g., 'source-api'
  displayName: string;
  version: string;
  capabilities: DataSourceCapability[];
  /**
   * The story this source is bound to. audience_resolve_source_binding(storyId)
   * yields the endpoint + credential reference from the story spine. Absent for
   * the NullDataSource (no story = no external source configured).
   */
  storyId?: string;
  /** Populated at resolve time from instance_endpoint_bindings.endpoint_url. */
  endpointUrl?: string;
  authKind: 'jwt_bearer' | 'api_key' | 'oauth2' | 'mtls' | 'pg_dsn' | 'none';
  /**
   * Credential REFERENCE (instance_endpoint_bindings.auth_secret_ref) — an
   * opaque key the broker resolves against its own secret store. Never the
   * secret. An env-var name is one valid ref scheme. Absent for NullDataSource.
   */
  authSecretRef?: string;
  /** Domain slug for multi-tenancy (e.g., 'source', 'default'). */
  domainSlug?: string;
  /**
   * Katalogy, které adaptér umí vydat přes `listCatalog`. Broker je v každém
   * taktu přelije do jádra (audience_sync_source_catalog). Bez deklarace se
   * `listCatalog` nevolá — deklarace je vypínač, stejně jako u write-back.
   */
  catalogs?: SourceCatalogDeclaration[];
  /**
   * Porovnání identit, která adaptér umí (viz `matchIdentities`). Bez deklarace
   * se neporovnává nic — deklarace je vypínač, stejně jako u katalogů.
   */
  identityMatches?: SourceIdentityMatchDeclaration[];
}

// ----------------------------------------------------------------------------
// Aggregate snapshot — the ONLY structured output from a data source
// ----------------------------------------------------------------------------

/**
 * Mirrors columns of public.specialist_activity_metrics (extended).
 * Data source aggregates external data into this shape and calls
 * public.audience_upsert_user_engagement(user_id, snapshot, source_slug).
 */
export interface ActorAggregateSnapshot {
  userId: string;
  appAccesses30d: number;
  appAccesses90d: number;
  lastActiveAt: string | null;            // ISO 8601
  eventsCreated30d: number;
  eventsCreated90d: number;
  postsCreated30d: number;
  audienceSize: number;
  audienceGrowth30d: number;
  uniqueAttendees30d: number;
  totalAttendance30d: number;
  emailsOpened90d: number;
  emailsSent90d: number;
  emailOpenRate90d: number | null;
  emailClickRate90d: number | null;
}

// ----------------------------------------------------------------------------
// Document record — output of operational document sources ('document')
// ----------------------------------------------------------------------------

/**
 * A generic external document/record (ERP delivery note, invoice, order…). The
 * source-AGNOSTIC shape returned by 'document' sources: any adapter (Money/Seyfor,
 * SAP, …) maps its native payload into this so downstream code never learns a
 * source's field names. `externalId` is the write-back target (e.g. attachment
 * upload) — see `IDataSource.writeBack`, gated on the 'write-back' capability.
 */
export interface DocumentRecord {
  /** Id in the external system (write-back / attachment target). */
  externalId: string;
  /** Human document number, e.g. 'DLT23188'. */
  documentNumber: string;
  /** Document kind slug, e.g. 'delivery_note', 'invoice'. */
  documentType: string;
  /** ISO date (YYYY-MM-DD) or null. */
  documentDate: string | null;
  /** Denormalised counterparty label (snapshot at issue time). */
  counterparty: string | null;
  /** Source-agnostic line items. */
  lines: Array<{
    description: string;
    quantity: number | null;
    unit: string | null;
    catalog: string | null;
    /** Line total incl. VAT, in the document currency (Money S5 `CelkovaCena`),
     *  or null when the source omits a per-line price (typical for delivery
     *  notes). Lets a consumer derive realised price per unit (e.g. Kč/tonne)
     *  without re-reading the ERP. */
    lineTotal: number | null;
  }>;
  /**
   * Financial totals — set for MONETARY documents (invoices, credit notes),
   * left undefined for non-monetary ones (delivery notes). Optional so this is a
   * backward-compatible superset: existing consumers ignore it, invoice consumers
   * read it. The seam maps the source's field names here so nothing downstream
   * learns Money's (or any ERP's) schema.
   */
  financial?: DocumentFinancials;
  /**
   * Counterparty identity — registration numbers that let a monetary document be
   * matched to a known partner/customer (IČO/DIČ). Complements the `counterparty`
   * label. Optional; delivery notes typically carry only the label.
   */
  party?: DocumentParty;
  /**
   * Cross-document linking keys — the identifiers that let a deterministic matcher
   * (li_links / link_rules) join this document to another WITHOUT semantic search:
   * an invoice to its delivery note (shared `orderRef`), an invoice to a bank
   * statement (shared `variableSymbol`). Optional; the mapper fills whatever the
   * source carries. These are LINK semantics — distinct from `financial`, where the
   * same VS also appears as a payment attribute.
   */
  references?: DocumentReferences;
  /**
   * Who physically moves the goods — set for LOGISTICS documents (delivery
   * notes), left undefined elsewhere. Optional superset like `financial`/`party`:
   * existing consumers ignore it, the driver-handover lane reads it. On sources
   * where these live as user-defined fields (Money S5 „Uživatelské proměnné"),
   * the adapter's mapper is still the only place that knows those field names.
   */
  transport?: DocumentTransport;
  /** Original source payload (diagnostics / downstream mapping). */
  raw?: unknown;
}

/** Deterministic cross-document join keys (see DocumentRecord.references). */
export interface DocumentReferences {
  /** Order/PO reference shared across the order → delivery note → invoice chain. */
  orderRef: string | null;
  /** Payment variable symbol (CZ: VS) — joins an invoice to a bank statement line. */
  variableSymbol: string | null;
}

/**
 * Financial totals for a monetary DocumentRecord. Amounts are decimal numbers in
 * `currency`; every field is nullable because a source may omit any of them. This
 * is the source-agnostic shape — the adapter's mapper is the ONLY place that knows
 * which vendor field feeds each of these.
 */
export interface DocumentFinancials {
  /** Grand total incl. VAT (Money S5 `SumaCelkem`). */
  totalAmount: number | null;
  /** Tax base, excl. VAT (Money S5 `SumaZaklad`). */
  baseAmount: number | null;
  /** VAT amount (Money S5 `SumaDan`). */
  vatAmount: number | null;
  /** Currency label as the source reports it (Money S5 `Mena.Nazev`, e.g. 'CZK'). */
  currency: string | null;
  /** Payment reference / variable symbol (Money S5 `VariabilniSymbol`). */
  variableSymbol: string | null;
  /** Due date, ISO YYYY-MM-DD or null (Money S5 `DatumSplatnosti`). */
  dueDate: string | null;
  /**
   * Payment date, ISO YYYY-MM-DD, or null when UNPAID (Money S5 `DatumUhrady`).
   * This — not `status` — is the reliable paid/unpaid signal: Money S5 reports
   * `Stav` = 0 on every invoice, whereas a real `DatumUhrady` appears only once
   * the document is settled. The seam maps the source's "never paid" sentinel
   * (year < 2000, e.g. 1753-01-01 / 0001-01-01) to null so downstream never has
   * to know it.
   */
  paidDate: string | null;
  /** Source status label as reported, not normalised (Money S5 `Stav`). */
  status: string | null;
}

/** Counterparty registration identity on a monetary document. */
export interface DocumentParty {
  /** Company registration number (CZ: IČO). */
  ico: string | null;
  /** VAT identification number (CZ: DIČ). */
  dic: string | null;
  /** Contact email as denormalised on the document, if any. */
  email: string | null;
}

/**
 * Transport facts on a logistics document (see DocumentRecord.transport).
 * Values are verbatim source snapshots — normalisation (plate spacing, name
 * casing) is the ingest engine's job, not the adapter's.
 */
export interface DocumentTransport {
  /** Driver name as written on the document. */
  driverName: string | null;
  /** Vehicle registration plate as written (may contain spaces). */
  vehicleRegistration: string | null;
  /** Carrier / transport company label. */
  carrierName: string | null;
  /** Destination station / unloading place label. */
  destinationStation: string | null;
  /** Source-side "delivered / handed over" flag when the source tracks it. */
  delivered: boolean | null;
}

// ----------------------------------------------------------------------------
// Write-back — record an operational fact onto a source document
// ----------------------------------------------------------------------------

/**
 * An artefact captured in the field and written back alongside the state change
 * (a recipient's signature, a photo of the goods). The binary itself NEVER travels
 * through this contract: it is uploaded to the stack's object storage first, and
 * only the content-addressed reference crosses the seam. An adapter whose source
 * cannot take attachments reports `attachmentsAccepted: 0` rather than failing the
 * whole write — the state change is the load-bearing part.
 */
export interface DocumentAttachmentRef {
  /** Id in the stack's asset registry. */
  assetId: string;
  /** Content hash — the adapter may re-verify before upload. */
  sha256: string;
  mime: string;
  /** What the artefact IS, source-agnostic. Adapters map it to native slots. */
  role: 'signature' | 'photo' | 'document';
  filename?: string;
}

/**
 * A fact that happened to a document out in the world, in source-agnostic terms.
 *
 * `state` is a slug from OUR vocabulary ('delivered'), never a source's native
 * value — mapping it onto whatever the source calls that is the adapter's job, and
 * the mapping itself is instance configuration, not code. `occurredAt` is when it
 * happened in the field, which is NOT when we got to tell the source: a driver
 * confirms a handover in a quarry with no signal and the phone syncs an hour later,
 * so the source must be told the former.
 */
export interface DocumentStateChange {
  /** Source-agnostic state slug, e.g. 'delivered'. */
  state?: string;
  /** ISO 8601 — when the fact occurred in the field (may predate the call). */
  occurredAt: string;
  /** Who observed it. The adapter never trusts a caller-supplied identity beyond this. */
  actor: { userId: string; displayName?: string };
  /** Source-agnostic field updates; the adapter maps keys onto native ones. */
  fields?: Record<string, unknown>;
  /** Free-text remark (a driver's objection: '8 of 10 pallets'). */
  note?: string;
  attachments?: DocumentAttachmentRef[];
}

export interface WriteBackResult {
  /** True when the source accepted the change (or already had it — see `duplicate`). */
  ok: boolean;
  /**
   * The source already carried this exact change; nothing was written twice.
   * Adapters detect it via `idempotencyKey` and MUST report it rather than
   * writing again — this is what keeps a retry from issuing a second invoice.
   */
  duplicate?: boolean;
  /** Source-assigned id of whatever the write produced, when it produces one. */
  externalRef?: string;
  /** How many of the offered attachments the source actually took. */
  attachmentsAccepted?: number;
  /** Machine-readable failure cause when `ok` is false. */
  reason?: string;
}

// ----------------------------------------------------------------------------
// Write-back — record an operational fact onto a source document
// ----------------------------------------------------------------------------

/**
 * An artefact captured in the field and written back alongside the state change
 * (a recipient's signature, a photo of the goods). The binary itself NEVER travels
 * through this contract: it is uploaded to the stack's object storage first, and
 * only the content-addressed reference crosses the seam. An adapter whose source
 * cannot take attachments reports `attachmentsAccepted: 0` rather than failing the
 * whole write — the state change is the load-bearing part.
 */
export interface DocumentAttachmentRef {
  /** Id in the stack's asset registry. */
  assetId: string;
  /** Content hash — the adapter may re-verify before upload. */
  sha256: string;
  mime: string;
  /** What the artefact IS, source-agnostic. Adapters map it to native slots. */
  role: 'signature' | 'photo' | 'document';
  filename?: string;
}

/**
 * A fact that happened to a document out in the world, in source-agnostic terms.
 *
 * `state` is a slug from OUR vocabulary ('delivered'), never a source's native
 * value — mapping it onto whatever the source calls that is the adapter's job, and
 * the mapping itself is instance configuration, not code. `occurredAt` is when it
 * happened in the field, which is NOT when we got to tell the source: a driver
 * confirms a handover in a quarry with no signal and the phone syncs an hour later,
 * so the source must be told the former.
 */
export interface DocumentStateChange {
  /** Source-agnostic state slug, e.g. 'delivered'. */
  state?: string;
  /** ISO 8601 — when the fact occurred in the field (may predate the call). */
  occurredAt: string;
  /** Who observed it. The adapter never trusts a caller-supplied identity beyond this. */
  actor: { userId: string; displayName?: string };
  /** Source-agnostic field updates; the adapter maps keys onto native ones. */
  fields?: Record<string, unknown>;
  /** Free-text remark (a driver's objection: '8 of 10 pallets'). */
  note?: string;
  attachments?: DocumentAttachmentRef[];
}

export interface WriteBackResult {
  /** True when the source accepted the change (or already had it — see `duplicate`). */
  ok: boolean;
  /**
   * The source already carried this exact change; nothing was written twice.
   * Adapters detect it via `idempotencyKey` and MUST report it rather than
   * writing again — this is what keeps a retry from issuing a second invoice.
   */
  duplicate?: boolean;
  /** Source-assigned id of whatever the write produced, when it produces one. */
  externalRef?: string;
  /** How many of the offered attachments the source actually took. */
  attachmentsAccepted?: number;
  /** Machine-readable failure cause when `ok` is false. */
  reason?: string;
}

// ----------------------------------------------------------------------------
// Change event (webhook/CDC payload)
// ----------------------------------------------------------------------------

export type ChangeType = 'created' | 'updated' | 'deleted';

export interface ChangeEvent {
  entityType: EntityType;
  externalId: string;
  changeType: ChangeType;
  occurredAt: string;
  payload?: Partial<ActorAggregateSnapshot>;
}

// ----------------------------------------------------------------------------
// Scoped result (detail view)
// ----------------------------------------------------------------------------

export interface ScopedEntityResult<T> {
  entity: T | null;
  callerScope: {
    userId: string;
    tier: MemberTier;
    allowedReason: string;
  };
}

// ----------------------------------------------------------------------------
// Resolved source connection — handed to the adapter per read
// ----------------------------------------------------------------------------

/**
 * The per-read connection the broker resolves from the story spine
 * (audience_resolve_source_binding) and hands to the adapter. Carries the
 * endpoint + the credential REFERENCE (never the secret); the adapter resolves
 * the ref against the broker's secret store. Passing it per read (rather than
 * baking it in at register time) means a rotated credential is picked up without
 * re-registering the adapter.
 */
export interface SourceConnection {
  endpointUrl: string;
  authMethod: string;
  /** Opaque reference the adapter resolves against the broker secret store. */
  authSecretRef: string | null;
  /** Declared classification of the source (audit / policy). */
  dataSensitivity: string;
}

// ----------------------------------------------------------------------------
// Probe / health result
// ----------------------------------------------------------------------------

export type ProbeStatus = 'healthy' | 'degraded' | 'down';

export interface ProbeResult {
  status: ProbeStatus;
  latencyMs?: number;
  errorDetail?: string;
  checkedAt: string;
}

// ----------------------------------------------------------------------------
// IDataSource interface
// ----------------------------------------------------------------------------

export interface IDataSource {
  readonly config: DataSourceConfig;

  /** Initialize: open connections, validate credentials, fail fast on bad config */
  initialize(): Promise<void>;

  /**
   * Batch sync: yield pre-aggregated snapshots per user. Never raw rows.
   * Caller (broker sync route) upserts each via audience_upsert_user_engagement RPC.
   */
  fetchAggregateSnapshots(
    entityType: EntityType,
    since?: Date
  ): AsyncIterable<ActorAggregateSnapshot>;

  /**
   * Detail-view query: scoped to caller. Source-side permission check required.
   * `sourceConnection` is the broker-resolved endpoint + credential reference for
   * THIS read (absent only for the NullDataSource / unconfigured default, which
   * ignores it and reports "not configured").
   */
  getEntity<T = unknown>(
    entityType: EntityType,
    externalId: string,
    callerContext: { userId: string; tier: MemberTier },
    sourceConnection?: SourceConnection
  ): Promise<ScopedEntityResult<T>>;

  /**
   * Batch/list read for operational document sources (entityType 'document').
   * OPTIONAL — audience sources (actors/engagement) don't implement it; the
   * broker feature-detects it. Generic: any ERP/document adapter returns
   * provenance-carrying DocumentRecords. `sourceConnection` is the broker-resolved
   * endpoint + credential reference for THIS read (never baked in at register time).
   */
  listEntities?(
    entityType: EntityType,
    sourceConnection: SourceConnection,
    opts?: { since?: Date; limit?: number; offset?: number },
  ): Promise<DocumentRecord[]>;

  /**
   * Period statistics over source entities (entityType-free: `kind` names the
   * statistic, not an entity). OPTIONAL — feature-detected like listEntities.
   * Computed LIVE from the source for ONE calendar month (`opts.month`,
   * 'YYYY-MM'): the same rows an operator used to get from an on-demand export,
   * so the surface can show them without anyone running a script. Booleans stay
   * booleans in transport; a projection decides how to SHOW them (the table mask
   * rejects raw booleans — measured 2026-09-07, one broke a whole detail).
   */
  listStats?(
    kind: StatKind,
    sourceConnection: SourceConnection,
    opts: { month: string; limit?: number },
  ): Promise<StatRow[]>;

  /**
   * Katalog zdroje (viz `DataSourceConfig.catalogs`). OPTIONAL a feature-detected
   * jako listStats. Počítá se ŽIVĚ ze zdroje; broker výsledek přelije do jádra,
   * protože plocha čte jen jádro, nikdy živé routy brokeru.
   *
   * ⛔ U `snapshot` katalogu musí adaptér vydat CELOU množinu, nebo vyhodit
   * výjimku. Oříznutý výsledek by jádro přečetlo jako „zbytek zmizel". Jádro
   * navíc odmítne vyprázdnit neprázdný katalog prázdnou dávkou (výpadek
   * zdroje nesmí smazat dobrá data).
   */
  listCatalog?(
    kind: string,
    sourceConnection: SourceConnection,
  ): Promise<SourceCatalogRow[]>;

  /**
   * Porovná hodnoty identifikačního parametru (`kind`, např. 'email') proti
   * zdroji a vrátí NÁLEZY — dvojice hodnota → identita ve zdroji. OPTIONAL
   * a feature-detected jako listCatalog.
   *
   * ⛔ Adaptér nic nespojuje ani nezapisuje: vrací jen, co našel. Návrh vazby
   * zakládá broker (twin_identity_propose_match) a POTVRZUJE VÝHRADNĚ ČLOVĚK
   * v kokpitu. Hodnoty jsou PII (e-maily) — adaptér je smí použít jen k
   * porovnání, nikdy uložit; vracet smí jen identitu zdroje, ne hodnotu navíc.
   *
   * Nenalezená hodnota se prostě nevrátí; prázdné pole je platná odpověď.
   */
  matchIdentities?(
    kind: string,
    values: string[],
    sourceConnection: SourceConnection,
  ): Promise<Array<{ value: string; externalId: string }>>;

  /**
   * Record an operational fact onto a document in the SOURCE (entityType 'document').
   * OPTIONAL — the broker feature-detects it AND gates it on the adapter declaring
   * the 'write-back' capability; an adapter that implements this without declaring
   * it stays unreachable, so the declaration is the switch.
   *
   * This is the write half of the read/operate/write-back loop: `listEntities` pulls
   * a document in, the stack runs its operational life (a driver confirms a handover),
   * and this puts the resulting fact back where the source of record can see it.
   *
   * `idempotencyKey` is the caller's guarantee, not a hint: the same key for the same
   * change MUST NOT write twice. The field is where retries come from — a phone that
   * lost signal mid-call will send the same confirmation again — so an adapter that
   * cannot make the write idempotent against its source must say so by reporting
   * `duplicate` only when it genuinely knows, and never by guessing.
   *
   * `sourceConnection` is the broker-resolved endpoint + credential reference for THIS
   * write (never baked in at register time), exactly as on the read path.
   */
  writeBack?(
    entityType: EntityType,
    externalId: string,
    change: DocumentStateChange,
    sourceConnection: SourceConnection,
    opts: { idempotencyKey: string },
  ): Promise<WriteBackResult>;

  /** Webhook handler — validates payload (signature + mantra if applicable) */
  handleWebhook?(payload: unknown, signatureHeader?: string): Promise<ChangeEvent[]>;

  /** CDC subscription — async iterable of change events */
  subscribeChanges?(entityType: EntityType): AsyncIterable<ChangeEvent>;

  /** Health probe */
  probe(): Promise<ProbeResult>;

  /** Cleanup */
  shutdown(): Promise<void>;
}

// ----------------------------------------------------------------------------
// Registry — runtime broker tracking (replaces previously-planned connector_registry table)
// ----------------------------------------------------------------------------

export interface DataSourceRegistryEntry {
  slug: string;
  status: 'discovered' | 'tested_ok' | 'tested_failed' | 'enabled' | 'in_use' | 'deprecated' | 'rejected';
  lastHealthStatus?: ProbeStatus;
  consecutiveFailureCount: number;
  isEnabled: boolean;
}

export interface IDataSourceRegistry {
  /** Hydrate from config at startup */
  load(): Promise<void>;
  /** Get instance by slug (display/introspection); undefined when unknown. */
  get(slug: string): IDataSource | undefined;
  /**
   * Dispatch key for the /source routes: the adapter bound to `storyId`
   * (config.storyId), or the NullDataSource default when no real source is
   * registered for that story — so an unconfigured source is cleanly
   * "not configured", never a crash.
   */
  getForStory(storyId: string): IDataSource;
  /** List all */
  list(): DataSourceRegistryEntry[];
  /** Register a new data source (indexed by its config.storyId) */
  register(ds: IDataSource): Promise<void>;
  /** Run health probe for all enabled */
  probeAll(): Promise<Map<string, ProbeResult>>;
}

// ----------------------------------------------------------------------------
// Plugin seam — how an out-of-tree source-adapter package plugs into the broker
// ----------------------------------------------------------------------------

/**
 * The module shape a source-adapter plugin package must export. The broker's
 * plugin host (svc-source-broker adapters/plugin-host.ts) dynamic-import()s the
 * configured entry file, calls `createDataSource()`, and registers the result
 * in the SourceRegistry under its `config.storyId`. This is what keeps
 * fork-specific source knowledge OUT of the broker tree (upstream-clean forks):
 * the platform owns the seam, the fork owns the adapter package.
 *
 * The factory must be side-effect free — no connections, no I/O — until the
 * registry calls `initialize()` on the returned adapter.
 */
export interface SourceAdapterModule {
  createDataSource(): IDataSource;
}
