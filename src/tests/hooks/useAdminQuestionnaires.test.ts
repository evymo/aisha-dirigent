import { act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  QUESTIONNAIRE_TYPES,
  questionnaireExtendedSchema,
  useCreateQuestionBlockMutation,
  useCreateQuestionnaireMutation,
  useDeleteQuestionBlockMutation,
  useDeleteQuestionnaireMutation,
  useQuestionBlocksAdmin,
  useQuestionnaireTranslations,
  useQuestionnairesAdminFull,
  useUpdateQuestionBlockMutation,
  useUpdateQuestionnaireMutation,
} from "@/hooks/useAdminQuestionnaires";
import { renderHookWithProviders } from "@/tests/utils/test-utils";

const rpcMock = vi.hoisted(() => vi.fn());
const safeErrorMock = vi.hoisted(() => vi.fn());
const hasPermissionMock = vi.hoisted(() => vi.fn(() => true));
const guardAdminMutationMock = vi.hoisted(() => vi.fn((_permission: string, fn: (input: unknown) => unknown) => fn));

vi.mock("@/integrations/db/client", () => ({
  aisha: {
    rpc: rpcMock,
  },
}));

vi.mock("@/lib/security/safeLogger", () => ({
  safeError: safeErrorMock,
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasPermission: hasPermissionMock,
  }),
}));

vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({
    user: { id: "admin-user" },
  }),
}));

vi.mock("@/hooks/useAdminGuard", () => ({
  useAdminGuard: () => ({
    guardAdminMutation: guardAdminMutationMock,
  }),
}));

const QUESTIONNAIRE_ID = "11111111-1111-4111-8111-111111111111";
const BLOCK_ID = "22222222-2222-4222-8222-222222222222";

const questionnaireRow = {
  id: QUESTIONNAIRE_ID,
  base_locale: "en",
  code: "BASELINE",
  created_at: "2026-04-01T00:00:00.000Z",
  description_key: "questionnaires.baseline.description",
  is_active: true,
  name: "Baseline",
  name_key: "questionnaires.baseline.name",
  points_reward: 10,
  questionnaire_type: "assessment",
  questions: [],
  question_count: 0,
  token_reward: 5,
  updated_at: "2026-04-02T00:00:00.000Z",
  version: 1,
};

const questionBlockRow = {
  id: BLOCK_ID,
  base_locale: "en",
  code: "pain_scale",
  config: { min: 0, max: 10 },
  created_at: "2026-04-01T00:00:00.000Z",
  description_key: "blocks.pain.description",
  is_active: true,
  is_required_default: false,
  question_type: "scale",
  sort_order: 1,
  text_key: "blocks.pain.text",
  updated_at: "2026-04-02T00:00:00.000Z",
};

describe("useAdminQuestionnaires contract", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    safeErrorMock.mockReset();
    hasPermissionMock.mockReturnValue(true);
    guardAdminMutationMock.mockClear();
  });

  it("keeps questionnaire type constants and schema aligned", () => {
    expect(QUESTIONNAIRE_TYPES).toContain("assessment");
    expect(questionnaireExtendedSchema.parse(questionnaireRow)).toEqual(questionnaireRow);
    expect(() =>
      questionnaireExtendedSchema.parse({
        ...questionnaireRow,
        id: "not-a-uuid",
      }),
    ).toThrow();
  });

  it("fetches admin questionnaires and question blocks through RPC", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: [questionnaireRow], error: null })
      .mockResolvedValueOnce({ data: [questionBlockRow], error: null });

    const questionnaires = renderHookWithProviders(() => useQuestionnairesAdminFull());
    await waitFor(() => expect(questionnaires.result.current.isSuccess).toBe(true));
    expect(questionnaires.result.current.data).toEqual([questionnaireRow]);

    const blocks = renderHookWithProviders(() => useQuestionBlocksAdmin());
    await waitFor(() => expect(blocks.result.current.isSuccess).toBe(true));
    expect(blocks.result.current.data).toEqual([questionBlockRow]);

    expect(rpcMock).toHaveBeenNthCalledWith(1, "get_questionnaires_admin");
    expect(rpcMock).toHaveBeenNthCalledWith(2, "get_question_blocks_admin");
  });

  it("returns empty arrays when RPC payloads fail schema validation", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: [{ ...questionnaireRow, id: "bad" }], error: null })
      .mockResolvedValueOnce({ data: [{ ...questionBlockRow, is_active: "yes" }], error: null });

    const questionnaires = renderHookWithProviders(() => useQuestionnairesAdminFull());
    await waitFor(() => expect(questionnaires.result.current.isSuccess).toBe(true));
    expect(questionnaires.result.current.data).toEqual([]);

    const blocks = renderHookWithProviders(() => useQuestionBlocksAdmin());
    await waitFor(() => expect(blocks.result.current.isSuccess).toBe(true));
    expect(blocks.result.current.data).toEqual([]);
  });

  it("does not fetch admin data when permission is missing", () => {
    hasPermissionMock.mockReturnValue(false);

    const questionnaires = renderHookWithProviders(() => useQuestionnairesAdminFull());
    const blocks = renderHookWithProviders(() => useQuestionBlocksAdmin());

    expect(questionnaires.result.current.fetchStatus).toBe("idle");
    expect(blocks.result.current.fetchStatus).toBe("idle");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("creates, updates and deletes questionnaires", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    const createHook = renderHookWithProviders(() => useCreateQuestionnaireMutation());
    await act(async () => {
      await createHook.result.current.mutateAsync({
        base_locale: "en",
        code: "BASELINE",
        description_key: "questionnaires.baseline.description",
        is_active: true,
        name: "Baseline",
        name_key: "questionnaires.baseline.name",
        points_reward: 10,
        questionnaire_type: "assessment",
        questions: [],
        token_reward: 5,
      });
    });

    const updateHook = renderHookWithProviders(() => useUpdateQuestionnaireMutation());
    await act(async () => {
      await updateHook.result.current.mutateAsync({
        id: QUESTIONNAIRE_ID,
        name: "Baseline updated",
        questions: [{ block: "pain_scale" }],
      });
    });

    const deleteHook = renderHookWithProviders(() => useDeleteQuestionnaireMutation());
    await act(async () => {
      await deleteHook.result.current.mutateAsync(QUESTIONNAIRE_ID);
    });

    expect(rpcMock).toHaveBeenCalledWith("create_questionnaire_admin", {
      p_base_locale: "en",
      p_code: "BASELINE",
      p_description_key: "questionnaires.baseline.description",
      p_is_active: true,
      p_name: "Baseline",
      p_name_key: "questionnaires.baseline.name",
      p_points_reward: 10,
      p_questionnaire_type: "assessment",
      p_questions: [],
      p_token_reward: 5,
    });
    expect(rpcMock).toHaveBeenCalledWith("update_questionnaire_admin", {
      p_base_locale: undefined,
      p_code: undefined,
      p_description_key: undefined,
      p_id: QUESTIONNAIRE_ID,
      p_is_active: undefined,
      p_name: "Baseline updated",
      p_name_key: undefined,
      p_points_reward: undefined,
      p_questionnaire_type: undefined,
      p_questions: [{ block: "pain_scale" }],
      p_token_reward: undefined,
    });
    expect(rpcMock).toHaveBeenCalledWith("delete_questionnaire_admin", {
      p_id: QUESTIONNAIRE_ID,
    });
  });

  it("creates, updates and deletes question blocks", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    const createHook = renderHookWithProviders(() => useCreateQuestionBlockMutation());
    await act(async () => {
      await createHook.result.current.mutateAsync({
        block_key: "pain_scale",
        questions: [{ type: "scale" }],
        is_active: true,
        sort_order: 3,
      });
    });

    const updateHook = renderHookWithProviders(() => useUpdateQuestionBlockMutation());
    await act(async () => {
      await updateHook.result.current.mutateAsync({
        id: BLOCK_ID,
        is_active: false,
      });
    });

    const deleteHook = renderHookWithProviders(() => useDeleteQuestionBlockMutation());
    await act(async () => {
      await deleteHook.result.current.mutateAsync(BLOCK_ID);
    });

    expect(rpcMock).toHaveBeenCalledWith("create_question_block_admin", {
      p_block_key: "pain_scale",
      p_is_active: true,
      p_questions: [{ type: "scale" }],
      p_sort_order: 3,
    });
    expect(rpcMock).toHaveBeenCalledWith("update_question_block_admin", {
      p_block_key: undefined,
      p_id: BLOCK_ID,
      p_is_active: false,
      p_questions: undefined,
      p_sort_order: undefined,
    });
    expect(rpcMock).toHaveBeenCalledWith("delete_question_block_admin", {
      p_id: BLOCK_ID,
    });
  });

  it("fetches questionnaire translations", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        { key: "questionnaires.baseline.name", locale: "en", value: "Baseline" },
        { key: "questionnaires.baseline.name", locale: "cs", value: "Vstup" },
      ],
      error: null,
    });

    const { result } = renderHookWithProviders(() =>
      useQuestionnaireTranslations(["questionnaires.baseline.name"], "questionnaires"),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      "questionnaires.baseline.name": {
        en: "Baseline",
        cs: "Vstup",
      },
    });
  });

  it("returns an empty translation map for invalid translation payloads", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ key: "bad", locale: 1, value: "invalid" }],
      error: null,
    });

    const { result } = renderHookWithProviders(() =>
      useQuestionnaireTranslations(["questionnaires.baseline.name"], "questionnaires"),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({});
  });

  it("logs query errors and mutation errors", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: "RPC failed" },
    });

    const { result } = renderHookWithProviders(() => useQuestionnairesAdminFull());
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(safeErrorMock).toHaveBeenCalledWith(
      "admin.questionnaires.fetchFailed",
      { message: "RPC failed" },
    );

    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: "Create failed" },
    });

    const createHook = renderHookWithProviders(() => useCreateQuestionnaireMutation());
    await expect(
      createHook.result.current.mutateAsync({
        code: "BASELINE",
        name: "Baseline",
      }),
    ).rejects.toThrow("Create failed");
    expect(safeErrorMock).toHaveBeenCalledWith(
      "admin.questionnaires.createFailed",
      expect.any(Error),
    );
  });
});
