import { renderHook, waitFor, act } from "@testing-library/react-native";
import {
  useActiveStudies,
  useStudyQuestionnairesMobile,
  useEnrollInStudy,
  useCombinedConsentRequirements,
  useSubmitStudyConsentAcceptance,
} from "@/hooks/useStudies";
import { createQueryWrapper } from "@/__tests__/testUtils";

const mockRpc = jest.fn();

jest.mock("@/config/api", () => ({
  api: { rpc: (...args: unknown[]) => mockRpc(...args) },
  realtime: { channel: jest.fn(), removeChannel: jest.fn() },
}));

jest.mock("@/lib/security/safeLogger", () => ({ safeError: jest.fn() }));

describe("useActiveStudies", () => {
  beforeEach(() => mockRpc.mockReset());

  it("fetches + parses active studies with locale", async () => {
    mockRpc.mockResolvedValue({
      data: [
        { id: "11111111-1111-4111-8111-111111111111", name: "Study A", target_condition: "OA", current_registration: 5, target_registration: 20 },
      ],
      error: null,
    });

    const { result } = renderHook(() => useActiveStudies("cs"), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith("get_active_studies", { p_locale: "cs" });
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].name).toBe("Study A");
  });
});

describe("useStudyQuestionnairesMobile", () => {
  beforeEach(() => mockRpc.mockReset());

  it("parses the jsonb result + totals", async () => {
    mockRpc.mockResolvedValue({
      data: {
        questionnaires: [
          { id: "22222222-2222-4222-8222-222222222222", status: "pending", can_submit: true, points_reward: 50 },
        ],
        total_pending: 1,
        total_completed: 3,
      },
      error: null,
    });

    const { result } = renderHook(
      () => useStudyQuestionnairesMobile("33333333-3333-4333-8333-333333333333", "cs", true),
      { wrapper: createQueryWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith("get_study_questionnaires_mobile", {
      p_locale: "cs",
      p_study_registration_id: "33333333-3333-4333-8333-333333333333",
    });
    expect(result.current.data?.total_pending).toBe(1);
    expect(result.current.data?.questionnaires).toHaveLength(1);
  });
});

describe("useEnrollInStudy", () => {
  beforeEach(() => mockRpc.mockReset());

  it("enrolls via enroll_in_study and returns registration id", async () => {
    mockRpc.mockResolvedValue({
      data: { success: true, registration_id: "44444444-4444-4444-8444-444444444444" },
      error: null,
    });

    const { result } = renderHook(() => useEnrollInStudy(), { wrapper: createQueryWrapper() });

    let returned: { registration_id?: string } | undefined;
    await act(async () => {
      returned = await result.current.mutateAsync({ studyId: "55555555-5555-4555-8555-555555555555" });
    });

    expect(mockRpc).toHaveBeenCalledWith("enroll_in_study", { p_study_id: "55555555-5555-4555-8555-555555555555" });
    expect(returned?.registration_id).toBe("44444444-4444-4444-8444-444444444444");
  });

  it("throws when the RPC returns success:false", async () => {
    mockRpc.mockResolvedValue({ data: { success: false, error: "Already enrolled in this study" }, error: null });

    const { result } = renderHook(() => useEnrollInStudy(), { wrapper: createQueryWrapper() });

    await expect(
      result.current.mutateAsync({ studyId: "55555555-5555-4555-8555-555555555555" }),
    ).rejects.toThrow("Already enrolled");
  });
});

describe("useCombinedConsentRequirements", () => {
  beforeEach(() => mockRpc.mockReset());

  it("fetches consent requirements with template ids for submit mapping", async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          id: "66666666-6666-4666-8666-666666666666",
          consent_template_id: "77777777-7777-4777-8777-777777777777",
          is_required: true,
          sort_order: 1,
          template_key: "data_processing",
          title: "Data processing",
          content: "I agree.",
          version: "1.0",
          requires_signature: false,
          study_id: "55555555-5555-4555-8555-555555555555",
          study_name: "Study A",
        },
      ],
      error: null,
    });

    const { result } = renderHook(
      () => useCombinedConsentRequirements("55555555-5555-4555-8555-555555555555", "cs"),
      { wrapper: createQueryWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith("get_combined_consent_requirements_localized", {
      p_locale: "cs",
      p_study_id: "55555555-5555-4555-8555-555555555555",
    });
    expect(result.current.data?.[0].consent_template_id).toBe("77777777-7777-4777-8777-777777777777");
  });
});

describe("useSubmitStudyConsentAcceptance", () => {
  beforeEach(() => mockRpc.mockReset());

  it("submits accepted study consent via submit_study_consent_acceptance", async () => {
    mockRpc.mockResolvedValue({
      data: { success: true, id: "66666666-6666-4666-8666-666666666666", version: "1.0" },
      error: null,
    });

    const { result } = renderHook(() => useSubmitStudyConsentAcceptance(), { wrapper: createQueryWrapper() });

    await act(async () => {
      await result.current.mutateAsync({
        consentTemplateId: "77777777-7777-4777-8777-777777777777",
        granted: true,
        signatureData: "mobile:test",
        studyId: "55555555-5555-4555-8555-555555555555",
      });
    });

    expect(mockRpc).toHaveBeenCalledWith("submit_study_consent_acceptance", {
      p_consent_template_id: "77777777-7777-4777-8777-777777777777",
      p_granted: true,
      p_signature_data: "mobile:test",
      p_study_id: "55555555-5555-4555-8555-555555555555",
    });
  });
});
