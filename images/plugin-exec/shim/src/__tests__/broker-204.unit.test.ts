/**
 * Remediation test — P4-shim-204-envelope
 *
 * CONTRACT: the shim broker must tolerate a 204 / empty-body broker response
 * for void operations (kv.set, kv.delete, notify). These endpoints legitimately
 * return "204 No Content" with an empty body, so the shim MUST NOT call
 * res.json() on them — that throws a SyntaxError ("Unexpected end of JSON input").
 *
 * KNOWN-RED at HEAD 569c5ffd: brokerCall<T>() unconditionally does
 *   return (await res.json()) as T;
 * so any 204/empty-body response makes ctx.kv.set / ctx.kv.delete / ctx.notify
 * reject with a JSON parse error instead of resolving to undefined.
 *
 * Post-fix contract asserted here (test goes GREEN after the fix):
 *   - a 204 response resolves to undefined and does NOT throw
 *   - a 200 with a genuinely empty body also resolves (no parse crash)
 *   - a 200 with a JSON body is still parsed and returned (no regression)
 *
 * Run (deps for vitest live at repo root, not in this package):
 *   node_modules/.bin/vitest run \
 *     --root . \
 *     --config <throwaway config that includes this file> \
 *     images/plugin-exec/shim/src/__tests__/broker-204.unit.test.ts
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSandboxContext, type LogLine } from '../broker.js';

/**
 * Identity the host hands in. It is a required argument rather than an
 * optional one with a default: a default would silently give a connector an
 * empty tenant and empty credentials, and rows written under a guessed tenant
 * are worse than a run that refuses to start. These tests exercise the broker's
 * HTTP behaviour, so the values only have to be present, not meaningful.
 */
const IDENTITA = {
  plugin: { version: '0.0.0-test' },
  tenant: { id: '00000000-0000-0000-0000-000000000000' },
  config: {},
};

function jsonResponse(status: number, body: string, contentType = 'application/json') {
  // WHATWG forbids a non-null body on a 204/205/304 response, so a real
  // "204 No Content" is modelled with a null body — exactly what the broker
  // sends and what makes an unconditional res.json() throw.
  const nullBodyStatus = status === 204 || status === 205 || status === 304;
  return new Response(nullBodyStatus || !body.length ? null : body, {
    status,
    headers: body.length ? { 'Content-Type': contentType } : {},
  });
}

describe('shim brokerCall — 204 / empty-body envelope (P4-shim-204-envelope)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('kv.set resolves to undefined on a 204 No Content response (no JSON parse crash)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(204, '')),
    );
    const logs: LogLine[] = [];
    const ctx = createSandboxContext(logs, IDENTITA, []);

    // KNOWN-RED: this currently rejects with a SyntaxError from res.json().
    await expect(ctx.kv.set('some-key', { any: 'value' })).resolves.toBeUndefined();
  });

  it('kv.delete resolves to undefined on a 204 No Content response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(204, '')),
    );
    const ctx = createSandboxContext([], IDENTITA, []);
    await expect(ctx.kv.delete('some-key')).resolves.toBeUndefined();
  });

  it('notify resolves to undefined on a 204 No Content response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(204, '')),
    );
    const ctx = createSandboxContext([], IDENTITA, []);
    await expect(ctx.notify('user-1', 'title', 'body')).resolves.toBeUndefined();
  });

  it('a 200 with a genuinely empty body also resolves without a parse crash', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, '')),
    );
    const ctx = createSandboxContext([], IDENTITA, []);
    await expect(ctx.kv.set('k', 'v')).resolves.toBeUndefined();
  });

  it('a 200 with a JSON body is still parsed and returned (no regression)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, JSON.stringify({ value: 42 }))),
    );
    const ctx = createSandboxContext([], IDENTITA, []);
    await expect(ctx.kv.get('k')).resolves.toEqual({ value: 42 });
  });
});
