/**
 * Configurable residency mode — which data sensitivities are forbidden from cloud LLM providers
 * depends on the stack mode (config.residencyCloudForbiddenMinSensitivity). Default keeps only
 * confidential/PHI on-prem; stricter modes also keep internal (or everything) local.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@aisha/security', () => ({
  createSafeLogger: () => ({ safeInfo: vi.fn(), safeWarn: vi.fn(), safeError: vi.fn(), safeDebug: vi.fn() }),
  createSsrfGuard: () => ({ safeFetch: vi.fn() }),
  parseHostAllowlist: (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean),
  // ⛔ Mock MUSÍ nést i `requireEnv` — config ho volá při importu. Chybějící
  // export se projeví jako pád CELÉHO souboru, ne jako chybějící hodnota.
  requireEnv: (name: string) => process.env[name] ?? `test-${name}`,
}));

import { cloudAllowedForSensitivity } from '../lib/governedOrchestration.js';

describe('cloudAllowedForSensitivity — configurable residency mode', () => {
  it("mode 'confidential' (default): only PHI/confidential stays on-prem, internal+public reach cloud", () => {
    expect(cloudAllowedForSensitivity('confidential', 'confidential')).toBe(false);
    expect(cloudAllowedForSensitivity('internal', 'confidential')).toBe(true);
    expect(cloudAllowedForSensitivity('public', 'confidential')).toBe(true);
  });

  it("mode 'internal': internal + confidential stay on-prem, only public reaches cloud", () => {
    expect(cloudAllowedForSensitivity('confidential', 'internal')).toBe(false);
    expect(cloudAllowedForSensitivity('internal', 'internal')).toBe(false);
    expect(cloudAllowedForSensitivity('public', 'internal')).toBe(true);
  });

  it("mode 'public': everything stays local — no cloud LLM at all", () => {
    expect(cloudAllowedForSensitivity('public', 'public')).toBe(false);
    expect(cloudAllowedForSensitivity('internal', 'public')).toBe(false);
    expect(cloudAllowedForSensitivity('confidential', 'public')).toBe(false);
  });

  it('confidential NEVER reaches cloud regardless of mode (PHI invariant)', () => {
    expect(cloudAllowedForSensitivity('confidential', 'confidential')).toBe(false);
    expect(cloudAllowedForSensitivity('confidential', 'internal')).toBe(false);
    expect(cloudAllowedForSensitivity('confidential', 'public')).toBe(false);
  });
});
