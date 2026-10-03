/**
 * connector.test.ts — the universal connector contracts are implementable and
 * source-native (no audience coupling). A minimal read+control driver over a
 * fake "vehicle" record proves the shapes without any broker/DB.
 */
import { describe, it, expect } from 'vitest';
import type {
  ReadDriver, IControlTarget, SourceMapper, UpsertCommand,
  ControlAction, ScopedRecord, SourceConnection, DataSourceConfig,
} from '../index.js';

interface Vehicle { vin: string; make: string } // a SOURCE-NATIVE record (not ActorAggregateSnapshot)

const CONN: SourceConnection = {
  endpointUrl: 'https://cube.invalid', authMethod: 'bearer',
  authSecretRef: 'ref:cube', dataSensitivity: 'confidential',
};
const CFG: DataSourceConfig = {
  slug: 'cube', displayName: 'CZ Vehicle Cube', version: '1', capabilities: ['batch-pull', 'write-back'],
  storyId: 's1', authKind: 'jwt_bearer',
};

class CubeReadDriver implements ReadDriver<Vehicle> {
  readonly config = CFG;
  async initialize() {}
  describeContract() { return { name: 'vehicle', fields: [{ name: 'vin', type: 'text', required: true }] }; }
  async readOne(): Promise<ScopedRecord<Vehicle>> {
    return { record: { vin: 'TMB', make: 'Skoda' }, caller: { userId: 'u1', federatedCallerId: 'ext-9' }, allowedReason: 'ok' };
  }
  async *readBatch(): AsyncIterable<Vehicle> { yield { vin: 'A', make: 'Skoda' }; yield { vin: 'B', make: 'VW' }; }
  async probe() { return { status: 'healthy' as const, checkedAt: new Date(0).toISOString() }; }
  async shutdown() {}
}

class DemoCommerceControlTarget implements IControlTarget {
  readonly config = CFG;
  seen: ControlAction[] = [];
  async initialize() {}
  capabilities() { return ['price.put', 'vehicle.pair']; }
  async execute(action: ControlAction) {
    this.seen.push(action);
    return { ok: true, externalRef: `demo-commerce:${action.idempotencyKey}` };
  }
  async probe() { return { status: 'healthy' as const, checkedAt: new Date(0).toISOString() }; }
  async shutdown() {}
}

// the ONLY aisha-shape site — native Vehicle → a named gated upsert
const vehicleMapper: SourceMapper<Vehicle> = (v): UpsertCommand => ({
  rpc: 'hub_upsert_vehicle_cache',
  payload: { vin: v.vin, make: v.make },
});

describe('connector contracts', () => {
  it('a ReadDriver emits source-native records + batch, never an aisha shape', async () => {
    const d = new CubeReadDriver();
    const one = await d.readOne({ entityType: 'vehicle', externalId: 'TMB' }, CONN, { userId: 'u1' });
    expect(one.record?.make).toBe('Skoda');
    const vins: string[] = [];
    for await (const v of d.readBatch({ entityType: 'vehicle' }, CONN)) vins.push(v.vin);
    expect(vins).toEqual(['A', 'B']);
    expect(d.describeContract().fields[0].name).toBe('vin');
  });

  it('the SourceMapper is the only aisha-shape translation', () => {
    const cmd = vehicleMapper({ vin: 'TMB', make: 'Skoda' });
    expect(cmd.rpc).toBe('hub_upsert_vehicle_cache');
    expect(cmd.payload).toEqual({ vin: 'TMB', make: 'Skoda' });
  });

  it('an IControlTarget executes an idempotent, capability-declared action', async () => {
    const t = new DemoCommerceControlTarget();
    expect(t.capabilities()).toContain('price.put');
    const res = await t.execute(
      { kind: 'price.put', payload: { collectionId: 1, price: 999 }, idempotencyKey: 'k-1' },
      CONN, { userId: 'u1', federatedCallerId: 'ext-9' });
    expect(res.ok).toBe(true);
    expect(res.externalRef).toBe('demo-commerce:k-1');
    expect(t.seen[0].idempotencyKey).toBe('k-1');
  });
});
