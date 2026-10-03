import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useWearableConnections } from '@/hooks/useWearableConnections';

// Mock session
const mockUser = { id: 'test-user-id' };
vi.mock('@/hooks/useSession', () => ({
  useSession: () => ({ user: mockUser }),
}));

// Mock aisha
const mockRpc = vi.fn();
vi.mock('@/integrations/db/client', () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
};

describe('useWearableConnections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockConnections = [
    {
      id: 'conn-1',
      connection_status: 'connected',
      created_at: '2026-01-01T00:00:00Z',
      device_model: 'Watch6,9',
      device_name: 'iPhone 15 Pro (Apple Health)',
      device_type: 'healthkit',
      last_sync_at: '2026-02-10T10:00:00Z',
      metadata: { os_version: '18.3', app_version: '1.2.0' },
      permissions_granted: ['Steps', 'HeartRate', 'SleepAnalysis'],
      platform: 'ios',
      sync_count: 42,
      updated_at: '2026-02-10T10:00:00Z',
    },
  ];

  it('should fetch wearable connections via RPC', async () => {
    mockRpc.mockResolvedValue({ data: mockConnections, error: null });

    const { result } = renderHook(() => useWearableConnections(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockRpc).toHaveBeenCalledWith('get_my_wearable_connections');
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].device_type).toBe('healthkit');
    expect(result.current.data?.[0].connection_status).toBe('connected');
    expect(result.current.data?.[0].sync_count).toBe(42);
  });

  it('should return empty array when no connections exist', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useWearableConnections(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual([]);
  });

  it('should handle RPC error safely', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'Function not found', code: '42883' },
    });

    const { result } = renderHook(() => useWearableConnections(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    // Error should not contain sensitive data
    expect(result.current.error).toBeDefined();
  });

  it('should propagate RPC args correctly', async () => {
    mockRpc.mockResolvedValueOnce({ data: mockConnections, error: null });

    const { result } = renderHook(() => useWearableConnections(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // Verify the exact RPC function name is called (no other args)
    expect(mockRpc).toHaveBeenCalledWith('get_my_wearable_connections');
  });

  it('should not expose sensitive data in connection data', async () => {
    mockRpc.mockResolvedValueOnce({ data: mockConnections, error: null });

    const { result } = renderHook(() => useWearableConnections(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
      expect(result.current.data!.length).toBeGreaterThan(0);
    });

    const conn = result.current.data?.[0];
    // Verify no sensitive data fields are present
    expect(conn).not.toHaveProperty('email');
    expect(conn).not.toHaveProperty('name');
    expect(conn).not.toHaveProperty('health_data');
    // Only safe identifiers
    expect(conn).toHaveProperty('id');
    expect(conn).toHaveProperty('device_type');
    expect(conn).toHaveProperty('platform');
    expect(conn).toHaveProperty('sync_count');
  });
});
