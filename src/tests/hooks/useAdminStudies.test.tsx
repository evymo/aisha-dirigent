/**
 * Tests for useAdminStudies hook
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useAdminStudiesOverview,
  useStudyConsultantsAdmin,
  useStudyContributionsForStudyAdmin,
} from "@/hooks/useAdminStudies";

const hoisted = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  parseArrayResponseMock: vi.fn(),
  hasPermissionMock: vi.fn(),
}));

vi.mock("@/integrations/db/client", () => ({
  aisha: {
    rpc: hoisted.rpcMock,
  },
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasPermission: hoisted.hasPermissionMock,
  }),
}));

vi.mock("@/lib/schemas/adminSchemas", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/schemas/adminSchemas")>();
  return {
    ...original,
    parseArrayResponse: hoisted.parseArrayResponseMock,
  };
});

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe("useAdminStudies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.hasPermissionMock.mockReturnValue(true);
  });

  describe("useAdminStudiesOverview", () => {
    it("should fetch studies overview via RPC", async () => {
      const mockStudies = [
        {
          id: "study-1",
          name: "Test Study",
          type: "observational",
          status: "active",
          registration_count: 10,
          consultant_count: 2,
          total_funding: 1000,
          products: ["product1"],
          created_at: "2025-01-01T00:00:00Z",
          updated_at: "2025-01-01T00:00:00Z",
        },
      ];

      hoisted.rpcMock.mockResolvedValue({
        data: mockStudies,
        error: null,
      });
      hoisted.parseArrayResponseMock.mockReturnValue(mockStudies);

      const { result } = renderHook(() => useAdminStudiesOverview(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith("get_studies_overview_admin");
      expect(result.current.data).toHaveLength(1);
      expect(result.current.data?.[0].name).toBe("Test Study");
    });

    it("should handle RPC errors", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: { message: "Database error" },
      });

      const { result } = renderHook(() => useAdminStudiesOverview(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });
  });

  describe("useStudyConsultantsAdmin", () => {
    it("should fetch consultants for a study", async () => {
      const mockConsultants = [
        {
          id: "consultant-1",
          user_id: "user-1",
          study_id: "study-1",
          status: "approved",
          role: "lead",
          display_name: "Dr. Test",
          email: "dr.test@example.com",
          created_at: "2025-01-01T00:00:00Z",
        },
      ];

      hoisted.rpcMock.mockResolvedValue({
        data: mockConsultants,
        error: null,
      });
      hoisted.parseArrayResponseMock.mockReturnValue(mockConsultants);

      const { result } = renderHook(
        () => useStudyConsultantsAdmin("study-1"),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "get_study_consultants_for_study_admin",
        { p_study_id: "study-1" }
      );
    });

    it("should return empty array when studyId is null", async () => {
      const { result } = renderHook(() => useStudyConsultantsAdmin(null), {
        wrapper: createWrapper(),
      });

      // Query should be disabled, so it won't fetch
      expect(result.current.data).toBeUndefined();
      expect(hoisted.rpcMock).not.toHaveBeenCalled();
    });

    it("should not call RPC when user lacks admin permission", () => {
      hoisted.hasPermissionMock.mockReturnValue(false);

      const { result } = renderHook(
        () => useStudyConsultantsAdmin("study-1"),
        { wrapper: createWrapper() }
      );

      expect(result.current.data).toBeUndefined();
      expect(hoisted.rpcMock).not.toHaveBeenCalled();
    });
  });

  describe("useStudyContributionsForStudyAdmin", () => {
    it("should fetch contributions for a study", async () => {
      const mockContributions = [
        {
          id: "contrib-1",
          user_id: "user-1",
          study_id: "study-1",
          amount: 100,
          status: "completed",
          display_name: "Contributor",
          created_at: "2025-01-01T00:00:00Z",
        },
      ];

      hoisted.rpcMock.mockResolvedValue({
        data: mockContributions,
        error: null,
      });
      hoisted.parseArrayResponseMock.mockReturnValue(mockContributions);

      const { result } = renderHook(
        () => useStudyContributionsForStudyAdmin("study-1"),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "get_study_contributions_for_study_admin",
        { p_study_id: "study-1" }
      );
    });
  });
});
