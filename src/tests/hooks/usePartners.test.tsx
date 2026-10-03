import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitFor, act } from '@testing-library/react';

import { renderHookWithProviders } from '@/tests/utils/test-utils';

const hoisted = vi.hoisted(() => ({
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
  useSessionMock: vi.fn(),
}));

vi.mock('@/integrations/db/client', () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    from: (table: string) => hoisted.fromMock(table),
    rpc: (...args: unknown[]) => hoisted.rpcMock(...args),
  },
}));

vi.mock('@/hooks/useSession', () => ({
  useSession: () => hoisted.useSessionMock(),
}));

import {
  usePartners,
  usePartnerBookedSlots,
  usePartnerFreeSlots,
  usePartnerAppointments,
  useMyAppointments,
  useMyAppointmentNotes,
  useSubmitPartnerCertification,
  useCities,
} from '@/hooks/usePartners';

const snapshotMetaEnv = () => ({ ...import.meta.env } as Record<string, unknown>);

describe('usePartners hooks', () => {
  const originalEnv = snapshotMetaEnv();

  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.useSessionMock.mockReturnValue({ user: null });
    hoisted.fromMock.mockReset();
    hoisted.rpcMock.mockReset();
  });

  afterEach(() => {
    try {
      Object.assign(import.meta.env as unknown as Record<string, unknown>, originalEnv);
    } catch {
      // ignore if env is immutable in this runner
    }
  });

  describe('usePartners', () => {
    it('načte partnery přes RPC get_visible_partners a podporuje filtr city', async () => {
      const partners = [
        {
          id: 'p1',
          user_id: 'u1',
          certification_level: 'certified_partner',
          is_production_provider: false,
          business_name: null,
          display_name: 'Alpha',
          description: null,
          city: 'Prague',
          country: 'CZ',
          website: null,
          services: ['consult'],
          is_visible: true,
          languages: null,
          notes_for_visitors: null,
          accepts_online_appointments: true,
          accepts_in_person_appointments: false,
          certification_passed_at: null,
          certification_score: null,
          avatar_url: null,
          created_at: '2025-01-01',
          updated_at: '2025-01-02',
        },
      ];

      hoisted.rpcMock.mockResolvedValue({
        data: { partners, isAuthenticated: true },
        error: null,
      });

      const { result } = renderHookWithProviders(() => usePartners('Prague'));
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(hoisted.rpcMock).toHaveBeenCalledWith('get_visible_partners', { p_city: 'Prague' });
      expect(result.current.data?.partners).toEqual(partners);
      // isAuthenticated is derived from userId (user is not logged in in this test)
      expect(result.current.data?.isAuthenticated).toBe(false);
    });

    it('volá RPC bez city filtru pokud city není zadáno', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: { partners: [], isAuthenticated: false },
        error: null,
      });

      const { result } = renderHookWithProviders(() => usePartners());
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(hoisted.rpcMock).toHaveBeenCalledWith('get_visible_partners', { p_city: undefined });
      expect(result.current.data?.partners).toEqual([]);
    });

    it('při RPC chybě hook selže s errorem', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: { message: 'rpc fail' },
      });

      const { result } = renderHookWithProviders(() => usePartners());
      await waitFor(() => expect(result.current.isError).toBe(true));
    });
  });

  describe('usePartnerAppointments', () => {
    it('volá RPC get_partner_appointments s includeMemberInfo a vrací data', async () => {
      const appointments = [
        {
          id: 'a1',
          partner_id: 'p1',
          member_id: 'm1',
          appointment_date: '2025-01-02',
          start_time: '10:00',
          end_time: '10:30',
          appointment_type: 'online',
          status: 'confirmed',
          service: null,
          created_at: '2025-01-01',
          updated_at: '2025-01-01',
          member: { user_id: 'm1', display_name: 'Member 1' },
        },
      ];

      hoisted.rpcMock.mockResolvedValue({
        data: appointments,
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        usePartnerAppointments('p1', undefined, { includeMemberInfo: true })
      );
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(hoisted.rpcMock).toHaveBeenCalledWith('get_partner_appointments', {
        p_partner_id: 'p1',
        p_date: undefined,
        p_include_member_info: true,
      });
      expect(result.current.data).toEqual(appointments);
    });

    it('když includeMemberInfo=false, RPC se volá s p_include_member_info=false', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        usePartnerAppointments('p1', undefined, { includeMemberInfo: false })
      );
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(hoisted.rpcMock).toHaveBeenCalledWith('get_partner_appointments', {
        p_partner_id: 'p1',
        p_date: undefined,
        p_include_member_info: false,
      });
      expect(result.current.data).toEqual([]);
    });
  });

  describe('usePartnerBookedSlots', () => {
    it('volá public RPC pro booked slots a vrací data', async () => {
      const slots = [
        { start_time: '09:00:00', end_time: '09:30:00' },
        { start_time: '10:00:00', end_time: '10:30:00' },
      ];

      hoisted.rpcMock.mockResolvedValue({
        data: slots,
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        usePartnerBookedSlots('p1', '2026-02-08')
      );
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(hoisted.rpcMock).toHaveBeenCalledWith('get_public_partner_booked_slots', {
        p_date: '2026-02-08',
        p_partner_id: 'p1',
      });
      expect(result.current.data).toEqual(slots);
    });

    it('pro chybějící datum nevolá RPC a vrací []', async () => {
      const { result } = renderHookWithProviders(() =>
        usePartnerBookedSlots('p1')
      );

      const refetched = await act(async () => result.current.refetch());
      expect(refetched.data).toEqual([]);
      expect(hoisted.rpcMock).not.toHaveBeenCalled();
    });
  });

  describe('usePartnerFreeSlots', () => {
    it('volá RPC get_partner_free_slots a vrací validovaná data', async () => {
      const freeSlots = [
        { start_time: '09:00', end_time: '09:30', is_online: true },
        { start_time: '10:00', end_time: '10:30', is_online: false },
      ];

      hoisted.rpcMock.mockResolvedValue({
        data: freeSlots,
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        usePartnerFreeSlots('p1', '2026-02-18')
      );
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(hoisted.rpcMock).toHaveBeenCalledWith('get_partner_free_slots', {
        p_date: '2026-02-18',
        p_partner_id: 'p1',
      });
      expect(result.current.data).toEqual(freeSlots);
    });

    it('pro chybějící datum vrací prázdné pole bez volání RPC', async () => {
      const { result } = renderHookWithProviders(() =>
        usePartnerFreeSlots('p1')
      );

      const refetched = await act(async () => result.current.refetch());
      expect(refetched.data).toEqual([]);
      expect(hoisted.rpcMock).not.toHaveBeenCalled();
    });

    it('vrací [] pokud RPC vrátí nevalidní data', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [{ unexpected_field: 'garbage' }],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        usePartnerFreeSlots('p1', '2026-02-18')
      );
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual([]);
    });

    it('vrací [] pokud RPC vrátí null', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        usePartnerFreeSlots('p1', '2026-02-18')
      );
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual([]);
    });
  });

  describe('useMyAppointments', () => {
    it('pro nepřihlášeného usera je query disabled (a refetch vrací [])', async () => {
      hoisted.useSessionMock.mockReturnValue({ user: null });

      const { result } = renderHookWithProviders(() => useMyAppointments());
      const refetched = await act(async () => result.current.refetch());
      expect(refetched.data).toEqual([]);
      expect(hoisted.rpcMock).not.toHaveBeenCalled();
    });

    it('volá RPC get_my_appointments a vrací data', async () => {
      hoisted.useSessionMock.mockReturnValue({ user: { id: 'm1' } });

      hoisted.rpcMock.mockResolvedValue({
        data: [
          {
            id: 'a1',
            partner_id: 'p1',
            member_id: 'm1',
            appointment_date: '2025-01-10',
            start_time: '10:00',
            end_time: '10:30',
            appointment_type: 'online',
            status: 'confirmed',
            service: null,
            created_at: '2025-01-01',
            updated_at: '2025-01-01',
            partner: { display_name: 'Partner', business_name: null, city: 'Prague' },
          },
        ],
        error: null,
      });

      const { result } = renderHookWithProviders(() => useMyAppointments());
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(hoisted.rpcMock).toHaveBeenCalledWith('get_my_appointments');
      expect(result.current.data?.[0]?.partner).toEqual({ display_name: 'Partner', business_name: null, city: 'Prague' });
    });
  });

  describe('useMyAppointmentNotes', () => {
    it('pro prázdné ids vrací {} a nevolá RPC', async () => {
      const { result } = renderHookWithProviders(() => useMyAppointmentNotes([]));

      const refetched = await act(async () => result.current.refetch());
      expect(refetched.data).toEqual({});
      expect(hoisted.rpcMock).not.toHaveBeenCalled();
    });

    it('volí audited RPC pokud je předán client a mapuje notes podle appointment_id', async () => {
      const clientRpc = vi.fn().mockResolvedValue({
        data: [
          { appointment_id: 'a1', notes: 'n1' },
          { appointment_id: 'a2', notes: null },
        ],
        error: null,
      });
      const client = { rpc: clientRpc } as never;

      const { result } = renderHookWithProviders(() =>
        useMyAppointmentNotes(['a2', 'a1'], { client })
      );
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(clientRpc).toHaveBeenCalledWith('get_my_appointment_notes_audited', { p_appointment_ids: ['a2', 'a1'] });
      expect(result.current.data).toEqual({ a1: 'n1', a2: null });
    });
  });

  describe('useSubmitPartnerCertification', () => {
    it('bez usera mutation selže (Not authenticated)', async () => {
      hoisted.useSessionMock.mockReturnValue({ user: null });
      const { result } = renderHookWithProviders(() => useSubmitPartnerCertification());

      await expect(
        result.current.mutateAsync({
          answers: { q1: 'a' },
          isProductionProvider: false,
          profileData: { display_name: 'X', city: 'Prague', country: 'CZ' },
        })
      ).rejects.toThrow('Not authenticated');
    });

    it('volá submit_partner_certification a invaliduje relevantní queries', async () => {
      hoisted.useSessionMock.mockReturnValue({ user: { id: 'u1' }, refetchRoles: vi.fn() });
      hoisted.rpcMock.mockResolvedValue({
        data: { success: true, passed: true, score: 99, certification_level: 'certified_provider', role_granted: 'practitioner' },
        error: null,
      });

      const { result, queryClient } = renderHookWithProviders(() => useSubmitPartnerCertification());
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const res = await result.current.mutateAsync({
        answers: { q1: 'a' },
        isProductionProvider: true,
        profileData: { display_name: 'X', city: 'Prague', country: 'CZ', services: ['s'] },
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith('submit_partner_certification', {
        p_answers: { q1: 'a' },
        p_profile_data: { display_name: 'X', city: 'Prague', country: 'CZ', services: ['s'], is_production_provider: true },
      });
      expect(res).toEqual({ passed: true, score: 99, certificationLevel: 'certified_provider', roleGranted: 'practitioner' });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['partner-certifications'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['my-partner-profile'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['partners'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['user-roles'] });
    });
  });

  describe('useCities', () => {
    it('vrací města z RPC get_partner_cities', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: ['Brno', 'Prague'],
        error: null,
      });

      const { result } = renderHookWithProviders(() => useCities());
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(hoisted.rpcMock).toHaveBeenCalledWith('get_partner_cities');
      expect(result.current.data).toEqual(['Brno', 'Prague']);
    });
  });
});
