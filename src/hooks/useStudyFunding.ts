import { BASE_CURRENCY_FALLBACK } from "@/lib/currency/constants";
import { useQuery, useMutation, useQueryClient, queryOptions, keepPreviousData } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { DEFAULT_QUERY_OPTIONS } from "@/lib/reactQuery/queryDefaults";
import { useTranslation } from "react-i18next";
import { safeWarn, safeError } from "@/lib/security/safeLogger";
import { getTranslationLocale } from "@/lib/i18n/locale";
import { useSession } from "./useSession";
import {
  minimalStudyRowArraySchema,
  extendedStudyArraySchema,
  studyContributionSchema,
  studyConsultantArraySchema,
  studyRatingArraySchema,
} from "@/lib/schemas/studySchemas";

/**
 * Represents a contribution to a study's funding.
 */
export interface StudyContribution {
  /** Unique identifier for the contribution */
  id: string;
  /** ID of the study being funded */
  study_id: string;
  /** ID of the user making the contribution */
  user_id: string;
  /** Type of contribution (financial or tokens) */
  contribution_type: "financial" | "tokens_governance" | "tokens_impact";
  /** Amount contributed */
  amount: number;
  /** Currency code (if financial) */
  currency: string;
  /** Type of token used (if token contribution) */
  token_type: string | null;
  /** Optional message from the contributor */
  message: string | null;
  /** Whether the contribution is anonymous */
  is_anonymous: boolean;
  /** Status of the contribution */
  status: "pending" | "completed" | "refunded";
  /** Timestamp of the contribution */
  created_at: string;
}

/**
 * Represents a consultant assigned to a study.
 */
export interface StudyConsultant {
  /** Unique identifier for the consultant assignment */
  id: string;
  /** ID of the study */
  study_id: string;
  /** ID of the partner profile */
  partner_id: string;
  /** Role of the consultant */
  role: "consultant" | "supervisor";
  /** Status of the assignment */
  status: "pending" | "approved" | "rejected" | "completed";
  /** Maximum number of participants this consultant can manage */
  max_participants: number | null;
  /** Notes regarding the assignment */
  notes: string | null;
  /** Timestamp when approved */
  approved_at: string | null;
  /** Timestamp of creation */
  created_at: string;
  /** Partner details */
  partner?: {
    display_name: string;
    business_name: string | null;
    city: string;
    is_production_provider: boolean;
  };
}

/**
 * Represents a rating for a study.
 */
export interface StudyRating {
  /** Unique identifier for the rating */
  id: string;
  /** ID of the study being rated */
  study_id: string;
  /** ID of the registration (if applicable) */
  registration_id: string | null;
  /** ID of the user submitting the rating */
  user_id: string;
  /** Rating value (1-5) */
  rating: number;
  /** Optional comment */
  comment: string | null;
  /** Whether the rating is visible publicly */
  is_visible: boolean;
  /** Timestamp of creation */
  created_at: string;
}

/**
 * Extended study information including funding and participation details.
 */
export interface ExtendedStudy {
  /** Unique identifier for the study */
  id: string;
  /** Study code */
  code: string;
  /** Study name */
  name: string;
  /** Study description */
  description: string | null;
  /** Type of study */
  study_type: "observational" | "operational_trial" | "community";
  /** Target condition being studied */
  target_condition: string | null;
  /** Products involved in the study */
  products: string[] | null;
  /** Duration in weeks */
  duration_weeks: number | null;
  /** Target number of participants */
  target_registration: number | null;
  /** Current number of participants */
  current_registration: number;
  /** Whether the study is blinded */
  is_blinded: boolean;
  /** Whether the study is active */
  is_active: boolean;
  /** Whether this is an umbrella study */
  is_umbrella: boolean;
  /** Start date */
  starts_at: string | null;
  /** End date */
  ends_at: string | null;
  /** URL to the protocol document */
  protocol_url: string | null;
  /** Funding goal amount */
  funding_goal: number;
  /** Current funding amount */
  current_funding: number;
  /** Deadline for funding */
  funding_deadline: string | null;
  /** Status of funding */
  funding_status: "draft" | "funding" | "funded" | "active" | "completed" | "cancelled";
  /** Minimum participants required */
  min_participants: number;
  /** Maximum participants allowed */
  max_participants: number | null;
  /** Timestamp of creation */
  created_at: string;
  /** Timestamp of last update */
  updated_at: string;
  /** Number of consultants assigned */
  consultant_count?: number;
  /** Number of contributions received */
  contribution_count?: number;
  /** Total amount contributed */
  total_contributed?: number;
}

type MinimalStudyRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  study_type: string;
  target_condition: string | null;
  products: string[] | null;
  duration_weeks: number | null;
  target_registration: number | null;
  current_registration: number | null;
  is_blinded: boolean | null;
  is_active: boolean | null;
  is_umbrella?: boolean | null;
  starts_at: string | null;
  ends_at: string | null;
  protocol_url: string | null;
  created_at: string;
  updated_at: string;
};

const mapMinimalStudyToExtended = (study: MinimalStudyRow): ExtendedStudy => ({
  id: study.id,
  code: study.code,
  name: study.name,
  description: study.description,
  study_type: study.study_type as ExtendedStudy["study_type"],
  target_condition: study.target_condition,
  products: study.products,
  duration_weeks: study.duration_weeks,
  target_registration: study.target_registration,
  current_registration: Number(study.current_registration ?? 0),
  is_blinded: Boolean(study.is_blinded),
  is_active: Boolean(study.is_active),
  is_umbrella: Boolean(study.is_umbrella),
  starts_at: study.starts_at,
  ends_at: study.ends_at,
  protocol_url: study.protocol_url,
  funding_goal: 0,
  current_funding: 0,
  funding_deadline: null,
  funding_status: "active",
  min_participants: 0,
  max_participants: null,
  created_at: study.created_at,
  updated_at: study.updated_at,
  consultant_count: 0,
  contribution_count: 0,
  total_contributed: 0,
});

export const extendedStudiesQueryOptions = (locale: string) => {
  const dbLocale = getTranslationLocale(locale);
  return queryOptions({
    queryKey: ["extended-studies", dbLocale],
    ...DEFAULT_QUERY_OPTIONS,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      // Prefer extended RPC (includes funding + counts) — locale-aware
      const { data, error } = await aisha.rpc("get_extended_studies", {
        p_locale: dbLocale,
      });

      // If the backend RPC is not available / misconfigured, fall back to the minimal public studies list
      // (keeps the Studies page functional instead of silently showing no studies).
      if (error) {
        safeWarn("studies.extended.fallback", error);
        // get_active_studies has no parameters
        const { data: minimal, error: minimalError } = await aisha.rpc("get_active_studies");
        if (minimalError) {
          safeWarn("studies.extended.fallbackFailed", minimalError);
          throw minimalError;
        }

        const parsed = minimalStudyRowArraySchema.safeParse(minimal);
        if (!parsed.success) {
          safeError("studies.extended.validation", parsed.error);
          return [];
        }
        return parsed.data.map(mapMinimalStudyToExtended);
      }

      const parsed = extendedStudyArraySchema.safeParse(data);
      if (!parsed.success) {
        safeError("studies.extended.validation", parsed.error);
        return [];
      }
      return parsed.data;
    },
  });
};

/**
 * Hook to fetch all extended studies with funding and participation details.
 *
 * @returns Query result containing list of extended studies.
 */
export function useExtendedStudies() {
  const { i18n } = useTranslation();
  const locale = i18n.language || "en";

  return useQuery(extendedStudiesQueryOptions(locale));
}

export const studyDetailQueryOptions = (studyId: string, locale: string) => {
  const dbLocale = getTranslationLocale(locale);
  return queryOptions({
    queryKey: ["study-detail", studyId, dbLocale],
    queryFn: async () => {
      // RPC-first pattern — locale-aware
      const { data, error } = await aisha.rpc("get_study_detail", {
        p_locale: dbLocale,
        p_study_id: studyId,
      });

      // Fallback: if the detail RPC is unavailable/misconfigured, fall back to the minimal list
      // and find the study by id so the detail page doesn't show a false "not found".
      if (error) {
        safeWarn("studies.detail.fallback", error);
        // get_active_studies has no parameters
        const { data: minimal, error: minimalError } = await aisha.rpc("get_active_studies");
        if (minimalError) {
          safeWarn("studies.detail.fallbackFailed", minimalError);
          throw minimalError;
        }

        const rows = (minimal ?? []) as MinimalStudyRow[];
        const found = rows.find((s) => s.id === studyId);
        if (!found) return null;

        return mapMinimalStudyToExtended(found);
      }

      const result = Array.isArray(data) ? data[0] : data;
      return (result as ExtendedStudy | null) ?? null;
    },
    enabled: !!studyId,
  });
};

/**
 * Hook to fetch details of a specific study.
 *
 * @param studyId - ID of the study to fetch.
 * @returns Query result containing study details.
 */
export function useStudyDetail(studyId: string) {
  const { i18n } = useTranslation();
  const locale = i18n.language || "en";

  return useQuery(studyDetailQueryOptions(studyId, locale));
}

/**
 * Hook to fetch contributions for a specific study.
 *
 * @param studyId - ID of the study.
 * @returns Query result containing list of contributions.
 */
export function useStudyContributions(studyId: string) {
  return useQuery({
    queryKey: ["study-contributions", studyId],
    queryFn: async () => {
      // RPC-only pattern
      const { data, error } = await aisha.rpc("get_study_contributions", {
        p_study_id: studyId,
      });

      if (error) throw new Error(error.message);

      // Validate with Zod and map to full StudyContribution interface
      const rawArray = Array.isArray(data) ? data : [];
      return rawArray.map((item) => {
        const parsed = studyContributionSchema.safeParse(item);
        if (parsed.success) {
          return {
            id: parsed.data.id,
            study_id: parsed.data.study_id,
            user_id: parsed.data.user_id,
            contribution_type: parsed.data.contribution_type,
            amount: parsed.data.amount,
            currency: parsed.data.currency,
            token_type: parsed.data.token_type ?? null,
            message: parsed.data.message ?? null,
            is_anonymous: parsed.data.is_anonymous,
            status: parsed.data.status,
            created_at: parsed.data.created_at,
          } as StudyContribution;
        }
        // Fallback for items that don't pass strict validation
        const rawItem = item as Record<string, unknown>;
        return {
          id: String(rawItem.id ?? ""),
          study_id: String(rawItem.study_id ?? studyId),
          user_id: String(rawItem.user_id ?? ""),
          contribution_type: (rawItem.contribution_type ?? "financial") as StudyContribution["contribution_type"],
          amount: Number(rawItem.amount ?? 0),
          currency: String(rawItem.currency ?? BASE_CURRENCY_FALLBACK),
          token_type: rawItem.token_type != null ? String(rawItem.token_type) : null,
          message: rawItem.message != null ? String(rawItem.message) : null,
          is_anonymous: Boolean(rawItem.is_anonymous),
          status: (rawItem.status ?? "completed") as StudyContribution["status"],
          created_at: String(rawItem.created_at ?? ""),
        } as StudyContribution;
      });
    },
    enabled: !!studyId,
  });
}

/**
 * Hook to fetch contributions made by the current user.
 *
 * @returns Query result containing list of user's contributions.
 */
export function useMyContributions() {
  const { user } = useSession();

  return useQuery({
    queryKey: ["my-contributions", user?.id],
    queryFn: async () => {
      if (!user) return [];

      // RPC-only pattern
      const { data, error } = await aisha.rpc("get_my_contributions");

      if (error) throw new Error(error.message);
      return data || [];
    },
    enabled: !!user,
  });
}

/**
 * Hook to create a new contribution to a study.
 *
 * @returns Mutation object for creating a contribution.
 */
export function useCreateContribution() {
  const queryClient = useQueryClient();
  const { user } = useSession();

  return useMutation({
    mutationFn: async (contribution: {
      study_id: string;
      contribution_type: "financial" | "tokens_governance" | "tokens_impact";
      amount: number;
      currency?: string;
      message?: string;
      is_anonymous?: boolean;
    }) => {
      if (!user) throw new Error("Not authenticated");

      // RPC-only pattern
      const { data, error } = await aisha.rpc("create_study_contribution", {
        p_amount: contribution.amount,
        p_contribution_type: contribution.contribution_type,
        p_currency: contribution.currency ?? undefined,
        p_is_anonymous: contribution.is_anonymous ?? false
,
        p_message: contribution.message ?? undefined,
        p_study_id: contribution.study_id
    });

      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["study-contributions", variables.study_id] });
      queryClient.invalidateQueries({ queryKey: ["my-contributions"] });
      queryClient.invalidateQueries({ queryKey: ["study-detail", variables.study_id] });
      queryClient.invalidateQueries({ queryKey: ["extended-studies"] });
    },
  });
}

/**
 * Hook to fetch consultants assigned to a study.
 *
 * @param studyId - ID of the study.
 * @returns Query result containing list of consultants.
 */
export function useStudyConsultants(studyId: string) {
  return useQuery({
    queryKey: ["study-consultants", studyId],
    queryFn: async () => {
      // RPC-only pattern
      const { data, error } = await aisha.rpc("get_approved_study_consultants", {
        p_study_id: studyId,
      });

      if (error) throw new Error(error.message);

      const parsed = studyConsultantArraySchema.safeParse(data);
      if (!parsed.success) {
        safeError("studies.consultants.validation", parsed.error);
        return [];
      }
      return parsed.data as StudyConsultant[];
    },
    enabled: !!studyId,
  });
}

/**
 * Hook to fetch the current user's consultant application for a study.
 *
 * @param studyId - ID of the study.
 * @param partnerId - ID of the partner profile.
 * @returns Query result containing the application details.
 */
export function useMyStudyConsultantApplication(studyId: string, partnerId?: string) {
  return useQuery({
    queryKey: ["my-study-consultant-application", studyId, partnerId],
    queryFn: async () => {
      if (!studyId || !partnerId) return null;

      // RPC-only pattern
      const { data, error } = await aisha.rpc("get_my_study_consultant_application", {
        p_partner_id: partnerId
,
        p_study_id: studyId
    });

      if (error) throw new Error(error.message);
      const result = Array.isArray(data) ? data[0] : data;
      return (result as StudyConsultant | null) ?? null;
    },
    enabled: !!studyId && !!partnerId,
  });
}

/**
 * Hook to apply as a consultant for a study.
 *
 * @returns Mutation object for submitting a consultant application.
 */
export function useApplyAsConsultant() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (application: {
      study_id: string;
      partner_id: string;
      role: "consultant" | "supervisor";
      max_participants?: number;
      notes?: string;
    }) => {
      // RPC-only pattern with idempotence
      const { data, error } = await aisha.rpc("apply_as_study_consultant_full", {
        p_max_participants: application.max_participants ?? undefined,
        p_notes: application.notes ?? undefined
,
        p_partner_id: application.partner_id,
        p_role: application.role,
        p_study_id: application.study_id
    });

      if (error) throw new Error(error.message);
      return data; // Returns consultant application ID (string)
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["study-consultants", variables.study_id] });
      queryClient.invalidateQueries({
        queryKey: ["my-study-consultant-application", variables.study_id, variables.partner_id],
      });
    },
  });
}

/**
 * Hook to fetch ratings for a study.
 *
 * @param studyId - ID of the study.
 * @returns Query result containing list of ratings.
 */
export function useStudyRatings(studyId: string) {
  return useQuery({
    queryKey: ["study-ratings", studyId],
    queryFn: async () => {
      // RPC-only pattern
      const { data, error } = await aisha.rpc("get_study_ratings", {
        p_study_id: studyId,
      });

      if (error) throw new Error(error.message);

      const parsed = studyRatingArraySchema.safeParse(data);
      if (!parsed.success) {
        safeError("studies.ratings.validation", parsed.error);
        return [];
      }
      return parsed.data as StudyRating[];
    },
    enabled: !!studyId,
  });
}

/**
 * Hook to calculate the average rating for a study.
 *
 * @param studyId - ID of the study.
 * @returns Object containing average rating and count.
 */
export function useStudyAverageRating(studyId: string) {
  const { data: ratings } = useStudyRatings(studyId);

  if (!ratings || ratings.length === 0) return { average: 0, count: 0 };

  const sum = ratings.reduce((acc, r) => acc + r.rating, 0);
  return {
    average: sum / ratings.length,
    count: ratings.length
  };
}

/**
 * Hook to fetch the current user's rating for a study.
 *
 * @param studyId - ID of the study.
 * @returns Query result containing the user's rating.
 */
export function useMyStudyRating(studyId: string) {
  const { user } = useSession();

  return useQuery({
    queryKey: ["my-study-rating", studyId, user?.id],
    queryFn: async () => {
      if (!user) return null;

      // RPC-only pattern
      const { data, error } = await aisha.rpc("get_my_study_rating", {
        p_study_id: studyId,
      });

      if (error) throw new Error(error.message);
      const result = Array.isArray(data) ? data[0] : data;
      return result as StudyRating | null;
    },
    enabled: !!user && !!studyId,
  });
}

/**
 * Hook to submit a rating for a study.
 *
 * @returns Mutation object for submitting a rating.
 */
export function useSubmitStudyRating() {
  const queryClient = useQueryClient();
  const { user } = useSession();

  return useMutation({
    mutationFn: async (rating: {
      study_id: string;
      registration_id?: string;
      rating: number;
      comment?: string;
    }) => {
      if (!user) throw new Error("Not authenticated");

      // RPC-only pattern (upsert)
      const { data, error } = await aisha.rpc("submit_study_rating", {
        p_comment: rating.comment ?? undefined,
        p_rating: rating.rating,
        p_registration_id: rating.registration_id ?? undefined
,
        p_study_id: rating.study_id
    });

      if (error) throw new Error(error.message);
      return data; // Returns rating ID (string)
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["study-ratings", variables.study_id] });
      queryClient.invalidateQueries({ queryKey: ["my-study-rating", variables.study_id] });
    },
  });
}
