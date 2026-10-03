import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import InformedConsent from '@/pages/InformedConsent';

// React Router v7+ has removed the future prop - v7 features are now default

// Mock dependencies
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

let mockUser: { id: string; email: string } | null = { id: 'user-1', email: 'test@example.com' };
vi.mock('@/hooks/useSession', () => ({
  useSession: () => ({
    user: mockUser,
    isLoading: false,
    hasRole: vi.fn(),
    roles: [],
    isAdmin: false,
    signOut: vi.fn(),
  }),
}));

vi.mock('@/hooks/useMembership', () => ({
  useMembership: () => ({
    membership: null,
    loading: false,
  }),
}));

vi.mock('@/hooks/useCart', () => ({
  useCart: () => ({
    items: [],
    loading: false,
    itemCount: 0,
  }),
}));

vi.mock('@/hooks/usePartners', () => ({
  useMyPartnerProfile: () => ({
    data: null,
    isLoading: false,
  }),
}));

// Mock InformedConsentForm component
vi.mock('@/components/consent/InformedConsentForm', () => ({
  InformedConsentForm: ({ studyId, studyName, onConsentGranted, onCancel }: {
    studyId?: string;
    studyName?: string;
    onConsentGranted: () => void;
    onCancel: () => void;
  }) => (
    <div data-testid="informed-consent-form">
      <p>Study ID: {studyId || 'none'}</p>
      <p>Study Name: {studyName || 'none'}</p>
      <button onClick={onConsentGranted}>Grant Consent</button>
      <button onClick={onCancel}>Cancel</button>
    </div>
  ),
}));

function renderInformedConsent(route = '/informed-consent') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <InformedConsent />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('InformedConsent Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = { id: 'user-1', email: 'test@example.com' };
  });

  describe('Unauthenticated User', () => {
    it('shows login required message when user is not logged in', () => {
      mockUser = null;
      renderInformedConsent();
      
      expect(screen.getByText('auth.loginRequired')).toBeInTheDocument();
      expect(screen.getByText('auth.loginRequiredDesc')).toBeInTheDocument();
    });

    it('shows sign in button for unauthenticated users', () => {
      mockUser = null;
      renderInformedConsent();
      
      expect(screen.getByRole('button', { name: 'common.signIn' })).toBeInTheDocument();
    });

    it('navigates to auth page when sign in button is clicked', async () => {
      mockUser = null;
      renderInformedConsent();
      
      await userEvent.click(screen.getByRole('button', { name: 'common.signIn' }));
      
      expect(mockNavigate).toHaveBeenCalledWith('/auth');
    });
  });

  describe('Authenticated User', () => {
    it('renders InformedConsentForm for authenticated users', () => {
      renderInformedConsent();
      
      expect(screen.getByTestId('informed-consent-form')).toBeInTheDocument();
    });

    it('shows back button', () => {
      renderInformedConsent();
      
      expect(screen.getByText('common.back')).toBeInTheDocument();
    });

    it('navigates to default return path on back click', async () => {
      renderInformedConsent();
      
      await userEvent.click(screen.getByText('common.back'));
      
      expect(mockNavigate).toHaveBeenCalledWith('/member');
    });
  });

  describe('URL Parameters', () => {
    it('passes studyId from URL to form', () => {
      renderInformedConsent('/informed-consent?studyId=study-123');
      
      expect(screen.getByText('Study ID: study-123')).toBeInTheDocument();
    });

    it('passes studyName from URL to form', () => {
      renderInformedConsent('/informed-consent?studyName=Test%20Study');
      
      expect(screen.getByText('Study Name: Test Study')).toBeInTheDocument();
    });

    it('uses custom returnTo path from URL', async () => {
      renderInformedConsent('/informed-consent?returnTo=/studies/123');
      
      await userEvent.click(screen.getByText('common.back'));
      
      expect(mockNavigate).toHaveBeenCalledWith('/studies/123');
    });

    it('handles multiple URL parameters', () => {
      renderInformedConsent('/informed-consent?studyId=study-123&studyName=Cancer%20Research&returnTo=/member/studies');
      
      expect(screen.getByText('Study ID: study-123')).toBeInTheDocument();
      expect(screen.getByText('Study Name: Cancer Research')).toBeInTheDocument();
    });
  });

  describe('Form Callbacks', () => {
    it('navigates to returnTo path when consent is granted', async () => {
      renderInformedConsent('/informed-consent?returnTo=/shop');
      
      await userEvent.click(screen.getByText('Grant Consent'));
      
      expect(mockNavigate).toHaveBeenCalledWith('/shop');
    });

    it('navigates to returnTo path when cancelled', async () => {
      renderInformedConsent('/informed-consent?returnTo=/member');
      
      await userEvent.click(screen.getByText('Cancel'));
      
      expect(mockNavigate).toHaveBeenCalledWith('/member');
    });

    it('uses default returnTo when not specified', async () => {
      renderInformedConsent();
      
      await userEvent.click(screen.getByText('Grant Consent'));
      
      expect(mockNavigate).toHaveBeenCalledWith('/member');
    });
  });

  describe('Layout', () => {
    it('renders header and footer', () => {
      renderInformedConsent();
      
      // The page structure should exist
      const main = document.querySelector('main');
      expect(main).toBeInTheDocument();
    });
  });
});
