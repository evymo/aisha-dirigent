import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import AdminPermissions from "@/pages/admin/AdminPermissions";

vi.mock("@/hooks/usePermissions");
import { usePermissions, usePermissionManagement } from "@/hooks/usePermissions";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

describe("AdminPermissions page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderWithQueryClient = () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    return render(
      <QueryClientProvider client={queryClient}>
        <AdminPermissions />
      </QueryClientProvider>
    );
  };

  it("should fail-closed when user lacks manage_permissions", () => {
    vi.mocked(usePermissions).mockReturnValue({
      permissions: [],
      isLoading: false,
      error: null,
      hasPermission: () => false,
      hasAllPermissions: () => false,
      hasAnyPermission: () => false,
    });

    vi.mocked(usePermissionManagement).mockReturnValue({
      allPermissions: [],
      rolePermissions: [],
      isLoading: false,
      roleHasPermission: () => false,
      getPermissionsForRole: () => [],
      togglePermission: vi.fn().mockResolvedValue({}),
    });

    renderWithQueryClient();

    expect(screen.getByText("admin.permissions.accessDenied")).toBeInTheDocument();
  });

  it("should render permissions and toggle via permission_code", async () => {
    const user = userEvent.setup();

    vi.mocked(usePermissions).mockReturnValue({
      permissions: ["manage_permissions"],
      isLoading: false,
      error: null,
      hasPermission: (code: string) => code === "manage_permissions",
      hasAllPermissions: () => false,
      hasAnyPermission: () => false,
    });

    const togglePermission = vi.fn().mockResolvedValue({});

    vi.mocked(usePermissionManagement).mockReturnValue({
      allPermissions: [
        {
          id: "perm_view_sensitive_data",
          code: "view_sensitive_data",
          name: "View Sensitive Data",
          description: "Allows viewing sensitive data",
          category: "secure",
          is_system: false,
        },
      ],
      rolePermissions: [
        {
          id: "rp_1",
          role: "staff",
          permission_code: "view_sensitive_data",
          permission_name: "View Sensitive Data",
          category: "secure",
          granted_at: new Date().toISOString(),
          granted_by: null,
        },
      ],
      isLoading: false,
      roleHasPermission: (role: string, code: string) => role === "staff" && code === "view_sensitive_data",
      getPermissionsForRole: (role: string) => (role === "staff" ? [{
        id: "rp_1",
        role: "staff",
        permission_code: "view_sensitive_data",
        permission_name: "View Sensitive Data",
        category: "secure",
        granted_at: new Date().toISOString(),
        granted_by: null,
      }] : []),
      togglePermission,
    });

    renderWithQueryClient();

    // Title visible => page rendered with access
    expect(screen.getByText("admin.permissions.title")).toBeInTheDocument();

    // Default tab is staff; permission name should render
    expect(screen.getByText("View Sensitive Data")).toBeInTheDocument();

    // Click the single checkbox; should toggle for role=staff and permission=view_sensitive_data
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.length).toBeGreaterThan(0);

    await user.click(checkboxes[0]);

    expect(togglePermission).toHaveBeenCalled();
    expect(togglePermission).toHaveBeenCalledWith("staff", "view_sensitive_data");
  });
});
