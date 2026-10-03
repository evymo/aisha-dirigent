/**
 * Audience module — TypeScript domain entity types.
 *
 * Renamed from crm-entities.ts. These are TS mirrors of:
 *   - existing aisha tables (profiles, partner_profiles, memberships, ...)
 *   - extensions added by audience module (context_profiles.data_scope_rule,
 *     openclaw_notifications.campaign_id, etc.)
 *   - the ONE new table (signal_tag_rules)
 *
 * Used by:
 *   - PostgREST client (audience views + RPCs)
 *   - svc-source-broker (when aggregating source-api → aisha)
 *   - Appsmith app templates (declarative bindings reference these shapes)
 */

import type { MemberTier } from './member-tier.js';

// ----------------------------------------------------------------------------
// Existing aisha entities (TS mirrors; no duplication)
// ----------------------------------------------------------------------------

export interface AishaProfile {
  id: string;
  userId: string;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  preferredLanguage: string | null;
  isPublicProfile: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AishaPartnerProfile {
  id: string;
  userId: string;
  displayName: string;
  businessName: string | null;
  description: string | null;
  website: string | null;
  city: string | null;
  country: string;
  /** Multi-purpose tag array; source encodes center type + specializations here */
  services: string[];
  certificationLevel: string | null;
  isProductionProvider: boolean;
  isVisible: boolean;
  isCertified: boolean;
  certificationPassedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AishaMembership {
  id: string;
  userId: string;
  tier: 'basic' | 'upgraded';
  status: 'active' | 'expired';
  startsAt: string | null;
  expiresAt: string | null;
}

// ----------------------------------------------------------------------------
// THE ONE NEW TABLE: signal_tag_rules
// ----------------------------------------------------------------------------

export interface SignalTagRule {
  id: string;
  eventTypePattern: string;
  sourcePattern: string | null;
  tags: string[];
  priority: number;
  isActive: boolean;
  description: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// ----------------------------------------------------------------------------
// Composite views (no new table; built from JOINs in 10_audience_views.sql)
// ----------------------------------------------------------------------------

export interface AudienceActorTier {
  userId: string;
  displayName: string | null;
  email: string | null;
  memberTier: MemberTier;
  membershipTier: 'basic' | 'upgraded' | null;
  membershipStatus: 'active' | 'expired' | null;
  certificationLevel: string | null;
  certificationPassedAt: string | null;
  businessName: string | null;
  specializations: string[] | null;
  audienceSize: number | null;
  lastActiveAt: string | null;
}

export interface AudienceActorOverlay {
  actorUserId: string;
  displayName: string | null;
  email: string | null;
  /** Notes from story_entries entry_type='actor_note' */
  notes: Array<{ id: string; content: string; createdAt: string; createdBy: string | null }> | null;
  /** Pending follow-ups from ai_tasks task_type='follow_up' */
  pendingFollowups: Array<{ id: string; dueAt: string; note: string | null; status: string }> | null;
  /** Polymorphic tags from story_labels resource_type='actor' */
  tags: string[] | null;
  /** Assigned marketer from study_consultants scope_type='actor' role='account_manager' */
  assignedToPartnerId: string | null;
}

export interface AudienceContactDirectoryRow extends AudienceActorTier {
  notes: AudienceActorOverlay['notes'];
  pendingFollowups: AudienceActorOverlay['pendingFollowups'];
  tags: string[];
  assignedToPartnerId: string | null;
  communications90d: number;
  lastCommunicationAt: string | null;
}

// ----------------------------------------------------------------------------
// Notification campaign extension (channels[] replacing send_push/send_inapp)
// ----------------------------------------------------------------------------

export type NotificationChannel = 'push' | 'inapp' | 'email' | 'sms' | 'whatsapp' | 'matrix' | 'telegram' | 'slack' | 'discord';

export interface NotificationCampaignWithChannels {
  id: string;
  name: string;
  title: string | null;
  description: string | null;
  channels: NotificationChannel[];
  audienceType: 'all' | 'study' | 'questionnaire_due' | 'user_list';
  audienceFilter: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
}

// ----------------------------------------------------------------------------
// openclaw_notifications extended (campaign tracking)
// ----------------------------------------------------------------------------

export type CommunicationStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'cancelled';

export interface CommunicationLogRow {
  id: string;
  userId: string;
  channel: NotificationChannel;
  status: CommunicationStatus;
  title: string | null;
  body: string | null;
  campaignId: string | null;
  campaignRunId: string | null;
  sentAt: string;
  openedAt: string | null;
  clickedAt: string | null;
  bouncedAt: string | null;
  unsubscribedAt: string | null;
}

// ----------------------------------------------------------------------------
// Cohort views (aliases over studies)
// ----------------------------------------------------------------------------

export type CohortType = 'source_retreat' | 'marketing_segment' | 'event_audience' | 'course_cohort' | string;

export interface CohortRow {
  cohortId: string;
  cohortName: string;
  title: string | null;
  cohortType: CohortType;
  status: string;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  targetRegistration: number | null;
  currentRegistration: number;
  parentCohortId: string | null;
}

// ----------------------------------------------------------------------------
// Operator view row types (one per view in 60_operator_views.sql)
// ----------------------------------------------------------------------------

export interface FollowupQueueRow {
  taskId: string;
  actorUserId: string;
  actorName: string | null;
  actorEmail: string | null;
  note: string | null;
  dueAt: string;
  status: 'queued' | 'in_progress' | 'completed';
  assignedToUserId: string;
  bucket: 'overdue' | 'today' | 'this_week' | 'later';
  daysUntilDue: number;
}

export interface TierFunnelRow {
  memberTier: MemberTier;
  actorCount: number;
  active30d: number;
  active7d: number;
  withAudience: number;
  avgAudienceSize: number | null;
}

export interface SignalFeedRow {
  eventId: string;
  eventSource: string;
  eventType: string;
  status: string;
  storyId: string | null;
  actorUserId: string | null;
  wouldApplyTags: string[] | null;
  createdAt: string;
}
