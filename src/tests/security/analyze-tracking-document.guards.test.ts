import { describe, it, expect } from 'vitest';

import {
  corsGuard,
  bearerTokenGuard,
  rateLimitGuard,
  ownerOnlyNoLeakGuard,
  consentGuard,
} from '../../../trash/legacy-archive/edge-functions-reference/_shared/analyzeTrackingDocumentGuards';

describe('Security - analyze-health-document guards', () => {
  it('blocks requests from non-allowlisted origins (CORS deny)', () => {
    const failure = corsGuard({
      origin: 'https://evil.example',
      allowedOriginsRaw: 'https://app.example,https://staging.example',
    });

    expect(failure).toEqual({ status: 403, error: 'Origin not allowed' });
  });

  it('returns 401 when Authorization header is missing', () => {
    const result = bearerTokenGuard({ authorizationHeader: null });

    expect('status' in result ? result.status : 200).toBe(401);
    if ('status' in result) {
      expect(result.error).toBe('Not authenticated');
    }
  });

  it('returns 403 when consent is missing', () => {
    const failure = consentGuard({ hasConsent: false });
    expect(failure).toEqual({ status: 403, error: 'Consent required' });
  });

  it('returns 404 (no-leak) when requester is not owner', () => {
    const failure = ownerOnlyNoLeakGuard({
      requesterUserId: 'user-a',
      documentOwnerUserId: 'user-b',
    });

    expect(failure).toEqual({ status: 404, error: 'Not found' });
  });

  it('returns 429 when rate limited', () => {
    const failure = rateLimitGuard({ rateLimited: true });
    expect(failure).toEqual({ status: 429, error: 'Rate limit exceeded' });
  });
});
