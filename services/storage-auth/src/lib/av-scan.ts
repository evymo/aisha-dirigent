/**
 * av-scan.ts — ClamAV INSTREAM client (flow-through malware scanner).
 *
 * Streams an upload (or, later, a mail attachment) to the shared `clamd` sidecar
 * over TCP and returns a verdict. This is the BYTE/FILE stage of the content
 * pipeline — complementary to scanForInjection (the prompt-injection TEXT stage in
 * svc-mcp-knowledge). An object is promoted to a durable bucket / vectorized ONLY
 * when this returns `{ status: 'clean' }`.
 *
 * FAIL-CLOSED is the core invariant: a timeout, connection failure, malformed reply,
 * or any clamd error all resolve to `{ status: 'error' }`, which the caller MUST
 * treat exactly like `infected` (block, never promote). The scanner never throws —
 * it always resolves to a verdict so the caller cannot accidentally fall through to
 * a "promote anyway" path on an unexpected exception.
 *
 * INSTREAM protocol (clamd):
 *   → "zINSTREAM\0"                          (z-prefix ⇒ NUL-terminated reply)
 *   → <uint32be length><bytes> … per chunk   (size-prefixed frames)
 *   → "\0\0\0\0"                             (zero-length frame = end of stream)
 *   ← "stream: OK\0"                         clean
 *   ← "stream: <signature> FOUND\0"          infected
 *   ← "INSTREAM size limit exceeded\0" / "… ERROR\0"   error
 */
import net from 'node:net';
import { Readable } from 'node:stream';
import { config } from '../config.js';

/** A scan outcome. `error` is fail-closed: callers MUST treat it like `infected`. */
export type AvVerdict =
  | { status: 'clean' }
  | { status: 'infected'; signature: string }
  | { status: 'error'; reason: string };

export interface AvScanOptions {
  /** clamd host (default `config.clamdHost`). */
  host?: string;
  /** clamd INSTREAM port (default `config.clamdPort`). */
  port?: number;
  /** Per-scan timeout in ms; exceeding it is fail-closed (default `config.clamdTimeoutMs`). */
  timeoutMs?: number;
  /** Frame size for INSTREAM chunks (default 64 KiB — well under clamd's StreamMaxLength). */
  chunkSize?: number;
}

/** Accepted input shapes — a Buffer, or any (a)sync iterable of Buffers (e.g. a Readable). */
export type AvScanSource = Buffer | Readable | AsyncIterable<Buffer> | Iterable<Buffer>;

const INSTREAM_CMD = Buffer.from('zINSTREAM\0', 'ascii');
const ZERO_FRAME = Buffer.from([0, 0, 0, 0]);
const DEFAULT_CHUNK_SIZE = 64 * 1024;

/** True only for a definitively-clean verdict — the single gate to promotion. */
export function isClean(v: AvVerdict): boolean {
  return v.status === 'clean';
}

/**
 * Parse clamd's NUL-terminated INSTREAM reply into a verdict.
 * Defensive: anything that is not an explicit OK / FOUND is an error (fail-closed).
 */
export function parseClamdReply(raw: Buffer): AvVerdict {
  // Strip trailing NUL(s) and whitespace; clamd z-replies end in "\0".
  const text = raw.toString('utf8').replace(/\0+$/g, '').trim();
  if (!text) return { status: 'error', reason: 'empty clamd reply' };

  const found = text.match(/^stream:\s*(.+?)\s+FOUND$/i);
  if (found) return { status: 'infected', signature: found[1] };
  if (/\bFOUND$/i.test(text)) {
    const sig = text.replace(/^stream:\s*/i, '').replace(/\s*FOUND$/i, '').trim();
    return { status: 'infected', signature: sig || 'unknown' };
  }
  if (/\bOK$/.test(text)) return { status: 'clean' };

  // "… ERROR", "INSTREAM size limit exceeded", or anything unexpected → fail-closed.
  return { status: 'error', reason: text };
}

/** Frame a payload slice as <uint32be length><bytes> in a single allocation. */
function frame(slice: Buffer): Buffer {
  const out = Buffer.allocUnsafe(4 + slice.length);
  out.writeUInt32BE(slice.length, 0);
  slice.copy(out, 4);
  return out;
}

/** Resolve once the socket buffer can accept more (drain), or the scan settles/closes. */
function awaitDrain(socket: net.Socket, state: { settled: boolean }): Promise<void> {
  return new Promise((resolve) => {
    if (state.settled) return resolve();
    const onDrain = () => { cleanup(); resolve(); };
    const onClose = () => { cleanup(); resolve(); };
    const cleanup = () => {
      socket.off('drain', onDrain);
      socket.off('close', onClose);
    };
    socket.once('drain', onDrain);
    socket.once('close', onClose);
  });
}

/** Pump the source through the socket as framed INSTREAM chunks, honouring backpressure. */
async function pump(
  socket: net.Socket,
  source: AvScanSource,
  chunkSize: number,
  state: { settled: boolean },
): Promise<void> {
  socket.write(INSTREAM_CMD);
  const iterable: Iterable<Buffer> | AsyncIterable<Buffer> = Buffer.isBuffer(source) ? [source] : source;
  for await (const chunk of iterable) {
    if (state.settled) return; // clamd already replied (e.g. size limit) → stop sending
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    for (let off = 0; off < buf.length; off += chunkSize) {
      if (state.settled) return;
      const slice = buf.subarray(off, Math.min(off + chunkSize, buf.length));
      if (!socket.write(frame(slice))) {
        await awaitDrain(socket, state);
      }
    }
  }
  if (!state.settled) socket.write(ZERO_FRAME);
}

/**
 * Scan an arbitrary source against clamd. Never throws — always resolves to a verdict.
 * On any transport/protocol failure resolves `{ status: 'error' }` (fail-closed).
 */
export function scan(source: AvScanSource, opts: AvScanOptions = {}): Promise<AvVerdict> {
  const host = opts.host ?? config.clamdHost;
  const port = opts.port ?? config.clamdPort;
  const timeoutMs = opts.timeoutMs ?? config.clamdTimeoutMs;
  const chunkSize = opts.chunkSize ?? DEFAULT_CHUNK_SIZE;

  return new Promise<AvVerdict>((resolve) => {
    const state = { settled: false };
    let reply = Buffer.alloc(0);

    const socket = net.connect({ host, port });
    socket.setNoDelay(true);

    const finish = (v: AvVerdict): void => {
      if (state.settled) return;
      state.settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(v);
    };

    // `finish` closes over `timer`; that reference is deferred (only fires on an async
    // event), so declaring `timer` as a const here is safe and satisfies prefer-const.
    const timer = setTimeout(
      () => finish({ status: 'error', reason: `clamd scan exceeded ${timeoutMs}ms` }),
      timeoutMs,
    );

    socket.on('error', (err) => finish({ status: 'error', reason: `clamd unreachable: ${err.message}` }));
    socket.on('data', (d: Buffer) => {
      reply = Buffer.concat([reply, d]);
      // z-prefix reply is NUL-terminated → verdict is complete on the first NUL.
      if (reply.includes(0x00)) finish(parseClamdReply(reply));
    });
    socket.on('end', () => finish(parseClamdReply(reply)));
    socket.on('close', () =>
      finish(reply.length ? parseClamdReply(reply) : { status: 'error', reason: 'clamd closed without a verdict' }),
    );
    socket.on('connect', () => {
      pump(socket, source, chunkSize, state).catch((err: unknown) =>
        finish({ status: 'error', reason: `stream read error: ${err instanceof Error ? err.message : String(err)}` }),
      );
    });
  });
}

/** Convenience: scan a fully-buffered payload. */
export function scanBuffer(data: Buffer, opts: AvScanOptions = {}): Promise<AvVerdict> {
  return scan(data, opts);
}

/** Convenience: scan a Node Readable (e.g. an S3 GetObject body) without buffering it. */
export function scanStream(stream: Readable, opts: AvScanOptions = {}): Promise<AvVerdict> {
  return scan(stream, opts);
}
