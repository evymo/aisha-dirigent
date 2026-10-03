import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import StudyRegistration from '@/pages/StudyRegistration';
import { PhiModeProvider } from '@/hooks/useSecureMode';

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
  initReactI18next: {
    type: '3rdParty',
    init: () => {},
  },
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

const mockUmbrellaStudy = { id: 'umbrella-1', name: 'AISHA Community', code: 'AISHA-OBS-001' };
let mockExistingRegistration: { id: string } | null = null;
let mockRiiLoading = false;
let mockIsRIIMember = false;
let mockIsPendingRII = false;
let mockHasCompletedQuestionnaire = false;
let mockUmbrellaStudyId: string | null = 'umbrella-1';
vi.mock('@/hooks/useRIIMembership', () => ({
  useRIIMembership: () => ({
    umbrellaStudy: mockUmbrellaStudy,
    registration: mockExistingRegistration,
    isLoading: mockRiiLoading,
    isRIIMember: mockIsRIIMember,
    isPendingRII: mockIsPendingRII,
    hasCompletedQuestionnaire: mockHasCompletedQuestionnaire,
    umbrellaStudyId: mockUmbrellaStudyId,
  }),
}));

// Mock dynamic questionnaire hook
const mockQuestionnaireData = {
  questionnaire_id: 'q-1',
  questionnaire_code: 'study-registration',
  questionnaire_title: 'Registration Questionnaire',
  questionnaire_description: 'Please fill out this form',
  is_required: true,
  token_reward: 10,
};

const mockBlocks = [
  {
    id: 'block-1',
    block_code: 'physical_state',
    question_type: 'scale',
    translated_text: 'How do you feel physically?',
    translated_description: null,
    config: { min: 1, max: 10 },
    is_required: true,
    display_order: 1,
    step_number: 1,
    section_key: 'health',
    option_translations: null,
  },
];

let mockQuestionnaireLoading = false;
let mockQuestionnaireError: Error | null = null;
vi.mock('@/hooks/useStudyRegistrationQuestionnaire', () => ({
  useStudyRegistrationQuestionnaireWithBlocks: () => ({
    questionnaire: mockQuestionnaireData,
    questionnaireId: 'q-1',
    steps: [{ step_number: 1, section_key: 'health', blocks: mockBlocks }],
    isLoading: mockQuestionnaireLoading,
    error: mockQuestionnaireError,
  }),
}));

const mockRpc = vi.fn();
vi.mock('@/integrations/db/client', () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    auth: {
      signUp: vi.fn(),
    },
    rpc: (fn: string, params?: unknown) => mockRpc(fn, params),
    storage: {
      from: () => ({
        getPublicUrl: () => ({ data: { publicUrl: "https://example.com/logo" } }),
      }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: null, error: null }),
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
      insert: () => ({
        select: () => ({
          single: () => Promise.resolve({ data: { id: 'registration-1' }, error: null }),
        }),
      }),
    }),
    channel: vi.fn().mockReturnValue({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }),
    }),
    removeChannel: vi.fn(),
  },
}));

const mockToast = vi.hoisted(() =>
  Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(),
    loading: vi.fn(), dismiss: vi.fn(), promise: vi.fn(),
  })
);
vi.mock("sonner", () => ({
  toast: mockToast,
}));

async function renderStudyRegistration() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <PhiModeProvider>
          <StudyRegistration />
        </PhiModeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );

  // Wait for initial render to stabilize
  await waitFor(() => {
    expect(
      screen.queryByText('common.loading') || screen.queryByText('study.registration.consentsTitle')
    ).toBeTruthy();
  });

  return utils;
}

describe('StudyRegistration Page (Dynamic)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = { id: 'user-1', email: 'test@example.com' };
    mockExistingRegistration = null;
    mockRiiLoading = false;
    mockIsRIIMember = false;
    mockIsPendingRII = false;
    mockHasCompletedQuestionnaire = false;
    mockUmbrellaStudyId = 'umbrella-1';
    mockQuestionnaireLoading = false;
    mockQuestionnaireError = null;
    
    // Default RPC responses
    mockRpc.mockImplementation((fn: string) => {
      if (fn === 'get_study_consent_requirements_localized') {
        return Promise.resolve({
          data: [
            {
              id: 'consent-1',
              consent_template_id: 'template-1',
              is_required: true,
              sort_order: 1,
              template_key: 'data_processing',
              title: 'Data Processing Consent',
              content: 'I agree to data processing.',
              version: '1.0',
              requires_signature: false,
            },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
  });

  describe('Rendering', () => {
    it('renders consent phase initially', async () => {
      await renderStudyRegistration();
      
      await waitFor(() => {
        expect(screen.getByText('study.registration.consentsTitle')).toBeInTheDocument();
      });
    });

    it('shows consent description', async () => {
      await renderStudyRegistration();
      
      await waitFor(() => {
        expect(screen.getByText('study.registration.consentsDescription')).toBeInTheDocument();
      });
    });

    it('displays consent items from RPC', async () => {
      await renderStudyRegistration();
      
      await waitFor(() => {
        expect(screen.getByText('Data Processing Consent')).toBeInTheDocument();
      });
    });
  });

  describe('Consent Flow', () => {
    it('disables continue button when required consents are not checked', async () => {
      await renderStudyRegistration();
      
      await waitFor(() => {
        const continueButton = screen.getByRole('button', { name: /study.registration.continueToQuestionnaire/i });
        expect(continueButton).toBeDisabled();
      });
    });

    it('enables continue button when all required consents are checked', async () => {
      const user = userEvent.setup();
      await renderStudyRegistration();
      
      await waitFor(() => {
        expect(screen.getByText('Data Processing Consent')).toBeInTheDocument();
      });

      // Click the consent checkbox
      const checkbox = screen.getByRole('checkbox');
      await user.click(checkbox);

      await waitFor(() => {
        const continueButton = screen.getByRole('button', { name: /study.registration.continueToQuestionnaire/i });
        expect(continueButton).not.toBeDisabled();
      });
    });
  });

  describe('Loading States', () => {
    it('shows loading state when RII membership is loading', async () => {
      mockRiiLoading = true;
      
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      
      render(
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <PhiModeProvider>
              <StudyRegistration />
            </PhiModeProvider>
          </BrowserRouter>
        </QueryClientProvider>
      );

      expect(screen.getByText('common.loading')).toBeInTheDocument();
    });
  });

  describe('Error Handling', () => {
    it('shows error state when umbrellaStudyId is null', async () => {
      mockUmbrellaStudyId = null;
      
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      
      render(
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <PhiModeProvider>
              <StudyRegistration />
            </PhiModeProvider>
          </BrowserRouter>
        </QueryClientProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('common.error')).toBeInTheDocument();
      });
    });
  });

  describe('Redirect Logic', () => {
    it('redirects to member page when user is already enrolled with completed questionnaire', async () => {
      mockIsRIIMember = true;
      mockHasCompletedQuestionnaire = true;
      
      await renderStudyRegistration();

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/member');
      });
    });

    it('does not redirect when user is not a member', async () => {
      mockIsRIIMember = false;
      mockHasCompletedQuestionnaire = false;
      
      await renderStudyRegistration();

      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  describe('Consent Submission', () => {
    it('submits consent and moves to questionnaire phase', async () => {
      const user = userEvent.setup();
      
      mockRpc.mockImplementation((fn: string) => {
        if (fn === 'get_study_consent_requirements_localized') {
          return Promise.resolve({
            data: [
              {
                id: 'consent-1',
                consent_template_id: 'template-1',
                is_required: true,
                sort_order: 1,
                template_key: 'data_processing',
                title: 'Data Processing Consent',
                content: 'I agree.',
                version: '1.0',
                requires_signature: false,
              },
            ],
            error: null,
          });
        }
        if (fn === 'submit_study_consent_acceptance') {
          return Promise.resolve({ data: null, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      });

      await renderStudyRegistration();
      
      await waitFor(() => {
        expect(screen.getByText('Data Processing Consent')).toBeInTheDocument();
      });

      // Check consent
      const checkbox = screen.getByRole('checkbox');
      await user.click(checkbox);

      // Click continue
      const continueButton = screen.getByRole('button', { name: /study.registration.continueToQuestionnaire/i });
      await user.click(continueButton);

      // Verify RPC was called
      await waitFor(() => {
        expect(mockRpc).toHaveBeenCalledWith('submit_study_consent_acceptance', expect.objectContaining({
          p_study_id: 'umbrella-1',
          p_consent_template_id: 'template-1',
          p_granted: true,
        }));
      });
    });
  });
});
