import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AdminLayout } from "@/components/admin/AdminLayout";

const mockNavigate = vi.fn();
const mockUseAuth = vi.fn();
const mockUseUserRole = vi.fn();
const mockUsePermissions = vi.fn();

vi.mock("react-router-dom", async (orig) => {
  const actual = await orig<typeof import("react-router-dom")>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    Outlet: () => <div>outlet</div>,
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/useSession", () => ({
  useSession: () => mockUseAuth(),
}));

vi.mock("@/hooks/useUserRole", () => ({
  useUserRole: () => mockUseUserRole(),
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => mockUsePermissions(),
}));

vi.mock("@/components/admin/AdminHeader", () => ({
  AdminHeader: () => <div>admin-header</div>,
}));

vi.mock("@/components/admin/AdminRibbonNav", () => ({
  AdminRibbonNav: () => <div>admin-ribbon</div>,
}));

describe("AdminLayout", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockUseAuth.mockReset();
    mockUseUserRole.mockReset();
    mockUsePermissions.mockReset();
    // Default permission mock
    mockUsePermissions.mockReturnValue({
      permissions: [],
      isLoading: false,
      hasPermission: vi.fn(() => false),
      hasAllPermissions: vi.fn(() => false),
      hasAnyPermission: vi.fn(() => false),
    });
  });

  it("shows loading while auth is pending", () => {
    mockUseAuth.mockReturnValue({ user: null, isLoading: true, hasRole: vi.fn(), roles: [] });
    mockUseUserRole.mockReturnValue({ isStaff: false, isLoading: true, hasRole: vi.fn(), roles: [] });
    mockUsePermissions.mockReturnValue({
      permissions: [],
      isLoading: true,
      hasPermission: vi.fn(() => false),
      hasAllPermissions: vi.fn(() => false),
      hasAnyPermission: vi.fn(() => false),
    });

    render(<AdminLayout />);
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
  });

  it("redirects unauthenticated users to auth", () => {
    mockUseAuth.mockReturnValue({ user: null, isLoading: false, hasRole: vi.fn(), roles: [] });
    mockUseUserRole.mockReturnValue({ isStaff: false, isLoading: false, hasRole: vi.fn(), roles: [] });

    render(<AdminLayout />);
    expect(mockNavigate).toHaveBeenCalledWith("/auth");
  });

  it("redirects non-staff users to 403 (SOC 2: consistent access denial)", () => {
    mockUseAuth.mockReturnValue({ 
      user: { id: "u1" }, 
      isLoading: false, 
      hasRole: vi.fn(() => false), 
      roles: [] 
    });
    mockUseUserRole.mockReturnValue({ isStaff: false, isLoading: false, hasRole: vi.fn(), roles: [] });
    mockUsePermissions.mockReturnValue({
      permissions: [],
      isLoading: false,
      hasPermission: vi.fn(() => false),
      hasAllPermissions: vi.fn(() => false),
      hasAnyPermission: vi.fn(() => false),
    });

    render(<AdminLayout />);
    
    // No longer uses timeout - immediate redirect to /403 for proper access denial feedback
    expect(mockNavigate).toHaveBeenCalledWith("/403");
  });

  it("renders content for staff users", () => {
    mockUseAuth.mockReturnValue({ 
      user: { id: "u1" }, 
      isLoading: false, 
      hasRole: vi.fn((role) => role === 'staff'), 
      roles: ["staff"] 
    });
    mockUseUserRole.mockReturnValue({ isStaff: true, isLoading: false, hasRole: vi.fn(), roles: ["staff"] });
    mockUsePermissions.mockReturnValue({
      permissions: ['view_admin_dashboard', 'view_staff_dashboard'],
      isLoading: false,
      hasPermission: vi.fn((p: string) => ['view_admin_dashboard', 'view_staff_dashboard'].includes(p)),
      hasAllPermissions: vi.fn(() => true),
      hasAnyPermission: vi.fn(() => true),
    });

    render(
      <AdminLayout>
        <div>admin content</div>
      </AdminLayout>
    );

    expect(screen.getByText("admin content")).toBeInTheDocument();
    expect(screen.getByText("admin-header")).toBeInTheDocument();
    expect(screen.getByText("admin-ribbon")).toBeInTheDocument();
  });
});
