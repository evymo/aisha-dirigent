import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useSecureMode } from "@/hooks/useSecureMode";
import { useSession } from "@/hooks/useSession";
import { safeError } from "@/lib/security/safeLogger";
import type { Json } from "@/integrations/db/types";

/** @internal Query key for member profile — exported for test cache control. */
export const MEMBER_PROFILE_QUERY_KEY = "member-profile-secure" as const;

const memberProfileRowSchema = z.object({
  display_name: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  gender: z.string().nullable().optional(),
  date_of_birth: z.string().nullable().optional(),
  preferred_language: z.string().nullable().optional(),
  primary_diagnosis: z.string().nullable().optional(),
  current_medications: z.string().nullable().optional(),
  allergies: z.string().nullable().optional(),
  medical_history: z.string().nullable().optional(),
});

/**
 * Validation schema for member profile form payload.
 */
export const memberProfileFormSchema = z.object({
  display_name: z.string().max(100).optional(),
  phone: z.string().max(20).optional(),
  gender: z.string().optional(),
  date_of_birth: z.string().optional(),
  preferred_language: z.string().optional(),
  primary_diagnosis: z.string().max(500).optional(),
  current_medications: z.string().max(1000).optional(),
  allergies: z.string().max(500).optional(),
  medical_history: z.string().max(2000).optional(),
});

/**
 * Member profile payload normalized for RPC read/write.
 */
export interface MemberProfileData {
  display_name: string;
  phone: string;
  gender: string;
  date_of_birth: string;
  preferred_language: string;
  primary_diagnosis: string;
  current_medications: string;
  allergies: string;
  medical_history: string;
}

/**
 * Member profile form data type.
 */
export type MemberProfileFormData = z.infer<typeof memberProfileFormSchema>;

/**
 * Default empty profile values for form initialization.
 */
export const MEMBER_PROFILE_DEFAULTS: MemberProfileData = {
  display_name: "",
  phone: "",
  gender: "",
  date_of_birth: "",
  // Terminal failover only — the member's resolved locale/DB value overrides this
  // once the profile loads (form.reset(profile)). Never a hardcoded 'cs'.
  preferred_language: "en",
  primary_diagnosis: "",
  current_medications: "",
  allergies: "",
  medical_history: "",
};

/** @internal Normalize form input → RPC payload. Exported for testing. */
export function normalizeProfileInput(input: MemberProfileFormData): MemberProfileData {
  return {
    display_name: input.display_name ?? "",
    phone: input.phone ?? "",
    gender: input.gender ?? "",
    date_of_birth: input.date_of_birth ?? "",
    preferred_language: input.preferred_language ?? "en",
    primary_diagnosis: input.primary_diagnosis ?? "",
    current_medications: input.current_medications ?? "",
    allergies: input.allergies ?? "",
    medical_history: input.medical_history ?? "",
  };
}

/** @internal Normalize RPC row → MemberProfileData. Exported for testing. */
export function normalizeProfileRow(row: z.infer<typeof memberProfileRowSchema>): MemberProfileData {
  return {
    display_name: row.display_name ?? "",
    phone: row.phone ?? "",
    gender: row.gender ?? "",
    date_of_birth: row.date_of_birth ?? "",
    preferred_language: row.preferred_language ?? "en",
    primary_diagnosis: row.primary_diagnosis ?? "",
    current_medications: row.current_medications ?? "",
    allergies: row.allergies ?? "",
    medical_history: row.medical_history ?? "",
  };
}

export interface UseMemberProfileReturn {
  profile: MemberProfileData;
  isLoading: boolean;
  isSaving: boolean;
  error: Error | null;
  refreshProfile: () => Promise<void>;
  saveProfile: (input: MemberProfileFormData) => Promise<void>;
}

/**
 * Provides secure read/write access to the authenticated member profile
 * via RPC-only calls (`get_my_profile_phi` / `upsert_my_profile_phi`).
 *
 * **Security model:**
 * - Fail-closed: query disabled unless secure mode active + secureClient available
 * - All reads/writes go through audited SECURITY DEFINER RPC
 * - Zod validation on both read (server response) and write (user input)
 * - Optimistic updates with automatic rollback on error
 * - Cache invalidation after successful mutation guarantees consistency
 *
 * @returns Profile data, loading/saving states, error, and save/refresh methods.
 *
 * @example
 * ```tsx
 * const { profile, isLoading, saveProfile } = useMemberProfile();
 * ```
 */
export function useMemberProfile(): UseMemberProfileReturn {
  const { user } = useSession();
  const { isEnabled: isPhiEnabled, secureClient } = useSecureMode();
  const queryClient = useQueryClient();

  const canAccessProfile = Boolean(user?.id && isPhiEnabled && secureClient);

  // ── Query: fetch profile via audited RPC ──
  const {
    data: profile = MEMBER_PROFILE_DEFAULTS,
    isLoading,
    error: queryError,
  } = useQuery<MemberProfileData, Error>({
    queryKey: [MEMBER_PROFILE_QUERY_KEY, user?.id],
    queryFn: async () => {
      // Fail-closed: this should never execute without secureClient,
      // but guard defensively.
      if (!secureClient) {
        throw new Error("Profile access requires secure mode.");
      }

      const { data, error: rpcError } = await secureClient.rpc("get_my_profile_phi");

      if (rpcError) {
        throw rpcError;
      }

      const row = Array.isArray(data) ? data[0] : null;
      if (!row) {
        return MEMBER_PROFILE_DEFAULTS;
      }

      const parsed = memberProfileRowSchema.safeParse(row);
      if (!parsed.success) {
        safeError("useMemberProfile.fetch.validation", parsed.error);
        throw new Error("Invalid profile payload.");
      }

      return normalizeProfileRow(parsed.data);
    },
    enabled: canAccessProfile,
    staleTime: 2 * 60 * 1000, // 2 min — profile rarely changes externally
  });

  // ── Mutation: save profile via audited RPC with optimistic update ──
  const mutation = useMutation<void, Error, MemberProfileFormData, { previous: MemberProfileData }>({
    mutationFn: async (input: MemberProfileFormData) => {
      if (!canAccessProfile || !secureClient) {
        throw new Error("Profile access requires secure mode.");
      }

      const parsed = memberProfileFormSchema.safeParse(input);
      if (!parsed.success) {
        safeError("useMemberProfile.save.validation", parsed.error);
        throw new Error("Invalid profile update payload.");
      }

      const patch = normalizeProfileInput(parsed.data);

      const { error: rpcError } = await secureClient.rpc("upsert_my_profile_phi", {
        p_patch: patch as unknown as Json,
      });

      if (rpcError) {
        throw rpcError;
      }
    },
    onMutate: async (input) => {
      // Cancel in-flight queries to prevent overwrite
      await queryClient.cancelQueries({ queryKey: [MEMBER_PROFILE_QUERY_KEY, user?.id] });

      // Snapshot previous value for rollback
      const previous = queryClient.getQueryData<MemberProfileData>(
        [MEMBER_PROFILE_QUERY_KEY, user?.id]
      ) ?? MEMBER_PROFILE_DEFAULTS;

      // Optimistic update
      queryClient.setQueryData<MemberProfileData>(
        [MEMBER_PROFILE_QUERY_KEY, user?.id],
        normalizeProfileInput(input)
      );

      return { previous };
    },
    onError: (err, _input, context) => {
      // Rollback on error
      if (context?.previous) {
        queryClient.setQueryData<MemberProfileData>(
          [MEMBER_PROFILE_QUERY_KEY, user?.id],
          context.previous
        );
      }
      safeError("useMemberProfile.save.error", err);
    },
    onSettled: async () => {
      // Always refetch after mutation to ensure server consistency
      await queryClient.invalidateQueries({ queryKey: [MEMBER_PROFILE_QUERY_KEY, user?.id] });
    },
  });

  const refreshProfile = async () => {
    if (!canAccessProfile) return;
    await queryClient.invalidateQueries({ queryKey: [MEMBER_PROFILE_QUERY_KEY, user?.id] });
  };

  const saveProfile = async (input: MemberProfileFormData) => {
    await mutation.mutateAsync(input);
  };

  // Combine query error and mutation error — last error wins
  const error = mutation.error ?? queryError ?? null;

  return {
    profile,
    isLoading,
    isSaving: mutation.isPending,
    error,
    refreshProfile,
    saveProfile,
  };
}
