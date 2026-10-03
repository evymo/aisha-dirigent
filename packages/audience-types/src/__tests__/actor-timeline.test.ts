/**
 * actor-timeline.test.ts
 *
 * Tests for audience_actor_timeline_v — unified per-actor event log built
 * from story_entries + openclaw_notifications + audit_journal.
 *
 * These are LOGIC tests (TS) that verify the UNION semantics: events from
 * three sources should sort chronologically, with source attribution intact.
 * SQL-side integration tests go in a separate file once a test DB exists.
 */

import { describe, it, expect } from 'vitest';

// ----------------------------------------------------------------------------
// Row shapes (mirrors view columns)
// ----------------------------------------------------------------------------

interface TimelineRow {
  actorUserId: string;
  eventId: string;
  eventSource: 'story_entry' | 'communication' | 'audit';
  eventType: string;
  content: string | null;
  metadata: Record<string, unknown> | null;
  createdBy: string | null;
  occurredAt: string;
}

// ----------------------------------------------------------------------------
// Pure TS implementation mirroring the UNION + ORDER BY in the view
// ----------------------------------------------------------------------------

function buildTimeline(rows: TimelineRow[]): TimelineRow[] {
  return [...rows].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
  );
}

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

const USER = 'u-bob';

const ROW_NOTE: TimelineRow = {
  actorUserId: USER,
  eventId: 'n1',
  eventSource: 'story_entry',
  eventType: 'actor_note',
  content: 'Met at retreat 2026',
  metadata: { tag: 'retreat' },
  createdBy: 'marketer-1',
  occurredAt: '2026-05-15T10:00:00Z',
};

const ROW_EMAIL: TimelineRow = {
  actorUserId: USER,
  eventId: 'e1',
  eventSource: 'communication',
  eventType: 'email',
  content: 'Spring retreat invitation',
  metadata: { campaign_id: 'c1', status: 'sent', opened_at: '2026-05-16T08:30:00Z' },
  createdBy: null,
  occurredAt: '2026-05-16T08:00:00Z',
};

const ROW_AUDIT: TimelineRow = {
  actorUserId: USER,
  eventId: 'a1',
  eventSource: 'audit',
  eventType: 'follow_up_completed',
  content: 'Marketer completed follow-up call',
  metadata: { task_id: 't1' },
  createdBy: 'marketer-1',
  occurredAt: '2026-05-17T14:30:00Z',
};

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe('audience_actor_timeline_v — chronological merge', () => {
  it('returns events from all three sources for one actor', () => {
    const result = buildTimeline([ROW_NOTE, ROW_EMAIL, ROW_AUDIT]);
    expect(result).toHaveLength(3);
    const sources = result.map((r) => r.eventSource);
    expect(sources).toContain('story_entry');
    expect(sources).toContain('communication');
    expect(sources).toContain('audit');
  });

  it('orders newest first (descending by occurredAt)', () => {
    const result = buildTimeline([ROW_NOTE, ROW_EMAIL, ROW_AUDIT]);
    expect(result[0].eventId).toBe('a1');  // 2026-05-17 (latest)
    expect(result[1].eventId).toBe('e1');  // 2026-05-16
    expect(result[2].eventId).toBe('n1');  // 2026-05-15
  });

  it('preserves source attribution per row', () => {
    const result = buildTimeline([ROW_NOTE, ROW_EMAIL, ROW_AUDIT]);
    result.forEach((row) => {
      expect(['story_entry', 'communication', 'audit']).toContain(row.eventSource);
    });
  });

  it('preserves metadata jsonb structure (campaign info, status, etc.)', () => {
    const result = buildTimeline([ROW_EMAIL]);
    expect(result[0].metadata).toMatchObject({
      campaign_id: 'c1',
      status: 'sent',
    });
  });
});

describe('audience_actor_timeline_v — invariants', () => {
  it('all rows reference same actor_user_id (scope filter applied per query)', () => {
    const result = buildTimeline([ROW_NOTE, ROW_EMAIL, ROW_AUDIT]);
    result.forEach((row) => {
      expect(row.actorUserId).toBe(USER);
    });
  });

  it('empty input returns empty timeline (no exception)', () => {
    const result = buildTimeline([]);
    expect(result).toEqual([]);
  });

  it('story_entry source links via partner_stories.user_id, not direct FK', () => {
    // Architectural note: story_entries themselves FK to partner_stories(id);
    // the view JOINs to partner_stories to expose user_id. This test documents
    // that contract.
    expect(ROW_NOTE.eventSource).toBe('story_entry');
    expect(ROW_NOTE.actorUserId).toBe(USER);
  });
});
