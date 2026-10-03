/**
 * Unit tests for Prometheus metrics adapter.
 *
 * Coverage:
 *   - createAishaMetrics returns registry + 4 AISHA-conventional metrics
 *   - registerMetricsPlugin mounts /metrics on Fastify
 *   - /metrics returns valid Prometheus text format
 *   - request_duration_ms histogram captures elapsedTime via onResponse hook
 *   - serviceName label appears on default metrics
 */
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import {
  createAishaMetrics,
  registerMetricsPlugin,
} from '../metrics.js';

describe('createAishaMetrics', () => {
  it('returns AishaMetrics object with all expected fields', () => {
    const m = createAishaMetrics('svc-test');
    expect(m.registry).toBeDefined();
    expect(m.rpcCalls).toBeDefined();
    expect(m.llmCalls).toBeDefined();
    expect(m.rpcDuration).toBeDefined();
    expect(m.requestDuration).toBeDefined();
  });

  it('exposes serviceName as default registry label', async () => {
    const m = createAishaMetrics('svc-label-test');
    const text = await m.registry.metrics();
    expect(text).toContain('service="svc-label-test"');
  });

  it('rpcCalls counter increments correctly', async () => {
    const m = createAishaMetrics('svc-counter-test');
    m.rpcCalls.inc({ rpc: 'get_x', status: 'ok' }, 3);
    m.rpcCalls.inc({ rpc: 'get_x', status: 'error' }, 1);
    const text = await m.registry.metrics();
    expect(text).toMatch(/aisha_rpc_calls_total\{[^}]*rpc="get_x"[^}]*status="ok"[^}]*\}\s+3/);
    expect(text).toMatch(/aisha_rpc_calls_total\{[^}]*rpc="get_x"[^}]*status="error"[^}]*\}\s+1/);
  });

  it('rpcDuration histogram records observations', async () => {
    const m = createAishaMetrics('svc-hist-test');
    m.rpcDuration.observe({ rpc: 'get_x' }, 12.5);
    m.rpcDuration.observe({ rpc: 'get_x' }, 250);
    const text = await m.registry.metrics();
    expect(text).toContain('aisha_rpc_duration_ms_count');
    expect(text).toMatch(/aisha_rpc_duration_ms_count\{[^}]*rpc="get_x"[^}]*\}\s+2/);
  });
});

describe('registerMetricsPlugin', () => {
  it('mounts /metrics endpoint returning Prometheus text', async () => {
    const app = Fastify({ logger: false });
    await registerMetricsPlugin(app, { serviceName: 'svc-fastify-test' });

    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.payload).toContain('process_cpu_seconds_total');
    expect(res.payload).toContain('service="svc-fastify-test"');

    await app.close();
  });

  it('mounts at custom path when provided', async () => {
    const app = Fastify({ logger: false });
    await registerMetricsPlugin(app, {
      serviceName: 'svc-custom-path',
      path: '/_aisha/metrics',
    });

    const a = await app.inject({ method: 'GET', url: '/_aisha/metrics' });
    expect(a.statusCode).toBe(200);
    const b = await app.inject({ method: 'GET', url: '/metrics' });
    expect(b.statusCode).toBe(404);

    await app.close();
  });

  it('records request_duration on onResponse hook', async () => {
    const app = Fastify({ logger: false });
    app.get('/foo', async () => ({ ok: true }));
    const metrics = await registerMetricsPlugin(app, {
      serviceName: 'svc-rd-test',
    });

    await app.inject({ method: 'GET', url: '/foo' });

    const text = await metrics.registry.metrics();
    expect(text).toContain('aisha_request_duration_ms_count');
    // Either route='/foo' (resolved) or 'unknown' is acceptable depending
    // on Fastify version; both prove the hook fired.
    expect(text).toMatch(/aisha_request_duration_ms_count/);

    await app.close();
  });

  it('skips /metrics mounting when enabled=false (for tests)', async () => {
    const app = Fastify({ logger: false });
    await registerMetricsPlugin(app, {
      serviceName: 'svc-disabled-test',
      enabled: false,
    });

    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(404);

    await app.close();
  });
});
