import { describe, it, expect, vi } from 'vitest';
import type {
  ReadDriver, IControlTarget, SourceMapper, ControlAction, SourceConnection, DataSourceConfig,
} from '@aisha/audience-types';
import {
  InMemoryConnectorRegistry, runRead, ReadDeniedError, IngestEngine, driveControlledWrite,
  ControlDeniedError, defineBrokerConfig,
} from '../index.js';

interface Vehicle { vin: string; make: string; cursor?: string }

const CONN: SourceConnection = { endpointUrl: 'https://x.invalid', authMethod: 'bearer', authSecretRef: 'r', dataSensitivity: 'confidential' };
const CFG = (slug: string, caps: DataSourceConfig['capabilities']): DataSourceConfig =>
  ({ slug, displayName: slug, version: '1', capabilities: caps, storyId: 's1', authKind: 'jwt_bearer' });

function reader(rows: Vehicle[]): ReadDriver<Vehicle> {
  return {
    config: CFG('cube', ['batch-pull']),
    async initialize() {},
    describeContract() { return { name: 'vehicle', fields: [{ name: 'vin', type: 'text', required: true }] }; },
    async readOne(req) { return { record: rows.find(r => r.vin === req.externalId) ?? null, caller: { userId: 'u' }, allowedReason: 'ok' }; },
    async *readBatch() { for (const r of rows) yield r; },
    async probe() { return { status: 'healthy', checkedAt: new Date(0).toISOString() }; },
    async shutdown() {},
  };
}

const mapper: SourceMapper<Vehicle> = (v) => ({ rpc: 'hub_upsert_vehicle_cache', payload: { vin: v.vin, make: v.make } });

describe('registry — one story-indexed dispatch', () => {
  it('dispatches read + control by story; lists kinds', () => {
    const reg = new InMemoryConnectorRegistry();
    reg.registerReader('s1', reader([]));
    reg.registerControl('s1', { config: CFG('demo-commerce', ['write-back']) } as unknown as IControlTarget);
    expect(reg.getReaderForStory('s1')?.config.slug).toBe('cube');
    expect(reg.getControlForStory('s1')?.config.slug).toBe('demo-commerce');
    expect(reg.getReaderForStory('nope')).toBeUndefined();
    expect(reg.list()[0].kinds.sort()).toEqual(['control', 'read']);
    expect(reg.storyIds()).toEqual(['s1']);
  });
});

describe('read pipeline', () => {
  const deps = (binding: SourceConnection | null) => ({
    resolveBinding: vi.fn(async () => binding),
    auditRead: vi.fn(async () => {}),
    assertContract: vi.fn(async () => {}),
  });

  it('resolves the binding, drift-gates, reads, and BLOCKING-audits', async () => {
    const d = deps(CONN);
    const res = await runRead(d, 's1', reader([{ vin: 'A', make: 'Skoda' }]), { entityType: 'vehicle', externalId: 'A' }, { userId: 'u' });
    expect(res.record?.make).toBe('Skoda');
    expect(d.assertContract).toHaveBeenCalledOnce();   // drift gate ran
    expect(d.auditRead).toHaveBeenCalledOnce();         // audit is not optional
  });

  it('fail-closes when the source is not configured/approved (null binding)', async () => {
    await expect(runRead(deps(null), 's1', reader([]), { entityType: 'v', externalId: 'A' }, { userId: 'u' }))
      .rejects.toBeInstanceOf(ReadDeniedError);
  });

  it('serves from cache without a second driver read + audit', async () => {
    const store = new Map();
    const d = { ...deps(CONN), cache: { get: (k: string) => store.get(k), set: (k: string, v: unknown) => store.set(k, v) } };
    const drv = reader([{ vin: 'A', make: 'Skoda' }]);
    const spy = vi.spyOn(drv, 'readOne');
    await runRead(d, 's1', drv, { entityType: 'vehicle', externalId: 'A' }, { userId: 'u' });
    await runRead(d, 's1', drv, { entityType: 'vehicle', externalId: 'A' }, { userId: 'u' });
    expect(spy).toHaveBeenCalledOnce(); // 2nd read hit cache
  });
});

describe('ingest engine — driver-polymorphic', () => {
  it('reads batch, maps, upserts via the gated rpc, records the run', async () => {
    const rpc = vi.fn(async () => {});
    const recordRun = vi.fn(async () => {});
    const eng = new IngestEngine({ resolveBinding: async () => CONN, rpc, recordRun });
    const res = await eng.runOnce('s1', reader([{ vin: 'A', make: 'Skoda' }, { vin: 'B', make: 'VW' }]), mapper, { entityType: 'vehicle' });
    expect(res.status).toBe('ok');
    expect(res.rows).toBe(2);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith('hub_upsert_vehicle_cache', { vin: 'A', make: 'Skoda' });
    expect(recordRun).toHaveBeenCalledWith(expect.objectContaining({ ok: true, rows: 2 }));
  });

  it('opens the circuit after N consecutive failures and then skips', async () => {
    const eng = new IngestEngine({ resolveBinding: async () => CONN, rpc: async () => { throw new Error('boom'); }, circuitTripThreshold: 2 });
    const drv = reader([{ vin: 'A', make: 'Skoda' }]);
    expect((await eng.runOnce('s1', drv, mapper)).status).toBe('error');
    expect((await eng.runOnce('s1', drv, mapper)).status).toBe('error');
    expect((await eng.runOnce('s1', drv, mapper)).status).toBe('skipped_circuit_open');
    expect(eng.snapshot('s1')?.circuitOpen).toBe(true);
    eng.resetCircuit('s1');
    expect(eng.snapshot('s1')?.circuitOpen).toBe(false);
  });

  it('reports not_configured when no binding resolves', async () => {
    const eng = new IngestEngine({ resolveBinding: async () => null, rpc: async () => {} });
    expect((await eng.runOnce('s1', reader([]), mapper)).status).toBe('not_configured');
  });
});

describe('driveControlledWrite — idempotent saga', () => {
  const target = (): IControlTarget & { seen: ControlAction[] } => {
    const seen: ControlAction[] = [];
    return {
      config: CFG('demo-commerce', ['write-back']), seen,
      async initialize() {}, capabilities() { return ['price.put']; },
      async execute(a) { seen.push(a); return { ok: true, externalRef: `ext:${a.idempotencyKey}` }; },
      async probe() { return { status: 'healthy', checkedAt: new Date(0).toISOString() }; },
      async shutdown() {},
    };
  };
  const action: ControlAction = { kind: 'price.put', payload: { price: 999 }, idempotencyKey: 'k1' };

  it('reads-authoritative, writes externally, records hub — in order', async () => {
    const t = target();
    const order: string[] = [];
    const res = await driveControlledWrite({
      resolveBinding: async () => CONN,
      readAuthoritative: async () => { order.push('read'); return { ok: true }; },
      hasApplied: async () => false,
      recordHub: async () => { order.push('record'); },
    }, 's1', t, action, { userId: 'u', federatedCallerId: 'ext-9' });
    expect(res.ok).toBe(true);
    expect(t.seen[0].idempotencyKey).toBe('k1');
    expect(order).toEqual(['read', 'record']); // external write between them, recorded only after
  });

  it('skips the external write when the idempotencyKey already applied', async () => {
    const t = target();
    const res = await driveControlledWrite({
      resolveBinding: async () => CONN, readAuthoritative: async () => ({ ok: true }),
      hasApplied: async () => true, recordHub: async () => {},
    }, 's1', t, action, { userId: 'u' });
    expect(res.ok).toBe(true);
    expect(t.seen).toHaveLength(0); // never double-wrote
  });

  it('refuses a capability the target does not advertise', async () => {
    await expect(driveControlledWrite({
      resolveBinding: async () => CONN, readAuthoritative: async () => ({ ok: true }),
      hasApplied: async () => false, recordHub: async () => {},
    }, 's1', target(), { ...action, kind: 'order.cancel' }, { userId: 'u' }))
      .rejects.toBeInstanceOf(ControlDeniedError);
  });

  it('does NOT record hub when not authoritative', async () => {
    const t = target();
    const recordHub = vi.fn(async () => {});
    await expect(driveControlledWrite({
      resolveBinding: async () => CONN, readAuthoritative: async () => ({ ok: false, detail: 'stale' }),
      hasApplied: async () => false, recordHub,
    }, 's1', t, action, { userId: 'u' })).rejects.toBeInstanceOf(ControlDeniedError);
    expect(t.seen).toHaveLength(0);
    expect(recordHub).not.toHaveBeenCalled();
  });
});

describe('defineBrokerConfig — fail-loud', () => {
  it('throws when the dev bypass is on in production', () => {
    expect(() => defineBrokerConfig({ serviceName: 'x', env: { NODE_ENV: 'production', DEV_ALLOW_UNAUTHED_SYNC: 'true' } }))
      .toThrow(/forbidden when NODE_ENV=production/);
  });
  it('loads a valid dev config', () => {
    const c = defineBrokerConfig({ serviceName: 'svc-x', env: { PORT: '9', DEV_ALLOW_UNAUTHED_SYNC: 'true' }, defaultPort: 8 });
    expect(c.port).toBe(9);
    expect(c.devAllowUnauthedSync).toBe(true);
  });
});
