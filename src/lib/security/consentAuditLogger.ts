import { aisha } from "@/integrations/db/client";
import { safeError } from "./safeLogger";
import type { Database } from "@/integrations/db/types";

type JournalActionType = Database["public"]["Enums"]["journal_action_type"];
type JournalArea = Database["public"]["Enums"]["journal_area"];

/**
 * Consent action types for audit logging and token rewards
 */
export type ConsentActionType = 
  | "consent_granted" 
  | "consent_revoked" 
  | "consent_updated"
  | "secure_access_granted"
  | "study_registration_completed"
  | "questionnaire_completed"
  | "health_checkin_completed"
  | "document_uploaded"
  | "consultation_completed";

/**
 * Log consent-related action to audit journal with blockchain recording
 * 
 * @param actionType - Type of consent action
 * @param entityType - Entity type (e.g., 'consent', 'registration', 'document')
 * @param entityId - ID of the entity
 * @param details - Additional details about the action
 * @param oldValues - Previous state (for updates)
 * @param newValues - New state (for updates)
 */
// No userId parameter: the audit actor is pinned to auth.uid() inside
// write_my_audit_journal_entry and cannot be chosen by the client.
export async function logConsentAction({
  actionType,
  entityType,
  entityId,
  summary,
  details,
  oldValues,
  newValues,
}: {
  actionType: ConsentActionType;
  entityType: string;
  entityId?: string;
  summary: string;
  details?: Record<string, unknown>;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
}): Promise<{ success: boolean; journalId?: string; error?: Error }> {
  try {
    // Map consent actions to journal action types
    const journalActionMap: Record<string, string> = {
      consent_granted: "approve",
      consent_revoked: "cancel",
      consent_updated: "update",
      secure_access_granted: "approve",
      study_registration_completed: "complete",
      questionnaire_completed: "submit",
      health_checkin_completed: "submit",
      document_uploaded: "create",
      consultation_completed: "complete",
    };

    const journalAction = journalActionMap[actionType] || "system_event";

    // Determine area
    const areaMap: Record<string, string> = {
      consent: "consents",
      registration: "registrations",
      questionnaire: "studies",
      checkin: "studies",
      document: "documents",
      consultation: "appointments",
    };
    
    const area = areaMap[entityType] || "system";

    // Create audit journal entry via SECURITY DEFINER RPC (RPC-only model)
    // Parameters MUST be in alphabetical order!
    //
    // write_my_audit_journal_entry, not write_audit_journal: the latter takes p_user_id and was
    // GRANTed to `authenticated`, so any logged-in user could author an audit entry attributed to
    // someone else (docs/security/IDOR_P_USER_ID_AUDIT_2026-07-15.md). It is now service_role-only.
    // This RPC has no p_user_id — it pins the actor to auth.uid() in the DB, which is exactly what
    // the `userId` argument already carried (useConsentAuditLogger passes the session user's id).
    // Severity is fixed at 'info' server-side.
    const { data: journalId, error: journalError } = await aisha.rpc("write_my_audit_journal_entry", {
      p_action_type: journalAction as JournalActionType,
      p_area: area as JournalArea,
      p_details: details ? JSON.parse(JSON.stringify(details)) : undefined,
      p_entity_id: entityId ?? undefined,
      p_entity_type: entityType,
      p_new_values: newValues ? JSON.parse(JSON.stringify(newValues)) : undefined,
      p_old_values: oldValues ? JSON.parse(JSON.stringify(oldValues)) : undefined,
      p_summary: summary,
    });

    if (journalError) throw journalError;

    return { success: true, journalId: journalId as string };
  } catch (err) {
    safeError("logConsentAction", err);
    return { success: false, error: err as Error };
  }
}

/**
 * Process token reward for completed consent action
 * Uses existing token_reward_rules system for reward configuration
 * 
 * @param userId - User receiving the reward
 * @param actionType - Type of action completed
 * @param referenceId - Reference to the entity (e.g., consent ID, registration ID)
 * @returns Reward processing result
 */
export async function processConsentReward({
  userId,
  actionType,
  referenceId,
}: {
  userId: string;
  actionType: ConsentActionType;
  referenceId?: string;
}): Promise<{
  success: boolean;
  amount?: number;
  transactionId?: string;
  error?: Error;
}> {
  try {
    // Call existing process_token_reward RPC which uses token_reward_rules table
    const { data, error } = await aisha.rpc("process_token_reward", {
      p_action_type: actionType,
      p_reference_id: referenceId ?? undefined
,
      p_user_id: userId
    });

    if (error) {
      throw error;
    }

    const result = data as {
      success: boolean;
      transaction_id?: string;
      new_balance?: number;
      amount_awarded?: number;
    };

    return {
      success: result.success,
      amount: result.amount_awarded,
      transactionId: result.transaction_id,
    };
  } catch (err) {
    safeError("processConsentReward", err);
    return { success: false, error: err as Error };
  }
}

/**
 * Combined function: Log action AND process reward
 * Use this for actions that should trigger both audit logging and token rewards
 */
export async function logAndRewardConsentAction({
  userId,
  actionType,
  entityType,
  entityId,
  summary,
  details,
  oldValues,
  newValues,
}: {
  userId: string;
  actionType: ConsentActionType;
  entityType: string;
  entityId?: string;
  summary: string;
  details?: Record<string, unknown>;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
}): Promise<{
  logSuccess: boolean;
  rewardSuccess: boolean;
  journalId?: string;
  rewardAmount?: number;
  errors?: Error[];
}> {
  const errors: Error[] = [];

  // Log the action. No userId — the audit actor is pinned to auth.uid() in the DB.
  // processConsentReward below still takes it: process_token_reward keeps its p_user_id
  // (a user legitimately rewards themselves) and pins it to auth.uid() rather than dropping it.
  const logResult = await logConsentAction({
    actionType,
    entityType,
    entityId,
    summary,
    details,
    oldValues,
    newValues,
  });

  if (!logResult.success && logResult.error) {
    errors.push(logResult.error);
  }

  // Process reward
  const rewardResult = await processConsentReward({
    userId,
    actionType,
    referenceId: entityId,
  });

  if (!rewardResult.success && rewardResult.error) {
    errors.push(rewardResult.error);
  }

  return {
    logSuccess: logResult.success,
    rewardSuccess: rewardResult.success,
    journalId: logResult.journalId,
    rewardAmount: rewardResult.amount,
    errors: errors.length > 0 ? errors : undefined,
  };
}
