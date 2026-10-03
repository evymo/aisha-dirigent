/**
 * engagement-snapshot.ts — the ONE place the standard camelCase
 * ActorAggregateSnapshot is translated to the snake_case jsonb shape that
 * public.audience_upsert_user_engagement reads.
 *
 * The DB boundary is snake_case (app_accesses_30d, last_active_at, …); the TS
 * contract is camelCase (appAccesses30d, lastActiveAt, …). Passing a snapshot
 * through JSON.stringify unmapped makes EVERY key miss the RPC's `p_data->>'…'`
 * lookups → COALESCE(…,0) → the ON CONFLICT upsert overwrites a user's real
 * engagement row with zeros. This mapper is the guard against that; the key set
 * here is the canonical mirror-upsert contract for the snapshot type.
 */
import type { ActorAggregateSnapshot } from '@aisha/audience-types';

export function snapshotToUpsertJson(s: ActorAggregateSnapshot): Record<string, unknown> {
  return {
    app_accesses_30d: s.appAccesses30d,
    app_accesses_90d: s.appAccesses90d,
    last_active_at: s.lastActiveAt,
    events_created_30d: s.eventsCreated30d,
    events_created_90d: s.eventsCreated90d,
    posts_created_30d: s.postsCreated30d,
    audience_size: s.audienceSize,
    audience_growth_30d: s.audienceGrowth30d,
    unique_attendees_30d: s.uniqueAttendees30d,
    total_attendance_30d: s.totalAttendance30d,
    emails_opened_90d: s.emailsOpened90d,
    emails_sent_90d: s.emailsSent90d,
    email_open_rate_90d: s.emailOpenRate90d,
    email_click_rate_90d: s.emailClickRate90d,
  };
}
