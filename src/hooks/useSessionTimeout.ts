import { useEffect, useCallback, useRef, useState } from 'react';
import { logout as oidcLogout } from '@/integrations/auth/oidc-client';
import { toast } from "sonner";
import { safeInfo } from '@/lib/security/safeLogger';
import { useIsMountedRef } from './useIsMountedRef';

/**
 * Configuration options for session timeout.
 */
export interface SessionTimeoutConfig {
  /** Duration in minutes before the session times out. Default: 30. */
  timeoutMinutes?: number;
  /** Duration in minutes before timeout to show a warning. Default: 5. */
  warningMinutes?: number;
  /** Callback function executed when the session times out. */
  onTimeout?: () => void;
  /** Callback function executed when the warning period begins. */
  onWarning?: () => void;
  /** Whether the timeout logic is enabled. Default: true. */
  enabled?: boolean;
}

/**
 * Hook for managing user session timeouts due to inactivity.
 *
 * This hook tracks user activity (mouse movement, key presses, clicks) and automatically
 * signs the user out after a configured period of inactivity. It also provides a warning
 * state before the actual timeout occurs.
 *
 * @param config - Configuration options for timeout durations and callbacks.
 * @returns Object containing warning state, remaining time, and functions to extend or reset the session.
 *
 * @example
 * const { showWarning, remainingSeconds, extendSession } = useSessionTimeout({
 *   timeoutMinutes: 15,
 *   onTimeout: () => router.push('/login')
 * });
 */
export function useSessionTimeout({
  timeoutMinutes = 30,
  warningMinutes = 5,
  onTimeout,
  onWarning,
  enabled = true,
}: SessionTimeoutConfig = {}) {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const warningRef = useRef<NodeJS.Timeout | null>(null);
  const [showWarning, setShowWarning] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);
  const showWarningRef = useRef(false);
  const isMountedRef = useIsMountedRef();

  const timeoutMs = timeoutMinutes * 60 * 1000;
  const warningMs = (timeoutMinutes - warningMinutes) * 60 * 1000;

  const clearTimers = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (warningRef.current) clearTimeout(warningRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
  }, []);

  useEffect(() => {
    showWarningRef.current = showWarning;
  }, [showWarning]);

  const handleTimeout = useCallback(async () => {
    clearTimers();
    if (isMountedRef.current) {
      setShowWarning(false);
    }
    
    safeInfo('useSessionTimeout.timeout');
    
    toast.error('Session Expired', { description: 'You have been logged out due to inactivity.' });

    await oidcLogout();
    onTimeout?.();
  }, [clearTimers, onTimeout, isMountedRef]);

  const handleWarning = useCallback(() => {
    if (isMountedRef.current) {
      setShowWarning(true);
      setRemainingSeconds(warningMinutes * 60);
    }
    
    countdownRef.current = setInterval(() => {
      if (!isMountedRef.current) {
        if (countdownRef.current) clearInterval(countdownRef.current);
        return;
      }

      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    onWarning?.();
  }, [warningMinutes, onWarning, isMountedRef]);

  const resetTimer = useCallback(() => {
    clearTimers();
    if (isMountedRef.current) {
      setShowWarning(false);
    }

    warningRef.current = setTimeout(handleWarning, warningMs);
    timeoutRef.current = setTimeout(handleTimeout, timeoutMs);
  }, [clearTimers, handleWarning, handleTimeout, warningMs, timeoutMs, isMountedRef]);

  const extendSession = useCallback(() => {
    if (isMountedRef.current) {
      setShowWarning(false);
    }
    resetTimer();
    
    toast.success('Session Extended', { description: 'Your session has been extended.' });
  }, [resetTimer, isMountedRef]);

  useEffect(() => {
    if (!enabled) {
      clearTimers();
      if (isMountedRef.current) {
        setShowWarning(false);
        setRemainingSeconds(0);
      }
      return;
    }

    if (typeof document === 'undefined') {
      clearTimers();
      return;
    }

    const activityEvents = [
      'mousedown',
      'mousemove',
      'keydown',
      'scroll',
      'touchstart',
      'click',
    ];

    const handleActivity = () => {
      if (!showWarningRef.current) {
        resetTimer();
      }
    };

    activityEvents.forEach((event) => {
      document.addEventListener(event, handleActivity, { passive: true });
    });

    // Initial timer setup
    resetTimer();

    return () => {
      clearTimers();
      activityEvents.forEach((event) => {
        document.removeEventListener(event, handleActivity);
      });
    };
  }, [enabled, clearTimers, resetTimer, isMountedRef]);

  return {
    showWarning,
    remainingSeconds,
    extendSession,
    resetTimer,
  };
}
