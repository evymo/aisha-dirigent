/**
 * Tests for the A02 secrets primitives.
 *
 * Critical: requireSecret() must fail-fast on weak values, not just missing
 * ones. A service that boots with JWT_SECRET=changeme is worse than one that
 * fails to boot.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import {
  requireSecret,
  fingerprintSecret,
  formatRotationManifest,
  MissingSecretError,
} from '../secrets.js';

const ENV_KEY = 'AISHA_SECURITY_TEST_SECRET';

beforeEach(() => {
  delete process.env[ENV_KEY];
});

afterEach(() => {
  delete process.env[ENV_KEY];
});

describe('requireSecret() — happy path', () => {
  test('returns trimmed value when set', () => {
    process.env[ENV_KEY] = '  abcdefghijklmnopqrst  ';
    expect(requireSecret(ENV_KEY, { service: 'svc-test' })).toBe('abcdefghijklmnopqrst');
  });

  test('honours custom minLength', () => {
    process.env[ENV_KEY] = 'abc12345';
    expect(requireSecret(ENV_KEY, { service: 'svc-test', minLength: 8 })).toBe('abc12345');
  });
});

describe('requireSecret() — fail-fast on absence', () => {
  test('throws when env is not set', () => {
    expect(() => requireSecret(ENV_KEY, { service: 'svc-test' })).toThrow(MissingSecretError);
  });

  test('throws when env is empty string', () => {
    process.env[ENV_KEY] = '';
    expect(() => requireSecret(ENV_KEY, { service: 'svc-test' })).toThrow(MissingSecretError);
  });

  test('throws when env is whitespace only', () => {
    process.env[ENV_KEY] = '    ';
    expect(() => requireSecret(ENV_KEY, { service: 'svc-test' })).toThrow(MissingSecretError);
  });

  test('returns empty string when optional=true and unset', () => {
    expect(requireSecret(ENV_KEY, { service: 'svc-test', optional: true })).toBe('');
  });
});

describe('requireSecret() — fail-fast on weak values', () => {
  test.each(['changeme', 'password', '12345', 'admin', 'secret', 'token', 'aisha', 'test'])(
    'rejects known-weak value "%s"',
    (weak) => {
      process.env[ENV_KEY] = weak.padEnd(20, 'x'); // pad to satisfy length check first
      // padding makes it 20 chars but the lowercased trimmed value must be tested
      // against the exact value, so set to exact:
      process.env[ENV_KEY] = weak;
      expect(() => requireSecret(ENV_KEY, { service: 'svc-test', minLength: 1 })).toThrow(
        MissingSecretError,
      );
    },
  );

  test('rejects values shorter than minLength', () => {
    process.env[ENV_KEY] = 'short';
    expect(() => requireSecret(ENV_KEY, { service: 'svc-test', minLength: 16 })).toThrow(
      MissingSecretError,
    );
  });

  test('case-insensitive weak detection', () => {
    process.env[ENV_KEY] = 'CHANGEME';
    expect(() => requireSecret(ENV_KEY, { service: 'svc-test', minLength: 1 })).toThrow(
      MissingSecretError,
    );
  });
});

describe('fingerprintSecret()', () => {
  test('returns [secret:empty] for empty string', () => {
    expect(fingerprintSecret('')).toBe('[secret:empty]');
  });

  test('returns deterministic 8-hex-char fingerprint', () => {
    const fp1 = fingerprintSecret('correct-horse-battery-staple');
    const fp2 = fingerprintSecret('correct-horse-battery-staple');
    expect(fp1).toBe(fp2);
    expect(fp1).toMatch(/^\[secret:[0-9a-f]{8}\]$/);
  });

  test('different secrets yield different fingerprints', () => {
    expect(fingerprintSecret('abc12345')).not.toBe(fingerprintSecret('def67890'));
  });

  test('does not leak any preimage characters from the secret', () => {
    // The format `[secret:<hex>]` always contains the literal word "secret"
    // as a tag — that's NOT a leak. We assert the hash payload doesn't echo
    // the input.
    const secret = 'this-is-my-very-uniqlymarkable-tokenvalue';
    const fp = fingerprintSecret(secret);
    // strip the `[secret:` prefix and `]` suffix
    const hash = fp.replace(/^\[secret:/, '').replace(/]$/, '');
    expect(hash).not.toContain('this');
    expect(hash).not.toContain('uniqlymarkable');
    expect(hash).not.toContain('tokenvalue');
  });
});

describe('formatRotationManifest()', () => {
  test('renders markdown table with header and rows', () => {
    const md = formatRotationManifest({
      service: 'svc-test',
      entries: [
        {
          envName: 'JWT_SECRET',
          description: 'Symmetric JWT signing key',
          cadence: 'quarterly',
          rotationProcedure: 'scripts/rotate-jwt.sh',
        },
      ],
    });
    expect(md).toContain('## Secret rotation — svc-test');
    expect(md).toContain('| `JWT_SECRET` |');
    expect(md).toContain('quarterly');
  });

  test('handles empty manifest gracefully', () => {
    const md = formatRotationManifest({ service: 'svc-empty', entries: [] });
    expect(md).toContain('svc-empty');
  });
});

describe('MissingSecretError', () => {
  test('exposes the env name it failed on', () => {
    try {
      requireSecret(ENV_KEY, { service: 'svc-test' });
    } catch (err) {
      expect(err).toBeInstanceOf(MissingSecretError);
      expect((err as MissingSecretError).envName).toBe(ENV_KEY);
      // `name` is the standard Error class name, kept for instanceof patterns.
      expect((err as MissingSecretError).name).toBe('MissingSecretError');
    }
  });
});
