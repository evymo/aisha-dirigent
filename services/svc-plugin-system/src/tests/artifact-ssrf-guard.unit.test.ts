import { describe, it, expect } from 'vitest';
import { downloadAndVerifyArtifact } from '../sandbox.js';

/**
 * REGRESSION — plugin artifact download must be SSRF-guarded.
 *
 * `artifactUrl` comes from the registry (`plugin_versions.artifact_url`), i.e.
 * from data, not trusted service config. The SHA-256 check happens *after* the
 * fetch, so it does nothing to stop the request itself from hitting an internal
 * host. `downloadAndVerifyArtifact` therefore pins the fetch to the configured
 * artifact-store host + scheme (default `http://minio:9000`).
 *
 * These cases are offline: the guard's scheme and host-allowlist checks both
 * run before any DNS lookup or network I/O, so a blocked URL never touches the
 * network.
 */
describe('downloadAndVerifyArtifact — SSRF guard', () => {
  const SHA = '0'.repeat(64);

  it('blocks a host that is not the configured artifact store (cloud metadata)', async () => {
    await expect(
      downloadAndVerifyArtifact('http://169.254.169.254/latest/meta-data/', SHA),
    ).rejects.toThrow(/blocked by SSRF guard/i);
  });

  it('blocks an arbitrary external host even over http', async () => {
    await expect(
      downloadAndVerifyArtifact('http://evil.example.com/payload.js', SHA),
    ).rejects.toThrow(/blocked by SSRF guard/i);
  });

  it('blocks a disallowed scheme (file://) on the allowed host', async () => {
    await expect(
      downloadAndVerifyArtifact('file:///etc/passwd', SHA),
    ).rejects.toThrow(/blocked by SSRF guard/i);
  });

  it('blocks a malformed URL', async () => {
    await expect(downloadAndVerifyArtifact('not-a-url', SHA)).rejects.toThrow(/blocked by SSRF guard/i);
  });
});
