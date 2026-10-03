import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHookWithProviders, waitFor } from "@/tests/utils/test-utils";
import { useApplyAsConsultant, useMyStudyConsultantApplication } from "@/hooks/useStudyFunding";

const hoisted = vi.hoisted(() => ({
  rpcMock: vi.fn(),
}));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (...args: unknown[]) => hoisted.rpcMock(...args),
  },
}));

const existingApplication = {
  id: "sc-1",
  study_id: "study-1",
  partner_id: "partner-1",
  role: "consultant",
  status: "pending",
  max_participants: null,
  notes: null,
  approved_at: null,
  created_at: new Date().toISOString(),
};

describe("useStudyFunding consultant application", () => {
  beforeEach(() => {
    hoisted.rpcMock.mockReset();
  });

  it("applies as consultant via RPC and returns the application", async () => {
    // Mock the apply_as_study_consultant_full RPC to return the existing application
    hoisted.rpcMock.mockResolvedValue({
      data: existingApplication,
      error: null,
    });

    const { result } = renderHookWithProviders(() => useApplyAsConsultant());

    const data = await result.current.mutateAsync({
      study_id: "study-1",
      partner_id: "partner-1",
      role: "consultant",
    });

    expect(data).toMatchObject({ id: "sc-1", status: "pending" });
    expect(hoisted.rpcMock).toHaveBeenCalledWith("apply_as_study_consultant_full", {
      p_study_id: "study-1",
      p_partner_id: "partner-1",
      p_role: "consultant",
      p_max_participants: undefined,
      p_notes: undefined,
    });
  });

  it("fetches my consultant application for a study", async () => {
    // Mock the get_my_study_consultant_application RPC
    hoisted.rpcMock.mockResolvedValue({
      data: existingApplication,
      error: null,
    });

    const { result } = renderHookWithProviders(() =>
      useMyStudyConsultantApplication("study-1", "partner-1")
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toMatchObject({ id: "sc-1", study_id: "study-1", partner_id: "partner-1" });
    expect(hoisted.rpcMock).toHaveBeenCalledWith("get_my_study_consultant_application", {
      p_study_id: "study-1",
      p_partner_id: "partner-1",
    });
  });
});
