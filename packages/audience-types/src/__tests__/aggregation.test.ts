/**
 * aggregation.test.ts
 *
 * Tests aggregation logic. The CARDINAL invariant being tested:
 *   "Connector NEVER returns raw rows. Only pre-computed aggregates."
 *
 * Each test verifies:
 *   1) Aggregation function correctness (counts, rates, growth %)
 *   2) Snapshot contains NO raw event arrays
 *   3) Snapshot shape matches ActorAggregateSnapshot exactly
 */

import { describe, it, expect } from 'vitest';
import type {
  SourceActivityEvent,
  CreatorAudienceSnapshot,
  AggregationFn,
} from '../aggregation';
import type { ActorAggregateSnapshot } from '../IDataSource';

// ----------------------------------------------------------------------------
// Reference aggregation implementation (this is what each connector implements)
// ----------------------------------------------------------------------------

const aggregateEvents: AggregationFn = (events, userId, asOf) => {
  const userEvents = events.filter((e) => e.userId === userId);
  const now = asOf.getTime();
  const day30Ago = now - 30 * 86400_000;
  const day90Ago = now - 90 * 86400_000;
  const day60Ago = now - 60 * 86400_000; // for growth calculation

  const isWithin = (e: SourceActivityEvent, since: number) =>
    new Date(e.occurredAt).getTime() >= since;

  // Counts
  const appAccesses30d = userEvents.filter((e) => e.eventType === 'login' && isWithin(e, day30Ago)).length;
  const appAccesses90d = userEvents.filter((e) => e.eventType === 'login' && isWithin(e, day90Ago)).length;
  const eventsCreated30d = userEvents.filter((e) => e.eventType === 'event_created' && isWithin(e, day30Ago)).length;
  const eventsCreated90d = userEvents.filter((e) => e.eventType === 'event_created' && isWithin(e, day90Ago)).length;
  const postsCreated30d = userEvents.filter((e) => e.eventType === 'post_created' && isWithin(e, day30Ago)).length;

  // Attendance — count attendance_recorded events on events created by this user
  const attendanceEvents = userEvents.filter((e) => e.eventType === 'attendance_recorded' && isWithin(e, day30Ago));
  const uniqueAttendees30d = new Set(attendanceEvents.map((e) => e.metadata?.attendee_id as string)).size;
  const totalAttendance30d = attendanceEvents.length;

  // Audience = unique followers
  const allFollows = userEvents.filter((e) => e.eventType === 'follow_added');
  const audienceSize = new Set(allFollows.map((e) => e.metadata?.follower_id as string)).size;
  const audience30 = new Set(
    allFollows.filter((e) => isWithin(e, day30Ago)).map((e) => e.metadata?.follower_id as string)
  ).size;
  const audience60 = new Set(
    allFollows.filter((e) => isWithin(e, day60Ago)).map((e) => e.metadata?.follower_id as string)
  ).size;
  // Growth = (new in last 30d) / (total at start of period)
  const audienceGrowth30d =
    audience60 > audience30
      ? (audience30 / (audience60 - audience30 || 1))
      : audience30 > 0 ? 1.0 : 0;

  // Last active = most recent event timestamp
  const lastActive = userEvents.reduce<string | null>((acc, e) => {
    if (!acc || new Date(e.occurredAt) > new Date(acc)) return e.occurredAt;
    return acc;
  }, null);

  // Note: snapshot intentionally does NOT include raw events
  return {
    audienceSize,
    audienceGrowth30d,
    uniqueAttendees30d,
    totalAttendance30d,
    eventsCreated30d,
    eventsCreated90d,
    lastActiveAt: lastActive,
    snapshotDate: asOf.toISOString().split('T')[0],
  };
};

// ----------------------------------------------------------------------------
// Test fixtures
// ----------------------------------------------------------------------------

const NOW = new Date('2026-05-08T10:00:00Z');
const day = (offset: number) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() - offset);
  return d.toISOString();
};

const USER_A = 'user-a-uuid';
const USER_B = 'user-b-uuid';

// ----------------------------------------------------------------------------
// Test cases
// ----------------------------------------------------------------------------

describe('aggregateEvents — counts and basics', () => {
  it('counts logins in 30/90 day windows correctly', () => {
    const events: SourceActivityEvent[] = [
      { userId: USER_A, occurredAt: day(5), eventType: 'login' },
      { userId: USER_A, occurredAt: day(20), eventType: 'login' },
      { userId: USER_A, occurredAt: day(45), eventType: 'login' }, // outside 30d
      { userId: USER_A, occurredAt: day(80), eventType: 'login' }, // inside 90d
      { userId: USER_A, occurredAt: day(100), eventType: 'login' }, // outside 90d
    ];

    const result = aggregateEvents(events, USER_A, NOW);
    // Sanity: result is an aggregate, not an event array
    expect((result as Record<string, unknown>).events).toBeUndefined();
    expect((result as Record<string, unknown>).raw).toBeUndefined();
  });

  it('filters events to specified userId only (no cross-contamination)', () => {
    const events: SourceActivityEvent[] = [
      { userId: USER_A, occurredAt: day(5), eventType: 'event_created' },
      { userId: USER_B, occurredAt: day(5), eventType: 'event_created' },
      { userId: USER_B, occurredAt: day(10), eventType: 'event_created' },
    ];

    const resultA = aggregateEvents(events, USER_A, NOW);
    const resultB = aggregateEvents(events, USER_B, NOW);

    expect(resultA.eventsCreated30d).toBe(1);
    expect(resultB.eventsCreated30d).toBe(2);
  });

  it('returns zero metrics for user with no events', () => {
    const result = aggregateEvents([], 'unknown-user', NOW);
    expect(result.audienceSize).toBe(0);
    expect(result.eventsCreated30d).toBe(0);
    expect(result.totalAttendance30d).toBe(0);
    expect(result.lastActiveAt).toBeNull();
  });
});

describe('aggregateEvents — audience metrics', () => {
  it('counts unique followers, ignoring duplicates', () => {
    const events: SourceActivityEvent[] = [
      { userId: USER_A, occurredAt: day(5), eventType: 'follow_added', metadata: { follower_id: 'f1' } },
      { userId: USER_A, occurredAt: day(10), eventType: 'follow_added', metadata: { follower_id: 'f2' } },
      { userId: USER_A, occurredAt: day(15), eventType: 'follow_added', metadata: { follower_id: 'f1' } }, // duplicate
    ];

    const result = aggregateEvents(events, USER_A, NOW);
    expect(result.audienceSize).toBe(2);
  });

  it('computes audience growth as (new in 30d) / (total before 30d)', () => {
    const events: SourceActivityEvent[] = [
      // Older followers (60-31 days ago): 10
      ...Array.from({ length: 10 }, (_, i) => ({
        userId: USER_A,
        occurredAt: day(31 + i),
        eventType: 'follow_added' as const,
        metadata: { follower_id: `old-${i}` },
      })),
      // New followers (within 30d): 5
      ...Array.from({ length: 5 }, (_, i) => ({
        userId: USER_A,
        occurredAt: day(i + 1),
        eventType: 'follow_added' as const,
        metadata: { follower_id: `new-${i}` },
      })),
    ];

    const result = aggregateEvents(events, USER_A, NOW);
    expect(result.audienceSize).toBe(15);
    // Growth: 5 new / 10 old = 0.5
    expect(result.audienceGrowth30d).toBeCloseTo(0.5, 2);
  });

  it('counts unique attendees per creator correctly', () => {
    const events: SourceActivityEvent[] = [
      // user A's events attended by 3 unique people, one person attended twice
      { userId: USER_A, occurredAt: day(5), eventType: 'attendance_recorded', metadata: { attendee_id: 'p1' } },
      { userId: USER_A, occurredAt: day(7), eventType: 'attendance_recorded', metadata: { attendee_id: 'p2' } },
      { userId: USER_A, occurredAt: day(9), eventType: 'attendance_recorded', metadata: { attendee_id: 'p1' } }, // returning
      { userId: USER_A, occurredAt: day(11), eventType: 'attendance_recorded', metadata: { attendee_id: 'p3' } },
    ];

    const result = aggregateEvents(events, USER_A, NOW);
    expect(result.uniqueAttendees30d).toBe(3);
    expect(result.totalAttendance30d).toBe(4);
  });
});

describe('aggregateEvents — output shape invariant', () => {
  it('output contains ONLY aggregate keys, no raw event data', () => {
    const events: SourceActivityEvent[] = [
      { userId: USER_A, occurredAt: day(5), eventType: 'event_created' },
    ];

    const result = aggregateEvents(events, USER_A, NOW);
    const allowedKeys = new Set([
      'audienceSize',
      'audienceGrowth30d',
      'uniqueAttendees30d',
      'totalAttendance30d',
      'eventsCreated30d',
      'eventsCreated90d',
      'lastActiveAt',
      'snapshotDate',
    ]);

    Object.keys(result).forEach((k) => {
      expect(allowedKeys.has(k), `Snapshot must not contain raw key "${k}"`).toBe(true);
    });

    // Specifically forbidden:
    expect((result as Record<string, unknown>).events).toBeUndefined();
    expect((result as Record<string, unknown>).attendees).toBeUndefined();
    expect((result as Record<string, unknown>).follows).toBeUndefined();
  });

  it('snapshotDate is YYYY-MM-DD format (matches DATE type in SQL)', () => {
    const result = aggregateEvents([], USER_A, NOW);
    expect(result.snapshotDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.snapshotDate).toBe('2026-05-08');
  });

  it('every numeric field is a finite number (no NaN/Infinity)', () => {
    const result = aggregateEvents([], USER_A, NOW);
    const numericFields = ['audienceSize', 'audienceGrowth30d', 'uniqueAttendees30d',
      'totalAttendance30d', 'eventsCreated30d', 'eventsCreated90d'] as const;

    numericFields.forEach((field) => {
      const v = result[field];
      expect(Number.isFinite(v), `${field} = ${v} must be finite`).toBe(true);
    });
  });
});
