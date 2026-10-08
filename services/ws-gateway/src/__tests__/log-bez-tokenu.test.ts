/**
 * ws-gateway: připojení `/ws?token=<JWT>` nesmí dát token do logu.
 *
 * Klient posílá přístupový token v dotazu (prohlížečový WebSocket hlavičky
 * neumí). Výchozí logování požadavků Fastify zapisovalo URL i s dotazem, takže
 * každý připojený klient nechal v logu živý JWT (nezávislá revize 2026-10-05).
 *
 * Test staví logger i aplikaci STEJNÝM tvarem jako server.ts —
 * `pino(safeLoggerOptions({ level }))` jako `loggerInstance` — a čte, co logger
 * opravdu zapsal. Že server.ts ten tvar drží, hlídá brána
 * `sluzby-logger-z-tovarny`.
 */
import { Writable } from 'node:stream';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import websocket from '@fastify/websocket';
import pino from 'pino';
import { safeLoggerOptions } from '@aisha/security';
import { afterEach, describe, expect, it } from 'vitest';

// JWT tvar (hlavička {"alg":"HS256"}), testovací hodnota — ne skutečný token.
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.dGVzdC1wb2RwaXM';

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

async function aplikace(proud: Writable) {
  const log = pino(safeLoggerOptions({ level: 'info' }), proud);
  const app = Fastify({ loggerInstance: log as FastifyBaseLogger });
  await app.register(websocket);
  app.get('/ws', { websocket: true }, (socket) => {
    socket.close(4001, 'Unauthorized');
  });
  await app.ready();
  return app;
}

describe('ws-gateway log: token z dotazu se nezapíše', () => {
  let zavrit: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await zavrit?.();
    zavrit = undefined;
  });

  it('WebSocket připojení: cesta i neškodný parametr zůstanou, token ne', async () => {
    const z = zachyceny();
    const app = await aplikace(z.proud);
    zavrit = () => app.close();

    // Řádek „incoming request" vzniká při upgradu, před obsluhou trasy;
    // na zavření spojení se nečeká (rámec close může přijít v témže kusu jako 101).
    const ws = await app.injectWS(`/ws?token=${JWT}&topics=news`);
    ws.terminate();

    expect(z.syrove()).not.toContain(JWT);
    const prichozi = z.radky().find((r) => r.msg === 'incoming request');
    expect(prichozi, 'Fastify loguje každý požadavek — řádek musí existovat').toBeDefined();
    const url = (prichozi!.req as { url: string }).url;
    expect(url.startsWith('/ws?token=')).toBe(true);
    expect(url).toContain('topics=news');
  });

  it('obyčejný HTTP požadavek na /ws a překlep cesty (404 opisuje URL do zprávy)', async () => {
    const z = zachyceny();
    const app = await aplikace(z.proud);
    zavrit = () => app.close();

    await app.inject({ method: 'GET', url: `/ws?token=${JWT}&topics=news` });
    await app.inject({ method: 'GET', url: `/ws/?token=${JWT}&topics=news` });

    expect(z.syrove()).not.toContain(JWT);
    const nenalezeno = z.radky().find((r) => typeof r.msg === 'string' && r.msg.includes('not found'));
    expect(nenalezeno, '404 řádek se dál píše').toBeDefined();
    expect(nenalezeno!.msg).toContain('topics=news');
  });
});
