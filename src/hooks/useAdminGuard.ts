import { useCallback } from "react";
import { usePermissions } from "./usePermissions";

/**
 * Custom error class for admin permission failures.
 * Thrown when a user without admin permissions attempts to execute an admin mutation.
 */
export class AdminPermissionError extends Error {
  constructor(functionName: string) {
    super(`Admin permission required for ${functionName}`);
    this.name = "AdminPermissionError";
  }
}

/**
 * Hook providing defense-in-depth protection for admin mutations.
 *
 * This hook wraps admin mutation functions with a frontend permission check,
 * preventing unnecessary API calls when the user lacks permissions.
 *
 * @remarks
 * Backend RPC functions already have `is_admin_or_staff()` checks.
 * This frontend guard provides:
 * - UX improvement: faster failure for non-admins
 * - Defense-in-depth: additional security layer
 * - Audit trail: can log denied attempts
 *
 * @example
 * ```typescript
 * const { guardAdminMutation } = useAdminGuard();
 *
 * const mutation = useMutation({
 *   mutationFn: guardAdminMutation("some_rpc_function", async (data) => {
 *     // Call your RPC function here
 *     return data;
 *   }),
 * });
 * ```
 */
export function useAdminGuard() {
  const { hasPermission } = usePermissions();

  /**
   * Wraps a read/query function with admin permission check.
   *
   * @param functionName - Name of the RPC function (for error messages)
   * @param readFn - The read/query function to wrap
   * @returns Wrapped function that checks permissions before executing
   */
  const guardAdminRead = useCallback(
    <TResult>(
      functionName: string,
      readFn: () => Promise<TResult>
    ): (() => Promise<TResult>) => {
      return async (): Promise<TResult> => {
        if (!hasPermission("view_admin_dashboard")) {
          throw new AdminPermissionError(functionName);
        }
        return readFn();
      };
    },
    [hasPermission]
  );

  /**
   * Wraps a mutation function with admin permission check.
   *
   * @param functionName - Name of the RPC function (for error messages)
   * @param mutationFn - The actual mutation function to wrap
   * @returns Wrapped function that checks permissions before executing
   */
  const guardAdminMutation = useCallback(
    <TArgs, TResult>(
      functionName: string,
      mutationFn: (args: TArgs) => Promise<TResult>
    ): ((args: TArgs) => Promise<TResult>) => {
      return async (args: TArgs): Promise<TResult> => {
        if (!hasPermission("view_admin_dashboard")) {
          throw new AdminPermissionError(functionName);
        }
        return mutationFn(args);
      };
    },
    [hasPermission]
  );

  return { guardAdminRead, guardAdminMutation };
}
