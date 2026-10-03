/**
 * GET /object/public/* — beze změny se streamuje z úložiště; s parametry výřezu
 * (nebo u HEIC vždy) se doručí přes PODEPSANÝ imgproxy a v prohlížeči zůstává naše
 * adresa. Skutečný Fastify (inject), aby se měřily hlavičky i těla.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { Readable } from 'node:stream';

// Klíč a sůl z dokumentace imgproxy (veřejný příklad) — skládané za běhu, viz imgproxy-podpis.test.ts.
const { mockStat, mockStream, mockFetch, cfg, DOC_KEY, DOC_SALT } = vi.hoisted(() => {
  const DOC_KEY = ['943b421c9eb07c83', '0af81030552c8600', '9268de4e532ba2ee', '2eab8247c6da0881'].join('');
  const DOC_SALT = ['520f986b998545b4', '785e0defbc4f3c12', '03f22de2374a3d53', 'cb7a7fe9fea309c5'].join('');
  return {
    DOC_KEY,
    DOC_SALT,
    mockStat: vi.fn(),
    mockStream: vi.fn(),
    mockFetch: vi.fn(),
    cfg: {
      publicBuckets: new Set(['page-assets']),
      imgproxyUrl: 'http://imgproxy.test:8080',
      imgproxyKey: DOC_KEY,
      imgproxySalt: DOC_SALT,
    },
  };
});
vi.mock('../config.js', () => ({ config: cfg }));
vi.mock('../minio.js', () => ({
  statObjectOrNull: mockStat,
  getObjectStream: mockStream,
  getPublicUrl: (b: string, k: string) => `http://minio.test/${b}/${k}`,
}));
vi.mock('../lib/guarded-fetch.js', () => ({ guardedFetch: mockFetch }));

import { publicProxyRoute } from './public-proxy.js';
import { podepisCestu } from '../lib/imgproxy-podpis.js';

async function app() {
  const a = Fastify();
  await a.register(publicProxyRoute);
  return a;
}

beforeEach(() => {
  mockStat.mockReset();
  mockStream.mockReset();
  mockFetch.mockReset();
  cfg.imgproxyKey = DOC_KEY;
  cfg.imgproxySalt = DOC_SALT;
  mockStat.mockResolvedValue({ size: 3, lastModified: new Date('2026-09-24T00:00:00Z'), metaData: { 'content-type': 'image/jpeg' } });
  mockStream.mockImplementation(async () => Readable.from([Buffer.from('raw')]));
  // Tělo odpovědi se dá číst jen jednou — každé volání dostane ČERSTVOU Response.
  mockFetch.mockImplementation(
    async () =>
      new Response(Readable.toWeb(Readable.from([Buffer.from('webp-bytes')])) as unknown as ReadableStream, {
        status: 200,
        headers: { 'content-type': 'image/webp' },
      }),
  );
});

describe('veřejný objekt bez parametrů', () => {
  it('streamuje z úložiště, imgproxy se nevolá', async () => {
    const r = await (await app()).inject({ method: 'GET', url: '/object/public/page-assets/u/x.jpg' });
    expect(r.statusCode).toBe(200);
    expect(r.body).toBe('raw');
    expect(r.headers['content-type']).toBe('image/jpeg');
    expect(r.headers['cache-control']).toMatch(/immutable/);
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('neveřejný bucket a chybějící objekt jsou 404', async () => {
    const a = await app();
    expect((await a.inject({ method: 'GET', url: '/object/public/health-documents/u/x.jpg' })).statusCode).toBe(404);
    mockStat.mockResolvedValue(null);
    expect((await a.inject({ method: 'GET', url: '/object/public/page-assets/u/x.jpg' })).statusCode).toBe(404);
  });
});

describe('výřez přes podepsaný imgproxy', () => {
  it('parametry w/h/fx/fy/z dají podepsanou cestu s výřezem a ohniskem; odpověď se streamuje', async () => {
    const r = await (await app()).inject({
      method: 'GET',
      url: '/object/public/page-assets/u/x.jpg?w=640&h=360&fx=0.25&fy=0.75&z=2',
      headers: { accept: 'image/webp,*/*' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toBe('webp-bytes');
    expect(r.headers['content-type']).toBe('image/webp');
    expect(r.headers.vary).toBe('Accept');
    expect(mockStream).not.toHaveBeenCalled();

    const [adresa] = mockFetch.mock.calls[0] as [string];
    const cesta = '/c:0.5:0.5:fp:0.25:0.75/rs:fill:640:360/g:fp:0.5:0.5/plain/s3://page-assets/u/x.jpg@webp';
    expect(adresa).toBe(`http://imgproxy.test:8080/${podepisCestu(cesta, cfg.imgproxyKey, cfg.imgproxySalt)}${cesta}`);
    expect(adresa).not.toContain('/insecure/');
  });

  it('bez Accept webp jde jpg; HEIC jde přes imgproxy i bez parametrů (fit)', async () => {
    const a = await app();
    await a.inject({ method: 'GET', url: '/object/public/page-assets/u/x.jpg?w=100&h=100' });
    expect((mockFetch.mock.calls[0] as [string])[0]).toMatch(/\/rs:fill:100:100\/g:fp:0\.5:0\.5\/plain\/s3:\/\/page-assets\/u\/x\.jpg@jpg$/);

    mockFetch.mockClear();
    const r = await a.inject({ method: 'GET', url: '/object/public/page-assets/u/iphone.heic', headers: { accept: 'image/webp' } });
    expect(r.statusCode).toBe(200);
    expect((mockFetch.mock.calls[0] as [string])[0]).toMatch(/\/rs:fit:2000:2000\/plain\/s3:\/\/page-assets\/u\/iphone\.heic@webp$/);
    expect(mockStream).not.toHaveBeenCalled();
  });

  it('vadné parametry jsou 400 a nic se nevolá', async () => {
    const a = await app();
    for (const dotaz of ['w=0&h=10', 'w=10', 'w=10&h=10&z=9', 'w=10&h=10&fx=2', 'w=abc&h=10']) {
      const r = await a.inject({ method: 'GET', url: `/object/public/page-assets/u/x.jpg?${dotaz}` });
      expect(r.statusCode, dotaz).toBe(400);
    }
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockStream).not.toHaveBeenCalled();
  });

  it('bez klíče imgproxy je transformace 501 — nic se nedosazuje', async () => {
    cfg.imgproxyKey = '';
    const r = await (await app()).inject({ method: 'GET', url: '/object/public/page-assets/u/x.jpg?w=10&h=10' });
    expect(r.statusCode).toBe(501);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('klíč s nepovoleným znakem do cesty imgproxy nejde', async () => {
    const r = await (await app()).inject({ method: 'GET', url: '/object/public/page-assets/u/x%20y@z.jpg?w=10&h=10' });
    expect(r.statusCode).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('chyba imgproxy je 502, ne prázdný obrázek', async () => {
    mockFetch.mockImplementation(async () => new Response('boom', { status: 500 }));
    const r = await (await app()).inject({ method: 'GET', url: '/object/public/page-assets/u/x.jpg?w=10&h=10' });
    expect(r.statusCode).toBe(502);
  });
});
