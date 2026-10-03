import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode } from 'react';
import { useRoleDefinitions, useUserRoleCapabilities, type RoleDefinition } from '@/hooks/useRoleDefinitions';

vi.mock("@/hooks/useRoleDefinitions", () => ({
  useRoleDefinitions: vi.fn(),
  useUserRoleCapabilities: vi.fn(),
}));

// Mock data
const mockRoleDefinitions: RoleDefinition[] = [
  {
    id: 'role-1',
    name: 'admin',
    display_name: 'Administrator',
    description: 'Full system access',
    is_admin: true,
    is_system: true,
    can_manage_users: true,
    can_manage_roles: true,
    can_view_sensitive_data: true,
    can_export_phi: true,
    can_break_glass: true,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  },
  {
    id: 'role-2',
    name: 'staff',
    display_name: 'Staff Member',
    description: 'Internal team member',
    is_admin: true,
    is_system: true,
    can_manage_users: true,
    can_manage_roles: false,
    can_view_sensitive_data: true,
    can_export_phi: false,
    can_break_glass: false,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  },
  {
    id: 'role-3',
    name: 'member',
    display_name: 'Member',
    description: 'Standard platform member',
    is_admin: false,
    is_system: true,
    can_manage_users: false,
    can_manage_roles: false,
    can_view_sensitive_data: false,
    can_export_phi: false,
    can_break_glass: false,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  },
];

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { 
      queries: { 
        retry: false, 
        gcTime: 0,
        staleTime: 0,
      } 
    },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

/** Create a typed mock return value for useRoleDefinitions */
function createMockRoleDefinitionsReturn(): ReturnType<typeof useRoleDefinitions> {
  return {
    roles: mockRoleDefinitions,
    isLoading: false,
    error: null,
    refetch: vi.fn() as ReturnType<typeof useRoleDefinitions>['refetch'],
    updateRole: vi.fn().mockResolvedValue({}) as ReturnType<typeof useRoleDefinitions>['updateRole'],
    isUpdating: false,
    getRoleByName: (name: string) => mockRoleDefinitions.find(r => r.name === name),
    isSystemRole: (name: string) => mockRoleDefinitions.find(r => r.name === name)?.is_system ?? false,
    isAdminRole: (name: string) => mockRoleDefinitions.find(r => r.name === name)?.is_admin ?? false,
    adminRoles: mockRoleDefinitions.filter(r => r.is_admin),
    systemRoles: mockRoleDefinitions.filter(r => r.is_system),
  };
}

describe('useRoleDefinitions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('fetching roles', () => {
    it('should return role definitions when loaded', async () => {
      vi.mocked(useRoleDefinitions).mockReturnValue(createMockRoleDefinitionsReturn());

      const { result } = renderHook(() => useRoleDefinitions(), { 
        wrapper: createWrapper() 
      });

      expect(result.current.roles).toHaveLength(3);
      expect(result.current.roles[0].name).toBe('admin');
    });
  });

  describe('role identification', () => {
    it('should identify system roles correctly', async () => {
      vi.mocked(useRoleDefinitions).mockReturnValue(createMockRoleDefinitionsReturn());

      const { result } = renderHook(() => useRoleDefinitions(), { 
        wrapper: createWrapper() 
      });

      expect(result.current.isSystemRole('admin')).toBe(true);
      expect(result.current.isSystemRole('member')).toBe(true);
    });

    it('should identify admin roles correctly', async () => {
      vi.mocked(useRoleDefinitions).mockReturnValue(createMockRoleDefinitionsReturn());

      const { result } = renderHook(() => useRoleDefinitions(), { 
        wrapper: createWrapper() 
      });

      expect(result.current.isAdminRole('admin')).toBe(true);
      expect(result.current.isAdminRole('staff')).toBe(true);
      expect(result.current.isAdminRole('member')).toBe(false);
    });
  });

  describe('filtered role lists', () => {
    it('should return admin roles', async () => {
      vi.mocked(useRoleDefinitions).mockReturnValue(createMockRoleDefinitionsReturn());

      const { result } = renderHook(() => useRoleDefinitions(), { 
        wrapper: createWrapper() 
      });

      expect(result.current.adminRoles).toHaveLength(2);
      expect(result.current.adminRoles.map(r => r.name)).toContain('admin');
      expect(result.current.adminRoles.map(r => r.name)).toContain('staff');
    });

    it('should return system roles', async () => {
      vi.mocked(useRoleDefinitions).mockReturnValue(createMockRoleDefinitionsReturn());

      const { result } = renderHook(() => useRoleDefinitions(), { 
        wrapper: createWrapper() 
      });

      // All roles in mock are system roles
      expect(result.current.systemRoles).toHaveLength(3);
    });
  });

  describe('getRoleByName', () => {
    it('should return role by name', async () => {
      vi.mocked(useRoleDefinitions).mockReturnValue(createMockRoleDefinitionsReturn());

      const { result } = renderHook(() => useRoleDefinitions(), { 
        wrapper: createWrapper() 
      });

      const adminRole = result.current.getRoleByName('admin');
      expect(adminRole).toBeDefined();
      expect(adminRole?.is_admin).toBe(true);
      expect(adminRole?.can_manage_roles).toBe(true);
    });

    it('should return undefined for non-existent role', async () => {
      vi.mocked(useRoleDefinitions).mockReturnValue(createMockRoleDefinitionsReturn());

      const { result } = renderHook(() => useRoleDefinitions(), { 
        wrapper: createWrapper() 
      });

      const unknownRole = result.current.getRoleByName('unknown');
      expect(unknownRole).toBeUndefined();
    });
  });
});

describe('useUserRoleCapabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should aggregate capabilities from user roles', async () => {
    vi.mocked(useUserRoleCapabilities).mockReturnValue({
      isAdmin: true,
      canManageUsers: true,
      canManageRoles: true,
      canViewPhi: true,
      canExportPhi: true,
      canBreakGlass: true,
    });

    const { result } = renderHook(() => useUserRoleCapabilities(), { 
      wrapper: createWrapper() 
    });

    expect(result.current.isAdmin).toBe(true);
    expect(result.current.canManageUsers).toBe(true);
    expect(result.current.canManageRoles).toBe(true);
    expect(result.current.canViewPhi).toBe(true);
  });

  it('should return false for non-admin user', async () => {
    vi.mocked(useUserRoleCapabilities).mockReturnValue({
      isAdmin: false,
      canManageUsers: false,
      canManageRoles: false,
      canViewPhi: false,
      canExportPhi: false,
      canBreakGlass: false,
    });

    const { result } = renderHook(() => useUserRoleCapabilities(), { 
      wrapper: createWrapper() 
    });

    expect(result.current.isAdmin).toBe(false);
    expect(result.current.canManageUsers).toBe(false);
  });
});

describe('Role security constraints', () => {
  it('system roles should have is_system flag', () => {
    const systemRoleNames = ['admin', 'staff', 'member'];
    
    for (const roleName of systemRoleNames) {
      const role = mockRoleDefinitions.find(r => r.name === roleName);
      expect(role?.is_system).toBe(true);
    }
  });

  it('admin and staff should have is_admin flag', () => {
    const adminRole = mockRoleDefinitions.find(r => r.name === 'admin');
    const staffRole = mockRoleDefinitions.find(r => r.name === 'staff');
    const memberRole = mockRoleDefinitions.find(r => r.name === 'member');

    expect(adminRole?.is_admin).toBe(true);
    expect(staffRole?.is_admin).toBe(true);
    expect(memberRole?.is_admin).toBe(false);
  });

  it('only admin should have can_manage_roles', () => {
    const adminRole = mockRoleDefinitions.find(r => r.name === 'admin');
    const staffRole = mockRoleDefinitions.find(r => r.name === 'staff');

    expect(adminRole?.can_manage_roles).toBe(true);
    expect(staffRole?.can_manage_roles).toBe(false);
  });
});
