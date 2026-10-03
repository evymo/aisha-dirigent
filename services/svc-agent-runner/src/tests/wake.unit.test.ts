// Unit test for the /wake route (event-worker forwards 'agent_run_queued' NOTIFYs here).
// Verifies the shared-token guard (defence-in-depth) and that a valid call fires the
// out-of-band poller wake exactly once, without awaiting it (fire-and-forget → 202).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

const wakeSpy = vi.fn(async () => undefined);
vi.mock('../poller.js', () => ({ wakeClaudePoller: () => wakeSpy() }));
vi.mock('../config.js', () => ({ config: { wakeToken: 'secret-xyz' } }));

import { wakeRoutes } from '../routes/wake.js';

async function makeApp() {
  const app = Fastify();
  await app.register(wakeRoutes);
  return app;
}

describe('POST /wake', () => {
  beforeEach(() => wakeSpy.mockClear());

  it('202 and wakes the poller exactly once with a valid token', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/wake?token=secret-xyz' });
    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    expect(wakeSpy).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('401 and does NOT wake on an invalid token', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/wake?token=wrong' });
    expect(res.statusCode).toBe(401);
    expect(wakeSpy).not.toHaveBeenCalled();
    await app.close();
  });

  it('401 and does NOT wake when the token is missing', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/wake' });
    expect(res.statusCode).toBe(401);
    expect(wakeSpy).not.toHaveBeenCalled();
    await app.close();
  });
});
