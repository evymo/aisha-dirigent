/**
 * Questionnaire hooks for AISHA Dirigent.
 * Supports listing questionnaires, fetching blocks, and submitting responses.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api } from "@/config/api";
import { enqueueMutation, isNetworkConnected } from "@/services/offline";
import { safeError } from "@/lib/security/safeLogger";
import type { Json } from "@/types/database";

// ─── Schemas ──────────────────────────────────────────────────────────

const questionnaireSchema = z.object({
  code: z.string(),
  completed_at: z.string().nullable(),
  id: z.string().uuid(),
  status: z.enum(["pending", "completed", "expired"]),
  title: z.string(),
});

export type Questionnaire = z.infer<typeof questionnaireSchema>;

// Raw row shape of get_questionnaire_blocks_localized — MUST match the RPC's
// RETURNS TABLE (see aisha/db/sql/functions/get_questionnaire_blocks_localized.sql)
// and the web QuestionnaireBlockRaw (src/hooks/useQuestionnaireBlocks.ts). The
// previous schema invented field names (block_type/label/options/required) that
// the RPC never returns, so safeParse failed on every row and questionnaires
// rendered empty on mobile.
const questionBlockRawSchema = z.object({
  id: z.string().uuid(),
  block_code: z.string(),
  question_type: z.string(),
  translated_text: z.string().nullable(),
  translated_description: z.string().nullable(),
  config: z.record(z.string(), z.unknown()).nullable(),
  is_required: z.boolean(),
  display_order: z.number().int().nullable(),
  step_number: z.number().int().nullable(),
  section_key: z.string().nullable(),
  option_translations: z.record(z.string(), z.string()).nullable(),
});

type QuestionBlockRaw = z.infer<typeof questionBlockRawSchema>;

/** Normalized block consumed by the renderer (mirrors web ValidatedQuestionnaireBlock). */
export interface QuestionBlock {
  id: string;
  /** Stable response key — matches the web form, so answers aggregate cross-platform. */
  blockCode: string;
  /** Canonical question type (text/textarea/number/scale/date/select/radio/checkbox/tags/boolean/feeling_preset). */
  questionType: string;
  label: string;
  description: string;
  required: boolean;
  stepNumber: number;
  options: { value: string; label: string }[];
  config: Record<string, unknown>;
}

/** Derive renderable options from config.options + option_translations (value → label). */
function toOptions(
  config: Record<string, unknown> | null,
  optionTranslations: Record<string, string> | null,
): { value: string; label: string }[] {
  const rawOptions = config && Array.isArray(config.options) ? config.options : [];
  const translations = optionTranslations ?? {};
  return rawOptions
    .map((opt) => {
      const value =
        typeof opt === "string"
          ? opt
          : opt && typeof opt === "object" && "value" in opt
            ? String((opt as { value: unknown }).value ?? "")
            : "";
      return { value, label: translations[value] ?? value };
    })
    .filter((o) => o.value.length > 0);
}

/** Boolean blocks carry their labels as config.trueLabel_key/falseLabel_key
 *  (resolved into option_translations), not as an options array. */
function toBooleanOptions(
  config: Record<string, unknown> | null,
  optionTranslations: Record<string, string> | null,
): { value: string; label: string }[] {
  const tr = optionTranslations ?? {};
  const trueKey = typeof config?.trueLabel_key === "string" ? config.trueLabel_key : "";
  const falseKey = typeof config?.falseLabel_key === "string" ? config.falseLabel_key : "";
  return [
    { value: "true", label: tr[trueKey] || "Yes" },
    { value: "false", label: tr[falseKey] || "No" },
  ];
}

function normalizeBlock(raw: QuestionBlockRaw): QuestionBlock {
  return {
    id: raw.id,
    blockCode: raw.block_code,
    questionType: raw.question_type,
    label: raw.translated_text ?? raw.block_code,
    description: raw.translated_description ?? "",
    required: raw.is_required,
    stepNumber: raw.step_number ?? 1,
    options:
      raw.question_type === "boolean"
        ? toBooleanOptions(raw.config, raw.option_translations)
        : toOptions(raw.config, raw.option_translations),
    config: raw.config ?? {},
  };
}

// ─── Hooks ────────────────────────────────────────────────────────────

/**
 * List questionnaires for the current user.
 */
export function useQuestionnaires(storyId?: string) {
  return useQuery({
    enabled: true,
    queryFn: async () => {
      const { data, error } = await api.rpc(
        "get_dirigent_questionnaires_mobile",
        { p_story_id: storyId ?? undefined }
      );
      if (error) throw error;

      const result = z.array(questionnaireSchema).safeParse(data);
      if (!result.success) {
        safeError("useQuestionnaires.parse", result.error);
        return [];
      }
      return result.data;
    },
    queryKey: ["questionnaires", storyId],
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetch question blocks for a specific questionnaire.
 */
export function useQuestionnaireBlocks(questionnaireCode: string | undefined, locale: string) {
  return useQuery({
    enabled: !!questionnaireCode,
    queryFn: async () => {
      const { data, error } = await api.rpc(
        "get_questionnaire_blocks_localized",
        {
          p_questionnaire_code: questionnaireCode!,
          p_locale: locale,
        }
      );
      if (error) throw error;

      // Parse row-by-row: a single malformed/unknown block must not blank the
      // entire questionnaire (the old whole-array safeParse did exactly that).
      const rows = Array.isArray(data) ? data : [];
      const blocks: QuestionBlock[] = [];
      for (const row of rows) {
        const parsed = questionBlockRawSchema.safeParse(row);
        if (!parsed.success) {
          safeError("useQuestionnaireBlocks.parse", parsed.error);
          continue;
        }
        blocks.push(normalizeBlock(parsed.data));
      }
      return blocks;
    },
    queryKey: ["questionnaire-blocks", questionnaireCode, locale],
    staleTime: 10 * 60 * 1000,
  });
}

/**
 * Submit questionnaire response.
 */
export function useSubmitQuestionnaire() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      questionnaireId,
      responses,
      studyRegistrationId,
    }: {
      questionnaireId: string;
      responses: Record<string, unknown>;
      /** Ties the response to its cluster (study) so the submit RPC applies
       *  scheduling/eligibility checks and the study-level token reward.
       *  Omitted → standalone submission (questionnaire-level reward only). */
      studyRegistrationId?: string;
    }) => {
      if (!(await isNetworkConnected())) {
        await enqueueMutation(
          `submit_questionnaire:${questionnaireId}:${Date.now()}`,
          { questionnaireId, responses, studyRegistrationId },
          "submit_questionnaire",
        );
        return;
      }
      const { error } = await api.rpc("submit_questionnaire_response", {
        p_questionnaire_id: questionnaireId,
        p_responses: responses as Json,
        p_study_registration_id: studyRegistrationId ?? undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["questionnaires"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

/**
 * Fetch previous responses for a questionnaire.
 */
export function useMyQuestionnaireResponses(questionnaireId: string | undefined) {
  return useQuery({
    enabled: !!questionnaireId,
    queryFn: async () => {
      // get_my_questionnaire_responses takes no args (returns all of the
      // member's responses); the per-questionnaire scope lives in the queryKey.
      const { data, error } = await api.rpc("get_my_questionnaire_responses");
      if (error) throw error;
      return data as Record<string, unknown> | null;
    },
    queryKey: ["questionnaire-responses", questionnaireId],
  });
}
