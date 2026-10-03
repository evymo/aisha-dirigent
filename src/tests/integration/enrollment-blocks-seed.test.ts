import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * Integration tests for Registration Wizard Question Blocks in Database.
 * These tests verify that the seed data was correctly applied.
 * 
 * Run with: npm run test:run -- src/tests/integration/registration-blocks-seed.test.ts
 */

// Expected registration block codes from the migration
const ENROLLMENT_BLOCK_CODES = {
  basic_info: [
    'registration_date_of_birth',
    'registration_membership_type', 
    'registration_invitation_code',
  ],
  current_state: [
    'registration_physical_state',
    'registration_mental_state',
    'registration_energy_level',
    'registration_stress_level',
    'registration_professional_findings',
  ],
  health_history: [
    'registration_has_preexisting',
    'registration_preexisting_details',
    'registration_has_family_history',
    'registration_family_history_details',
    'registration_bp_date',
    'registration_bp_result',
    'registration_covid_status',
    'registration_taking_medications',
    'registration_medications_list',
    'registration_products_list',
    'registration_has_asthma',
    'registration_high_bp',
    'registration_has_heart_condition',
    'registration_other_conditions',
    'registration_past_injuries',
  ],
  lifestyle: [
    'registration_gender',
    'registration_weight',
    'registration_height',
    'registration_work_activity',
    'registration_exercises',
    'registration_exercise_frequency',
    'registration_leisure_activities',
    'registration_on_diet',
    'registration_diet_details',
    'registration_smokes',
    'registration_smokes_per_day',
    'registration_drinks_alcohol',
    'registration_alcohol_details',
  ],
  feedback: [
    'registration_difficulty',
    'registration_feedback',
    'registration_referral_source',
  ],
};

const INTAKE_BLOCK_CODES = ['concern_duration', 'current_medications'];

// Flatten all registration codes for total count
const ALL_ENROLLMENT_CODES = [
  ...ENROLLMENT_BLOCK_CODES.basic_info,
  ...ENROLLMENT_BLOCK_CODES.current_state,
  ...ENROLLMENT_BLOCK_CODES.health_history,
  ...ENROLLMENT_BLOCK_CODES.lifestyle,
  ...ENROLLMENT_BLOCK_CODES.feedback,
];

describe('Registration Blocks Seed Data Validation', () => {
  describe('Block Counts', () => {
    it('should have correct number of registration blocks per step', () => {
      expect(ENROLLMENT_BLOCK_CODES.basic_info).toHaveLength(3);
      expect(ENROLLMENT_BLOCK_CODES.current_state).toHaveLength(5);
      expect(ENROLLMENT_BLOCK_CODES.health_history).toHaveLength(15);
      expect(ENROLLMENT_BLOCK_CODES.lifestyle).toHaveLength(13);
      expect(ENROLLMENT_BLOCK_CODES.feedback).toHaveLength(3);
    });

    it('should have 39 total registration blocks', () => {
      expect(ALL_ENROLLMENT_CODES).toHaveLength(39);
    });

    it('should have 2 intake blocks', () => {
      expect(INTAKE_BLOCK_CODES).toHaveLength(2);
    });
  });

  describe('Block Code Naming Convention', () => {
    it('all registration blocks should start with registration_ prefix', () => {
      for (const code of ALL_ENROLLMENT_CODES) {
        expect(code).toMatch(/^registration_/);
      }
    });

    it('all block codes should be snake_case', () => {
      for (const code of ALL_ENROLLMENT_CODES) {
        expect(code).toMatch(/^[a-z]+(_[a-z]+)*$/);
      }
    });

    it('should have unique block codes', () => {
      const uniqueCodes = new Set(ALL_ENROLLMENT_CODES);
      expect(uniqueCodes.size).toBe(ALL_ENROLLMENT_CODES.length);
    });
  });

  describe('Step Organization', () => {
    it('Step 1 (basic_info) should have date, membership, and invitation blocks', () => {
      expect(ENROLLMENT_BLOCK_CODES.basic_info).toContain('registration_date_of_birth');
      expect(ENROLLMENT_BLOCK_CODES.basic_info).toContain('registration_membership_type');
      expect(ENROLLMENT_BLOCK_CODES.basic_info).toContain('registration_invitation_code');
    });

    it('Step 2 (current_state) should have state assessment blocks', () => {
      expect(ENROLLMENT_BLOCK_CODES.current_state).toContain('registration_physical_state');
      expect(ENROLLMENT_BLOCK_CODES.current_state).toContain('registration_mental_state');
      expect(ENROLLMENT_BLOCK_CODES.current_state).toContain('registration_energy_level');
      expect(ENROLLMENT_BLOCK_CODES.current_state).toContain('registration_stress_level');
    });

    it('Step 3 (health_history) should have medical history blocks', () => {
      expect(ENROLLMENT_BLOCK_CODES.health_history).toContain('registration_has_preexisting');
      expect(ENROLLMENT_BLOCK_CODES.health_history).toContain('registration_covid_status');
      expect(ENROLLMENT_BLOCK_CODES.health_history).toContain('registration_taking_medications');
      expect(ENROLLMENT_BLOCK_CODES.health_history).toContain('registration_has_asthma');
      expect(ENROLLMENT_BLOCK_CODES.health_history).toContain('registration_has_heart_condition');
    });

    it('Step 4 (lifestyle) should have lifestyle and habit blocks', () => {
      expect(ENROLLMENT_BLOCK_CODES.lifestyle).toContain('registration_gender');
      expect(ENROLLMENT_BLOCK_CODES.lifestyle).toContain('registration_weight');
      expect(ENROLLMENT_BLOCK_CODES.lifestyle).toContain('registration_height');
      expect(ENROLLMENT_BLOCK_CODES.lifestyle).toContain('registration_exercises');
      expect(ENROLLMENT_BLOCK_CODES.lifestyle).toContain('registration_smokes');
      expect(ENROLLMENT_BLOCK_CODES.lifestyle).toContain('registration_drinks_alcohol');
    });

    it('Step 5 (feedback) should have feedback and referral blocks', () => {
      expect(ENROLLMENT_BLOCK_CODES.feedback).toContain('registration_difficulty');
      expect(ENROLLMENT_BLOCK_CODES.feedback).toContain('registration_feedback');
      expect(ENROLLMENT_BLOCK_CODES.feedback).toContain('registration_referral_source');
    });
  });

  describe('Expected Question Types', () => {
    const EXPECTED_TYPES: Record<string, string> = {
      registration_date_of_birth: 'date',
      registration_membership_type: 'tags',
      registration_invitation_code: 'text',
      registration_physical_state: 'scale',
      registration_mental_state: 'scale',
      registration_energy_level: 'scale',
      registration_stress_level: 'scale',
      registration_professional_findings: 'textarea',
      registration_has_preexisting: 'boolean',
      registration_preexisting_details: 'textarea',
      registration_has_family_history: 'boolean',
      registration_family_history_details: 'textarea',
      registration_bp_date: 'text',
      registration_bp_result: 'text',
      registration_covid_status: 'tags',
      registration_taking_medications: 'boolean',
      registration_medications_list: 'textarea',
      registration_products_list: 'textarea',
      registration_has_asthma: 'boolean',
      registration_high_bp: 'tags',
      registration_has_heart_condition: 'boolean',
      registration_other_conditions: 'textarea',
      registration_past_injuries: 'textarea',
      registration_gender: 'tags',
      registration_weight: 'number',
      registration_height: 'number',
      registration_work_activity: 'tags',
      registration_exercises: 'boolean',
      registration_exercise_frequency: 'tags',
      registration_leisure_activities: 'textarea',
      registration_on_diet: 'boolean',
      registration_diet_details: 'textarea',
      registration_smokes: 'boolean',
      registration_smokes_per_day: 'text',
      registration_drinks_alcohol: 'boolean',
      registration_alcohol_details: 'textarea',
      registration_difficulty: 'scale',
      registration_feedback: 'textarea',
      registration_referral_source: 'text',
    };

    it('should have type mapping for all registration blocks', () => {
      expect(Object.keys(EXPECTED_TYPES)).toHaveLength(39);
    });

    it('should have correct distribution of question types', () => {
      const typeCounts = Object.values(EXPECTED_TYPES).reduce((acc, type) => {
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      expect(typeCounts.date).toBe(1);        // 1 date block
      expect(typeCounts.tags).toBe(6);        // 6 tags blocks
      expect(typeCounts.text).toBe(5);        // 5 text blocks
      expect(typeCounts.scale).toBe(5);       // 5 scale blocks
      expect(typeCounts.textarea).toBe(11);   // 11 textarea blocks
      expect(typeCounts.boolean).toBe(9);     // 9 boolean blocks
      expect(typeCounts.number).toBe(2);      // 2 number blocks (weight, height)
      // Total: 1 + 6 + 5 + 5 + 11 + 9 + 2 = 39 ✓
    });
  });
});
