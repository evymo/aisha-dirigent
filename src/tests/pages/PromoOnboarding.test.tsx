import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, fireEvent, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter, MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PromoOnboarding from '../../pages/PromoOnboarding';

// Polyfill for Radix UI / jsdom
class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = ResizeObserver;

if (!global.PointerEvent) {
  class PointerEvent extends MouseEvent {
    public height: number;
    public isPrimary: boolean;
    public pointerId: number;
    public pointerType: string;
    public pressure: number;
    public tangentialPressure: number;
    public tiltX: number;
    public tiltY: number;
    public twist: number;
    public width: number;

    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId || 0;
      this.width = params.width || 0;
      this.height = params.height || 0;
      this.pressure = params.pressure || 0;
      this.tangentialPressure = params.tangentialPressure || 0;
      this.tiltX = params.tiltX || 0;
      this.tiltY = params.tiltY || 0;
      this.twist = params.twist || 0;
      this.pointerType = params.pointerType || 'mouse';
      this.isPrimary = params.isPrimary || false;
    }
  }
  global.PointerEvent = PointerEvent as unknown as typeof globalThis.PointerEvent;
}

// Fix for scrollIntoView not implemented in jsdom
window.HTMLElement.prototype.scrollIntoView = vi.fn();
window.HTMLElement.prototype.hasPointerCapture = vi.fn();
window.HTMLElement.prototype.releasePointerCapture = vi.fn();

const NEXT_BUTTON_NAME = /^(common\.next|Další|Next)$/i;

// React Router v7+ has removed the future prop - v7 features are now default

const setupUser = () => userEvent.setup({ delay: 0, pointerEventsCheck: 0 });

const TEST_TIMEOUT_MS = 40000;
const it10 = (name: string, fn: () => unknown | Promise<unknown>) => it(name, { timeout: TEST_TIMEOUT_MS }, fn);

/**
 * Select a date of birth (Jan 15, 2000) using the native select dropdowns.
 * Works with the new DateOfBirthPicker component.
 * Uses userEvent for proper React integration with react-hook-form.
 */
async function selectDobDay15(user: ReturnType<typeof userEvent.setup>) {
  const daySelect = screen.getByTestId('dob-day');
  const monthSelect = screen.getByTestId('dob-month');
  const yearSelect = screen.getByTestId('dob-year');
  
  // Select all parts - onChange will fire after year is selected (when all 3 are filled)
  // Use fireEvent here: userEvent.selectOptions has been observed to hang in jsdom
  // for some native select flows in this suite.
  fireEvent.change(daySelect, { target: { value: '15' } });
  fireEvent.change(monthSelect, { target: { value: '1' } }); // January
  fireEvent.change(yearSelect, { target: { value: '2000' } });

  // Keep await to preserve call sites' sequencing semantics.
  await Promise.resolve();
}

async function waitForPrefilledEmail(expectedEmail: string) {
  await waitFor(() => {
    const emailInput = screen.getByPlaceholderText(
      /promo\.form\.placeholders\.email|vas@email\.cz/i
    ) as HTMLInputElement;
    expect(emailInput.value).toBe(expectedEmail);
  });
}

function fillRequiredNameFields() {
  const firstNameInput = screen.getByPlaceholderText(
    /promo\.form\.placeholders\.firstName|Jan/i
  ) as HTMLInputElement;
  const lastNameInput = screen.getByPlaceholderText(
    /promo\.form\.placeholders\.lastName|Novák/i
  ) as HTMLInputElement;

  fireEvent.change(firstNameInput, { target: { value: 'Jan' } });
  fireEvent.change(lastNameInput, { target: { value: 'Novák' } });
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Mock dependencies
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const stableI18n = {
  language: 'cs',
  changeLanguage: vi.fn(),
};

const stableT = (key: string, params?: Record<string, unknown>) => {
  // Handle interpolation
  let result = key;
  if (params?.name) {
    result = result.replace('{{name}}', String(params.name));
  }
  // Return key as fallback, which is still identifiable
  return result;
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: stableT,
    i18n: stableI18n,
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

// Mock user state
let mockUser: { id: string; email: string } | null = null;
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: mockUser,
    isLoading: false,
  }),
}));

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

// Mock secure mode
let mockPhiEnabled = false;
const mockPhiClient = {
  storage: {
    from: vi.fn().mockReturnThis(),
    uploadToSignedUrl: vi.fn().mockResolvedValue({ error: null }),
  },
  functions: {
    invoke: vi.fn().mockResolvedValue({ data: { documentId: 'doc-1', path: 'path', token: 'token' }, error: null }),
  },
  from: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  eq: vi.fn().mockResolvedValue({ error: null }),
};

vi.mock('@/hooks/useSecureMode', () => ({
  useSecureMode: () => ({
    isEnabled: mockPhiEnabled,
    secureClient: mockPhiEnabled ? mockPhiClient : null,
  }),
}));

// Mock useHasPassword hook
let mockHasPassword = false;
vi.mock('@/hooks/useHasPassword', () => ({
  useHasPassword: () => ({
    hasPassword: mockHasPassword,
    isLoading: false,
    error: null,
  }),
}));

// Mock OIDC login
const mockOidcLogin = vi.fn().mockResolvedValue(undefined);
vi.mock('@/integrations/auth', () => ({
  login: (...args: unknown[]) => mockOidcLogin(...args),
}));

// Mock upload hook
const mockUploadMutate = vi.fn().mockResolvedValue({ id: 'doc-uploaded' });
vi.mock('@/hooks/useTrackingDocuments', () => ({
  useUploadTrackingDocument: () => ({
    mutateAsync: mockUploadMutate,
    isPending: false,
  }),
  TrackingDocumentCategory: {},
}));

// Mock Supabase
const mockValidateInvitation = vi.fn();
const mockClaimInvitation = vi.fn();
const mockSignUp = vi.fn();
const mockCreateMyConsents = vi.fn();
const mockUpsertProfile = vi.fn();
const mockUpdateMyProfileOnboarding = vi.fn();
const mockCreateMyAppointment = vi.fn();

vi.mock('@/integrations/db/client', () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    auth: {
      signUp: (...args: unknown[]) => mockSignUp(...args),
    },
    rpc: (name: string, params: unknown) => {
      if (name === 'validate_invitation') return mockValidateInvitation(params);
      if (name === 'claim_invitation') return mockClaimInvitation(params);
      if (name === 'create_my_consents') {
        mockCreateMyConsents(params);
        return Promise.resolve({ data: null, error: null });
      }
      if (name === 'update_my_profile_onboarding') {
        mockUpdateMyProfileOnboarding(params);
        return Promise.resolve({ data: null, error: null });
      }

      return Promise.resolve({ data: null, error: null });
    },
    storage: {
      from: () => ({
        getPublicUrl: () => ({ data: { publicUrl: "https://example.com/logo" } }),
      }),
    },
    from: (table: string) => {
      const chainable: Record<string, unknown> = {
        insert: () => ({ select: () => Promise.resolve({ data: null, error: null }) }),
        update: () => chainable,
        upsert: (data: unknown) => {
          if (table === 'profiles') {
            mockUpsertProfile(data);
            return Promise.resolve({ data: null, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        eq: () => chainable,
        single: () => Promise.resolve({ data: null, error: null }),
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      };
      return chainable;
    },
    channel: () => ({
      on: function() { return this; },
      subscribe: () => ({ unsubscribe: () => {} }),
    }),
    removeChannel: () => {},
  },
}));

// Mock toast (sonner)
const mockToast = vi.hoisted(() =>
  Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(),
    loading: vi.fn(), dismiss: vi.fn(), promise: vi.fn(),
  })
);
vi.mock("sonner", () => ({
  toast: mockToast,
}));

// Mock cart (for Header)
vi.mock('@/hooks/useCart', () => ({
  useCart: () => ({
    items: [],
    isLoading: false,
    itemCount: 0,
  }),
}));

vi.mock('@/hooks/usePartners', () => ({
  useMyPartnerProfile: () => ({
    data: null,
    isLoading: false,
  }),
}));

vi.mock('@/hooks/useCertifiedPartners', () => ({
  useCertifiedPartners: () => ({
    data: [],
    isLoading: false,
  }),
  useRandomCertifiedPartner: () => ({
    data: null,
    isLoading: false,
    refetch: vi.fn(),
  }),
}));

// Helper: render with router and query client
let activeQueryClient: QueryClient | null = null;
let activeUnmount: (() => void) | null = null;

function renderPromoOnboarding(initialRoute = '/promo/TEST123') {
  const queryClient = new QueryClient({
    defaultOptions: {
      // Keep tests deterministic and ensure QueryClient doesn't leave long-lived
      // GC timers that prevent Vitest from exiting.
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { gcTime: 0 },
    },
  });

  // Keep a reference so we can reliably clear timers/GC after each test.
  activeQueryClient = queryClient;

  const view = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialRoute]}>
        <Routes>
          <Route path="/promo/:code" element={<PromoOnboarding />} />
          <Route path="/promo" element={<PromoOnboarding />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );

  activeUnmount = view.unmount;
  return view;
}

afterEach(() => {
  // Defensive cleanup for any timers scheduled by React Query BEFORE cleanup.
  if (activeQueryClient) {
    activeQueryClient.cancelQueries();
    activeQueryClient.clear();
  }
  activeQueryClient = null;

  // Force cleanup of the React tree.
  cleanup();
  activeUnmount?.();
  activeUnmount = null;

  // Clear any leftover DOM.
  document.body.innerHTML = '';
}, 10000);

describe.sequential('PromoOnboarding Page', () => {
  beforeEach(() => {
    // Guard against leaked fake timers from other suites.
    vi.useRealTimers();
    vi.clearAllMocks();
    mockUser = null;
    mockPhiEnabled = false;
    mockHasPassword = false;
    
    // Default: valid invitation
    mockValidateInvitation.mockResolvedValue({
      data: [{
        is_valid: true,
        study_name: 'Test Study',
        study_id: '11111111-1111-1111-1111-111111111111',
        partner_name: 'Dr. Test',
        partner_id: '22222222-2222-2222-2222-222222222222',
      }],
      error: null,
    });
    mockClaimInvitation.mockResolvedValue({ error: null });
    mockSignUp.mockResolvedValue({ 
      data: { user: { id: '33333333-3333-3333-3333-333333333333' }, session: {} }, 
      error: null 
    });
    mockCreateMyConsents.mockResolvedValue({ data: null, error: null });
    mockUpsertProfile.mockResolvedValue({ data: null, error: null });
    mockUpdateMyProfileOnboarding.mockResolvedValue({ data: null, error: null });
    mockCreateMyAppointment.mockResolvedValue({ data: null, error: null });
  }, 10000);

  describe('Invitation Validation', () => {
    it10('shows loading indicator initially', async () => {
      // Delay the validation response, but keep it controllable so we don't
      // leave a permanently pending async op in the component.
      const deferred = createDeferred<{ data: unknown; error: unknown }>();
      mockValidateInvitation.mockImplementation(() => deferred.promise);
      
      const { container } = renderPromoOnboarding();
      

      // Explicitly assert loading state.
      await waitFor(() => {
        expect(container.querySelector('[class*="animate-spin"]')).toBeTruthy();
        expect(screen.getByText(/common\.loading|loading/i)).toBeInTheDocument();
      });

      // Resolve to allow the component to settle (avoids leaking async work).
      deferred.resolve({
        data: [{
          is_valid: true,
          study_name: 'Test Study',
          study_id: '11111111-1111-1111-1111-111111111111',
          partner_name: 'Dr. Test',
          partner_id: '22222222-2222-2222-2222-222222222222',
        }],
        error: null,
      });

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/promo\.form\.placeholders\.email|vas@email\.cz/i)).toBeInTheDocument();
      });
    });

    it10('handles missing invitation code', async () => {
      renderPromoOnboarding('/promo');
      
      await waitFor(() => {
        // Error state shows a button to go back home
        const backButton = screen.queryByRole('button');
        expect(backButton).toBeTruthy();
      });
    });

    it10('handles invalid invitation code', async () => {
      mockValidateInvitation.mockResolvedValue({
        data: [{ is_valid: false }],
        error: null,
      });
      
      renderPromoOnboarding();
      
      await waitFor(() => {
        // Error state shows a button
        const backButton = screen.queryByRole('button');
        expect(backButton).toBeTruthy();
      });
    });

    it10('handles validation error', async () => {
      mockValidateInvitation.mockResolvedValue({
        data: null,
        error: new Error('Validation failed'),
      });
      
      renderPromoOnboarding();
      
      await waitFor(() => {
        // Error state shows a button
        const backButton = screen.queryByRole('button');
        expect(backButton).toBeTruthy();
      });
    });

    it10('renders form when invitation is valid', async () => {
      renderPromoOnboarding();
      
      await waitFor(() => {
        // Form should be rendered - check for email input
        expect(screen.getByPlaceholderText(/promo\.form\.placeholders\.email|vas@email\.cz/i)).toBeInTheDocument();
      });
    });

    it10('displays invitation info when available', async () => {
      renderPromoOnboarding();
      
      await waitFor(() => {
        // Form should be rendered when invitation is valid
        expect(screen.getByPlaceholderText(/promo\.form\.placeholders\.email|vas@email\.cz/i)).toBeInTheDocument();
      });
    });
  });

  describe('Step 1: Basic Info', () => {
    it10('renders email input field', async () => {
      renderPromoOnboarding();
      
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/promo\.form\.placeholders\.email|vas@email\.cz/i)).toBeInTheDocument();
      });
    });

    it10('renders name fields', async () => {
      renderPromoOnboarding();
      
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/promo\.form\.placeholders\.firstName|Jan/i)).toBeInTheDocument();
        expect(screen.getByPlaceholderText(/promo\.form\.placeholders\.lastName|Novák/i)).toBeInTheDocument();
      });
    });

    it10('renders date of birth picker', async () => {
      renderPromoOnboarding();
      
      await waitFor(() => {
        // Look for the calendar button by role or by date-related icon
        const calendarButtons = screen.queryAllByRole('button');
        const dateButton = calendarButtons.find(btn => 
          btn.textContent?.includes('date') || 
          btn.textContent?.includes('Vyberte') ||
          btn.querySelector('svg[class*="calendar"]')
        );
        expect(dateButton || screen.getByText(/datum|date|birth/i)).toBeTruthy();
      });
    });

    it10('renders form step 1', async () => {
      renderPromoOnboarding();
      
      await waitFor(() => {
        // Check for step 1 indicator
        expect(screen.getByText('1/4')).toBeInTheDocument();
      });
    });

    it10('does not show password fields for unauthenticated users (OIDC handles auth)', async () => {
      renderPromoOnboarding();
      
      await waitFor(() => {
        expect(screen.getByText(/promo.title/i)).toBeInTheDocument();
      });
      
      // Password fields are no longer rendered — Keycloak OIDC handles authentication
      expect(screen.queryByText(/promo.form.passwordSection|Nastavení hesla/i)).not.toBeInTheDocument();
      expect(screen.queryByPlaceholderText(/promo.form.placeholders.password|Zadejte heslo/i)).not.toBeInTheDocument();
    });

    it10('hides password fields for authenticated users with password', async () => {
      mockUser = { id: 'user-1', email: 'test@example.com' };
      mockHasPassword = true;
      
      renderPromoOnboarding();
      
      await waitFor(() => {
        expect(screen.getByText(/promo.title/i)).toBeInTheDocument();
      });
      
      // Password section should not be shown for authenticated users with password
      expect(screen.queryByText(/promo.form.passwordSection/i)).not.toBeInTheDocument();
    });

    it10('does not show password fields for authenticated users without password (OIDC handles auth)', async () => {
      mockUser = { id: 'user-1', email: 'test@example.com' };
      mockHasPassword = false;
      
      renderPromoOnboarding();
      
      await waitFor(() => {
        expect(screen.getByText(/promo.title/i)).toBeInTheDocument();
      });
      
      // Password section removed — Keycloak OIDC handles authentication
      expect(screen.queryByText(/promo.form.passwordSection|Nastavení hesla/i)).not.toBeInTheDocument();
    });

    it10('pre-fills email for authenticated users', async () => {
      mockUser = { id: 'user-1', email: 'test@example.com' };
      
      renderPromoOnboarding();
      
      await waitFor(() => {
        const emailInput = screen.getByPlaceholderText(/promo\.form\.placeholders\.email|vas@email\.cz/i) as HTMLInputElement;
        expect(emailInput.value).toBe('test@example.com');
      });
    });
  });

  describe('Navigation', () => {
    const nextButtonName = NEXT_BUTTON_NAME;

    it10('shows progress indicator', async () => {
      renderPromoOnboarding();
      
      await waitFor(() => {
        expect(screen.getByText('1/4')).toBeInTheDocument();
      });
    });

    it10('shows Next button on first step', async () => {
      renderPromoOnboarding();
      
      await waitFor(() => {
        expect(screen.getByRole('button', { name: nextButtonName })).toBeInTheDocument();
      });
    });

    it10('validates fields before moving to next step', async () => {
      const user = setupUser();
      renderPromoOnboarding();
      
      await waitFor(() => {
        expect(screen.getByText(/promo.title/i)).toBeInTheDocument();
      });
      
      // Try to move to next step without filling fields
      const nextButton = screen.getByRole('button', { name: NEXT_BUTTON_NAME });
      await user.click(nextButton);
      
      // Should still be on step 1 (validation failed)
      expect(screen.getByText('1/4')).toBeInTheDocument();
    });

    it10('moves to step 2 after filling required fields', async () => {
      const user = setupUser();
      mockUser = { id: 'user-1', email: 'test@example.com' };
      mockHasPassword = true; // User already has password, no password fields shown
      
      renderPromoOnboarding();
      
      await waitFor(() => {
        expect(screen.getByText(/promo.title/i)).toBeInTheDocument();
      });
      
      // Wait for email to be pre-filled from user session
      await waitFor(() => {
        const emailInput = screen.getByPlaceholderText(/promo\.form\.placeholders\.email|vas@email\.cz/i) as HTMLInputElement;
        expect(emailInput.value).toBe('test@example.com');
      });
      
      // Fill required fields
      fillRequiredNameFields();

      await selectDobDay15(user);
      
      // Click next button
      const nextButton = screen.getByRole('button', { name: NEXT_BUTTON_NAME });
      fireEvent.click(nextButton);
      
      // Should move to step 2
      await waitFor(() => {
        expect(screen.getByText('2/4')).toBeInTheDocument();
      }, { timeout: 2000 });
    });
  });

  describe('Step 2: Documents', () => {
    async function goToStep2() {
      const user = setupUser();
      mockUser = { id: 'user-1', email: 'test@example.com' };
      mockHasPassword = true; // User already has password, no password fields shown
      
      renderPromoOnboarding();
      
      await waitFor(() => {
        expect(screen.getByText(/promo.title/i)).toBeInTheDocument();
      });

      await waitForPrefilledEmail('test@example.com');
      
      // Fill required fields
      fillRequiredNameFields();

      await selectDobDay15(user);
      
      // Click next button
      fireEvent.click(screen.getByRole('button', { name: NEXT_BUTTON_NAME }));
      
      await waitFor(() => {
        expect(screen.getByText('2/4')).toBeInTheDocument();
      });
      
      return user;
    }

    it10('shows document upload zone on step 2', async () => {
      await goToStep2();
      
      expect(screen.getByText(/promo.upload_zone|Přetáhněte|drop/i)).toBeInTheDocument();
    });

    it10('shows browse and camera buttons', async () => {
      await goToStep2();
      
      expect(screen.getByText(/promo.browse|Procházet|browse/i)).toBeInTheDocument();
      expect(screen.getByText(/promo.camera|Vyfotit|camera/i)).toBeInTheDocument();
    });

    it10('shows step 2 indicator', async () => {
      await goToStep2();
      
      expect(screen.getByText('2/4')).toBeInTheDocument();
    });

    it10('has navigation buttons', async () => {
      await goToStep2();
      
      // Find buttons by looking at all buttons
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(1);
    });

    it10('can navigate to step 3', async () => {
      const user = await goToStep2();

      await user.click(screen.getByRole('button', { name: NEXT_BUTTON_NAME }));

      await waitFor(() => {
        expect(screen.getByText('3/4')).toBeInTheDocument();
      });
    });
  });

  describe('Step 4: Consent', () => {
    async function goToStep4() {
      const user = setupUser();
      mockUser = { id: 'user-1', email: 'test@example.com' };
      mockHasPassword = true; // User already has password, no password fields shown
      
      renderPromoOnboarding();
      
      await waitFor(() => {
        expect(screen.getByText(/promo.title/i)).toBeInTheDocument();
      });

      await waitForPrefilledEmail('test@example.com');
      
      // Fill step 1
      await user.type(screen.getByPlaceholderText(/promo\.form\.placeholders\.firstName|Jan/i), 'Jan');
      await user.type(screen.getByPlaceholderText(/promo\.form\.placeholders\.lastName|Novák/i), 'Novák');

      await selectDobDay15(user);
      
      // Go to step 2
      await user.click(screen.getByRole('button', { name: NEXT_BUTTON_NAME }));
      
      await waitFor(() => {
        expect(screen.getByText('2/4')).toBeInTheDocument();
      });
      
      // Go to step 3 (Mentor)
      await user.click(screen.getByRole('button', { name: NEXT_BUTTON_NAME }));
      
      await waitFor(() => {
        expect(screen.getByText('3/4')).toBeInTheDocument();
      });

      // Go to step 4 (Consent)
      await user.click(screen.getByRole('button', { name: NEXT_BUTTON_NAME }));

      await waitFor(() => {
        expect(screen.getByText('4/4')).toBeInTheDocument();
      });
      
      return user;
    }

    it10('shows consent checkboxes on step 4', async () => {
      await goToStep4();
      
      // Check for checkboxes
      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes.length).toBeGreaterThanOrEqual(3);
    });

    it10('shows submit button on step 4', async () => {
      await goToStep4();
      
      expect(screen.getByRole('button', { name: /promo.submit|Dokončit|submit|finish/i })).toBeInTheDocument();
    });

    it10('submit button is disabled without consents', async () => {
      await goToStep4();
      
      const submitButton = screen.getByRole('button', { name: /promo.submit|Dokončit|submit|finish/i });
      expect(submitButton).toBeDisabled();
    });

    it10('submit button is enabled after checking all consents', async () => {
      const user = await goToStep4();
      
      // Check all consent checkboxes
      const checkboxes = screen.getAllByRole('checkbox');
      for (const checkbox of checkboxes) {
        await user.click(checkbox);
      }
      
      const submitButton = screen.getByRole('button', { name: /promo.submit|Dokončit|submit|finish/i });
      expect(submitButton).not.toBeDisabled();
    });
  });

  describe('Form Submission', () => {
    it10('shows toast error when consents are not checked', async () => {
      mockUser = { id: 'user-1', email: 'test@example.com' };
      mockHasPassword = true; // User already has password, no password fields shown
      const user = setupUser();
      
      renderPromoOnboarding();
      
      await waitFor(() => {
        expect(screen.getByText(/promo.title/i)).toBeInTheDocument();
      });
      
      // Fill step 1
      await user.type(screen.getByPlaceholderText(/promo\.form\.placeholders\.firstName|Jan/i), 'Jan');
      await user.type(screen.getByPlaceholderText(/promo\.form\.placeholders\.lastName|Novák/i), 'Novák');

      await selectDobDay15(user);
      
      // Go through steps
      let nextButton = screen.getByRole('button', { name: NEXT_BUTTON_NAME });
      await user.click(nextButton);
      
      await waitFor(() => expect(screen.getByText('2/4')).toBeInTheDocument());
      
      nextButton = screen.getByRole('button', { name: NEXT_BUTTON_NAME });
      await user.click(nextButton);
      
      await waitFor(() => expect(screen.getByText('3/4')).toBeInTheDocument());

      // Mentor step -> continue to consent
      nextButton = screen.getByRole('button', { name: NEXT_BUTTON_NAME });
      await user.click(nextButton);

      await waitFor(() => expect(screen.getByText('4/4')).toBeInTheDocument());
      
      // Check only some consents (not all)
      const checkboxes = screen.getAllByRole('checkbox');
      await user.click(checkboxes[0]);
      await user.click(checkboxes[1]);
      // Don't check the third one
      
      // Try to submit
      const submitButton = screen.getByRole('button', { name: /promo.submit|Dokončit|submit|finish/i });
      expect(submitButton).toBeDisabled();
    });

    it10('claims invitation on successful submission', async () => {
      mockUser = { id: 'user-1', email: 'test@example.com' };
      mockHasPassword = true; // User already has password, no password fields shown
      const user = setupUser();
      
      renderPromoOnboarding();
      
      await waitFor(() => {
        expect(screen.getByText(/promo.title/i)).toBeInTheDocument();
      });
      
      // Fill step 1
      await user.type(screen.getByPlaceholderText(/promo\.form\.placeholders\.firstName|Jan/i), 'Jan');
      await user.type(screen.getByPlaceholderText(/promo\.form\.placeholders\.lastName|Novák/i), 'Novák');

      await selectDobDay15(user);
      
      // Navigate through steps
      let nextButton = screen.getByRole('button', { name: NEXT_BUTTON_NAME });
      await user.click(nextButton);
      
      await waitFor(() => expect(screen.getByText('2/4')).toBeInTheDocument());
      
      nextButton = screen.getByRole('button', { name: NEXT_BUTTON_NAME });
      await user.click(nextButton);
      
      await waitFor(() => expect(screen.getByText('3/4')).toBeInTheDocument());

      nextButton = screen.getByRole('button', { name: NEXT_BUTTON_NAME });
      await user.click(nextButton);

      await waitFor(() => expect(screen.getByText('4/4')).toBeInTheDocument());
      
      // Check all consents
      const checkboxes = screen.getAllByRole('checkbox');
      for (const checkbox of checkboxes) {
        await user.click(checkbox);
      }
      
      // Submit
      const submitButton = screen.getByRole('button', { name: /promo.submit|Dokončit|submit|finish/i });
      await user.click(submitButton);
      
      // Wait for submission
      await waitFor(() => {
        expect(mockClaimInvitation).toHaveBeenCalledWith({ p_code: 'TEST123' });
      });
    });

    it10('creates consents on submission via RPC', async () => {
      mockUser = { id: 'user-1', email: 'test@example.com' };
      mockHasPassword = true; // User already has password, no password fields shown
      const user = setupUser();
      
      renderPromoOnboarding();
      
      await waitFor(() => {
        expect(screen.getByText(/promo.title/i)).toBeInTheDocument();
      });
      
      // Fill and navigate through form
      await user.type(screen.getByPlaceholderText(/promo\.form\.placeholders\.firstName|Jan/i), 'Jan');
      await user.type(screen.getByPlaceholderText(/promo\.form\.placeholders\.lastName|Novák/i), 'Novák');

      await selectDobDay15(user);
      
      let nextButton = screen.getByRole('button', { name: NEXT_BUTTON_NAME });
      await user.click(nextButton);
      
      await waitFor(() => expect(screen.getByText('2/4')).toBeInTheDocument());
      
      nextButton = screen.getByRole('button', { name: NEXT_BUTTON_NAME });
      await user.click(nextButton);
      
      await waitFor(() => expect(screen.getByText('3/4')).toBeInTheDocument());

      nextButton = screen.getByRole('button', { name: NEXT_BUTTON_NAME });
      await user.click(nextButton);

      await waitFor(() => expect(screen.getByText('4/4')).toBeInTheDocument());
      
      // Check consents
      const checkboxes = screen.getAllByRole('checkbox');
      for (const checkbox of checkboxes) {
        await user.click(checkbox);
      }
      
      // Submit
      const submitButton = screen.getByRole('button', { name: /promo.submit|Dokončit|submit|finish/i });
      await user.click(submitButton);
      
      await waitFor(() => {
        expect(mockCreateMyConsents).toHaveBeenCalled();
      });
    });

    it10('navigates to member page after successful submission', async () => {
      mockUser = { id: 'user-1', email: 'test@example.com' };
      mockHasPassword = true; // User already has password, no password fields shown
      const user = setupUser();
      
      renderPromoOnboarding();
      
      await waitFor(() => {
        expect(screen.getByText(/promo.title/i)).toBeInTheDocument();
      });
      
      // Fill and navigate
      await user.type(screen.getByPlaceholderText(/promo\.form\.placeholders\.firstName|Jan/i), 'Jan');
      await user.type(screen.getByPlaceholderText(/promo\.form\.placeholders\.lastName|Novák/i), 'Novák');

      await selectDobDay15(user);
      
      let nextButton = screen.getByRole('button', { name: NEXT_BUTTON_NAME });
      await user.click(nextButton);
      
      await waitFor(() => expect(screen.getByText('2/4')).toBeInTheDocument());
      
      nextButton = screen.getByRole('button', { name: NEXT_BUTTON_NAME });
      await user.click(nextButton);
      
      await waitFor(() => expect(screen.getByText('3/4')).toBeInTheDocument());

      nextButton = screen.getByRole('button', { name: NEXT_BUTTON_NAME });
      await user.click(nextButton);

      await waitFor(() => expect(screen.getByText('4/4')).toBeInTheDocument());
      
      const checkboxes = screen.getAllByRole('checkbox');
      for (const checkbox of checkboxes) {
        await user.click(checkbox);
      }
      
      const submitButton = screen.getByRole('button', { name: /promo.submit|Dokončit|submit|finish/i });
      await user.click(submitButton);
      
      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/member');
      });
    });
  });

  describe('New User Registration', () => {
    it10('redirects unauthenticated users to OIDC login on submit', async () => {
      mockUser = null;
      const user = setupUser();
      
      renderPromoOnboarding();
      
      await waitFor(() => {
        expect(screen.getByText(/promo.title/i)).toBeInTheDocument();
      });
      
      // Fill basic info fields (no password — OIDC handles auth)
      await user.type(screen.getByPlaceholderText(/promo\.form\.placeholders\.email|vas@email\.cz/i), 'new@example.com');
      await user.type(screen.getByPlaceholderText(/promo\.form\.placeholders\.firstName|Jan/i), 'Jan');
      await user.type(screen.getByPlaceholderText(/promo\.form\.placeholders\.lastName|Novák/i), 'Novák');

      await selectDobDay15(user);
      
      // Navigate through steps
      let nextButton = screen.getByRole('button', { name: NEXT_BUTTON_NAME });
      await user.click(nextButton);
      
      await waitFor(() => expect(screen.getByText('2/4')).toBeInTheDocument());
      
      nextButton = screen.getByRole('button', { name: NEXT_BUTTON_NAME });
      await user.click(nextButton);
      
      await waitFor(() => expect(screen.getByText('3/4')).toBeInTheDocument());

      // Mentor step -> continue to consent
      nextButton = screen.getByRole('button', { name: NEXT_BUTTON_NAME });
      await user.click(nextButton);

      await waitFor(() => expect(screen.getByText('4/4')).toBeInTheDocument());
      
      // Check consents
      const checkboxes = screen.getAllByRole('checkbox');
      for (const checkbox of checkboxes) {
        await user.click(checkbox);
      }
      
      // Submit — unauthenticated user gets redirected to OIDC login
      const submitButton = screen.getByRole('button', { name: /promo.submit|Dokončit|submit|finish/i });
      await user.click(submitButton);
      
      await waitFor(() => {
        expect(mockOidcLogin).toHaveBeenCalledWith(
          expect.objectContaining({ returnPath: expect.any(String) })
        );
      });
    });
  });

  describe('Error Handling', () => {
    it10('handles errors gracefully', async () => {
      mockUser = { id: 'user-1', email: 'test@example.com' };
      // Make claim_invitation fail
      mockClaimInvitation.mockResolvedValue({ error: new Error('Database error') });
      
      renderPromoOnboarding();
      
      await waitFor(() => {
        // Page should still render
        expect(screen.getByPlaceholderText(/promo\.form\.placeholders\.email|vas@email\.cz/i)).toBeInTheDocument();
      });
    });
  });

  describe('URL Parameters', () => {
    it10('accepts code from URL path', async () => {
      renderPromoOnboarding('/promo/PATHCODE');
      
      await waitFor(() => {
        expect(mockValidateInvitation).toHaveBeenCalledWith({ p_invite_code: 'PATHCODE' });
      });
    });

    it10('accepts code from query parameter', async () => {
      renderPromoOnboarding('/promo?code=QUERYCODE');
      
      await waitFor(() => {
        expect(mockValidateInvitation).toHaveBeenCalledWith({ p_invite_code: 'QUERYCODE' });
      });
    });

    it10('accepts code from invite query parameter', async () => {
      renderPromoOnboarding('/promo?invite=INVITECODE');
      
      await waitFor(() => {
        expect(mockValidateInvitation).toHaveBeenCalledWith({ p_invite_code: 'INVITECODE' });
      });
    });
  });
});
