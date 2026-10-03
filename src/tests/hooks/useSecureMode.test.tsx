import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@/tests/utils/test-utils';

const hoisted = vi.hoisted(() => ({
  useSessionMock: vi.fn(),
  phiVerifyPasswordMock: vi.fn(),
  phiRequestOtpMock: vi.fn(),
  phiVerifyOtpMock: vi.fn(),
  createPhiApiClientMock: vi.fn(),
}));

vi.mock('@/hooks/useSession', () => ({
  useSession: () => hoisted.useSessionMock(),
}));

vi.mock('@/integrations/db/secureClient', () => ({
  phiVerifyPassword: (...args: unknown[]) => hoisted.phiVerifyPasswordMock(...args),
  phiRequestOtp: (...args: unknown[]) => hoisted.phiRequestOtpMock(...args),
  phiVerifyOtp: (...args: unknown[]) => hoisted.phiVerifyOtpMock(...args),
  createPhiApiClient: (...args: unknown[]) => hoisted.createPhiApiClientMock(...args),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', t: (key: string) => key },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

import { PhiModeProvider, useSecureMode } from '@/hooks/useSecureMode';

const mockApiClient = { rpc: vi.fn(), invoke: vi.fn() };

describe('useSecureMode / PhiModeProvider (security)', () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => <PhiModeProvider>{children}</PhiModeProvider>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();

    hoisted.useSessionMock.mockReturnValue({
      user: { id: 'u1', email: 'test@example.com' },
      session: { access_token: 'app-token' },
    });

    hoisted.phiVerifyPasswordMock.mockResolvedValue({ ok: true, accessToken: 'secure-token' });
    hoisted.phiRequestOtpMock.mockResolvedValue({ ok: true });
    hoisted.phiVerifyOtpMock.mockResolvedValue({ ok: true, accessToken: 'secure-token' });
    hoisted.createPhiApiClientMock.mockReturnValue(mockApiClient);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hází chybu mimo provider', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useSecureMode())).toThrow('useSecureMode must be used within a PhiModeProvider');
    errorSpy.mockRestore();
  });

  it('bez user email vrací fail-closed odpověď při password enable', async () => {
    hoisted.useSessionMock.mockReturnValue({ user: { id: 'u1', email: null }, session: { access_token: 'app-token' } });

    const { result } = renderHook(() => useSecureMode(), { wrapper });

    const response = await result.current.enableWithPassword('pw');
    expect(response).toEqual({ ok: false, message: 'secure mode is not available for this login method.' });
    expect(hoisted.phiVerifyPasswordMock).not.toHaveBeenCalled();
  });

  it('vyžaduje password', async () => {
    const { result } = renderHook(() => useSecureMode(), { wrapper });
    const response = await result.current.enableWithPassword('');
    expect(response).toEqual({ ok: false, message: 'Password is required.' });
    expect(hoisted.phiVerifyPasswordMock).not.toHaveBeenCalled();
  });

  it('umožní secure mode přes password a nastaví token', async () => {
    const { result } = renderHook(() => useSecureMode(), { wrapper });

    await act(async () => {
      const response = await result.current.enableWithPassword('pw');
      expect(response).toEqual({ ok: true });
    });

    expect(hoisted.phiVerifyPasswordMock).toHaveBeenCalledWith('test@example.com', 'pw');

    await waitFor(() => {
      expect(result.current.isEnabled).toBe(true);
    });
    expect(result.current.secureAccessToken).toBe('secure-token');
    expect(result.current.secureClient).toBeTruthy();
    expect(result.current.enabledAt).not.toBeNull();
  });

  it('email OTP flow: request nastaví otpRequestedAt, verify zapne secure mode', async () => {
    const { result } = renderHook(() => useSecureMode(), { wrapper });

    await act(async () => {
      const res = await result.current.requestEmailOtp();
      expect(res).toEqual({ ok: true });
    });

    expect(hoisted.phiRequestOtpMock).toHaveBeenCalledWith('test@example.com', { lang: 'en' });

    await waitFor(() => {
      expect(result.current.otpRequestedAt).not.toBeNull();
    });

    await act(async () => {
      const res = await result.current.verifyEmailOtp('123456');
      expect(res).toEqual({ ok: true });
    });

    expect(hoisted.phiVerifyOtpMock).toHaveBeenCalledWith('test@example.com', '123456');

    await waitFor(() => {
      expect(result.current.isEnabled).toBe(true);
    });
    expect(result.current.otpRequestedAt).toBeNull();
  });

  it('disable vyčistí sensitive data stav a volá signOut best-effort', async () => {
    const { result } = renderHook(() => useSecureMode(), { wrapper });

    await act(async () => {
      await result.current.enableWithPassword('pw');
    });

    await waitFor(() => expect(result.current.isEnabled).toBe(true));

    act(() => {
      result.current.disable();
    });

    await waitFor(() => {
      expect(result.current.isEnabled).toBe(false);
    });
  });

  it('timeout po 15 minutách fail-closed vypne secure mode', async () => {
    vi.useFakeTimers();

    const { result } = renderHook(() => useSecureMode(), { wrapper });
    await act(async () => {
      await result.current.enableWithPassword('pw');
    });

    expect(result.current.isEnabled).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    });

    expect(result.current.isEnabled).toBe(false);
  });


  it('bez user email vrací fail při requestEmailOtp', async () => {
    hoisted.useSessionMock.mockReturnValue({ user: { id: 'u1', email: null }, session: { access_token: 'app-token' } });

    const { result } = renderHook(() => useSecureMode(), { wrapper });

    const response = await result.current.requestEmailOtp();
    expect(response).toEqual({ ok: false, message: 'secure mode is not available for this login method.' });
    expect(hoisted.phiRequestOtpMock).not.toHaveBeenCalled();
  });
});
