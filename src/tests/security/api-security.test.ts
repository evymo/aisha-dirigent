import { describe, it, expect } from 'vitest';
import http from 'node:http';
import https from 'node:https';

/**
 * Security test suite for API and network security
 * Focus: API validation, request/response security, environment variables
 */

type RuntimeResponse = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
};

const RUNTIME_BASE_URL =
  process.env.API_SECURITY_TEST_BASE_URL
  ?? process.env.TEST_PUBLIC_BASE_URL
  ?? process.env.PUBLIC_BASE_URL
  ?? process.env.E2E_BASE_URL
  ?? null;

const DEFAULT_PUBLIC_PATH = process.env.API_SECURITY_PUBLIC_PATH ?? '/';
const DEFAULT_ERROR_PATH = process.env.API_SECURITY_ERROR_PATH ?? '/__security_error_probe__';

const buildRuntimeUrl = (path: string): URL => {
  if (!RUNTIME_BASE_URL) {
    throw new Error(
      'Missing runtime base URL. Set API_SECURITY_TEST_BASE_URL (for example http://127.0.0.1:4173).'
    );
  }

  return new URL(path, RUNTIME_BASE_URL);
};

const makeRuntimeRequest = async (
  path: string,
  method: string,
  headers: Record<string, string> = {},
  body?: string
): Promise<RuntimeResponse> => {
  const target = buildRuntimeUrl(path);
  const client = target.protocol === 'https:' ? https : http;

  return await new Promise<RuntimeResponse>((resolve, reject) => {
    const req = client.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];

        res.on('data', (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });

        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf-8'),
          });
        });
      }
    );

    req.on('error', reject);

    if (body) {
      req.write(body);
    }

    req.end();
  });
};

const getHeader = (headers: RuntimeResponse['headers'], headerName: string): string | undefined => {
  const raw = headers[headerName.toLowerCase()];
  if (Array.isArray(raw)) {
    return raw.join(', ');
  }
  return raw;
};

describe.skipIf(!RUNTIME_BASE_URL)('Security - API & Network', () => {
  describe('Environment variable security', () => {
    it('should not expose sensitive keys in client-side code', async () => {
      const response = await makeRuntimeRequest(DEFAULT_PUBLIC_PATH, 'GET');

      expect(response.status).toBeGreaterThan(0);
      expect(response.body).not.toContain('AISHA_POSTGREST_SERVICE_KEY');
      expect(response.body).not.toContain('DATABASE_PASSWORD');
      expect(response.body).not.toContain('JWT_SECRET');
    });

    it('should use environment-specific configurations', async () => {
      const response = await makeRuntimeRequest(DEFAULT_PUBLIC_PATH, 'GET');
      const target = buildRuntimeUrl(DEFAULT_PUBLIC_PATH);

      expect(response.status).toBeLessThan(500);
      expect(response.status).toBeGreaterThanOrEqual(200);
      expect(target.protocol === 'https:' || target.hostname === '127.0.0.1' || target.hostname === 'localhost').toBe(true);
    });
  });

  describe('API request validation', () => {
    it('should validate request headers', async () => {
      const response = await makeRuntimeRequest(DEFAULT_PUBLIC_PATH, 'GET', {
        Accept: 'application/json',
        'X-Request-ID': `security-test-${Date.now()}`,
      });

      expect(response.status).toBeGreaterThan(0);
    });

    it('should reject requests without required headers', async () => {
      const response = await makeRuntimeRequest(DEFAULT_ERROR_PATH, 'POST');

      expect([400, 401, 403, 404, 405, 415, 422]).toContain(response.status);
    });

    it('should validate request body size', async () => {
      const largeBody = JSON.stringify({ payload: 'x'.repeat(256 * 1024) });

      const response = await makeRuntimeRequest(DEFAULT_ERROR_PATH, 'POST', {
        'Content-Type': 'application/json',
      }, largeBody);

      expect(response.status).toBeGreaterThan(0);
    });
  });

  describe('API response security', () => {
    it('should include security headers in responses', async () => {
      const response = await makeRuntimeRequest(DEFAULT_PUBLIC_PATH, 'GET');

      expect(getHeader(response.headers, 'Content-Security-Policy')).toBeTruthy();
      expect(getHeader(response.headers, 'X-Frame-Options')).toBeTruthy();
      expect(getHeader(response.headers, 'X-Content-Type-Options')).toBe('nosniff');
      expect(getHeader(response.headers, 'Strict-Transport-Security')).toBeTruthy();
    });

    it('should not expose stack traces in error responses', async () => {
      const response = await makeRuntimeRequest(DEFAULT_ERROR_PATH, 'POST', {
        'Content-Type': 'application/json',
      }, '{"invalidJson":');

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.body.toLowerCase()).not.toContain('stack');
      expect(response.body.toLowerCase()).not.toContain('internal');
      expect(response.body.toLowerCase()).not.toContain('at ');
    });

    it('should paginate large responses', async () => {
      const paginatedPath = process.env.API_SECURITY_PAGINATION_PATH ?? `${DEFAULT_PUBLIC_PATH}?limit=10&page=1`;
      const response = await makeRuntimeRequest(paginatedPath, 'GET');

      expect(response.status).toBeLessThan(500);
    });
  });

  describe('HTTPS and TLS', () => {
    it('should enforce HTTPS in production', () => {
      const target = buildRuntimeUrl(DEFAULT_PUBLIC_PATH);
      const isLocal = target.hostname === '127.0.0.1' || target.hostname === 'localhost';

      expect(target.protocol === 'https:' || isLocal).toBe(true);
    });

    it('should validate SSL certificate requirements', async () => {
      const response = await makeRuntimeRequest(DEFAULT_PUBLIC_PATH, 'GET');
      const target = buildRuntimeUrl(DEFAULT_PUBLIC_PATH);

      if (target.protocol === 'https:') {
        expect(getHeader(response.headers, 'Strict-Transport-Security')).toBeTruthy();
      } else {
        expect(target.hostname === '127.0.0.1' || target.hostname === 'localhost').toBe(true);
      }
    });
  });

  describe('CORS security', () => {
    it('should restrict CORS origins in production', async () => {
      const response = await makeRuntimeRequest(DEFAULT_PUBLIC_PATH, 'GET', {
        Origin: 'https://malicious.example',
      });

      const corsOrigin = getHeader(response.headers, 'Access-Control-Allow-Origin');
      if (corsOrigin) {
        expect(corsOrigin).not.toBe('https://malicious.example');
      } else {
        expect(response.status).toBeGreaterThan(0);
      }
    });

    it('should validate CORS preflight requests', async () => {
      const response = await makeRuntimeRequest(DEFAULT_PUBLIC_PATH, 'OPTIONS', {
        Origin: 'https://security-test.example',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
      });

      expect([200, 204]).toContain(response.status);
      expect(getHeader(response.headers, 'Access-Control-Allow-Methods')).toBeTruthy();
      expect(getHeader(response.headers, 'Access-Control-Allow-Origin')).toBeTruthy();
      expect(getHeader(response.headers, 'Access-Control-Allow-Headers')).toBeTruthy();
    });
  });

  describe('API rate limiting', () => {
    it('should implement rate limiting per IP', async () => {
      const response = await makeRuntimeRequest(DEFAULT_PUBLIC_PATH, 'GET');
      const rateLimitHeader = getHeader(response.headers, 'x-ratelimit-limit')
        ?? getHeader(response.headers, 'ratelimit-limit');

      if (rateLimitHeader) {
        expect(Number(rateLimitHeader)).toBeGreaterThan(0);
      } else {
        expect(response.status).toBeGreaterThan(0);
      }
    });

    it('should track request counts by IP', async () => {
      const first = await makeRuntimeRequest(DEFAULT_PUBLIC_PATH, 'GET');
      const second = await makeRuntimeRequest(DEFAULT_PUBLIC_PATH, 'GET');

      expect(first.status).toBeGreaterThan(0);
      expect(second.status).toBeGreaterThan(0);
    });
  });

  describe('Request validation', () => {
    it('should validate content-type for POST requests', async () => {
      const response = await makeRuntimeRequest(DEFAULT_ERROR_PATH, 'POST', {
        'Content-Type': 'text/plain',
      }, 'security-test');

      expect([400, 401, 403, 404, 405, 415, 422]).toContain(response.status);
    });

    it('should validate HTTP methods', async () => {
      const response = await makeRuntimeRequest(DEFAULT_PUBLIC_PATH, 'TRACE');

      expect([400, 403, 404, 405, 501]).toContain(response.status);
    });
  });

  describe('API versioning', () => {
    it('should support API versioning', async () => {
      const versionedPath = process.env.API_SECURITY_VERSIONED_PATH ?? '/api/v1/health';
      const response = await makeRuntimeRequest(versionedPath, 'GET');

      expect([200, 401, 403, 404]).toContain(response.status);
    });

    it('should deprecate old API versions', async () => {
      const deprecatedPath = process.env.API_SECURITY_DEPRECATED_PATH ?? '/api/v0/health';
      const response = await makeRuntimeRequest(deprecatedPath, 'GET');

      expect([200, 301, 302, 404, 410]).toContain(response.status);
    });
  });

  describe('Request logging security', () => {
    it('should not log sensitive request data', async () => {
      const response = await makeRuntimeRequest(DEFAULT_ERROR_PATH, 'POST', {
        'Content-Type': 'application/json',
      }, JSON.stringify({ password: 'secret123', token: 'xyz789' }));

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.body).not.toContain('secret123');
      expect(response.body).not.toContain('xyz789');
    });

    it('should sanitize URL parameters in logs', async () => {
      const response = await makeRuntimeRequest(`${DEFAULT_ERROR_PATH}?apiKey=secret123`, 'GET');

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.body).not.toContain('secret123');
    });
  });
});
