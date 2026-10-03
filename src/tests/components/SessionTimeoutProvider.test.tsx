import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../utils/test-utils';

const mockUseAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockUseSessionTimeout = vi.fn();
vi.mock('@/hooks/useSessionTimeout', () => ({
  useSessionTimeout: (args: unknown) => mockUseSessionTimeout(args),
}));

const signOutMutateAsync = vi.fn().mockResolvedValue(undefined);
vi.mock('@/hooks/useAuthActions', () => ({
  useSignOut: () => ({
    mutateAsync: signOutMutateAsync,
  }),
}));

interface MockWarningProps {
  open: boolean;
  remainingSeconds: number;
  onExtend: () => void;
  onLogout: () => Promise<void>;
}

let warningProps: MockWarningProps | null = null;
vi.mock('@/components/session/SessionTimeoutWarning', () => ({
  SessionTimeoutWarning: (props: MockWarningProps) => {
    warningProps = props;
    return <div data-testid="session-timeout-warning" />;
  },
}));

import { SessionTimeoutProvider } from '@/components/session/SessionTimeoutProvider';

describe('SessionTimeoutProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    warningProps = null;
  });

  it('renders children only when user is not present', () => {
    mockUseAuth.mockReturnValue({ user: null });
    mockUseSessionTimeout.mockReturnValue({
      showWarning: true,
      remainingSeconds: 10,
      extendSession: vi.fn(),
    });

    renderWithProviders(
      <SessionTimeoutProvider>
        <div>content</div>
      </SessionTimeoutProvider>
    );

    expect(screen.getByText('content')).toBeInTheDocument();
    expect(screen.queryByTestId('session-timeout-warning')).not.toBeInTheDocument();
    expect(warningProps).toBeNull();
  });

  it('renders warning when user is present and wires handlers', () => {
    const extend = vi.fn();
    mockUseAuth.mockReturnValue({ user: { id: 'user-1' } });
    mockUseSessionTimeout.mockReturnValue({
      showWarning: true,
      remainingSeconds: 120,
      extendSession: extend,
    });

    renderWithProviders(
      <SessionTimeoutProvider timeoutMinutes={30} warningMinutes={5}>
        <div>content</div>
      </SessionTimeoutProvider>
    );

    expect(screen.getByTestId('session-timeout-warning')).toBeInTheDocument();
    const props = warningProps;
    if (props === null) throw new Error('SessionTimeoutWarning was not rendered');
    expect(props.open).toBe(true);
    expect(props.remainingSeconds).toBe(120);

    // Verify the logout handler calls useSignOut().mutateAsync
    expect(typeof props.onLogout).toBe('function');
    return props.onLogout().then(() => {
      expect(signOutMutateAsync).toHaveBeenCalled();
    });
  });
});
