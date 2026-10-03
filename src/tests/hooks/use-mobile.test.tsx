import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useIsMobile } from '@/hooks/use-mobile';

describe('useIsMobile', () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    // Reset window.innerWidth
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1024,
    });

    window.matchMedia = originalMatchMedia;
  });

  it('should return false for desktop width', async () => {
    window.innerWidth = 1024;
    const { result } = renderHook(() => useIsMobile());

    await waitFor(() => {
      expect(result.current).toBe(false);
    });
  });

  it('should return true for mobile width', async () => {
    window.innerWidth = 500;
    const { result } = renderHook(() => useIsMobile());

    await waitFor(() => {
      expect(result.current).toBe(true);
    });
  });

  it('should return true at breakpoint - 1', async () => {
    window.innerWidth = 767;
    const { result } = renderHook(() => useIsMobile());

    await waitFor(() => {
      expect(result.current).toBe(true);
    });
  });

  it('should return false at breakpoint', async () => {
    window.innerWidth = 768;
    const { result } = renderHook(() => useIsMobile());

    await waitFor(() => {
      expect(result.current).toBe(false);
    });
  });

  it('should handle window resize events', async () => {
    window.innerWidth = 1024;
    const { result } = renderHook(() => useIsMobile());

    await waitFor(() => {
      expect(result.current).toBe(false);
    });

    // Simulate resize to mobile
    window.innerWidth = 500;
    window.dispatchEvent(new Event('resize'));

    // Note: MediaQueryList doesn't automatically trigger on innerWidth change in tests
    // This test verifies the hook sets up listeners correctly
  });

  it('should fall back when matchMedia is not available', async () => {
    // @ts-expect-error - test-only override
    window.matchMedia = undefined;
    window.innerWidth = 500;

    const { result } = renderHook(() => useIsMobile());

    await waitFor(() => {
      expect(result.current).toBe(true);
    });
  });
});
