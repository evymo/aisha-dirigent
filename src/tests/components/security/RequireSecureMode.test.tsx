import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, userEvent } from '@/tests/utils/test-utils';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

const hoisted = vi.hoisted(() => ({
  useSessionMock: vi.fn(),
  useSecureModeMock: vi.fn(),
  useHasPasswordMock: vi.fn(),
}));

vi.mock('@/hooks/useSession', () => ({
  useSession: () => hoisted.useSessionMock(),
}));

vi.mock('@/hooks/useSecureMode', () => ({
  useSecureMode: () => hoisted.useSecureModeMock(),
}));

vi.mock('@/hooks/useHasPassword', () => ({
  useHasPassword: () => hoisted.useHasPasswordMock(),
}));

import { RequireSecureMode } from '@/components/security/RequireSecureMode';

describe('RequireSecureMode (security UI guard)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: user has password set
    hoisted.useHasPasswordMock.mockReturnValue({ hasPassword: true, isLoading: false });
  });

  it('když je secure mode enabled, renderuje children', () => {
    hoisted.useSessionMock.mockReturnValue({ user: { id: 'u1', email: 'test@example.com' } });
    hoisted.useSecureModeMock.mockReturnValue({
      isEnabled: true,
      isEnabling: false,
      enableWithPassword: vi.fn(),
      requestEmailOtp: vi.fn(),
      verifyEmailOtp: vi.fn(),
      disable: vi.fn(),
      otpRequestedAt: null,
    } as never);

    render(
      <RequireSecureMode>
        <div>protected</div>
      </RequireSecureMode>
    );

    expect(screen.getByText('protected')).toBeInTheDocument();
    expect(screen.queryByText('phiMode.title')).not.toBeInTheDocument();
  });

  it('bez nastaveného hesla ukáže výzvu k nastavení hesla', () => {
    hoisted.useSessionMock.mockReturnValue({ user: { id: 'u1', email: 'test@example.com' } });
    hoisted.useSecureModeMock.mockReturnValue({
      isEnabled: false,
      isEnabling: false,
      enableWithPassword: vi.fn(),
      requestEmailOtp: vi.fn(),
      verifyEmailOtp: vi.fn(),
      disable: vi.fn(),
      otpRequestedAt: null,
    } as never);
    hoisted.useHasPasswordMock.mockReturnValue({ hasPassword: false, isLoading: false });

    render(
      <RequireSecureMode>
        <div>protected</div>
      </RequireSecureMode>
    );

    expect(screen.getByText('phiMode.passwordRequired')).toBeInTheDocument();
    // Nové flow: uživatel bez hesla vidí možnost nastavit heslo NEBO použít OTP
    expect(screen.getByText('phiMode.mustSetPasswordOrUseOtp')).toBeInTheDocument();
    // Tlačítko pro odeslání emailu s heslem
    expect(screen.getByText('phiMode.setPasswordViaEmail')).toBeInTheDocument();
    // Alternativní možnost - OTP
    expect(screen.getByText('phiMode.useOtpInstead')).toBeInTheDocument();
    expect(screen.queryByText('protected')).not.toBeInTheDocument();
  });

  it('během načítání stavu hesla ukáže loading spinner', () => {
    hoisted.useSessionMock.mockReturnValue({ user: { id: 'u1', email: 'test@example.com' } });
    hoisted.useSecureModeMock.mockReturnValue({
      isEnabled: false,
      isEnabling: false,
      enableWithPassword: vi.fn(),
      requestEmailOtp: vi.fn(),
      verifyEmailOtp: vi.fn(),
      disable: vi.fn(),
      otpRequestedAt: null,
    } as never);
    hoisted.useHasPasswordMock.mockReturnValue({ hasPassword: false, isLoading: true });

    const { container } = render(
      <RequireSecureMode>
        <div>protected</div>
      </RequireSecureMode>
    );

    // Check that spinner is rendered
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
    expect(screen.queryByText('phiMode.title')).not.toBeInTheDocument();
    expect(screen.queryByText('protected')).not.toBeInTheDocument();
  });

  it('bez emailu ukáže unsupported varování a neschová page title', () => {
    hoisted.useSessionMock.mockReturnValue({ user: { id: 'u1', email: null } });
    hoisted.useSecureModeMock.mockReturnValue({
      isEnabled: false,
      isEnabling: false,
      enableWithPassword: vi.fn(),
      requestEmailOtp: vi.fn(),
      verifyEmailOtp: vi.fn(),
      disable: vi.fn(),
      otpRequestedAt: null,
    } as never);

    render(
      <RequireSecureMode>
        <div>protected</div>
      </RequireSecureMode>
    );

    expect(screen.getByText('phiMode.title')).toBeInTheDocument();
    expect(screen.getByText('phiMode.unsupported')).toBeInTheDocument();
    expect(screen.queryByLabelText('phiMode.passwordLabel')).not.toBeInTheDocument();
  });

  it('password unlock: volá enableWithPassword a na success vymaže password', async () => {
    const enableWithPassword = vi.fn().mockResolvedValue({ ok: true });

    hoisted.useSessionMock.mockReturnValue({ user: { id: 'u1', email: 'test@example.com' } });
    hoisted.useSecureModeMock.mockReturnValue({
      isEnabled: false,
      isEnabling: false,
      enableWithPassword,
      requestEmailOtp: vi.fn(),
      verifyEmailOtp: vi.fn(),
      disable: vi.fn(),
      otpRequestedAt: null,
    } as never);

    render(
      <RequireSecureMode>
        <div>protected</div>
      </RequireSecureMode>
    );

    const input = screen.getByPlaceholderText('phiMode.passwordPlaceholder');
    const unlock = screen.getByRole('button', { name: 'phiMode.unlock' });

    const user = userEvent.setup();
    await user.type(input, 'pw');
    await user.click(unlock);

    expect(enableWithPassword).toHaveBeenCalledWith('pw');
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('password unlock: na error ukáže message', async () => {
    const enableWithPassword = vi.fn().mockResolvedValue({ ok: false, message: 'Authentication failed.' });

    hoisted.useSessionMock.mockReturnValue({ user: { id: 'u1', email: 'test@example.com' } });
    hoisted.useSecureModeMock.mockReturnValue({
      isEnabled: false,
      isEnabling: false,
      enableWithPassword,
      requestEmailOtp: vi.fn(),
      verifyEmailOtp: vi.fn(),
      disable: vi.fn(),
      otpRequestedAt: null,
    } as never);

    render(
      <RequireSecureMode>
        <div>protected</div>
      </RequireSecureMode>
    );

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('phiMode.passwordPlaceholder'), 'pw');
    await user.click(screen.getByRole('button', { name: 'phiMode.unlock' }));

    expect(screen.getByText('Authentication failed.')).toBeInTheDocument();
  });

  it('OTP flow: request odemkne input a verify přepne na children', async () => {
    const state = {
      isEnabled: false,
      isEnabling: false,
      otpRequestedAt: null as number | null,
    };

    const requestEmailOtp = vi.fn(async () => {
      state.otpRequestedAt = Date.now();
      return { ok: true } as const;
    });

    const verifyEmailOtp = vi.fn(async (token: string) => {
      if (token === '123456') {
        state.isEnabled = true;
        return { ok: true } as const;
      }
      return { ok: false, message: 'Verification failed.' } as const;
    });

    hoisted.useSessionMock.mockReturnValue({ user: { id: 'u1', email: 'test@example.com' } });
    hoisted.useSecureModeMock.mockImplementation(() =>
      ({
        isEnabled: state.isEnabled,
        isEnabling: state.isEnabling,
        enableWithPassword: vi.fn(),
        requestEmailOtp,
        verifyEmailOtp,
        disable: vi.fn(),
        otpRequestedAt: state.otpRequestedAt,
      }) as never
    );

    const { rerender } = render(
      <RequireSecureMode>
        <div>protected</div>
      </RequireSecureMode>
    );

    const user = userEvent.setup();
    
    // Switch to OTP tab first (new UI uses Tabs)
    await user.click(screen.getByRole('tab', { name: /phiMode.otpLabel/i }));
    
    await user.click(screen.getByRole('button', { name: 'phiMode.sendOtp' }));
    expect(requestEmailOtp).toHaveBeenCalledTimes(1);
    expect(screen.getByText('phiMode.otpSent')).toBeInTheDocument();

    rerender(
      <RequireSecureMode>
        <div>protected</div>
      </RequireSecureMode>
    );

    // Need to switch to OTP tab again after rerender
    await user.click(screen.getByRole('tab', { name: /phiMode.otpLabel/i }));

    const otpInput = screen.getByPlaceholderText('phiMode.otpPlaceholder') as HTMLInputElement;
    expect(otpInput.disabled).toBe(false);

    await user.type(otpInput, '123456');
    await user.click(screen.getByRole('button', { name: 'phiMode.verifyOtp' }));
    expect(verifyEmailOtp).toHaveBeenCalledWith('123456');

    rerender(
      <RequireSecureMode>
        <div>protected</div>
      </RequireSecureMode>
    );

    expect(screen.getByText('protected')).toBeInTheDocument();
  });
});
