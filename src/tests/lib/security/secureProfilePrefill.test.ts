import { describe, it, expect, vi } from 'vitest';
import { fetchPhiProfilePrefill } from '@/lib/security/secureProfilePrefill';

import type { ApiClient } from '@/integrations/api/client';

describe('fetchPhiProfilePrefill', () => {
  it('vrací null pokud profil nenalezen', async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    } as unknown as ApiClient;

    const res = await fetchPhiProfilePrefill({ client });
    expect(res).toBeNull();
    expect(client.rpc).toHaveBeenCalledWith('get_my_phi_profile_prefill_audited');
  });

  it('mapuje hodnoty a defaultuje undefined na null', async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: [
          {
            primary_diagnosis: undefined,
            current_medications: 'meds',
            allergies: null,
            medical_history: 'history',
          },
        ],
        error: null,
      }),
    } as unknown as ApiClient;

    const res = await fetchPhiProfilePrefill({ client });

    expect(res).toEqual({
      primary_diagnosis: null,
      current_medications: 'meds',
      allergies: null,
      medical_history: 'history',
    });
  });

  it('propaguje chybu ze Supabase', async () => {
    const err = new Error('db error');
    const client = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: err }),
    } as unknown as ApiClient;

    await expect(fetchPhiProfilePrefill({ client })).rejects.toThrow('db error');
  });
});
