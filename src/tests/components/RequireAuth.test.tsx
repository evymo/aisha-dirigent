import { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import { RequireAuth } from "@/components/session/RequireAuth";
import { useSession } from "@/hooks/useSession";
import { usePermissions } from "@/hooks/usePermissions";

vi.mock("@/hooks/useSession", () => ({
  useSession: vi.fn(),
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: vi.fn(),
}));

const mockUseAuth = vi.mocked(useSession);
const mockUsePermissions = vi.mocked(usePermissions);

function renderWithPermissions(ui: ReactNode, requiredPermissions: string[]) {
  return render(
    <MemoryRouter initialEntries={["/protected"]}>
      <Routes>
        <Route path="/auth" element={<div>Auth Page</div>} />
        <Route path="/403" element={<div>Forbidden Page</div>} />
        <Route
          path="/protected"
          element={<RequireAuth requiredPermissions={requiredPermissions}>{ui}</RequireAuth>}
        />
      </Routes>
    </MemoryRouter>
  );
}

function renderAuthOnly(ui: ReactNode) {
  return render(
    <MemoryRouter initialEntries={["/protected"]}>
      <Routes>
        <Route path="/auth" element={<div>Auth Page</div>} />
        <Route path="/403" element={<div>Forbidden Page</div>} />
        <Route
          path="/protected"
          element={<RequireAuth>{ui}</RequireAuth>}
        />
      </Routes>
    </MemoryRouter>
  );
}

describe("RequireAuth", () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
    mockUsePermissions.mockReset();

    // Default permissions mock (no permissions)
    mockUsePermissions.mockReturnValue({
      permissions: [],
      isLoading: false,
      error: null,
      hasPermission: () => false,
      hasAllPermissions: () => false,
      hasAnyPermission: () => false,
    } as never);
  });

  it("renders children when user is authenticated (no permissions required)", () => {
    mockUseAuth.mockReturnValue({
      user: { id: '1' }, isLoading: false, hasRole: () => false, roles: [],
    } as never);

    renderAuthOnly(<div>Protected Content</div>);

    expect(screen.getByText("Protected Content")).toBeInTheDocument();
  });

  it("redirects to /auth when user is not authenticated", () => {
    mockUseAuth.mockReturnValue({ user: null, isLoading: false, hasRole: () => false, roles: [] } as never);

    renderAuthOnly(<div>Protected Content</div>);

    expect(screen.getByText("Auth Page")).toBeInTheDocument();
  });

  it("shows loading state while authorizing", () => {
    mockUseAuth.mockReturnValue({
      user: { id: '1' }, isLoading: false, hasRole: () => false, roles: [],
    } as never);

    mockUsePermissions.mockReturnValue({
      permissions: [],
      isLoading: true,
      error: null,
      hasPermission: () => false,
      hasAllPermissions: () => false,
      hasAnyPermission: () => false,
    } as never);

    renderWithPermissions(<div>Protected Content</div>, ["view_admin_dashboard"]);

    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  describe("permission-based access", () => {
    it("allows access when user has required permission", () => {
      mockUseAuth.mockReturnValue({
        user: { id: '1' }, isLoading: false, hasRole: () => false, roles: [],
      } as never);

      mockUsePermissions.mockReturnValue({
        permissions: [{ code: "view_admin_dashboard" }],
        isLoading: false,
        error: null,
        hasPermission: (code: string) => code === "view_admin_dashboard",
        hasAllPermissions: (...codes: string[]) => codes.every(c => c === "view_admin_dashboard"),
        hasAnyPermission: (...codes: string[]) => codes.some(c => c === "view_admin_dashboard"),
      } as never);

      renderWithPermissions(<div>Admin Content</div>, ["view_admin_dashboard"]);

      expect(screen.getByText("Admin Content")).toBeInTheDocument();
    });

    it("redirects to /403 when user lacks required permission", () => {
      mockUseAuth.mockReturnValue({
        user: { id: '1' }, isLoading: false, hasRole: () => false, roles: [],
      } as never);

      mockUsePermissions.mockReturnValue({
        permissions: [],
        isLoading: false,
        error: null,
        hasPermission: () => false,
        hasAllPermissions: () => false,
        hasAnyPermission: () => false,
      } as never);

      renderWithPermissions(<div>Admin Content</div>, ["view_admin_dashboard"]);

      expect(screen.getByText("Forbidden Page")).toBeInTheDocument();
    });

    it("allows access when user has ANY of required permissions", () => {
      mockUseAuth.mockReturnValue({
        user: { id: '1' }, isLoading: false, hasRole: () => false, roles: [],
      } as never);

      mockUsePermissions.mockReturnValue({
        permissions: [{ code: "view_staff_dashboard" }],
        isLoading: false,
        error: null,
        hasPermission: (code: string) => code === "view_staff_dashboard",
        hasAllPermissions: (...codes: string[]) => codes.every(c => c === "view_staff_dashboard"),
        hasAnyPermission: (...codes: string[]) => codes.some(c => c === "view_staff_dashboard"),
      } as never);

      renderWithPermissions(<div>Dashboard Content</div>, ["view_admin_dashboard", "view_staff_dashboard"]);

      expect(screen.getByText("Dashboard Content")).toBeInTheDocument();
    });

    it("denies access when requireAllPermissions is true and user lacks one", () => {
      mockUseAuth.mockReturnValue({
        user: { id: '1' }, isLoading: false, hasRole: () => false, roles: [],
      } as never);

      const userPermissions = ["view_sensitive_data"];
      mockUsePermissions.mockReturnValue({
        permissions: userPermissions.map(code => ({ code })),
        isLoading: false,
        error: null,
        hasPermission: (code: string) => userPermissions.includes(code),
        hasAllPermissions: (...codes: string[]) => codes.every(c => userPermissions.includes(c)),
        hasAnyPermission: (...codes: string[]) => codes.some(c => userPermissions.includes(c)),
      } as never);

      render(
        <MemoryRouter initialEntries={["/secure-editor"]}>
          <Routes>
            <Route path="/403" element={<div>Forbidden Page</div>} />
            <Route
              path="/secure-editor"
              element={
                <RequireAuth
                  requiredPermissions={["view_sensitive_data", "edit_sensitive_data"]}
                  requireAllPermissions
                >
                  <div>Secure Editor</div>
                </RequireAuth>
              }
            />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByText("Forbidden Page")).toBeInTheDocument();
    });
  });
});
