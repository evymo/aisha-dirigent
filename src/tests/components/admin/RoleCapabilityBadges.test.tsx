import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RoleCapabilityBadges, RoleCapabilitySummary } from "@/components/admin/RoleCapabilityBadges";
import type { RoleDefinition } from "@/hooks/useRoleDefinitions";

// Mock i18n
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "admin.roles.capabilities.system": "System",
        "admin.roles.capabilities.systemTooltip": "Protected system role",
        "admin.roles.capabilities.admin": "Admin",
        "admin.roles.capabilities.adminTooltip": "Has full administrative privileges",
        "admin.roles.capabilities.viewSensitiveData": "View Sensitive Data",
        "admin.roles.capabilities.viewSensitiveDataTooltip": "Can view sensitive data",
        "admin.roles.capabilities.exportSensitiveData": "Export Sensitive Data",
        "admin.roles.capabilities.exportSensitiveDataTooltip": "Can export health data",
        "admin.roles.capabilities.breakGlass": "Break Glass",
        "admin.roles.capabilities.breakGlassTooltip": "Emergency sensitive data access",
        "admin.roles.capabilities.manageUsers": "Manage Users",
        "admin.roles.capabilities.manageUsersTooltip": "Can manage user accounts",
        "admin.roles.capabilities.manageRoles": "Manage Roles",
        "admin.roles.capabilities.manageRolesTooltip": "Can assign roles",
        "admin.roles.capabilities.secureAccess": "Secure Access",
        "admin.roles.capabilities.dataExport": "Data Export",
        "admin.roles.capabilities.emergencyAccess": "Emergency Access",
        "admin.roles.capabilities.userManagement": "User Management",
      };
      return translations[key] || key;
    },
  }),
}));

const createMockRole = (overrides: Partial<RoleDefinition> = {}): RoleDefinition => ({
  id: "test-role-id",
  name: "member",
  display_name: "Member",
  description: "Regular member",
  is_admin: false,
  is_system: false,
  can_manage_users: false,
  can_manage_roles: false,
  can_view_sensitive_data: false,
  can_export_phi: false,
  can_break_glass: false,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

describe("RoleCapabilityBadges", () => {
  it("renders nothing when role has no capabilities", () => {
    const role = createMockRole();
    const { container } = render(<RoleCapabilityBadges role={role} />);
    
    // Should render empty div with no badges
    expect(container.querySelector(".flex.flex-wrap")).toBeInTheDocument();
    expect(screen.queryByText("System")).not.toBeInTheDocument();
    expect(screen.queryByText("Admin")).not.toBeInTheDocument();
  });

  it("shows system badge when is_system is true", () => {
    const role = createMockRole({ is_system: true });
    render(<RoleCapabilityBadges role={role} />);
    
    expect(screen.getByText("System")).toBeInTheDocument();
  });

  it("shows admin badge when is_admin is true", () => {
    const role = createMockRole({ is_admin: true });
    render(<RoleCapabilityBadges role={role} />);
    
    expect(screen.getByText("Admin")).toBeInTheDocument();
  });

  it("shows sensitive data badges when sensitive data capabilities are enabled", () => {
    const role = createMockRole({ 
      can_view_sensitive_data: true, 
      can_export_phi: true 
    });
    render(<RoleCapabilityBadges role={role} />);
    
    expect(screen.getByText("View Sensitive Data")).toBeInTheDocument();
    expect(screen.getByText("Export Sensitive Data")).toBeInTheDocument();
  });

  it("shows break glass badge when can_break_glass is true", () => {
    const role = createMockRole({ can_break_glass: true });
    render(<RoleCapabilityBadges role={role} />);
    
    expect(screen.getByText("Break Glass")).toBeInTheDocument();
  });

  it("shows management badges when management capabilities are enabled", () => {
    const role = createMockRole({ 
      can_manage_users: true, 
      can_manage_roles: true 
    });
    render(<RoleCapabilityBadges role={role} />);
    
    expect(screen.getByText("Manage Users")).toBeInTheDocument();
    expect(screen.getByText("Manage Roles")).toBeInTheDocument();
  });

  it("shows all badges for admin role", () => {
    const adminRole = createMockRole({
      name: "admin",
      is_admin: true,
      is_system: true,
      can_manage_users: true,
      can_manage_roles: true,
      can_view_sensitive_data: true,
      can_export_phi: true,
      can_break_glass: true,
    });
    render(<RoleCapabilityBadges role={adminRole} />);
    
    expect(screen.getByText("System")).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("View Sensitive Data")).toBeInTheDocument();
    expect(screen.getByText("Export Sensitive Data")).toBeInTheDocument();
    expect(screen.getByText("Break Glass")).toBeInTheDocument();
    expect(screen.getByText("Manage Users")).toBeInTheDocument();
    expect(screen.getByText("Manage Roles")).toBeInTheDocument();
  });

  it("renders compact mode with only icons", () => {
    const role = createMockRole({ is_system: true, is_admin: true });
    const { container } = render(<RoleCapabilityBadges role={role} compact />);
    
    // In compact mode, badges are not rendered - only icons
    expect(container.querySelector(".flex.items-center.gap-1")).toBeInTheDocument();
    // Should not have badge text visible (only tooltips)
    expect(screen.queryByText("System")).not.toBeInTheDocument();
  });
});

describe("RoleCapabilitySummary", () => {
  it("shows checkmarks for enabled capabilities", () => {
    const role = createMockRole({
      can_view_sensitive_data: true,
      can_export_phi: true,
      can_break_glass: false,
      can_manage_users: true,
    });
    render(<RoleCapabilitySummary role={role} />);
    
    expect(screen.getByText("Secure Access")).toBeInTheDocument();
    expect(screen.getByText("Data Export")).toBeInTheDocument();
    expect(screen.getByText("Emergency Access")).toBeInTheDocument();
    expect(screen.getByText("User Management")).toBeInTheDocument();
  });

  it("shows dashes for disabled capabilities", () => {
    const role = createMockRole(); // All capabilities false
    render(<RoleCapabilitySummary role={role} />);
    
    // All should show Minus icon (lucide-react) for disabled capabilities
    const minusIcons = document.querySelectorAll(".text-slate-400");
    expect(minusIcons.length).toBe(4); // 4 capabilities in summary
  });
});
