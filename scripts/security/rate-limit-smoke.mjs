#!/usr/bin/env node

/**
 * Lightweight rate-limit smoke test for Edge Functions.
 *
 * Usage:
 *   node scripts/security/rate-limit-smoke.mjs
 *
 * Env vars:
 *   RATE_LIMIT_URL           Full endpoint URL (default ai-chat local)
 *   RATE_LIMIT_METHOD        HTTP method, default POST
 *   RATE_LIMIT_TOTAL         Number of requests, default 60
 *   RATE_LIMIT_CONCURRENCY   Parallel workers, default 12
 *   RATE_LIMIT_TIMEOUT_MS    Request timeout, default 5000
 *   RATE_LIMIT_EXPECT_MIN_429 Minimum required 429 responses, default 1
 *   RATE_LIMIT_AUTH_TOKEN    Optional bearer token
 *   RATE_LIMIT_API_KEY       Optional apikey header
 */

const RATE_LIMIT_URL =
  process.env.RATE_LIMIT_URL || 'http://127.0.0.1:3001/functions/v1/ai-chat';
const RATE_LIMIT_METHOD = (process.env.RATE_LIMIT_METHOD || 'POST').toUpperCase();
const RATE_LIMIT_TOTAL = Number.parseInt(process.env.RATE_LIMIT_TOTAL || '60', 10);
const RATE_LIMIT_CONCURRENCY = Number.parseInt(
  process.env.RATE_LIMIT_CONCURRENCY || '12',
  10
);
const RATE_LIMIT_TIMEOUT_MS = Number.parseInt(
  process.env.RATE_LIMIT_TIMEOUT_MS || '5000',
  10
);
const RATE_LIMIT_EXPECT_MIN_429 = Number.parseInt(
  process.env.RATE_LIMIT_EXPECT_MIN_429 || '1',
  10
);
const RATE_LIMIT_AUTH_TOKEN = process.env.RATE_LIMIT_AUTH_TOKEN || '';
const RATE_LIMIT_API_KEY = process.env.RATE_LIMIT_API_KEY || '';

function buildHeaders() {
  const headers = {
    'Content-Type': 'application/json',
    Origin: process.env.E2E_BASE_URL || 'http://localhost:5173',
  };

  if (RATE_LIMIT_AUTH_TOKEN) {
    headers.Authorization = `Bearer ${RATE_LIMIT_AUTH_TOKEN}`;
  }

  if (RATE_LIMIT_API_KEY) {
    headers.apikey = RATE_LIMIT_API_KEY;
    if (!RATE_LIMIT_AUTH_TOKEN) {
      headers.Authorization = `Bearer ${RATE_LIMIT_API_KEY}`;
    }
  }

  return headers;
}

async function invokeOnce(index) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RATE_LIMIT_TIMEOUT_MS);

  try {
    const response = await fetch(RATE_LIMIT_URL, {
      method: RATE_LIMIT_METHOD,
      headers: buildHeaders(),
      body:
        RATE_LIMIT_METHOD === 'GET'
          ? undefined
          : JSON.stringify({ message: `rate-limit-smoke-${index}` }),
      signal: controller.signal,
    });

    return response.status;
  } catch (error) {
    return error instanceof Error && error.name === 'AbortError' ? 408 : 0;
  } finally {
    clearTimeout(timeout);
  }
}

async function run() {
  const statuses = [];
  let cursor = 0;

  async function worker() {
    while (cursor < RATE_LIMIT_TOTAL) {
      const i = cursor;
      cursor += 1;
      const status = await invokeOnce(i);
      statuses.push(status);
    }
  }

  const workerCount = Math.max(1, Math.min(RATE_LIMIT_CONCURRENCY, RATE_LIMIT_TOTAL));
  const workers = Array.from({ length: workerCount }, () => worker());

  const startedAt = Date.now();
  await Promise.all(workers);
  const durationMs = Date.now() - startedAt;

  const byStatus = statuses.reduce((acc, status) => {
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});

  const count429 = byStatus[429] || 0;
  const countTransportFailures = byStatus[0] || 0;
  const count2xx = Object.entries(byStatus)
    .filter(([code]) => Number(code) >= 200 && Number(code) < 300)
    .reduce((sum, [, count]) => sum + Number(count), 0);

  console.log('=== Rate Limit Smoke Report ===');
  console.log(`URL: ${RATE_LIMIT_URL}`);
  console.log(`Method: ${RATE_LIMIT_METHOD}`);
  console.log(`Requests: ${RATE_LIMIT_TOTAL}`);
  console.log(`Concurrency: ${workerCount}`);
  console.log(`DurationMs: ${durationMs}`);
  console.log(`StatusCounts: ${JSON.stringify(byStatus)}`);
  console.log(`2xx: ${count2xx}`);
  console.log(`429: ${count429}`);

  if (countTransportFailures === RATE_LIMIT_TOTAL) {
    console.error(
      'Rate limit smoke failed: endpoint appears unreachable (all requests failed at transport level).'
    );
    process.exit(1);
  }

  if (count429 < RATE_LIMIT_EXPECT_MIN_429) {
    console.error(
      `Rate limit smoke failed: expected at least ${RATE_LIMIT_EXPECT_MIN_429} responses with status 429, got ${count429}.`
    );
    process.exit(1);
  }

  console.log('Rate limit smoke passed.');
}

run().catch((error) => {
  console.error('Rate limit smoke crashed.', error);
  process.exit(1);
});
