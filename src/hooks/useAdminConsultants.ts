import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { z } from "zod";
import {
  consultantWithRelationsArraySchema,
  studyDropdownSchema,
  studyDropdownArraySchema,
  parseArrayResponse,
  type ConsultantWithRelations,
} from "@/lib/schemas/adminSchemas";
import { usePermissions } from "./usePermissions";
import { useSession } from "./useSession";
import { useAdminGuard } from "@/hooks/useAdminGuard";

export type StudyDropdownItem = z.infer<typeof studyDropdownSchema>;
export type { ConsultantWithRelations };

/**
 * Hook for fetching all study consultants (admin only)
 */
export function useStudyConsultantsAdmin() {
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["admin-all-consultants"],
    queryFn: async (): Promise<ConsultantWithRelations[]> => {
      if (!isAdmin || !user) return [];
      const { data, error } = await aisha.rpc("get_study_consultants_admin");
      if (error) {
        safeError("adminConsultants.fetch.failed", error);
        throw new Error(error.message);
      }
      return parseArrayResponse(consultantWithRelationsArraySchema, data, "adminConsultants");
    },
    staleTime: 2 * 60 * 1000,
    enabled: isAdmin && !!user,
  });
}

/**
 * Hook for fetching studies dropdown (admin only)
 */
export function useStudiesDropdownAdmin() {
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["admin-studies-dropdown"],
    queryFn: async (): Promise<StudyDropdownItem[]> => {
      if (!isAdmin || !user) return [];
      const { data, error } = await aisha.rpc("get_studies_admin");
      if (error) {
        safeError("adminStudies.dropdown.failed", error);
        throw new Error(error.message);
      }

      const rawRows: unknown[] = Array.isArray(data) ? data : [];
      const dropdownRows = rawRows
        .filter((row): row is { id: string; name: string; code: string; status?: string | null } => {
          if (row == null || typeof row !== "object") return false;
          const r = row as Record<string, unknown>;
          return typeof r.id === "string" && typeof r.name === "string" && typeof r.code === "string";
        })
        .filter((row) => row.status === "active")
        .map((row) => ({ id: row.id, name: row.name, code: row.code }));

      return parseArrayResponse(studyDropdownArraySchema, dropdownRows, "studiesDropdown");
    },
    staleTime: 5 * 60 * 1000,
    enabled: isAdmin && !!user,
  });
}

/**
 * Hook for updating study consultant status
 */
export function useUpdateStudyConsultantStatus() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("update_study_consultant_status_admin", async ({ id, status }: { id: string; status: string }) => {
      const { error } = await aisha.rpc("update_study_consultant_status_admin", {
        p_id: id,
        p_status: status,
      });
      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-all-consultants"] });
    },
    onError: (error) => {
      safeError("adminConsultants.updateStatus.failed", error);
    },
  });
}
