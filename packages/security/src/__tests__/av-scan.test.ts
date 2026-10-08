/**
 * av-scan (shared clamd client) — against an in-process mock clamd. Deterministic,
 * no live clamd, no egress.
 *
 * The wire protocol itself (framing, backpressure, multi-frame payloads) is exercised
 * through storage-auth's wrapper in services/storage-auth/src/lib/av-scan.test.ts —
 * that suite predates the move and still runs every call through THIS module. Here
 * we pin what the move added: the target is passed in (no service config, no
 * defaults), and `ping` tells "the scanner is down" from "this file is bad".
 */
import net from 'node:net';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { isClean, parseClamdReply, ping, scan, scanBuffer, scanStream } from '../av-scan.js';

interface Mock {
  port: number;
  payloads: Buffer[];
  commands: string[];
  close: () => Promise<void>;
}

/** Mock clamd: answers zPING with PONG (or `pong` override) and INSTREAM via `verdict`. */
function mockClamd(opts: { verdict?: string; pong?: string | null; silent?: boolean } = {}): Promise<Mock> {
  const payloads: Buffer[] = [];
  const commands: string[] = [];
  const server = net.createServer((socket) => {
    let buf = Buffer.alloc(0);
    let cmd: string | null = null;
    const chunks: Buffer[] = [];
    socket.on('error', () => undefined);
    socket.on('data', (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      if (cmd === null) {
        const nul = buf.indexOf(0x00);
        if (nul === -1) return;
        cmd = buf.subarray(0, nul).toString('ascii');
        commands.push(cmd);
        buf = buf.subarray(nul + 1);
        if (cmd === 'zPING') {
          if (opts.silent) return;
          if (opts.pong !== null) socket.write(Buffer.from((opts.pong ?? 'PONG') + '\0', 'ascii'));
          socket.end();
          return;
        }
      }
      while (buf.length >= 4) {
        const len = buf.readUInt32BE(0);
        if (len === 0) {
          payloads.push(Buffer.concat(chunks));
          if (opts.silent) return;
          socket.write(Buffer.from((opts.verdict ?? 'stream: OK') + '\0', 'ascii'));
          socket.end();
          return;
        }
        if (buf.length < 4 + len) break;
        chunks.push(buf.subarray(4, 4 + len));
        buf = buf.subarray(4 + len);
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: (server.address() as net.AddressInfo).port,
        payloads,
        commands,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}

/** A port nothing listens on. */
async function freePort(): Promise<number> {
  const probe = net.createServer();
  const port = await new Promise<number>((resolve) => {
    probe.listen(0, '127.0.0.1', () => resolve((probe.address() as net.AddressInfo).port));
  });
  await new Promise<void>((res) => probe.close(() => res()));
  return port;
}

const HOST = '127.0.0.1';
let mock: Mock | null = null;
afterEach(async () => {
  if (mock) {
    await mock.close();
    mock = null;
  }
});

describe('scan — the target is the caller\'s, not this module\'s', () => {
  it('scans a buffer and a stream against the target it was given', async () => {
    mock = await mockClamd();
    const target = { host: HOST, port: mock.port, timeoutMs: 2000 };

    const fromBuffer = await scanBuffer(Buffer.from('nevinný dokument'), target);
    expect(fromBuffer).toEqual({ status: 'clean' });
    expect(isClean(fromBuffer)).toBe(true);

    const fromStream = await scanStream(Readable.from([Buffer.from('část 1 '), Buffer.from('část 2')]), target);
    expect(fromStream.status).toBe('clean');
    expect(mock.payloads.map((p) => p.toString())).toEqual(['nevinný dokument', 'část 1 část 2']);
    expect(mock.commands).toEqual(['zINSTREAM', 'zINSTREAM']);
  });

  it('reports the signature and never calls an infected file clean', async () => {
    mock = await mockClamd({ verdict: 'stream: Eicar-Test-Signature FOUND' });
    const v = await scan(Buffer.from('x'), { host: HOST, port: mock.port, timeoutMs: 2000 });
    expect(v).toEqual({ status: 'infected', signature: 'Eicar-Test-Signature' });
    expect(isClean(v)).toBe(false);
  });

  it('is fail-closed on an unreachable or silent clamd — error, never clean, never a throw', async () => {
    const unreachable = await scan(Buffer.from('x'), { host: HOST, port: await freePort(), timeoutMs: 2000 });
    expect(unreachable.status).toBe('error');

    mock = await mockClamd({ silent: true });
    const silent = await scan(Buffer.from('x'), { host: HOST, port: mock.port, timeoutMs: 300 });
    expect(silent.status).toBe('error');
    expect(isClean(silent)).toBe(false);
  });
});

describe('error kinds — a file defect is told apart from a platform state', () => {
  it('"clean" is exactly clamd\'s INSTREAM answer, not anything that ends in OK', () => {
    expect(parseClamdReply(Buffer.from('stream: OK\0'))).toEqual({ status: 'clean' });
    for (const odpoved of ['NOT OK', 'stream: something is not OK', 'OK', 'stream:OK', 'stream: OK ERROR']) {
      expect(parseClamdReply(Buffer.from(odpoved + '\0')).status, odpoved).toBe('error');
    }
  });

  // infra/clamav/clamd.conf sets AlertExceedsMax: content clamd did NOT inspect (payload
  // deeper than MaxRecursion, past MaxScanSize/MaxFileSize) comes back as a heuristic
  // FOUND instead of "stream: OK". That reply must block — never read as clean.
  it('a limit clamd hit (AlertExceedsMax) blocks: heuristic FOUND is a finding, never clean', () => {
    for (const sig of [
      'Heuristics.Limits.Exceeded',
      'Heuristics.Limits.Exceeded.MaxRecursion',
      'Heuristics.Limits.Exceeded.MaxScanSize',
      'Heuristics.Limits.Exceeded.MaxFileSize',
    ]) {
      const v = parseClamdReply(Buffer.from(`stream: ${sig} FOUND\0`));
      expect(v, sig).toEqual({ status: 'infected', signature: sig });
      expect(isClean(v), sig).toBe(false);
    }
    // any other wording of "over a limit" is not the clean answer either → fail-closed error
    for (const odpoved of ['stream: Exceeds max recursion', 'Exceeds max scan size. ERROR', 'stream: OK (limits exceeded)']) {
      const v = parseClamdReply(Buffer.from(odpoved + '\0'));
      expect(v.status, odpoved).toBe('error');
      expect(isClean(v), odpoved).toBe(false);
    }
  });

  it('names WHY there is no verdict: size limit, clamd error, timeout, transport, the caller\'s stream', async () => {
    expect(parseClamdReply(Buffer.from('INSTREAM size limit exceeded. ERROR\0'))).toMatchObject({ status: 'error', kind: 'size_limit' });
    expect(parseClamdReply(Buffer.from('Cannot allocate memory. ERROR\0'))).toMatchObject({ status: 'error', kind: 'clamd' });
    expect(parseClamdReply(Buffer.from('\0'))).toMatchObject({ status: 'error', kind: 'transport' });

    mock = await mockClamd({ silent: true });
    expect(await scanBuffer(Buffer.from('x'), { host: HOST, port: mock.port, timeoutMs: 150 })).toMatchObject({
      status: 'error',
      kind: 'timeout',
    });
    expect(await scanBuffer(Buffer.from('x'), { host: HOST, port: await freePort(), timeoutMs: 1000 })).toMatchObject({
      status: 'error',
      kind: 'transport',
    });
    async function* rozbityProud(): AsyncGenerator<Buffer> {
      yield Buffer.from('začátek');
      throw new Error('EIO: čtení selhalo');
    }
    expect(await scan(rozbityProud(), { host: HOST, port: mock.port, timeoutMs: 1000 })).toMatchObject({
      status: 'error',
      kind: 'source',
    });
  });
});

describe('ping — is the scanner there at all', () => {
  it('is true only for a PONG', async () => {
    mock = await mockClamd();
    expect(await ping({ host: HOST, port: mock.port, timeoutMs: 2000 })).toBe(true);
    expect(mock.commands).toEqual(['zPING']);
  });

  it('is false for anything else: wrong reply, silence, nobody listening', async () => {
    mock = await mockClamd({ pong: 'UNKNOWN COMMAND' });
    expect(await ping({ host: HOST, port: mock.port, timeoutMs: 2000 })).toBe(false);
    await mock.close();

    mock = await mockClamd({ silent: true });
    expect(await ping({ host: HOST, port: mock.port, timeoutMs: 300 })).toBe(false);

    expect(await ping({ host: HOST, port: await freePort(), timeoutMs: 2000 })).toBe(false);
  });
});
