/**
 * Integration Tests for Supabase Row Level Security (RLS) Policies
 * 
 * These tests verify that RLS policies work correctly by simulating
 * real database queries with different authenticated user contexts.
 * 
 * IMPORTANT: These tests use mock implementations that simulate the behavior
 * of actual RLS policies. In a real CI/CD pipeline, these should be run
 * against a test Supabase instance with actual database connections.
 * 
 * Test Coverage:
 * - Anonymous user access restrictions
 * - Member data isolation (can only access own data)
 * - Partner data access with consent verification
 * - Admin full access capabilities
 * - Cross-user data access prevention
 * - sensitive data access controls
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock user contexts for testing
interface MockUser {
  id: string;
  email: string;
  role: 'member' | 'practitioner' | 'admin' | 'researcher';
}

interface MockAuthContext {
  user: MockUser | null;
  session: { access_token: string } | null;
}

/** Generic row type for mock database records used in RLS policy tests */
type MockRow = Record<string, unknown>;

// Simulate different auth contexts
const authContexts: Record<string, MockAuthContext> = {
  anonymous: {
    user: null,
    session: null,
  },
  member1: {
    user: { id: 'user-member-001', email: 'member1@example.com', role: 'member' },
    session: { access_token: 'mock-token-member1' },
  },
  member2: {
    user: { id: 'user-member-002', email: 'member2@example.com', role: 'member' },
    session: { access_token: 'mock-token-member2' },
  },
  partner: {
    user: { id: 'user-partner-001', email: 'partner@example.com', role: 'practitioner' },
    session: { access_token: 'mock-token-partner' },
  },
  researcher: {
    user: { id: 'user-researcher-001', email: 'researcher@example.com', role: 'researcher' },
    session: { access_token: 'mock-token-researcher' },
  },
  admin: {
    user: { id: 'user-admin-001', email: 'admin@example.com', role: 'admin' },
    session: { access_token: 'mock-token-admin' },
  },
};

// Mock database data
const mockDatabase = {
  profiles: [
    { id: 'profile-001', user_id: 'user-member-001', display_name: 'Member One', primary_diagnosis: 'RA', email: 'member1@example.com' },
    { id: 'profile-002', user_id: 'user-member-002', display_name: 'Member Two', primary_diagnosis: 'Lupus', email: 'member2@example.com' },
    { id: 'profile-003', user_id: 'user-partner-001', display_name: 'Partner Doc', primary_diagnosis: null, email: 'partner@example.com' },
    { id: 'profile-004', user_id: 'user-admin-001', display_name: 'Admin User', primary_diagnosis: null, email: 'admin@example.com' },
  ],
  health_check_ins: [
    { id: 'checkin-001', user_id: 'user-member-001', pain_level: 5, energy_level: 7, check_in_date: '2024-01-15', notes: 'Feeling better today' },
    { id: 'checkin-002', user_id: 'user-member-001', pain_level: 3, energy_level: 8, check_in_date: '2024-01-16', notes: null },
    { id: 'checkin-003', user_id: 'user-member-002', pain_level: 7, energy_level: 4, check_in_date: '2024-01-15', notes: 'Bad flare up' },
    { id: 'checkin-004', user_id: 'user-member-002', pain_level: 6, energy_level: 5, check_in_date: '2024-01-16', notes: null },
  ],
  lab_results: [
    { id: 'lab-001', user_id: 'user-member-001', test_name: 'CRP', value: 2.5, reference_min: 0, reference_max: 3, test_date: '2024-01-10' },
    { id: 'lab-002', user_id: 'user-member-001', test_name: 'ESR', value: 15, reference_min: 0, reference_max: 20, test_date: '2024-01-10' },
    { id: 'lab-003', user_id: 'user-member-002', test_name: 'CRP', value: 8.2, reference_min: 0, reference_max: 3, test_date: '2024-01-10' },
  ],
  memberships: [
    { id: 'membership-001', user_id: 'user-member-001', tier: 'premium', status: 'active', payment_type: 'subscription' },
    { id: 'membership-002', user_id: 'user-member-002', tier: 'free', status: 'active', payment_type: 'free' },
  ],
  data_sharing_consents: [
    { id: 'consent-001', user_id: 'user-member-001', partner_id: 'partner-profile-001', granted: true, revoked_at: null },
    { id: 'consent-002', user_id: 'user-member-002', partner_id: 'partner-profile-001', granted: true, revoked_at: '2024-01-10T00:00:00Z' },
  ],
  partner_profiles: [
    { id: 'partner-profile-001', user_id: 'user-partner-001', display_name: 'Dr. Smith', is_visible: true, specialty: 'Rheumatology' },
    { id: 'partner-profile-002', user_id: 'user-partner-002', display_name: 'Hidden Doctor', is_visible: false, specialty: 'Internal' },
  ],
  partner_appointments: [
    {
      id: 'appt-001',
      partner_id: 'partner-profile-001',
      member_id: 'user-member-001',
      appointment_date: '2024-01-20',
      start_time: '10:00',
      end_time: '10:30',
      appointment_type: 'online',
      status: 'confirmed',
      service: 'Consultation',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    },
    {
      id: 'appt-002',
      partner_id: 'partner-profile-001',
      member_id: 'user-member-002',
      appointment_date: '2024-01-21',
      start_time: '11:00',
      end_time: '11:30',
      appointment_type: 'in_person',
      status: 'pending',
      service: null,
      created_at: '2024-01-02T00:00:00Z',
      updated_at: '2024-01-02T00:00:00Z',
    },
  ],
  partner_appointment_notes: [
    {
      appointment_id: 'appt-001',
      notes: 'Private appointment note',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    },
    {
      appointment_id: 'appt-002',
      notes: 'Another private note',
      created_at: '2024-01-02T00:00:00Z',
      updated_at: '2024-01-02T00:00:00Z',
    },
  ],
  products: [
    { id: 'product-001', name: 'Retisin', price: 1500, is_active: true, description: 'Vitamin A product' },
    { id: 'product-002', name: 'Lyastin', price: 1200, is_active: true, description: 'Immune support' },
    { id: 'product-003', name: 'Draft Product', price: 0, is_active: false, description: 'Not yet released' },
  ],
  studies: [
    { id: 'study-001', title: 'RA Treatment Study', is_published: true, status: 'recruiting' },
    { id: 'study-002', title: 'Internal Research', is_published: false, status: 'draft' },
  ],
  study_registrations: [
    { id: 'registration-001', user_id: 'user-member-001', study_id: 'study-001', status: 'enrolled' },
    { id: 'registration-002', user_id: 'user-member-002', study_id: 'study-001', status: 'pending' },
  ],
  orders: [
    { id: 'order-001', user_id: 'user-member-001', total: 1500, status: 'completed' },
    { id: 'order-002', user_id: 'user-member-002', total: 2700, status: 'pending' },
  ],
  user_roles: [
    { id: 'role-001', user_id: 'user-member-001', role: 'member' },
    { id: 'role-002', user_id: 'user-member-002', role: 'member' },
    { id: 'role-003', user_id: 'user-partner-001', role: 'practitioner' },
    { id: 'role-004', user_id: 'user-admin-001', role: 'admin' },
    { id: 'role-005', user_id: 'user-researcher-001', role: 'researcher' },
  ],
  audit_journal: [
    { id: 'audit-001', user_id: 'user-admin-001', action_type: 'view', entity_type: 'profile', entity_id: 'profile-001', area: 'users' },
    { id: 'audit-002', user_id: 'user-member-001', action_type: 'update', entity_type: 'profile', entity_id: 'profile-001', area: 'users' },
  ],
};

/**
 * RLS Policy Simulator
 * 
 * This function simulates the behavior of actual Supabase RLS policies.
 * Each table has specific policies that control read/write access.
 */
function applyRLSPolicy<T extends Record<string, unknown>>(
  table: keyof typeof mockDatabase,
  operation: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE',
  authContext: MockAuthContext,
  data?: T
): MockRow[] {
  const tableData = mockDatabase[table] as MockRow[];
  const userId = authContext.user?.id;
  const userRole = authContext.user?.role;

  // Anonymous user policies
  if (!authContext.user || !authContext.session) {
    switch (table) {
      case 'products':
        // Public can view active products
        return tableData.filter((row: MockRow) => row.is_active === true);
      case 'partner_profiles':
        // Public can view visible partner profiles
        return tableData.filter((row: MockRow) => row.is_visible === true);
      case 'studies':
        // Public can view published studies
        return tableData.filter((row: MockRow) => row.is_published === true);
      default:
        // All other tables require authentication
        return [];
    }
  }

  // Admin has full access to all tables
  if (userRole === 'admin') {
    return tableData;
  }

  // Role-specific policies
  switch (table) {
    case 'profiles':
      // Users can only access their own profile
      // Researchers can access anonymized data
      if (userRole === 'researcher') {
        return tableData.map((row: MockRow) => ({
          ...row,
          email: '[REDACTED]',
          display_name: `User ${String(row.id).slice(-4)}`,
        }));
      }
      return tableData.filter((row: MockRow) => row.user_id === userId);

    case 'health_check_ins':
      // Members can only access their own check-ins
      // Partners can access check-ins for users who granted consent
      if (userRole === 'practitioner') {
        const partnerProfile = mockDatabase.partner_profiles.find(
          (p) => p.user_id === userId
        );
        if (!partnerProfile) return [];
        
        const consentedUsers = mockDatabase.data_sharing_consents
          .filter((c) => 
            c.partner_id === partnerProfile.id && 
            c.granted && 
            !c.revoked_at
          )
          .map((c) => c.user_id);
        
        return tableData.filter((row: MockRow) => consentedUsers.includes(row.user_id as string));
      }
      if (userRole === 'researcher') {
        // Researchers get anonymized aggregate data
        return tableData.map((row: MockRow) => ({
          ...row,
          user_id: '[ANONYMIZED]',
          notes: null,
        }));
      }
      return tableData.filter((row: MockRow) => row.user_id === userId);

    case 'lab_results':
      // Same as health_check_ins - users own data or consented to partner
      if (userRole === 'practitioner') {
        const partnerProfile = mockDatabase.partner_profiles.find(
          (p) => p.user_id === userId
        );
        if (!partnerProfile) return [];
        
        const consentedUsers = mockDatabase.data_sharing_consents
          .filter((c) => 
            c.partner_id === partnerProfile.id && 
            c.granted && 
            !c.revoked_at
          )
          .map((c) => c.user_id);
        
        return tableData.filter((row: MockRow) => consentedUsers.includes(row.user_id as string));
      }
      return tableData.filter((row: MockRow) => row.user_id === userId);

    case 'memberships':
      // Users can only access their own membership
      return tableData.filter((row: MockRow) => row.user_id === userId);

    case 'data_sharing_consents':
      // Users can see consents they granted
      // Partners can see consents granted to them
      if (userRole === 'practitioner') {
        const partnerProfile = mockDatabase.partner_profiles.find(
          (p) => p.user_id === userId
        );
        if (!partnerProfile) return [];
        return tableData.filter((row: MockRow) => row.partner_id === partnerProfile.id);
      }
      return tableData.filter((row: MockRow) => row.user_id === userId);

    case 'partner_profiles':
      // Public profiles are visible to all authenticated users
      // Own profile is always visible
      return tableData.filter((row: MockRow) => row.is_visible || row.user_id === userId);

    case 'partner_appointments':
      // Partners can view appointments with them
      // Members can view their own appointments
      if (userRole === 'practitioner') {
        const partnerProfile = mockDatabase.partner_profiles.find(
          (p) => p.user_id === userId
        );
        if (!partnerProfile) return [];
        return tableData.filter((row: MockRow) => row.partner_id === partnerProfile.id);
      }
      return tableData.filter((row: MockRow) => row.member_id === userId);

    case 'partner_appointment_notes':
      // Notes are isolated from partner_appointments.
      // Members can read notes for their own appointments.
      // Partners should not have direct SELECT access; use audited RPC instead.
      if (userRole === 'practitioner') return [];
      return tableData.filter((row: MockRow) => {
        const appt = mockDatabase.partner_appointments.find(
          (a) => a.id === row.appointment_id
        );
        return appt?.member_id === userId;
      });

    case 'products':
      // All authenticated users can see active products
      return tableData.filter((row: MockRow) => row.is_active === true);

    case 'studies':
      // All can see published studies
      // Researchers can see all studies
      if (userRole === 'researcher') return tableData;
      return tableData.filter((row: MockRow) => row.is_published === true);

    case 'study_registrations':
      // Users can see their own registrations
      // Researchers can see all registrations (anonymized)
      if (userRole === 'researcher') {
        return tableData.map((row: MockRow) => ({
          ...row,
          user_id: '[ANONYMIZED]',
        }));
      }
      return tableData.filter((row: MockRow) => row.user_id === userId);

    case 'orders':
      // Users can only see their own orders
      return tableData.filter((row: MockRow) => row.user_id === userId);

    case 'user_roles':
      // Users can see their own role
      return tableData.filter((row: MockRow) => row.user_id === userId);

    case 'audit_journal':
      // Only admins can access audit journal (handled above)
      return [];

    default:
      return [];
  }
}

describe('RLS Integration Tests - Anonymous Access', () => {
  const ctx = authContexts.anonymous;

  it('allows anonymous access to active products', () => {
    const products = applyRLSPolicy('products', 'SELECT', ctx);
    expect(products).toHaveLength(2);
    expect(products.every((p: MockRow) => p.is_active)).toBe(true);
    expect(products.find((p: MockRow) => p.name === 'Draft Product')).toBeUndefined();
  });

  it('allows anonymous access to visible partner profiles', () => {
    const partners = applyRLSPolicy('partner_profiles', 'SELECT', ctx);
    expect(partners).toHaveLength(1);
    expect(partners[0]).toHaveProperty('is_visible', true);
  });

  it('allows anonymous access to published studies', () => {
    const studies = applyRLSPolicy('studies', 'SELECT', ctx);
    expect(studies).toHaveLength(1);
    expect(studies[0]).toHaveProperty('is_published', true);
  });

  it('denies anonymous access to profiles', () => {
    const profiles = applyRLSPolicy('profiles', 'SELECT', ctx);
    expect(profiles).toHaveLength(0);
  });

  it('denies anonymous access to health check-ins', () => {
    const checkIns = applyRLSPolicy('health_check_ins', 'SELECT', ctx);
    expect(checkIns).toHaveLength(0);
  });

  it('denies anonymous access to lab results', () => {
    const labs = applyRLSPolicy('lab_results', 'SELECT', ctx);
    expect(labs).toHaveLength(0);
  });

  it('denies anonymous access to memberships', () => {
    const memberships = applyRLSPolicy('memberships', 'SELECT', ctx);
    expect(memberships).toHaveLength(0);
  });

  it('denies anonymous access to orders', () => {
    const orders = applyRLSPolicy('orders', 'SELECT', ctx);
    expect(orders).toHaveLength(0);
  });

  it('denies anonymous access to audit journal', () => {
    const audits = applyRLSPolicy('audit_journal', 'SELECT', ctx);
    expect(audits).toHaveLength(0);
  });
});

describe('RLS Integration Tests - Member Access', () => {
  const member1 = authContexts.member1;
  const member2 = authContexts.member2;

  describe('Profile access', () => {
    it('member can access own profile', () => {
      const profiles = applyRLSPolicy('profiles', 'SELECT', member1);
      expect(profiles).toHaveLength(1);
      expect(profiles[0]).toHaveProperty('user_id', 'user-member-001');
    });

    it('member cannot access other user profiles', () => {
      const profiles = applyRLSPolicy('profiles', 'SELECT', member1);
      const otherProfile = profiles.find((p: MockRow) => p.user_id === 'user-member-002');
      expect(otherProfile).toBeUndefined();
    });
  });

  describe('Tracking check-in access', () => {
    it('member can access own health check-ins', () => {
      const checkIns = applyRLSPolicy('health_check_ins', 'SELECT', member1);
      expect(checkIns).toHaveLength(2);
      expect(checkIns.every((c: MockRow) => c.user_id === 'user-member-001')).toBe(true);
    });

    it('member cannot access other user health check-ins', () => {
      const checkIns = applyRLSPolicy('health_check_ins', 'SELECT', member1);
      const otherCheckIn = checkIns.find((c: MockRow) => c.user_id === 'user-member-002');
      expect(otherCheckIn).toBeUndefined();
    });
  });

  describe('Lab results access', () => {
    it('member can access own lab results', () => {
      const labs = applyRLSPolicy('lab_results', 'SELECT', member1);
      expect(labs).toHaveLength(2);
      expect(labs.every((l: MockRow) => l.user_id === 'user-member-001')).toBe(true);
    });

    it('member cannot access other user lab results', () => {
      const labs = applyRLSPolicy('lab_results', 'SELECT', member2);
      const otherLab = labs.find((l: MockRow) => l.user_id === 'user-member-001');
      expect(otherLab).toBeUndefined();
    });
  });

  describe('Membership access', () => {
    it('member can access own membership', () => {
      const memberships = applyRLSPolicy('memberships', 'SELECT', member1);
      expect(memberships).toHaveLength(1);
      expect(memberships[0]).toHaveProperty('tier', 'premium');
    });
  });

  describe('Order access', () => {
    it('member can access own orders', () => {
      const orders = applyRLSPolicy('orders', 'SELECT', member1);
      expect(orders).toHaveLength(1);
      expect(orders[0]).toHaveProperty('user_id', 'user-member-001');
    });

    it('member cannot access other user orders', () => {
      const orders = applyRLSPolicy('orders', 'SELECT', member1);
      const otherOrder = orders.find((o: MockRow) => o.user_id === 'user-member-002');
      expect(otherOrder).toBeUndefined();
    });
  });

  describe('Study registration access', () => {
    it('member can access own study registrations', () => {
      const registrations = applyRLSPolicy('study_registrations', 'SELECT', member1);
      expect(registrations).toHaveLength(1);
      expect(registrations[0]).toHaveProperty('status', 'enrolled');
    });
  });

  describe('Data sharing consent access', () => {
    it('member can see their own consents', () => {
      const consents = applyRLSPolicy('data_sharing_consents', 'SELECT', member1);
      expect(consents).toHaveLength(1);
      expect(consents[0]).toHaveProperty('user_id', 'user-member-001');
    });
  });
});

describe('RLS Integration Tests - Partner Access', () => {
  const partner = authContexts.partner;

  describe('Tracking data access with consent', () => {
    it('partner can access health check-ins for consented users', () => {
      const checkIns = applyRLSPolicy('health_check_ins', 'SELECT', partner);
      // Only member1 has active consent
      expect(checkIns).toHaveLength(2);
      expect(checkIns.every((c: MockRow) => c.user_id === 'user-member-001')).toBe(true);
    });

    it('partner cannot access health check-ins for revoked consent users', () => {
      const checkIns = applyRLSPolicy('health_check_ins', 'SELECT', partner);
      // member2 revoked consent
      const member2CheckIn = checkIns.find((c: MockRow) => c.user_id === 'user-member-002');
      expect(member2CheckIn).toBeUndefined();
    });

    it('partner can access lab results for consented users', () => {
      const labs = applyRLSPolicy('lab_results', 'SELECT', partner);
      expect(labs).toHaveLength(2);
      expect(labs.every((l: MockRow) => l.user_id === 'user-member-001')).toBe(true);
    });
  });

  describe('Consent visibility', () => {
    it('partner can see consents granted to them', () => {
      const consents = applyRLSPolicy('data_sharing_consents', 'SELECT', partner);
      expect(consents).toHaveLength(2);
    });
  });

  describe('Appointment notes isolation', () => {
    it('partner cannot directly read appointment notes table', () => {
      const notes = applyRLSPolicy('partner_appointment_notes', 'SELECT', partner);
      expect(notes).toHaveLength(0);
    });
  });
});

describe('RLS Integration Tests - Member appointment notes', () => {
  const member1 = authContexts.member1;

  it('member can read notes for their own appointments only', () => {
    const notes = applyRLSPolicy('partner_appointment_notes', 'SELECT', member1);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toHaveProperty('appointment_id', 'appt-001');
  });
});

describe('RLS Integration Tests - Researcher Access', () => {
  const researcher = authContexts.researcher;

  describe('Anonymized data access', () => {
    it('researcher gets anonymized profile data', () => {
      const profiles = applyRLSPolicy('profiles', 'SELECT', researcher);
      expect(profiles).toHaveLength(4);
      profiles.forEach((profile: MockRow) => {
        expect(profile.email).toBe('[REDACTED]');
        expect(profile.display_name).toMatch(/^User .{4}$/);
      });
    });

    it('researcher gets anonymized health check-in data', () => {
      const checkIns = applyRLSPolicy('health_check_ins', 'SELECT', researcher);
      expect(checkIns).toHaveLength(4);
      checkIns.forEach((checkIn: MockRow) => {
        expect(checkIn.user_id).toBe('[ANONYMIZED]');
        expect(checkIn.notes).toBeNull();
      });
    });

    it('researcher gets anonymized study registration data', () => {
      const registrations = applyRLSPolicy('study_registrations', 'SELECT', researcher);
      expect(registrations).toHaveLength(2);
      registrations.forEach((registration: MockRow) => {
        expect(registration.user_id).toBe('[ANONYMIZED]');
      });
    });

    it('researcher can access all studies including unpublished', () => {
      const studies = applyRLSPolicy('studies', 'SELECT', researcher);
      expect(studies).toHaveLength(2);
    });
  });
});

describe('RLS Integration Tests - Admin Access', () => {
  const admin = authContexts.admin;

  it('admin can access all profiles', () => {
    const profiles = applyRLSPolicy('profiles', 'SELECT', admin);
    expect(profiles).toHaveLength(4);
  });

  it('admin can access all health check-ins', () => {
    const checkIns = applyRLSPolicy('health_check_ins', 'SELECT', admin);
    expect(checkIns).toHaveLength(4);
  });

  it('admin can access all lab results', () => {
    const labs = applyRLSPolicy('lab_results', 'SELECT', admin);
    expect(labs).toHaveLength(3);
  });

  it('admin can access all memberships', () => {
    const memberships = applyRLSPolicy('memberships', 'SELECT', admin);
    expect(memberships).toHaveLength(2);
  });

  it('admin can access all orders', () => {
    const orders = applyRLSPolicy('orders', 'SELECT', admin);
    expect(orders).toHaveLength(2);
  });

  it('admin can access audit journal', () => {
    const audits = applyRLSPolicy('audit_journal', 'SELECT', admin);
    expect(audits).toHaveLength(2);
  });

  it('admin can access all products including inactive', () => {
    const products = applyRLSPolicy('products', 'SELECT', admin);
    expect(products).toHaveLength(3);
  });

  it('admin can access all studies including unpublished', () => {
    const studies = applyRLSPolicy('studies', 'SELECT', admin);
    expect(studies).toHaveLength(2);
  });

  it('admin can access all partner profiles including hidden', () => {
    const partners = applyRLSPolicy('partner_profiles', 'SELECT', admin);
    expect(partners).toHaveLength(2);
  });
});

describe('RLS Integration Tests - Cross-User Data Isolation', () => {
  it('ensures complete data isolation between members', () => {
    const member1Data = {
      profiles: applyRLSPolicy('profiles', 'SELECT', authContexts.member1),
      checkIns: applyRLSPolicy('health_check_ins', 'SELECT', authContexts.member1),
      labs: applyRLSPolicy('lab_results', 'SELECT', authContexts.member1),
      memberships: applyRLSPolicy('memberships', 'SELECT', authContexts.member1),
      orders: applyRLSPolicy('orders', 'SELECT', authContexts.member1),
    };

    const member2Data = {
      profiles: applyRLSPolicy('profiles', 'SELECT', authContexts.member2),
      checkIns: applyRLSPolicy('health_check_ins', 'SELECT', authContexts.member2),
      labs: applyRLSPolicy('lab_results', 'SELECT', authContexts.member2),
      memberships: applyRLSPolicy('memberships', 'SELECT', authContexts.member2),
      orders: applyRLSPolicy('orders', 'SELECT', authContexts.member2),
    };

    // Verify no overlap in user IDs
    const member1UserIds = new Set([
      ...member1Data.profiles.map((p: MockRow) => p.user_id),
      ...member1Data.checkIns.map((c: MockRow) => c.user_id),
      ...member1Data.labs.map((l: MockRow) => l.user_id),
      ...member1Data.memberships.map((m: MockRow) => m.user_id),
      ...member1Data.orders.map((o: MockRow) => o.user_id),
    ]);

    const member2UserIds = new Set([
      ...member2Data.profiles.map((p: MockRow) => p.user_id),
      ...member2Data.checkIns.map((c: MockRow) => c.user_id),
      ...member2Data.labs.map((l: MockRow) => l.user_id),
      ...member2Data.memberships.map((m: MockRow) => m.user_id),
      ...member2Data.orders.map((o: MockRow) => o.user_id),
    ]);

    // Sets should not intersect
    const intersection = Array.from(member1UserIds).filter(id => member2UserIds.has(id));
    expect(intersection).toHaveLength(0);
  });
});

describe('RLS Integration Tests - sensitive data Access Controls', () => {
  describe('sensitive data isolation', () => {
    it('prevents sensitive data leakage to anonymous users', () => {
      const checkIns = applyRLSPolicy('health_check_ins', 'SELECT', authContexts.anonymous);
      const labs = applyRLSPolicy('lab_results', 'SELECT', authContexts.anonymous);
      const profiles = applyRLSPolicy('profiles', 'SELECT', authContexts.anonymous);

      expect(checkIns).toHaveLength(0);
      expect(labs).toHaveLength(0);
      expect(profiles).toHaveLength(0);
    });

    it('prevents sensitive data access for partners without consent', () => {
      // Create a partner with no consents
      const partnerWithoutConsent: MockAuthContext = {
        user: { id: 'user-partner-002', email: 'partner2@example.com', role: 'practitioner' },
        session: { access_token: 'mock-token-partner2' },
      };

      const checkIns = applyRLSPolicy('health_check_ins', 'SELECT', partnerWithoutConsent);
      const labs = applyRLSPolicy('lab_results', 'SELECT', partnerWithoutConsent);

      expect(checkIns).toHaveLength(0);
      expect(labs).toHaveLength(0);
    });

    it('respects consent revocation', () => {
      // member2 revoked consent - partner should not see their data
      const partnerCheckIns = applyRLSPolicy('health_check_ins', 'SELECT', authContexts.partner);
      const member2CheckIns = partnerCheckIns.filter((c: MockRow) => c.user_id === 'user-member-002');
      expect(member2CheckIns).toHaveLength(0);
    });

    it('researchers cannot access identifiable sensitive data', () => {
      const profiles = applyRLSPolicy('profiles', 'SELECT', authContexts.researcher);
      const checkIns = applyRLSPolicy('health_check_ins', 'SELECT', authContexts.researcher);

      // All emails should be redacted
      profiles.forEach((profile: MockRow) => {
        expect(profile.email).toBe('[REDACTED]');
      });

      // All user_ids should be anonymized and notes removed
      checkIns.forEach((checkIn: MockRow) => {
        expect(checkIn.user_id).toBe('[ANONYMIZED]');
        expect(checkIn.notes).toBeNull();
      });
    });
  });

  describe('Audit trail for sensitive data access', () => {
    it('audit journal is only accessible to admins', () => {
      const memberAudit = applyRLSPolicy('audit_journal', 'SELECT', authContexts.member1);
      const partnerAudit = applyRLSPolicy('audit_journal', 'SELECT', authContexts.partner);
      const researcherAudit = applyRLSPolicy('audit_journal', 'SELECT', authContexts.researcher);
      const adminAudit = applyRLSPolicy('audit_journal', 'SELECT', authContexts.admin);

      expect(memberAudit).toHaveLength(0);
      expect(partnerAudit).toHaveLength(0);
      expect(researcherAudit).toHaveLength(0);
      expect(adminAudit.length).toBeGreaterThan(0);
    });
  });
});

describe('RLS Integration Tests - Policy Consistency', () => {
  it('user_roles table restricts access to own role only', () => {
    const member1Roles = applyRLSPolicy('user_roles', 'SELECT', authContexts.member1);
    const member2Roles = applyRLSPolicy('user_roles', 'SELECT', authContexts.member2);
    const partnerRoles = applyRLSPolicy('user_roles', 'SELECT', authContexts.partner);
    const adminRoles = applyRLSPolicy('user_roles', 'SELECT', authContexts.admin);

    expect(member1Roles).toHaveLength(1);
    expect(member1Roles[0]).toHaveProperty('role', 'member');

    expect(member2Roles).toHaveLength(1);
    expect(member2Roles[0]).toHaveProperty('role', 'member');

    expect(partnerRoles).toHaveLength(1);
    expect(partnerRoles[0]).toHaveProperty('role', 'practitioner');

    // Admin sees all
    expect(adminRoles).toHaveLength(5);
  });

  it('all tables return empty array for null auth context', () => {
    const tables = [
      'profiles', 'health_check_ins', 'lab_results', 'memberships',
      'orders', 'study_registrations', 'user_roles', 'audit_journal'
    ] as const;

    const nullAuthContext: MockAuthContext = { user: null, session: null };

    tables.forEach(table => {
      const result = applyRLSPolicy(table, 'SELECT', nullAuthContext);
      // All these tables require authentication, so result should be empty
      expect(result).toHaveLength(0);
    });
  });
});
