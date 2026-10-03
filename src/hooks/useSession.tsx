import { createContext, useContext, useMemo } from 'react';
import { useAuth } from './useAuth';
import { APP_ROLES, useUserRole, type AppRole, type UserRole } from './useUserRole';

import type { KcUser, KcSession } from '@/integrations/auth/types';

/**
 * Interface representing the application session state.
 */
export interface AppSession {
  /** The active KC session, or null if not authenticated. */
  session: KcSession | null;
  /** The active KC user, or null if not authenticated. */
  user: KcUser | null;
  /** Full role records associated with the user. */
  roleRecords: UserRole[];
  /** List of role names assigned to the user. */
  roles: string[];
  /**
   * Checks if the user has a specific role.
   * @param role - The role name to check.
   * @returns True if the user has the role, false otherwise.
   */
  hasRole: (role: string) => boolean;
  /** Boolean indicating if the user has the 'admin' role. */
  isAdmin: boolean;
  /** Boolean indicating if session or role data is currently loading. */
  isLoading: boolean;
  /** Function to manually refetch user roles. */
  refetchRoles: () => Promise<void>;
  /** Function to sign out the current user. */
  signOut: () => Promise<void>;
}

const SessionContext = createContext<AppSession | undefined>(undefined);

/**
 * Provider component that wraps the application to provide session context.
 * It combines authentication state from `useAuth` and role data from `useUserRole`.
 *
 * @param props - Component props.
 * @param props.children - Child components.
 */
export const SessionProvider = ({ children }: { children: React.ReactNode }) => {
  const { session, user, loading: isAuthLoading, signOut } = useAuth();
  const {
    roles: roleRecords,
    loading: isRoleLoading,
    hasRole,
    isAdmin,
    refetch,
  } = useUserRole();

  const roles = useMemo(() => roleRecords.map((record) => record.role), [roleRecords]);

  const hasRoleWrapped = useMemo(() => {
    const allowed: ReadonlySet<AppRole> = new Set(APP_ROLES);
    return (role: string) => (allowed.has(role as AppRole) ? hasRole(role as AppRole) : false);
  }, [hasRole]);

  const isLoading = isAuthLoading || isRoleLoading;

  const value = useMemo(
    () => ({
      session,
      user,
      roleRecords,
      roles,
      hasRole: hasRoleWrapped,
      isAdmin,
      isLoading,
      refetchRoles: refetch,
      signOut,
    }),
    [session, user, roleRecords, roles, hasRoleWrapped, isAdmin, isLoading, refetch, signOut]
  );

  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  );
};

/**
 * Hook to access the current session context.
 *
 * @returns The `AppSession` object containing user, session, and role information.
 * @throws Error if used outside of a `SessionProvider`.
 *
 * @example
 * ```tsx
 * const { user, isAdmin } = useSession();
 * if (isAdmin) {
 *   return <AdminDashboard />;
 * }
 * ```
 */
export const useSession = () => {
  const context = useContext(SessionContext);
  if (context === undefined) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return context;
};
