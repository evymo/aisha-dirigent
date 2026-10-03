import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError, safeInfo, safeWarn } from "@/lib/security/safeLogger";
import { useSession } from "@/hooks/useSession";

/**
 * Hook to check if user already has umbrella registration.
 * Only runs when user is authenticated.
 */
export function useCheckUmbrellaRegistration() {
  const { user } = useSession();
  
  return useQuery({
    queryKey: ["check_umbrella_registration", user?.id],
    queryFn: async () => {
      const { data, error } = await aisha.rpc("check_umbrella_registration");

      if (error) {
        safeWarn("member.onboarding.umbrellaCheckFailed", `errorCode=${error.code ?? "unknown"}`);
        return { has_registration: false };
      }

      return data?.[0] ?? { has_registration: false };
    },
    enabled: !!user,
  });
}

export interface OnboardingSubmitData {
  overall_feeling: number;
  energy_perception: number;
  physical_confidence: number;
  mental_wellbeing: number;
  sleep_satisfaction: number;
  primary_concern: string;
  main_goal: string;
  timeframe_expectation: string;
  mentor_preference: string;
  communication_style: string;
  age_range: string;
  has_chronic_condition: boolean;
  condition_brief: string;
  secondary_concerns: string[];
}

/**
 * Hook to create study registration
 */
export function useCreateStudyRegistration() {
  return useMutation({
    mutationFn: async ({
      initialStatus = "screening",
      studyId,
    }: {
      initialStatus?: string;
      studyId: string;
    }) => {
      const { data, error } = await aisha.rpc("create_study_registration_audited", {
        p_baseline_data: null,
        p_initial_status: initialStatus,
        p_study_id: studyId,
      });

      if (error) {
        safeError("member.onboarding.registrationFailed", `errorCode=${error.code ?? "unknown"}`);
        throw new Error(error.message);
      }

      safeInfo(
        "member.onboarding.registrationCreated",
        `hasUmbrellaRegistration=${Boolean(data?.[0]?.umbrella_registration_id)}`
      );

      return data;
    },
  });
}

/**
 * Hook to submit onboarding response
 */
export function useSubmitOnboardingResponse() {
  return useMutation({
    mutationFn: async (data: OnboardingSubmitData) => {
      const { error } = await aisha.rpc("submit_onboarding_response_audited", {
        p_age_range: data.age_range,
        p_communication_style: data.communication_style,
        p_condition_brief: data.condition_brief,
        p_energy_perception: data.energy_perception,
        p_has_chronic_condition: data.has_chronic_condition,
        p_main_goal: data.main_goal,
        p_mental_wellbeing: data.mental_wellbeing,
        p_mentor_preference: data.mentor_preference,
        p_overall_feeling: data.overall_feeling,
        p_physical_confidence: data.physical_confidence,
        p_primary_concern: data.primary_concern,
        p_secondary_concerns: data.secondary_concerns
,
        p_sleep_satisfaction: data.sleep_satisfaction,
        p_timeframe_expectation: data.timeframe_expectation
    });

      if (error) {
        safeError("member.onboarding.submitFailed", error);
        throw new Error(error.message);
      }

      safeInfo("member.onboarding.completed", "ok");
    },
  });
}

/**
 * Hook to submit consents
 */
export function useSubmitOnboardingConsents() {
  return useMutation({
    mutationFn: async ({
      consentTypes,
      studyId,
      version = "1.0",
    }: {
      consentTypes: string[];
      studyId: string;
      version?: string;
    }) => {
      if (consentTypes.length === 0) return;

      const { error } = await aisha.rpc("create_my_consents", {
        p_consent_types: consentTypes,
        p_study_id: studyId,
        p_version: version,
      });

      if (error) {
        safeWarn("member.onboarding.consentsFailed", `errorCode=${error.code ?? "unknown"}`);
        throw new Error(error.message);
      }
    },
  });
}

/**
 * Hook to update the current user's profile display name.
 *
 * @returns Mutation for updating display name
 *
 * @example
 * const { mutateAsync: updateDisplayName } = useUpdateProfileDisplayName();
 * await updateDisplayName({ displayName: 'John Doe' });
 */
export function useUpdateProfileDisplayName() {
  return useMutation({
    mutationFn: async ({ displayName }: { displayName: string }) => {
      const { error } = await aisha.rpc("update_my_profile_display_name", {
        p_display_name: displayName,
      });

      if (error) {
        safeError("onboarding.updateDisplayName.failed", error);
        throw new Error(error.message);
      }
    },
  });
}

/**
 * Hook to create an appointment for the current user.
 *
 * @returns Mutation for creating appointments
 *
 * @example
 * const { mutateAsync: createAppointment } = useCreateMyAppointment();
 * await createAppointment({
 *   partnerId: 'partner-uuid',
 *   appointmentDate: '2026-02-10',
 *   startTime: '10:00',
 *   endTime: '11:00',
 *   appointmentType: 'consultation',
 *   notes: 'Initial consultation',
 * });
 */
export function useCreateMyAppointment() {
  return useMutation({
    mutationFn: async ({
      appointmentDate,
      appointmentType = "consultation",
      endTime,
      notes,
      partnerId,
      startTime,
    }: {
      appointmentDate: string;
      appointmentType?: string;
      endTime: string;
      notes?: string;
      partnerId: string;
      startTime: string;
    }) => {
      const { error } = await aisha.rpc("create_my_appointment", {
        p_appointment_date: appointmentDate,
        p_appointment_type: appointmentType,
        p_end_time: endTime,
        p_notes: notes ?? undefined,
        p_partner_id: partnerId,
        p_start_time: startTime,
      });

      if (error) {
        safeError("onboarding.createAppointment.failed", error);
        throw new Error(error.message);
      }
    },
  });
}

/**
 * Hook to get localized consent requirements for a study.
 *
 * @param studyId - Study UUID
 * @param locale - Locale code (e.g., 'cs', 'en')
 * @returns Query with consent requirements
 *
 * @example
 * const { data: requirements, isLoading } = useStudyConsentRequirementsLocalized(studyId, 'cs');
 */
export function useStudyConsentRequirementsLocalized(
  studyId: string | undefined,
  locale: string
) {
  return useQuery({
    queryKey: ["study-consent-requirements-localized", studyId, locale],
    queryFn: async () => {
      if (!studyId) return [];
      const { data, error } = await aisha.rpc(
        "get_study_consent_requirements_localized",
        {
          p_locale: locale,
          p_study_id: studyId,
        }
      );
      if (error) {
        safeError("useStudyConsentRequirementsLocalized.error", error);
        throw new Error(error.message);
      }
      return data ?? [];
    },
    enabled: Boolean(studyId),
  });
}

/**
 * A single outstanding (not-yet-signed) consent requirement for the current member,
 * as returned by the get_my_pending_consents RPC.
 */
export interface PendingConsent {
  id: string;
  study_id: string;
  study_name: string;
  consent_template_id: string;
  template_key: string;
  title: string;
  content: string;
  version: string;
  is_required: boolean;
  requires_signature: boolean;
}

/**
 * Hook to list the current member's outstanding consent requirements (across their
 * active study registrations), localized. Backs the charter-signing surface.
 *
 * @param locale - Locale code (e.g. 'cs', 'en')
 * @returns Query with the member's pending consents
 *
 * @example
 * const { data: pending = [], isLoading } = useMyPendingConsents('cs');
 */
export function useMyPendingConsents(locale: string) {
  const { user } = useSession();

  return useQuery({
    queryKey: ["my-pending-consents", user?.id, locale],
    queryFn: async (): Promise<PendingConsent[]> => {
      const { data, error } = await aisha.rpc("get_my_pending_consents", {
        p_locale: locale,
      });
      if (error) {
        safeError("member.pendingConsents.error", error);
        throw new Error(error.message);
      }
      return (data ?? []) as PendingConsent[];
    },
    enabled: !!user,
    // Pending consents change only when a document version is published or the
    // member signs one — both invalidate this key explicitly.
    staleTime: 60 * 1000,
  });
}

/**
 * Hook to submit a study consent acceptance.
 *
 * @returns Mutation for accepting study consents
 *
 * @example
 * const { mutateAsync: submitConsent } = useSubmitStudyConsentAcceptance();
 * await submitConsent({ consentTemplateId: '...', granted: true, studyId: '...' });
 */
export function useSubmitStudyConsentAcceptance() {
  return useMutation({
    mutationFn: async ({
      consentTemplateId,
      granted,
      signatureData,
      studyId,
    }: {
      consentTemplateId: string;
      granted: boolean;
      signatureData?: string;
      studyId: string;
    }) => {
      const { error } = await aisha.rpc("submit_study_consent_acceptance", {
        p_consent_template_id: consentTemplateId,
        p_granted: granted,
        p_signature_data: signatureData,
        p_study_id: studyId,
      });

      if (error) {
        safeError("useSubmitStudyConsentAcceptance.error", error);
        throw new Error(error.message);
      }
    },
  });
}

/**
 * Hook to insert a questionnaire response securely.
 *
 * @returns Mutation for inserting questionnaire responses
 *
 * @example
 * const { mutateAsync: insertResponse } = useInsertQuestionnaireResponse();
 * await insertResponse({
 *   questionnaireId: '...',
 *   responses: { question1: 'answer' },
 *   studyRegistrationId: '...',
 * });
 */
export function useInsertQuestionnaireResponse() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      questionnaireId,
      responses,
      studyRegistrationId,
    }: {
      questionnaireId: string;
      responses: Record<string, unknown>;
      studyRegistrationId?: string;
    }) => {
      const { error } = await aisha.rpc("insert_questionnaire_response_secure", {
        p_questionnaire_id: questionnaireId,
        p_responses: JSON.parse(JSON.stringify(responses)),
        p_study_registration_id: studyRegistrationId,
      });

      if (error) {
        safeError("useInsertQuestionnaireResponse.error", error);
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      // Invalidate questionnaire completion status so UI reflects the new state
      void queryClient.invalidateQueries({ queryKey: ["rii-questionnaire-completed"] });
      void queryClient.invalidateQueries({ queryKey: ["rii-membership"] });
      void queryClient.invalidateQueries({ queryKey: ["check_umbrella_registration"] });
      safeInfo("useInsertQuestionnaireResponse.success", "questionnaire response inserted, cache invalidated");
    },
  });
}

/**
 * Profile contact prefill data structure
 */
export interface ProfileContactPrefillData {
  address?: {
    city?: string;
    country?: string;
    postalCode?: string;
    street?: string;
  } | null;
  display_name?: string;
  email?: string;
  phone?: string;
}

/**
 * Hook to get the current user's profile contact info for prefilling forms.
 *
 * @returns Query with profile contact data
 *
 * @example
 * const { data: profileData, isLoading } = useProfileContactPrefill();
 */
export function useProfileContactPrefill() {
  return useQuery({
    queryKey: ["my-profile-contact-prefill"],
    queryFn: async (): Promise<ProfileContactPrefillData | null> => {
      const { data, error } = await aisha.rpc("get_my_profile_contact_prefill_audited");

      if (error) {
        safeError("useProfileContactPrefill.error", error);
        throw new Error(error.message);
      }

      const profile = Array.isArray(data) ? data[0] : data;
      if (!profile) return null;

      // Parse address from JSON if present
      let parsedAddress: ProfileContactPrefillData["address"] = undefined;
      if (profile.address && typeof profile.address === "object" && !Array.isArray(profile.address)) {
        const addr = profile.address as Record<string, unknown>;
        parsedAddress = {
          city: typeof addr.city === "string" ? addr.city : undefined,
          country: typeof addr.country === "string" ? addr.country : undefined,
          postalCode: typeof addr.postalCode === "string" ? addr.postalCode : undefined,
          street: typeof addr.street === "string" ? addr.street : undefined,
        };
      }

      return {
        address: parsedAddress,
        display_name: typeof profile.display_name === "string" ? profile.display_name : undefined,
        email: typeof profile.email === "string" ? profile.email : undefined,
        phone: typeof profile.phone === "string" ? profile.phone : undefined,
      };
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to update the current user's partner profile.
 *
 * @returns Mutation for updating partner profile
 *
 * @example
 * const { mutateAsync: updateProfile } = useUpdateMyPartnerProfile();
 * await updateProfile({ displayName: 'John', city: 'Prague', ... });
 */
export function useUpdateMyPartnerProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      acceptsInPersonAppointments,
      acceptsOnlineAppointments,
      address,
      businessName,
      city,
      country,
      description,
      displayName,
      email,
      isVisible,
      languages,
      notesForVisitors,
      phone,
      services,
      website,
    }: {
      acceptsInPersonAppointments?: boolean;
      acceptsOnlineAppointments?: boolean;
      address?: string;
      businessName?: string;
      city: string;
      country: string;
      description?: string;
      displayName: string;
      email?: string;
      isVisible: boolean;
      languages: string[];
      notesForVisitors?: string;
      phone?: string;
      services: string[];
      website?: string;
    }) => {
      const { error } = await aisha.rpc("update_my_partner_profile", {
        p_accepts_in_person_appointments: acceptsInPersonAppointments,
        p_accepts_online_appointments: acceptsOnlineAppointments,
        p_address: address,
        p_business_name: businessName,
        p_city: city,
        p_country: country,
        p_description: description,
        p_display_name: displayName,
        p_email: email,
        p_is_visible: isVisible,
        p_languages: languages,
        p_notes_for_visitors: notesForVisitors,
        p_phone: phone,
        p_services: services,
        p_website: website,
      });

      if (error) {
        safeError("useUpdateMyPartnerProfile.error", error);
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["partner-profile"] });
    },
  });
}
