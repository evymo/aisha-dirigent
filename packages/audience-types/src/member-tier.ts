/**
 * Universal member tier model — single source of truth in TypeScript.
 *
 * Mirrors the SQL `crm.derive_member_tier()` function (20_scope_functions.sql).
 * Used in:
 *   - Frontend (React hooks: useCrmTier, useTierGate)
 *   - svc-crm-connector (tier-based scope decisions)
 *   - AI access policy (context_profiles.tier_required)
 *
 * Design constraint: NO source-specific terms. All tier names are universal.
 */

// ----------------------------------------------------------------------------
// Tier enum
// ----------------------------------------------------------------------------

export enum MemberTier {
  Anonymous = 'anonymous',
  Registered = 'registered',
  Active = 'active',
  Qualified = 'qualified',
  Partner = 'partner',
  Admin = 'admin',
}

export const TIER_ORDER: Record<MemberTier, number> = {
  [MemberTier.Anonymous]: 0,
  [MemberTier.Registered]: 1,
  [MemberTier.Active]: 2,
  [MemberTier.Qualified]: 3,
  [MemberTier.Partner]: 4,
  [MemberTier.Admin]: 5,
};

export type MemberTierString = `${MemberTier}`;

// ----------------------------------------------------------------------------
// Tier derivation input (from aisha existing tables)
// ----------------------------------------------------------------------------

/**
 * Inputs to derive a tier — mirrors columns from
 *   profiles + partner_profiles + memberships + crm.crm_engagement_latest_v
 * Used in TypeScript-side derivation (tests, client-side optimistic UI).
 * Server-side authoritative computation is in SQL `derive_member_tier()`.
 */
export interface TierDerivationInput {
  // From profiles
  hasProfile: boolean;
  // From partner_profiles (nullable: not every user is a partner)
  isCertified?: boolean | null;
  isVisible?: boolean | null;
  isProductionProvider?: boolean | null;
  // From crm_engagement_latest_v
  appAccesses30d?: number | null;
  // Override flags
  isAdminOrStaff?: boolean;
}

/**
 * Pure function deriving member tier from inputs.
 * Matches SQL `crm.derive_member_tier()` exactly — test parity required.
 */
export function deriveMemberTier(input: TierDerivationInput): MemberTier {
  if (input.isAdminOrStaff) return MemberTier.Admin;
  if (!input.hasProfile) return MemberTier.Anonymous;
  if (input.isVisible && input.isProductionProvider) return MemberTier.Partner;
  if (input.isCertified) return MemberTier.Qualified;
  if ((input.appAccesses30d ?? 0) > 0) return MemberTier.Active;
  return MemberTier.Registered;
}

// ----------------------------------------------------------------------------
// Tier comparison helpers
// ----------------------------------------------------------------------------

export function tierMeets(caller: MemberTier, required: MemberTier): boolean {
  return TIER_ORDER[caller] >= TIER_ORDER[required];
}

export function tierBetween(
  caller: MemberTier,
  min: MemberTier,
  max: MemberTier
): boolean {
  const c = TIER_ORDER[caller];
  return c >= TIER_ORDER[min] && c <= TIER_ORDER[max];
}

// ----------------------------------------------------------------------------
// Tier metadata for UI rendering
// ----------------------------------------------------------------------------

export interface TierMetadata {
  tier: MemberTier;
  label: string;
  description: string;
  iconHint: string; // Lucide icon name (frontend-rendered)
  badgeColor: string; // shadcn variant
}

export const TIER_METADATA: Record<MemberTier, TierMetadata> = {
  [MemberTier.Anonymous]: {
    tier: MemberTier.Anonymous,
    label: 'Anonymous',
    description: 'Not signed in. Public content only.',
    iconHint: 'User',
    badgeColor: 'secondary',
  },
  [MemberTier.Registered]: {
    tier: MemberTier.Registered,
    label: 'Registered',
    description: 'Has an account but not yet active.',
    iconHint: 'UserPlus',
    badgeColor: 'outline',
  },
  [MemberTier.Active]: {
    tier: MemberTier.Active,
    label: 'Active',
    description: 'Engaged member — active in last 30 days.',
    iconHint: 'UserCheck',
    badgeColor: 'default',
  },
  [MemberTier.Qualified]: {
    tier: MemberTier.Qualified,
    label: 'Qualified',
    description: 'Certified member — completed qualification.',
    iconHint: 'Award',
    badgeColor: 'default',
  },
  [MemberTier.Partner]: {
    tier: MemberTier.Partner,
    label: 'Partner',
    description: 'Visible provider with own audience.',
    iconHint: 'Star',
    badgeColor: 'default',
  },
  [MemberTier.Admin]: {
    tier: MemberTier.Admin,
    label: 'Administrator',
    description: 'Operational access to all data.',
    iconHint: 'ShieldCheck',
    badgeColor: 'destructive',
  },
};
