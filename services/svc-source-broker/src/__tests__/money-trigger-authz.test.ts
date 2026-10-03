/**
 * POST /money/trigger — event trigger „vznikl doklad, aktualizuj".
 *
 * Trigger je vstup zvenčí, který rozhoduje, kdy se sahá do cizího účetnictví. Proto:
 * bez ověření 401 a tah se NEOZNAČÍ; s ověřením 202 a tah se jen označí (provede ho
 * nejbližší tik hodinek, se všemi pojistkami); vypnutá lane 503.
 */
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { registerMoneyRoutes } from '../routes/money.js';
import type { SourceBrokerConfig } from '../config.js';
import type { MoneyLaneHandle } from '../clients/money-lane.js';

function config(o: Partial<SourceBrokerConfig> = {}): SourceBrokerConfig {
  return {
    postgrestUrl: 'http://postgrest', postgrestServiceToken: 't', postgresUrl: 'postgres://t',
    keycloakUrl: 'http://k', keycloakRealm: 'aisha', oidcAppClientId: 'aisha-app', sourceApiUrl: 'http://s',
    sourceServiceEmail: '', sourceServicePassword: '', sourcePgUrl: 'postgres://s',
    sourceAuthHandshakeOutgoing: 'a', sourceAuthHandshakeIncoming: 'b', jwtCacheTtlMs: 1,
    webhookHmacSecret: 'secret', syncIntervalMs: 1, port: 8090, logLevel: 'silent', corsAllowlist: '',
    rateLimitEnabled: false, devAllowUnauthedSync: false, aishaGatewayUrl: 'http://gateway:3001',
    aishaGatewayIntranetKey: '', aishaJwtSecret: '', aishaJwtExpSec: 3600, aishaMemberRole: 'authenticated',
    ...o,
  } as SourceBrokerConfig;
}

function lane(enabled = true) {
  const duvody: string[] = [];
  const h = {
    enabled,
    pozadatTah(duvod: string) { duvody.push(duvod); return { prijato: true as const, nejpozdejiZaMs: 60_000 }; },
  } as unknown as MoneyLaneHandle;
  return { h, duvody };
}

async function app(c: SourceBrokerConfig, l: MoneyLaneHandle) {
  const a = Fastify({ logger: false });
  registerMoneyRoutes(a, l, c);
  await a.ready();
  return a;
}

describe('POST /money/trigger', () => {
  it('bez ověření 401 a tah se neoznačí', async () => {
    const l = lane();
    const a = await app(config(), l.h);
    const r = await a.inject({ method: 'POST', url: '/money/trigger', payload: { cisloDokladu: 'DLP2602309' } });
    expect(r.statusCode).toBe(401);
    expect(l.duvody).toEqual([]);
    await a.close();
  });

  it('podvržená hlavička role nestačí', async () => {
    const l = lane();
    const a = await app(config(), l.h);
    const r = await a.inject({ method: 'POST', url: '/money/trigger', headers: { 'x-aisha-user-role': 'admin' }, payload: {} });
    expect(r.statusCode).toBe(401);
    expect(l.duvody).toEqual([]);
    await a.close();
  });

  it('ověřený požadavek → 202, tah se jen označí a nese stopu události', async () => {
    const l = lane();
    const a = await app(config({ devAllowUnauthedSync: true }), l.h);
    const r = await a.inject({ method: 'POST', url: '/money/trigger', payload: { zdroj: 'money', agenda: 'agenda-a', cisloDokladu: 'DLP2602309' } });
    expect(r.statusCode).toBe(202);
    expect(r.json()).toMatchObject({ prijato: true });
    expect(l.duvody).toEqual(['money agenda-a DLP2602309']);
    await a.close();
  });

  it('vypnutá lane → 503, nic se neoznačí', async () => {
    const l = lane(false);
    const a = await app(config({ devAllowUnauthedSync: true }), l.h);
    const r = await a.inject({ method: 'POST', url: '/money/trigger', payload: {} });
    expect(r.statusCode).toBe(503);
    expect(l.duvody).toEqual([]);
    await a.close();
  });
});
