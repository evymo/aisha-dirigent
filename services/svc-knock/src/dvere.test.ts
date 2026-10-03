/**
 * BRÁNA: `/dvere` je verdikt pro edge — a musí umět říct NE.
 *
 * Zadání majitele 2026-09-01: „celý edge zavřít — nezaklepeš, dveře se
 * neotevřou, a teprve pak se můžeš přihlásit." Rozhoduje se tady, u toho, kdo
 * mapu zaťukaných PÍŠE; edge se jen ptá přes `forward_auth`.
 */
import { describe, expect, it } from 'vitest';
import { buildHealthApp } from './server.js';
import type { KnockConfig } from './config.js';

const cfg = {
  logLevel: 'silent', operators: {}, diagnose: false, redisDb: 4,
  trustedProxies: '10.0.0.0/8,192.168.0.0/16,100.64.0.0/10',
} as unknown as KnockConfig;

const app = (verdikt?: (ip: string) => Promise<{ allowed: boolean }>) =>
  buildHealthApp(cfg, () => ({ doorReady: true }), verdikt);

describe('brána: /dvere', () => {
  it('zaťukaná adresa PROJDE (204)', async () => {
    const a = await app(async (ip) => ({ allowed: ip === '198.51.100.143' }));
    const r = await a.inject({ method: 'GET', url: '/dvere',
      headers: { 'x-forwarded-for': '198.51.100.143, 192.168.2.1, 100.126.250.10' } });
    await a.close();
    expect(r.statusCode).toBe(204);
  });

  it('nezaťukaná adresa je ODŘÍZNUTA (403) a nic se nedozví', async () => {
    const a = await app(async () => ({ allowed: false }));
    const r = await a.inject({ method: 'GET', url: '/dvere',
      headers: { 'x-forwarded-for': '1.2.3.4, 192.168.2.1' } });
    await a.close();
    expect(r.statusCode).toBe(403);
    expect(r.body).toBe('');
  });

  it('samé naše proxy = adresu nešlo odvodit ⇒ ZAVŘENO', async () => {
    // Kdyby se tady dosadila adresa socketu, ukazovala by na Caddy — tedy na nás.
    const a = await app(async () => ({ allowed: true }));
    const r = await a.inject({ method: 'GET', url: '/dvere',
      headers: { 'x-forwarded-for': '192.168.2.1, 100.126.250.10' } });
    await a.close();
    expect(r.statusCode).toBe(403);
  });

  it('podvržená adresa VLEVO od naší se ignoruje', async () => {
    // Klient si napíše cokoli; HAProxy to přepíše a jeho zápis zůstane vlevo.
    const a = await app(async (ip) => ({ allowed: ip === '9.9.9.9' }));
    const r = await a.inject({ method: 'GET', url: '/dvere',
      headers: { 'x-forwarded-for': '9.9.9.9, 198.51.100.143, 192.168.2.1' } });
    await a.close();
    expect(r.statusCode).toBe(403);
  });

  it('bez verdiktu se NEPOUŠTÍ (503, ne 204)', async () => {
    const a = await app(undefined);
    const r = await a.inject({ method: 'GET', url: '/dvere' });
    await a.close();
    expect(r.statusCode).toBe(503);
  });
});

/**
 * BRÁNA: nájem adresy — prodloužení a zavření.
 *
 * Rozhodnutí majitele 2026-09-01: „přihlášení whitelistuje uživatelovu IP na
 * edge — dokud je přihlášen, nebo dokud ho neodhlásíš z KC."
 */
describe('brána: nájem adresy', () => {
  const app2 = (najem?: { prodluz: (ip: string) => Promise<boolean>; zavri: (ip: string) => Promise<boolean> }) =>
    buildHealthApp(cfg, () => ({ doorReady: true }), async () => ({ allowed: true }), najem);

  it('adresa se odvodí z HLAVIČKY, ne z těla', async () => {
    // Kdyby se brala z těla, kdokoli uvnitř sítě otevře libovolnou adresu.
    let videno = '';
    const a = await app2({ prodluz: async (ip) => { videno = ip; return true; }, zavri: async () => true });
    await a.inject({ method: 'POST', url: '/dvere/prodluz',
      headers: { 'x-forwarded-for': '198.51.100.143, 192.168.2.1' },
      payload: { ip: '9.9.9.9' } });
    await a.close();
    expect(videno).toBe('198.51.100.143');
  });

  it('bez odvoditelné adresy se NIC nemění (400)', async () => {
    const a = await app2({ prodluz: async () => true, zavri: async () => true });
    const r = await a.inject({ method: 'POST', url: '/dvere/prodluz',
      headers: { 'x-forwarded-for': '192.168.2.1, 100.126.250.10' } });
    await a.close();
    expect(r.statusCode).toBe(400);
  });

  it('prodloužení neotevřené adresy vrací 409, ne 204', async () => {
    const a = await app2({ prodluz: async () => false, zavri: async () => true });
    const r = await a.inject({ method: 'POST', url: '/dvere/prodluz',
      headers: { 'x-forwarded-for': '198.51.100.143, 192.168.2.1' } });
    await a.close();
    expect(r.statusCode).toBe(409);
  });

  it('zavření projde a předá odvozenou adresu', async () => {
    let videno = '';
    const a = await app2({ prodluz: async () => true, zavri: async (ip) => { videno = ip; return true; } });
    const r = await a.inject({ method: 'POST', url: '/dvere/zavri',
      headers: { 'x-forwarded-for': '198.51.100.143, 192.168.2.1' } });
    await a.close();
    expect(r.statusCode).toBe(204);
    expect(videno).toBe('198.51.100.143');
  });
});

describe('brána: /ready měří mapu', () => {
  it('mapa odpovídá → 200', async () => {
    const a = await buildHealthApp(cfg, async () => ({ doorReady: true }));
    const r = await a.inject({ method: 'GET', url: '/ready' });
    await a.close();
    expect(r.statusCode).toBe(200);
  });

  it('⛔ PING mapy selhal (mrtvý netns držitele) → 503, ne zelená', async () => {
    const a = await buildHealthApp(cfg, async () => ({ doorReady: false }));
    const r = await a.inject({ method: 'GET', url: '/ready' });
    await a.close();
    expect(r.statusCode).toBe(503);
    expect(r.json()).toMatchObject({ door: 'down' });
  });

  it('roster z adresy nedorazil a základ je prázdný → 503', async () => {
    const a = await buildHealthApp(cfg, async () => ({ doorReady: true, rosterReady: false, zakladMa: false }));
    const r = await a.inject({ method: 'GET', url: '/ready' });
    await a.close();
    expect(r.statusCode).toBe(503);
    expect(r.json()).toMatchObject({ roster: 'down' });
  });

  it('roster z adresy nedorazil, ale technici mají základ → 200 a přizná „jen základ"', async () => {
    // Healthcheck kontejneru čte jen kód; 503 by shodilo dveře i technikům.
    const a = await buildHealthApp(cfg, async () => ({ doorReady: true, rosterReady: false, zakladMa: true }));
    const r = await a.inject({ method: 'GET', url: '/ready' });
    await a.close();
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ status: 'degraded', roster: 'jen-zaklad' });
  });

  it('server předává do /ready skutečný PING, ne existenci klienta', async () => {
    const { readFileSync } = await import('node:fs');
    const text = readFileSync(new URL('./server.ts', import.meta.url), 'utf8');
    expect(text).toMatch(/doorReady:\s*await door\.ping\(\)/);
    expect(text).not.toMatch(/doorReady:\s*door\.hasStore\(\)/);
  });
});

