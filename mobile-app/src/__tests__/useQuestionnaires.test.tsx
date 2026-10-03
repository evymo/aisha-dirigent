import { act, renderHook, waitFor } from "@testing-library/react-native";
import {
  useMyQuestionnaireResponses,
  useQuestionnaireBlocks,
  useQuestionnaires,
  useSubmitQuestionnaire,
} from "@/hooks/useQuestionnaires";
import { createQueryWrapper } from "@/__tests__/testUtils";

const mockRpc = jest.fn();
const mockEnqueueMutation = jest.fn();
const mockIsNetworkConnected = jest.fn();

jest.mock("@/config/api", () => ({
  api: {
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
  realtime: {
    channel: jest.fn(),
    removeChannel: jest.fn(),
  },
}));

jest.mock("@/lib/security/safeLogger", () => ({
  safeError: jest.fn(),
}));

jest.mock("@/services/offline", () => ({
  enqueueMutation: (...args: unknown[]) => mockEnqueueMutation(...args),
  isNetworkConnected: () => mockIsNetworkConnected(),
}));

describe("questionnaire hooks", () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockEnqueueMutation.mockReset();
    mockIsNetworkConnected.mockReset();
    mockIsNetworkConnected.mockResolvedValue(true);
  });

  it("loads questionnaire lists through RPC", async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          code: "q1",
          completed_at: null,
          id: "550e8400-e29b-41d4-a716-446655440000",
          status: "pending",
          title: "Questionnaire",
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useQuestionnaires("story-1"), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toHaveLength(1);
    expect(mockRpc).toHaveBeenCalledWith("get_dirigent_questionnaires_mobile", {
      p_story_id: "story-1",
    });
  });

  it("normalizes localized question blocks from the real RPC shape", async () => {
    // Real get_questionnaire_blocks_localized columns: question_type /
    // translated_text / is_required / config / option_translations. The old
    // test mocked block_type/label/options/required — a shape the RPC never
    // returns — so it passed while production parse failed and blanked the form.
    // Fixture is domain-neutral on purpose: it asserts the generic block →
    // type → options → label abstraction, not any specific questionnaire theme.
    mockRpc.mockResolvedValue({
      data: [
        {
          id: "550e8400-e29b-41d4-a716-446655440001",
          block_code: "question_1",
          question_type: "radio",
          translated_text: "Question text",
          translated_description: null,
          config: { options: [{ value: "option_a" }, { value: "option_b" }] },
          is_required: true,
          display_order: 0,
          step_number: 1,
          section_key: null,
          option_translations: { option_a: "Option A", option_b: "Option B" },
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useQuestionnaireBlocks("q1", "cs"), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockRpc).toHaveBeenCalledWith("get_questionnaire_blocks_localized", {
      p_questionnaire_code: "q1",
      p_locale: "cs",
    });
    expect(result.current.data).toEqual([
      {
        id: "550e8400-e29b-41d4-a716-446655440001",
        blockCode: "question_1",
        questionType: "radio",
        label: "Question text",
        description: "",
        required: true,
        stepNumber: 1,
        options: [
          { value: "option_a", label: "Option A" },
          { value: "option_b", label: "Option B" },
        ],
        config: { options: [{ value: "option_a" }, { value: "option_b" }] },
      },
    ]);
  });

  it("submits standalone questionnaire responses through the mutation hook", async () => {
    mockRpc.mockResolvedValue({ error: null });

    const { result } = renderHook(() => useSubmitQuestionnaire(), {
      wrapper: createQueryWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        questionnaireId: "550e8400-e29b-41d4-a716-446655440002",
        responses: { answer: "yes" },
      });
    });

    expect(mockRpc).toHaveBeenCalledWith("submit_questionnaire_response", {
      p_questionnaire_id: "550e8400-e29b-41d4-a716-446655440002",
      p_responses: { answer: "yes" },
      p_study_registration_id: undefined,
    });
  });

  it("threads study_registration_id so cluster submissions stay tied to the study", async () => {
    mockRpc.mockResolvedValue({ error: null });

    const { result } = renderHook(() => useSubmitQuestionnaire(), {
      wrapper: createQueryWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        questionnaireId: "550e8400-e29b-41d4-a716-446655440002",
        responses: { answer: "yes" },
        studyRegistrationId: "550e8400-e29b-41d4-a716-446655440099",
      });
    });

    expect(mockRpc).toHaveBeenCalledWith("submit_questionnaire_response", {
      p_questionnaire_id: "550e8400-e29b-41d4-a716-446655440002",
      p_responses: { answer: "yes" },
      p_study_registration_id: "550e8400-e29b-41d4-a716-446655440099",
    });
  });

  it("queues questionnaire submissions while offline instead of calling RPC", async () => {
    mockIsNetworkConnected.mockResolvedValue(false);

    const { result } = renderHook(() => useSubmitQuestionnaire(), {
      wrapper: createQueryWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        questionnaireId: "550e8400-e29b-41d4-a716-446655440002",
        responses: { answer: "yes" },
      });
    });

    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockEnqueueMutation).toHaveBeenCalledWith(
      expect.stringContaining("submit_questionnaire:550e8400-e29b-41d4-a716-446655440002:"),
      {
        questionnaireId: "550e8400-e29b-41d4-a716-446655440002",
        responses: { answer: "yes" },
        studyRegistrationId: undefined,
      },
      "submit_questionnaire",
    );
  });

  it("loads previous responses through RPC", async () => {
    mockRpc.mockResolvedValue({
      data: { answer: "yes" },
      error: null,
    });

    const { result } = renderHook(
      () =>
        useMyQuestionnaireResponses("550e8400-e29b-41d4-a716-446655440003"),
      {
        wrapper: createQueryWrapper(),
      },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual({ answer: "yes" });
  });
});
