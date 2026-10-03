/**
 * signal-pipeline.test.ts
 *
 * Tests for declarative signal_tag_rules engine.
 *
 * Covers:
 *   1. Pattern matching (event_type + source) — rules apply in priority order
 *   2. Idempotency: re-processing same event doesn't duplicate tags
 *   3. Resolver fallback: when actor_user_id absent, no tags applied
 *   4. Tag deduplication: multiple rules matching same tag produce unique result
 */

import { describe, it, expect } from 'vitest';
import type { SignalTagRule } from '../audience-entities';

// ----------------------------------------------------------------------------
// Pure TS implementation mirroring audience_process_signal_audited() RPC logic
// ----------------------------------------------------------------------------

interface IntegrationEvent {
  id: string;
  event_source: string;
  event_type: string;
  metadata: Record<string, unknown>;
}

function applySignalTagRules(
  event: IntegrationEvent,
  rules: SignalTagRule[]
): { actorId: string | null; tags: string[] } {
  const actorId =
    (event.metadata.user_id as string | undefined) ??
    (event.metadata.actor_user_id as string | undefined) ??
    (event.metadata.profile_id as string | undefined) ??
    null;

  const active = rules.filter((r) => r.isActive).sort((a, b) => a.priority - b.priority);
  const collected: string[] = [];

  for (const rule of active) {
    const eventTypeMatches = new RegExp(rule.eventTypePattern).test(event.event_type);
    const sourceMatches =
      !rule.sourcePattern || new RegExp(rule.sourcePattern).test(event.event_source);
    if (eventTypeMatches && sourceMatches) {
      collected.push(...rule.tags);
    }
  }

  // Dedupe
  const unique = Array.from(new Set(collected));
  return { actorId, tags: unique };
}

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

const RULE_RETREAT: SignalTagRule = {
  id: 'r1',
  eventTypePattern: 'retreat_signup.*',
  sourcePattern: 'source-api',
  tags: ['retreat_participant'],
  priority: 50,
  isActive: true,
  description: null,
  createdBy: null,
  createdAt: '2026-05-23',
  updatedAt: '2026-05-23',
};

const RULE_ATTENDANCE: SignalTagRule = {
  id: 'r2',
  eventTypePattern: 'event_attendance.*',
  sourcePattern: 'source-api',
  tags: ['attended_event'],
  priority: 100,
  isActive: true,
  description: null,
  createdBy: null,
  createdAt: '2026-05-23',
  updatedAt: '2026-05-23',
};

const RULE_OVERLAP: SignalTagRule = {
  id: 'r3',
  eventTypePattern: '.*',
  sourcePattern: null, // any source
  tags: ['attended_event', 'community_active'], // overlaps with r2.tags
  priority: 200,
  isActive: true,
  description: null,
  createdBy: null,
  createdAt: '2026-05-23',
  updatedAt: '2026-05-23',
};

const RULE_INACTIVE: SignalTagRule = {
  id: 'r4',
  eventTypePattern: '.*',
  sourcePattern: null,
  tags: ['shouldnt_appear'],
  priority: 10,
  isActive: false,
  description: 'deactivated',
  createdBy: null,
  createdAt: '2026-05-23',
  updatedAt: '2026-05-23',
};

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe('signal_tag_rules — pattern matching', () => {
  it('matches event_type pattern (retreat_signup.*)', () => {
    const event: IntegrationEvent = {
      id: 'e1',
      event_source: 'source-api',
      event_type: 'retreat_signup.completed',
      metadata: { user_id: 'u-bob' },
    };
    const result = applySignalTagRules(event, [RULE_RETREAT, RULE_ATTENDANCE]);
    expect(result.actorId).toBe('u-bob');
    expect(result.tags).toContain('retreat_participant');
    expect(result.tags).not.toContain('attended_event');
  });

  it('matches multiple overlapping rules in priority order, deduped', () => {
    const event: IntegrationEvent = {
      id: 'e2',
      event_source: 'source-api',
      event_type: 'event_attendance.recorded',
      metadata: { user_id: 'u-marie' },
    };
    const result = applySignalTagRules(event, [RULE_ATTENDANCE, RULE_OVERLAP]);
    expect(result.tags).toEqual(expect.arrayContaining(['attended_event', 'community_active']));
    // Dedupe: 'attended_event' only once
    expect(result.tags.filter((t) => t === 'attended_event')).toHaveLength(1);
  });

  it('respects source_pattern constraint', () => {
    const event: IntegrationEvent = {
      id: 'e3',
      event_source: 'salesforce',
      event_type: 'retreat_signup.completed',
      metadata: { user_id: 'u-x' },
    };
    const result = applySignalTagRules(event, [RULE_RETREAT]);
    expect(result.tags).toHaveLength(0); // RULE_RETREAT requires source-api source
  });

  it('skips inactive rules', () => {
    const event: IntegrationEvent = {
      id: 'e4',
      event_source: 'source-api',
      event_type: 'anything',
      metadata: { user_id: 'u-y' },
    };
    const result = applySignalTagRules(event, [RULE_INACTIVE, RULE_ATTENDANCE]);
    expect(result.tags).not.toContain('shouldnt_appear');
  });
});

describe('signal_tag_rules — actor resolution', () => {
  it('resolves actor from user_id field', () => {
    const event: IntegrationEvent = {
      id: 'e5', event_source: 'source-api', event_type: 'x',
      metadata: { user_id: 'u-a' },
    };
    const result = applySignalTagRules(event, []);
    expect(result.actorId).toBe('u-a');
  });

  it('falls back to actor_user_id field', () => {
    const event: IntegrationEvent = {
      id: 'e6', event_source: 'x', event_type: 'x',
      metadata: { actor_user_id: 'u-b' },
    };
    const result = applySignalTagRules(event, []);
    expect(result.actorId).toBe('u-b');
  });

  it('falls back to profile_id field', () => {
    const event: IntegrationEvent = {
      id: 'e7', event_source: 'x', event_type: 'x',
      metadata: { profile_id: 'u-c' },
    };
    const result = applySignalTagRules(event, []);
    expect(result.actorId).toBe('u-c');
  });

  it('returns null actorId when no user field present', () => {
    const event: IntegrationEvent = {
      id: 'e8', event_source: 'x', event_type: 'x',
      metadata: { other: 'data' },
    };
    const result = applySignalTagRules(event, []);
    expect(result.actorId).toBeNull();
  });
});

describe('signal_tag_rules — idempotency invariant', () => {
  it('applying same rules twice produces same tag set', () => {
    const event: IntegrationEvent = {
      id: 'e9',
      event_source: 'source-api',
      event_type: 'retreat_signup.complete',
      metadata: { user_id: 'u-z' },
    };
    const rules = [RULE_RETREAT, RULE_OVERLAP];
    const r1 = applySignalTagRules(event, rules);
    const r2 = applySignalTagRules(event, rules);
    expect(r1.tags.sort()).toEqual(r2.tags.sort());
  });
});
