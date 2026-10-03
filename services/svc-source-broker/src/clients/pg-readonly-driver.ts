/**
 * Direct PostgreSQL client for source-api readonly access.
 *
 * DESIGN PRINCIPLE: aisha-CRM is the CONSUMER. Source is the PROVIDER. The
 * provider stays untouched — no Django apps, no SECURITY DEFINER functions,
 * no schema changes. We only require READ access to specific tables via a
 * dedicated postgres role (one-time GRANT statements, applied to a streaming
 * replica when running in production — see docs/SOURCE_PG_READONLY_SETUP.md).
 *
 * All aggregation logic lives in THIS file (queries as TS strings). Source
 * never has to know what "audience size" or "engagement metrics" mean.
 *
 * Source tables referenced (read-only). Reconciled against the live source
 * schema on 2026-07-01 — the earlier contract assumed `core_newfollow` and
 * `stats_statsnapshots`, which no longer exist; follows now live in
 * `core_profile_sympathize` (user↔user) + `core_event_followers` (profile↔event),
 * and community KPIs are computed on the fly (no snapshot table):
 *   - core_appuser              user accounts
 *   - core_profile              profiles (FK core_profile.user_id → core_appuser.id)
 *   - core_event                events created by users
 *   - core_profile_sympathize   user↔user follows (from_profile_id → to_profile_id)
 *   - core_event_followers      profile↔event follows (profile_id, event_id)
 *   - core_userstatistics       per-user daily activity log (user_id, date)
 *   - collaboration_post        posts (for community posts_total)
 *   - core_venue                venues (events area + venue names on events)
 *
 * Required GRANTs (run once on source-postgres, see ops doc):
 *   GRANT SELECT ON core_appuser, core_profile, core_event,
 *                    core_profile_sympathize, core_event_followers,
 *                    core_userstatistics, collaboration_post, core_venue
 *     TO <source_readonly_role>;
 *
 *   - core_newfollow            ⚠ ZRUŠENA VE ZDROJI (2026-07-01)
 *   - stats_statsnapshots       ⚠ ZRUŠENA VE ZDROJI (2026-07-01)
 *
 * ⚠ Dvě z těch tabulek už ve zdroji nejsou. Dotazy níž, které je používají
 *   (audience přes core_newfollow, KPI snapshot přes stats_statsnapshots),
 *   proti dnešnímu zdroji SELŽOU. Nechány záměrně: source-contract.ts je
 *   deklaruje dál, takže rozdíl proti skutečnosti ohlásí drift-canary jako
 *   DRIFT — a to je čitelnější než tiše chybějící metrika. Odstranit se mají
 *   až s měřením proti živému zdroji, ne od stolu.
 *
 * Required GRANTs (run once on source-postgres, see ops doc):
 *   GRANT SELECT ON core_appuser, core_profile, core_event
 *     TO <readonly-role>;
 *   ⚠ NEgrantovat core_newfollow ani stats_statsnapshots — neexistují, a jeden
 *     chybějící objekt shodí celý grant skript včetně platných grantů.
 */

import { Client as PgClient } from 'pg';
import { errMessage } from '../errors.js';
import type { SourceBrokerConfig } from '../config.js';
import { SOURCE_CONTRACT } from '../contracts/source-contract.js';
import { verifyContract, type DriftReport } from '../contracts/drift-canary.js';

// ============================================================================
// Result shapes
// ============================================================================

export interface SourceEngagement {
  userId: string;
  email: string | null;
  displayName: string | null;
  language: string | null;
  registeredAt: string | null;
  lastActivityAt: string | null;
  isInstructor: boolean;
  appAccesses30d: number;
  appAccesses90d: number;
  eventsCreated30d: number;
  eventsCreated90d: number;
  audienceSize: number;
  uniqueFollowers30d: number;
  totalAttendance30d: number;
}

export interface SourceActiveUserId {
  userId: string;
  email: string | null;
  displayName: string | null;
  lastActivityAt: string | null;
}

export interface SourceCommunityKpi {
  snapshotDate: string;
  usersTotal: number;
  usersNew: number;
  usersMonthly: number;
  usersWeekly: number;
  usersDaily: number;
  eventsTotal: number;
  postsTotal: number;
}

export interface SourceEventSummary {
  eventId: string;
  title: string | null;
  date: string | null;
  dateTo: string | null;
  isOnline: boolean;
  official: boolean;
  venueName: string | null;
  venueTown: string | null;
  venueCountry: string | null;
  creatorName: string | null;
  followerCount: number;
}

export interface SourceVenue {
  venueId: string;
  name: string | null;
  town: string | null;
  country: string | null;
  venueType: string | null;
  specialVenue: boolean;
  eventCount: number;
}

export interface SourceMemberDetail {
  userId: string;
  email: string | null;
  displayName: string | null;
  language: string | null;
  registeredAt: string | null;
  lastActivityAt: string | null;
  isActive: boolean;
  isInstructor: boolean;
  location: string | null;
  yearOfTransmission: string | null;
  placeOfTransmission: string | null;
  transmissionGiver: string | null;
  contact: string | null;
}

// ============================================================================
// Inline SQL queries (aggregation logic owned by aisha-CRM)
// ============================================================================

/**
 * One-shot engagement aggregation for a single user. Combines all metrics into
 * a single round-trip via correlated subqueries.
 *
 * Param: $1 = user_id UUID
 */
const QUERY_ENGAGEMENT_FOR_USER = /* sql */ `
  SELECT
    u.id                       AS user_id,
    u.email                    AS email,
    p.full_name                AS display_name,
    p.language                 AS language,
    p.since                    AS registered_at,
    u.last_activity            AS last_activity_at,
    COALESCE(p.is_instructor, false) AS is_instructor,

    -- App accesses: distinct active days from core_userstatistics(user_id, date)
    -- within the window — the authoritative per-day activity log.
    COALESCE((
      SELECT count(DISTINCT us.date)::int
      FROM core_userstatistics us
      WHERE us.user_id = u.id
        AND us.date >= (now() - interval '30 days')::date
    ), 0) AS app_accesses_30d,
    COALESCE((
      SELECT count(DISTINCT us.date)::int
      FROM core_userstatistics us
      WHERE us.user_id = u.id
        AND us.date >= (now() - interval '90 days')::date
    ), 0) AS app_accesses_90d,

    -- Events created (active only — exclude cancelled).
    COALESCE((
      SELECT count(*)::int
      FROM core_event e
      WHERE e.created_by_id = u.id
        AND e.cancelled = false
        AND e.created_at >= now() - interval '30 days'
    ), 0) AS events_created_30d,
    COALESCE((
      SELECT count(*)::int
      FROM core_event e
      WHERE e.created_by_id = u.id
        AND e.cancelled = false
        AND e.created_at >= now() - interval '90 days'
    ), 0) AS events_created_90d,

    -- Audience size = distinct profiles who either sympathize with U's profile
    -- (core_profile_sympathize, user↔user) OR follow one of U's events
    -- (core_event_followers, profile↔event). Union of profile ids. No time
    -- window: neither table carries a per-follow timestamp in the live schema.
    COALESCE((
      SELECT count(DISTINCT aud.profile_id)::int FROM (
        SELECT ps.from_profile_id AS profile_id
          FROM core_profile_sympathize ps
          JOIN core_profile me ON me.id = ps.to_profile_id
         WHERE me.user_id = u.id
        UNION
        SELECT ef.profile_id
          FROM core_event_followers ef
          JOIN core_event e ON e.id = ef.event_id
         WHERE e.created_by_id = u.id
      ) aud
    ), 0) AS audience_size,

    -- Recent reach/attendance: distinct + total event-followers on U's events
    -- DATED in the last 30d. The window is applied via the event date
    -- (core_event.date) because core_event_followers carries no per-follow
    -- timestamp in the live schema — an explicit proxy for "recent attendance".
    COALESCE((
      SELECT count(DISTINCT ef.profile_id)::int
      FROM core_event_followers ef
      JOIN core_event e ON e.id = ef.event_id
      WHERE e.created_by_id = u.id
        AND e.date >= now() - interval '30 days'
    ), 0) AS unique_followers_30d,
    COALESCE((
      SELECT count(*)::int
      FROM core_event_followers ef
      JOIN core_event e ON e.id = ef.event_id
      WHERE e.created_by_id = u.id
        AND e.date >= now() - interval '30 days'
    ), 0) AS total_attendance_30d

  FROM core_appuser u
  LEFT JOIN core_profile p ON p.user_id = u.id
  WHERE u.id = $1
    AND u.is_active = true;
`;

/**
 * Active user IDs since timestamp, for batch sync.
 *
 * Params: $1 = since TIMESTAMPTZ, $2 = limit INT
 */
const QUERY_RECENT_ACTIVE_USERS = /* sql */ `
  SELECT
    u.id              AS user_id,
    u.email           AS email,
    p.full_name       AS display_name,
    u.last_activity   AS last_activity_at
  FROM core_appuser u
  LEFT JOIN core_profile p ON p.user_id = u.id
  WHERE u.is_active = true
    AND u.last_activity >= $1::timestamptz
  ORDER BY u.last_activity DESC
  LIMIT $2::int;
`;

/**
 * Community-level KPI snapshot. The live schema has no pre-aggregated snapshot
 * table (the old `stats_statsnapshots` is gone), so the broker computes the KPIs
 * on the fly: totals from `core_appuser`/`core_event`/`collaboration_post`, and
 * active-user buckets from `core_appuser.last_activity`. `snapshot_date` is
 * `current_date` (the moment of computation).
 */
const QUERY_COMMUNITY_KPI = /* sql */ `
  SELECT
    current_date AS snapshot_date,
    (SELECT count(*)::int FROM core_appuser WHERE is_active) AS users_total,
    (SELECT count(*)::int FROM core_appuser
       WHERE is_active AND date_joined >= now() - interval '30 days') AS users_new,
    (SELECT count(*)::int FROM core_appuser
       WHERE is_active AND last_activity >= now() - interval '30 days') AS users_monthly,
    (SELECT count(*)::int FROM core_appuser
       WHERE is_active AND last_activity >= now() - interval '7 days') AS users_weekly,
    (SELECT count(*)::int FROM core_appuser
       WHERE is_active AND last_activity >= now() - interval '1 day') AS users_daily,
    (SELECT count(*)::int FROM core_event WHERE cancelled = false) AS events_total,
    (SELECT count(*)::int FROM collaboration_post WHERE deleted_at IS NULL) AS posts_total;
`;

/**
 * Events with date in [$1, $2) (default caller window = "this week"), active
 * only. LEFT JOINs venue title + town/country, creator display name, and a
 * follower count. Params: $1 = from TIMESTAMPTZ, $2 = to TIMESTAMPTZ, $3 = limit.
 */
const QUERY_EVENTS_IN_RANGE = /* sql */ `
  SELECT
    e.id                          AS event_id,
    e.title                       AS title,
    e.date                        AS date,
    e.date_to                     AS date_to,
    COALESCE(e.is_online, false)  AS is_online,
    COALESCE(e.official, false)   AS official,
    v.title                       AS venue_name,
    v.town                        AS venue_town,
    v.country                     AS venue_country,
    cp.full_name                  AS creator_name,
    (SELECT count(*)::int FROM core_event_followers ef WHERE ef.event_id = e.id) AS follower_count
  FROM core_event e
  LEFT JOIN core_venue v   ON v.id = e.venue_id
  LEFT JOIN core_profile cp ON cp.user_id = e.created_by_id
  WHERE e.cancelled = false
    AND e.date >= $1::timestamptz
    AND e.date <  $2::timestamptz
  ORDER BY e.date ASC
  LIMIT $3::int;
`;

/**
 * Active (non-deleted) venues + their active-event counts. Param: $1 = limit.
 */
const QUERY_VENUES = /* sql */ `
  SELECT
    v.id                            AS venue_id,
    v.title                         AS name,
    v.town                          AS town,
    v.country                       AS country,
    v.venue_type                    AS venue_type,
    COALESCE(v.special_venue, false) AS special_venue,
    (SELECT count(*)::int FROM core_event e WHERE e.venue_id = v.id AND e.cancelled = false) AS event_count
  FROM core_venue v
  WHERE COALESCE(v.deleted, false) = false
  ORDER BY v.title ASC
  LIMIT $1::int;
`;

/**
 * Full member profile for the Members-360 detail view — identity + transmission
 * lineage + contact. Empty strings are normalised to NULL. Param: $1 = user_id.
 */
const QUERY_MEMBER_DETAIL = /* sql */ `
  SELECT
    u.id                            AS user_id,
    u.email                         AS email,
    u.date_joined                   AS registered_at,
    u.last_activity                 AS last_activity_at,
    COALESCE(u.is_active, false)    AS is_active,
    p.full_name                     AS display_name,
    p.language                      AS language,
    COALESCE(p.is_instructor, false) AS is_instructor,
    NULLIF(p.location, '')          AS location,
    NULLIF(p.year_of_transmission, '')  AS year_of_transmission,
    NULLIF(p.place_of_transmission, '') AS place_of_transmission,
    NULLIF(p.transmission_giver, '')    AS transmission_giver,
    NULLIF(p.contact, '')           AS contact
  FROM core_appuser u
  LEFT JOIN core_profile p ON p.user_id = u.id
  WHERE u.id = $1::uuid;
`;

// ============================================================================
// Client class
// ============================================================================

export class SourcePgClient {
  private config: SourceBrokerConfig;
  private client: PgClient | null = null;
  /**
   * Optional per-source connection override. When set, connect() targets THIS
   * connection string instead of config.sourcePgUrl. The multi-source scheduler
   * builds one SourcePgClient per approved source, each pinned to that source's
   * own endpoint (resolved from audience_list_approved_sources.endpoint_url +
   * its credential reference). When unset (default), the client behaves exactly
   * as before — the single, deploy-configured source-postgres — so the on-demand
   * /sync routes and probe are unchanged.
   */
  private readonly connectionOverride: string | null;

  constructor(config: SourceBrokerConfig, connectionOverride?: string) {
    this.config = config;
    this.connectionOverride = connectionOverride ?? null;
  }

  async connect(): Promise<void> {
    if (this.client) return;
    // Connection timeout (5s) prevents indefinite hang on unreachable hosts.
    // Statement timeout (30s) prevents runaway queries from blocking shutdown.
    const client = new PgClient({
      connectionString: this.connectionOverride ?? this.config.sourcePgUrl,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 30_000,
      query_timeout: 30_000,
    });
    try {
      await client.connect();
      this.client = client;
    } catch (err) {
      // Don't leave a half-initialized client referenced; force a fresh attempt next time
      this.client = null;
      try { await client.end(); } catch { /* swallow */ }
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.client) return;
    const c = this.client;
    this.client = null;
    try { await c.end(); } catch { /* swallow */ }
  }

  /**
   * Drift canary — validate the source source contract against the live schema.
   * The Anti-Corruption Layer's change-resilience guard. Called by the scheduler
   * before each sync (to refuse advancing the cursor on hard drift) and at
   * startup. Keeps the foreign-schema contract (SOURCE_CONTRACT) co-located with
   * the source client — the single place source schema knowledge lives.
   */
  async verifyContract(nowIso: string): Promise<DriftReport> {
    if (!this.client) throw new Error('SourcePgClient: not connected');
    return verifyContract(this.client, SOURCE_CONTRACT, nowIso);
  }

  /**
   * Fetch aggregated engagement metrics for a single user.
   * Returns null if user not found or inactive.
   */
  async getEngagementForUser(userId: string): Promise<SourceEngagement | null> {
    if (!this.client) throw new Error('SourcePgClient: not connected');
    const res = await this.client.query<{
      user_id: string;
      email: string | null;
      display_name: string | null;
      language: string | null;
      registered_at: string | null;
      last_activity_at: string | null;
      is_instructor: boolean;
      app_accesses_30d: number;
      app_accesses_90d: number;
      events_created_30d: number;
      events_created_90d: number;
      audience_size: number;
      unique_followers_30d: number;
      total_attendance_30d: number;
    }>(QUERY_ENGAGEMENT_FOR_USER, [userId]);
    if (res.rowCount === 0) return null;
    const r = res.rows[0];
    return {
      userId: r.user_id,
      email: r.email,
      displayName: r.display_name,
      language: r.language,
      registeredAt: r.registered_at,
      lastActivityAt: r.last_activity_at,
      isInstructor: r.is_instructor,
      appAccesses30d: r.app_accesses_30d,
      appAccesses90d: r.app_accesses_90d,
      eventsCreated30d: r.events_created_30d,
      eventsCreated90d: r.events_created_90d,
      audienceSize: r.audience_size,
      uniqueFollowers30d: r.unique_followers_30d,
      totalAttendance30d: r.total_attendance_30d,
    };
  }

  /**
   * Look up a member by email — authoritative identity for federation.
   * Used by /auth/source/login to resolve the source UUID from the verified
   * email (NOT from client input), so the broker provisions the right aisha
   * identity. Returns null if no active user with that email.
   */
  async getMemberByEmail(email: string): Promise<{
    userId: string;
    email: string | null;
    displayName: string | null;
    language: string | null;
    isInstructor: boolean;
  } | null> {
    if (!this.client) throw new Error('SourcePgClient: not connected');
    const res = await this.client.query<{
      id: string; email: string | null; full_name: string | null;
      language: string | null; is_instructor: boolean;
    }>(
      `SELECT u.id, u.email, p.full_name, p.language,
              COALESCE(p.is_instructor, false) AS is_instructor
         FROM core_appuser u
         LEFT JOIN core_profile p ON p.user_id = u.id
        WHERE lower(u.email) = lower($1) AND u.is_active = true
        LIMIT 1`,
      [email]
    );
    if (res.rowCount === 0) return null;
    const r = res.rows[0];
    return {
      userId: r.id, email: r.email, displayName: r.full_name,
      language: r.language, isInstructor: r.is_instructor,
    };
  }

  /**
   * Fetch active user IDs since timestamp. Broker iterates these for batch sync.
   */
  async getRecentActiveUserIds(
    since: Date,
    limit = 1000
  ): Promise<SourceActiveUserId[]> {
    if (!this.client) throw new Error('SourcePgClient: not connected');
    const res = await this.client.query<{
      user_id: string;
      email: string | null;
      display_name: string | null;
      last_activity_at: string | null;
    }>(QUERY_RECENT_ACTIVE_USERS, [since.toISOString(), limit]);
    return res.rows.map((r) => ({
      userId: r.user_id,
      email: r.email,
      displayName: r.display_name,
      lastActivityAt: r.last_activity_at,
    }));
  }

  /**
   * Fetch latest community-level KPI snapshot.
   */
  async getCommunityKpiSnapshot(): Promise<SourceCommunityKpi | null> {
    if (!this.client) throw new Error('SourcePgClient: not connected');
    const res = await this.client.query<{
      snapshot_date: string;
      users_total: number;
      users_new: number;
      users_monthly: number;
      users_weekly: number;
      users_daily: number;
      events_total: number;
      posts_total: number;
    }>(QUERY_COMMUNITY_KPI);
    if (res.rowCount === 0) return null;
    const r = res.rows[0];
    return {
      snapshotDate: r.snapshot_date,
      usersTotal: r.users_total,
      usersNew: r.users_new,
      usersMonthly: r.users_monthly,
      usersWeekly: r.users_weekly,
      usersDaily: r.users_daily,
      eventsTotal: r.events_total,
      postsTotal: r.posts_total,
    };
  }

  /**
   * Fetch events whose date falls in [from, to) — on-demand list for the
   * extranet Events area (and the "events this week" KPI tile).
   */
  async getEventsInRange(from: Date, to: Date, limit = 100): Promise<SourceEventSummary[]> {
    if (!this.client) throw new Error('SourcePgClient: not connected');
    const res = await this.client.query<{
      event_id: string; title: string | null; date: string | null; date_to: string | null;
      is_online: boolean; official: boolean; venue_name: string | null; venue_town: string | null;
      venue_country: string | null; creator_name: string | null; follower_count: number;
    }>(QUERY_EVENTS_IN_RANGE, [from.toISOString(), to.toISOString(), limit]);
    return res.rows.map((r) => ({
      eventId: r.event_id, title: r.title, date: r.date, dateTo: r.date_to,
      isOnline: r.is_online, official: r.official, venueName: r.venue_name,
      venueTown: r.venue_town, venueCountry: r.venue_country,
      creatorName: r.creator_name, followerCount: r.follower_count,
    }));
  }

  /** Active (non-deleted) venues + their active-event counts. On-demand list. */
  async listVenues(limit = 200): Promise<SourceVenue[]> {
    if (!this.client) throw new Error('SourcePgClient: not connected');
    const res = await this.client.query<{
      venue_id: string; name: string | null; town: string | null; country: string | null;
      venue_type: string | null; special_venue: boolean; event_count: number;
    }>(QUERY_VENUES, [limit]);
    return res.rows.map((r) => ({
      venueId: r.venue_id, name: r.name, town: r.town, country: r.country,
      venueType: r.venue_type, specialVenue: r.special_venue, eventCount: r.event_count,
    }));
  }

  /**
   * Full member profile for the Members-360 detail view (identity + transmission
   * lineage + contact). Operator-gated at the route. Returns null if not found.
   */
  async getMemberDetail(userId: string): Promise<SourceMemberDetail | null> {
    if (!this.client) throw new Error('SourcePgClient: not connected');
    const res = await this.client.query<{
      user_id: string; email: string | null; registered_at: string | null;
      last_activity_at: string | null; is_active: boolean; display_name: string | null;
      language: string | null; is_instructor: boolean; location: string | null;
      year_of_transmission: string | null; place_of_transmission: string | null;
      transmission_giver: string | null; contact: string | null;
    }>(QUERY_MEMBER_DETAIL, [userId]);
    if (res.rowCount === 0) return null;
    const r = res.rows[0];
    return {
      userId: r.user_id, email: r.email, displayName: r.display_name, language: r.language,
      registeredAt: r.registered_at, lastActivityAt: r.last_activity_at, isActive: r.is_active,
      isInstructor: r.is_instructor, location: r.location,
      yearOfTransmission: r.year_of_transmission, placeOfTransmission: r.place_of_transmission,
      transmissionGiver: r.transmission_giver, contact: r.contact,
    };
  }

  /**
   * Probe — verify connectivity + permission to read core tables.
   */
  async probe(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      await this.connect();
      // Test that we have at least SELECT on core_appuser
      await this.client!.query('SELECT 1 FROM core_appuser LIMIT 1');
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - start, error: errMessage(err) };
    }
  }
}
