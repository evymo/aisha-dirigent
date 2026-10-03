import { useEffect, useMemo } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useSession } from "@/hooks/useSession";
import { usePermissions, PermissionCode } from "@/hooks/usePermissions";
import { Loader2 } from "lucide-react";
import { preloadRecharts, preloadXyflowReact } from "@/lib/perf/preloadHeavyUi";

interface RequirePermissionProps {
  children: React.ReactNode;
  /** Permission(s) required - if array, ANY of them grants access */
  permission: PermissionCode | PermissionCode[];
  /** Require ALL permissions instead of ANY */
  requireAll?: boolean;
  /** Where to redirect if not authenticated */
  loginRedirect?: string;
  /** Where to redirect if authenticated but missing permission */
  unauthorizedRedirect?: string;
  /** Custom fallback component instead of redirect */
  fallback?: React.ReactNode;
}

/**
 * Route guard that checks for specific permissions.
 * 
 * This replaces role-based guards like RequireAuth with permission-based access.
 * 
 * @example
 * ```tsx
 * // Require single permission
 * <RequirePermission permission="view_admin_dashboard">
 *   <AdminDashboard />
 * </RequirePermission>
 * 
 * // Require ANY of multiple permissions
 * <RequirePermission permission={["view_admin_dashboard", "view_staff_dashboard"]}>
 *   <Dashboard />
 * </RequirePermission>
 * 
 * // Require ALL permissions
 * <RequirePermission permission={["view_sensitive_data", "edit_sensitive_data"]} requireAll>
 *   <PhiEditor />
 * </RequirePermission>
 * 
 * // With custom fallback
 * <RequirePermission permission="manage_orders" fallback={<NoAccessMessage />}>
 *   <OrderManagement />
 * </RequirePermission>
 * ```
 */
export function RequirePermission({
  children,
  permission,
  requireAll = false,
  loginRedirect = "/auth",
  unauthorizedRedirect = "/403",
  fallback,
}: RequirePermissionProps) {
  const location = useLocation();
  const { user, isLoading: sessionLoading } = useSession();
  const { hasAllPermissions, hasAnyPermission, isLoading: permissionsLoading } = usePermissions();

  const permissions = useMemo(
    () => (Array.isArray(permission) ? permission : [permission]),
    [permission]
  );

  const hasAccess =
    !sessionLoading &&
    !permissionsLoading &&
    !!user &&
    (requireAll ? hasAllPermissions(...permissions) : hasAnyPermission(...permissions));

  useEffect(() => {
    if (!user || !hasAccess) return;

    const shouldPreloadCharts =
      permissions.includes("view_studies") || permissions.includes("view_partner_dashboard");
    const shouldPreloadAdminTools =
      permissions.includes("view_admin_dashboard") || permissions.includes("view_staff_dashboard");

    if (shouldPreloadCharts || shouldPreloadAdminTools) {
      void preloadRecharts();
    }

    if (shouldPreloadAdminTools) {
      void preloadXyflowReact();
    }
  }, [user, hasAccess, permissions]);

  // Loading state
  if (sessionLoading || permissionsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Not authenticated
  if (!user) {
    return <Navigate to={loginRedirect} state={{ from: location }} replace />;
  }

  // No permission
  if (!hasAccess) {
    if (fallback) {
      return <>{fallback}</>;
    }
    return <Navigate to={unauthorizedRedirect} state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

/**
 * Inline permission check component for conditional rendering.
 * 
 * @example
 * ```tsx
 * <IfHasPermission permission="manage_users">
 *   <Button>Manage Users</Button>
 * </IfHasPermission>
 * ```
 */
interface IfHasPermissionProps {
  children: React.ReactNode;
  permission: PermissionCode | PermissionCode[];
  requireAll?: boolean;
  fallback?: React.ReactNode;
}

export function IfHasPermission({
  children,
  permission,
  requireAll = false,
  fallback = null,
}: IfHasPermissionProps) {
  const { hasAllPermissions, hasAnyPermission, isLoading } = usePermissions();

  if (isLoading) {
    return null; // Don't show anything while loading
  }

  const permissions = Array.isArray(permission) ? permission : [permission];
  const hasAccess = requireAll 
    ? hasAllPermissions(...permissions)
    : hasAnyPermission(...permissions);

  if (!hasAccess) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
