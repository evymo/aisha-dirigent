import React from "react";
import { RequirePermission } from "./RequirePermission";
import type { PermissionCode } from "@/hooks/usePermissions";

/**
 * Higher-order component for permission-based access.
 * 
 * @example
 * ```tsx
 * const ProtectedComponent = withPermission(MyComponent, "manage_orders");
 * ```
 */
export function withPermission<P extends object>(
  Component: React.ComponentType<P>,
  permission: PermissionCode | PermissionCode[],
  options?: {
    requireAll?: boolean;
    fallback?: React.ComponentType;
  }
) {
  return function PermissionGuardedComponent(props: P) {
    const FallbackComponent = options?.fallback;
    
    return (
      <RequirePermission
        permission={permission}
        requireAll={options?.requireAll}
        fallback={FallbackComponent ? <FallbackComponent /> : undefined}
      >
        <Component {...props} />
      </RequirePermission>
    );
  };
}
