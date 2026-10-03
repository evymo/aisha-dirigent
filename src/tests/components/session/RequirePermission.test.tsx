import { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import { RequirePermission, IfHasPermission } from "@/components/session/RequirePermission";
import { useSession } from "@/hooks/useSession";
import { usePermissions } from "@/hooks/usePermissions";

vi.mock("@/hooks/useSession", () => ({
  useSession: vi.fn(),
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: vi.fn(),
}));

const mockUseSession = vi.mocked(useSession);
const mockUsePermissions = vi.mocked(usePermissions);

// React Router v7+ has removed the future prop - v7 features are now default

function renderWithRouter(ui: ReactNode, initialEntry = "/protected") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/auth" element={<div>Auth Page</div>} />
        <Route path="/403" element={<div>403 Page</div>} />
        <Route path="/" element={<div>Home Page</div>} />
        <Route path="/protected" element={ui} />
      </Routes>
    </MemoryRouter>
  );
}

describe("RequirePermission", () => {
  beforeEach(() => {
    mockUseSession.mockReset();
    mockUsePermissions.mockReset();
  });

  describe("authentication", () => {
    it("shows loading state while session is loading", () => {
      mockUseSession.mockReturnValue({
        user: null,
        isLoading: true,
      } as never);

      mockUsePermissions.mockReturnValue({
        isLoading: true,
        hasPermission: () => false,
        hasAllPermissions: () => false,
        hasAnyPermission: () => false,
      } as never);

      renderWithRouter(
        <RequirePermission permission="view_admin_dashboard">
          <div>Protected Content</div>
        </RequirePermission>
      );

      // Should show loading spinner
      expect(screen.queryByText("Protected Content")).not.toBeInTheDocument();
    });

    it("redirects to login when user is not authenticated", () => {
      mockUseSession.mockReturnValue({
        user: null,
        isLoading: false,
      } as never);

      mockUsePermissions.mockReturnValue({
        isLoading: false,
        hasPermission: () => false,
        hasAllPermissions: () => false,
        hasAnyPermission: () => false,
      } as never);

      renderWithRouter(
        <RequirePermission permission="view_admin_dashboard">
          <div>Protected Content</div>
        </RequirePermission>
      );

      expect(screen.getByText("Auth Page")).toBeInTheDocument();
    });
  });

  describe("single permission", () => {
    it("renders children when user has required permission", () => {
      mockUseSession.mockReturnValue({
        user: { id: "1" },
        isLoading: false,
      } as never);

      mockUsePermissions.mockReturnValue({
        isLoading: false,
        hasPermission: (code: string) => code === "view_admin_dashboard",
        hasAllPermissions: (...codes: string[]) => codes.every(c => c === "view_admin_dashboard"),
        hasAnyPermission: (...codes: string[]) => codes.some(c => c === "view_admin_dashboard"),
      } as never);

      renderWithRouter(
        <RequirePermission permission="view_admin_dashboard">
          <div>Protected Content</div>
        </RequirePermission>
      );

      expect(screen.getByText("Protected Content")).toBeInTheDocument();
    });

    it("redirects to home when user lacks required permission", () => {
      mockUseSession.mockReturnValue({
        user: { id: "1" },
        isLoading: false,
      } as never);

      mockUsePermissions.mockReturnValue({
        isLoading: false,
        hasPermission: () => false,
        hasAllPermissions: () => false,
        hasAnyPermission: () => false,
      } as never);

      renderWithRouter(
        <RequirePermission permission="view_admin_dashboard">
          <div>Protected Content</div>
        </RequirePermission>
      );

      expect(screen.getByText("403 Page")).toBeInTheDocument();
    });
  });

  describe("multiple permissions (ANY mode)", () => {
    it("allows access when user has ANY of the required permissions", () => {
      mockUseSession.mockReturnValue({
        user: { id: "1" },
        isLoading: false,
      } as never);

      const userPermissions = ["view_staff_dashboard"];
      mockUsePermissions.mockReturnValue({
        isLoading: false,
        hasPermission: (code: string) => userPermissions.includes(code),
        hasAllPermissions: (...codes: string[]) => codes.every(c => userPermissions.includes(c)),
        hasAnyPermission: (...codes: string[]) => codes.some(c => userPermissions.includes(c)),
      } as never);

      renderWithRouter(
        <RequirePermission permission={["view_admin_dashboard", "view_staff_dashboard"]}>
          <div>Dashboard Content</div>
        </RequirePermission>
      );

      expect(screen.getByText("Dashboard Content")).toBeInTheDocument();
    });
  });

  describe("multiple permissions (ALL mode)", () => {
    it("denies access when user lacks one of the required permissions", () => {
      mockUseSession.mockReturnValue({
        user: { id: "1" },
        isLoading: false,
      } as never);

      const userPermissions = ["view_sensitive_data"];
      mockUsePermissions.mockReturnValue({
        isLoading: false,
        hasPermission: (code: string) => userPermissions.includes(code),
        hasAllPermissions: (...codes: string[]) => codes.every(c => userPermissions.includes(c)),
        hasAnyPermission: (...codes: string[]) => codes.some(c => userPermissions.includes(c)),
      } as never);

      renderWithRouter(
        <RequirePermission permission={["view_sensitive_data", "edit_sensitive_data"]} requireAll>
          <div>Secure Editor</div>
        </RequirePermission>
      );

      expect(screen.getByText("403 Page")).toBeInTheDocument();
    });

    it("allows access when user has ALL required permissions", () => {
      mockUseSession.mockReturnValue({
        user: { id: "1" },
        isLoading: false,
      } as never);

      const userPermissions = ["view_sensitive_data", "edit_sensitive_data"];
      mockUsePermissions.mockReturnValue({
        isLoading: false,
        hasPermission: (code: string) => userPermissions.includes(code),
        hasAllPermissions: (...codes: string[]) => codes.every(c => userPermissions.includes(c)),
        hasAnyPermission: (...codes: string[]) => codes.some(c => userPermissions.includes(c)),
      } as never);

      renderWithRouter(
        <RequirePermission permission={["view_sensitive_data", "edit_sensitive_data"]} requireAll>
          <div>Secure Editor</div>
        </RequirePermission>
      );

      expect(screen.getByText("Secure Editor")).toBeInTheDocument();
    });
  });

  describe("custom fallback", () => {
    it("renders custom fallback instead of redirecting", () => {
      mockUseSession.mockReturnValue({
        user: { id: "1" },
        isLoading: false,
      } as never);

      mockUsePermissions.mockReturnValue({
        isLoading: false,
        hasPermission: () => false,
        hasAllPermissions: () => false,
        hasAnyPermission: () => false,
      } as never);

      renderWithRouter(
        <RequirePermission 
          permission="view_admin_dashboard" 
          fallback={<div>No Access - Contact Admin</div>}
        >
          <div>Protected Content</div>
        </RequirePermission>
      );

      expect(screen.getByText("No Access - Contact Admin")).toBeInTheDocument();
      expect(screen.queryByText("Protected Content")).not.toBeInTheDocument();
    });
  });
});

describe("IfHasPermission", () => {
  beforeEach(() => {
    mockUsePermissions.mockReset();
  });

  it("renders children when user has permission", () => {
    mockUsePermissions.mockReturnValue({
      isLoading: false,
      hasPermission: (code: string) => code === "manage_users",
      hasAllPermissions: () => false,
      hasAnyPermission: (...codes: string[]) => codes.includes("manage_users"),
    } as never);

    render(<IfHasPermission permission="manage_users"><button>Manage Users</button></IfHasPermission>);

    expect(screen.getByText("Manage Users")).toBeInTheDocument();
  });

  it("renders nothing when user lacks permission", () => {
    mockUsePermissions.mockReturnValue({
      isLoading: false,
      hasPermission: () => false,
      hasAllPermissions: () => false,
      hasAnyPermission: () => false,
    } as never);

    render(<IfHasPermission permission="manage_users"><button>Manage Users</button></IfHasPermission>);

    expect(screen.queryByText("Manage Users")).not.toBeInTheDocument();
  });

  it("renders fallback when user lacks permission", () => {
    mockUsePermissions.mockReturnValue({
      isLoading: false,
      hasPermission: () => false,
      hasAllPermissions: () => false,
      hasAnyPermission: () => false,
    } as never);

    render(
      <IfHasPermission permission="manage_users" fallback={<span>View Only</span>}>
        <button>Manage Users</button>
      </IfHasPermission>
    );

    expect(screen.queryByText("Manage Users")).not.toBeInTheDocument();
    expect(screen.getByText("View Only")).toBeInTheDocument();
  });

  it("renders nothing while loading", () => {
    mockUsePermissions.mockReturnValue({
      isLoading: true,
      hasPermission: () => false,
      hasAllPermissions: () => false,
      hasAnyPermission: () => false,
    } as never);

    render(<IfHasPermission permission="manage_users"><button>Manage Users</button></IfHasPermission>);

    expect(screen.queryByText("Manage Users")).not.toBeInTheDocument();
  });
});
