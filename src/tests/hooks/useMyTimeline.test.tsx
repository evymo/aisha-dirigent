/**
 * Tests for useMyTimeline hook
 * 
 * Member timeline functionality - viewing own health timeline
 * and adding entries to own stories.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useMyTimeline,
  useAddTimelineEntry,
  useMyStories,
  useHasTimeline,
  SYSTEM_ENTRY_TYPES,
  resolveSystemContent,
} from '@/hooks/useMyTimeline';
import type { ReactNode } from 'react';

// Mock Supabase RPC
const mockRpc = vi.fn();
const mockUseSession = vi.fn();

vi.mock('@/integrations/db/client', () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

// Mock useSession
vi.mock('@/hooks/useSession', () => ({
  useSession: () => mockUseSession(),
}));

// Mock safeError - must accept importOriginal per ESLint rule
vi.mock('@/lib/security/safeLogger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security/safeLogger')>();
  return {
    ...actual,
    safeError: vi.fn(),
  };
});

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function createWrapper() {
  const queryClient = createTestQueryClient();
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

describe('useMyTimeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSession.mockReturnValue({
      user: { id: '11111111-1111-1111-1111-111111111111' },
      session: { access_token: 'test-token' },
    });
  });

  describe('useMyTimeline', () => {
    it('should fetch timeline data successfully', async () => {
      const mockResponse = {
        user_id: '11111111-1111-1111-1111-111111111111',
        total_count: 2,
        entries: [
          {
            id: '22222222-2222-2222-2222-222222222222',
            story_id: '33333333-3333-3333-3333-333333333333',
            entry_type: 'note',
            content: 'Test note',
            metadata: null,
            is_pinned: false,
            document_id: null,
            occurred_at: '2026-01-20T10:00:00Z',
            created_at: '2026-01-20T10:00:00Z',
            story_title: 'Test Story',
            partner_name: 'Test Partner',
          },
          {
            id: '44444444-4444-4444-4444-444444444444',
            story_id: '33333333-3333-3333-3333-333333333333',
            entry_type: 'health_event',
            content: 'Zlepšení stavu',
            metadata: { pain_level: 3 },
            is_pinned: true,
            document_id: null,
            occurred_at: '2026-01-19T15:00:00Z',
            created_at: '2026-01-20T08:00:00Z',
            story_title: 'Test Story',
            partner_name: 'Test Partner',
          },
        ],
        stories: [
          {
            id: '33333333-3333-3333-3333-333333333333',
            title: 'Test Story',
            status: 'active',
            priority: 'normal',
            last_activity_at: '2026-01-20T10:00:00Z',
            partner_name: 'Test Partner',
          },
        ],
      };

      mockRpc.mockResolvedValue({
        data: mockResponse,
        error: null,
      });

      const { result } = renderHook(() => useMyTimeline(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data?.total_count).toBe(2);
      expect(result.current.data?.entries).toHaveLength(2);
      expect(result.current.data?.stories).toHaveLength(1);
      expect(mockRpc).toHaveBeenCalledWith(
        'get_my_timeline_audited',
        expect.objectContaining({
          p_limit: 50,
          p_offset: 0,
        })
      );
    });

    it('should apply filters correctly', async () => {
      mockRpc.mockResolvedValue({
        data: {
          user_id: '11111111-1111-1111-1111-111111111111',
          total_count: 0,
          entries: [],
          stories: [],
        },
        error: null,
      });

      const filters = {
        entryTypes: ['note', 'health_event'],
        dateFrom: '2026-01-01',
        dateTo: '2026-01-31',
        limit: 20,
        offset: 10,
      };

      const { result } = renderHook(() => useMyTimeline(filters), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockRpc).toHaveBeenCalledWith(
        'get_my_timeline_audited',
        {
          p_limit: 20,
          p_offset: 10,
          p_entry_types: ['note', 'health_event'],
          p_date_from: '2026-01-01',
          p_date_to: '2026-01-31',
        }
      );
    });

    it('should handle errors gracefully', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'Database error', code: 'PGRST500', details: '', hint: '' },
      });

      const { result } = renderHook(() => useMyTimeline(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });

    it('should return empty data when response is null', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: null,
      });

      const { result } = renderHook(() => useMyTimeline(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data?.total_count).toBe(0);
      expect(result.current.data?.entries).toEqual([]);
    });
  });

  describe('useAddTimelineEntry', () => {
    it('should add entry successfully', async () => {
      mockRpc.mockResolvedValue({
        data: {
          success: true,
          entry_id: '55555555-5555-5555-5555-555555555555',
          story_id: '33333333-3333-3333-3333-333333333333',
        },
        error: null,
      });

      const { result } = renderHook(() => useAddTimelineEntry(), {
        wrapper: createWrapper(),
      });

      await result.current.mutateAsync({
        storyId: '33333333-3333-3333-3333-333333333333',
        entryType: 'note',
        content: 'New note content',
      });

      expect(mockRpc).toHaveBeenCalledWith(
        'add_timeline_entry_audited',
        {
          p_story_id: '33333333-3333-3333-3333-333333333333',
          p_entry_type: 'note',
          p_content: 'New note content',
          p_metadata: undefined,
          p_occurred_at: undefined,
          p_document_id: undefined,
        }
      );
    });

    it('should support backdating with occurred_at', async () => {
      mockRpc.mockResolvedValue({
        data: {
          success: true,
          entry_id: '88888888-8888-8888-8888-888888888888',
          story_id: '33333333-3333-3333-3333-333333333333',
        },
        error: null,
      });

      const { result } = renderHook(() => useAddTimelineEntry(), {
        wrapper: createWrapper(),
      });

      await result.current.mutateAsync({
        storyId: '33333333-3333-3333-3333-333333333333',
        entryType: 'health_event',
        content: 'Historical event',
        occurredAt: '2026-01-15T10:00:00Z',
        metadata: { pain_level: 5 },
      });

      expect(mockRpc).toHaveBeenCalledWith(
        'add_timeline_entry_audited',
        {
          p_story_id: '33333333-3333-3333-3333-333333333333',
          p_entry_type: 'health_event',
          p_content: 'Historical event',
          p_metadata: { pain_level: 5 },
          p_occurred_at: '2026-01-15T10:00:00Z',
          p_document_id: undefined,
        }
      );
    });

    it('should handle mutation error', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'Story not found', code: 'P0001', details: '', hint: '' },
      });

      const { result } = renderHook(() => useAddTimelineEntry(), {
        wrapper: createWrapper(),
      });

      await expect(
        result.current.mutateAsync({
          storyId: '99999999-9999-9999-9999-999999999999',
          entryType: 'note',
          content: 'Test',
        })
      ).rejects.toThrow();
    });
  });

  describe('useMyStories', () => {
    it('should fetch stories for member', async () => {
      mockRpc.mockResolvedValue({
        data: {
          user_id: '11111111-1111-1111-1111-111111111111',
          total_count: 0,
          entries: [],
          stories: [
            {
              id: '33333333-3333-3333-3333-333333333333',
              title: 'Story 1',
              status: 'active',
              priority: 'high',
              last_activity_at: '2026-01-20T10:00:00Z',
              partner_name: 'Partner A',
            },
            {
              id: '66666666-6666-6666-6666-666666666666',
              title: 'Story 2',
              status: 'waiting',
              priority: 'normal',
              last_activity_at: '2026-01-19T15:00:00Z',
              partner_name: 'Partner B',
            },
          ],
        },
        error: null,
      });

      const { result } = renderHook(() => useMyStories(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toHaveLength(2);
      expect(result.current.data?.[0].title).toBe('Story 1');
      expect(mockRpc).toHaveBeenCalledWith(
        'get_my_timeline_audited',
        {
          p_date_from: undefined,
          p_date_to: undefined,
          p_entry_types: undefined,
          p_limit: 1,
          p_offset: 0,
        }
      );
    });
  });

  describe('useHasTimeline', () => {
    it('should return true when user has timeline entries', async () => {
      mockRpc.mockResolvedValue({
        data: {
          user_id: '11111111-1111-1111-1111-111111111111',
          total_count: 5,
          entries: [{ id: '77777777-7777-7777-7777-777777777777', story_id: '33333333-3333-3333-3333-333333333333', entry_type: 'note', content: 'Test', metadata: null, is_pinned: false, document_id: null, occurred_at: null, created_at: '2026-01-20', story_title: 'Test', partner_name: 'Partner' }],
          stories: [],
        },
        error: null,
      });

      const { result } = renderHook(() => useHasTimeline(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.hasTimeline).toBe(true);
    });

    it('should return true when user has stories (even without entries)', async () => {
      mockRpc.mockResolvedValue({
        data: {
          user_id: '11111111-1111-1111-1111-111111111111',
          total_count: 0,
          entries: [],
          stories: [{ id: '33333333-3333-3333-3333-333333333333', title: 'Test', status: 'active', priority: 'normal', last_activity_at: null, partner_name: 'Partner' }],
        },
        error: null,
      });

      const { result } = renderHook(() => useHasTimeline(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.hasTimeline).toBe(true);
    });

    it('should return false when user has no timeline data', async () => {
      mockRpc.mockResolvedValue({
        data: {
          user_id: '11111111-1111-1111-1111-111111111111',
          total_count: 0,
          entries: [],
          stories: [],
        },
        error: null,
      });

      const { result } = renderHook(() => useHasTimeline(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.hasTimeline).toBe(false);
    });
  });

  describe('system health sync support', () => {
    it('includes system_health_sync in system entry types', () => {
      expect(SYSTEM_ENTRY_TYPES).toContain('system_health_sync');
    });

    it('resolves wearable sync translation key', () => {
      const t = vi.fn((key: string) => {
        if (key === 'myTimeline.systemContent.timeline.health_sync_completed') {
          return 'Wearable sync completed';
        }
        return key;
      });

      const resolved = resolveSystemContent('timeline.health_sync_completed', t);
      expect(resolved).toBe('Wearable sync completed');
    });
  });
});
