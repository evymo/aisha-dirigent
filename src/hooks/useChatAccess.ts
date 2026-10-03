import { useMemo } from "react";
import { useSession } from "./useSession";
import { useMembership } from "./useMembership";
import { useRIIMembership } from "./useRIIMembership";
import { useMyRegistrations } from "./useStudies";

/**
 * Access levels for AI chat feature.
 * Determines what level of information/guidance a user can receive.
 */
export type ChatAccessLevel =
  | "none"           // Not logged in or no registration
  | "basic"          // Registered but not enrolled in any study
  | "enrolled"       // Enrolled in RII or other study (pending or screening)
  | "active"         // Active study participant
  | "qualified"      // Passed qualification test
  | "certified"      // Has certification (partner/practitioner level)
  | "premium";       // Premium/upgraded membership

export interface ChatAccessResult {
  /** Whether user can access the chat at all */
  canChat: boolean;
  /** Current access level determining guardrails and info depth */
  accessLevel: ChatAccessLevel;
  /** Reason why chat is blocked (if canChat is false) */
  blockReason: "not_authenticated" | "no_registration" | "pending_approval" | null;
  /** Whether user is loading (avoid showing block states during load) */
  isLoading: boolean;
  /** Membership tier for additional guardrail context */
  membershipTier: string | null;
  /** Whether user has completed questionnaire */
  hasCompletedQuestionnaire: boolean;
  /** Whether user passed qualification test */
  isQualified: boolean;
  /** Active study registrations count */
  activeRegistrationsCount: number;
}

/**
 * Hook to determine user's access level to AI chat.
 * Controls who can chat and what guardrails apply.
 * 
 * Access hierarchy:
 * 1. Not authenticated → blocked
 * 2. Authenticated but no RII registration → can see chat, but cannot use
 * 3. RII screening/pending → limited access
 * 4. RII enrolled/active → full chat access with basic guardrails
 * 5. Qualified (passed test) → enhanced info access
 * 6. Certified (partner) → professional-level access
 * 7. Premium member → priority + premium content
 */
export function useChatAccess(): ChatAccessResult {
  const { user, isLoading: sessionLoading } = useSession();
  const { membership, loading: membershipLoading } = useMembership();
  const { 
    isRIIMember, 
    isPendingRII, 
    isRIIActive,
    hasCompletedQuestionnaire,
    canTakeQualificationTest,
    isLoading: riiLoading 
  } = useRIIMembership();
  const { registrations, loading: registrationsLoading } = useMyRegistrations();

  const isLoading = sessionLoading || membershipLoading || riiLoading || registrationsLoading;

  return useMemo(() => {
    // Still loading - don't block yet
    if (isLoading) {
      return {
        canChat: false,
        accessLevel: "none",
        blockReason: null,
        isLoading: true,
        membershipTier: null,
        hasCompletedQuestionnaire: false,
        isQualified: false,
        activeRegistrationsCount: 0,
      };
    }

    // Not authenticated
    if (!user) {
      return {
        canChat: false,
        accessLevel: "none",
        blockReason: "not_authenticated",
        isLoading: false,
        membershipTier: null,
        hasCompletedQuestionnaire: false,
        isQualified: false,
        activeRegistrationsCount: 0,
      };
    }

    const membershipTier = membership?.tier ?? null;
    const activeRegistrations = registrations.filter(e => 
      ["enrolled", "active", "completed"].includes(e.status)
    );
    const activeRegistrationsCount = activeRegistrations.length;

    // Determine if user is qualified (upgraded tier indicates passed qualification)
    const isQualified = membershipTier === "upgraded";
    
    // Check if user has any form of study registration
    const hasAnyRegistration = isRIIMember || isPendingRII || activeRegistrationsCount > 0;

    // Not enrolled in any study
    if (!hasAnyRegistration) {
      return {
        canChat: false,
        accessLevel: "none",
        blockReason: "no_registration",
        isLoading: false,
        membershipTier,
        hasCompletedQuestionnaire,
        isQualified,
        activeRegistrationsCount,
      };
    }

    // Pending RII approval
    if (isPendingRII && !isRIIMember) {
      return {
        canChat: false,
        accessLevel: "enrolled",
        blockReason: "pending_approval",
        isLoading: false,
        membershipTier,
        hasCompletedQuestionnaire,
        isQualified,
        activeRegistrationsCount,
      };
    }

    // Determine access level based on membership and qualifications
    let accessLevel: ChatAccessLevel = "enrolled";

    if (isRIIActive) {
      accessLevel = "active";
    }

    if (isQualified || canTakeQualificationTest) {
      accessLevel = "qualified";
    }

    // Premium/upgraded membership gets highest access
    if (membershipTier === "upgraded") {
      accessLevel = "premium";
    }

    return {
      canChat: true,
      accessLevel,
      blockReason: null,
      isLoading: false,
      membershipTier,
      hasCompletedQuestionnaire,
      isQualified,
      activeRegistrationsCount,
    };
  }, [
    user,
    isLoading,
    membership,
    isRIIMember,
    isPendingRII,
    isRIIActive,
    hasCompletedQuestionnaire,
    canTakeQualificationTest,
    registrations,
  ]);
}

/**
 * Get guardrails configuration based on access level.
 * Used by edge function to determine response constraints.
 * 
 * This MUST stay synchronized with supabase/functions/_shared/guardrails-config.ts
 * 
 * Access Level Matrix:
 * | Level     | Max Len | Med Advice | Distribution | Study | Research | Disclaimer |
 * |-----------|---------|------------|--------|-------|----------|------------|
 * | none      | 500     | ❌         | ❌     | ❌    | ❌       | ✅         |
 * | basic     | 500     | ❌         | ❌     | ❌    | ❌       | ✅         |
 * | enrolled  | 1000    | ❌         | ✅     | ✅    | ❌       | ✅         |
 * | active    | 2000    | ❌         | ✅     | ✅    | ✅       | ✅         |
 * | qualified | 3000    | ✅         | ✅     | ✅    | ✅       | ✅         |
 * | certified | 4000    | ✅         | ✅     | ✅    | ✅       | ❌         |
 * | premium   | 5000    | ✅         | ✅     | ✅    | ✅       | ❌         |
 */
export function getGuardrailsForAccessLevel(level: ChatAccessLevel): {
  maxResponseLength: number;
  allowMedicalAdvice: boolean;
  allowDistributionInfo: boolean;
  allowStudyDetails: boolean;
  allowResearchData: boolean;
  requireDisclaimer: boolean;
} {
  switch (level) {
    case "none":
    case "basic":
      return {
        maxResponseLength: 500,
        allowMedicalAdvice: false,
        allowDistributionInfo: false,
        allowStudyDetails: false,
        allowResearchData: false,
        requireDisclaimer: true,
      };
    case "enrolled":
      return {
        maxResponseLength: 1000,
        allowMedicalAdvice: false,
        allowDistributionInfo: true,
        allowStudyDetails: true,
        allowResearchData: false,
        requireDisclaimer: true,
      };
    case "active":
      return {
        maxResponseLength: 2000,
        allowMedicalAdvice: false,
        allowDistributionInfo: true,
        allowStudyDetails: true,
        allowResearchData: true,
        requireDisclaimer: true,
      };
    case "qualified":
      return {
        maxResponseLength: 3000,
        allowMedicalAdvice: true,
        allowDistributionInfo: true,
        allowStudyDetails: true,
        allowResearchData: true,
        requireDisclaimer: true,
      };
    case "certified":
      return {
        maxResponseLength: 4000,
        allowMedicalAdvice: true,
        allowDistributionInfo: true,
        allowStudyDetails: true,
        allowResearchData: true,
        requireDisclaimer: false,
      };
    case "premium":
      return {
        maxResponseLength: 5000,
        allowMedicalAdvice: true,
        allowDistributionInfo: true,
        allowStudyDetails: true,
        allowResearchData: true,
        requireDisclaimer: false,
      };
    default:
      return {
        maxResponseLength: 500,
        allowMedicalAdvice: false,
        allowDistributionInfo: false,
        allowStudyDetails: false,
        allowResearchData: false,
        requireDisclaimer: true,
      };
  }
}
