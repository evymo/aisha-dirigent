import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import * as fs from "fs";
import * as path from "path";

// Mock modules before importing
vi.mock("@/integrations/db/client", () => ({
  aisha: {
    rpc: vi.fn(),
  },
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasPermission: vi.fn().mockReturnValue(true),
  }),
}));

const mockRegistration = {
  id: "test-registration-id",
  user_id: "test-user-id",
  study_id: "test-study-id",
  status: "screening" as const,
  created_at: "2025-01-01T00:00:00Z",
  group_assignment: null,
  enrolled_at: null,
  notes: null,
  baseline_data: null,
  study: {
    id: "test-study-id",
    name: "Test Study",
    code: "TST-001",
    study_type: "observational",
  },
  profile: {
    display_name: "Test User",
    email: "test@example.com",
    phone: null,
    date_of_birth: null,
    primary_diagnosis: null,
    current_medications: null,
    medical_history: null,
  },
};

vi.mock("@/hooks/useAdminData", () => ({
  useAllRegistrations: () => ({
    registrations: [mockRegistration],
  }),
}));

// Stable ref object for all renders
const stableIsMountedRef = { current: true };

vi.mock("@/hooks/useIsMountedRef", () => ({
  useIsMountedRef: () => stableIsMountedRef,
}));

// Import after mocks
import { useRegistrationDetail } from "@/hooks/useRegistrationDetail";
import { aisha } from "@/integrations/db/client";

describe("useRegistrationDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return registration from the list when found", async () => {
    vi.mocked(aisha.rpc).mockResolvedValue({
      data: [],
      error: null,
    } as never);

    const { result } = renderHook(() => useRegistrationDetail("test-registration-id"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.registration).not.toBeNull();
    expect(result.current.registration?.id).toBe("test-registration-id");
    expect(result.current.registration?.profile?.display_name).toBe("Test User");
  });

  it("should return null registration when not found", async () => {
    vi.mocked(aisha.rpc).mockResolvedValue({
      data: [],
      error: null,
    } as never);

    const { result } = renderHook(() => useRegistrationDetail("non-existent-id"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.registration).toBeNull();
  });

  it("should fetch questionnaire responses via RPC", async () => {
    const mockResponses = [
      {
        id: "resp-1",
        questionnaire_id: "quest-1",
        completed_at: "2025-01-01T12:00:00Z",
        responses: { question1: "answer1" },
      },
    ];

    vi.mocked(aisha.rpc).mockResolvedValue({
      data: mockResponses,
      error: null,
    } as never);

    const { result } = renderHook(() => useRegistrationDetail("test-registration-id"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(aisha.rpc).toHaveBeenCalledWith(
      "get_registration_questionnaire_responses",
      { p_registration_id: "test-registration-id" }
    );

    expect(result.current.questionnaireResponses).toHaveLength(1);
    expect(result.current.questionnaireResponses[0].id).toBe("resp-1");
  });

  it("should handle RPC errors safely", async () => {
    vi.mocked(aisha.rpc).mockResolvedValue({
      data: null,
      error: { message: "Database error" },
    } as never);

    const { result } = renderHook(() => useRegistrationDetail("test-registration-id"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBeDefined();
    expect(result.current.questionnaireResponses).toEqual([]);
  });

  it("should not fetch when registrationId is undefined", async () => {
    const { result } = renderHook(() => useRegistrationDetail(undefined));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(aisha.rpc).not.toHaveBeenCalled();
    expect(result.current.questionnaireResponses).toEqual([]);
  });

  it("should not fetch when user lacks admin permission", async () => {
    // Override usePermissions to return false for view_admin_dashboard
    const permissionsMod = await import("@/hooks/usePermissions");
    const spy = vi.spyOn(permissionsMod, "usePermissions").mockReturnValue({
      hasPermission: vi.fn().mockReturnValue(false),
    } as never);

    const { result } = renderHook(() => useRegistrationDetail("test-registration-id"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(aisha.rpc).not.toHaveBeenCalled();
    expect(result.current.questionnaireResponses).toEqual([]);

    spy.mockRestore();
  });
});

describe("get_registration_questionnaire_responses SQL authorization", () => {
  const SQL_FILE = path.resolve(
    __dirname,
    "../../../aisha/db/sql/functions/get_registration_questionnaire_responses.sql"
  );

  it("SQL source file exists", () => {
    expect(fs.existsSync(SQL_FILE)).toBe(true);
  });

  it("includes admin/staff authorization check", () => {
    const content = fs.readFileSync(SQL_FILE, "utf-8");
    expect(content).toContain("is_admin_or_staff");
  });

  it("has SECURITY DEFINER", () => {
    const content = fs.readFileSync(SQL_FILE, "utf-8");
    expect(content.toUpperCase()).toContain("SECURITY DEFINER");
  });

  it("has SET search_path", () => {
    const content = fs.readFileSync(SQL_FILE, "utf-8");
    expect(content).toContain("search_path");
  });

  it("includes audit journal logging", () => {
    const content = fs.readFileSync(SQL_FILE, "utf-8");
    expect(content).toContain("write_audit_journal");
  });

  it("grants only to authenticated (not anon)", () => {
    const content = fs.readFileSync(SQL_FILE, "utf-8");
    expect(content).toContain("GRANT EXECUTE");
    expect(content).toContain("TO authenticated");
    expect(content).not.toContain("TO anon");
  });
});
