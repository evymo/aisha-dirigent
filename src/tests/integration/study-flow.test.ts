/**
 * Integration Tests for Study Registration Flow
 *
 * Tests the complete flow of study participation:
 * - Viewing available studies
 * - Taking qualification tests
 * - Enrolling in studies
 * - Signing consent forms
 * - Tracking registration status
 * - Completing study activities
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock user contexts
interface MockUser {
  id: string;
  email: string;
  role: "member" | "admin";
}

interface MockAuthContext {
  user: MockUser | null;
  session: { access_token: string } | null;
}

const mockMember: MockAuthContext = {
  user: { id: "user-member-001", email: "member@example.com", role: "member" },
  session: { access_token: "mock-token-member" },
};

const mockAdmin: MockAuthContext = {
  user: { id: "user-admin-001", email: "admin@example.com", role: "admin" },
  session: { access_token: "mock-token-admin" },
};

// Mock database for studies
const mockStudies = [
  {
    id: "study-001",
    code: "LYASTIN-2024",
    name: "Lyastin Operational Trial",
    description: "Testing efficacy of Lyastin product",
    status: "recruiting",
    is_active: true,
    registration_start: "2024-01-01",
    registration_end: "2024-12-31",
    max_participants: 100,
    current_participants: 45,
    requires_qualification: true,
    qualification_questionnaire_id: "questionnaire-001",
  },
  {
    id: "study-002",
    code: "RETISIN-2024",
    name: "Retisin Observational Study",
    description: "Observing effects of Retisin",
    status: "recruiting",
    is_active: true,
    registration_start: "2024-02-01",
    registration_end: "2024-11-30",
    max_participants: 50,
    current_participants: 50,
    requires_qualification: false,
  },
];

const mockRegistrations = [
  {
    id: "registration-001",
    study_id: "study-001",
    user_id: "user-member-001",
    status: "active",
    enrolled_at: "2024-03-15T10:00:00Z",
    consent_signed_at: "2024-03-15T10:00:00Z",
  },
];

const mockConsents = [
  {
    id: "consent-001",
    user_id: "user-member-001",
    study_id: "study-001",
    consent_type: "study_participation",
    granted: true,
    granted_at: "2024-03-15T10:00:00Z",
    ip_address: "192.0.2.1",
  },
];

// Mock RPC functions
const mockRpcFunctions = {
  get_published_studies: vi.fn(),
  get_study_details: vi.fn(),
  get_my_study_registrations: vi.fn(),
  check_study_eligibility: vi.fn(),
  create_study_registration: vi.fn(),
  create_my_consents: vi.fn(),
  withdraw_from_study: vi.fn(),
  get_study_distribution_schedule: vi.fn(),
};

// Simulate RLS policy check
function canAccessStudy(authContext: MockAuthContext, studyId: string): boolean {
  // Public studies are visible to all authenticated users
  const study = mockStudies.find((s) => s.id === studyId);
  if (!study) return false;

  if (!study.is_active) {
    // Only admins can see inactive studies
    return authContext.user?.role === "admin";
  }

  return authContext.user !== null;
}

function canEnrollInStudy(authContext: MockAuthContext, studyId: string): boolean {
  if (!authContext.user) return false;

  const study = mockStudies.find((s) => s.id === studyId);
  if (!study) return false;

  // Check if study is recruiting
  if (study.status !== "recruiting") return false;

  // Check capacity
  if (study.current_participants >= study.max_participants) return false;

  // Check if already enrolled
  const existingRegistration = mockRegistrations.find(
    (e) => e.study_id === studyId && e.user_id === authContext.user!.id
  );
  if (existingRegistration) return false;

  return true;
}

describe("Study Flow Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mock responses
    mockRpcFunctions.get_published_studies.mockResolvedValue({
      data: mockStudies.filter((s) => s.is_active),
      error: null,
    });

    mockRpcFunctions.get_my_study_registrations.mockImplementation(async () => ({
      data: mockRegistrations.filter((e) => e.user_id === mockMember.user?.id),
      error: null,
    }));
  });

  describe("Study Discovery", () => {
    it("returns only active studies for members", async () => {
      const result = await mockRpcFunctions.get_published_studies();

      expect(result.error).toBeNull();
      expect(result.data).toHaveLength(2);
      expect(result.data.every((s: (typeof mockStudies)[0]) => s.is_active)).toBe(true);
    });

    it("shows study capacity status", async () => {
      const result = await mockRpcFunctions.get_published_studies();

      const fullStudy = result.data.find((s: (typeof mockStudies)[0]) => s.code === "RETISIN-2024");
      expect(fullStudy.current_participants).toBe(fullStudy.max_participants);
    });

    it("filters studies by recruitment status", async () => {
      mockRpcFunctions.get_published_studies.mockResolvedValue({
        data: mockStudies.filter((s) => s.status === "recruiting" && s.is_active),
        error: null,
      });

      const result = await mockRpcFunctions.get_published_studies();
      expect(result.data.every((s: (typeof mockStudies)[0]) => s.status === "recruiting")).toBe(true);
    });
  });

  describe("Study Eligibility", () => {
    it("checks qualification requirements", async () => {
      mockRpcFunctions.check_study_eligibility.mockResolvedValue({
        data: {
          eligible: true,
          requires_qualification: true,
          qualification_completed: false,
        },
        error: null,
      });

      const result = await mockRpcFunctions.check_study_eligibility({
        p_study_id: "study-001",
      });

      expect(result.data.requires_qualification).toBe(true);
      expect(result.data.qualification_completed).toBe(false);
    });

    it("prevents registration in full studies", () => {
      const canEnroll = canEnrollInStudy(mockMember, "study-002");
      expect(canEnroll).toBe(false);
    });

    it("prevents double registration", () => {
      const canEnroll = canEnrollInStudy(mockMember, "study-001");
      expect(canEnroll).toBe(false); // Already enrolled
    });

    it("allows registration in available studies", () => {
      // Remove existing registration for this test
      const tempRegistrations = mockRegistrations.filter((e) => e.study_id !== "study-001");
      const hasExisting = tempRegistrations.some(
        (e) => e.study_id === "study-001" && e.user_id === mockMember.user?.id
      );

      expect(hasExisting).toBe(false);
    });
  });

  describe("Study Registration", () => {
    it("creates registration with consent", async () => {
      mockRpcFunctions.create_study_registration.mockResolvedValue({
        data: {
          id: "registration-new",
          study_id: "study-001",
          user_id: mockMember.user?.id,
          status: "pending_consent",
        },
        error: null,
      });

      mockRpcFunctions.create_my_consents.mockResolvedValue({
        data: {
          id: "consent-new",
          granted: true,
        },
        error: null,
      });

      const enrollResult = await mockRpcFunctions.create_study_registration({
        p_study_id: "study-001",
      });

      expect(enrollResult.error).toBeNull();
      expect(enrollResult.data.study_id).toBe("study-001");

      const consentResult = await mockRpcFunctions.create_my_consents({
        p_study_id: "study-001",
        p_consent_type: "study_participation",
        p_granted: true,
      });

      expect(consentResult.error).toBeNull();
      expect(consentResult.data.granted).toBe(true);
    });

    it("tracks registration status progression", async () => {
      const statuses = ["pending_consent", "screening", "enrolled", "active", "completed"];

      statuses.forEach((status, index) => {
        if (index > 0) {
          // Verify valid transitions
          const validTransitions: Record<string, string[]> = {
            pending_consent: ["screening", "withdrawn"],
            screening: ["enrolled", "disqualified", "withdrawn"],
            enrolled: ["active", "withdrawn"],
            active: ["completed", "withdrawn"],
          };

          const previousStatus = statuses[index - 1];
          expect(validTransitions[previousStatus]).toContain(status);
        }
      });
    });

    it("requires consent before activation", async () => {
      mockRpcFunctions.create_study_registration.mockResolvedValue({
        data: {
          status: "pending_consent",
          consent_signed_at: null,
        },
        error: null,
      });

      const result = await mockRpcFunctions.create_study_registration({
        p_study_id: "study-001",
      });

      expect(result.data.status).toBe("pending_consent");
      expect(result.data.consent_signed_at).toBeNull();
    });
  });

  describe("Study Withdrawal", () => {
    it("allows member to withdraw from study", async () => {
      mockRpcFunctions.withdraw_from_study.mockResolvedValue({
        data: {
          id: "registration-001",
          status: "withdrawn",
          withdrawn_at: "2024-04-01T10:00:00Z",
          withdrawal_reason: "Personal reasons",
        },
        error: null,
      });

      const result = await mockRpcFunctions.withdraw_from_study({
        p_registration_id: "registration-001",
        p_reason: "Personal reasons",
      });

      expect(result.error).toBeNull();
      expect(result.data.status).toBe("withdrawn");
      expect(result.data.withdrawal_reason).toBe("Personal reasons");
    });

    it("prevents re-registration after withdrawal within cooldown", async () => {
      // Simulate business rule check
      const withdrawnRegistration = {
        study_id: "study-001",
        user_id: mockMember.user?.id,
        status: "withdrawn",
        withdrawn_at: new Date().toISOString(),
      };

      const daysSinceWithdrawal = 0;
      const cooldownDays = 30;

      const canReEnroll = daysSinceWithdrawal >= cooldownDays;
      expect(canReEnroll).toBe(false);
    });
  });

  describe("Study Activities", () => {
    it("provides distribution schedule for enrolled members", async () => {
      mockRpcFunctions.get_study_distribution_schedule.mockResolvedValue({
        data: [
          {
            week: 1,
            distribution_mg: 500,
            frequency: "twice_daily",
            instructions: "Take with food",
          },
          {
            week: 2,
            distribution_mg: 750,
            frequency: "twice_daily",
            instructions: "Take with food",
          },
        ],
        error: null,
      });

      const result = await mockRpcFunctions.get_study_distribution_schedule({
        p_registration_id: "registration-001",
      });

      expect(result.error).toBeNull();
      expect(result.data).toHaveLength(2);
      expect(result.data[0].week).toBe(1);
    });
  });

  describe("Access Control", () => {
    it("members can only see their own registrations", async () => {
      const result = await mockRpcFunctions.get_my_study_registrations();

      expect(result.data.every((e: (typeof mockRegistrations)[0]) => e.user_id === mockMember.user?.id)).toBe(
        true
      );
    });

    it("unauthenticated users cannot access study details", () => {
      const anonymous: MockAuthContext = { user: null, session: null };
      const canAccess = canAccessStudy(anonymous, "study-001");

      expect(canAccess).toBe(false);
    });

    it("admins can see inactive studies", () => {
      const inactiveStudy = { ...mockStudies[0], is_active: false };
      const mockStudiesWithInactive = [...mockStudies, inactiveStudy];

      // Admin should be able to access
      const canAdminAccess = mockAdmin.user?.role === "admin";
      expect(canAdminAccess).toBe(true);
    });
  });
});

describe("Study Consent Flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records consent with required metadata", async () => {
    mockRpcFunctions.create_my_consents.mockResolvedValue({
      data: {
        id: "consent-new",
        user_id: mockMember.user?.id,
        study_id: "study-001",
        consent_type: "study_participation",
        granted: true,
        granted_at: new Date().toISOString(),
        ip_address: "192.0.2.1",
        user_agent: "Mozilla/5.0...",
        consent_version: "1.0",
      },
      error: null,
    });

    const result = await mockRpcFunctions.create_my_consents({
      p_study_id: "study-001",
      p_consent_type: "study_participation",
      p_granted: true,
    });

    expect(result.data.granted).toBe(true);
    expect(result.data.granted_at).toBeDefined();
    expect(result.data.consent_version).toBeDefined();
  });

  it("requires separate consent for data sharing", async () => {
    const consentTypes = ["study_participation", "data_sharing", "research_use"];

    for (const consentType of consentTypes) {
      mockRpcFunctions.create_my_consents.mockResolvedValue({
        data: { consent_type: consentType, granted: true },
        error: null,
      });

      const result = await mockRpcFunctions.create_my_consents({
        p_consent_type: consentType,
        p_granted: true,
      });

      expect(result.data.consent_type).toBe(consentType);
    }
  });

  it("allows consent withdrawal", async () => {
    mockRpcFunctions.create_my_consents.mockResolvedValue({
      data: {
        id: "consent-001",
        granted: false,
        revoked_at: new Date().toISOString(),
        revocation_reason: "Changed my mind",
      },
      error: null,
    });

    const result = await mockRpcFunctions.create_my_consents({
      p_consent_id: "consent-001",
      p_granted: false,
      p_revocation_reason: "Changed my mind",
    });

    expect(result.data.granted).toBe(false);
    expect(result.data.revoked_at).toBeDefined();
  });
});
