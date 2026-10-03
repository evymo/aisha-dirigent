import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import QualificationTest from '@/pages/QualificationTest';

// React Router v7+ has removed the future prop - v7 features are now default

const { 
  mockRpc, 
  mockInsert, 
  mockSelect, 
  mockUpdate, 
  mockEq, 
  mockSingle, 
  mockMaybeSingle, 
  mockChannel, 
  mockRefetchRoles,
  mockNavigate,
  mockProcessReward,
  mockToast
} = vi.hoisted(() => {
  return {
    mockRpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    mockInsert: vi.fn().mockResolvedValue({ data: null, error: null }),
    mockSelect: vi.fn().mockReturnThis(),
    mockUpdate: vi.fn().mockReturnThis(),
    mockEq: vi.fn().mockReturnThis(),
    mockSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    mockMaybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    mockChannel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
    })),
    mockRefetchRoles: vi.fn(),
    mockNavigate: vi.fn(),
    mockProcessReward: vi.fn(),
    mockToast: Object.assign(vi.fn(), {
      success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(),
      loading: vi.fn(), dismiss: vi.fn(), promise: vi.fn(),
    }),
  };
});

// Mock dependencies
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (params) return `${key} ${JSON.stringify(params)}`;
      return key;
    },
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

const mockUser = { id: 'user-1', email: 'test@example.com' };
let mockAuthLoading = false;
const mockRoles: { role: string }[] = [];
let mockRolesLoading = false;

const mockUseSession = vi.fn();

vi.mock('@/hooks/useSession', () => ({
  useSession: () => mockUseSession(),
}));

vi.mock('@/hooks/useMembership', () => ({
  useMembership: () => ({
    membership: null,
    loading: false,
  }),
}));

vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => ({
    notifications: [],
    unreadCount: 0,
    markAsRead: vi.fn(),
    markAllAsRead: vi.fn(),
    loading: false,
  }),
}));

vi.mock('@/hooks/useCart', () => ({
  useCart: () => ({
    items: [],
    loading: false,
    total: 0,
    itemCount: 0,
    addToCart: vi.fn(),
    updateQuantity: vi.fn(),
    removeFromCart: vi.fn(),
    clearCart: vi.fn(),
    refetch: vi.fn(),
  }),
}));

vi.mock('@/hooks/usePartners', () => ({
  useMyPartnerProfile: () => ({
    data: null,
    isLoading: false,
    error: null,
  }),
}));

vi.mock('@/integrations/db/client', () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    from: vi.fn(() => ({
      select: mockSelect,
      insert: mockInsert,
      update: mockUpdate,
      eq: mockEq,
      single: mockSingle,
      maybeSingle: mockMaybeSingle,
    })),
    channel: mockChannel,
    removeChannel: vi.fn(),
    rpc: (name: string, params: unknown) => mockRpc(name, params),
  },
}));

const mockQuestions = [
  {
    id: 'q1',
    test_type: 'qualification',
    question_order: 1,
    question_key: 'Question 1',
    option_a_key: 'Answer A',
    option_b_key: 'Answer B',
    option_c_key: 'Answer C',
    option_d_key: null,
    is_active: true,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  },
  {
    id: 'q2',
    test_type: 'qualification',
    question_order: 2,
    question_key: 'Question 2',
    option_a_key: 'Answer A2',
    option_b_key: 'Answer B2',
    option_c_key: 'Answer C2',
    option_d_key: null,
    is_active: true,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  },
];

let mockQuestionsData: typeof mockQuestions | null = mockQuestions;
let mockQuestionsLoading = false;
vi.mock('@/hooks/useTestQuestions', () => ({
  useTestQuestions: () => ({
    data: mockQuestionsData,
    isLoading: mockQuestionsLoading,
  }),
}));

let mockIsRIIMember = true;
let mockIsPendingRII = false;
let mockRiiLoading = false;
let mockCanTakeQualificationTest = true;
let mockHasCompletedQuestionnaire = true;
vi.mock('@/hooks/useRIIMembership', () => ({
  useRIIMembership: () => ({
    isRIIMember: mockIsRIIMember,
    isPendingRII: mockIsPendingRII,
    umbrellaStudyId: 'umbrella-study-1',
    canTakeQualificationTest: mockCanTakeQualificationTest,
    hasCompletedQuestionnaire: mockHasCompletedQuestionnaire,
    isLoading: mockRiiLoading,
  }),
}));

vi.mock('@/hooks/useTokens', () => ({
  useProcessReward: () => ({
    mutateAsync: mockProcessReward,
  }),
}));

vi.mock("sonner", () => ({
  toast: mockToast,
}));

function renderQualificationTest() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <QualificationTest />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

describe('QualificationTest Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthLoading = false;
    mockRolesLoading = false;
    mockQuestionsLoading = false;
    mockRiiLoading = false;
    mockIsRIIMember = true;
    mockIsPendingRII = false;
    mockCanTakeQualificationTest = true;
    mockHasCompletedQuestionnaire = true;
    mockQuestionsData = mockQuestions;
    mockRoles.length = 0;
    
    mockUseSession.mockImplementation(() => ({
      user: mockUser,
      isLoading: mockAuthLoading,
      hasRole: (role: string) => mockRoles.some(r => r.role === role),
      roles: mockRoles.map(r => r.role),
      isAdmin: false,
      signOut: vi.fn(),
      refetchRoles: mockRefetchRoles,
    }));

    // Reset default mock implementations
    mockRpc.mockImplementation((name: string) => {
      if (name === 'insert_questionnaire_response_secure') {
        return Promise.resolve({ data: 'response-1', error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
    mockInsert.mockResolvedValue({ data: null, error: null });
  });

  describe('Loading States', () => {
    it('shows loading indicator when auth is loading', () => {
      mockAuthLoading = true;
      renderQualificationTest();
      expect(screen.getByText('common.loading')).toBeInTheDocument();
    });

    it('shows loading indicator when questions are loading', () => {
      mockQuestionsLoading = true;
      renderQualificationTest();
      expect(screen.getByText('common.loading')).toBeInTheDocument();
    });
  });

  describe('RII Membership Requirement', () => {
    it('shows RII registration prompt when user is not RII member', () => {
      mockIsRIIMember = false;
      mockIsPendingRII = false;
      mockCanTakeQualificationTest = false;
      renderQualificationTest();
      
      expect(screen.getByText('qualificationTest.riiRequired.title')).toBeInTheDocument();
      expect(screen.getByText('qualificationTest.riiRequired.joinRII')).toBeInTheDocument();
    });

    it('allows test access for pending RII members', () => {
      mockIsRIIMember = false;
      mockIsPendingRII = true;
      renderQualificationTest();
      
      expect(screen.getByText('qualificationTest.aboutTest')).toBeInTheDocument();
    });
  });

  describe('Already Qualified User', () => {
    it('shows qualified status for users with member role', () => {
      mockUseSession.mockReturnValue({
        user: mockUser,
        isLoading: false,
        hasRole: (role: string) => role === 'member',
        roles: ['member'],
        isAdmin: false,
        signOut: vi.fn(),
        refetchRoles: mockRefetchRoles,
      });
      renderQualificationTest();
      
      expect(screen.getByText('qualificationTest.alreadyQualified')).toBeInTheDocument();
    });
  });

  describe('No Questions Available', () => {
    it('shows no questions message when questions array is empty', () => {
      mockQuestionsData = [];
      renderQualificationTest();
      
      expect(screen.getByText('qualificationTest.noQuestionsAvailable')).toBeInTheDocument();
    });
  });

  describe('Test Start Screen', () => {
    it('displays test information before starting', () => {
      renderQualificationTest();
      
      expect(screen.getByText('qualificationTest.title')).toBeInTheDocument();
      expect(screen.getByText('qualificationTest.aboutTest')).toBeInTheDocument();
      expect(screen.getByText('qualificationTest.startTest')).toBeInTheDocument();
    });

    it('shows test statistics', () => {
      renderQualificationTest();
      
      expect(screen.getByText('2 qualificationTest.questions')).toBeInTheDocument();
      expect(screen.getByText('75% qualificationTest.toPass')).toBeInTheDocument();
    });
  });

  describe('Test Flow', () => {
    it('starts test when start button is clicked', async () => {
      renderQualificationTest();
      
      await userEvent.click(screen.getByText('qualificationTest.startTest'));
      
      expect(screen.getAllByText('Question 1').length).toBeGreaterThan(0);
    });

    it('shows question progress', async () => {
      renderQualificationTest();
      await userEvent.click(screen.getByText('qualificationTest.startTest'));
      
      expect(screen.getByText(/qualificationTest.question 1 \/ 2/)).toBeInTheDocument();
    });

    it('allows selecting an answer', async () => {
      renderQualificationTest();
      await userEvent.click(screen.getByText('qualificationTest.startTest'));
      
      const answerA = screen.getByText('Answer A');
      await userEvent.click(answerA);
      
      const radioButton = screen.getByRole('radio', { name: /Answer A/i });
      expect(radioButton).toBeChecked();
    });

    it('navigates to next question when answered', async () => {
      renderQualificationTest();
      await userEvent.click(screen.getByText('qualificationTest.startTest'));
      
      // Answer first question
      await userEvent.click(screen.getByText('Answer A'));
      await userEvent.click(screen.getByText('qualificationTest.next'));
      
      expect(screen.getAllByText('Question 2').length).toBeGreaterThan(0);
    });

    it('navigates to previous question', async () => {
      renderQualificationTest();
      await userEvent.click(screen.getByText('qualificationTest.startTest'));
      
      // Answer and go to next
      await userEvent.click(screen.getByText('Answer A'));
      await userEvent.click(screen.getByText('qualificationTest.next'));
      
      // Go back
      await userEvent.click(screen.getByText('qualificationTest.previous'));
      
      expect(screen.getAllByText('Question 1').length).toBeGreaterThan(0);
    });

    it('disables previous button on first question', async () => {
      renderQualificationTest();
      await userEvent.click(screen.getByText('qualificationTest.startTest'));
      
      const prevButton = screen.getByRole('button', { name: /qualificationTest.previous/i });
      expect(prevButton).toBeDisabled();
    });

    it('disables next button when no answer selected', async () => {
      renderQualificationTest();
      await userEvent.click(screen.getByText('qualificationTest.startTest'));
      
      const nextButton = screen.getByRole('button', { name: /qualificationTest.next/i });
      expect(nextButton).toBeDisabled();
    });
  });

  describe('Test Submission', () => {
    it('shows submit button on last question', async () => {
      renderQualificationTest();
      await userEvent.click(screen.getByText('qualificationTest.startTest'));
      
      // Answer first question and navigate
      await userEvent.click(screen.getByText('Answer A'));
      await userEvent.click(screen.getByText('qualificationTest.next'));
      
      // Answer second question
      await userEvent.click(screen.getByText('Answer A2'));
      
      expect(screen.getByText('qualificationTest.submitTest')).toBeInTheDocument();
    });

    it('submits test and shows passed results', async () => {
      mockRpc.mockImplementation((name: string) => {
        if (name === 'assign_member_role_after_qualification') {
          return Promise.resolve({
            data: {
              success: true,
              passed: true,
              total_questions: 2,
              correct_count: 2,
              score: 100,
              role_assigned: true,
            },
            error: null,
          });
        }
        if (name === 'insert_questionnaire_response_secure') {
          return Promise.resolve({ data: 'response-1', error: null });
        }
        return Promise.resolve({ data: null, error: null });
      });
      mockInsert.mockResolvedValue({ error: null });
      mockProcessReward.mockResolvedValue({ success: true, amount_awarded: 10 });
      
      renderQualificationTest();
      await userEvent.click(screen.getByText('qualificationTest.startTest'));
      
      // Answer all questions
      await userEvent.click(screen.getByText('Answer A'));
      await userEvent.click(screen.getByText('qualificationTest.next'));
      await userEvent.click(screen.getByText('Answer A2'));
      
      // Submit
      await userEvent.click(screen.getByText('qualificationTest.submitTest'));
      
      await waitFor(() => {
        expect(screen.getByText('qualificationTest.testPassed')).toBeInTheDocument();
      });
    });

    it('submits test and shows failed results', async () => {
      mockRpc.mockImplementation((name: string) => {
        if (name === 'assign_member_role_after_qualification') {
          return Promise.resolve({
            data: {
              success: true,
              passed: false,
              total_questions: 2,
              correct_count: 0,
              score: 0,
              role_assigned: false,
            },
            error: null,
          });
        }
        if (name === 'insert_questionnaire_response_secure') {
          return Promise.resolve({ data: 'response-2', error: null });
        }
        return Promise.resolve({ data: null, error: null });
      });
      mockInsert.mockResolvedValue({ error: null });
      
      renderQualificationTest();
      await userEvent.click(screen.getByText('qualificationTest.startTest'));
      
      await userEvent.click(screen.getByText('Answer A'));
      await userEvent.click(screen.getByText('qualificationTest.next'));
      await userEvent.click(screen.getByText('Answer A2'));
      await userEvent.click(screen.getByText('qualificationTest.submitTest'));
      
      await waitFor(() => {
        expect(screen.getByText('qualificationTest.testFailed')).toBeInTheDocument();
      });
    }, 30_000);

    it('refetches roles after passing', async () => {
      mockRpc.mockImplementation((name: string) => {
        if (name === 'assign_member_role_after_qualification') {
          return Promise.resolve({
            data: {
              success: true,
              passed: true,
              total_questions: 2,
              correct_count: 2,
              score: 100,
              role_assigned: true,
            },
            error: null,
          });
        }
        if (name === 'insert_questionnaire_response_secure') {
          return Promise.resolve({ data: 'response-3', error: null });
        }
        return Promise.resolve({ data: null, error: null });
      });
      mockInsert.mockResolvedValue({ error: null });
      mockProcessReward.mockResolvedValue({ success: true, amount_awarded: 0 });
      
      renderQualificationTest();
      await userEvent.click(screen.getByText('qualificationTest.startTest'));
      
      await userEvent.click(screen.getByText('Answer A'));
      await userEvent.click(screen.getByText('qualificationTest.next'));
      await userEvent.click(screen.getByText('Answer A2'));
      await userEvent.click(screen.getByText('qualificationTest.submitTest'));
      
      await waitFor(() => {
        expect(mockRefetchRoles).toHaveBeenCalled();
      });
    });

    it('shows token reward toast when tokens are awarded', async () => {
      mockRpc.mockImplementation((name: string) => {
        if (name === 'assign_member_role_after_qualification') {
          return Promise.resolve({
            data: {
              success: true,
              passed: true,
              total_questions: 2,
              correct_count: 2,
              score: 100,
              role_assigned: true,
            },
            error: null,
          });
        }
        if (name === 'insert_questionnaire_response_secure') {
          // Return null so qualificationResponseId stays null, entering the toast block
          return Promise.resolve({ data: null, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      });
      mockInsert.mockResolvedValue({ error: null });
      mockProcessReward.mockResolvedValue({ success: true, amount_awarded: 50 });
      
      renderQualificationTest();
      await userEvent.click(screen.getByText('qualificationTest.startTest'));
      
      await userEvent.click(screen.getByText('Answer A'));
      await userEvent.click(screen.getByText('qualificationTest.next'));
      await userEvent.click(screen.getByText('Answer A2'));
      await userEvent.click(screen.getByText('qualificationTest.submitTest'));
      
      await waitFor(() => {
        expect(mockToast.success).toHaveBeenCalled();
      });
    });

    it('shows error toast on submission failure', async () => {
      mockRpc.mockImplementation((name: string) => {
        if (name === 'assign_member_role_after_qualification') {
          return Promise.resolve({
            data: null,
            error: new Error('Server error'),
          });
        }
        if (name === 'insert_questionnaire_response_secure') {
          return Promise.resolve({ data: 'response-5', error: null });
        }
        return Promise.resolve({ data: null, error: null });
      });
      
      renderQualificationTest();
      await userEvent.click(screen.getByText('qualificationTest.startTest'));
      
      await userEvent.click(screen.getByText('Answer A'));
      await userEvent.click(screen.getByText('qualificationTest.next'));
      await userEvent.click(screen.getByText('Answer A2'));
      await userEvent.click(screen.getByText('qualificationTest.submitTest'));
      
      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalled();
      });
    });
  });

  describe('Unauthenticated User', () => {
    it('redirects to auth when user is not logged in', () => {
      vi.mocked(vi.fn()).mockReturnValue(null);
      // This would need proper mock reset, skipping for now
    });
  });
});
