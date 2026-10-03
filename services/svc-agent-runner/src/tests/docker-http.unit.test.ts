import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Skutečný HTTP server na unixovém socketu, který odpovídá jako Docker 29
// (Transfer-Encoding: chunked) — žádný mock transportu.
const sock = vi.hoisted(() => ({ path: '' }));
vi.mock('../config.js', () => ({ config: { get dockerSocket() { return sock.path; } } }));

import { dockerJSON, dockerRequest, dockerStart } from '../backends/docker-http.js';

let dir = '';
let server: http.Server;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'docker-http-'));
  sock.path = join(dir, 'docker.sock');
  server = http.createServer((req, res) => {
    if (req.url === '/v1.45/networks') {
      // Dva kusy bez Content-Length → Node pošle `Transfer-Encoding: chunked`,
      // přesně jako Docker Engine 29.7.2 na riq (2026-09-30).
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write('[{"Name":"bridge"},');
      res.end('{"Name":"aisha-exec-net"}]');
      return;
    }
    if (req.url === '/v1.45/utf8') {
      // Vícebajtový znak rozdělený mezi dva kusy.
      const b = Buffer.from('{"jmeno":"Řidič"}', 'utf8');
      const cut = b.indexOf(0xc5) + 1; // uprostřed „Ř“
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write(b.subarray(0, cut));
      res.end(b.subarray(cut));
      return;
    }
    if (req.url === '/v1.45/echo' && req.method === 'POST') {
      let raw = '';
      req.on('data', (c: Buffer) => { raw += c.toString('utf8'); });
      req.on('end', () => { res.writeHead(201, { 'Content-Type': 'application/json' }); res.end(raw); });
      return;
    }
    if (req.method === 'POST' && req.url === '/v1.45/containers/ok/start') { res.writeHead(204); res.end(); return; }
    if (req.method === 'POST' && req.url === '/v1.45/containers/bezi/start') { res.writeHead(304); res.end(); return; }
    if (req.method === 'POST' && req.url === '/v1.45/containers/spatne/start') {
      // Tvar odpovědi Dockeru, když síť v EndpointsConfig neexistuje (riq 2026-09-30).
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{"message":"network aisha-network not found"}');
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{"message":"page not found"}');
  });
  await new Promise<void>((r) => server.listen(sock.path, () => r()));
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(dir, { recursive: true, force: true });
});

describe('dockerJSON / dockerRequest nad unixovým socketem', () => {
  it('odpověď po kusech (chunked) se přečte jako JSON — naměřená vada z riq', async () => {
    const nets = await dockerJSON<Array<{ Name: string }>>('GET', '/v1.45/networks');
    expect(nets.map((n) => n.Name)).toEqual(['bridge', 'aisha-exec-net']);
  });

  it('vícebajtový znak na hranici kusů se nerozbije', async () => {
    expect(await dockerJSON<{ jmeno: string }>('GET', '/v1.45/utf8')).toEqual({ jmeno: 'Řidič' });
  });

  it('tělo požadavku dojde celé a status se vrátí', async () => {
    const res = await dockerRequest('POST', '/v1.45/echo', { Image: 'aisha/plugin-exec:v1' });
    expect(res.status).toBe(201);
    expect(JSON.parse(res.body)).toEqual({ Image: 'aisha/plugin-exec:v1' });
  });

  it('chyba Dockeru (≥ 400) se ohlásí i s cestou, ne jako chyba parsování', async () => {
    await expect(dockerJSON('GET', '/1.45/networks')).rejects.toThrow(/Docker API GET \/1\.45\/networks => 404/);
  });

  it('start: 204 i 304 projde, chyba se ohlásí se zprávou Dockeru — ne tiché „Exit code 128“', async () => {
    await expect(dockerStart('/v1.45', 'ok')).resolves.toBeUndefined();
    await expect(dockerStart('/v1.45', 'bezi')).resolves.toBeUndefined();
    await expect(dockerStart('/v1.45', 'spatne')).rejects.toThrow(/start => 404: .*network aisha-network not found/);
  });
});
