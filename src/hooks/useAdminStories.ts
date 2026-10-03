/**
 * Hook: useAdminStories
 *
 * Admin/staff hook for listing all member stories across the platform.
 * Data access through `get_all_stories_admin_audited` RPC function.
 * Non-sensitive display: anonymised member names, partner names, study names.
 *
 * @module useAdminStories
 */

import { useQuery } from '@tanstack/react-query';
import { aisha } from '@/integrations/db/client';
import { usePermissions } from './usePermissions';
import { safeError } from '@/lib/security/safeLogger';
import {
  AdminStoryListItemSchema,
  type AdminStoryListItem,
} from '@/schemas/storyLoopSchemas';
import { z } from 'zod';

export const adminStoriesKeys = {
  all: ['admin', 'stories'] as const,
  list: (filters?: { search?: string; status?: string; limit?: number; offset?: number }) =>
    [...adminStoriesKeys.all, 'list', filters] as const,
};

interface AdminStoriesFilters {
  limit?: number;
  offset?: number;
  search?: string | null;
  status?: string | null;
}

interface AdminStoriesResult {
  items: AdminStoryListItem[];
  totalCount: number;
}

const EMPTY_RESULT: AdminStoriesResult = { items: [], totalCount: 0 };

/**
 * Fetch all stories for admin/staff monitoring with pagination and search.
 *
 * @param filters - Optional search, status filter, limit, offset
 * @returns Paginated list of all stories with total count
 *
 * @example
 * ```tsx
 * const { data, isLoading } = useAdminStories({ search: 'jan', status: 'inbox' });
 * // data.items — AdminStoryListItem[]
 * // data.totalCount — total matching stories
 * ```
 */
export function useAdminStories(filters?: AdminStoriesFilters) {
  const { hasPermission } = usePermissions();
  const canView =
    hasPermission('view_admin_dashboard') || hasPermission('view_staff_dashboard');

  return useQuery({
    queryKey: adminStoriesKeys.list({
      limit: filters?.limit ?? 50,
      offset: filters?.offset ?? 0,
      search: filters?.search ?? undefined,
      status: filters?.status ?? undefined,
    }),
    enabled: canView,
    staleTime: 30_000,
    queryFn: async (): Promise<AdminStoriesResult> => {
      const { data, error } = await aisha.rpc('get_all_stories_admin_audited', {
        p_limit: filters?.limit ?? 50,
        p_offset: filters?.offset ?? 0,
        p_search: filters?.search ?? undefined,
        p_status: filters?.status ?? undefined,
      });

      if (error) {
        safeError('admin.stories.list', error);
        throw new Error(error.message);
      }

      if (!data || (Array.isArray(data) && data.length === 0)) {
        return EMPTY_RESULT;
      }

      const rows = Array.isArray(data) ? data : [data];
      const validated = z.array(AdminStoryListItemSchema).safeParse(rows);

      if (!validated.success) {
        safeError('admin.stories.list.validation', validated.error);
        return EMPTY_RESULT;
      }

      return {
        items: validated.data,
        totalCount: validated.data[0]?.total_count ?? 0,
      };
    },
  });
}
