/**
 * Web hook for viewing wearable connections (admin/practitioner view).
 *
 * Members manage their wearable connections via mobile.
 * This hook provides read-only access for admin dashboards.
 * All access via RPC — no direct table queries.
 */

import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/hooks/useSession';
import { aisha } from '@/integrations/db/client';

/** Shape returned by get_my_wearable_connections RPC */
export interface WearableConnection {
  id: string;
  connection_status: 'connected' | 'disconnected' | 'paused';
  created_at: string;
  device_model: string | null;
  device_name: string | null;
  device_type: string;
  last_sync_at: string | null;
  metadata: Record<string, unknown>;
  permissions_granted: string[];
  platform: 'ios' | 'android';
  sync_count: number;
  updated_at: string;
}

/**
 * Hook for fetching the current user's wearable connections.
 *
 * @returns Query result containing wearable connections.
 */
export function useWearableConnections() {
  const { user } = useSession();

  return useQuery({
    queryKey: ['wearable-connections', user?.id],
    queryFn: async (): Promise<WearableConnection[]> => {
      if (!user?.id) return [];

      const { data, error } = await aisha.rpc('get_my_wearable_connections');
      if (error) throw new Error(error.message);
      return (data ?? []) as WearableConnection[];
    },
    enabled: !!user?.id,
  });
}
