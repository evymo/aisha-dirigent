import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useHasInformedConsent } from '@/hooks/useInformedConsent';

interface MockConsent {
  id: string;
  user_id: string;
  study_id: string | null;
  consent_type: string;
  granted: boolean;
  granted_at: string;
}

const mockConsents: MockConsent[] = [
  {
    id: 'consent-001',
    user_id: 'test-user',
    study_id: null,
    consent_type: 'data_processing',
    granted: true,
    granted_at: '2024-03-15T08:00:00Z',
  },
];

let mockConsentsReturn = {
  consents: mockConsents,
  loading: false,
  hasConsent: vi.fn(),
  grantConsent: vi.fn(),
  refetch: vi.fn(),
};

let mockRIIReturn: {
  umbrellaStudyId: string | null;
  isLoading: boolean;
  umbrellaStudy: unknown;
  registration: unknown;
  isRIIMember: boolean;
  isPendingRII: boolean;
} = {
  umbrellaStudyId: null,
  isLoading: false,
  umbrellaStudy: null,
  registration: null,
  isRIIMember: false,
  isPendingRII: false,
};

vi.mock('@/hooks/useStudies', () => ({
  useConsents: vi.fn(() => mockConsentsReturn),
}));

vi.mock('@/hooks/useRIIMembership', () => ({
  useRIIMembership: vi.fn(() => mockRIIReturn),
}));

describe('useHasInformedConsent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConsentsReturn = {
      consents: mockConsents,
      loading: false,
      hasConsent: vi.fn(),
      grantConsent: vi.fn(),
      refetch: vi.fn(),
    };
    mockRIIReturn = {
      umbrellaStudyId: null,
      isLoading: false,
      umbrellaStudy: null,
      registration: null,
      isRIIMember: false,
      isPendingRII: false,
    };
  });

  it('should expose data processing consent separately', () => {
    mockConsentsReturn.hasConsent = vi.fn((type) => type === 'data_processing');

    const { result } = renderHook(() => useHasInformedConsent());

    expect(result.current.hasDataProcessingConsent).toBe(true);
    expect(result.current.hasStudyConsent).toBe(false);
    expect(result.current.hasInformedConsent).toBe(false);
  });

  it('should return true when user has per-study informed consent', () => {
    mockConsentsReturn.hasConsent = vi.fn((type) => type === 'informed_consent');
    mockRIIReturn.umbrellaStudyId = 'umbrella-study-001';

    const { result } = renderHook(() => useHasInformedConsent());

    expect(result.current.hasStudyConsent).toBe(true);
    expect(result.current.hasInformedConsent).toBe(true);
  });

  it('should return false when user has no consents', () => {
    mockConsentsReturn.hasConsent = vi.fn(() => false);
    mockConsentsReturn.consents = [];

    const { result } = renderHook(() => useHasInformedConsent());

    expect(result.current.hasDataProcessingConsent).toBe(false);
    expect(result.current.hasStudyConsent).toBe(false);
    expect(result.current.hasInformedConsent).toBe(false);
  });

  it('should return true with any observation consent when no umbrella study', () => {
    mockConsentsReturn.hasConsent = vi.fn(() => false);
    mockConsentsReturn.consents = [
      {
        id: 'consent-002',
        user_id: 'test-user',
        study_id: 'some-study' as string | null,
        consent_type: 'observation',
        granted: true,
        granted_at: '2024-03-15T08:00:00Z',
      },
    ] as MockConsent[];

    const { result } = renderHook(() => useHasInformedConsent());

    expect(result.current.hasStudyConsent).toBe(true);
    expect(result.current.hasInformedConsent).toBe(true);
  });

  it('should combine loading states', () => {
    mockConsentsReturn.loading = true;
    mockRIIReturn.isLoading = false;

    const { result } = renderHook(() => useHasInformedConsent());

    expect(result.current.loading).toBe(true);
  });

  it('should expose grantConsent and refetch functions', () => {
    const { result } = renderHook(() => useHasInformedConsent());

    expect(result.current.grantConsent).toBeDefined();
    expect(result.current.refetch).toBeDefined();
    expect(result.current.consents).toBeDefined();
  });
});
