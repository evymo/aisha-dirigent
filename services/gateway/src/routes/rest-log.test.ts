/**
 * Brána /rest/v1: logovaný RPC požadavek nenese tajemství z dotazu.
 *
 * PostgREST klienti posílají `apikey` a někdy `access_token` v dotazu. Řádek
 * „PostgREST RPC proxy" logoval `req.url` syrově a výchozí logování požadavků
 * Fastify totéž (nezávislá revize 2026-10-05). Test čte, co logger brány
 * opravdu zapsal: logger je postavený továrnou `safeLoggerOptions` jako
 * v server.ts, trasa je skutečný `restProxy`.
 *
 * Hranice: překlad Keycloak tokenu (JWKS po síti) je nahrazený odmítnutím, aby
 * požadavek skončil před upstreamem — řádek logu vzniká už předtím.
 */
import { Writable } from 'node:stream';
import Fastify from 'fastify';
import { safeLoggerOptions } from '@aisha/security';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../auth/postgrest-jwt.js', () => ({
  translateAuthorizationForPostgrest: vi.fn(async () => ({ ok: false, status: 401, error: 'invalid_keycloak_token' })),
}));

const { restProxy } = await import('./rest.js');

const KLIC = 'test-apikey-value-91c2';
const PRISTUP = 'test-access-token-value-55d0';

function zachyceny() {
  const kusy: string[] = [];
  const proud = new Writable({
    write(kus: Buffer, _k, hotovo) {
      kusy.push(kus.toString('utf8'));
      hotovo();
    },
  });
  const syrove = (): string => kusy.join('');
  const radky = (): Record<string, unknown>[] =>
    syrove()
      .split('\n')
      .filter(Boolean)
      .map((r) => JSON.parse(r) as Record<string, unknown>);
  return { proud, syrove, radky };
}

describe('gateway restProxy — log bez tajemství z dotazu', () => {
  it('RPC řádek i příchozí požadavek: apikey a access_token pryč, select zůstane', async () => {
    const z = zachyceny();
    const app = Fastify({ logger: safeLoggerOptions({ level: 'info', stream: z.proud }) });
    await app.register(restProxy, { prefix: '/rest/v1' });

    const res = await app.inject({
      method: 'POST',
      url: `/rest/v1/rpc/moje_funkce?apikey=${KLIC}&access_token=${PRISTUP}&select=id`,
      headers: { authorization: `Bearer ${PRISTUP}`, 'content-type': 'application/json' },
      payload: {},
    });
    await app.close();

    expect(res.statusCode).toBe(401);
    expect(z.syrove()).not.toContain(KLIC);
    expect(z.syrove()).not.toContain(PRISTUP);

    const rpc = z.radky().find((r) => r.msg === 'PostgREST RPC proxy');
    expect(rpc, 'řádek RPC proxy se dál píše').toBeDefined();
    expect(rpc!.url).toBe('/rest/v1/rpc/moje_funkce?apikey=[redacted]&access_token=[redacted]&select=id');

    const prichozi = z.radky().find((r) => r.msg === 'incoming request');
    expect((prichozi!.req as { url: string }).url).toContain('/rest/v1/rpc/moje_funkce?');
    expect((prichozi!.req as { url: string }).url).toContain('select=id');
  });
});
