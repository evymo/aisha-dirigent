import { useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { useSession } from "@/hooks/useSession";
import { useNotificationPreferences, type UserNotificationPreferences } from "@/hooks/useNotificationPreferences";

interface RealtimeNotificationRow {
  id: string;
  type: string;
  title: string;
  message: string | null;
  link: string | null;
}

const parseTimeToMinutes = (value: string, fallback: number): number => {
  const [hourRaw, minuteRaw] = value.split(":");
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return fallback;
  return hour * 60 + minute;
};

const getMinutesInTimezone = (date: Date, timezone: string): number => {
  try {
    const formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const hour = Number(parts.find((item) => item.type === "hour")?.value ?? "0");
    const minute = Number(parts.find((item) => item.type === "minute")?.value ?? "0");
    return hour * 60 + minute;
  } catch {
    return date.getHours() * 60 + date.getMinutes();
  }
};

const isWithinTimeRange = (value: number, start: number, end: number): boolean => {
  if (start === end) return true;
  if (start < end) return value >= start && value < end;
  return value >= start || value < end;
};

const shouldDeliverByType = (type: string, prefs: UserNotificationPreferences): boolean => {
  const normalizedType = type.toLowerCase();

  if (normalizedType.includes("questionnaire") || normalizedType.includes("reminder")) {
    return prefs.push_reminders;
  }
  if (normalizedType.includes("achievement") || normalizedType.includes("reward")) {
    return prefs.push_achievements;
  }
  if (normalizedType.includes("leaderboard")) {
    return prefs.push_leaderboard;
  }
  if (
    normalizedType.includes("study") ||
    normalizedType.includes("registration") ||
    normalizedType.includes("consent")
  ) {
    return prefs.push_study_updates;
  }
  if (normalizedType.includes("health") || normalizedType.includes("insight")) {
    return prefs.push_health_insights;
  }

  return true;
};

const shouldShowBrowserNotification = (
  notification: RealtimeNotificationRow,
  prefs: UserNotificationPreferences
): boolean => {
  if (!prefs.push_enabled) return false;
  if (!shouldDeliverByType(notification.type, prefs)) return false;

  if (prefs.quiet_hours_enabled) {
    const localMinutes = getMinutesInTimezone(new Date(), prefs.user_timezone);
    const quietStart = parseTimeToMinutes(prefs.quiet_hours_start, 22 * 60);
    const quietEnd = parseTimeToMinutes(prefs.quiet_hours_end, 7 * 60);
    if (isWithinTimeRange(localMinutes, quietStart, quietEnd)) {
      return false;
    }
  }

  if (typeof document !== "undefined") {
    if (document.visibilityState === "visible" && document.hasFocus()) {
      return false;
    }
  }

  return true;
};

/**
 * Shows native browser desktop notifications for new in-app notifications.
 *
 * This bridge does not bypass backend filtering. It only reflects new rows from
 * `public.notifications` in the browser when the user has granted permission.
 */
export function useBrowserNotificationBridge() {
  const navigate = useNavigate();
  const { user } = useSession();
  const shownIdsRef = useRef<Set<string>>(new Set());

  const browserNotificationsSupported = useMemo(
    () => typeof window !== "undefined" && "Notification" in window,
    []
  );

  const { notificationPreferences } = useNotificationPreferences({
    enabled: Boolean(user?.id),
  });

  useEffect(() => {
    if (!user?.id) return;
    if (!browserNotificationsSupported) return;
    if (Notification.permission !== "granted") return;

    const channel = aisha
      .channel(`browser-notification-bridge-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new as unknown as RealtimeNotificationRow;
          if (!row?.id || !row.title) return;
          if (shownIdsRef.current.has(row.id)) return;
          if (!shouldShowBrowserNotification(row, notificationPreferences)) return;

          shownIdsRef.current.add(row.id);
          if (shownIdsRef.current.size > 300) {
            shownIdsRef.current.clear();
            shownIdsRef.current.add(row.id);
          }

          try {
            const nativeNotification = new Notification(row.title, {
              body: row.message ?? "",
              tag: row.id,
              data: {
                link: row.link ?? "",
              },
            });

            nativeNotification.onclick = () => {
              window.focus();
              const link = row.link ?? "";
              if (link) {
                navigate(link);
              }
              nativeNotification.close();
            };

            window.setTimeout(() => nativeNotification.close(), 12_000);
          } catch (error) {
            safeError("useBrowserNotificationBridge.show", error);
          }
        }
      )
      .subscribe();

    return () => {
      void aisha.removeChannel(channel);
    };
  }, [browserNotificationsSupported, navigate, notificationPreferences, user?.id]);
}
