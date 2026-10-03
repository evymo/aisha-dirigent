/**
 * Runner contract: must persist runs through the RPC, fail-soft on transport
 * issues, redact PII before transport, and gracefully reject malformed input.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { createAitgRunner, createInMemoryAitgRunner } from '../runner.js';

const fetchSpy = vi.fn();

beforeEach(() => {
  fetchSpy.mockReset();
  globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
});

const cfg = {
  postgrestUrl: 'http://postgrest:3000',
  serviceToken: 'sa-token-abcdef-12345',
  service: 'aitg-test',
};

describe('createAitgRunner', () => {
  test('POSTs to the audited RPC with normalised payload', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('"run-uuid"', { status: 200 }));
    const runner = createAitgRunner(cfg);
    const id = await runner.record({
      testId: 'AITG-APP-01',
      buildSha: 'abc1234',
      triggeredBy: 'pr-gate',
      status: 'passed',
      severity: 'info',
      details: { matchedMarkers: [] },
    });
    expect(id).toBe('run-uuid');
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://postgrest:3000/rpc/aitg_record_run_audited');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.p_test_id).toBe('AITG-APP-01');
    expect(body.p_status).toBe('passed');
    expect(body.p_severity).toBe('info');
  });

  test('redacts PII in details before sending', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('"x"', { status: 200 }));
    const runner = createAitgRunner(cfg);
    await runner.record({
      testId: 'AITG-APP-01',
      buildSha: 'abc1234',
      triggeredBy: 'manual',
      status: 'failed',
      severity: 'high',
      details: { email: 'leak@example.com', token: 'eyJraw.token.value' },
    });
    const body = (fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string;
    expect(body).not.toContain('leak@example.com');
    expect(body).not.toContain('eyJraw');
  });

  test('returns null on HTTP 5xx without throwing', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('err', { status: 500 }));
    const runner = createAitgRunner(cfg);
    const id = await runner.record({
      testId: 'AITG-APP-01',
      buildSha: 'abc1234',
      triggeredBy: 'manual',
      status: 'passed',
    });
    expect(id).toBeNull();
  });

  test('returns null on network error without throwing', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const runner = createAitgRunner(cfg);
    const id = await runner.record({
      testId: 'AITG-APP-01',
      buildSha: 'abc1234',
      triggeredBy: 'manual',
      status: 'passed',
    });
    expect(id).toBeNull();
  });

  test('rejects unknown test_id at the schema layer', async () => {
    const runner = createAitgRunner(cfg);
    const id = await runner.record({
      // @ts-expect-error testing runtime path
      testId: 'AITG-XX-99',
      buildSha: 'abc1234',
      triggeredBy: 'manual',
      status: 'passed',
    });
    expect(id).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('rejects short build_sha at the schema layer', async () => {
    const runner = createAitgRunner(cfg);
    const id = await runner.record({
      testId: 'AITG-APP-01',
      buildSha: 'ab',
      triggeredBy: 'manual',
      status: 'passed',
    });
    expect(id).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('createInMemoryAitgRunner', () => {
  test('captures records for test assertion', async () => {
    const runner = createInMemoryAitgRunner();
    await runner.record({
      testId: 'AITG-APP-01',
      buildSha: 'abc1234',
      triggeredBy: 'manual',
      status: 'passed',
    });
    expect(runner.records).toHaveLength(1);
    expect(runner.records[0].testId).toBe('AITG-APP-01');
  });

  test('rejects malformed input the same way the real runner does', async () => {
    const runner = createInMemoryAitgRunner();
    const id = await runner.record({
      // @ts-expect-error runtime path
      testId: 'INVALID',
      buildSha: 'abc',
      triggeredBy: 'manual',
      status: 'passed',
    });
    expect(id).toBeNull();
    expect(runner.records).toHaveLength(0);
  });
});
