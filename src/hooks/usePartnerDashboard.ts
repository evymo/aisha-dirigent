import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { aisha } from "@/integrations/db/client";
import { useSession } from "./useSession";
import { usePermissions } from "./usePermissions";
import { safeError } from "@/lib/security/safeLogger";
// Database type available via import if needed

// Type for the RPC response with p_partner_id arg (kept for future use)
// type PartnerRecentUserDataRow = Database["public"]["Functions"]["get_partner_recent_user_data"] extends
//   | { Args: { p_partner_id: string }; Returns: infer R }
//   | infer _
//   ? R extends (infer T)[] ? T : never
//   : never;

/**
 * Represents a study where the partner is a consultant.
 */
export interface ConsultantStudy {
  /** Unique identifier for the consultant assignment */
  id: string;
  /** ID of the study */
  study_id: string;
  /** Name of the study */
  study_name: string;
  /** Code of the study */
  study_code: string;
  /** Status of the study */
  status: string;
  /** Role of the consultant */
  role: string;
  /** Timestamp when approved */
  approved_at: string | null;
  /** Maximum number of participants */
  max_participants: number | null;
  /** Number of assigned users */
  assigned_users: number;
}

/**
 * Represents an alert for a user assigned to the partner.
 */
export interface UserAlert {
  /** Unique identifier for the alert */
  id: string;
  /** ID of the user (user) */
  user_id: string;
  /** Name of the user */
  user_name: string | null;
  /** Type of alert */
  type: "new_checkin" | "new_lab_result" | "missed_checkin" | "critical_value";
  /** Alert message */
  message: string;
  /** Timestamp of creation */
  created_at: string;
  /** Name of the study associated with the alert */
  study_name: string;
}

/**
 * Represents recent data for a user assigned to the partner.
 */
export interface RecentUserData {
  /** ID of the user (user) */
  user_id: string;
  /** Name of the user */
  user_name: string | null;
  /** Name of the study */
  study_name: string;
  /** Timestamp of last check-in */
  last_check_in: string | null;
  /** Timestamp of last lab result */
  last_lab_result: string | null;
  /** Registration status */
  registration_status: string;
}

const partnerProfileSchema = z
  .object({
    id: z.string(),
  })
  .passthrough();

async function getMyPartnerId(): Promise<string | null> {
  const { data: myPartnerProfile, error } = await aisha.rpc("get_my_partner_profile");
  if (error) throw new Error(error.message);
  if (myPartnerProfile == null) return null;

  const parsed = partnerProfileSchema.safeParse(myPartnerProfile);
  if (!parsed.success) {
    throw new Error("Invalid get_my_partner_profile RPC response");
  }

  return parsed.data.id;
}

const consultantStudyRowSchema = z
  .object({
    id: z.string(),
    study_id: z.string(),
    status: z.string().optional().default("pending"),
    approved_at: z.union([z.string(), z.null()]).optional().default(null),
    study_name: z.union([z.string(), z.null()]).optional().default("").transform((v) => v ?? ""),
    study_code: z.union([z.string(), z.null()]).optional().default("").transform((v) => v ?? ""),
    registration_count: z.number().optional().default(0),
  })
  .passthrough();

const userAlertRowSchema = z
  .object({
    id: z.string(),
    user_id: z.string(),
    user_name: z.union([z.string(), z.null()]),
    alert_type: z.enum(["new_checkin", "new_lab_result", "missed_checkin", "critical_value"]),
    message: z.string(),
    created_at: z.string(),
    study_name: z.union([z.string(), z.null()]).optional().default("").transform((v) => v ?? ""),
  })
  .passthrough();

const recentUserDataRowSchema = z
  .object({
    user_id: z.string(),
    user_name: z.union([z.string(), z.null()]).optional().default(null),
    study_name: z.union([z.string(), z.null()]).optional().default("").transform((v) => v ?? ""),
    last_check_in: z.union([z.string(), z.null()]).optional().default(null),
    last_lab_result: z.union([z.string(), z.null()]).optional().default(null),
    registration_status: z.union([z.string(), z.null()]).optional().default("active").transform((v) => v ?? "active"),
  })
  .passthrough();



/**
 * Hook to get all studies where the current user is assigned as a consultant.
 * Uses RPC for audited, centralized DB access.
 *
 * @returns Query result containing list of consultant studies.
 */
export function useConsultantStudies() {
  const { user } = useSession();
  const { hasPermission, isLoading: permissionsLoading } = usePermissions();
  const canViewPartnerDashboard = hasPermission("view_partner_dashboard");

  return useQuery({
    queryKey: ["consultant-studies", user?.id],
    queryFn: async (): Promise<ConsultantStudy[]> => {
      if (!user) return [];
      if (!canViewPartnerDashboard) return [];

      // Use RPC instead of direct table queries
      const { data, error } = await aisha.rpc('get_consultant_studies');

      if (error) {
        // RPC doesn't exist yet - graceful fallback
        if (error.code === '42883' || error.code === 'PGRST202') {
          return [];
        }
        throw new Error(error.message);
      }

      if (!data) return [];

      const parsed = z.array(consultantStudyRowSchema).safeParse(data);
      if (!parsed.success) {
        throw new Error("Invalid get_consultant_studies RPC response");
      }

      // Map RPC response to ConsultantStudy interface
      return parsed.data.map((c) => ({
        id: c.id,
        study_id: c.study_id,
        study_name: c.study_name,
        study_code: c.study_code,
        status: c.status,
        role: "consultant", // RPC doesn't return role, default to consultant
        approved_at: c.approved_at,
        max_participants: null, // RPC doesn't return this
        assigned_users: c.registration_count,
      }));
    },
    enabled: !!user && canViewPartnerDashboard && !permissionsLoading,
  });
}

/**
 * Hook to get user alerts for partner dashboard.
 * Uses RPC for audited, centralized DB access.
 *
 * @returns Query result containing list of user alerts.
 */
export function useUserAlerts() {
  const { user } = useSession();
  const { hasPermission, isLoading: permissionsLoading } = usePermissions();
  const canViewPartnerDashboard = hasPermission("view_partner_dashboard");

  return useQuery({
    queryKey: ["user-alerts", user?.id],
    queryFn: async (): Promise<UserAlert[]> => {
      if (!user) return [];
      if (!canViewPartnerDashboard) return [];

      const partnerId = await getMyPartnerId();

      if (!partnerId) return [];

      // Use RPC instead of direct table queries
      const { data, error } = await aisha.rpc("get_partner_user_alerts", {
        p_partner_id: partnerId,
      });

      if (error) {
        throw new Error(error.message);
      }

      if (!data) return [];

      const parsed = z.array(userAlertRowSchema).safeParse(data);
      if (!parsed.success) {
        throw new Error("Invalid get_partner_user_alerts RPC response");
      }

      return parsed.data.map((alert) => ({
        id: alert.id,
        user_id: alert.user_id,
        user_name: alert.user_name,
        type: alert.alert_type,
        message: alert.message,
        created_at: alert.created_at,
        study_name: alert.study_name,
      }));
    },
    enabled: !!user && canViewPartnerDashboard && !permissionsLoading,
  });
}



/**
 * Hook to get recent user data for partner dashboard.
 * Uses RPC for audited, centralized DB access.
 *
 * @returns Query result containing list of recent user data.
 */
export function useRecentUserData() {
  const { user } = useSession();
  const { hasPermission, isLoading: permissionsLoading } = usePermissions();
  const canViewPartnerDashboard = hasPermission("view_partner_dashboard");

  return useQuery({
    queryKey: ["recent-user-data", user?.id],
    queryFn: async (): Promise<RecentUserData[]> => {
      if (!user) return [];
      if (!canViewPartnerDashboard) return [];

      const partnerId = await getMyPartnerId();

      if (!partnerId) return [];

      // Use RPC instead of direct table queries - fail-closed, no fallbacks
      const { data, error } = await aisha.rpc("get_partner_recent_user_data", {
        p_partner_id: partnerId,
      });

      if (error) {
        // No fallbacks for sensitive data data access - fail-closed
        safeError("[usePartnerDashboard] Failed to fetch user data", error);
        throw new Error(error.message);
      }

      if (!data) return [];

      const parsed = z.array(recentUserDataRowSchema).safeParse(data);
      if (!parsed.success) {
        throw new Error("Invalid get_partner_recent_user_data RPC response");
      }

      return parsed.data.map((user) => ({
        user_id: user.user_id,
        user_name: user.user_name,
        study_name: user.study_name,
        last_check_in: user.last_check_in,
        last_lab_result: user.last_lab_result,
        registration_status: user.registration_status,
      }));
    },
    enabled: !!user && canViewPartnerDashboard && !permissionsLoading,
  });
}
