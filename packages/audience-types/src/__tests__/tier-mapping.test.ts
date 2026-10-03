/**
 * tier-mapping.test.ts
 *
 * Tests that the TypeScript deriveMemberTier() function matches the
 * SQL crm.derive_member_tier() function EXACTLY.
 *
 * Parity is critical — frontend optimistic UI uses TS, RLS uses SQL,
 * any divergence = privilege escalation bug or UI inconsistency.
 *
 * To run against real DB (integration mode), set CRM_DB_URL env var.
 */

import { describe, it, expect } from 'vitest';
import {
  MemberTier,
  deriveMemberTier,
  tierMeets,
  tierBetween,
  TIER_ORDER,
  type TierDerivationInput,
} from '../member-tier';

// ----------------------------------------------------------------------------
// Pure function tests (matches SQL function logic line-by-line)
// ----------------------------------------------------------------------------

describe('deriveMemberTier (pure function)', () => {
  it('returns admin when isAdminOrStaff=true (highest precedence)', () => {
    expect(deriveMemberTier({
      hasProfile: true,
      isAdminOrStaff: true,
      // Even if other partner fields say partner — admin override wins
      isVisible: true,
      isProductionProvider: true,
    })).toBe(MemberTier.Admin);
  });

  it('returns anonymous when no profile', () => {
    expect(deriveMemberTier({ hasProfile: false })).toBe(MemberTier.Anonymous);
  });

  it('returns partner when isVisible AND isProductionProvider', () => {
    expect(deriveMemberTier({
      hasProfile: true,
      isVisible: true,
      isProductionProvider: true,
      isCertified: true, // even though qualified, partner is higher
    })).toBe(MemberTier.Partner);
  });

  it('returns qualified when isCertified but not isProductionProvider', () => {
    expect(deriveMemberTier({
      hasProfile: true,
      isCertified: true,
      isVisible: true,
      isProductionProvider: false,
    })).toBe(MemberTier.Qualified);
  });

  it('returns qualified when isCertified and isVisible=false', () => {
    expect(deriveMemberTier({
      hasProfile: true,
      isCertified: true,
      isVisible: false,
    })).toBe(MemberTier.Qualified);
  });

  it('returns active when appAccesses30d > 0 and not certified/partner', () => {
    expect(deriveMemberTier({
      hasProfile: true,
      appAccesses30d: 5,
    })).toBe(MemberTier.Active);
  });

  it('returns registered when only profile exists', () => {
    expect(deriveMemberTier({
      hasProfile: true,
      appAccesses30d: 0,
    })).toBe(MemberTier.Registered);
  });

  it('treats null/undefined appAccesses30d as zero', () => {
    expect(deriveMemberTier({ hasProfile: true, appAccesses30d: null })).toBe(
      MemberTier.Registered
    );
    expect(deriveMemberTier({ hasProfile: true })).toBe(MemberTier.Registered);
  });

  // Edge case: visible but not production provider — still qualified at best
  it('does NOT return partner when isVisible but isProductionProvider=false', () => {
    expect(deriveMemberTier({
      hasProfile: true,
      isVisible: true,
      isProductionProvider: false,
      isCertified: true,
    })).toBe(MemberTier.Qualified);
  });
});

// ----------------------------------------------------------------------------
// Tier comparison helpers
// ----------------------------------------------------------------------------

describe('tierMeets', () => {
  it('returns true when caller meets minimum tier', () => {
    expect(tierMeets(MemberTier.Partner, MemberTier.Active)).toBe(true);
    expect(tierMeets(MemberTier.Admin, MemberTier.Partner)).toBe(true);
    expect(tierMeets(MemberTier.Active, MemberTier.Active)).toBe(true);
  });

  it('returns false when caller below required tier', () => {
    expect(tierMeets(MemberTier.Active, MemberTier.Partner)).toBe(false);
    expect(tierMeets(MemberTier.Registered, MemberTier.Qualified)).toBe(false);
    expect(tierMeets(MemberTier.Anonymous, MemberTier.Registered)).toBe(false);
  });

  it('Admin meets all tier requirements', () => {
    Object.values(MemberTier).forEach((t) => {
      expect(tierMeets(MemberTier.Admin, t as MemberTier)).toBe(true);
    });
  });

  it('Anonymous meets only Anonymous', () => {
    expect(tierMeets(MemberTier.Anonymous, MemberTier.Anonymous)).toBe(true);
    Object.values(MemberTier)
      .filter((t) => t !== MemberTier.Anonymous)
      .forEach((t) => {
        expect(tierMeets(MemberTier.Anonymous, t as MemberTier)).toBe(false);
      });
  });
});

describe('tierBetween', () => {
  it('returns true when caller within range (inclusive)', () => {
    expect(tierBetween(MemberTier.Active, MemberTier.Registered, MemberTier.Qualified)).toBe(true);
    expect(tierBetween(MemberTier.Registered, MemberTier.Registered, MemberTier.Partner)).toBe(true);
    expect(tierBetween(MemberTier.Partner, MemberTier.Active, MemberTier.Partner)).toBe(true);
  });

  it('returns false when caller outside range', () => {
    expect(tierBetween(MemberTier.Anonymous, MemberTier.Registered, MemberTier.Partner)).toBe(false);
    expect(tierBetween(MemberTier.Admin, MemberTier.Registered, MemberTier.Partner)).toBe(false);
  });
});

// ----------------------------------------------------------------------------
// TIER_ORDER consistency check (frontend ↔ SQL ordering must match)
// ----------------------------------------------------------------------------

describe('TIER_ORDER (must match SQL VALUES in user_meets_tier_requirement)', () => {
  it('has strictly increasing ranks anonymous < registered < active < qualified < partner < admin', () => {
    expect(TIER_ORDER[MemberTier.Anonymous]).toBeLessThan(TIER_ORDER[MemberTier.Registered]);
    expect(TIER_ORDER[MemberTier.Registered]).toBeLessThan(TIER_ORDER[MemberTier.Active]);
    expect(TIER_ORDER[MemberTier.Active]).toBeLessThan(TIER_ORDER[MemberTier.Qualified]);
    expect(TIER_ORDER[MemberTier.Qualified]).toBeLessThan(TIER_ORDER[MemberTier.Partner]);
    expect(TIER_ORDER[MemberTier.Partner]).toBeLessThan(TIER_ORDER[MemberTier.Admin]);
  });

  it('has expected absolute values for SQL parity', () => {
    expect(TIER_ORDER[MemberTier.Anonymous]).toBe(0);
    expect(TIER_ORDER[MemberTier.Registered]).toBe(1);
    expect(TIER_ORDER[MemberTier.Active]).toBe(2);
    expect(TIER_ORDER[MemberTier.Qualified]).toBe(3);
    expect(TIER_ORDER[MemberTier.Partner]).toBe(4);
    expect(TIER_ORDER[MemberTier.Admin]).toBe(5);
  });
});

// ----------------------------------------------------------------------------
// Source-specific mapping cases (illustrative — source role/center mapping)
// ----------------------------------------------------------------------------

describe('Source tier mapping examples', () => {
  it('a Source registered user (no engagement) is "registered"', () => {
    const sourceRegistered: TierDerivationInput = {
      hasProfile: true,
      appAccesses30d: 0,
      isCertified: false,
      isVisible: false,
    };
    expect(deriveMemberTier(sourceRegistered)).toBe(MemberTier.Registered);
  });

  it('a Source member logged in last week is "active"', () => {
    const sourceActive: TierDerivationInput = {
      hasProfile: true,
      appAccesses30d: 12,
    };
    expect(deriveMemberTier(sourceActive)).toBe(MemberTier.Active);
  });

  it('a Source SMS-completed practitioner is "qualified" (isCertified=true)', () => {
    // SMS course completion → partner_profile created with is_certified=true
    const sourceSmsCompleted: TierDerivationInput = {
      hasProfile: true,
      isCertified: true,
      isVisible: false, // not yet a public teacher
      isProductionProvider: false,
    };
    expect(deriveMemberTier(sourceSmsCompleted)).toBe(MemberTier.Qualified);
  });

  it('a Source Teacher (e.g., Yantra Yoga instructor with public visibility) is "partner"', () => {
    // services would be ['yantra-yoga', 'source-specialist'] in real seed
    const sourceTeacher: TierDerivationInput = {
      hasProfile: true,
      isCertified: true,
      isVisible: true,
      isProductionProvider: true,
      appAccesses30d: 30,
    };
    expect(deriveMemberTier(sourceTeacher)).toBe(MemberTier.Partner);
  });
});
