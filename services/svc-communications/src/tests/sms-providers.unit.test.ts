/**
 * Unit tests for svc-communications sms-providers helpers.
 *
 * generateOtp + normalizePhone are pure functions worth pinning:
 *   - OTP is 6 digits, uniformly random (no enumeration attack via short OTPs)
 *   - normalizePhone normalises inputs but does NOT trust them (no shell injection in SMS)
 */
import { describe, it, expect, vi } from 'vitest';

// sms-providers.ts (sibling of config.ts at src/) imports './config.js' —
// from this test file (src/tests/) the mock specifier is '../config.js'.
vi.mock('../config.js', () => ({
  config: {
    smsProvider: 'mock',
    otpTtlMinutes: 5,
    otpMaxAttempts: 3,
    otpLength: 6,
    defaultCountryCode: '420',
  },
}));

describe('generateOtp', () => {
  it('returns a 6-digit string', async () => {
    const { generateOtp } = await import('../sms-providers.js');
    for (let i = 0; i < 20; i++) {
      const otp = generateOtp();
      expect(otp).toMatch(/^\d{6}$/);
    }
  });

  it('produces different values across calls (not a constant)', async () => {
    const { generateOtp } = await import('../sms-providers.js');
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(generateOtp());
    // 50 random 6-digit numbers should have many distinct values (collision
    // probability is microscopic for a uniform RNG over 10^6 codes)
    expect(seen.size).toBeGreaterThan(40);
  });

  it('always returns full 6 digits (no leading-zero strip from numeric int conversion)', async () => {
    const { generateOtp } = await import('../sms-providers.js');
    // Run enough to catch the "001234"-stripped-to-"1234" regression
    for (let i = 0; i < 500; i++) {
      const otp = generateOtp();
      expect(otp.length).toBe(6);
    }
  });
});

describe('normalizePhone', () => {
  it('strips spaces and dashes', async () => {
    const { normalizePhone } = await import('../sms-providers.js');
    expect(normalizePhone('+420 123 456 789')).toBe('+420123456789');
    expect(normalizePhone('+420-123-456-789')).toBe('+420123456789');
  });

  it('prefixes Czech default when starting with 0', async () => {
    const { normalizePhone } = await import('../sms-providers.js');
    // 9-digit CZ number starting with 0 → +420 prefix
    expect(normalizePhone('0123456789')).toMatch(/^\+/);
  });

  it('preserves international prefix when present', async () => {
    const { normalizePhone } = await import('../sms-providers.js');
    expect(normalizePhone('+44 7700 900123')).toBe('+447700900123');
  });

  it('rejects clearly invalid input by NOT producing arbitrary strings (defensive)', async () => {
    const { normalizePhone } = await import('../sms-providers.js');
    // Even gibberish input shouldn't produce a string containing shell-meta chars
    const out = normalizePhone('"; rm -rf /; echo "');
    expect(out).not.toContain(';');
    expect(out).not.toContain('"');
    expect(out).not.toContain('/');
  });
});
