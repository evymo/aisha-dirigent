import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useSession } from "@/hooks/useSession";
import { usePermissions, PermissionCode } from "@/hooks/usePermissions";

/**
 * Access Control
 * 
 * Permission-based access:
 * - requiredPermissions: ["view_admin_dashboard"] - requires ANY of these permissions
 * - requiredPermissions + requireAllPermissions: requires ALL permissions
 * 
 * Permission mapping:
 * - admin access → requiredPermissions: ["view_admin_dashboard"]
 * - partner access → requiredPermissions: ["view_partner_dashboard"]
 * - member access → requiredPermissions: ["view_studies"]
 */

type RequireAuthProps = {
  children: ReactNode;
  /** Permission codes required for access */
  requiredPermissions?: PermissionCode[];
  /** If true, ALL permissions required; if false (default), ANY permission grants access */
  requireAllPermissions?: boolean;
};

export function RequireAuth({
  children,
  requiredPermissions,
  requireAllPermissions = false,
}: RequireAuthProps) {
  const session = useSession();
  const { hasAllPermissions, hasAnyPermission, isLoading: permissionsLoading } = usePermissions();
  const location = useLocation();

  const needsPermissionLookup = Boolean(requiredPermissions?.length);

  const isAuthorizing =
    session.isLoading ||
    (Boolean(session.user) && needsPermissionLookup && permissionsLoading);

  if (isAuthorizing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!session.user) {
    return <Navigate to="/auth" replace state={{ from: location }} />;
  }

  // Permission-based access check
  if (requiredPermissions?.length) {
    const hasPermissionAccess = requireAllPermissions
      ? hasAllPermissions(...requiredPermissions)
      : hasAnyPermission(...requiredPermissions);

    if (!hasPermissionAccess) {
      return <Navigate to="/403" replace />;
    }
  }

  return <>{children}</>;
}
