import { useState, useEffect, useCallback, useRef } from "react";
import { aisha } from "@/integrations/db/client";
import { useAuth } from "./useAuth";
import { safeError } from "@/lib/security/safeLogger";

/**
 * Application roles stored in user_roles table.
 *
 * Role hierarchy and purpose:
 * - admin: Full system access, can manage all users and settings
 * - staff: Operational access, can manage most content but not system settings
 * - partner: Certified partner with public profile (passed partner certification)
 * - practitioner: Production practitioner (legacy, being migrated to partner)
 * - member: Qualified study participant (passed qualification test)
 * - evaluator: Qualified production professional (MD/MUDr) or verified AI system
 * - consultant: Study consultant with user access
 * - researcher: Research team member
 * - production_operator: Production floor operator
 * - production_supervisor: Production supervisor
 * - quality_manager: Quality assurance manager
 */
export const APP_ROLES = [
  "admin",
  "staff",
  "partner",
  "practitioner",
  "member",
  "evaluator",
  "consultant",
  "researcher",
  "production_operator",
  "production_supervisor",
  "quality_manager",
] as const;

export type AppRole = typeof APP_ROLES[number];

/**
 * Represents a user role assignment.
 */
export interface UserRole {
  id: string;
  user_id: string;
  role: AppRole;
  granted_by: string;
  granted_at: string;
}

/**
 * Hook to fetch and manage the current user's roles.
 *
 * This hook retrieves the roles assigned to the authenticated user and provides helper
 * booleans for checking specific roles (e.g., `isAdmin`, `isStaff`).
 *
 * @returns Object containing the list of roles, loading state, and role check helpers.
 *
 * @example
 * const { isAdmin, isPartner } = useUserRole();
 * if (isAdmin) {
 *   // Show admin controls
 * }
 */
export function useUserRole() {
  const { user, loading: authLoading } = useAuth();
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [loading, setLoading] = useState(true);
  // Role patří ÚČTU, ne objektu uživatele: klíčovat podle id. Tichá obnova
  // tokenu nesmí znovu načítat role ani přepnout `loading` — ochrana adminu by
  // jinak na chvíli schovala obsah a odmontovala otevřený editor (2026-10-01).
  const userId = user?.id ?? null;
  // Pro koho už role známe; `loading` se zapne jen pro uživatele, jehož role
  // ještě neznáme (první načtení, přihlášení jiného účtu).
  const naceteneProRef = useRef<string | null>(null);

  const fetchRoles = useCallback(async (isMounted = { current: true }) => {
    // Don't fetch until auth is complete
    if (authLoading) {
      return;
    }

    if (!userId) {
      naceteneProRef.current = null;
      setRoles([]);
      setLoading(false);
      return;
    }

    // Loading jen když role tohoto účtu ještě neznáme (refetch je tichý).
    if (isMounted.current && naceteneProRef.current !== userId) {
      setLoading(true);
    }
    
    try {
      const { data, error } = await aisha.rpc("get_my_user_roles");

      if (error) throw new Error(error.message);
      if (isMounted.current) {
        setRoles(data ?? []);
      }
    } catch (err) {
      safeError("useUserRole.fetchRoles", err);
      if (isMounted.current) {
        setRoles([]);
      }
    } finally {
      if (isMounted.current) {
        naceteneProRef.current = userId;
        setLoading(false);
      }
    }
  }, [userId, authLoading]);

  useEffect(() => {
    const isMounted = { current: true };
    fetchRoles(isMounted);
    return () => { isMounted.current = false; };
  }, [fetchRoles]);

  const hasRole = (role: AppRole) => roles.some((r) => r.role === role);
  const isAdmin = hasRole("admin");
  const isStaff = hasRole("staff") || hasRole("admin");
  const isPartner = hasRole("partner") || isStaff;
  const isPractitioner = hasRole("practitioner") || hasRole("partner") || isStaff;
  const isMember = hasRole("member") || isPractitioner;
  const isEvaluator = hasRole("evaluator") || isAdmin;

  return {
    roles,
    loading,
    hasRole,
    isAdmin,
    isStaff,
    isPartner,
    isPractitioner,
    isMember,
    isEvaluator,
    refetch: fetchRoles,
  };
}
