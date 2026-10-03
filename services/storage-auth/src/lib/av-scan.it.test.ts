/**
 * av-scan INTEGRATION test — the INSTREAM client against a REAL clamd (the same hardened image
 * as production). This is the assurance the unit test (mock TCP server) cannot give: that the
 * hand-rolled protocol framing + verdict parsing are correct against the actual daemon,
 * including the EICAR standard AV test signature.
 *
 * Run only by scripts/test/run-av-integration.mjs (npm run test:integration:av), which brings
 * up clamd + sets AV_IT=1 + CLAMD_HOST/CLAMD_PORT. Self-skips everywhere else.
 */
import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { scanBuffer, scanStream } from './av-scan.js';

const AV_IT = process.env.AV_IT === '1';

// EICAR standard antivirus test string — assembled from parts at runtime so this source file
// is not itself flagged by scanners. https://www.eicar.org/download-anti-malware-testfile/
const EICAR = ['X5O!P%@AP[4\\PZX54(P^)7CC)7}', '$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!', '$H+H*'].join('');

const opts = {
  host: process.env.CLAMD_HOST ?? '127.0.0.1',
  port: Number(process.env.CLAMD_PORT ?? 3310),
  timeoutMs: 60_000,
};

describe.skipIf(!AV_IT)('av-scan against REAL clamd', () => {
  it('flags the EICAR test signature as infected (with a signature name)', async () => {
    const v = await scanBuffer(Buffer.from(EICAR, 'ascii'), opts);
    expect(v.status).toBe('infected');
    if (v.status === 'infected') expect(v.signature.length).toBeGreaterThan(0);
  });

  it('passes a clean payload', async () => {
    const v = await scanBuffer(Buffer.from('a perfectly innocent document\n'.repeat(200)), opts);
    expect(v.status).toBe('clean');
  });

  it('passes a clean multi-MB stream (real framing + backpressure)', async () => {
    const big = Buffer.alloc(3 * 1024 * 1024, 0x41);
    const v = await scanStream(Readable.from([big]), opts);
    expect(v.status).toBe('clean');
  });

  it('fail-closed when clamd is unreachable (wrong port → error, never throws)', async () => {
    const v = await scanBuffer(Buffer.from('x'), { host: opts.host, port: 1, timeoutMs: 2000 });
    expect(v.status).toBe('error');
  });
});
