import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.mock('../config.js', () => ({
  config: { postgrestUrl: 'http://postgrest.test:3000', postgrestServiceToken: 'svc-token' },
}));
vi.mock('./guarded-fetch.js', () => ({ guardedFetch: mockFetch }));

import { rozlozKlic, zapisMedium } from './media-zaznam.js';

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => '' });
});

describe('rozložení klíče objektu', () => {
  it('čte nahrávajícího a původní jméno z klíče raženého preflightem', () => {
    expect(rozlozKlic('9f1c4a2e-1b2c-4d3e-8f90-abcdefabcdef/0e2b4c6d-8f90-4a1b-9c2d-123456789abc_foto_z_telefonu.jpg')).toEqual({
      uploadedBy: '9f1c4a2e-1b2c-4d3e-8f90-abcdefabcdef',
      originalName: 'foto_z_telefonu.jpg',
    });
  });
  it('cizí tvar klíče nedává nic — nic se nehádá', () => {
    expect(rozlozKlic('legacy/hero.png')).toEqual({ uploadedBy: null, originalName: null });
    expect(rozlozKlic('hero.png')).toEqual({ uploadedBy: null, originalName: null });
  });
});

describe('zápis média', () => {
  it('volá record_media_asset pod service tokenem s hodnotami z klíče', async () => {
    await zapisMedium({
      bucket: 'page-assets',
      objectKey: '9f1c4a2e-1b2c-4d3e-8f90-abcdefabcdef/0e2b4c6d-8f90-4a1b-9c2d-123456789abc_a.png',
      contentType: 'image/png',
      bytes: 123,
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://postgrest.test:3000/rpc/record_media_asset');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer svc-token');
    expect(JSON.parse(String(init.body))).toEqual({
      p_bucket: 'page-assets',
      p_bytes: 123,
      p_content_type: 'image/png',
      p_object_key: '9f1c4a2e-1b2c-4d3e-8f90-abcdefabcdef/0e2b4c6d-8f90-4a1b-9c2d-123456789abc_a.png',
      p_original_name: 'a.png',
      p_uploaded_by: '9f1c4a2e-1b2c-4d3e-8f90-abcdefabcdef',
    });
  });
  it('odmítnutí PostgREST hází — mlčet by znamenalo obrázek bez záznamu', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401, text: async () => 'Unauthorized' });
    await expect(zapisMedium({ bucket: 'page-assets', objectKey: 'x/y', contentType: 'image/png', bytes: 1 })).rejects.toThrow(/401/);
  });
});
