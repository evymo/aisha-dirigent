import { Suspense, useEffect } from "react";
import { useNavigate, Outlet } from "react-router-dom";
import { useSession } from "@/hooks/useSession";
import { usePermissions } from "@/hooks/usePermissions";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { AdminHeader } from "./AdminHeader";
import { AdminRibbonNav } from "./AdminRibbonNav";
import { getVisibleAdminNavGroups } from "./adminNavConfig";

const AdminContentLoader = () => (
  <div className="min-h-[60vh] flex items-center justify-center">
    <div className="animate-pulse text-muted-foreground">Loading...</div>
  </div>
);

interface AdminLayoutProps {
  children?: React.ReactNode;
}

function triggerShortcutAction(shortcut: "arrow-down" | "arrow-up" | "delete" | "enter" | "escape" | "f2" | "f4"): void {
  const element = document.querySelector<HTMLElement>(`[data-shortcut="${shortcut}"]`);
  if (element) {
    element.click();
    return;
  }

  window.dispatchEvent(new CustomEvent(`admin-shortcut:${shortcut}`));
}

export function AdminLayout({ children }: AdminLayoutProps) {
  const navigate = useNavigate();
  const { user, isLoading } = useSession();
  const { hasAnyPermission, hasPermission, isLoading: permissionsLoading } = usePermissions();
  const isStaff = hasAnyPermission("view_admin_dashboard", "view_staff_dashboard");
  const isFullyLoaded = !isLoading && !permissionsLoading;

  useKeyboardShortcuts({
    enabled: isFullyLoaded && !!user && isStaff,
    onArrowDown: () => triggerShortcutAction("arrow-down"),
    onArrowUp: () => triggerShortcutAction("arrow-up"),
    onDelete: () => triggerShortcutAction("delete"),
    onEnter: () => triggerShortcutAction("enter"),
    onEscape: () => triggerShortcutAction("escape"),
    onF2: () => triggerShortcutAction("f2"),
    onF4: () => triggerShortcutAction("f4"),
  });

  useEffect(() => {
    // Only redirect to auth if we're sure user is not logged in
    if (isFullyLoaded && !user) {
      navigate("/auth");
    }
  }, [user, isFullyLoaded, navigate]);

  useEffect(() => {
    // SOC 2: Deterministic access control without race conditions.
    // Only redirect to /403 if we're sure the user doesn't have staff/admin role.
    // RequireAuth already handles the routing guard, this is a defense-in-depth check.
    if (isFullyLoaded && user && !isStaff) {
      // Redirect to 403 instead of member for proper access denial feedback
      navigate("/403");
    }
  }, [user, isFullyLoaded, isStaff, navigate]);

  if (!isFullyLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!user || !isStaff) {
    return null;
  }

  const navGroups = getVisibleAdminNavGroups({
    canManageAll: hasAnyPermission("manage_permissions"),
    hasPermission,
  });

  return (
    <div className="min-h-screen w-full bg-background">
      <AdminHeader />
      <AdminRibbonNav groups={navGroups} />
      <main className="admin-density p-4 md:p-6 overflow-auto">
        <Suspense fallback={<AdminContentLoader />}>
          {children || <Outlet />}
        </Suspense>
      </main>
    </div>
  );
}
