import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSessionTimeout } from '@/hooks/useSessionTimeout';

// Mock aisha
vi.mock('@/integrations/db/client', () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    auth: {
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
  },
}));

// Mock toast (sonner)
const mockToast = vi.hoisted(() =>
  Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(),
    loading: vi.fn(), dismiss: vi.fn(), promise: vi.fn(),
  })
);
vi.mock("sonner", () => ({
  toast: mockToast,
}));

describe('useSessionTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should initialize with default values', () => {
    const { result } = renderHook(() => useSessionTimeout());
    
    expect(result.current.showWarning).toBe(false);
    expect(result.current.remainingSeconds).toBe(0);
    expect(typeof result.current.extendSession).toBe('function');
    expect(typeof result.current.resetTimer).toBe('function');
  });

  it('should show warning before timeout', () => {
    const { result } = renderHook(() => useSessionTimeout({
      timeoutMinutes: 1,
      warningMinutes: 0.5, // 30 seconds warning
    }));

    expect(result.current.showWarning).toBe(false);

    // Advance to warning time (30 seconds = 0.5 minutes)
    act(() => {
      vi.advanceTimersByTime(30 * 1000);
    });

    expect(result.current.showWarning).toBe(true);
    expect(result.current.remainingSeconds).toBe(30);
  });

  it('should countdown remaining seconds', () => {
    const { result } = renderHook(() => useSessionTimeout({
      timeoutMinutes: 1,
      warningMinutes: 0.5,
    }));

    // Advance to warning time
    act(() => {
      vi.advanceTimersByTime(30 * 1000);
    });

    expect(result.current.remainingSeconds).toBe(30);

    // Advance 5 seconds
    act(() => {
      vi.advanceTimersByTime(5 * 1000);
    });

    expect(result.current.remainingSeconds).toBe(25);
  });

  it('should extend session when called', () => {
    const { result } = renderHook(() => useSessionTimeout({
      timeoutMinutes: 1,
      warningMinutes: 0.5,
    }));

    // Advance to warning time
    act(() => {
      vi.advanceTimersByTime(30 * 1000);
    });

    expect(result.current.showWarning).toBe(true);

    // Extend session
    act(() => {
      result.current.extendSession();
    });

    expect(result.current.showWarning).toBe(false);
    expect(mockToast.success).toHaveBeenCalled();
  });

  it('should reset timer on activity when warning not shown', () => {
    const { result } = renderHook(() => useSessionTimeout({
      timeoutMinutes: 1,
      warningMinutes: 0.5,
    }));

    // Advance halfway to warning
    act(() => {
      vi.advanceTimersByTime(15 * 1000);
    });

    // Simulate activity by calling resetTimer
    act(() => {
      result.current.resetTimer();
    });

    // Warning should not appear after original warning time
    act(() => {
      vi.advanceTimersByTime(16 * 1000);
    });

    expect(result.current.showWarning).toBe(false);
  });

  it('should call onTimeout callback when timeout occurs', async () => {
    const onTimeout = vi.fn();
    
    renderHook(() => useSessionTimeout({
      timeoutMinutes: 1,
      warningMinutes: 0.5,
      onTimeout,
    }));

    // Advance past timeout
    act(() => {
      vi.advanceTimersByTime(61 * 1000);
    });

    expect(mockToast.error).toHaveBeenCalled();
  });

  it('should call onWarning callback when warning starts', () => {
    const onWarning = vi.fn();
    
    renderHook(() => useSessionTimeout({
      timeoutMinutes: 1,
      warningMinutes: 0.5,
      onWarning,
    }));

    act(() => {
      vi.advanceTimersByTime(30 * 1000);
    });

    expect(onWarning).toHaveBeenCalled();
  });
});
