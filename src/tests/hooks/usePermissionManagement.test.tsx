import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode } from 'react';
import { usePermissionManagement, RolePermissionMapping } from '@/hooks/usePermissions';

vi.mock("@/hooks/usePermissions", () => ({
  usePermissionManagement: vi.fn(),
  RolePermissionMapping: undefined,
}));

// Mock data matching RolePermissionMapping interface
const mockPermissions = [
  { id: 'p1', code: 'view_sensitive_data', name: 'View Sensitive Data', description: 'Access sensitive data', category: 'secure', is_system: true },
  { id: 'p2', code: 'edit_sensitive_data', name: 'Edit Sensitive Data', description: 'Edit sensitive data data', category: 'secure', is_system: true },
  { id: 'p3', code: 'view_studies', name: 'View Studies', description: 'Access studies', category: 'studies', is_system: true },
  { id: 'p4', code: 'manage_users', name: 'Manage Users', description: 'User management', category: 'admin', is_system: true },
];

const mockRolePermissions: RolePermissionMapping[] = [
  { id: 'rp1', role: 'member', permission_code: 'view_sensitive_data', permission_name: 'View Sensitive Data', category: 'secure', granted_at: '2024-01-01T00:00:00Z', granted_by: 'admin-user' },
  { id: 'rp2', role: 'member', permission_code: 'view_studies', permission_name: 'View Studies', category: 'studies', granted_at: '2024-01-01T00:00:00Z', granted_by: 'admin-user' },
  { id: 'rp3', role: 'admin', permission_code: 'manage_users', permission_name: 'Manage Users', category: 'admin', granted_at: '2024-01-01T00:00:00Z', granted_by: null },
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

describe('usePermissionManagement', () => {
  const mockTogglePermission = vi.fn().mockResolvedValue({});

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('data fetching', () => {
    it('should return all permissions and role mappings when loaded', async () => {
      vi.mocked(usePermissionManagement).mockReturnValue({
        allPermissions: mockPermissions,
        rolePermissions: mockRolePermissions,
        isLoading: false,
        roleHasPermission: (role: string, code: string) => 
          mockRolePermissions.some(rp => rp.role === role && rp.permission_code === code),
        getPermissionsForRole: (role: string) => 
          mockRolePermissions.filter(rp => rp.role === role),
        togglePermission: mockTogglePermission,
      });

      const { result } = renderHook(() => usePermissionManagement(), { 
        wrapper: createWrapper() 
      });

      expect(result.current.allPermissions).toHaveLength(4);
      expect(result.current.allPermissions.map(p => p.code)).toContain('view_sensitive_data');
      expect(result.current.allPermissions.map(p => p.code)).toContain('manage_users');
    });

    it('should map role permissions correctly', async () => {
      vi.mocked(usePermissionManagement).mockReturnValue({
        allPermissions: mockPermissions,
        rolePermissions: mockRolePermissions,
        isLoading: false,
        roleHasPermission: (role: string, code: string) => 
          mockRolePermissions.some(rp => rp.role === role && rp.permission_code === code),
        getPermissionsForRole: (role: string) => 
          mockRolePermissions.filter(rp => rp.role === role),
        togglePermission: mockTogglePermission,
      });

      const { result } = renderHook(() => usePermissionManagement(), { 
        wrapper: createWrapper() 
      });

      expect(result.current.rolePermissions).toHaveLength(3);
      expect(result.current.rolePermissions[0].permission_code).toBe('view_sensitive_data');
      expect(result.current.rolePermissions[0].role).toBe('member');
    });
  });

  describe('roleHasPermission', () => {
    it('should return true when role has permission', async () => {
      vi.mocked(usePermissionManagement).mockReturnValue({
        allPermissions: mockPermissions,
        rolePermissions: mockRolePermissions,
        isLoading: false,
        roleHasPermission: (role: string, code: string) => 
          mockRolePermissions.some(rp => rp.role === role && rp.permission_code === code),
        getPermissionsForRole: (role: string) => 
          mockRolePermissions.filter(rp => rp.role === role),
        togglePermission: mockTogglePermission,
      });

      const { result } = renderHook(() => usePermissionManagement(), { 
        wrapper: createWrapper() 
      });

      expect(result.current.roleHasPermission('member', 'view_sensitive_data')).toBe(true);
      expect(result.current.roleHasPermission('member', 'view_studies')).toBe(true);
    });

    it('should return false when role does not have permission', async () => {
      vi.mocked(usePermissionManagement).mockReturnValue({
        allPermissions: mockPermissions,
        rolePermissions: mockRolePermissions,
        isLoading: false,
        roleHasPermission: (role: string, code: string) => 
          mockRolePermissions.some(rp => rp.role === role && rp.permission_code === code),
        getPermissionsForRole: (role: string) => 
          mockRolePermissions.filter(rp => rp.role === role),
        togglePermission: mockTogglePermission,
      });

      const { result } = renderHook(() => usePermissionManagement(), { 
        wrapper: createWrapper() 
      });

      expect(result.current.roleHasPermission('member', 'manage_users')).toBe(false);
      expect(result.current.roleHasPermission('staff', 'view_sensitive_data')).toBe(false);
    });
  });

  describe('getPermissionsForRole', () => {
    it('should return all permissions for a specific role', async () => {
      vi.mocked(usePermissionManagement).mockReturnValue({
        allPermissions: mockPermissions,
        rolePermissions: mockRolePermissions,
        isLoading: false,
        roleHasPermission: (role: string, code: string) => 
          mockRolePermissions.some(rp => rp.role === role && rp.permission_code === code),
        getPermissionsForRole: (role: string) => 
          mockRolePermissions.filter(rp => rp.role === role),
        togglePermission: mockTogglePermission,
      });

      const { result } = renderHook(() => usePermissionManagement(), { 
        wrapper: createWrapper() 
      });

      const memberPermissions = result.current.getPermissionsForRole('member');
      expect(memberPermissions).toHaveLength(2);
      expect(memberPermissions.map(p => p.permission_code)).toContain('view_sensitive_data');
      expect(memberPermissions.map(p => p.permission_code)).toContain('view_studies');
    });

    it('should return empty array for role without permissions', async () => {
      vi.mocked(usePermissionManagement).mockReturnValue({
        allPermissions: mockPermissions,
        rolePermissions: mockRolePermissions,
        isLoading: false,
        roleHasPermission: (role: string, code: string) => 
          mockRolePermissions.some(rp => rp.role === role && rp.permission_code === code),
        getPermissionsForRole: (role: string) => 
          mockRolePermissions.filter(rp => rp.role === role),
        togglePermission: mockTogglePermission,
      });

      const { result } = renderHook(() => usePermissionManagement(), { 
        wrapper: createWrapper() 
      });

      const staffPermissions = result.current.getPermissionsForRole('staff');
      expect(staffPermissions).toHaveLength(0);
    });
  });

  describe('togglePermission', () => {
    it('should call togglePermission function correctly', async () => {
      const mockToggle = vi.fn().mockResolvedValue({ error: undefined });
      
      vi.mocked(usePermissionManagement).mockReturnValue({
        allPermissions: mockPermissions,
        rolePermissions: mockRolePermissions,
        isLoading: false,
        roleHasPermission: (role: string, code: string) => 
          mockRolePermissions.some(rp => rp.role === role && rp.permission_code === code),
        getPermissionsForRole: (role: string) => 
          mockRolePermissions.filter(rp => rp.role === role),
        togglePermission: mockToggle,
      });

      const { result } = renderHook(() => usePermissionManagement(), { 
        wrapper: createWrapper() 
      });

      await act(async () => {
        await result.current.togglePermission('member', 'edit_sensitive_data');
      });

      expect(mockToggle).toHaveBeenCalledWith('member', 'edit_sensitive_data');
    });

    it('should return error when permission operation fails', async () => {
      const mockToggle = vi.fn().mockResolvedValue({ error: 'Permission not found' });
      
      vi.mocked(usePermissionManagement).mockReturnValue({
        allPermissions: mockPermissions,
        rolePermissions: mockRolePermissions,
        isLoading: false,
        roleHasPermission: () => false,
        getPermissionsForRole: () => [],
        togglePermission: mockToggle,
      });

      const { result } = renderHook(() => usePermissionManagement(), { 
        wrapper: createWrapper() 
      });

      await act(async () => {
        const response = await result.current.togglePermission('member', 'non_existent');
        expect(response.error).toBe('Permission not found');
      });
    });
  });

  describe('loading states', () => {
    it('should show loading while fetching data', async () => {
      vi.mocked(usePermissionManagement).mockReturnValue({
        allPermissions: [],
        rolePermissions: [],
        isLoading: true,
        roleHasPermission: () => false,
        getPermissionsForRole: () => [],
        togglePermission: vi.fn().mockResolvedValue({}),
      });

      const { result } = renderHook(() => usePermissionManagement(), { 
        wrapper: createWrapper() 
      });

      expect(result.current.isLoading).toBe(true);
    });

    it('should show not loading when data is fetched', async () => {
      vi.mocked(usePermissionManagement).mockReturnValue({
        allPermissions: mockPermissions,
        rolePermissions: mockRolePermissions,
        isLoading: false,
        roleHasPermission: () => false,
        getPermissionsForRole: () => [],
        togglePermission: vi.fn().mockResolvedValue({}),
      });

      const { result } = renderHook(() => usePermissionManagement(), { 
        wrapper: createWrapper() 
      });

      expect(result.current.isLoading).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should have empty arrays when no data available', async () => {
      vi.mocked(usePermissionManagement).mockReturnValue({
        allPermissions: [],
        rolePermissions: [],
        isLoading: false,
        roleHasPermission: () => false,
        getPermissionsForRole: () => [],
        togglePermission: vi.fn().mockResolvedValue({}),
      });

      const { result } = renderHook(() => usePermissionManagement(), { 
        wrapper: createWrapper() 
      });

      expect(result.current.allPermissions).toEqual([]);
      expect(result.current.rolePermissions).toEqual([]);
    });
  });
});

describe('Permission system integration', () => {
  it('should provide consistent permission checking', async () => {
    vi.mocked(usePermissionManagement).mockReturnValue({
      allPermissions: mockPermissions,
      rolePermissions: mockRolePermissions,
      isLoading: false,
      roleHasPermission: (role: string, code: string) => 
        mockRolePermissions.some(rp => rp.role === role && rp.permission_code === code),
      getPermissionsForRole: (role: string) => 
        mockRolePermissions.filter(rp => rp.role === role),
      togglePermission: vi.fn().mockResolvedValue({}),
    });

    const { result } = renderHook(() => usePermissionManagement(), { 
      wrapper: createWrapper() 
    });

    // Check that roleHasPermission and getPermissionsForRole are consistent
    const memberPermissions = result.current.getPermissionsForRole('member');
    for (const perm of memberPermissions) {
      expect(result.current.roleHasPermission('member', perm.permission_code)).toBe(true);
    }
  });

  it('should distinguish permissions between roles', async () => {
    vi.mocked(usePermissionManagement).mockReturnValue({
      allPermissions: mockPermissions,
      rolePermissions: mockRolePermissions,
      isLoading: false,
      roleHasPermission: (role: string, code: string) => 
        mockRolePermissions.some(rp => rp.role === role && rp.permission_code === code),
      getPermissionsForRole: (role: string) => 
        mockRolePermissions.filter(rp => rp.role === role),
      togglePermission: vi.fn().mockResolvedValue({}),
    });

    const { result } = renderHook(() => usePermissionManagement(), { 
      wrapper: createWrapper() 
    });

    // Admin has manage_users, member does not
    expect(result.current.roleHasPermission('admin', 'manage_users')).toBe(true);
    expect(result.current.roleHasPermission('member', 'manage_users')).toBe(false);
  });
});