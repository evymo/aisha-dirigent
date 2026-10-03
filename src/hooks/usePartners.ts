import { useQuery, useMutation, useQueryClient, queryOptions } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { usePermissions } from "@/hooks/usePermissions";
import { useSession } from "./useSession";
import { z } from "zod";

import { safeError } from "@/lib/security/safeLogger";

import type { ApiClient } from "@/integrations/api/client";

export interface PartnerProfile {
  id: string;
  user_id: string;
  certification_level: "certified_partner" | "certified_provider";
  is_production_provider: boolean;
  business_name: string | null;
  display_name: string;
  description: string | null;
  notes_for_visitors: string | null;
  city: string;
  country: string;
  // Contact info is intentionally omitted from public listings (see `partner_profiles_public` view).
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website: string | null;
  services: string[];
  languages: string[] | null;
  is_visible: boolean;
  accepts_online_appointments: boolean;
  accepts_in_person_appointments: boolean;
  certification_passed_at: string | null;
  certification_score: number | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface PartnerAvailability {
  id: string;
  partner_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_online: boolean;
  created_at: string;
}

export interface PartnerAppointment {
  id: string;
  partner_id: string;
  member_id: string;
  appointment_date: string;
  start_time: string;
  end_time: string;
  appointment_type: string;
  status: "pending" | "confirmed" | "cancelled" | "completed";
  notes: string | null;
  service: string | null;
  created_at: string;
  updated_at: string;
}

export interface PartnerBookedSlot {
  start_time: string;
  end_time: string;
}

export interface PartnerFreeSlot {
  start_time: string;
  end_time: string;
  is_online: boolean;
}

export interface PartnerCertification {
  id: string;
  user_id: string;
  score: number;
  passed: boolean;
  answers: Record<string, string>;
  completed_at: string;
  created_at: string;
}

// Partial partner profile for anonymous users (limited fields)
export interface PartnerProfilePreview {
  id: string;
  display_name: string;
  city: string;
  country: string;
  certification_level: "certified_partner" | "certified_provider";
  is_production_provider: boolean;
  accepts_online_appointments: boolean;
  accepts_in_person_appointments: boolean;
  avatar_url: string | null;
}

export interface PartnersResponse {
  partners: PartnerProfile[] | PartnerProfilePreview[];
  isAuthenticated: boolean;
  totalCount?: number; // Only present for anonymous users
}

/**
 * Query options factory for partner directory.
 *
 * Uses RPC `get_visible_partners` (SECURITY DEFINER, GRANT TO public) for both
 * authenticated and anonymous access.
 *
 * @param city - Optional city filter.
 * @param userId - Current user ID (undefined for anon).
 */
export const partnersQueryOptions = (city?: string, userId?: string) => {
  // Shared Zod schema for PartnerProfile validation
  const partnerSchema = z.object({
    id: z.string(),
    user_id: z.string(),
    certification_level: z.enum(["certified_partner", "certified_provider"]),
    is_production_provider: z.boolean(),
    business_name: z.string().nullable().default(null),
    display_name: z.string(),
    description: z.string().nullable().default(null),
    notes_for_visitors: z.string().nullable().default(null),
    city: z.string(),
    country: z.string(),
    address: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    website: z.string().nullable().default(null),
    services: z.array(z.string()).default([]),
    languages: z.array(z.string()).nullable().default(null),
    is_visible: z.boolean().default(true),
    accepts_online_appointments: z.boolean(),
    accepts_in_person_appointments: z.boolean(),
    certification_passed_at: z.string().nullable().default(null),
    certification_score: z.number().nullable().default(null),
    avatar_url: z.string().nullable(),
    created_at: z.string().default(""),
    updated_at: z.string().default(""),
  });

  const rpcResultSchema = z.object({
    partners: z.array(partnerSchema).default([]),
    isAuthenticated: z.boolean().default(!!userId),
  });

  return queryOptions({
    queryKey: ["partners", city, userId],
    queryFn: async (): Promise<PartnersResponse> => {
      // get_visible_partners is SECURITY DEFINER with GRANT TO public — safe for anon and auth
      const { data, error } = await aisha.rpc("get_visible_partners", {
        p_city: city,
      });
      if (error) throw new Error(error.message);

      const parsed = rpcResultSchema.safeParse(data);
      const result = parsed.success ? parsed.data : { partners: [], isAuthenticated: !!userId };

      return {
        partners: result.partners as PartnerProfile[],
        isAuthenticated: !!userId,
        totalCount: undefined,
      };
    },
  });
};

/**
 * Hook to fetch partner directory via RPC.
 *
 * @param city - Optional city filter.
 * @returns Query result with partners list and auth status.
 *
 * @example
 * ```tsx
 * const { data, isLoading } = usePartners("Prague");
 * ```
 */
export function usePartners(city?: string) {
  const { user } = useSession();

  return useQuery(partnersQueryOptions(city, user?.id));
}

/**
 * Hook to fetch a specific partner's profile.
 *
 * @param partnerId - The ID of the partner.
 * @returns Query result containing the partner profile.
 */
export function usePartnerProfile(partnerId: string) {
  return useQuery({
    queryKey: ["partner", partnerId],
    queryFn: async () => {
      // RPC-only pattern
      const { data, error } = await aisha.rpc("get_partner_profile", {
        p_partner_id: partnerId,
      });

      if (error) throw new Error(error.message);

      // Validate with Zod
      const profileSchema = z.object({
        id: z.string(),
        user_id: z.string(),
        certification_level: z.enum(["certified_partner", "certified_provider"]),
        is_production_provider: z.boolean(),
        business_name: z.string().nullable().optional(),
        display_name: z.string(),
        description: z.string().nullable().optional(),
        notes_for_visitors: z.string().nullable().optional(),
        city: z.string(),
        country: z.string(),
        address: z.string().nullable().optional(),
        phone: z.string().nullable().optional(),
        email: z.string().nullable().optional(),
        website: z.string().nullable().optional(),
        services: z.array(z.string()).default([]),
        languages: z.array(z.string()).nullable().optional(),
        is_visible: z.boolean(),
        accepts_online_appointments: z.boolean(),
        accepts_in_person_appointments: z.boolean(),
        certification_passed_at: z.string().nullable().optional(),
        certification_score: z.number().nullable().optional(),
        avatar_url: z.string().nullable(),
        created_at: z.string(),
        updated_at: z.string(),
      });

      const parsed = profileSchema.safeParse(data);
      if (!parsed.success) {
        throw new Error("Partner profile validation failed");
      }
      return parsed.data as PartnerProfile;
    },
    enabled: !!partnerId,
  });
}

/**
 * Hook to fetch the current user's partner profile.
 *
 * @returns Query result containing the partner profile or null if not found.
 */
export function useMyPartnerProfile() {
  const { user } = useSession();
  const { hasPermission, isLoading: permissionsLoading } = usePermissions();
  const canViewPartnerDashboard = hasPermission("view_partner_dashboard");

  return useQuery({
    queryKey: ["my-partner-profile", user?.id],
    queryFn: async () => {
      if (!user) return null;
      if (!canViewPartnerDashboard) return null;

      // RPC-only pattern
      const { data, error } = await aisha.rpc("get_my_partner_profile");

      if (error) throw new Error(error.message);
      return data as PartnerProfile | null;
    },
    enabled: !!user && canViewPartnerDashboard && !permissionsLoading,
  });
}

/**
 * Hook to fetch availability for a specific partner.
 *
 * @param partnerId - The ID of the partner.
 * @param options - Optional configuration object.
 * @returns Query result containing the list of availability slots.
 */
export function usePartnerAvailability(partnerId: string, options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;

  return useQuery({
    queryKey: ["partner-availability", partnerId, enabled],
    queryFn: async () => {
      // RPC-only pattern
      const { data, error } = await aisha.rpc("get_partner_availability", {
        p_partner_id: partnerId,
      });

      if (error) throw new Error(error.message);

      // Validate with Zod
      const availabilitySchema = z.array(z.object({
        id: z.string(),
        partner_id: z.string(),
        day_of_week: z.number(),
        start_time: z.string(),
        end_time: z.string(),
        is_online: z.boolean(),
        created_at: z.string(),
      }));

      const parsed = availabilitySchema.safeParse(data);
      return (parsed.success ? parsed.data : []) as PartnerAvailability[];
    },
    enabled: !!partnerId && enabled,
  });
}

/**
 * Hook to fetch appointments for a specific partner.
 *
 * @param partnerId - The ID of the partner.
 * @param date - Optional date to filter appointments.
 * @param options - Optional configuration object.
 * @returns Query result containing the list of appointments.
 */
export function usePartnerAppointments(
  partnerId: string,
  date?: string,
  options?: { enabled?: boolean; includeMemberInfo?: boolean }
) {
  const enabled = options?.enabled ?? true;
  const includeMemberInfo = options?.includeMemberInfo ?? true;

  return useQuery({
    queryKey: ["partner-appointments", partnerId, date, enabled],
    queryFn: async () => {
      // RPC-only pattern
      const { data, error } = await aisha.rpc("get_partner_appointments", {
        p_date: date ?? undefined,
        p_include_member_info: includeMemberInfo
,
        p_partner_id: partnerId
    });

      if (error) throw new Error(error.message);
      const parsed = Array.isArray(data) ? data : [];
      return parsed;
    },
    enabled: !!partnerId && enabled,
  });
}

/**
 * Hook to fetch booked time slots for public/member booking flow.
 *
 * This RPC intentionally returns only time slots (no member identifiers).
 *
 * @param partnerId - The partner ID.
 * @param date - Appointment date in YYYY-MM-DD.
 * @param options - Optional query options.
 * @returns Query result containing booked slot times.
 */
export function usePartnerBookedSlots(
  partnerId: string,
  date?: string,
  options?: { enabled?: boolean }
) {
  const enabled = options?.enabled ?? true;

  return useQuery({
    queryKey: ["partner-booked-slots", partnerId, date, enabled],
    queryFn: async () => {
      if (!partnerId || !date) return [] as PartnerBookedSlot[];

      const { data, error } = await aisha.rpc("get_public_partner_booked_slots", {
        p_date: date,
        p_partner_id: partnerId,
      });

      if (error) throw new Error(error.message);

      const bookedSlotSchema = z.array(
        z.object({
          start_time: z.string(),
          end_time: z.string(),
        })
      );

      const parsed = bookedSlotSchema.safeParse(data);
      return (parsed.success ? parsed.data : []) as PartnerBookedSlot[];
    },
    enabled: !!partnerId && !!date && enabled,
  });
}

/**
 * Hook to fetch free (available and unbooked) time slots for a partner on a given date.
 *
 * Uses a single RPC call that combines availability windows and booked appointments
 * server-side, returning only the free slots ready for selection.
 *
 * @param partnerId - The partner ID.
 * @param date - Appointment date in YYYY-MM-DD format.
 * @param options - Optional query options.
 * @returns Query result containing array of free time slots.
 */
export function usePartnerFreeSlots(
  partnerId: string,
  date?: string,
  options?: { enabled?: boolean }
) {
  const enabled = options?.enabled ?? true;

  return useQuery({
    queryKey: ["partner-free-slots", partnerId, date],
    queryFn: async () => {
      if (!partnerId || !date) return [] as PartnerFreeSlot[];

      const { data, error } = await aisha.rpc("get_partner_free_slots", {
        p_date: date,
        p_partner_id: partnerId,
      });

      if (error) throw new Error(error.message);

      const freeSlotSchema = z.array(
        z.object({
          start_time: z.string(),
          end_time: z.string(),
          is_online: z.boolean(),
        })
      );

      // data comes as Json — parse through unknown
      const raw: unknown = data;
      const parsed = freeSlotSchema.safeParse(raw);
      return parsed.success ? parsed.data : ([] as PartnerFreeSlot[]);
    },
    enabled: !!partnerId && !!date && enabled,
  });
}

// Type for appointment with joined partner from the select query
interface AppointmentWithPartnerJoin {
  id: string;
  partner_id: string;
  member_id: string;
  appointment_date: string;
  start_time: string;
  end_time: string;
  appointment_type: string;
  status: string;
  service: string | null;
  created_at: string;
  updated_at: string;
  partner: { display_name: string; business_name: string | null; city: string } | Array<{ display_name: string; business_name: string | null; city: string }> | null;
}

type MyAppointment = Omit<AppointmentWithPartnerJoin, "partner"> & {
  partner: { display_name: string; business_name: string | null; city: string } | null;
};

const partnerMiniSchema = z.object({
  display_name: z.string(),
  business_name: z.string().nullable(),
  city: z.string(),
});

const appointmentWithPartnerSchema = z.object({
  id: z.string(),
  partner_id: z.string(),
  member_id: z.string(),
  appointment_date: z.string(),
  start_time: z.string(),
  end_time: z.string(),
  appointment_type: z.string(),
  status: z.string(),
  service: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  partner: z.union([partnerMiniSchema, z.array(partnerMiniSchema), z.null()]),
});

/**
 * Hook to fetch the current user's appointments.
 *
 * @param options - Optional configuration object.
 * @returns Query result containing the list of appointments.
 */
export function useMyAppointments(options?: { enabled?: boolean; client?: ApiClient }) {
  const { user } = useSession();
  const client = options?.client ?? aisha;
  const enabled = options?.enabled ?? true;

  return useQuery({
    queryKey: ["my-appointments", user?.id, enabled],
    queryFn: async (): Promise<MyAppointment[]> => {
      if (!user) return [];

      // RPC-only pattern
      const { data, error } = await client.rpc("get_my_appointments");

      if (error) throw new Error(error.message);

      const parsed = z.array(appointmentWithPartnerSchema).safeParse(data);
      if (!parsed.success) {
        safeError("partners.appointments.parseFailed", { issues: parsed.error.issues.length });
        return [];
      }

      return parsed.data.map((row) => {
        const partner = Array.isArray(row.partner) ? row.partner[0] ?? null : row.partner;
        return { ...row, partner };
      });
    },
    enabled: !!user && enabled,
  });
}

/**
 * Hook to fetch notes for specific appointments.
 *
 * @param appointmentIds - List of appointment IDs.
 * @param options - Optional configuration object.
 * @returns Query result containing a map of appointment IDs to notes.
 */
export function useMyAppointmentNotes(
  appointmentIds: string[],
  options?: { enabled?: boolean; client?: ApiClient }
) {
  const client = options?.client ?? aisha;
  const enabled = options?.enabled ?? true;
  const useAuditedRpc = Boolean(options?.client);

  const ids = (appointmentIds ?? []).filter(Boolean);
  const key = ids.slice().sort().join(",");

  return useQuery({
    queryKey: ["my-appointment-notes", key, enabled],
    queryFn: async () => {
      if (!enabled || ids.length === 0) return {} as Record<string, string | null>;

      const { data, error } = await client.rpc(useAuditedRpc ? "get_my_appointment_notes_audited" : "get_my_appointment_notes", {
        p_appointment_ids: ids,
      });

      if (error) throw new Error(error.message);

      const rows = (data ?? []) as Array<{ appointment_id: string; notes: string | null }>;
      return rows.reduce((acc, row) => {
        acc[row.appointment_id] = row.notes;
        return acc;
      }, {} as Record<string, string | null>);
    },
    enabled: enabled && ids.length > 0,
  });
}

/**
 * Hook to fetch the current user's partner certifications.
 *
 * @returns Query result containing the list of certifications.
 */
export function usePartnerCertifications() {
  const { user } = useSession();

  return useQuery({
    queryKey: ["partner-certifications", user?.id],
    queryFn: async () => {
      if (!user) return [];

      // RPC-only pattern
      const { data, error } = await aisha.rpc("get_my_partner_certifications");

      if (error) throw new Error(error.message);

      // Inline Zod validation for certifications
      const certSchema = z.array(z.object({
        id: z.string(),
        user_id: z.string(),
        score: z.number(),
        passed: z.boolean(),
        answers: z.record(z.string()),
        completed_at: z.string(),
        created_at: z.string(),
      }));

      const parsed = certSchema.safeParse(data);
      return (parsed.success ? parsed.data : []) as PartnerCertification[];
    },
    enabled: !!user,
  });
}

/**
 * Hook to create a new appointment.
 *
 * @param options - Optional configuration object.
 * @returns Mutation object for creating an appointment.
 */
export function useCreateAppointment(options?: { client?: ApiClient }) {
  const queryClient = useQueryClient();
  const client = options?.client ?? aisha;

  return useMutation({
    mutationFn: async (appointment: {
      partner_id: string;
      member_id: string;
      appointment_date: string;
      start_time: string;
      end_time: string;
      appointment_type: string;
      notes?: string;
      service?: string;
    }) => {
      // RPC-only pattern
      const { data, error } = await client.rpc("create_partner_appointment", {
        p_appointment_date: appointment.appointment_date,
        p_appointment_type: appointment.appointment_type,
        p_end_time: appointment.end_time,
        p_member_id: appointment.member_id,
        p_notes: appointment.notes ?? undefined,
        p_partner_id: appointment.partner_id,
        p_service: appointment.service ?? undefined
,
        p_start_time: appointment.start_time
    });

      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["partner-appointments"] });
      queryClient.invalidateQueries({ queryKey: ["my-appointments"] });
    },
  });
}

/**
 * Hook to update an existing appointment.
 *
 * @param options - Optional configuration object.
 * @returns Mutation object for updating an appointment.
 */
export function useUpdateAppointment(options?: { client?: ApiClient }) {
  const queryClient = useQueryClient();
  const client = options?.client ?? aisha;

  return useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string;
      status: "confirmed" | "cancelled" | "completed";
    }) => {
      // RPC-only pattern
      const { data, error } = await client.rpc("update_partner_appointment_status", {
        p_appointment_id: id,
        p_status: status,
      });

      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["partner-appointments"] }),
        queryClient.invalidateQueries({ queryKey: ["my-appointments"] }),
      ]);
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["partner-appointments"] }),
        queryClient.refetchQueries({ queryKey: ["my-appointments"] }),
      ]);
    },
  });
}

/**
 * Hook to fetch notes for a specific partner appointment.
 *
 * @param appointmentId - The ID of the appointment.
 * @param options - Optional configuration object.
 * @returns Query result containing the notes or null if not found.
 */
export function usePartnerAppointmentNotes(appointmentId: string, options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;

  return useQuery({
    queryKey: ["partner-appointment-notes", appointmentId],
    queryFn: async () => {
      if (!appointmentId) return null;

      const { data, error } = await aisha.rpc("get_partner_appointment_notes", {
        p_appointment_id: appointmentId,
      });

      if (error) throw new Error(error.message);
      return (data ?? null) as string | null;
    },
    enabled: !!appointmentId && enabled,
  });
}

/**
 * Hook to submit a partner certification application.
 *
 * @returns Mutation object for submitting certification.
 */
export function useSubmitPartnerCertification() {
  const queryClient = useQueryClient();
  const { user, refetchRoles } = useSession();

  return useMutation({
    mutationFn: async ({
      answers,
      isProductionProvider,
      profileData,
    }: {
      answers: Record<string, string>;
      isProductionProvider: boolean;
      profileData: {
        display_name: string;
        business_name?: string;
        city: string;
        country: string;
        email?: string;
        phone?: string;
        description?: string;
        services?: string[];
      };
    }) => {
      if (!user) throw new Error("Not authenticated");

      // Prepare profile data with is_production_provider flag
      const fullProfileData = {
        ...profileData,
        is_production_provider: isProductionProvider,
      };

      const { data, error } = await aisha.rpc("submit_partner_certification", {
        p_answers: answers,
        p_profile_data: fullProfileData,
      });

      if (error) throw new Error(error.message);

      const result = data as {
        success?: boolean;
        passed?: boolean;
        score?: number;
        certification_level?: string;
        role_granted?: string;
      };

      return {
        passed: Boolean(result?.passed),
        score: Number(result?.score ?? 0),
        certificationLevel: result?.certification_level ?? null,
        roleGranted: result?.role_granted ?? null,
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["partner-certifications"] });
      queryClient.invalidateQueries({ queryKey: ["my-partner-profile"] });
      queryClient.invalidateQueries({ queryKey: ["partners"] });
      queryClient.invalidateQueries({ queryKey: ["user-roles"] });
      // Refetch roles to get the newly granted partner/practitioner role
      refetchRoles?.();
    },
  });
}

/**
 * Hook to fetch available cities for partners.
 *
 * @returns Query result containing the list of cities.
 */
export function useCities() {
  return useQuery({
    queryKey: ["partner-cities"],
    queryFn: async () => {
      // RPC-only pattern
      const { data, error } = await aisha.rpc("get_partner_cities");

      if (error) throw new Error(error.message);
      return (data || []) as string[];
    },
  });
}
