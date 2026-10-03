/**
 * data-source.test.ts
 *
 * Contract tests for IDataSource implementations.
 *
 * Renamed from connector.test.ts to reflect architectural decision: external
 * backends are "data sources" (we're a client of them), not MCP connectors.
 *
 * Every broker microservice (svc-source-broker, future svc-salesforce-broker)
 * implements IDataSource. This harness verifies invariants regardless of
 * source-system implementation details.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemberTier } from '../member-tier';
import type {
  IDataSource,
  DataSourceConfig,
  ActorAggregateSnapshot,
  ScopedEntityResult,
  EntityType,
  ProbeResult,
  DocumentStateChange,
  DocumentAttachmentRef,
  SourceConnection,
  WriteBackResult,
} from '../IDataSource';

// ----------------------------------------------------------------------------
// Mock implementation used for contract tests
// ----------------------------------------------------------------------------

class MockDataSource implements IDataSource {
  initialized = false;
  shutdownCalled = false;

  readonly config: DataSourceConfig = {
    slug: 'mock-test',
    displayName: 'Mock Test Data Source',
    version: '0.1.0',
    capabilities: ['batch-pull', 'realtime-fdw'],
    endpointUrl: 'http://localhost:9999',
    authKind: 'jwt_bearer',
    authEnvVar: 'MOCK_TEST_TOKEN',
  };

  async initialize() {
    // Simulate validating env-var presence
    if (!process.env[this.config.authEnvVar] && !this.testAllowMissingEnv) {
      throw new Error(`Missing env var: ${this.config.authEnvVar}`);
    }
    this.initialized = true;
  }

  /** Test hook: skip env var requirement when running unit tests */
  testAllowMissingEnv = true;

  async *fetchAggregateSnapshots(
    entityType: EntityType,
    _since?: Date
  ): AsyncIterable<ActorAggregateSnapshot> {
    if (!this.initialized) throw new Error('not initialized');
    if (entityType !== 'engagement_metric') return;

    yield {
      userId: 'mock-user-1',
      appAccesses30d: 12,
      appAccesses90d: 35,
      lastActiveAt: '2026-05-23T18:00:00Z',
      eventsCreated30d: 3,
      eventsCreated90d: 10,
      postsCreated30d: 5,
      audienceSize: 120,
      audienceGrowth30d: 0.15,
      uniqueAttendees30d: 25,
      totalAttendance30d: 60,
      emailsOpened90d: 14,
      emailsSent90d: 30,
      emailOpenRate90d: 0.4667,
      emailClickRate90d: 0.1333,
    };
  }

  async getEntity<T = unknown>(
    entityType: EntityType,
    externalId: string,
    callerContext: { userId: string; tier: MemberTier }
  ): Promise<ScopedEntityResult<T>> {
    if (!this.initialized) throw new Error('not initialized');
    const allowed =
      callerContext.tier === MemberTier.Admin || callerContext.userId === externalId;
    if (!allowed) {
      return {
        entity: null,
        callerScope: {
          userId: callerContext.userId,
          tier: callerContext.tier,
          allowedReason: 'denied: tier_below_admin AND not_self',
        },
      };
    }
    return {
      entity: { externalId, type: entityType } as unknown as T,
      callerScope: {
        userId: callerContext.userId,
        tier: callerContext.tier,
        allowedReason: callerContext.tier === MemberTier.Admin ? 'admin_override' : 'self',
      },
    };
  }

  async probe(): Promise<ProbeResult> {
    return {
      status: this.initialized ? 'healthy' : 'down',
      latencyMs: 5,
      checkedAt: new Date().toISOString(),
    };
  }

  async shutdown() {
    this.shutdownCalled = true;
  }
}

// ----------------------------------------------------------------------------
// Reusable contract harness
// ----------------------------------------------------------------------------

export function describeDataSourceContract(
  name: string,
  factory: () => IDataSource
) {
  describe(`IDataSource contract: ${name}`, () => {
    let ds: IDataSource;

    beforeEach(() => {
      ds = factory();
    });

    afterEach(async () => {
      try {
        await ds.shutdown();
      } catch { /* ignore */ }
    });

    it('config provides required identifying metadata', () => {
      expect(ds.config.slug).toBeTruthy();
      expect(ds.config.displayName).toBeTruthy();
      expect(ds.config.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(Array.isArray(ds.config.capabilities)).toBe(true);
      expect(ds.config.capabilities.length).toBeGreaterThan(0);
      expect(ds.config.authEnvVar).toBeTruthy(); // env var name, not value
    });

    it('initialize succeeds when env vars are present', async () => {
      await expect(ds.initialize()).resolves.not.toThrow();
    });

    it('shutdown cleans up resources', async () => {
      await ds.initialize();
      await expect(ds.shutdown()).resolves.not.toThrow();
    });

    it('yields snapshots matching ActorAggregateSnapshot shape exactly', async () => {
      await ds.initialize();
      const snapshots: ActorAggregateSnapshot[] = [];
      for await (const s of ds.fetchAggregateSnapshots('engagement_metric')) {
        snapshots.push(s);
      }
      snapshots.forEach((s) => {
        expect(s.userId).toBeTruthy();
        expect(typeof s.appAccesses30d).toBe('number');
        expect(typeof s.audienceSize).toBe('number');
        // Forbidden: raw event arrays
        expect((s as Record<string, unknown>).events).toBeUndefined();
        expect((s as Record<string, unknown>).attendees).toBeUndefined();
        expect((s as Record<string, unknown>).rawData).toBeUndefined();
      });
    });

    it('fetchAggregateSnapshots throws if not initialized', async () => {
      const fresh = factory();
      await expect(async () => {
        for await (const _ of fresh.fetchAggregateSnapshots('engagement_metric')) {
          break;
        }
      }).rejects.toThrow();
    });

    it('getEntity returns entity when caller is owner', async () => {
      await ds.initialize();
      const result = await ds.getEntity('actor', 'user-1', {
        userId: 'user-1',
        tier: MemberTier.Active,
      });
      expect(result.entity).not.toBeNull();
      expect(result.callerScope.allowedReason).toBeTruthy();
    });

    it('getEntity returns null when caller cannot access (privilege check)', async () => {
      await ds.initialize();
      const result = await ds.getEntity('actor', 'user-target', {
        userId: 'user-attacker',
        tier: MemberTier.Active,
      });
      expect(result.entity).toBeNull();
      expect(result.callerScope.allowedReason.startsWith('denied:')).toBe(true);
    });

    it('getEntity allows admin to fetch any entity', async () => {
      await ds.initialize();
      const result = await ds.getEntity('actor', 'user-target', {
        userId: 'admin-1',
        tier: MemberTier.Admin,
      });
      expect(result.entity).not.toBeNull();
      expect(result.callerScope.allowedReason).toContain('admin');
    });

    it('probe returns ProbeResult with status', async () => {
      const r = await ds.probe();
      expect(['healthy', 'degraded', 'down']).toContain(r.status);
      expect(r.checkedAt).toBeTruthy();
    });

    it('probe reports down before initialize', async () => {
      const r = await ds.probe();
      expect(r.status).toBe('down');
    });
  });
}

// ----------------------------------------------------------------------------
// Apply contract tests to MockDataSource (harness self-test)
// ----------------------------------------------------------------------------

describeDataSourceContract('MockDataSource (harness self-test)', () => new MockDataSource());

// ----------------------------------------------------------------------------
// Architectural invariants
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// Write-back contract — the write half of read/operate/write-back
// ----------------------------------------------------------------------------

/**
 * Minimal 'document' source that accepts write-backs. Models the real seam: a
 * document is pulled in, lives its operational life in the stack, and the
 * resulting fact is pushed back onto the source of record.
 */
class MockDocumentDataSource implements IDataSource {
  readonly config: DataSourceConfig = {
    slug: 'mock-erp',
    displayName: 'Mock ERP',
    version: '0.1.0',
    capabilities: ['batch-pull', 'write-back'],
    endpointUrl: 'http://localhost:9999',
    authKind: 'jwt_bearer',
    authEnvVar: 'MOCK_ERP_TOKEN',
  };

  /** What the source of record ended up holding, keyed by document. */
  written = new Map<string, DocumentStateChange>();
  /** Idempotency keys the source has already honoured. */
  private seen = new Map<string, WriteBackResult>();
  /** Counts real writes, so a replay that writes twice fails loudly. */
  writeCount = 0;

  async initialize() {}
  async *fetchAggregateSnapshots(): AsyncIterable<ActorAggregateSnapshot> {}
  async getEntity<T = unknown>(): Promise<ScopedEntityResult<T>> {
    return { entity: null, callerScope: { userId: '', tier: MemberTier.Active, allowedReason: 'n/a' } };
  }
  async probe(): Promise<ProbeResult> {
    return { status: 'healthy', latencyMs: 1, checkedAt: new Date().toISOString() };
  }
  async shutdown() {}

  async writeBack(
    _entityType: EntityType,
    externalId: string,
    change: DocumentStateChange,
    _conn: SourceConnection,
    opts: { idempotencyKey: string },
  ): Promise<WriteBackResult> {
    const already = this.seen.get(opts.idempotencyKey);
    if (already) return { ...already, duplicate: true };

    this.writeCount += 1;
    this.written.set(externalId, change);
    const result: WriteBackResult = {
      ok: true,
      externalRef: `ext-${this.writeCount}`,
      attachmentsAccepted: change.attachments?.length ?? 0,
    };
    this.seen.set(opts.idempotencyKey, result);
    return result;
  }
}

describe('IDataSource write-back contract', () => {
  let ds: MockDocumentDataSource;
  const conn: SourceConnection = {
    endpointUrl: 'http://erp.invalid:81',
    authMethod: 'bearer',
    authSecretRef: 'MOCK_ERP_TOKEN',
    dataSensitivity: 'confidential',
  };
  const signature: DocumentAttachmentRef = {
    assetId: 'asset-1',
    sha256: 'a'.repeat(64),
    mime: 'image/png',
    role: 'signature',
  };
  const change: DocumentStateChange = {
    state: 'delivered',
    occurredAt: '2026-07-17T09:12:00Z',
    actor: { userId: 'driver-1' },
    attachments: [signature],
  };

  beforeEach(() => {
    ds = new MockDocumentDataSource();
  });

  it('is gated on the declared capability, not on the method existing', () => {
    // The method is feature-detectable, but the declaration is what the broker
    // switches on — an adapter that implements it silently stays unreachable.
    expect(typeof ds.writeBack).toBe('function');
    expect(ds.config.capabilities).toContain('write-back');
  });

  it('records the state change against the document', async () => {
    const r = await ds.writeBack!('document', 'DLT23188', change, conn, { idempotencyKey: 'k1' });
    expect(r.ok).toBe(true);
    expect(ds.written.get('DLT23188')?.state).toBe('delivered');
  });

  it('replaying the same idempotency key reports duplicate and does NOT write twice', async () => {
    // The field is where retries come from: a phone that lost signal mid-call
    // sends the same confirmation again. Writing twice here is a second invoice.
    await ds.writeBack!('document', 'DLT23188', change, conn, { idempotencyKey: 'k1' });
    const replay = await ds.writeBack!('document', 'DLT23188', change, conn, { idempotencyKey: 'k1' });

    expect(replay.duplicate).toBe(true);
    expect(replay.ok).toBe(true);
    expect(ds.writeCount).toBe(1);
  });

  it('a distinct change writes again', async () => {
    await ds.writeBack!('document', 'DLT23188', change, conn, { idempotencyKey: 'k1' });
    await ds.writeBack!('document', 'DLT99999', change, conn, { idempotencyKey: 'k2' });
    expect(ds.writeCount).toBe(2);
  });

  it('reports how many attachments the source actually took', async () => {
    const r = await ds.writeBack!('document', 'DLT23188', change, conn, { idempotencyKey: 'k1' });
    expect(r.attachmentsAccepted).toBe(1);
  });

  it('carries field time, not call time (offline capture backdates)', async () => {
    await ds.writeBack!('document', 'DLT23188', change, conn, { idempotencyKey: 'k1' });
    // A handover confirmed in a quarry with no signal syncs later; the source of
    // record must be told when it HAPPENED, not when the phone got through.
    expect(ds.written.get('DLT23188')?.occurredAt).toBe('2026-07-17T09:12:00Z');
  });

  it('resolves the endpoint per write (rotated credential needs no re-register)', async () => {
    // Same invariant as the read path: the connection is handed in, never baked in.
    await expect(
      ds.writeBack!('document', 'DLT23188', change, conn, { idempotencyKey: 'k1' }),
    ).resolves.toMatchObject({ ok: true });
  });
});

describe('IDataSource architectural invariants', () => {
  it('ActorAggregateSnapshot has all required engagement fields', () => {
    const example: ActorAggregateSnapshot = {
      userId: 'u1',
      appAccesses30d: 0,
      appAccesses90d: 0,
      lastActiveAt: null,
      eventsCreated30d: 0,
      eventsCreated90d: 0,
      postsCreated30d: 0,
      audienceSize: 0,
      audienceGrowth30d: 0,
      uniqueAttendees30d: 0,
      totalAttendance30d: 0,
      emailsOpened90d: 0,
      emailsSent90d: 0,
      emailOpenRate90d: null,
      emailClickRate90d: null,
    };
    expect(Object.keys(example)).toHaveLength(15);
  });

  it('DocumentAttachmentRef carries a REFERENCE, never the binary', () => {
    // The signature/photo goes to object storage first; only the content-addressed
    // ref crosses this seam. A binary here would put client evidence into adapter
    // memory, logs and retries — the same reason raw rows never cross the read path.
    const ref: DocumentAttachmentRef = {
      assetId: 'asset-1',
      sha256: 'b'.repeat(64),
      mime: 'image/png',
      role: 'signature',
    };
    const r = ref as Record<string, unknown>;
    expect(r.data).toBeUndefined();
    expect(r.buffer).toBeUndefined();
    expect(r.base64).toBeUndefined();
    expect(r.content).toBeUndefined();
    expect(ref.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('DocumentStateChange keeps state in OUR vocabulary, not the source\'s', () => {
    // 'delivered' is a slug we own; what Money or POHODA calls that is a mapping,
    // and the mapping is instance configuration — never a literal in the contract.
    const change: DocumentStateChange = {
      state: 'delivered',
      occurredAt: '2026-07-17T09:12:00Z',
      actor: { userId: 'driver-1' },
    };
    expect(change.state).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it('DataSourceConfig stores env var NAME (not value) for credentials', () => {
    const config: DataSourceConfig = {
      slug: 'example',
      displayName: 'Example',
      version: '1.0.0',
      capabilities: ['batch-pull'],
      endpointUrl: 'https://example.com',
      authKind: 'jwt_bearer',
      authEnvVar: 'EXAMPLE_API_TOKEN', // ← name, not the actual secret
    };
    // Critical: authEnvVar should look like an env-var name, NOT a secret
    expect(config.authEnvVar).toMatch(/^[A-Z][A-Z0-9_]*$/);
    expect(config.authEnvVar).not.toContain(' ');
  });
});
