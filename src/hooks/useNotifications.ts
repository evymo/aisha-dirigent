import { useCallback, useEffect, useRef, useState } from 'react';
import { aisha } from '@/integrations/db/client';
import { useSession } from './useSession';
import { safeError } from "@/lib/security/safeLogger";
import { 
  notificationArraySchema, 
  type NotificationRpc 
} from '@/lib/schemas/notificationSchemas';
import { parseArrayResponseSafe } from '@/lib/schemas/hookSchemas';

export type Notification = NotificationRpc;

/**
 * Hook for managing user notifications.
 * All DB access via RPC for centralized audit logging.
 *
 * Supports:
 * - Fetching notifications with optional unread filter
 * - Real-time updates via Supabase subscription
 * - Mark as read (single and all)
 * - Delete notifications
 * - Efficient unread count via dedicated RPC
 */
export const useNotifications = (options?: { unreadOnly?: boolean; limit?: number }) => {
  const { user } = useSession();
  const userId = user?.id ?? null;
  const isMountedRef = useRef(true);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const { unreadOnly = false, limit = 50 } = options ?? {};

  // Fetch unread count efficiently via dedicated RPC
  const fetchUnreadCount = useCallback(async () => {
    if (!userId) {
      setUnreadCount(0);
      return;
    }

    try {
      const { data, error } = await aisha.rpc('get_unread_notification_count');

      if (error) {
        throw new Error(error.message);
      }

      if (isMountedRef.current) {
        setUnreadCount(data ?? 0);
      }
    } catch (error) {
      safeError('Error fetching unread count', error);
    }
  }, [userId]);

  const fetchNotifications = useCallback(async () => {
    if (!userId) {
      setNotifications([]);
      setUnreadCount(0);
      setLoading(false);
      return;
    }

    try {
      // Fetch notifications with optional unread filter
      const { data, error } = await aisha.rpc('get_my_notifications', {
        p_limit: limit,
        p_unread_only: unreadOnly,
      });

      if (error) {
        throw new Error(error.message);
      }

      if (!isMountedRef.current) return;

      // Validate with Zod schema
      const typedData = parseArrayResponseSafe(
        notificationArraySchema,
        data,
        "get_my_notifications"
      );
      setNotifications(typedData);

      // If we're only fetching unread, the count is the length
      // Otherwise fetch the count separately for accuracy
      if (unreadOnly) {
        setUnreadCount(typedData.length);
      } else {
        await fetchUnreadCount();
      }
    } catch (error) {
      safeError('Error fetching notifications', error);
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [userId, limit, unreadOnly, fetchUnreadCount]);

  const markAsRead = async (notificationId: string) => {
    try {
      const { error } = await aisha.rpc('mark_notification_read', { 
        p_notification_id: notificationId 
      });

      if (error) {
        throw new Error(error.message);
      }

      setNotifications(prev =>
        prev.map(n => n.id === notificationId ? { ...n, is_read: true } : n)
      );
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (error) {
      safeError('Error marking notification as read', error);
    }
  };

  const markAllAsRead = async () => {
    if (!userId) return;

    try {
      const { error } = await aisha.rpc('mark_all_notifications_read');

      if (error) {
        throw new Error(error.message);
      }

      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch (error) {
      safeError('Error marking all as read', error);
    }
  };

  const deleteNotification = async (notificationId: string) => {
    try {
      const { error } = await aisha.rpc('delete_notification', {
        p_notification_id: notificationId
      });

      if (error) {
        throw new Error(error.message);
      }

      const notification = notifications.find(n => n.id === notificationId);
      setNotifications(prev => prev.filter(n => n.id !== notificationId));
      if (notification && !notification.is_read) {
        setUnreadCount(prev => Math.max(0, prev - 1));
      }
    } catch (error) {
      safeError('Error deleting notification', error);
    }
  };

  useEffect(() => {
    isMountedRef.current = true;
    fetchNotifications();

    // Subscribe to realtime notifications
    if (userId) {
      const channel = aisha
        .channel('notifications')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${userId}`,
          },
          (payload) => {
            if (!isMountedRef.current) return;
            const newNotification = payload.new as Notification;
            setNotifications(prev => [newNotification, ...prev]);
            setUnreadCount(prev => prev + 1);
          }
        )
        .subscribe();

      return () => {
        isMountedRef.current = false;
        aisha.removeChannel(channel);
      };
    }

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchNotifications, userId]);

  return {
    notifications,
    unreadCount,
    loading,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    refetch: fetchNotifications,
    refetchUnreadCount: fetchUnreadCount,
  };
};
