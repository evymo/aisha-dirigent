/**
 * ai-tier-access.test.ts
 *
 * Tests AI interaction policy enforcement per member tier.
 *
 * Verifies:
 *   1) Anonymous cannot access AI at all
 *   2) Registered can only use chat
 *   3) Active+ can use story-read-only
 *   4) Qualified+ can create their own story
 *   5) Partner+ unlocks audience-analytics AI (creator scope)
 *   6) Context profile tier_required gates apply correctly
 *   7) Permission codes layered on top of tier requirement
 */

import { describe, it, expect } from 'vitest';
import { MemberTier, tierMeets } from '../member-tier';
import {
  DEFAULT_AI_TIER_POLICIES,
  type AiInteractionMode,
  type AiTierAccessPolicy,
} from '../aggregation';

// ----------------------------------------------------------------------------
// AI access decision helper (matches svc-ai-chat tier gate logic)
// ----------------------------------------------------------------------------

interface AccessRequest {
  callerTier: MemberTier;
  callerPermissions: string[];
  callerIsAdmin: boolean;
  desiredMode: AiInteractionMode;
  contextProfileSlug: string;
}

interface AccessDecision {
  allowed: boolean;
  reason: string;
  tokenBudget?: number;
}

const CONTEXT_PROFILES: Record<string, AiTierAccessPolicy> = {
  crm_ai_basic: {
    contextProfileSlug: 'crm_ai_basic',
    tierRequired: MemberTier.Registered,
    allowedModes: ['chat'],
    tokenBudget: 3000,
    guardrails: ['safety_basic'],
  },
  crm_ai_engaged: {
    contextProfileSlug: 'crm_ai_engaged',
    tierRequired: MemberTier.Active,
    allowedModes: ['chat', 'story-read-only'],
    tokenBudget: 6000,
    guardrails: ['safety_basic'],
  },
  crm_ai_certified: {
    contextProfileSlug: 'crm_ai_certified',
    tierRequired: MemberTier.Qualified,
    allowedModes: ['chat', 'story-read-only', 'story'],
    tokenBudget: 8000,
    guardrails: ['safety_basic', 'professional_advice'],
  },
  crm_ai_creator: {
    contextProfileSlug: 'crm_ai_creator',
    tierRequired: MemberTier.Partner,
    permissionRequired: 'view_own_audience_stats',
    allowedModes: ['chat', 'story-read-only', 'story'],
    tokenBudget: 12000,
    guardrails: ['safety_basic', 'creator_ethics', 'audience_privacy'],
  },
  crm_ai_operator: {
    contextProfileSlug: 'crm_ai_operator',
    tierRequired: MemberTier.Admin,
    allowedModes: ['chat', 'story-read-only', 'story'],
    tokenBudget: 16000,
    guardrails: ['safety_basic', 'operator_audit'],
  },
};

function decideAiAccess(req: AccessRequest): AccessDecision {
  const policy = CONTEXT_PROFILES[req.contextProfileSlug];
  if (!policy) {
    return { allowed: false, reason: 'unknown_context_profile' };
  }

  // Tier check (admin bypass on tier only)
  const effectiveTier = req.callerIsAdmin ? MemberTier.Admin : req.callerTier;
  if (!tierMeets(effectiveTier, policy.tierRequired)) {
    return {
      allowed: false,
      reason: `tier_too_low: requires ${policy.tierRequired}, has ${effectiveTier}`,
    };
  }

  // Permission check
  if (policy.permissionRequired && !req.callerPermissions.includes(policy.permissionRequired)) {
    return {
      allowed: false,
      reason: `missing_permission: ${policy.permissionRequired}`,
    };
  }

  // Mode check
  if (!policy.allowedModes.includes(req.desiredMode)) {
    return {
      allowed: false,
      reason: `mode_not_allowed: ${req.desiredMode} not in [${policy.allowedModes.join(',')}]`,
    };
  }

  // Default tier policy check (overall mode allowlist per tier)
  const tierModes = DEFAULT_AI_TIER_POLICIES[effectiveTier];
  if (!tierModes.includes(req.desiredMode)) {
    return {
      allowed: false,
      reason: `tier_default_policy_excludes_mode: ${req.desiredMode} not allowed for tier ${effectiveTier}`,
    };
  }

  return {
    allowed: true,
    reason: 'all_checks_passed',
    tokenBudget: policy.tokenBudget,
  };
}

// ----------------------------------------------------------------------------
// Test cases — happy path
// ----------------------------------------------------------------------------

describe('AI access — happy path per tier', () => {
  it('Registered user can use crm_ai_basic chat', () => {
    const d = decideAiAccess({
      callerTier: MemberTier.Registered,
      callerPermissions: [],
      callerIsAdmin: false,
      desiredMode: 'chat',
      contextProfileSlug: 'crm_ai_basic',
    });
    expect(d.allowed).toBe(true);
    expect(d.tokenBudget).toBe(3000);
  });

  it('Active user can use crm_ai_engaged chat and story-read-only', () => {
    ['chat', 'story-read-only'].forEach((mode) => {
      const d = decideAiAccess({
        callerTier: MemberTier.Active,
        callerPermissions: [],
        callerIsAdmin: false,
        desiredMode: mode as AiInteractionMode,
        contextProfileSlug: 'crm_ai_engaged',
      });
      expect(d.allowed, `mode=${mode} should be allowed`).toBe(true);
    });
  });

  it('Qualified user unlocks crm_ai_certified story mode', () => {
    const d = decideAiAccess({
      callerTier: MemberTier.Qualified,
      callerPermissions: [],
      callerIsAdmin: false,
      desiredMode: 'story',
      contextProfileSlug: 'crm_ai_certified',
    });
    expect(d.allowed).toBe(true);
    expect(d.tokenBudget).toBe(8000);
  });

  it('Partner with view_own_audience_stats can use crm_ai_creator', () => {
    const d = decideAiAccess({
      callerTier: MemberTier.Partner,
      callerPermissions: ['view_own_audience_stats'],
      callerIsAdmin: false,
      desiredMode: 'story',
      contextProfileSlug: 'crm_ai_creator',
    });
    expect(d.allowed).toBe(true);
    expect(d.tokenBudget).toBe(12000);
  });

  it('Admin can use any context profile', () => {
    Object.keys(CONTEXT_PROFILES).forEach((slug) => {
      const d = decideAiAccess({
        callerTier: MemberTier.Active, // even Active tier, but isAdmin=true overrides
        callerPermissions: ['view_own_audience_stats'],
        callerIsAdmin: true,
        desiredMode: 'chat',
        contextProfileSlug: slug,
      });
      expect(d.allowed, `slug=${slug} should be allowed for admin`).toBe(true);
    });
  });
});

// ----------------------------------------------------------------------------
// Test cases — privilege escalation prevention
// ----------------------------------------------------------------------------

describe('AI access — privilege escalation prevention', () => {
  it('Anonymous CANNOT access any AI', () => {
    Object.keys(CONTEXT_PROFILES).forEach((slug) => {
      const d = decideAiAccess({
        callerTier: MemberTier.Anonymous,
        callerPermissions: [],
        callerIsAdmin: false,
        desiredMode: 'chat',
        contextProfileSlug: slug,
      });
      expect(d.allowed, `anonymous should be denied ${slug}`).toBe(false);
    });
  });

  it('Registered CANNOT use story mode (even read-only)', () => {
    const d = decideAiAccess({
      callerTier: MemberTier.Registered,
      callerPermissions: [],
      callerIsAdmin: false,
      desiredMode: 'story-read-only',
      contextProfileSlug: 'crm_ai_engaged', // requires Active
    });
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain('tier_too_low');
  });

  it('Active CANNOT create their own story (only read-only)', () => {
    const d = decideAiAccess({
      callerTier: MemberTier.Active,
      callerPermissions: [],
      callerIsAdmin: false,
      desiredMode: 'story',
      contextProfileSlug: 'crm_ai_engaged',
    });
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain('mode_not_allowed');
  });

  it('Partner WITHOUT permission denied from crm_ai_creator', () => {
    const d = decideAiAccess({
      callerTier: MemberTier.Partner,
      callerPermissions: [], // missing view_own_audience_stats
      callerIsAdmin: false,
      desiredMode: 'chat',
      contextProfileSlug: 'crm_ai_creator',
    });
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain('missing_permission');
  });

  it('Qualified CANNOT use crm_ai_creator (tier_required=partner)', () => {
    const d = decideAiAccess({
      callerTier: MemberTier.Qualified,
      callerPermissions: ['view_own_audience_stats'],
      callerIsAdmin: false,
      desiredMode: 'chat',
      contextProfileSlug: 'crm_ai_creator',
    });
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain('tier_too_low');
  });

  it('Unknown context profile slug rejected (safe default)', () => {
    const d = decideAiAccess({
      callerTier: MemberTier.Admin,
      callerPermissions: [],
      callerIsAdmin: true,
      desiredMode: 'chat',
      contextProfileSlug: 'nonexistent_profile',
    });
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain('unknown_context_profile');
  });
});

// ----------------------------------------------------------------------------
// Tier-mode matrix (cross-product check)
// ----------------------------------------------------------------------------

describe('Tier × Mode matrix (DEFAULT_AI_TIER_POLICIES enforced)', () => {
  it('matches expected mode allowances per tier', () => {
    expect(DEFAULT_AI_TIER_POLICIES[MemberTier.Anonymous]).toEqual([]);
    expect(DEFAULT_AI_TIER_POLICIES[MemberTier.Registered]).toEqual(['chat']);
    expect(DEFAULT_AI_TIER_POLICIES[MemberTier.Active]).toEqual(['chat', 'story-read-only']);
    expect(DEFAULT_AI_TIER_POLICIES[MemberTier.Qualified]).toEqual([
      'chat',
      'story-read-only',
      'story',
    ]);
    expect(DEFAULT_AI_TIER_POLICIES[MemberTier.Partner]).toEqual([
      'chat',
      'story-read-only',
      'story',
    ]);
    expect(DEFAULT_AI_TIER_POLICIES[MemberTier.Admin]).toEqual([
      'chat',
      'story-read-only',
      'story',
    ]);
  });
});
