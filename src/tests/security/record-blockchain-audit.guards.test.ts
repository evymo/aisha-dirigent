import { describe, expect, it } from 'vitest';

import {
  allowlistGuard,
  bearerHeaderGuard,
  corsGuard,
  jsonBodyGuard,
  jsonContentTypeGuard,
  methodGuard,
  payloadSizeGuard,
  rateLimitGuard,
  requiredFieldsGuard,
} from '../../../trash/legacy-archive/edge-functions-reference/_shared/recordBlockchainAuditGuards';

describe('Security - record-blockchain-audit guards', () => {
  it('blocks requests from non-allowlisted origins (CORS deny)', () => {
    const failure = corsGuard({
      origin: 'https://evil.example',
      allowedOriginsRaw: 'https://app.example,https://staging.example',
    });

    expect(failure).toEqual({ status: 403, error: 'Origin not allowed' });
  });

  it('allows requests without Origin header (non-browser)', () => {
    const failure = corsGuard({ origin: null, allowedOriginsRaw: 'https://app.example' });
    expect(failure).toBeNull();
  });

  it('returns 405 when method is not POST', () => {
    const failure = methodGuard({ method: 'GET' });
    expect(failure).toEqual({ status: 405, error: 'Method not allowed' });
  });

  it('returns 401 when Authorization header is not Bearer', () => {
    const failure = bearerHeaderGuard({ authorizationHeader: 'Basic abc' });
    expect(failure).toEqual({ status: 401, error: 'Unauthorized' });
  });

  it('returns 415 when content-type is not JSON', () => {
    const failure = jsonContentTypeGuard({ contentTypeHeader: 'text/plain' });
    expect(failure).toEqual({ status: 415, error: 'Unsupported content type' });
  });

  it('returns 400 when JSON body is invalid', () => {
    const result = jsonBodyGuard({ bodyText: '{not json}', maxBodyBytes: 1024 });
    expect(result).toEqual({ status: 400, error: 'Invalid request body' });
  });

  it('returns 413 when request body exceeds max bytes', () => {
    const big = 'a'.repeat(1025);
    const result = jsonBodyGuard({ bodyText: big, maxBodyBytes: 1024 });
    expect(result).toEqual({ status: 413, error: 'Request body too large' });
  });

  it('returns 400 when required fields are missing', () => {
    const failure = requiredFieldsGuard({
      event_type: 'created',
      reference_table: 'health_documents',
      reference_id: '',
      payload: {},
    });

    expect(failure).toEqual({ status: 400, error: 'Missing required fields' });
  });

  it('returns 400 when allowlist check fails', () => {
    const failure = allowlistGuard({
      value: 'bad',
      allowlist: new Set(['good']),
      error: 'Invalid event type',
    });

    expect(failure).toEqual({ status: 400, error: 'Invalid event type' });
  });

  it('returns 400 when payload cannot be JSON-stringified', () => {
    const payload = { value: BigInt(1) };
    const result = payloadSizeGuard({ payload, maxJsonChars: 1000 });
    expect(result).toEqual({ status: 400, error: 'Invalid payload' });
  });

  it('returns 413 when payload JSON exceeds max chars', () => {
    const payload = { data: 'a'.repeat(200) };
    const result = payloadSizeGuard({ payload, maxJsonChars: 10 });
    expect(result).toEqual({ status: 413, error: 'Payload too large' });
  });

  it('returns 429 when rate limited', () => {
    const failure = rateLimitGuard({ recentCount: 10, limit: 10 });
    expect(failure).toEqual({ status: 429, error: 'Rate limit exceeded' });
  });
});
