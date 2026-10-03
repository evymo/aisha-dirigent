/**
 * Tests for permission helper functions
 *
 * Pure function tests - no mocking needed.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  hasPermission,
  hasAllPermissions,
  hasAnyPermission,
  derivePermissionsFromRoles,
  parsePermissionsResponse,
  uniq,
  ALL_APP_PERMISSIONS,
  ROLE_TO_PERMISSIONS,
} from "@/lib/permissions/permissionHelpers";

// ─────────────────────────────────────────────────────────────────────────────
// uniq
// ─────────────────────────────────────────────────────────────────────────────

describe("uniq", () => {
  it("removes duplicates from array", () => {
    expect(uniq(["a", "b", "a", "c", "b"])).toEqual(["a", "b", "c"]);
  });

  it("returns empty array for empty input", () => {
    expect(uniq([])).toEqual([]);
  });

  it("returns same array if no duplicates", () => {
    expect(uniq(["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// hasPermission
// ─────────────────────────────────────────────────────────────────────────────

describe("hasPermission", () => {
  it("returns true when permission exists", () => {
    const permissions = ["view_studies", "enroll_studies"];
    expect(hasPermission(permissions, "view_studies")).toBe(true);
  });

  it("returns false when permission does not exist", () => {
    const permissions = ["view_studies"];
    expect(hasPermission(permissions, "view_sensitive_data")).toBe(false);
  });

  it("returns false for empty permissions", () => {
    expect(hasPermission([], "view_studies")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// hasAllPermissions
// ─────────────────────────────────────────────────────────────────────────────

describe("hasAllPermissions", () => {
  const permissions = ["view_studies", "enroll_studies", "submit_checkins"];

  it("returns true when all permissions exist", () => {
    expect(hasAllPermissions(permissions, "view_studies", "enroll_studies")).toBe(true);
  });

  it("returns false when any permission is missing", () => {
    expect(hasAllPermissions(permissions, "view_studies", "view_sensitive_data")).toBe(false);
  });

  it("returns true for empty codes array", () => {
    expect(hasAllPermissions(permissions)).toBe(true);
  });

  it("returns true for single existing permission", () => {
    expect(hasAllPermissions(permissions, "view_studies")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// hasAnyPermission
// ─────────────────────────────────────────────────────────────────────────────

describe("hasAnyPermission", () => {
  const permissions = ["view_studies", "enroll_studies"];

  it("returns true when any permission exists", () => {
    expect(hasAnyPermission(permissions, "view_sensitive_data", "view_studies")).toBe(true);
  });

  it("returns false when no permissions exist", () => {
    expect(hasAnyPermission(permissions, "view_sensitive_data", "edit_sensitive_data")).toBe(false);
  });

  it("returns false for empty codes array", () => {
    expect(hasAnyPermission(permissions)).toBe(false);
  });

  it("returns false for empty permissions array", () => {
    expect(hasAnyPermission([], "view_studies")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// derivePermissionsFromRoles
// ─────────────────────────────────────────────────────────────────────────────

describe("derivePermissionsFromRoles", () => {
  it("returns all permissions for admin", () => {
    const result = derivePermissionsFromRoles(["admin"], true);
    expect(result).toEqual(ALL_APP_PERMISSIONS);
  });

  it("returns member permissions for member role", () => {
    const result = derivePermissionsFromRoles(["member"], false);
    expect(result).toEqual(ROLE_TO_PERMISSIONS.member);
  });

  it("returns staff permissions for staff role", () => {
    const result = derivePermissionsFromRoles(["staff"], false);
    expect(result).toEqual(ROLE_TO_PERMISSIONS.staff);
  });

  it("merges permissions for multiple roles", () => {
    const result = derivePermissionsFromRoles(["member", "staff"], false);
    
    // Should have both member and staff permissions
    expect(result).toContain("view_studies"); // member
    expect(result).toContain("view_staff_dashboard"); // staff
  });

  it("removes duplicates when roles have overlapping permissions", () => {
    // Both practitioner and partner have view_partner_dashboard
    const result = derivePermissionsFromRoles(["partner", "practitioner"], false);
    const count = result.filter(p => p === "view_partner_dashboard").length;
    expect(count).toBe(1);
  });

  it("returns empty array for unknown role", () => {
    const result = derivePermissionsFromRoles(["unknown_role"], false);
    expect(result).toEqual([]);
  });

  it("returns empty array for empty roles", () => {
    const result = derivePermissionsFromRoles([], false);
    expect(result).toEqual([]);
  });

  it("isAdmin=true overrides role-based permissions", () => {
    // Even with just member role, admin flag gives all permissions
    const result = derivePermissionsFromRoles(["member"], true);
    expect(result).toEqual(ALL_APP_PERMISSIONS);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parsePermissionsResponse
// ─────────────────────────────────────────────────────────────────────────────

describe("parsePermissionsResponse", () => {
  it("parses array of objects with permission_code", () => {
    const data = [
      { permission_code: "view_studies" },
      { permission_code: "enroll_studies" },
    ];
    expect(parsePermissionsResponse(data)).toEqual(["view_studies", "enroll_studies"]);
  });

  it("parses array of strings", () => {
    const data = ["view_studies", "enroll_studies"];
    expect(parsePermissionsResponse(data)).toEqual(["view_studies", "enroll_studies"]);
  });

  it("removes duplicates", () => {
    const data = [
      { permission_code: "view_studies" },
      { permission_code: "view_studies" },
    ];
    expect(parsePermissionsResponse(data)).toEqual(["view_studies"]);
  });

  it("returns empty array for null", () => {
    expect(parsePermissionsResponse(null)).toEqual([]);
  });

  it("returns empty array for undefined", () => {
    expect(parsePermissionsResponse(undefined)).toEqual([]);
  });

  it("returns empty array for invalid format", () => {
    expect(parsePermissionsResponse({ invalid: "format" })).toEqual([]);
  });

  it("returns empty array for mixed array", () => {
    expect(parsePermissionsResponse(["string", 123, null])).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ROLE_TO_PERMISSIONS mappings
// ─────────────────────────────────────────────────────────────────────────────

describe("ROLE_TO_PERMISSIONS", () => {
  it("admin has all permissions", () => {
    expect(ROLE_TO_PERMISSIONS.admin).toEqual(ALL_APP_PERMISSIONS);
  });

  it("member can view and enroll in studies", () => {
    expect(ROLE_TO_PERMISSIONS.member).toContain("view_studies");
    expect(ROLE_TO_PERMISSIONS.member).toContain("enroll_studies");
  });

  it("member cannot view admin dashboard", () => {
    expect(ROLE_TO_PERMISSIONS.member).not.toContain("view_admin_dashboard");
  });

  it("staff can process orders", () => {
    expect(ROLE_TO_PERMISSIONS.staff).toContain("process_orders");
  });

  it("practitioner has operational permissions", () => {
    expect(ROLE_TO_PERMISSIONS.practitioner).toContain("view_operational_details");
    expect(ROLE_TO_PERMISSIONS.practitioner).toContain("create_operational_notes");
  });

  it("partner (amateur) does not have operational permissions", () => {
    expect(ROLE_TO_PERMISSIONS.partner).not.toContain("view_operational_details");
    expect(ROLE_TO_PERMISSIONS.partner).toContain("view_basic_health_summary");
  });

  it("evaluator has assessment permissions", () => {
    expect(ROLE_TO_PERMISSIONS.evaluator).toContain("evaluate_health_data");
    expect(ROLE_TO_PERMISSIONS.evaluator).toContain("create_assessments");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Security invariants
// ─────────────────────────────────────────────────────────────────────────────

describe("Security invariants", () => {
  it("only admin has manage_roles permission", () => {
    const rolesWithManageRoles = Object.entries(ROLE_TO_PERMISSIONS)
      .filter(([_, perms]) => perms.includes("manage_roles"))
      .map(([role]) => role);
    
    expect(rolesWithManageRoles).toEqual(["admin"]);
  });

  it("only admin has manage_permissions permission", () => {
    const rolesWithManagePermissions = Object.entries(ROLE_TO_PERMISSIONS)
      .filter(([_, perms]) => perms.includes("manage_permissions"))
      .map(([role]) => role);
    
    expect(rolesWithManagePermissions).toEqual(["admin"]);
  });

  it("only admin and practitioner have prescribe_protocols permission", () => {
    const rolesWithPrescribe = Object.entries(ROLE_TO_PERMISSIONS)
      .filter(([_, perms]) => perms.includes("prescribe_protocols"))
      .map(([role]) => role);
    
    expect(rolesWithPrescribe).toEqual(["admin", "practitioner"]);
  });

  it("member does not have any admin permissions", () => {
    const adminPerms = [
      "view_admin_dashboard",
      "manage_users",
      "manage_roles",
      "manage_permissions",
    ];
    
    for (const perm of adminPerms) {
      expect(ROLE_TO_PERMISSIONS.member).not.toContain(perm);
    }
  });
});
