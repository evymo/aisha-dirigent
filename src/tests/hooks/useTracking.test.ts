import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { 
  useTrackingCheckIns, 
  useLabResults, 
  useDosingLogs,
} from '@/hooks/useTracking';
import i18n from '@/i18n';

// Mock user
const mockUser = {
  id: 'test-user-id',
  email: 'test@example.com',
};

const mockUseSession = vi.fn();

vi.mock('@/hooks/useSession', () => ({
  useSession: () => mockUseSession(),
}));

// Mock Supabase - declare functions first
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockOrder = vi.fn();
const mockLimit = vi.fn();
const mockInsert = vi.fn();
const mockSingle = vi.fn();
const mockRpc = vi.fn();

const mockPhiClient = {
  from: vi.fn(() => ({
    select: mockSelect,
    insert: mockInsert,
  })),
  rpc: mockRpc,
};

vi.mock('@/hooks/useSecureMode', () => ({
  useSecureMode: () => ({
    isEnabled: true,
    isEnabling: false,
    enabledAt: Date.now(),
    secureClient: mockPhiClient,
    secureAccessToken: 'test-token',
    enableWithPassword: vi.fn(),
    disable: vi.fn(),
  }),
}));

vi.mock('@/integrations/db/client', () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    from: vi.fn(() => ({
      select: mockSelect,
      insert: mockInsert,
    })),
  },
}));

describe('useTrackingCheckIns', () => {
  const mockCheckIns = [
    {
      id: 'checkin-001',
      user_id: 'test-user-id',
      check_in_date: new Date().toISOString().split('T')[0],
      check_in_type: 'morning',
      energy_level: 4,
      sleep_quality: 3,
      mood_level: 4,
      pain_level: 2,
      created_at: '2024-03-15T08:00:00Z',
    },
    {
      id: 'checkin-002',
      user_id: 'test-user-id',
      check_in_date: '2024-03-14',
      check_in_type: 'evening',
      energy_level: 3,
      sleep_quality: 4,
      mood_level: 3,
      pain_level: 1,
      created_at: '2024-03-14T08:00:00Z',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSession.mockReturnValue({
      user: mockUser,
      session: { user: mockUser },
      isLoading: false,
    });

    mockRpc.mockResolvedValue({ data: mockCheckIns, error: null });
  });

  it('should fetch health check-ins successfully', async () => {
    const { result } = renderHook(() => useTrackingCheckIns());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.checkIns).toHaveLength(2);
    expect(result.current.error).toBe(null);
  });

  it('should identify today check-in', async () => {
    const { result } = renderHook(() => useTrackingCheckIns());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.todayCheckIn).toBeDefined();
    expect(result.current.todayCheckIn?.id).toBe('checkin-001');
  });

  it('should handle empty check-ins', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useTrackingCheckIns());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.checkIns).toEqual([]);
    expect(result.current.todayCheckIn).toBeUndefined();
  });

  it('should handle fetch error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: new Error('Database error') });

    const { result } = renderHook(() => useTrackingCheckIns());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe(i18n.t('errors.genericError'));
  });

  it('should create health check-in successfully', async () => {
    const newCheckIn = {
      id: 'checkin-003',
      user_id: 'test-user-id',
      check_in_date: '2024-03-16',
      check_in_type: 'morning' as const,
      energy_level: 5,
    };

    // Mock RPC to return the new check-in
    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === 'get_my_health_check_ins_audited') {
        return Promise.resolve({ data: mockCheckIns, error: null });
      }
      if (fnName === 'create_health_check_in') {
        return Promise.resolve({ data: newCheckIn, error: null });
      }
      return Promise.resolve({ data: null, error: { code: '42883' } });
    });

    const { result } = renderHook(() => useTrackingCheckIns());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let createResult;
    await act(async () => {
      createResult = await result.current.createCheckIn({
        check_in_type: 'morning',
        energy_level: 5,
      });
    });

    expect(createResult!.error).toBe(null);
    expect(createResult!.data).toEqual(newCheckIn);
  });

  it('should handle create error', async () => {
    // Mock RPC to return error
    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === 'get_my_health_check_ins_audited') {
        return Promise.resolve({ data: mockCheckIns, error: null });
      }
      if (fnName === 'create_health_check_in') {
        return Promise.resolve({ data: null, error: new Error('Insert failed') });
      }
      return Promise.resolve({ data: null, error: { code: '42883' } });
    });

    const { result } = renderHook(() => useTrackingCheckIns());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let createResult;
    await act(async () => {
      createResult = await result.current.createCheckIn({
        check_in_type: 'morning',
        energy_level: 5,
      });
    });

    expect(createResult!.error).toBe(i18n.t('errors.genericError'));
  });

  it('should return empty when user is null', async () => {
    mockUseSession.mockReturnValue({
      user: null,
      session: null,
      isLoading: false,
    });

    const { result } = renderHook(() => useTrackingCheckIns());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.checkIns).toEqual([]);
  });
});

describe('useLabResults', () => {
  const mockLabResults = [
    {
      id: 'lab-001',
      user_id: 'test-user-id',
      test_date: '2024-03-15',
      status: 'completed' as const,
      crp: 1.2,
      esr: 10,
      created_at: '2024-03-15T08:00:00Z',
    },
    {
      id: 'lab-002',
      user_id: 'test-user-id',
      test_date: '2024-03-01',
      status: 'reviewed' as const,
      crp: 1.5,
      esr: 12,
      created_at: '2024-03-01T08:00:00Z',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSession.mockReturnValue({
      user: mockUser,
      session: { user: mockUser },
      isLoading: false,
    });

    mockRpc.mockResolvedValue({ data: mockLabResults, error: null });
  });

  it('should fetch lab results successfully', async () => {
    const { result } = renderHook(() => useLabResults());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.labResults).toHaveLength(2);
    expect(result.current.error).toBe(null);
  });

  it('should handle empty lab results', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useLabResults());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.labResults).toEqual([]);
  });

  it('should handle fetch error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: new Error('Database error') });

    const { result } = renderHook(() => useLabResults());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe(i18n.t('errors.genericError'));
  });

  it('should return empty when user is null', async () => {
    mockUseSession.mockReturnValue({
      user: null,
      session: null,
      isLoading: false,
    });

    const { result } = renderHook(() => useLabResults());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.labResults).toEqual([]);
  });
});

describe('useDosingLogs', () => {
  const mockDosingLogs = [
    {
      id: 'dose-001',
      user_id: 'test-user-id',
      product_id: 'prod-001',
      logged_at: '2024-03-15T08:00:00Z',
      dose_amount: '2 capsules',
      dose_unit: 'capsules',
      dose_count: 2,
      created_at: '2024-03-15T08:00:00Z',
    },
    {
      id: 'dose-002',
      user_id: 'test-user-id',
      product_id: 'prod-001',
      logged_at: '2024-03-14T08:00:00Z',
      dose_amount: '2 capsules',
      dose_unit: 'capsules',
      dose_count: 2,
      created_at: '2024-03-14T08:00:00Z',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSession.mockReturnValue({
      user: mockUser,
      session: { user: mockUser },
      isLoading: false,
    });

    mockRpc.mockResolvedValue({ data: mockDosingLogs, error: null });
  });

  it('should fetch dosing logs successfully', async () => {
    const { result } = renderHook(() => useDosingLogs());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.dosingLogs).toHaveLength(2);
  });

  it('should handle empty dosing logs', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useDosingLogs());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.dosingLogs).toEqual([]);
  });

  it('should log dose successfully', async () => {
    const newLog = {
      id: 'dose-003',
      user_id: 'test-user-id',
      product_id: 'prod-001',
      dose_amount: '1 capsule',
      dose_count: 1,
    };

    // Mock RPC to return the new dosing log
    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === 'get_my_dosing_logs_audited') {
        return Promise.resolve({ data: mockDosingLogs, error: null });
      }
      if (fnName === 'create_dosing_log_audited') {
        return Promise.resolve({ data: newLog, error: null });
      }
      return Promise.resolve({ data: null, error: { code: '42883' } });
    });

    const { result } = renderHook(() => useDosingLogs());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let logResult;
    await act(async () => {
      logResult = await result.current.logDose({ productId: 'prod-001', doseAmount: '1 capsule', doseCount: 1 });
    });

    expect(logResult!.error).toBe(null);
    expect(logResult!.data).toEqual(newLog);
  });

  it('should handle log error', async () => {
    // Mock RPC to return error
    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === 'get_my_dosing_logs_audited') {
        return Promise.resolve({ data: mockDosingLogs, error: null });
      }
      if (fnName === 'create_dosing_log_audited') {
        return Promise.resolve({ data: null, error: new Error('Insert failed') });
      }
      return Promise.resolve({ data: null, error: { code: '42883' } });
    });

    const { result } = renderHook(() => useDosingLogs());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let logResult;
    await act(async () => {
      logResult = await result.current.logDose({ productId: 'prod-001', doseAmount: '1 capsule', doseCount: 1 });
    });

    expect(logResult!.error).toBe(i18n.t('errors.genericError'));
  });

  it('should return empty when user is null', async () => {
    mockUseSession.mockReturnValue({
      user: null,
      session: null,
      isLoading: false,
    });

    const { result } = renderHook(() => useDosingLogs());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.dosingLogs).toEqual([]);
  });
});
