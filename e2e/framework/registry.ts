/**
 * E2E Route & Scenario Registry
 *
 * Single source of truth for WHAT the platform exposes.
 * Tests are generated from this data — to add coverage for a new page,
 * just add an entry here.
 *
 * AISHA uses this registry to detect untested routes and propose new tests.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UserRole = 'admin' | 'member' | 'partner' | 'staff' | 'anonymous';

export interface RouteEntry {
  /** Human-readable label (used in test titles). */
  title: string;
  /** URL path relative to baseURL. */
  url: string;
  /** Minimum role required to access this route. */
  role: UserRole;
  /** Grouping tag — used for filtering / reporting. */
  category: RouteCategory;
  /** Optional: extra tags for searching/filtering. */
  tags?: string[];
  /**
   * Expected "proof of life" — at least one must be visible
   * after the page loads.  Accepts CSS selectors.
   * Default: generic heading / main content heuristic.
   */
  contentSelectors?: string[];
  /** Route is known to be slow (AI, external services). */
  slow?: boolean;
  /** Skip this route in auto-generated tests (e.g. WIP pages). */
  skip?: boolean;
  /** Reason for skipping. */
  skipReason?: string;
}

export type RouteCategory =
  | 'public'
  | 'auth'
  | 'admin-overview'
  | 'admin-users'
  | 'admin-research'
  | 'admin-content'
  | 'admin-payments'
  | 'member'
  | 'partner'
  | 'registration'
  | 'legal';

export interface RbacRule {
  /** Route URL to test. */
  url: string;
  /** Role that attempts access. */
  role: UserRole;
  /** Expected outcome. */
  expect: 'allow' | 'redirect-auth' | 'deny';
  /** Where should redirect go (regex). */
  redirectPattern?: RegExp;
}

export interface CrudScenario {
  /** Human label. */
  title: string;
  /** Admin list URL. */
  listUrl: string;
  /** Role to use. */
  role: UserRole;
  /** Category tag. */
  category: RouteCategory;
  /** Does the page have a table? */
  hasTable?: boolean;
  /** Does it have a "create" button? */
  hasCreateButton?: boolean;
  /** Text to search for in create button. */
  createButtonText?: RegExp;
}

// ---------------------------------------------------------------------------
// Route Registry — PUBLIC
// ---------------------------------------------------------------------------

export const PUBLIC_ROUTES: RouteEntry[] = [
  { title: 'Homepage', url: '/', role: 'anonymous', category: 'public' },
  { title: 'Solution', url: '/solution', role: 'anonymous', category: 'public' },
  { title: 'References', url: '/references', role: 'anonymous', category: 'public' },
  { title: 'Archive', url: '/archive', role: 'anonymous', category: 'public' },
  { title: 'History', url: '/history', role: 'anonymous', category: 'public' },
  { title: 'Knowledge', url: '/knowledge', role: 'anonymous', category: 'public' },
  { title: 'Story', url: '/story', role: 'anonymous', category: 'public' },
  { title: 'Shop', url: '/shop', role: 'anonymous', category: 'public' },
  { title: 'Partners Directory', url: '/partners', role: 'anonymous', category: 'public' },
  { title: 'Research', url: '/research', role: 'anonymous', category: 'public' },
  { title: 'FAQ', url: '/faq', role: 'anonymous', category: 'public' },
  { title: 'Guild', url: '/guild', role: 'anonymous', category: 'public' },
  { title: 'Expert Rules', url: '/rules', role: 'anonymous', category: 'public' },
  { title: 'News', url: '/news', role: 'anonymous', category: 'public' },
  { title: 'Studies', url: '/studies', role: 'anonymous', category: 'public' },
];

export const AUTH_ROUTES: RouteEntry[] = [
  { title: 'Auth / Login', url: '/auth', role: 'anonymous', category: 'auth' },
  { title: 'Set Password', url: '/set-password', role: 'anonymous', category: 'auth' },
  { title: 'Change Password', url: '/change-password', role: 'anonymous', category: 'auth' },
];

export const LEGAL_ROUTES: RouteEntry[] = [
  { title: 'Privacy Policy', url: '/privacy-policy', role: 'anonymous', category: 'legal' },
  { title: 'Terms of Service', url: '/terms-of-service', role: 'anonymous', category: 'legal' },
  { title: 'Legal Disclaimer', url: '/legal-disclaimer', role: 'anonymous', category: 'legal' },
];

// ---------------------------------------------------------------------------
// Route Registry — ADMIN
// ---------------------------------------------------------------------------

export const ADMIN_ROUTES: RouteEntry[] = [
  // Overview
  { title: 'Dashboard', url: '/admin', role: 'admin', category: 'admin-overview' },
  { title: 'Mission Control', url: '/admin/mission-control', role: 'admin', category: 'admin-overview' },
  { title: 'Mission Control · Kanban', url: '/admin/mission-control/kanban', role: 'admin', category: 'admin-overview' },
  { title: 'Storyloop', url: '/admin/storyloop', role: 'admin', category: 'admin-overview' },
  { title: 'Public Chat', url: '/admin/public-chat', role: 'admin', category: 'admin-overview' },
  { title: 'Context Profiles', url: '/admin/context-profiles', role: 'admin', category: 'admin-overview' },
  { title: 'AI Runs', url: '/admin/ai-runs', role: 'admin', category: 'admin-overview', slow: true },
  { title: 'Flowboard', url: '/admin/flowboard', role: 'admin', category: 'admin-overview', slow: true },
  { title: 'MCP Tokens', url: '/admin/mcp-tokens', role: 'admin', category: 'admin-overview' },
  { title: 'AI Observability', url: '/admin/ai-observability', role: 'admin', category: 'admin-overview', slow: true },
  { title: 'AI Evaluation', url: '/admin/ai-evaluation', role: 'admin', category: 'admin-overview', slow: true },
  { title: 'Model Registry', url: '/admin/model-registry', role: 'admin', category: 'admin-overview', slow: true },
  { title: 'Runtime Registry', url: '/admin/runtime-registry', role: 'admin', category: 'admin-overview', slow: true },
  { title: 'AI Proactive', url: '/admin/ai-proactive', role: 'admin', category: 'admin-overview' },
  { title: 'Ragnarok KB', url: '/admin/ragnarok-kb', role: 'admin', category: 'admin-overview', slow: true },
  { title: 'Audit Journal', url: '/admin/audit-journal', role: 'admin', category: 'admin-overview' },
  { title: 'Session Monitoring', url: '/admin/session-monitoring', role: 'admin', category: 'admin-overview', slow: true },
  { title: 'Settings', url: '/admin/settings', role: 'admin', category: 'admin-overview' },

  // Users
  { title: 'Members', url: '/admin/members', role: 'admin', category: 'admin-users' },
  { title: 'Partners', url: '/admin/partners', role: 'admin', category: 'admin-users' },
  { title: 'Consultants', url: '/admin/consultants', role: 'admin', category: 'admin-users' },
  { title: 'Invitations', url: '/admin/invitations', role: 'admin', category: 'admin-users' },
  { title: 'Devices', url: '/admin/devices', role: 'admin', category: 'admin-users' },
  { title: 'People and accounts', url: '/admin/people', role: 'admin', category: 'admin-users' },
  { title: 'Roles', url: '/admin/roles', role: 'admin', category: 'admin-users' },
  { title: 'Permissions', url: '/admin/permissions', role: 'admin', category: 'admin-users' },
  { title: 'Deletion Requests', url: '/admin/deletion-requests', role: 'admin', category: 'admin-users' },

  // Research
  { title: 'Studies', url: '/admin/studies', role: 'admin', category: 'admin-research' },
  { title: 'Study Consents', url: '/admin/study-consents', role: 'admin', category: 'admin-research' },
  { title: 'Registrations', url: '/admin/registrations', role: 'admin', category: 'admin-research' },
  { title: 'Contributions', url: '/admin/contributions', role: 'admin', category: 'admin-research' },
  { title: 'Health Outcomes', url: '/admin/outcomes', role: 'admin', category: 'admin-research' },
  { title: 'Production', url: '/admin/production', role: 'admin', category: 'admin-research' },
  { title: 'Distribution Protocols', url: '/admin/distribution-protocols', role: 'admin', category: 'admin-research' },
  { title: 'Distribution Forecast', url: '/admin/distribution-forecast', role: 'admin', category: 'admin-research' },

  // Content
  { title: 'Products', url: '/admin/products', role: 'admin', category: 'admin-content' },
  { title: 'Hero Slides', url: '/admin/hero-slides', role: 'admin', category: 'admin-content' },
  { title: 'Web Pages', url: '/admin/pages', role: 'admin', category: 'admin-content' },
  { title: 'Featured Products', url: '/admin/featured-products', role: 'admin', category: 'admin-content' },
  { title: 'Archive', url: '/admin/archive', role: 'admin', category: 'admin-content' },
  { title: 'Questionnaires', url: '/admin/questionnaires', role: 'admin', category: 'admin-content' },
  { title: 'Tests', url: '/admin/tests', role: 'admin', category: 'admin-content' },
  { title: 'Biomarkers', url: '/admin/biomarkers', role: 'admin', category: 'admin-content' },
  { title: 'Notifications', url: '/admin/notifications', role: 'admin', category: 'admin-content' },
  { title: 'News Articles', url: '/admin/news-articles', role: 'admin', category: 'admin-content' },
  { title: 'Translations', url: '/admin/translations', role: 'admin', category: 'admin-content', slow: true },

  // Payments
  { title: 'Orders', url: '/admin/orders', role: 'admin', category: 'admin-payments' },
  { title: 'Payments', url: '/admin/payments', role: 'admin', category: 'admin-payments' },
  { title: 'Shipments', url: '/admin/shipments', role: 'admin', category: 'admin-payments' },
  { title: 'Distribution Calendar', url: '/admin/distribution', role: 'admin', category: 'admin-payments' },
  { title: 'Member Subscriptions', url: '/admin/member-subscriptions', role: 'admin', category: 'admin-payments' },
  { title: 'Subscriptions', url: '/admin/subscriptions', role: 'admin', category: 'admin-payments' },
  { title: 'Tokenomics', url: '/admin/tokenomics', role: 'admin', category: 'admin-payments' },
];

// ---------------------------------------------------------------------------
// Route Registry — MEMBER
// ---------------------------------------------------------------------------

export const MEMBER_ROUTES: RouteEntry[] = [
  { title: 'Member Portal', url: '/member', role: 'member', category: 'member' },
  { title: 'Check-In', url: '/member/check-in', role: 'member', category: 'member' },
  { title: 'Profile', url: '/member/profile', role: 'member', category: 'member' },
  { title: 'Orders', url: '/member/orders', role: 'member', category: 'member' },
  { title: 'Tokens', url: '/member/tokens', role: 'member', category: 'member' },
  { title: 'Reward Shop', url: '/member/reward-shop', role: 'member', category: 'member' },
  { title: 'Vouchers', url: '/member/vouchers', role: 'member', category: 'member' },
  { title: 'Leaderboard', url: '/member/leaderboard', role: 'member', category: 'member' },
  { title: 'Appointments', url: '/member/appointments', role: 'member', category: 'member' },
  { title: 'Calendar', url: '/member/calendar', role: 'member', category: 'member' },
  { title: 'Questionnaires', url: '/member/questionnaires', role: 'member', category: 'member' },
  { title: 'Assessment', url: '/member/assessment', role: 'member', category: 'member' },
  { title: 'Consents', url: '/member/consents', role: 'member', category: 'member' },
  { title: 'Tracking', url: '/member/tracking', role: 'member', category: 'member' },
  { title: 'Longevity Score', url: '/member/tracking/longevity', role: 'member', category: 'member' },
  { title: 'Dosing', url: '/member/dosing', role: 'member', category: 'member' },
  { title: 'Story', url: '/member/story', role: 'member', category: 'member' },
  { title: 'My Rules', url: '/member/rules', role: 'member', category: 'member' },
];

// ---------------------------------------------------------------------------
// Route Registry — PARTNER
// ---------------------------------------------------------------------------

export const PARTNER_ROUTES: RouteEntry[] = [
  { title: 'Partner Dashboard', url: '/partner/dashboard', role: 'partner', category: 'partner' },
  { title: 'Partner Users', url: '/partner/users', role: 'partner', category: 'partner' },
  { title: 'Storyloop', url: '/partner/storyloop', role: 'partner', category: 'partner' },
  { title: 'Templates', url: '/partner/templates', role: 'partner', category: 'partner' },
  { title: 'Profile Edit', url: '/partner/profile/edit', role: 'partner', category: 'partner' },
  { title: 'Contributed Rules', url: '/partner/rules', role: 'partner', category: 'partner' },
];

// ---------------------------------------------------------------------------
// RBAC Rules — who can access what
// ---------------------------------------------------------------------------

export const RBAC_RULES: RbacRule[] = [
  // Anonymous → protected routes → redirect to auth
  { url: '/admin', role: 'anonymous', expect: 'redirect-auth', redirectPattern: /\/(auth|login)/ },
  { url: '/member', role: 'anonymous', expect: 'redirect-auth', redirectPattern: /\/(auth|login)/ },
  { url: '/partner/dashboard', role: 'anonymous', expect: 'redirect-auth', redirectPattern: /\/(auth|login)/ },

  // Member → admin → deny
  { url: '/admin', role: 'member', expect: 'deny' },
  { url: '/admin/members', role: 'member', expect: 'deny' },

  // Member → own areas → allow
  { url: '/member', role: 'member', expect: 'allow' },
  { url: '/member/profile', role: 'member', expect: 'allow' },

  // Partner → partner areas → allow
  { url: '/partner/dashboard', role: 'partner', expect: 'allow' },

  // Admin → everywhere → allow
  { url: '/admin', role: 'admin', expect: 'allow' },
  { url: '/member', role: 'admin', expect: 'allow' },
  { url: '/partner/dashboard', role: 'admin', expect: 'allow' },
];

// ---------------------------------------------------------------------------
// Aggregate helpers
// ---------------------------------------------------------------------------

export const ALL_ROUTES: RouteEntry[] = [
  ...PUBLIC_ROUTES,
  ...AUTH_ROUTES,
  ...LEGAL_ROUTES,
  ...ADMIN_ROUTES,
  ...MEMBER_ROUTES,
  ...PARTNER_ROUTES,
];

/** Get routes by category. */
export function routesByCategory(category: RouteCategory): RouteEntry[] {
  return ALL_ROUTES.filter((r) => r.category === category);
}

/** Get routes by role. */
export function routesByRole(role: UserRole): RouteEntry[] {
  return ALL_ROUTES.filter((r) => r.role === role);
}

/** Get only testable routes (not skipped). */
export function testableRoutes(routes: RouteEntry[]): RouteEntry[] {
  return routes.filter((r) => !r.skip);
}

/** Get all unique URLs registered. */
export function registeredUrls(): Set<string> {
  return new Set(ALL_ROUTES.map((r) => r.url));
}
