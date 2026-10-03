/**
 * av-scan unit tests — drive the INSTREAM client against an in-process mock clamd
 * TCP server. Fully deterministic; no live clamd, no network egress. The mock
 * reassembles the framed stream so we also assert the wire protocol (NUL-terminated
 * command, uint32be frames, zero-frame terminator) round-trips the payload intact.
 */
import net from 'node:net';
import { Readable } from 'node:stream';
import { describe, it, expect, afterEach } from 'vitest';
import { scanBuffer, scanStream, parseClamdReply, isClean, type AvVerdict } from './av-scan.js';

interface MockClamd {
  port: number;
  /** Payload reassembled from the last completed INSTREAM, for protocol assertions. */
  lastPayload: () => Buffer;
  close: () => Promise<void>;
}

/**
 * Start a mock clamd that speaks INSTREAM. `responder(payload)` returns the reply
 * string (without the trailing NUL — added here) or null to send nothing.
 * `delayMs` defers the reply; `neverReply` accepts the stream but never answers
 * (to exercise the client timeout).
 */
function startMockClamd(
  responder: (payload: Buffer) => string | null,
  opts: { delayMs?: number; neverReply?: boolean } = {},
): Promise<MockClamd> {
  let captured = Buffer.alloc(0);
  const server = net.createServer((socket) => {
    let buf = Buffer.alloc(0);
    const chunks: Buffer[] = [];
    let sawCmd = false;

    socket.on('data', (d: Buffer) => {
      buf = Buffer.concat([buf, d]);

      if (!sawCmd) {
        const nul = buf.indexOf(0x00);
        if (nul === -1) return; // command not fully arrived
        // (command bytes before the NUL are "zINSTREAM"; we don't assert here)
        buf = buf.subarray(nul + 1);
        sawCmd = true;
      }

      // Drain complete frames.
      while (buf.length >= 4) {
        const len = buf.readUInt32BE(0);
        if (len === 0) {
          buf = buf.subarray(4);
          captured = Buffer.concat(chunks);
          if (opts.neverReply) return;
          const reply = responder(captured);
          const send = (): void => {
            if (reply !== null) socket.write(Buffer.from(reply + '\0', 'ascii'));
            socket.end();
          };
          if (opts.delayMs) setTimeout(send, opts.delayMs);
          else send();
          return;
        }
        if (buf.length < 4 + len) break; // frame body not fully arrived
        chunks.push(buf.subarray(4, 4 + len));
        buf = buf.subarray(4 + len);
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo;
      resolve({
        port: addr.port,
        lastPayload: () => captured,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}

const HOST = '127.0.0.1';
let mock: MockClamd | null = null;

afterEach(async () => {
  if (mock) {
    await mock.close();
    mock = null;
  }
});

describe('parseClamdReply (pure)', () => {
  it('treats "stream: OK" as clean', () => {
    expect(parseClamdReply(Buffer.from('stream: OK\0'))).toEqual({ status: 'clean' });
  });

  it('extracts the signature from a FOUND reply', () => {
    expect(parseClamdReply(Buffer.from('stream: Win.Test.EICAR_HDB-1 FOUND\0'))).toEqual({
      status: 'infected',
      signature: 'Win.Test.EICAR_HDB-1',
    });
  });

  it('maps an empty reply to fail-closed error', () => {
    expect(parseClamdReply(Buffer.from('\0')).status).toBe('error');
  });

  it('maps "INSTREAM size limit exceeded" to fail-closed error', () => {
    const v = parseClamdReply(Buffer.from('INSTREAM size limit exceeded\0'));
    expect(v.status).toBe('error');
  });
});

describe('scan against mock clamd', () => {
  it('returns clean for an OK reply and round-trips the payload intact', async () => {
    mock = await startMockClamd(() => 'stream: OK');
    const payload = Buffer.from('a perfectly innocent document', 'utf8');

    const verdict = await scanBuffer(payload, { host: HOST, port: mock.port });

    expect(verdict).toEqual({ status: 'clean' });
    expect(isClean(verdict)).toBe(true);
    // The mock reassembled the framed stream → proves command + framing + terminator.
    expect(mock.lastPayload().equals(payload)).toBe(true);
  });

  it('returns infected with the signature for a FOUND reply', async () => {
    mock = await startMockClamd(() => 'stream: Eicar-Test-Signature FOUND');
    const verdict = await scanBuffer(Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}'), { host: HOST, port: mock.port });
    expect(verdict).toEqual({ status: 'infected', signature: 'Eicar-Test-Signature' });
    expect(isClean(verdict)).toBe(false);
  });

  it('reassembles a multi-frame payload larger than one chunk', async () => {
    mock = await startMockClamd(() => 'stream: OK');
    // 200 KiB with a tiny chunkSize forces many frames + at least one backpressure cycle.
    const big = Buffer.alloc(200 * 1024, 0x41);
    const verdict = await scanBuffer(big, { host: HOST, port: mock.port, chunkSize: 8 * 1024 });
    expect(verdict.status).toBe('clean');
    expect(mock.lastPayload().length).toBe(big.length);
    expect(mock.lastPayload().equals(big)).toBe(true);
  });

  it('scans a Readable stream without buffering', async () => {
    mock = await startMockClamd(() => 'stream: OK');
    const parts = ['chunk-one ', 'chunk-two ', 'chunk-three'];
    const stream = Readable.from(parts.map((p) => Buffer.from(p)));
    const verdict = await scanStream(stream, { host: HOST, port: mock.port });
    expect(verdict.status).toBe('clean');
    expect(mock.lastPayload().toString()).toBe(parts.join(''));
  });

  it('maps a clamd ERROR reply to fail-closed error', async () => {
    mock = await startMockClamd(() => 'INSTREAM size limit exceeded');
    const verdict = await scanBuffer(Buffer.from('whatever'), { host: HOST, port: mock.port });
    expect(verdict.status).toBe('error');
  });
});

describe('fail-closed transport failures', () => {
  it('returns error (never throws) when clamd is unreachable', async () => {
    // Bind then immediately close to obtain a port nothing is listening on.
    const probe = net.createServer();
    const freePort = await new Promise<number>((resolve) => {
      probe.listen(0, '127.0.0.1', () => resolve((probe.address() as net.AddressInfo).port));
    });
    await new Promise<void>((res) => probe.close(() => res()));

    const verdict: AvVerdict = await scanBuffer(Buffer.from('payload'), {
      host: HOST,
      port: freePort,
      timeoutMs: 2000,
    });
    expect(verdict.status).toBe('error');
  });

  it('returns error when clamd accepts but never replies (timeout)', async () => {
    mock = await startMockClamd(() => 'stream: OK', { neverReply: true });
    const verdict = await scanBuffer(Buffer.from('payload'), {
      host: HOST,
      port: mock.port,
      timeoutMs: 300,
    });
    expect(verdict.status).toBe('error');
  });
});
