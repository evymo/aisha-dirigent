/**
 * Tests for src/hooks/useAdminStudyConsents.ts
 *
 * The largest admin hook in the tree (357 lines, 12 exports). Covers the
 * study consent + questionnaire admin surface used by /admin/studies/:id/consents.
 *
 * Exports under test:
 *   Standalone:
 *     - fetchTranslationsForKeys
 *
 *   Queries (4):
 *     - useConsentTemplatesAdmin
 *     - useStudyConsentRequirementsAdmin(studyId)
 *     - useStudyQuestionnairesAdmin(studyId)
 *     - useQuestionnairesAdmin
 *     - useTranslationsForKeys(keys, namespace)
 *
 *   Mutations (6):
 *     - useCreateConsentTemplateMutation
 *     - useDeleteConsentTemplateMutation
 *     - useUpsertStudyConsentRequirementMutation(studyId)
 *     - useDeleteStudyConsentRequirementMutation(studyId)
 *     - useUpsertStudyQuestionnaireMutation(studyId)
 *     - useDeleteStudyQuestionnaireMutation(studyId)
 *
 * Key invariants we lock in:
 *   - studyId-parameterized queries return `[]` when studyId is undefined
 *     (without ever calling the RPC)
 *   - upsert/delete mutations invalidate the *studyId-scoped* cache key,
 *     not a global one — the closure captures `studyId` at hook-create time
 *   - `fetchTranslationsForKeys([])` is a fast-path: zero RPC calls,
 *     returns `{}` immediately
 *   - Translation result is shape-stable: every requested key gets an
 *     entry with `{ cs: "", en: "" }` even if missing in the RPC response
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  fetchTranslationsForKeys,
  useConsentTemplatesAdmin,
  useStudyConsentRequirementsAdmin,
  useStudyQuestionnairesAdmin,
  useQuestionnairesAdmin,
  useTranslationsForKeys,
  useCreateConsentTemplateMutation,
  useDeleteConsentTemplateMutation,
  useUpsertStudyConsentRequirementMutation,
  useDeleteStudyConsentRequirementMutation,
  useUpsertStudyQuestionnaireMutation,
  useDeleteStudyQuestionnaireMutation,
} from "@/hooks/useAdminStudyConsents";

const { mockRpc, mockHasPermission, mockUser, mockGuardAdminMutation } =
  vi.hoisted(() => ({
    mockRpc: vi.fn(),
    mockHasPermission: vi.fn(),
    mockUser: { id: "admin-id" },
    mockGuardAdminMutation: (_rpc: string, fn: (args: unknown) => unknown) => fn,
  }));

vi.mock("@/integrations/db/client", () => ({
  aisha: { rpc: mockRpc },
}));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ hasPermission: mockHasPermission }),
}));
vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({ user: mockUser }),
}));
vi.mock("@/hooks/useAdminGuard", () => ({
  useAdminGuard: () => ({ guardAdminMutation: mockGuardAdminMutation }),
}));

function createWrapper(qc?: QueryClient) {
  const queryClient =
    qc ??
    new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  return { Wrapper, queryClient };
}

const UUID_STUDY = "e0000000-0000-4000-a000-000000000001";
const UUID_TEMPLATE = "e0000000-0000-4000-a000-000000000002";
const UUID_REQUIREMENT = "e0000000-0000-4000-a000-000000000003";
const UUID_QUESTIONNAIRE = "e0000000-0000-4000-a000-000000000004";
const UUID_STUDY_QUESTIONNAIRE = "e0000000-0000-4000-a000-000000000005";

const consentTemplateRow = {
  id: UUID_TEMPLATE,
  template_key: "consent.gdpr",
  title_key: "consent.gdpr.title",
  content_key: "consent.gdpr.content",
  description_key: "consent.gdpr.description",
  checkbox_label_key: "consent.gdpr.checkbox",
  version: "1.0",
  is_active: true,
  requires_signature: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T01:00:00Z",
};

const requirementRow = {
  id: UUID_REQUIREMENT,
  study_id: UUID_STUDY,
  consent_template_id: UUID_TEMPLATE,
  is_required: true,
  sort_order: 0,
  created_at: "2026-01-01T00:00:00Z",
  template_key: "consent.gdpr",
  template_title_key: "consent.gdpr.title",
};

const studyQuestionnaireRow = {
  id: UUID_STUDY_QUESTIONNAIRE,
  study_id: UUID_STUDY,
  questionnaire_id: UUID_QUESTIONNAIRE,
  questionnaire_type: "baseline",
  is_required: true,
  is_active: true,
  frequency_type: "once",
  frequency_days: null,
  token_reward: 100,
  display_order: 0,
  starts_after_days: 0,
  ends_after_days: null,
  title_key: "questionnaire.baseline.title",
  description_key: "questionnaire.baseline.description",
  questionnaire_code: "BL_01",
  questionnaire_name: "Baseline",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T01:00:00Z",
};

const questionnaireRow = {
  id: UUID_QUESTIONNAIRE,
  code: "BL_01",
  name: "Baseline Questionnaire",
  is_active: true,
  questions: [],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T01:00:00Z",
};

// ── fetchTranslationsForKeys ───────────────────────────────────

describe("fetchTranslationsForKeys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns {} immediately when keys is empty (no RPC call)", async () => {
    const out = await fetchTranslationsForKeys([], "consent");
    expect(mockRpc).not.toHaveBeenCalled();
    expect(out).toEqual({});
  });

  it("calls get_translations_for_keys with keys + namespace and maps the result", async () => {
    mockRpc.mockResolvedValue({
      data: [
        { key: "consent.gdpr.title", locale: "cs", value: "Souhlas GDPR" },
        { key: "consent.gdpr.title", locale: "en", value: "GDPR Consent" },
      ],
      error: null,
    });

    const out = await fetchTranslationsForKeys(
      ["consent.gdpr.title", "consent.unused.title"],
      "consent",
    );

    expect(mockRpc).toHaveBeenCalledWith("get_translations_for_keys", {
      p_keys: ["consent.gdpr.title", "consent.unused.title"],
      p_namespace: "consent",
    });

    expect(out).toEqual({
      "consent.gdpr.title": { cs: "Souhlas GDPR", en: "GDPR Consent" },
      // Requested but no translation found → empty strings preserved
      "consent.unused.title": { cs: "", en: "" },
    });
  });

  it("ignores translation rows for locales other than cs/en", async () => {
    mockRpc.mockResolvedValue({
      data: [
        { key: "consent.x.title", locale: "cs", value: "X cs" },
        { key: "consent.x.title", locale: "de", value: "X de (ignored)" },
        { key: "consent.x.title", locale: "en", value: "X en" },
      ],
      error: null,
    });

    const out = await fetchTranslationsForKeys(["consent.x.title"], "consent");
    expect(out["consent.x.title"]).toEqual({ cs: "X cs", en: "X en" });
  });

  it("throws on RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "translations table locked" },
    });

    await expect(
      fetchTranslationsForKeys(["k1"], "consent"),
    ).rejects.toThrow("translations table locked");
  });
});

// ── useConsentTemplatesAdmin ───────────────────────────────────

describe("useConsentTemplatesAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls get_consent_templates_admin and returns parsed array", async () => {
    mockRpc.mockResolvedValue({ data: [consentTemplateRow], error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useConsentTemplatesAdmin(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockRpc).toHaveBeenCalledWith("get_consent_templates_admin");
    expect(result.current.data).toHaveLength(1);
  });

  it("does not call RPC when caller lacks view_admin_dashboard", async () => {
    mockHasPermission.mockReturnValue(false);
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useConsentTemplatesAdmin(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("throws on RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "permission denied for function" },
    });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useConsentTemplatesAdmin(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

// ── useStudyConsentRequirementsAdmin ───────────────────────────

describe("useStudyConsentRequirementsAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls get_study_consent_requirements_admin with studyId", async () => {
    mockRpc.mockResolvedValue({ data: [requirementRow], error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => useStudyConsentRequirementsAdmin(UUID_STUDY),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockRpc).toHaveBeenCalledWith(
      "get_study_consent_requirements_admin",
      { p_study_id: UUID_STUDY },
    );
    expect(result.current.data).toHaveLength(1);
  });

  it("does not call RPC when studyId is undefined (disabled)", async () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => useStudyConsentRequirementsAdmin(undefined),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("does not call RPC when caller lacks view_admin_dashboard", async () => {
    mockHasPermission.mockReturnValue(false);
    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => useStudyConsentRequirementsAdmin(UUID_STUDY),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("throws on RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "study not found" },
    });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => useStudyConsentRequirementsAdmin(UUID_STUDY),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

// ── useStudyQuestionnairesAdmin ────────────────────────────────

describe("useStudyQuestionnairesAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls get_study_questionnaires_admin with studyId", async () => {
    mockRpc.mockResolvedValue({ data: [studyQuestionnaireRow], error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => useStudyQuestionnairesAdmin(UUID_STUDY),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockRpc).toHaveBeenCalledWith(
      "get_study_questionnaires_admin",
      { p_study_id: UUID_STUDY },
    );
    expect(result.current.data).toHaveLength(1);
  });

  it("does not call RPC when studyId is undefined", async () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => useStudyQuestionnairesAdmin(undefined),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("throws on RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "permission denied" },
    });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => useStudyQuestionnairesAdmin(UUID_STUDY),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

// ── useQuestionnairesAdmin ─────────────────────────────────────

describe("useQuestionnairesAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls get_questionnaires_admin and returns parsed array", async () => {
    mockRpc.mockResolvedValue({ data: [questionnaireRow], error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useQuestionnairesAdmin(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockRpc).toHaveBeenCalledWith("get_questionnaires_admin");
    expect(result.current.data?.[0].code).toBe("BL_01");
  });

  it("does not call RPC when caller lacks view_admin_dashboard", async () => {
    mockHasPermission.mockReturnValue(false);
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useQuestionnairesAdmin(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("throws on RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "permission denied" },
    });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useQuestionnairesAdmin(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

// ── useTranslationsForKeys ─────────────────────────────────────

describe("useTranslationsForKeys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("disabled when keys array is empty", async () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useTranslationsForKeys([], "consent"), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("calls get_translations_for_keys with keys + namespace", async () => {
    mockRpc.mockResolvedValue({
      data: [
        { key: "k1", locale: "cs", value: "k1 cs" },
        { key: "k1", locale: "en", value: "k1 en" },
        { key: "k2", locale: "cs", value: "k2 cs" },
      ],
      error: null,
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => useTranslationsForKeys(["k1", "k2"], "consent"),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockRpc).toHaveBeenCalledWith("get_translations_for_keys", {
      p_keys: ["k1", "k2"],
      p_namespace: "consent",
    });
    expect(result.current.data).toEqual({
      k1: { cs: "k1 cs", en: "k1 en" },
      k2: { cs: "k2 cs", en: "" }, // missing en, default preserved
    });
  });

  it("throws on RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "permission denied" },
    });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => useTranslationsForKeys(["k1"], "consent"),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

// ── useCreateConsentTemplateMutation ───────────────────────────

describe("useCreateConsentTemplateMutation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls create_consent_template_admin with the full payload", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateConsentTemplateMutation(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({
        template_key: "consent.gdpr",
        title_key: "consent.gdpr.title",
        content_key: "consent.gdpr.content",
        description_key: "consent.gdpr.description",
        checkbox_label_key: "consent.gdpr.checkbox",
        version: "1.0",
        is_active: true,
        requires_signature: true,
      });
    });

    expect(mockRpc).toHaveBeenCalledWith("create_consent_template_admin", {
      p_checkbox_label_key: "consent.gdpr.checkbox",
      p_content_key: "consent.gdpr.content",
      p_description_key: "consent.gdpr.description",
      p_is_active: true,
      p_requires_signature: true,
      p_template_key: "consent.gdpr",
      p_title_key: "consent.gdpr.title",
      p_version: "1.0",
    });
  });

  it("invalidates BOTH admin-consent-templates AND translations caches on success", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const { Wrapper, queryClient } = createWrapper();
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCreateConsentTemplateMutation(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({
        template_key: "k",
        version: "1.0",
        is_active: true,
        requires_signature: false,
      });
    });

    expect(spy).toHaveBeenCalledWith({ queryKey: ["admin-consent-templates"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["translations"] });
  });

  it("propagates RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "duplicate template_key" },
    });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateConsentTemplateMutation(), {
      wrapper: Wrapper,
    });
    await expect(
      act(async () => {
        await result.current.mutateAsync({
          template_key: "consent.dup",
          version: "1.0",
          is_active: true,
          requires_signature: false,
        });
      }),
    ).rejects.toThrow("duplicate template_key");
  });
});

// ── useDeleteConsentTemplateMutation ───────────────────────────

describe("useDeleteConsentTemplateMutation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls delete_consent_template_admin with the id", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useDeleteConsentTemplateMutation(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync(UUID_TEMPLATE);
    });
    expect(mockRpc).toHaveBeenCalledWith("delete_consent_template_admin", {
      p_id: UUID_TEMPLATE,
    });
  });

  it("propagates RPC error (e.g. FK violation)", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "FK: template still referenced by study_consent_requirements" },
    });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useDeleteConsentTemplateMutation(), {
      wrapper: Wrapper,
    });
    await expect(
      act(async () => {
        await result.current.mutateAsync(UUID_TEMPLATE);
      }),
    ).rejects.toThrow("FK: template still referenced");
  });
});

// ── useUpsertStudyConsentRequirementMutation ───────────────────

describe("useUpsertStudyConsentRequirementMutation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls upsert_study_consent_requirement_admin with full payload", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => useUpsertStudyConsentRequirementMutation(UUID_STUDY),
      { wrapper: Wrapper },
    );
    await act(async () => {
      await result.current.mutateAsync({
        study_id: UUID_STUDY,
        consent_template_id: UUID_TEMPLATE,
        is_required: true,
        sort_order: 0,
      });
    });

    expect(mockRpc).toHaveBeenCalledWith(
      "upsert_study_consent_requirement_admin",
      {
        p_consent_template_id: UUID_TEMPLATE,
        p_is_required: true,
        p_sort_order: 0,
        p_study_id: UUID_STUDY,
      },
    );
  });

  it("invalidates the study-scoped cache key (includes studyId in queryKey)", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const { Wrapper, queryClient } = createWrapper();
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(
      () => useUpsertStudyConsentRequirementMutation(UUID_STUDY),
      { wrapper: Wrapper },
    );
    await act(async () => {
      await result.current.mutateAsync({
        study_id: UUID_STUDY,
        consent_template_id: UUID_TEMPLATE,
        is_required: true,
        sort_order: 0,
      });
    });

    expect(spy).toHaveBeenCalledWith({
      queryKey: ["admin-study-consent-requirements", UUID_STUDY],
    });
  });

  it("propagates RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "consent template not found" },
    });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => useUpsertStudyConsentRequirementMutation(UUID_STUDY),
      { wrapper: Wrapper },
    );
    await expect(
      act(async () => {
        await result.current.mutateAsync({
          study_id: UUID_STUDY,
          consent_template_id: "not-found",
          is_required: true,
          sort_order: 0,
        });
      }),
    ).rejects.toThrow("consent template not found");
  });
});

// ── useDeleteStudyConsentRequirementMutation ───────────────────

describe("useDeleteStudyConsentRequirementMutation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls delete_study_consent_requirement_admin and invalidates studyId-scoped cache", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const { Wrapper, queryClient } = createWrapper();
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(
      () => useDeleteStudyConsentRequirementMutation(UUID_STUDY),
      { wrapper: Wrapper },
    );
    await act(async () => {
      await result.current.mutateAsync(UUID_REQUIREMENT);
    });

    expect(mockRpc).toHaveBeenCalledWith(
      "delete_study_consent_requirement_admin",
      { p_id: UUID_REQUIREMENT },
    );
    expect(spy).toHaveBeenCalledWith({
      queryKey: ["admin-study-consent-requirements", UUID_STUDY],
    });
  });

  it("propagates RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "requirement not found" },
    });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => useDeleteStudyConsentRequirementMutation(UUID_STUDY),
      { wrapper: Wrapper },
    );
    await expect(
      act(async () => {
        await result.current.mutateAsync(UUID_REQUIREMENT);
      }),
    ).rejects.toThrow("requirement not found");
  });
});

// ── useUpsertStudyQuestionnaireMutation ────────────────────────

describe("useUpsertStudyQuestionnaireMutation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls upsert_study_questionnaire_admin with full payload", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => useUpsertStudyQuestionnaireMutation(UUID_STUDY),
      { wrapper: Wrapper },
    );
    await act(async () => {
      await result.current.mutateAsync({
        study_id: UUID_STUDY,
        questionnaire_id: UUID_QUESTIONNAIRE,
        questionnaire_type: "baseline",
        is_required: true,
        is_active: true,
        frequency_type: "once",
        token_reward: 100,
        display_order: 0,
        starts_after_days: 0,
        title_key: "questionnaire.baseline.title",
        description_key: "questionnaire.baseline.description",
      });
    });

    expect(mockRpc).toHaveBeenCalledWith("upsert_study_questionnaire_admin", {
      p_description_key: "questionnaire.baseline.description",
      p_display_order: 0,
      p_ends_after_days: undefined,
      p_frequency_days: undefined,
      p_frequency_type: "once",
      p_is_active: true,
      p_is_required: true,
      p_questionnaire_id: UUID_QUESTIONNAIRE,
      p_questionnaire_type: "baseline",
      p_starts_after_days: 0,
      p_study_id: UUID_STUDY,
      p_title_key: "questionnaire.baseline.title",
      p_token_reward: 100,
    });
  });

  it("invalidates BOTH the studyId-scoped questionnaires AND translations on success", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const { Wrapper, queryClient } = createWrapper();
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(
      () => useUpsertStudyQuestionnaireMutation(UUID_STUDY),
      { wrapper: Wrapper },
    );
    await act(async () => {
      await result.current.mutateAsync({
        study_id: UUID_STUDY,
        questionnaire_id: UUID_QUESTIONNAIRE,
        questionnaire_type: "baseline",
        is_required: true,
        is_active: true,
        frequency_type: "once",
        token_reward: 100,
        display_order: 0,
        starts_after_days: 0,
        title_key: "t",
        description_key: "d",
      });
    });

    expect(spy).toHaveBeenCalledWith({
      queryKey: ["admin-study-questionnaires", UUID_STUDY],
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["translations"] });
  });

  it("propagates RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "questionnaire not found" },
    });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => useUpsertStudyQuestionnaireMutation(UUID_STUDY),
      { wrapper: Wrapper },
    );
    await expect(
      act(async () => {
        await result.current.mutateAsync({
          study_id: UUID_STUDY,
          questionnaire_id: "missing",
          questionnaire_type: "baseline",
          is_required: true,
          is_active: true,
          frequency_type: "once",
          token_reward: 0,
          display_order: 0,
          starts_after_days: 0,
          title_key: "t",
          description_key: "d",
        });
      }),
    ).rejects.toThrow("questionnaire not found");
  });
});

// ── useDeleteStudyQuestionnaireMutation ────────────────────────

describe("useDeleteStudyQuestionnaireMutation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls delete_study_questionnaire_admin and invalidates studyId-scoped cache", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const { Wrapper, queryClient } = createWrapper();
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(
      () => useDeleteStudyQuestionnaireMutation(UUID_STUDY),
      { wrapper: Wrapper },
    );
    await act(async () => {
      await result.current.mutateAsync(UUID_STUDY_QUESTIONNAIRE);
    });

    expect(mockRpc).toHaveBeenCalledWith(
      "delete_study_questionnaire_admin",
      { p_id: UUID_STUDY_QUESTIONNAIRE },
    );
    expect(spy).toHaveBeenCalledWith({
      queryKey: ["admin-study-questionnaires", UUID_STUDY],
    });
  });

  it("propagates RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "study questionnaire not found" },
    });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => useDeleteStudyQuestionnaireMutation(UUID_STUDY),
      { wrapper: Wrapper },
    );
    await expect(
      act(async () => {
        await result.current.mutateAsync(UUID_STUDY_QUESTIONNAIRE);
      }),
    ).rejects.toThrow("study questionnaire not found");
  });
});
