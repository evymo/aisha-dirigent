/**
 * Admin navigation configuration — types, data, and visibility helpers.
 * Extracted from AdminSidebar to avoid react-refresh warnings.
 */
import {
  LayoutDashboard,
  Users,
  FlaskConical,
  Activity,
  Shield,
  FileQuestion,
  Beaker,
  Handshake,
  Package,
  ClipboardList,
  Archive,
  CreditCard,
  DollarSign,
  UserCheck,
  Languages,
  ShoppingBag,
  TestTube,
  Coins,
  Factory,
  BookOpen,
  Monitor,
  Ticket,
  Banknote,
  Truck,
  CalendarClock,
  Pill,
  BarChart3,
  Presentation,
  Bell,
  Star,
  MessageSquare,
  Settings,
  UserX,
  Newspaper,
  Key,
  Layers,
  Zap,
  Database,
  BrainCircuit,
  Cpu,
  FileText,
  Workflow,
  TabletSmartphone,
  Link2,
} from "lucide-react";

import type React from "react";

/** Single navigation item in admin sidebar */
export interface AdminNavItem {
  titleKey: string;
  labelKey?: string;
  url: string;
  icon: React.ElementType;
  adminOnly?: boolean;
  requiredPermission?: string;
}

/** Group of navigation items */
export interface AdminNavGroup {
  titleKey: string;
  items: AdminNavItem[];
}

/** Full admin navigation structure */
export const adminNavGroups: AdminNavGroup[] = [
  {
    titleKey: "overview",
    items: [
      { titleKey: "overview", url: "/admin", icon: LayoutDashboard },
      { titleKey: "missionControl", labelKey: "missionControl.pageTitle", url: "/admin/mission-control", icon: LayoutDashboard, adminOnly: true },
      { titleKey: "missionControlKanban", labelKey: "kanban.pageTitle", url: "/admin/mission-control/kanban", icon: Layers, adminOnly: true },
      { titleKey: "storyloop", labelKey: "storyloop.title", url: "/admin/storyloop", icon: MessageSquare },
      { titleKey: "publicChat", url: "/admin/public-chat", icon: MessageSquare, adminOnly: true },
      { titleKey: "contextProfiles", url: "/admin/context-profiles", icon: Layers, adminOnly: true },
      { titleKey: "aiRuns", url: "/admin/ai-runs", icon: Activity, adminOnly: true },
      { titleKey: "flowboard", url: "/admin/flowboard", icon: Workflow, adminOnly: true },
      { titleKey: "mcpTokens", url: "/admin/mcp-tokens", icon: Key, adminOnly: true },
      { titleKey: "aiObservability", url: "/admin/ai-observability", icon: BarChart3, adminOnly: true },
      { titleKey: "aiEvaluation", url: "/admin/ai-evaluation", icon: FlaskConical, adminOnly: true },
      { titleKey: "modelRegistry", url: "/admin/model-registry", icon: BrainCircuit, adminOnly: true },
      { titleKey: "runtimeRegistry", url: "/admin/runtime-registry", icon: Cpu, adminOnly: true },
      { titleKey: "aiProactive", url: "/admin/ai-proactive", icon: Zap, adminOnly: true },
      { titleKey: "ragnarokKb", url: "/admin/ragnarok-kb", icon: Database, adminOnly: true },
      { titleKey: "auditJournal", url: "/admin/audit-journal", icon: BookOpen, adminOnly: true },
      { titleKey: "sessionMonitoring", url: "/admin/session-monitoring", icon: Monitor, adminOnly: true },
      { titleKey: "settings", url: "/admin/settings", icon: Settings, adminOnly: true },
    ],
  },
  {
    titleKey: "users",
    items: [
      { titleKey: "members", url: "/admin/members", icon: Users },
      { titleKey: "partners", url: "/admin/partners", icon: Handshake },
      { titleKey: "consultants", url: "/admin/consultants", icon: UserCheck },
      { titleKey: "invitations", url: "/admin/invitations", icon: Ticket },
      { titleKey: "devices", url: "/admin/devices", icon: TabletSmartphone, requiredPermission: "manage_users" },
      { titleKey: "peopleAccounts", url: "/admin/people", icon: Link2, requiredPermission: "manage_users" },
      { titleKey: "roleManagement", url: "/admin/roles", icon: Shield, requiredPermission: "manage_roles" },
      { titleKey: "permissions", url: "/admin/permissions", icon: Shield, requiredPermission: "manage_permissions" },
      { titleKey: "deletionRequests", url: "/admin/deletion-requests", icon: UserX, adminOnly: true },
    ],
  },
  {
    titleKey: "research",
    items: [
      { titleKey: "programStudies", url: "/admin/studies", icon: Beaker },
      { titleKey: "studyConsents", url: "/admin/study-consents", icon: ClipboardList },
      { titleKey: "registrations", url: "/admin/registrations", icon: FlaskConical },
      { titleKey: "contributions", url: "/admin/contributions", icon: DollarSign },
      { titleKey: "healthOutcomes", url: "/admin/outcomes", icon: Activity },
      { titleKey: "production", url: "/admin/production", icon: Factory },
      { titleKey: "distributionProtocols", url: "/admin/distribution-protocols", icon: Pill },
      { titleKey: "distributionForecast", url: "/admin/distribution-forecast", icon: BarChart3 },
    ],
  },
  {
    titleKey: "content",
    items: [
      { titleKey: "products", url: "/admin/products", icon: Package },
      { titleKey: "heroSlides", url: "/admin/hero-slides", icon: Presentation },
      { titleKey: "webPages", url: "/admin/pages", icon: FileText },
      { titleKey: "featuredProducts", url: "/admin/featured-products", icon: Star },
      { titleKey: "archive", url: "/admin/archive", icon: Archive },
      { titleKey: "questionnaires", url: "/admin/questionnaires", icon: ClipboardList },
      { titleKey: "testQuestions", url: "/admin/tests", icon: FileQuestion },
      { titleKey: "biomarkerRanges", url: "/admin/biomarkers", icon: TestTube },
      { titleKey: "notifications", url: "/admin/notifications", icon: Bell },
      { titleKey: "newsArticles", url: "/admin/news-articles", icon: Newspaper },
      { titleKey: "translations", url: "/admin/translations", icon: Languages },
    ],
  },
  {
    titleKey: "payments",
    items: [
      { titleKey: "orders", url: "/admin/orders", icon: ShoppingBag },
      { titleKey: "payments", url: "/admin/payments", icon: Banknote, adminOnly: true },
      { titleKey: "shipments", url: "/admin/shipments", icon: Truck },
      { titleKey: "distribution", url: "/admin/distribution", icon: CalendarClock, adminOnly: true },
      { titleKey: "memberSubscriptions", url: "/admin/member-subscriptions", icon: CreditCard },
      { titleKey: "subscriptions", url: "/admin/subscriptions", icon: CreditCard, adminOnly: true },
      { titleKey: "tokenomics", url: "/admin/tokenomics", icon: Coins, adminOnly: true },
    ],
  },
];

/** Options for filtering visible nav groups */
export interface AdminNavVisibilityOptions {
  canManageAll: boolean;
  hasPermission: (permission: string) => boolean;
}

/** Filter nav groups based on user permissions */
export function getVisibleAdminNavGroups({ canManageAll, hasPermission }: AdminNavVisibilityOptions): AdminNavGroup[] {
  return adminNavGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (item.requiredPermission && !hasPermission(item.requiredPermission)) {
          return false;
        }
        if (item.adminOnly && !canManageAll) {
          return false;
        }
        return true;
      }),
    }))
    .filter((group) => group.items.length > 0);
}
