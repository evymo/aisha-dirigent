import { vi } from "vitest";
import { usePermissions, type UsePermissionsReturn } from "@/hooks/usePermissions";

const basePermissionsState: UsePermissionsReturn = {
  permissions: [],
  isLoading: false,
  error: null,
  hasPermission: () => false,
  hasAllPermissions: () => false,
  hasAnyPermission: () => false,
};

const buildHasPermission = (permissions: string[]) => (code: string) =>
  permissions.includes(code);

const buildHasAllPermissions = (permissions: string[]) => (...codes: string[]) =>
  codes.every((code) => permissions.includes(code));

const buildHasAnyPermission = (permissions: string[]) => (...codes: string[]) =>
  codes.some((code) => permissions.includes(code));

/**
 * Overrides the mocked usePermissions hook with custom values.
 *
 * @param overrides - Partial permissions state to apply to the default mock.
 * @returns The resolved permissions mock state used by tests.
 */
export function mockPermissions(
  overrides: Partial<UsePermissionsReturn> = {}
): UsePermissionsReturn {
  const permissions = overrides.permissions ?? basePermissionsState.permissions;

  const resolved: UsePermissionsReturn = {
    ...basePermissionsState,
    ...overrides,
    permissions,
    hasPermission:
      overrides.hasPermission ?? buildHasPermission(permissions as string[]),
    hasAllPermissions:
      overrides.hasAllPermissions ??
      buildHasAllPermissions(permissions as string[]),
    hasAnyPermission:
      overrides.hasAnyPermission ??
      buildHasAnyPermission(permissions as string[]),
  };

  vi.mocked(usePermissions).mockReturnValue(resolved);
  return resolved;
}

/**
 * Convenience helper for admin-permission test cases.
 *
 * @param overrides - Optional overrides for the base admin permission mock.
 * @returns The resolved permissions mock state used by tests.
 */
export function mockAdminPermissions(
  overrides: Partial<UsePermissionsReturn> = {}
): UsePermissionsReturn {
  return mockPermissions({
    permissions: ["view_admin_dashboard"],
    ...overrides,
  });
}
