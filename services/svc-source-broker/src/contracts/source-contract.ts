/**
 * Source contract — the Anti-Corruption Layer's explicit dependency declaration.
 *
 * WHY THIS EXISTS (the "seam" pattern):
 *   The broker reads from an external system (source-postgres) that is actively
 *   migrated by another team. Without a declared contract, the broker depends on
 *   IMPLICIT knowledge of the foreign schema — column names hardcoded in SQL
 *   strings. When the source renames `last_activity → last_active_at`, the broker
 *   fails SILENTLY: queries return NULL, engagement collapses to zero, no error.
 *
 *   This module makes the dependency EXPLICIT and VERSIONED. The broker declares
 *   exactly which tables + columns it expects. A drift canary (drift-canary.ts)
 *   validates the contract against information_schema at startup + before each
 *   sync. On drift: fail loud, refuse to advance the cursor (don't write zeros),
 *   alarm. This converts a silent data-corruption failure into a loud, actionable
 *   one AT THE SEAM — not three layers downstream as an empty dashboard.
 *
 * PROVIDER-AGNOSTIC:
 *   The contract shape is generic. A future source (Salesforce, HubSpot) declares
 *   its own SourceContract; the same drift canary + cursor + idempotency +
 *   observability machinery applies. This is the reusable "seam", not a one-off
 *   source integration.
 *
 * This is a consumer-driven contract: the CONSUMER (broker) declares what it
 * needs, and that declaration becomes the test. The provider may evolve freely
 * as long as it keeps satisfying the contract.
 */

/** A single column the broker depends on. */
export interface ColumnSpec {
  /** Column name as it must appear in information_schema.columns. */
  name: string;
  /**
   * Expected data_type (information_schema.data_type literal). Examples:
   *   'uuid', 'text', 'character varying', 'boolean', 'integer',
   *   'timestamp with time zone', 'date'.
   * Type drift is reported as a WARNING (soft signal) — the high-value check
   * is existence. A rename/drop is the dangerous mode; a type change is rarer
   * and often compatible (varchar↔text).
   */
  type: string;
  /**
   * Acceptable alternative type literals (e.g. text ≈ character varying).
   * If the live type matches name + any of (type | acceptableTypes), no warning.
   */
  acceptableTypes?: string[];
}

/** A table + the columns the broker reads from it. */
export interface TableContract {
  table: string;
  columns: ColumnSpec[];
}

/** The full contract for one external source. */
export interface SourceContract {
  /** Logical source identifier — matches the source_slug used in aisha-db. */
  source: string;
  /** Postgres schema the tables live in (usually 'public'). */
  schema: string;
  tables: TableContract[];
}

// text and character varying are interchangeable for our reads.
const TEXTUAL = { type: 'text', acceptableTypes: ['character varying'] };
const UUID = { type: 'uuid' };
const TSTZ = { type: 'timestamp with time zone' };
const BOOL = { type: 'boolean' };
const DATE = { type: 'date' };

/**
 * The source-api source contract. Lists EXACTLY the tables + columns the broker's
 * aggregation queries (clients/pg-readonly-driver.ts) read. Keep in sync with the SQL —
 * this is the single place foreign-schema knowledge is declared.
 *
 * Reconciled against live source-postgres 2026-07-01: the old `core_newfollow`
 * and `stats_statsnapshots` tables were dropped upstream — follows now live in
 * `core_profile_sympathize` (user↔user) + `core_event_followers` (profile↔event),
 * and community KPIs are computed on the fly from the base tables.
 */
export const SOURCE_CONTRACT: SourceContract = {
  source: 'source-api',
  schema: 'public',
  tables: [
    {
      table: 'core_appuser',
      columns: [
        { name: 'id', ...UUID },
        { name: 'email', ...TEXTUAL },
        { name: 'last_activity', ...TSTZ },
        { name: 'is_active', ...BOOL },
        { name: 'date_joined', ...TSTZ },
        // period statistics: topic created_by = '<id> - <first> <last>' (listStats)
        { name: 'first_name', ...TEXTUAL },
        { name: 'last_name', ...TEXTUAL },
      ],
    },
    {
      table: 'core_profile',
      columns: [
        { name: 'id', ...UUID },
        { name: 'user_id', ...UUID },
        { name: 'full_name', ...TEXTUAL },
        { name: 'language', ...TEXTUAL },
        { name: 'since', ...TSTZ },
        { name: 'is_instructor', ...BOOL },
        // Members-360 detail fields (getMemberDetail).
        { name: 'location', ...TEXTUAL },
        { name: 'year_of_transmission', ...TEXTUAL },
        { name: 'place_of_transmission', ...TEXTUAL },
        { name: 'transmission_giver', ...TEXTUAL },
        { name: 'contact', ...TEXTUAL },
      ],
    },
    {
      table: 'core_event',
      columns: [
        { name: 'id', ...UUID },
        { name: 'created_by_id', ...UUID },
        { name: 'cancelled', ...BOOL },
        { name: 'created_at', ...TSTZ },
        { name: 'date', ...TSTZ },
        // Events-list fields (getEventsInRange).
        { name: 'title', ...TEXTUAL },
        { name: 'date_to', ...TSTZ },
        { name: 'is_online', ...BOOL },
        { name: 'official', ...BOOL },
        { name: 'venue_id', ...UUID },
      ],
    },
    {
      // user↔user follows (a profile "sympathizes with" another profile).
      table: 'core_profile_sympathize',
      columns: [
        { name: 'from_profile_id', ...UUID },
        { name: 'to_profile_id', ...UUID },
      ],
    },
    {
      // profile↔event follows (audience of a user's events).
      table: 'core_event_followers',
      columns: [
        { name: 'event_id', ...UUID },
        { name: 'profile_id', ...UUID },
      ],
    },
    {
      // per-user daily activity log (drives app_accesses_30d/90d).
      table: 'core_userstatistics',
      columns: [
        { name: 'user_id', ...UUID },
        { name: 'date', ...DATE },
      ],
    },
    {
      // posts (community posts_total in the KPI snapshot).
      table: 'collaboration_post',
      columns: [
        { name: 'deleted_at', ...TSTZ },
      ],
    },
    {
      // venues (events area + venue title/town on the events list).
      table: 'core_venue',
      columns: [
        { name: 'id', ...UUID },
        { name: 'title', ...TEXTUAL },
        { name: 'town', ...TEXTUAL },
        { name: 'country', ...TEXTUAL },
        { name: 'venue_type', ...TEXTUAL },
        { name: 'special_venue', ...BOOL },
        { name: 'deleted', ...BOOL },
      ],
    },
    // ── period statistics (listStats: topics / events created in a month) ────
    { table: 'collaboration_topic', columns: [
        { name: 'id', ...UUID }, { name: 'title', ...TEXTUAL }, { name: 'created_at', ...TSTZ },
        { name: 'created_by_id', ...UUID }, { name: 'deleted', ...BOOL }, { name: 'is_private', ...BOOL },
    ] },
    { table: 'collaboration_followtopics', columns: [ { name: 'topic_id', ...UUID }, { name: 'user_id', ...UUID } ] },
    { table: 'collaboration_workspace', columns: [ { name: 'id', ...UUID }, { name: 'topic_id', ...UUID } ] },
    { table: 'collaboration_channel',   columns: [ { name: 'id', ...UUID }, { name: 'workspace_id', ...UUID } ] },
    { table: 'core_topic2tag', columns: [ { name: 'topic_id', ...UUID }, { name: 'tag_id', ...UUID } ] },
    { table: 'core_event2tag', columns: [ { name: 'event_id', ...UUID }, { name: 'tag_id', ...UUID } ] },
    { table: 'core_tag',       columns: [ { name: 'id', ...UUID }, { name: 'name', ...TEXTUAL } ] },
  ],
};
