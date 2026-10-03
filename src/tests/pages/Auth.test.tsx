import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Auth from '@/pages/Auth';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

vi.mock("@/components/layout/Header", () => ({
  Header: () => <div data-testid="mock-header">Header</div>,
}));

vi.mock("@/components/layout/Footer", () => ({
  Footer: () => <div data-testid="mock-footer">Footer</div>,
}));

const mockOidcLogin = vi.fn().mockResolvedValue(undefined);
vi.mock('@/integrations/auth', () => ({
  login: (...args: unknown[]) => mockOidcLogin(...args),
}));

const mockGetStoredAuthReturnPath = vi.fn().mockReturnValue(null);
const mockClearStoredAuthReturnPath = vi.fn();
vi.mock('@/hooks/useAuthReturnTracker', () => ({
  getStoredAuthReturnPath: () => mockGetStoredAuthReturnPath(),
  clearStoredAuthReturnPath: () => mockClearStoredAuthReturnPath(),
  useAuthReturnTracker: vi.fn(),
}));

vi.mock('@/hooks/useIsMountedRef', () => ({
  useIsMountedRef: () => ({ current: true }),
}));

const defaultSessionState = {
  user: null,
  session: null,
  isLoading: false,
  signOut: vi.fn(),
  roles: [] as string[],
  hasRole: vi.fn((..._args: string[]) => false),
  isAdmin: false,
  refetchRoles: vi.fn(),
};

let sessionState = { ...defaultSessionState };

vi.mock('@/hooks/useSession', () => ({
  useSession: () => sessionState,
}));

function renderAuth() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Auth />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

describe('Auth Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionState = { ...defaultSessionState, hasRole: vi.fn(() => false) };
    window.history.pushState({}, "", "/auth");
  });

  describe('Rendering', () => {
    it('renders login page with OIDC buttons', () => {
      renderAuth();
      expect(screen.getByText('auth.welcomeBack')).toBeInTheDocument();
      expect(screen.getByText('auth.signIn')).toBeInTheDocument();
      expect(screen.getByText('auth.oauth.apple')).toBeInTheDocument();
      expect(screen.getByText('auth.oauth.google')).toBeInTheDocument();
    });

    it('renders back to home link', () => {
      renderAuth();
      expect(screen.getByText('auth.backToHome')).toBeInTheDocument();
    });

    it('renders secure info text', () => {
      renderAuth();
      expect(screen.getByText('auth.secureInfo')).toBeInTheDocument();
    });
  });

  describe('OIDC Login Flow', () => {
    it('calls oidcLogin without idpHint on sign in click', async () => {
      renderAuth();

      await userEvent.click(screen.getByText('auth.signIn'));

      await waitFor(() => {
        expect(mockOidcLogin).toHaveBeenCalledWith(
          expect.objectContaining({ returnPath: '/' })
        );
      });
    });

    it('calls oidcLogin with apple idpHint', async () => {
      renderAuth();

      await userEvent.click(screen.getByText('auth.oauth.apple'));

      await waitFor(() => {
        expect(mockOidcLogin).toHaveBeenCalledWith(
          expect.objectContaining({ idpHint: 'apple' })
        );
      });
    });

    it('calls oidcLogin with google idpHint', async () => {
      renderAuth();

      await userEvent.click(screen.getByText('auth.oauth.google'));

      await waitFor(() => {
        expect(mockOidcLogin).toHaveBeenCalledWith(
          expect.objectContaining({ idpHint: 'google' })
        );
      });
    });
  });

  describe('Post-Auth Redirect', () => {
    it('redirects to role default when user is already logged in', async () => {
      sessionState = {
        ...defaultSessionState,
        user: { id: 'user-1' } as never,
        session: { access_token: 'tok' } as never,
        isLoading: false,
        hasRole: vi.fn(() => false),
        roles: [],
      };

      renderAuth();

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/member?lang=en', { replace: true });
      });
    });

    it('redirects admin to /admin', async () => {
      sessionState = {
        ...defaultSessionState,
        user: { id: 'user-1' } as never,
        session: { access_token: 'tok' } as never,
        isLoading: false,
        hasRole: vi.fn((role: string) => role === 'admin'),
        roles: ['admin'],
      };

      renderAuth();

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/admin?lang=en', { replace: true });
      });
    });

    it('uses safe redirect from query param', async () => {
      window.history.pushState({}, '', '/auth?redirect=%2Fpartner%2Fdashboard');
      sessionState = {
        ...defaultSessionState,
        user: { id: 'user-1' } as never,
        session: { access_token: 'tok' } as never,
        isLoading: false,
        hasRole: vi.fn(() => false),
        roles: [],
      };

      renderAuth();

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/partner/dashboard', { replace: true });
      });
    });

    it('rejects external redirect and falls back to role default', async () => {
      window.history.pushState({}, '', '/auth?redirect=https%3A%2F%2Fevil.example');
      sessionState = {
        ...defaultSessionState,
        user: { id: 'user-1' } as never,
        session: { access_token: 'tok' } as never,
        isLoading: false,
        hasRole: vi.fn(() => false),
        roles: [],
      };

      renderAuth();

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/member?lang=en', { replace: true });
      });
    });

    it('rejects unsafe stored return path', async () => {
      mockGetStoredAuthReturnPath.mockReturnValue('//evil.example/path');
      sessionState = {
        ...defaultSessionState,
        user: { id: 'user-1' } as never,
        session: { access_token: 'tok' } as never,
        isLoading: false,
        hasRole: vi.fn(() => false),
        roles: [],
      };

      renderAuth();

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/member?lang=en', { replace: true });
      });
    });

    it('uses safe stored return path when present', async () => {
      mockGetStoredAuthReturnPath.mockReturnValue('/partner/projects?tab=active');
      sessionState = {
        ...defaultSessionState,
        user: { id: 'user-1' } as never,
        session: { access_token: 'tok' } as never,
        isLoading: false,
        hasRole: vi.fn(() => false),
        roles: [],
      };

      renderAuth();

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/partner/projects?tab=active', { replace: true });
      });
    });
  });

  describe('Loading State', () => {
    it('shows spinner when session is loading', () => {
      sessionState = {
        ...defaultSessionState,
        isLoading: true,
      };

      renderAuth();

      expect(screen.queryByText('auth.welcomeBack')).not.toBeInTheDocument();
    });
  });
});
