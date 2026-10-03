/**
 * Unit tests for the opt-in container-image allowlist (defence-in-depth).
 *
 * The operator-role auth boundary is the PRIMARY gate; this guard adds an
 * optional second barrier. Contract:
 *   - empty AGENT_IMAGE_ALLOWLIST (default) ⇒ ANY image passes (unchanged)
 *   - non-empty ⇒ image must start with one of the comma-separated prefixes,
 *     else fail loud (throw), covering BOTH producers (POST /runs + poller)
 *     because it is enforced at the container-create sink.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockConfig } = vi.hoisted(() => ({ mockConfig: { agentImageAllowlist: '' } }));
vi.mock('../config.js', () => ({ config: mockConfig }));

import { assertImageAllowed } from '../backends/image-guard.js';

describe('assertImageAllowed — opt-in defence-in-depth image gate', () => {
  beforeEach(() => {
    mockConfig.agentImageAllowlist = '';
  });

  it('empty allowlist (default) permits ANY image — byte-for-byte unchanged behaviour', () => {
    for (const img of ['x', 'registry.aisha/plugin-test:1.0', 'docker.io/evil/miner:latest', '']) {
      expect(() => assertImageAllowed(img)).not.toThrow();
    }
  });

  it('non-empty allowlist permits an image whose ref starts with an allowed prefix', () => {
    mockConfig.agentImageAllowlist = 'repo.id3a.cz/aisha/';
    expect(() => assertImageAllowed('repo.id3a.cz/aisha/dirigent-agent:latest')).not.toThrow();
  });

  it('non-empty allowlist rejects an image outside every prefix (fail-loud)', () => {
    mockConfig.agentImageAllowlist = 'repo.id3a.cz/aisha/';
    expect(() => assertImageAllowed('docker.io/evil/miner:latest')).toThrow(
      /not permitted by AGENT_IMAGE_ALLOWLIST/,
    );
  });

  it('honours multiple comma-separated prefixes and trims surrounding whitespace', () => {
    mockConfig.agentImageAllowlist = ' repo.id3a.cz/aisha/ , ghcr.io/anthropics/ ';
    expect(() => assertImageAllowed('ghcr.io/anthropics/claude-code:1')).not.toThrow();
    expect(() => assertImageAllowed('repo.id3a.cz/aisha/x')).not.toThrow();
    expect(() => assertImageAllowed('registry.gitlab.com/x/y:1')).toThrow();
  });

  it('rejects an empty image ref when an allowlist is configured', () => {
    mockConfig.agentImageAllowlist = 'repo.id3a.cz/aisha/';
    expect(() => assertImageAllowed('')).toThrow(/not permitted/);
  });
});
