import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useStudies, useMyRegistrations, useConsents } from '@/hooks/useStudies';
import i18n from '@/i18n';
import { renderHookWithProviders, createTestQueryClient } from '../utils/test-utils';

type EnrollInStudyResult = Awaited<
  ReturnType<ReturnType<typeof useMyRegistrations>['enrollInStudy']>
>;

type GrantConsentResult = Awaited<
  ReturnType<ReturnType<typeof useConsents>['grantConsent']>
>;

// Mock user
const mockUser = {
  id: 'test-user-id',
  email: 'test@example.com',
};

vi.mock('@/hooks/useSession', () => ({
  useSession: vi.fn(() => ({
    user: mockUser,
    isLoading: false,
    hasRole: vi.fn(),
    roles: [],
    isAdmin: false,
    signOut: vi.fn(),
  })),
}));

// Mock Supabase - all mocks defined before vi.mock
const mockSupabaseFunctions = {
  select: vi.fn(),
  eq: vi.fn(),
  order: vi.fn(),
  insert: vi.fn(),
  upsert: vi.fn(),
  single: vi.fn(),
  rpc: vi.fn(),
};

vi.mock('@/integrations/db/client', () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    from: vi.fn(() => ({
      select: mockSupabaseFunctions.select,
      insert: mockSupabaseFunctions.insert,
      upsert: mockSupabaseFunctions.upsert,
    })),
    rpc: vi.fn((...args) => mockSupabaseFunctions.rpc(...args)),
  },
}));

// Export for use in tests
const mockSelect = mockSupabaseFunctions.select;
const mockEq = mockSupabaseFunctions.eq;
const mockOrder = mockSupabaseFunctions.order;
const mockInsert = mockSupabaseFunctions.insert;
const mockUpsert = mockSupabaseFunctions.upsert;
const mockSingle = mockSupabaseFunctions.single;
const mockRpc = mockSupabaseFunctions.rpc;

describe('useStudies', () => {
  const mockStudies = [
    {
      id: 'study-001',
      code: 'RTN-001',
      name: 'Retisin Operational Trial',
      description: 'Study on thymus extract efficacy',
      study_type: 'operational_trial' as const,
      target_condition: 'Joint health',
      products: ['retisin'],
      duration_weeks: 12,
      target_registration: 100,
      current_registration: 45,
      is_blinded: true,
      is_active: true,
      starts_at: '2024-01-01T00:00:00Z',
      ends_at: '2024-06-30T00:00:00Z',
      protocol_url: '/protocols/rtn001.pdf',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    },
    {
      id: 'study-002',
      code: 'RTN-002',
      name: 'Community Observational Study',
      description: 'Long-term observation of product users',
      study_type: 'observational' as const,
      target_condition: null,
      products: ['retisin', 'lyastin'],
      duration_weeks: 52,
      target_registration: 500,
      current_registration: 123,
      is_blinded: false,
      is_active: true,
      starts_at: '2024-02-01T00:00:00Z',
      ends_at: null,
      protocol_url: null,
      created_at: '2024-02-01T00:00:00Z',
      updated_at: '2024-02-01T00:00:00Z',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock RPC for useStudies (primary path)
    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === 'get_active_studies') {
        return Promise.resolve({ data: mockStudies, error: null });
      }
      // Return not found for other RPCs to trigger legacy fallback
      return Promise.resolve({ data: null, error: { code: '42883' } });
    });
    
    // Legacy fallback chain
    mockSelect.mockReturnValue({
      eq: mockEq,
    });
    mockEq.mockReturnValue({
      order: mockOrder,
    });
    mockOrder.mockResolvedValue({
      data: mockStudies,
      error: null,
    });
  });

  it('should return loading true initially', async () => {
    const queryClient = createTestQueryClient();
    const { result } = renderHookWithProviders(() => useStudies(), { queryClient });
    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it('should fetch active studies', async () => {
    const queryClient = createTestQueryClient();
    const { result } = renderHookWithProviders(() => useStudies(), { queryClient });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.studies).toEqual(mockStudies);
    expect(result.current.error).toBe(null);
  });

  it('should handle empty studies', async () => {
    // Override RPC mock for this test to return empty array
    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === 'get_active_studies') {
        return Promise.resolve({ data: [], error: null });
      }
      return Promise.resolve({ data: null, error: { code: '42883' } });
    });

    const queryClient = createTestQueryClient();
    const { result } = renderHookWithProviders(() => useStudies(), { queryClient });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.studies).toEqual([]);
  });

  it('should handle fetch error', async () => {
    const errorMessage = 'Failed to fetch studies';
    // Override RPC mock to return error
    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === 'get_active_studies') {
        return Promise.resolve({ data: null, error: new Error(errorMessage) });
      }
      return Promise.resolve({ data: null, error: { code: '42883' } });
    });

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const queryClient = createTestQueryClient();
      const { result } = renderHookWithProviders(() => useStudies(), { queryClient });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe(i18n.t('errors.genericError'));
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});

describe('useMyRegistrations', () => {
  const mockRegistrations = [
    {
      id: 'enroll-001',
      user_id: 'test-user-id',
      study_id: 'study-001',
      status: 'active' as const,
      group_assignment: 'treatment',
      enrolled_at: '2024-01-15T00:00:00Z',
      completed_at: null,
      withdrawn_at: null,
      withdrawal_reason: null,
      baseline_data: { weight: 75, height: 180 },
      notes: null,
      created_at: '2024-01-10T00:00:00Z',
      updated_at: '2024-01-15T00:00:00Z',
      study: {
        id: 'study-001',
        name: 'Retisin Operational Trial',
        code: 'RTN-001',
      },
    },
    {
      id: 'enroll-002',
      user_id: 'test-user-id',
      study_id: 'study-002',
      status: 'screening' as const,
      group_assignment: null,
      enrolled_at: null,
      completed_at: null,
      withdrawn_at: null,
      withdrawal_reason: null,
      baseline_data: null,
      notes: 'Pending approval',
      created_at: '2024-03-01T00:00:00Z',
      updated_at: '2024-03-01T00:00:00Z',
      study: {
        id: 'study-002',
        name: 'Community Observational Study',
        code: 'RTN-002',
      },
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock RPC for useMyRegistrations (primary path)
    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === 'get_my_study_registrations') {
        return Promise.resolve({ data: mockRegistrations, error: null });
      }
      if (fnName === 'enroll_in_study') {
        return Promise.resolve({ data: null, error: { code: '42883' } });
      }
      return Promise.resolve({ data: null, error: { code: '42883' } });
    });
    
    // Legacy fallback chain
    mockSelect.mockReturnValue({
      eq: mockEq,
    });
    mockEq.mockReturnValue({
      order: mockOrder,
    });
    mockOrder.mockResolvedValue({
      data: mockRegistrations,
      error: null,
    });
  });

  it('should fetch user registrations', async () => {
    const { result } = renderHook(() => useMyRegistrations());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.registrations).toEqual(mockRegistrations);
    expect(result.current.error).toBe(null);
  });

  it('should enroll in study', async () => {
    const newRegistration = {
      id: 'enroll-003',
      user_id: 'test-user-id',
      study_id: 'study-003',
      status: 'screening' as const,
      baseline_data: { pain_level: 5 },
    };

    // Mock RPC to use RPC path
    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === 'get_my_study_registrations') {
        return Promise.resolve({ data: mockRegistrations, error: null });
      }
      if (fnName === 'enroll_in_study') {
        return Promise.resolve({ data: newRegistration, error: null });
      }
      return Promise.resolve({ data: null, error: { code: '42883' } });
    });

    mockInsert.mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: mockSingle,
      }),
    });
    mockSingle.mockResolvedValue({
      data: newRegistration,
      error: null,
    });

    const { result } = renderHook(() => useMyRegistrations());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let enrollResult!: EnrollInStudyResult;
    await act(async () => {
      enrollResult = await result.current.enrollInStudy('study-003', { pain_level: 5 });
    });

    expect(enrollResult.data).toEqual(newRegistration);
    expect(enrollResult.error).toBe(null);
  });

  it('should handle registration error', async () => {
    // Mock RPC to simulate already enrolled error
    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === 'get_my_study_registrations') {
        return Promise.resolve({ data: mockRegistrations, error: null });
      }
      if (fnName === 'enroll_in_study') {
        return Promise.resolve({ data: null, error: new Error('Already enrolled') });
      }
      return Promise.resolve({ data: null, error: { code: '42883' } });
    });

    mockInsert.mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: mockSingle,
      }),
    });
    mockSingle.mockResolvedValue({
      data: null,
      error: new Error('Already enrolled'),
    });

    const { result } = renderHook(() => useMyRegistrations());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let enrollResult!: EnrollInStudyResult;
    await act(async () => {
      enrollResult = await result.current.enrollInStudy('study-001');
    });

    expect(enrollResult.error).toBe(i18n.t('errors.alreadyEnrolled'));
  });
});

describe('useConsents', () => {
  const mockConsents = [
    {
      id: 'consent-001',
      user_id: 'test-user-id',
      consent_type: 'data_processing' as const,
      study_id: null,
      version: '1.0',
      granted: true,
      granted_at: '2024-01-01T00:00:00Z',
      revoked_at: null,
      document_url: '/docs/data-processing-consent.pdf',
    },
    {
      id: 'consent-002',
      user_id: 'test-user-id',
      consent_type: 'operational_trial' as const,
      study_id: 'study-001',
      version: '2.0',
      granted: true,
      granted_at: '2024-01-15T00:00:00Z',
      revoked_at: null,
      document_url: '/docs/operational-trial-consent.pdf',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock RPC for useConsents (primary path)
    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === 'get_my_consents') {
        return Promise.resolve({ data: mockConsents, error: null });
      }
      if (fnName === 'grant_consent') {
        return Promise.resolve({ data: null, error: { code: '42883' } });
      }
      return Promise.resolve({ data: null, error: { code: '42883' } });
    });
    
    // Legacy fallback
    mockSelect.mockReturnValue({
      eq: vi.fn().mockResolvedValue({
        data: mockConsents,
        error: null,
      }),
    });
    
    mockEq.mockResolvedValue({
      data: mockConsents,
      error: null,
    });
  });

  it('should fetch user consents', async () => {
    const { result } = renderHook(() => useConsents());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.consents).toEqual(mockConsents);
  });

  it('should check if consent is granted', async () => {
    const { result } = renderHook(() => useConsents());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.hasConsent('data_processing')).toBe(true);
    expect(result.current.hasConsent('marketing')).toBe(false);
  });

  it('should grant new consent', async () => {
    const newConsent = {
      id: 'consent-003',
      user_id: 'test-user-id',
      consent_type: 'wearables' as const,
      study_id: null,
      version: '1.0',
      granted: true,
      granted_at: new Date().toISOString(),
      revoked_at: null,
      document_url: null,
    };

    // Mock RPC to use RPC path for grantConsent
    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === 'get_my_consents') {
        return Promise.resolve({ data: mockConsents, error: null });
      }
      if (fnName === 'grant_consent') {
        return Promise.resolve({ data: newConsent, error: null });
      }
      return Promise.resolve({ data: null, error: { code: '42883' } });
    });

    mockUpsert.mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: mockSingle,
      }),
    });
    mockSingle.mockResolvedValue({
      data: newConsent,
      error: null,
    });

    const { result } = renderHook(() => useConsents());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let grantResult!: GrantConsentResult;
    await act(async () => {
      grantResult = await result.current.grantConsent('wearables');
    });

    expect(grantResult.error).toBe(null);
  });
});

describe('useMyRegistrations without user', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Mock RPC to return not found (will be handled before RPC is called due to no user)
    mockRpc.mockResolvedValue({ data: null, error: { code: '42883' } });
    
    const { useSession } = await import('@/hooks/useSession');
    vi.mocked(useSession).mockReturnValue({
      user: null,
      session: null,
      isLoading: false,
      hasRole: vi.fn(),
      roles: [],
      roleRecords: [],
      isAdmin: false,
      signOut: vi.fn(),
      refetchRoles: vi.fn(),
    });
  });

  it('should return empty registrations when user is null', async () => {
    const { result } = renderHook(() => useMyRegistrations());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.registrations).toEqual([]);
  });

  it('should return error when enrolling without user', async () => {
    const { result } = renderHook(() => useMyRegistrations());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let enrollResult!: EnrollInStudyResult;
    await act(async () => {
      enrollResult = await result.current.enrollInStudy('study-001');
    });

    expect(enrollResult.error).toBe('Not authenticated');
  });
});
