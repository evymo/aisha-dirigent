import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/tests/utils/test-utils';

const { usePermissionsMock, sidebarStateBox } = vi.hoisted(() => ({
  usePermissionsMock: vi.fn(),
  sidebarStateBox: { state: 'expanded' as 'expanded' | 'collapsed' },
}));

vi.mock('@/hooks/usePermissions', () => ({ usePermissions: () => usePermissionsMock() }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('lucide-react', () => {
  const Icon = () => <span />;
  return {
    __esModule: true,
    LayoutDashboard: Icon,
    Users: Icon,
    FlaskConical: Icon,
    Activity: Icon,
    Workflow: Icon,
    Shield: Icon,
    ArrowLeft: Icon,
    FileQuestion: Icon,
    Beaker: Icon,
    Handshake: Icon,
    Package: Icon,
    Presentation: Icon,
    ClipboardList: Icon,
    Archive: Icon,
    CreditCard: Icon,
    DollarSign: Icon,
    UserCheck: Icon,
    ChevronDown: Icon,
    ChevronRight: Icon,
    Languages: Icon,
    ShoppingBag: Icon,
    TestTube: Icon,
    Coins: Icon,
    Factory: Icon,
    BookOpen: Icon,
    Monitor: Icon,
    Ticket: Icon,
    Banknote: Icon,
    Truck: Icon,
    CalendarClock: Icon,
    Pill: Icon,
    BarChart3: Icon,
    Bot: Icon,
    Bell: Icon,
    Star: Icon,
    MessageSquare: Icon,
    Newspaper: Icon,
    Settings: Icon,
    UserX: Icon,
    Key: Icon,
    Layers: Icon,
    Cpu: Icon,
    Wrench: Icon,
    Zap: Icon,
    Database: Icon,
    BrainCircuit: Icon,
    FileText: Icon,
    TabletSmartphone: Icon,
    Link2: Icon,
  };
});

vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/collapsible', () => ({
  Collapsible: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CollapsibleTrigger: ({ children, ...props }: { children: React.ReactNode }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  CollapsibleContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/sidebar', () => ({
  Sidebar: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="sidebar" data-class={className || ''}>
      {children}
    </div>
  ),
  SidebarContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarGroupContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarGroupLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarMenuButton: ({ children, isActive, className }: { children: React.ReactNode; isActive?: boolean; className?: string }) => (
    <div data-active={String(!!isActive)} className={className}>
      {children}
    </div>
  ),
  SidebarTrigger: () => <button aria-label="toggle-sidebar" type="button" />,
  useSidebar: () => ({ state: sidebarStateBox.state }),
}));

import { AdminSidebar } from '@/components/admin/AdminSidebar';

describe('AdminSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sidebarStateBox.state = 'expanded';
  });

  it('v expanded režimu renderuje texty a skryje adminOnly pro ne-admin', () => {
    usePermissionsMock.mockReturnValue({ 
      hasPermission: vi.fn(() => false),
      hasAnyPermission: vi.fn(() => false),
      permissions: [],
      isLoading: false,
    });

    render(<AdminSidebar />, { initialEntries: ['/admin'] });

    expect(screen.getByText('admin.sidebar.title')).toBeInTheDocument();
    expect(screen.getByText('admin.sidebar.items.members')).toBeInTheDocument();
    expect(screen.queryByText('admin.sidebar.items.roleManagement')).not.toBeInTheDocument();
    expect(screen.queryByText('admin.sidebar.items.permissions')).not.toBeInTheDocument();
  });

  it('pro admina zobrazí adminOnly položky', () => {
    usePermissionsMock.mockReturnValue({ 
      hasPermission: vi.fn((p: string) => p === 'manage_permissions' || p === 'manage_roles'),
      hasAnyPermission: vi.fn(() => true),
      permissions: ['manage_permissions', 'manage_roles'],
      isLoading: false,
    });
    render(<AdminSidebar />, { initialEntries: ['/admin'] });
    expect(screen.getByText('admin.sidebar.items.roleManagement')).toBeInTheDocument();
    expect(screen.getByText('admin.sidebar.items.permissions')).toBeInTheDocument();
  });

  it('uživatel s manage_roles vidí správu rolí i bez manage_permissions', () => {
    usePermissionsMock.mockReturnValue({
      hasPermission: vi.fn((p: string) => p === 'manage_roles'),
      hasAnyPermission: vi.fn(() => true),
      permissions: ['manage_roles'],
      isLoading: false,
    });

    render(<AdminSidebar />, { initialEntries: ['/admin'] });

    expect(screen.getByText('admin.sidebar.items.roleManagement')).toBeInTheDocument();
    expect(screen.queryByText('admin.sidebar.items.permissions')).not.toBeInTheDocument();
  });

  it('v collapsed režimu skryje texty, ale zachová navigaci', () => {
    sidebarStateBox.state = 'collapsed';
    usePermissionsMock.mockReturnValue({ 
      hasPermission: vi.fn((p: string) => p === 'manage_permissions' || p === 'manage_roles'),
      hasAnyPermission: vi.fn(() => true),
      permissions: ['manage_permissions', 'manage_roles'],
      isLoading: false,
    });

    render(<AdminSidebar />, { initialEntries: ['/admin/roles'] });

    expect(screen.queryByText('admin.sidebar.title')).not.toBeInTheDocument();
    expect(screen.queryByText('admin.sidebar.items.backToSite')).not.toBeInTheDocument();
    expect(screen.getAllByRole('link').length).toBeGreaterThan(0);
  });

  it('označí aktivní cestu (isActive)', () => {
    usePermissionsMock.mockReturnValue({ 
      hasPermission: vi.fn((p: string) => p === 'manage_permissions' || p === 'manage_roles'),
      hasAnyPermission: vi.fn(() => true),
      permissions: ['manage_permissions', 'manage_roles'],
      isLoading: false,
    });
    render(<AdminSidebar />, { initialEntries: ['/admin/roles'] });

    const activeButtons = document.querySelectorAll('[data-active="true"]');
    expect(activeButtons.length).toBeGreaterThan(0);
  });
});
