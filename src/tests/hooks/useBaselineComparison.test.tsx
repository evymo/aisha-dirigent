import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { 
  useBaselineComparison, 
  useMetricsHistory, 
  useSaveMetric,
  useBaselineTracking,
  type BaselineComparison,
  type MetricHistoryRecord,
} from '@/hooks/useBaselineComparison';
import { aisha } from '@/integrations/db/client';

// Mock aisha
vi.mock('@/integrations/db/client', () => ({
  aisha: {
    rpc: vi.fn(),
  },
}));

// Mock useSession
vi.mock('@/hooks/useSession', () => ({
  useSession: () => ({
    user: { id: 'test-user-id' },
  }),
}));

// Test data
const mockComparisonData = [
  {
    metric_name: 'energy_level',
    baseline_value: 5,
    baseline_measured_at: '2026-01-01T00:00:00Z',
    current_value: 7,
    current_measured_at: '2026-02-01T00:00:00Z',
    change_absolute: 2,
    change_percent: 40,
    trend: 'improving',
    measurements_count: 10,
  },
  {
    metric_name: 'stress_level',
    baseline_value: 8,
    baseline_measured_at: '2026-01-01T00:00:00Z',
    current_value: 5,
    current_measured_at: '2026-02-01T00:00:00Z',
    change_absolute: -3,
    change_percent: -37.5,
    trend: 'improving', // Lower stress = better
    measurements_count: 10,
  },
  {
    metric_name: 'pain_level',
    baseline_value: 6,
    baseline_measured_at: '2026-01-01T00:00:00Z',
    current_value: 7,
    current_measured_at: '2026-02-01T00:00:00Z',
    change_absolute: 1,
    change_percent: 16.7,
    trend: 'declining', // More pain = worse
    measurements_count: 10,
  },
];

const mockHistoryData = [
  {
    id: 'metric-1',
    measured_at: '2026-02-01T00:00:00Z',
    physical_state: 7,
    mental_state: 8,
    energy_level: 7,
    stress_level: 5,
    sleep_quality: 8,
    pain_level: 3,
    weight_kg: 75.5,
    source: 'check_in',
  },
  {
    id: 'metric-2',
    measured_at: '2026-01-15T00:00:00Z',
    physical_state: 6,
    mental_state: 7,
    energy_level: 6,
    stress_level: 6,
    sleep_quality: 7,
    pain_level: 4,
    weight_kg: 76.0,
    source: 'check_in',
  },
  {
    id: 'metric-baseline',
    measured_at: '2026-01-01T00:00:00Z',
    physical_state: 5,
    mental_state: 6,
    energy_level: 5,
    stress_level: 8,
    sleep_quality: 6,
    pain_level: 6,
    weight_kg: 77.0,
    source: 'registration',
  },
];

// Test wrapper
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

describe('useBaselineComparison', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('useBaselineComparison hook', () => {
    it('should fetch comparison data for registration', async () => {
      vi.mocked(aisha.rpc).mockResolvedValue({
        data: mockComparisonData,
        error: null,
      });

      const { result } = renderHook(
        () => useBaselineComparison('registration-123'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.comparison).toHaveLength(3);
      expect(result.current.comparison[0].metricName).toBe('energy_level');
      expect(result.current.comparison[0].trend).toBe('improving');
      expect(result.current.comparison[0].changePercent).toBe(40);
    });

    it('should return empty array when registrationId is undefined', async () => {
      const { result } = renderHook(
        () => useBaselineComparison(undefined),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.comparison).toEqual([]);
      expect(aisha.rpc).not.toHaveBeenCalled();
    });

    it('should handle RPC errors gracefully', async () => {
      vi.mocked(aisha.rpc).mockResolvedValue({
        data: null,
        error: { message: 'Database error', code: '500' },
      });

      const { result } = renderHook(
        () => useBaselineComparison('registration-123'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.error).toBeDefined();
      });
    });

    it('should map trend values correctly', async () => {
      vi.mocked(aisha.rpc).mockResolvedValue({
        data: mockComparisonData,
        error: null,
      });

      const { result } = renderHook(
        () => useBaselineComparison('registration-123'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const energyMetric = result.current.comparison.find(
        (c: BaselineComparison) => c.metricName === 'energy_level'
      );
      const stressMetric = result.current.comparison.find(
        (c: BaselineComparison) => c.metricName === 'stress_level'
      );
      const painMetric = result.current.comparison.find(
        (c: BaselineComparison) => c.metricName === 'pain_level'
      );

      expect(energyMetric?.trend).toBe('improving');
      expect(stressMetric?.trend).toBe('improving');
      expect(painMetric?.trend).toBe('declining');
    });
  });

  describe('useMetricsHistory hook', () => {
    it('should fetch metrics history for registration', async () => {
      vi.mocked(aisha.rpc).mockResolvedValue({
        data: mockHistoryData,
        error: null,
      });

      const { result } = renderHook(
        () => useMetricsHistory('registration-123'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.history).toHaveLength(3);
      expect(result.current.history[0].source).toBe('check_in');
      expect(result.current.history[2].source).toBe('registration');
    });

    it('should respect limit parameter', async () => {
      vi.mocked(aisha.rpc).mockResolvedValue({
        data: mockHistoryData.slice(0, 2),
        error: null,
      });

      const { result } = renderHook(
        () => useMetricsHistory('registration-123', 2),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(vi.mocked(aisha.rpc)).toHaveBeenCalledWith(
        'get_health_metrics_history_audited',
        expect.objectContaining({ p_limit: 2 })
      );
    });

    it('should map history records correctly', async () => {
      vi.mocked(aisha.rpc).mockResolvedValue({
        data: mockHistoryData,
        error: null,
      });

      const { result } = renderHook(
        () => useMetricsHistory('registration-123'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const firstRecord = result.current.history[0];
      expect(firstRecord.energyLevel).toBe(7);
      expect(firstRecord.stressLevel).toBe(5);
      expect(firstRecord.weightKg).toBe(75.5);
    });
  });

  describe('useSaveMetric hook', () => {
    it('should save metric successfully', async () => {
      vi.mocked(aisha.rpc).mockResolvedValue({
        data: 'new-metric-id',
        error: null,
      });

      const { result } = renderHook(
        () => useSaveMetric(),
        { wrapper: createWrapper() }
      );

      const metricId = await result.current.saveMetric({
        studyRegistrationId: 'registration-123',
        energyLevel: 8,
        mentalState: 7,
        source: 'manual',
      });

      expect(metricId).toBe('new-metric-id');
      expect(vi.mocked(aisha.rpc)).toHaveBeenCalledWith(
        'save_health_metric_audited',
        expect.objectContaining({
          p_study_registration_id: 'registration-123',
          p_energy_level: 8,
          p_mental_state: 7,
          p_source: 'manual',
        })
      );
    });

    it('should handle save errors', async () => {
      vi.mocked(aisha.rpc).mockResolvedValue({
        data: null,
        error: { message: 'Save failed', code: '500' },
      });

      const { result } = renderHook(
        () => useSaveMetric(),
        { wrapper: createWrapper() }
      );

      await expect(
        result.current.saveMetric({
          studyRegistrationId: 'registration-123',
          energyLevel: 8,
        })
      ).rejects.toThrow();
    });
  });

  describe('useBaselineTracking hook', () => {
    it('should provide helper methods', async () => {
      vi.mocked(aisha.rpc).mockImplementation((fnName: string) => {
        if (fnName === 'get_baseline_comparison_audited') {
          return Promise.resolve({ data: mockComparisonData, error: null });
        }
        if (fnName === 'get_health_metrics_history_audited') {
          return Promise.resolve({ data: mockHistoryData, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      });

      const { result } = renderHook(
        () => useBaselineTracking('registration-123'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Test getMetricComparison helper
      const energyComparison = result.current.getMetricComparison('energy_level');
      expect(energyComparison?.trend).toBe('improving');

      // Test hasOverallImprovement helper (2 improving, 1 declining)
      expect(result.current.hasOverallImprovement()).toBe(true);

      // Test getDecliningMetrics helper
      const declining = result.current.getDecliningMetrics();
      expect(declining).toHaveLength(1);
      expect(declining[0].metricName).toBe('pain_level');
    });

    it('should combine comparison and history data', async () => {
      vi.mocked(aisha.rpc).mockImplementation((fnName: string) => {
        if (fnName === 'get_baseline_comparison_audited') {
          return Promise.resolve({ data: mockComparisonData, error: null });
        }
        if (fnName === 'get_health_metrics_history_audited') {
          return Promise.resolve({ data: mockHistoryData, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      });

      const { result } = renderHook(
        () => useBaselineTracking('registration-123'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.comparison).toHaveLength(3);
      expect(result.current.history).toHaveLength(3);
    });
  });
});
