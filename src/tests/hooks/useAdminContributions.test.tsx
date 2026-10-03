import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useStudyContributionsAdmin,
  useStudiesWithDynamicFunding,
  useUpdateStudyContributionStatus,
} from "@/hooks/useAdminContributions";

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
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe("useAdminContributions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.hasPermissionMock.mockReturnValue(true);
  });

  it("fetches admin contributions when user has admin permission", async () => {
    const contributions = [
      {
        id: "contrib-1",
        user_id: "user-1",
        study_id: "study-1",
        amount: 100,
        status: "pending",
      },
    ];

    hoisted.rpcMock.mockResolvedValue({ data: contributions, error: null });
    hoisted.parseArrayResponseMock.mockReturnValue(contributions);

    const { result } = renderHook(() => useStudyContributionsAdmin(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(hoisted.rpcMock).toHaveBeenCalledWith("get_study_contributions_admin");
    expect(result.current.data).toEqual(contributions);
  });

  it("does not call admin RPC query when user lacks admin permission", () => {
    hoisted.hasPermissionMock.mockReturnValue(false);

    const { result } = renderHook(() => useStudyContributionsAdmin(), {
      wrapper: createWrapper(),
    });

    expect(hoisted.rpcMock).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });

  it("calculates dynamic funding from completed contributions", async () => {
    const studies = [
      { id: "study-1", name: "Study 1", funding_goal: 1000 },
      { id: "study-2", name: "Study 2", funding_goal: 500 },
    ];
    const completedContributions = [
      { study_id: "study-1", amount: 100 },
      { study_id: "study-1", amount: 50 },
      { study_id: "study-2", amount: 10 },
    ];

    hoisted.rpcMock
      .mockResolvedValueOnce({ data: studies, error: null })
      .mockResolvedValueOnce({ data: completedContributions, error: null });
    hoisted.parseArrayResponseMock.mockImplementation((_schema: unknown, data: unknown) => data);

    const { result } = renderHook(() => useStudiesWithDynamicFunding(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(hoisted.rpcMock).toHaveBeenCalledWith("get_studies_funding_goals_admin");
    expect(hoisted.rpcMock).toHaveBeenCalledWith("get_completed_study_contributions_admin");
    expect(result.current.data).toEqual([
      { id: "study-1", name: "Study 1", funding_goal: 1000, dynamic_funding: 150 },
      { id: "study-2", name: "Study 2", funding_goal: 500, dynamic_funding: 10 },
    ]);
  });

  it("blocks admin mutation when user lacks admin permission", async () => {
    hoisted.hasPermissionMock.mockReturnValue(false);
    const { result } = renderHook(() => useUpdateStudyContributionStatus(), {
      wrapper: createWrapper(),
    });

    await expect(
      result.current.mutateAsync({
        id: "contrib-1",
        status: "completed",
      })
    ).rejects.toThrow(/Admin permission required/i);

    expect(hoisted.rpcMock).not.toHaveBeenCalled();
  });
});
