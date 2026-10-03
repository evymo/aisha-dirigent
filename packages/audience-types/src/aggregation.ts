/**
 * Aggregation types — define the SHAPE OF AGGREGATES and SCOPE RULES.
 *
 * Used by:
 *   - svc-source-broker (and future broker microservices) when aggregating
 *     from external data sources
 *   - context_profiles.data_scope_rule JSONB (parsed into ScopeRule)
 *   - Appsmith templates (declarative bindings reference metric kinds)
 *
 * The cardinal rule: NO raw data here. Only aggregates and scope filters.
 */

import type { MemberTier } from './member-tier.js';

// ----------------------------------------------------------------------------
// Metric definitions — what a connector can produce
// ----------------------------------------------------------------------------

export type MetricKind =
  // Activity
  | 'app_accesses_30d'
  | 'app_accesses_90d'
  | 'last_active_at'
  // Creation
  | 'events_created_30d'
  | 'events_created_90d'
  | 'posts_created_30d'
  // Audience
  | 'audience_size'
  | 'audience_growth_30d'
  | 'unique_attendees_30d'
  | 'total_attendance_30d'
  // Communication
  | 'emails_opened_90d'
  | 'emails_sent_90d'
  | 'email_open_rate_90d'
  | 'email_click_rate_90d';

export interface MetricValue {
  kind: MetricKind;
  value: number | null;
  unit?: 'count' | 'rate' | 'timestamp';
}

export interface MetricSeries {
  kind: MetricKind;
  points: Array<{ date: string; value: number }>;
}

// ----------------------------------------------------------------------------
// Scope rule — defines who sees what
// ----------------------------------------------------------------------------

/**
 * Mirrors the JSONB structure stored in context_profiles.data_scope_rule.
 * Supports a limited DSL evaluated server-side by crm.user_can_access_via_profile().
 */
export interface ScopeRule {
  /** Filter expression — limited DSL */
  filter?: ScopeFilter;
  /** Minimum tier required to use this scope */
  tierRequired?: MemberTier;
  /** Permission code required (from aisha get_user_permissions()) */
  permissionRequired?: string;
  /** Expand scope via role relationships */
  expandViaRole?: string[];
}

export type ScopeFilter =
  | 'creator_user_id = auth.uid()' // creator self
  | 'target_user_id = auth.uid()' // member self
  | 'is_admin_or_staff()' // admin
  | 'scope_member_of(auth.uid(), creator_user_id)' // org peer
  | 'is_public_metric = true'; // public aggregate

// ----------------------------------------------------------------------------
// Audience snapshot — what creator sees in "My Audience" tab
// ----------------------------------------------------------------------------

export interface CreatorAudienceSnapshot {
  creatorUserId: string;
  audienceSize: number;
  audienceGrowth30d: number; // 0..1 (proportion); display as %
  uniqueAttendees30d: number;
  totalAttendance30d: number;
  eventsCreated30d: number;
  eventsCreated90d: number;
  lastActiveAt: string | null;
  computedAt: string;
  sourceConnectorSlug: string;
}

// ----------------------------------------------------------------------------
// AI access policy — tier-gated context profile
// ----------------------------------------------------------------------------

export type AiInteractionMode = 'chat' | 'story' | 'story-read-only';

export interface AiTierAccessPolicy {
  /** Context profile slug */
  contextProfileSlug: string;
  /** Required tier */
  tierRequired: MemberTier;
  /** Required permission code (optional) */
  permissionRequired?: string;
  /** Allowed interaction modes */
  allowedModes: AiInteractionMode[];
  /** Token budget cap for this tier */
  tokenBudget: number;
  /** Guardrails (ruleset IDs) */
  guardrails: string[];
}

/**
 * AI tier policy registry — maps tiers to allowed AI interactions.
 * Default seeded; per-tenant overridden in domain config.
 */
export const DEFAULT_AI_TIER_POLICIES: Record<MemberTier, AiInteractionMode[]> = {
  anonymous: [],
  registered: ['chat'],
  active: ['chat', 'story-read-only'],
  qualified: ['chat', 'story-read-only', 'story'],
  partner: ['chat', 'story-read-only', 'story'],
  admin: ['chat', 'story-read-only', 'story'],
};

// ----------------------------------------------------------------------------
// Aggregation function signature — pure transformation from raw source events
// to aggregate snapshot. Lives in connector implementations.
// ----------------------------------------------------------------------------

export interface SourceActivityEvent {
  userId: string;
  occurredAt: string;
  eventType:
    | 'login'
    | 'event_created'
    | 'event_published'
    | 'post_created'
    | 'attendance_recorded'
    | 'follow_added'
    | 'email_opened'
    | 'email_clicked'
    | 'email_sent';
  metadata?: Record<string, unknown>;
}

/**
 * Pure function: aggregate a batch of source events into a snapshot.
 * NEVER persists individual events. NEVER returns event arrays.
 * Connector calls this internally; only the aggregate goes to DB.
 */
export type AggregationFn = (
  events: SourceActivityEvent[],
  userId: string,
  asOf: Date
) => Omit<CreatorAudienceSnapshot, 'creatorUserId' | 'sourceConnectorSlug'>;
