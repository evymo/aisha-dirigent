import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/hooks/useSession';
import {
  createPhiApiClient,
  phiVerifyPassword,
  phiRequestOtp,
  phiVerifyOtp,
} from '@/integrations/db/secureClient';
import { useIsMountedRef } from './useIsMountedRef';
import { parseRateLimitError } from '@/lib/auth/rateLimitHelper';

import type { ApiClient } from '@/integrations/api/client';

/**
 * Context value for sensitive data (sensitive data) Mode.
 *
 * Secure Mode is a high-security state that requires re-authentication.
 * It uses a separate API client with a dedicated PHI access token
 * (obtained via KC direct grant or OTP) to ensure sensitive data operations
 * are auditable and time-limited.
 */
export interface PhiModeContextValue {
  /** Whether secure mode is currently active. */
  isEnabled: boolean;
  /** Whether the user is currently in the process of enabling secure mode. */
  isEnabling: boolean;
  /** Timestamp when secure mode was enabled. */
  enabledAt: number | null;
  /** Timestamp when OTP was last requested. */
  otpRequestedAt: number | null;
  /** The PHI-mode API client for sensitive data operations. Null if disabled. */
  secureClient: ApiClient | null;
  /** The access token for the sensitive data session. Null if disabled. */
  secureAccessToken: string | null;
  /** Attempts to enable secure mode using the user's password. */
  enableWithPassword: (password: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  /** Requests an OTP email for passwordless secure mode entry. */
  requestEmailOtp: () => Promise<{ ok: true } | { ok: false; message: string }>;
  /** Verifies the OTP token to enable secure mode. */
  verifyEmailOtp: (token: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  /** Disables secure mode and clears the in-memory session. */
  disable: () => void;
}

const PhiModeContext = createContext<PhiModeContextValue | undefined>(undefined);

const DEFAULT_TIMEOUT_MINUTES = 15;

/**
 * Provider component for Secure Mode.
 * Wraps the application (or part of it) to provide sensitive data context and state management.
 * Handles automatic timeout and session cleanup.
 *
 * @param props - Component props.
 * @param props.children - Child components to wrap.
 */
export function PhiModeProvider({ children }: { children: React.ReactNode }) {
  const { user, session } = useSession();
  const { i18n } = useTranslation();

  const [secureClient, setPhiClient] = useState<ApiClient | null>(null);
  const [phiAccessToken, setPhiAccessToken] = useState<string | null>(null);
  const [enabledAt, setEnabledAt] = useState<number | null>(null);
  const [isEnabling, setIsEnabling] = useState(false);
  const [otpRequestedAt, setOtpRequestedAt] = useState<number | null>(null);

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enableRequestInFlightRef = useRef(false);
  const isMountedRef = useIsMountedRef();

  const clearPhi = useCallback(() => {
    if (isMountedRef.current) {
      setPhiAccessToken(null);
      setEnabledAt(null);
      setIsEnabling(false);
      setOtpRequestedAt(null);
      setPhiClient(null);
    }

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, [isMountedRef]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);

  // Fail-closed: if the primary app session/user changes, drop secure mode.
  useEffect(() => {
    if (!user?.id || !session?.access_token) {
      clearPhi();
      return;
    }
  }, [user?.id, session?.access_token, clearPhi]);

  const armTimeout = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      clearPhi();
    }, DEFAULT_TIMEOUT_MINUTES * 60 * 1000);
  }, [clearPhi]);

  // Reset sensitive data timeout on basic activity while enabled.
  useEffect(() => {
    if (!phiAccessToken) return;
    if (typeof document === 'undefined') return;

    const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click'] as const;
    const handle = () => armTimeout();

    events.forEach((evt) => document.addEventListener(evt, handle, { passive: true }));
    armTimeout();

    return () => {
      events.forEach((evt) => document.removeEventListener(evt, handle));
    };
  }, [phiAccessToken, armTimeout]);

  /**
   * Activate PHI mode using the token from a successful auth result.
   */
  const activatePhiMode = useCallback((accessToken: string) => {
    if (isMountedRef.current) {
      const client = createPhiApiClient(accessToken);
      setPhiClient(client);
      setPhiAccessToken(accessToken);
      setEnabledAt(Date.now());
      setOtpRequestedAt(null);
    }
    armTimeout();
  }, [armTimeout, isMountedRef]);

  const enableWithPassword = useCallback(
    async (password: string) => {
      if (enableRequestInFlightRef.current) {
        return { ok: false, message: 'Authentication already in progress.' } as const;
      }

      if (!user?.email) {
        return { ok: false, message: 'secure mode is not available for this login method.' } as const;
      }

      if (!password) {
        return { ok: false, message: 'Password is required.' } as const;
      }

      if (isMountedRef.current) {
        setIsEnabling(true);
      }

      enableRequestInFlightRef.current = true;
      try {
        const result = await phiVerifyPassword(user.email, password);

        if (!result.ok || !result.accessToken) {
          return { ok: false, message: result.message ?? 'Authentication failed.' } as const;
        }

        activatePhiMode(result.accessToken);
        return { ok: true } as const;
      } finally {
        enableRequestInFlightRef.current = false;
        if (isMountedRef.current) {
          setIsEnabling(false);
        }
      }
    },
    [user?.email, activatePhiMode, isMountedRef]
  );

  const requestEmailOtp = useCallback(async () => {
    if (enableRequestInFlightRef.current) {
      return { ok: false, message: 'Authentication already in progress.' } as const;
    }

    if (!user?.email) {
      return { ok: false, message: 'secure mode is not available for this login method.' } as const;
    }

    if (isMountedRef.current) {
      setIsEnabling(true);
    }

    enableRequestInFlightRef.current = true;
    try {
      const result = await phiRequestOtp(user.email, { lang: i18n.language });

      if (!result.ok) {
        // Backward-compat: parse rate limit from error message
        const rateLimitInfo = parseRateLimitError({ message: result.message ?? '' });
        if (rateLimitInfo.isRateLimited) {
          const message = rateLimitInfo.waitSeconds
            ? i18n.t('phiMode.otpRateLimitWithTime', { seconds: rateLimitInfo.waitSeconds })
            : i18n.t('phiMode.otpRateLimitGeneric');
          return { ok: false, message } as const;
        }
        return { ok: false, message: result.message ?? i18n.t('phiMode.otpSendFailed') } as const;
      }

      if (isMountedRef.current) {
        setOtpRequestedAt(Date.now());
      }
      return { ok: true } as const;
    } finally {
      enableRequestInFlightRef.current = false;
      if (isMountedRef.current) {
        setIsEnabling(false);
      }
    }
  }, [user?.email, isMountedRef, i18n]);

  const verifyEmailOtp = useCallback(
    async (token: string) => {
      if (enableRequestInFlightRef.current) {
        return { ok: false, message: 'Authentication already in progress.' } as const;
      }

      if (!user?.email) {
        return { ok: false, message: 'secure mode is not available for this login method.' } as const;
      }

      if (!token) {
        return { ok: false, message: 'Verification code is required.' } as const;
      }

      if (isMountedRef.current) {
        setIsEnabling(true);
      }

      enableRequestInFlightRef.current = true;
      try {
        const result = await phiVerifyOtp(user.email, token);

        if (!result.ok || !result.accessToken) {
          return { ok: false, message: result.message ?? 'Verification failed.' } as const;
        }

        activatePhiMode(result.accessToken);
        return { ok: true } as const;
      } finally {
        enableRequestInFlightRef.current = false;
        if (isMountedRef.current) {
          setIsEnabling(false);
        }
      }
    },
    [user?.email, activatePhiMode, isMountedRef]
  );

  const value = useMemo<PhiModeContextValue>(
    () => ({
      isEnabled: !!phiAccessToken,
      isEnabling,
      enabledAt,
      otpRequestedAt,
      secureClient: phiAccessToken ? secureClient : null,
      secureAccessToken: phiAccessToken,
      enableWithPassword,
      requestEmailOtp,
      verifyEmailOtp,
      disable: clearPhi,
    }),
    [
      phiAccessToken,
      isEnabling,
      enabledAt,
      otpRequestedAt,
      secureClient,
      enableWithPassword,
      requestEmailOtp,
      verifyEmailOtp,
      clearPhi,
    ]
  );

  return <PhiModeContext.Provider value={value}>{children}</PhiModeContext.Provider>;
}

/**
 * Hook to access Secure Mode state and controls.
 *
 * Use this hook to check if secure mode is enabled (`isEnabled`), get the sensitive data client (`secureClient`),
 * or trigger the sensitive data entry flow (`enableWithPassword`, `requestEmailOtp`).
 *
 * @throws Error if used outside of `PhiModeProvider`.
 */
export function useSecureMode(): PhiModeContextValue {
  const ctx = useContext(PhiModeContext);
  if (!ctx) throw new Error('useSecureMode must be used within a PhiModeProvider');
  return ctx;
}
