/**
 * Testy AVP klienta. Každá kontrola stojí na odchylce, která byla naměřena
 * proti ostrému API 2026-08-18 (viz README pluginu) — ne na tom, co slibuje
 * dodavatelská dokumentace.
 */
import { describe, expect, it } from 'vitest';
import {
  AvpApiError,
  buildQueryString,
  createAvpClient,
  type AvpSession,
} from '../avp-client.ts';

const SESSION: AvpSession = { token: 'tok', ownership: 'vzorova-firma/', userId: 56 };

/** Odpovědi z AVP chodí s UTF-8 BOM — testy ho musí posílat taky. */
function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(`\uFEFF${JSON.stringify(body)}`, { status: 200, ...init });
}

function clientWith(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  const calls: string[] = [];
  const client = createAvpClient({
    baseUrl: 'https://vzorova.avp-portal.cz',
    database: 'vzorova',
    timeoutMs: 1000,
    fetchImpl: (url, init) => {
      calls.push(url);
      return handler(url, init);
    },
  });
  return { client, calls };
}

describe('buildQueryString', () => {
  it('serializuje filtry s prefixem $ a nechá $ nezakódovaný', () => {
    const qs = buildQueryString({ filters: { tankId: 1, removed: false } });
    expect(qs).toContain('$tankId=1');
    expect(qs).toContain('$removed=false');
    expect(qs).not.toContain('%24');
  });

  it('zachová tečky v rozsahu $time=X...Y', () => {
    const qs = buildQueryString({ filters: { time: '2026-08-01T00:00:00Z...2026-08-18T23:59:59Z' } });
    expect(qs).toContain('2026-08-01T00%3A00%3A00Z...2026-08-18T23%3A59%3A59Z');
  });

  it('spojí with a only čárkou a přenese sort/limit/offset', () => {
    const qs = buildQueryString({
      with: ['driver.name', 'vehicle.name'],
      only: ['time', 'liters'],
      sort: '-time',
      limit: 10,
      offset: 20,
    });
    expect(qs).toContain('with=driver.name%2Cvehicle.name');
    expect(qs).toContain('only=time%2Cliters');
    expect(qs).toContain('sort=-time');
    expect(qs).toContain('limit=10');
    expect(qs).toContain('offset=20');
  });

  it('prázdný dotaz nevyrobí žádné parametry', () => {
    expect(buildQueryString()).toBe('');
  });
});

describe('signIn', () => {
  it('vytáhne token a ownership z odpovědi s BOM', async () => {
    const { client, calls } = clientWith(async () =>
      jsonResponse({ user: { uid: 'api-user', ownership: 'vzorova-firma/', id: 56 }, token: 'abc' }),
    );
    const session = await client.signIn({ username: 'api-user', password: 'x' });
    expect(session).toEqual({ token: 'abc', ownership: 'vzorova-firma/', userId: 56 });
    expect(calls[0]).toBe('https://vzorova.avp-portal.cz/api/signin');
  });

  it('odpověď bez tokenu je chyba, ne prázdná session', async () => {
    const { client } = clientWith(async () => jsonResponse({ user: { id: 1 } }));
    await expect(client.signIn({ username: 'a', password: 'b' })).rejects.toThrow(AvpApiError);
  });
});

describe('list', () => {
  it('skládá cestu z databáze, ne z ownership', async () => {
    const { client, calls } = clientWith(async () => jsonResponse([]));
    await client.list(SESSION, 'fuelings', { limit: 1 });
    expect(calls[0]).toBe('https://vzorova.avp-portal.cz/api/vzorova/fuelings?limit=1');
    expect(calls[0]).not.toContain('vzorovaolomy');
  });

  it('posílá token v hlavičce Authorization', async () => {
    let seen: HeadersInit | undefined;
    const { client } = clientWith(async (_url, init) => {
      seen = init?.headers;
      return jsonResponse([]);
    });
    await client.list(SESSION, 'tanks');
    expect((seen as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('403 „Database is disabled" propadne jako AvpApiError s reason phrase', async () => {
    // Server vrací PRÁZDNÉ tělo a informaci nese jen statusText.
    const { client } = clientWith(async () =>
      new Response('', { status: 403, statusText: 'Forbidden: Database is disabled' }),
    );
    await expect(client.list(SESSION, 'fuelings')).rejects.toThrow(/Database is disabled/);
  });

  it('HTML místo JSON (SPA fallback na neznámé cestě) je chyba, ne prázdný výsledek', async () => {
    const { client } = clientWith(async () =>
      new Response('\uFEFF<!doctype html>\n<html lang="cs">', { status: 200 }),
    );
    await expect(client.list(SESSION, 'blabla')).rejects.toThrow(/SPA fallback/);
  });

  it('objekt místo pole je chyba', async () => {
    const { client } = clientWith(async () => jsonResponse({ id: 1 }));
    await expect(client.list(SESSION, 'fuelings')).rejects.toThrow(/expected array/);
  });
});

describe('listAll', () => {
  it('stránkuje přes offset a řadí podle id, dokud stránka není neúplná', async () => {
    const pages = [[{ id: 1 }, { id: 2 }], [{ id: 3 }]];
    const { client, calls } = clientWith(async (url) => {
      const offset = Number(new URL(url).searchParams.get('offset'));
      return jsonResponse(pages[offset / 2] ?? []);
    });

    const all = await client.listAll<{ id: number }>(SESSION, 'fuelings', {}, 2);

    expect(all.map((r) => r.id)).toEqual([1, 2, 3]);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('sort=id');
    expect(calls[0]).toContain('offset=0');
    expect(calls[1]).toContain('offset=2');
  });

  it('plná poslední stránka si vyžádá ještě jeden dotaz', async () => {
    const { client, calls } = clientWith(async (url) => {
      const offset = Number(new URL(url).searchParams.get('offset'));
      return jsonResponse(offset === 0 ? [{ id: 1 }, { id: 2 }] : []);
    });
    await client.listAll(SESSION, 'tanks', {}, 2);
    expect(calls).toHaveLength(2);
  });
});
