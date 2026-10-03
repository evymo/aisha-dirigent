import { lookup } from 'node:dns/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchTextSafe, ScrapeError } from './parse.js';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}));

const mockedLookup = vi.mocked(lookup);

beforeEach(() => {
  mockedLookup.mockReset();
  mockedLookup.mockResolvedValue({ address: '93.184.216.34', family: 4 });
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchTextSafe SSRF guard', () => {
  it('blocks hostnames that resolve to private IPs before fetch', async () => {
    mockedLookup.mockResolvedValueOnce({ address: '127.0.0.1', family: 4 });

    await expect(fetchTextSafe(new URL('https://public.example/index.html'))).rejects.toMatchObject({
      code: 'BLOCKED_HOST',
    } satisfies Partial<ScrapeError>);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('blocks redirects to private metadata hosts before following them', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('', {
      status: 302,
      headers: { location: 'http://169.254.169.254/latest/meta-data' },
    }));

    await expect(fetchTextSafe(new URL('https://public.example/index.html'))).rejects.toMatchObject({
      code: 'BLOCKED_HOST',
    } satisfies Partial<ScrapeError>);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('follows safe relative redirects with manual redirect handling', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('', {
        status: 302,
        headers: { location: '/final.html' },
      }))
      .mockResolvedValueOnce(new Response('<html><body>ok</body></html>'));

    await expect(fetchTextSafe(new URL('https://public.example/index.html'))).resolves.toContain('ok');

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'https://public.example/index.html',
      expect.objectContaining({ redirect: 'manual' }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'https://public.example/final.html',
      expect.objectContaining({ redirect: 'manual' }),
    );
  });
});
