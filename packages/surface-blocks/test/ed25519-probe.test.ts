import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateEd25519KeyPairJwk } from '../src/snapshot.js';

/**
 * The Ed25519 capability probe decides which verifier this runtime uses. Failing
 * is a legitimate answer for a probe — but the answer silently switches snapshot
 * signature checking to the fallback path, and a verification path that moves
 * with nobody told is what the silent-degradation gate exists to catch.
 *
 * Lives in test/ rather than src/: the package's tsconfig compiles `include:
 * ['src']` with no exclude, so a test file under src/ becomes part of the
 * published build — which is how the first version of this test broke CI.
 */
describe('snapshot — Ed25519 capability probe', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('announces the fallback instead of degrading in silence', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // Fail the probe exactly the way a runtime without Ed25519 does.
    vi.spyOn(crypto.subtle, 'generateKey').mockRejectedValue(
      new Error('Unrecognized algorithm name'),
    );

    await generateEd25519KeyPairJwk();

    expect(warn, 'the probe degraded without saying so').toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(' ')).toContain('Ed25519');
  });
});
