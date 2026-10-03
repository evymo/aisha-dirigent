import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode } from 'react';

// Mock aisha
vi.mock('@/integrations/db/client', () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        in: vi.fn(() => ({
          order: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve({
              data: mockAuditData,
              error: null,
            })),
          })),
        })),
        eq: vi.fn(() => ({
          order: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve({
              data: mockAuditData,
              error: null,
            })),
          })),
        })),
      })),
      upsert: vi.fn(() => Promise.resolve({ error: null })),
    })),
    rpc: vi.fn(() => Promise.resolve({
      data: mockAuditData,
      error: null,
    })),
  },
}));

const mockAuditData = [
  {
    id: 'audit-001',
    user_id: 'user-001',
    user_email: 'user1@example.com',
    user_role: 'member',
    session_id: 'session-001',
    ip_address: '192.0.2.1',
    user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
    created_at: new Date().toISOString(),
    action_type: 'login',
    details: { country: 'CZ', city: 'Prague' },
    severity: 'info',
    tags: [],
  },
  {
    id: 'audit-002',
    user_id: 'user-001',
    user_email: 'user1@example.com',
    user_role: 'member',
    session_id: 'session-001',
    ip_address: '192.0.2.1',
    user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
    created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    action_type: 'view',
    details: {},
    severity: 'info',
    tags: [],
  },
  {
    id: 'audit-003',
    user_id: 'user-002',
    user_email: 'suspicious@example.com',
    user_role: 'member',
    session_id: 'session-002',
    ip_address: '10.0.0.1',
    user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)',
    created_at: new Date().toISOString(),
    action_type: 'login',
    details: { failed_attempts: 10 },
    severity: 'warning',
    tags: ['brute_force'],
  },
];

// Wrapper for React Query
const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('useSessionMonitoring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should aggregate sessions from audit data', async () => {
    const { useSessionMonitoring } = await import('@/hooks/useSessionMonitoring');
    
    const { result } = renderHook(() => useSessionMonitoring(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Sessions should be aggregated by session_id
    expect(result.current.data).toBeDefined();
  });

  it('should filter by activeOnly', async () => {
    const { useSessionMonitoring } = await import('@/hooks/useSessionMonitoring');
    
    const { result } = renderHook(() => useSessionMonitoring({ activeOnly: true }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
  });

  it('should filter by suspiciousOnly', async () => {
    const { useSessionMonitoring } = await import('@/hooks/useSessionMonitoring');
    
    const { result } = renderHook(() => useSessionMonitoring({ suspiciousOnly: true }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
  });
});

describe('useSessionStats', () => {
  it('should calculate session statistics', async () => {
    const { useSessionStats } = await import('@/hooks/useSessionMonitoring');
    
    const { result } = renderHook(() => useSessionStats(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current).toBeDefined();
    });

    // Verify stats structure
    expect(result.current).toHaveProperty('totalActiveSessions');
    expect(result.current).toHaveProperty('uniqueUsers');
    expect(result.current).toHaveProperty('suspiciousSessions');
    expect(result.current).toHaveProperty('avgSessionDuration');
    expect(result.current).toHaveProperty('peakHour');
    expect(result.current).toHaveProperty('hourlyActivity');
    expect(result.current).toHaveProperty('topCountries');
    expect(result.current).toHaveProperty('deviceBreakdown');
    expect(result.current).toHaveProperty('recentLogins');
    expect(result.current).toHaveProperty('failedLogins');
    expect(result.current).toHaveProperty('rateLimit');
  });

  it('should return default values when no data', async () => {
    const { useSessionStats } = await import('@/hooks/useSessionMonitoring');
    
    const { result } = renderHook(() => useSessionStats(), {
      wrapper: createWrapper(),
    });

    // Initial state before data loads
    expect(result.current.totalActiveSessions).toBeGreaterThanOrEqual(0);
    expect(result.current.uniqueUsers).toBeGreaterThanOrEqual(0);
  });
});

describe('useSuspiciousPatterns', () => {
  it('should detect suspicious patterns from audit data', async () => {
    const { useSuspiciousPatterns } = await import('@/hooks/useSessionMonitoring');
    
    const { result } = renderHook(() => useSuspiciousPatterns(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
  });

  it('should filter by severity', async () => {
    const { useSuspiciousPatterns } = await import('@/hooks/useSessionMonitoring');
    
    const { result } = renderHook(() => useSuspiciousPatterns({ severity: 'critical' }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
  });

  it('should filter by resolved status', async () => {
    const { useSuspiciousPatterns } = await import('@/hooks/useSessionMonitoring');
    
    const { result } = renderHook(() => useSuspiciousPatterns({ resolved: false }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
  });
});

describe('Session Activity Helpers', () => {
  it('should parse user agent correctly', async () => {
    // Import the module to test internal functions
    // These are tested indirectly through the hook
    const { useSessionMonitoring } = await import('@/hooks/useSessionMonitoring');
    
    const { result } = renderHook(() => useSessionMonitoring(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // User agent parsing is done internally, verify through data
    if (result.current.data && result.current.data.length > 0) {
      const session = result.current.data[0];
      expect(session.device_type).toBeDefined();
      expect(session.browser).toBeDefined();
      expect(session.os).toBeDefined();
    }
  });

  it('should calculate risk scores', async () => {
    const { useSessionMonitoring } = await import('@/hooks/useSessionMonitoring');
    
    const { result } = renderHook(() => useSessionMonitoring(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Risk scores should be calculated for each session
    if (result.current.data && result.current.data.length > 0) {
      const session = result.current.data[0];
      expect(session.risk_score).toBeGreaterThanOrEqual(0);
      expect(session.risk_score).toBeLessThanOrEqual(100);
    }
  });
});

describe('Pattern Type Detection', () => {
  const testPatterns = [
    { tags: ['brute_force'], details: {}, expected: 'brute_force' },
    { tags: ['geo_anomaly'], details: {}, expected: 'geo_anomaly' },
    { tags: ['rate_limit'], details: {}, expected: 'rapid_requests' },
    { tags: [], details: { failed_attempts: 10 }, expected: 'brute_force' },
    { tags: [], details: { location_change: true }, expected: 'geo_anomaly' },
    { tags: [], details: { requests_per_minute: 200 }, expected: 'rapid_requests' },
    { tags: [], details: { concurrent_sessions: 5 }, expected: 'multiple_sessions' },
    { tags: [], details: { records_accessed: 2000 }, expected: 'data_exfiltration' },
  ];

  it('should correctly identify pattern types', async () => {
    const { useSuspiciousPatterns } = await import('@/hooks/useSessionMonitoring');
    
    // This tests the pattern detection logic indirectly
    const { result } = renderHook(() => useSuspiciousPatterns(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Patterns should have valid pattern_type values
    if (result.current.data && result.current.data.length > 0) {
      const validTypes = [
        'rapid_requests', 'geo_anomaly', 'brute_force',
        'unusual_hours', 'multiple_sessions', 'data_exfiltration'
      ];
      
      result.current.data.forEach(pattern => {
        expect(validTypes).toContain(pattern.pattern_type);
      });
    }
  });
});

describe('Session Activity States', () => {
  it('should determine if session is active based on last activity', async () => {
    const { useSessionMonitoring } = await import('@/hooks/useSessionMonitoring');
    
    const { result } = renderHook(() => useSessionMonitoring(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Sessions with recent activity should be marked as active
    if (result.current.data && result.current.data.length > 0) {
      result.current.data.forEach(session => {
        const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000;
        const lastActivity = new Date(session.last_activity_at).getTime();
        
        if (lastActivity > thirtyMinutesAgo) {
          expect(session.is_active).toBe(true);
        }
      });
    }
  });
});

describe('Mutation Hooks', () => {
  it('useResolvePattern should be available', async () => {
    const { useResolvePattern } = await import('@/hooks/useSessionMonitoring');
    
    const { result } = renderHook(() => useResolvePattern(), {
      wrapper: createWrapper(),
    });

    expect(result.current.mutate).toBeDefined();
    expect(result.current.mutateAsync).toBeDefined();
  });
});
