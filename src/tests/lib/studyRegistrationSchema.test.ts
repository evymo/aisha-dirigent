import { describe, it, expect } from 'vitest';
import {
  studyRegistrationSchema,
  healthQuestionnaireSchema,
  fullStudyRegistrationSchema,
  STUDY_ENROLLMENT_QUESTIONNAIRE_ID,
} from '@/lib/studyRegistrationSchema';

describe('studyRegistrationSchema', () => {
  const validBaseData = {
    email: 'test@example.com',
    dateOfBirth: new Date('1990-01-01'),
    physicalState: 5,
    mentalState: 5,
    energyLevel: 5,
    stressLevel: 5,
    membershipType: 'individual' as const,
  };

  it('should validate correct data', () => {
    const result = studyRegistrationSchema.safeParse(validBaseData);
    expect(result.success).toBe(true);
  });

  it('should reject invalid email', () => {
    const result = studyRegistrationSchema.safeParse({
      ...validBaseData,
      email: 'invalid-email',
    });
    expect(result.success).toBe(false);
  });

  it('should reject password without uppercase', () => {
    const result = studyRegistrationSchema.safeParse({
      ...validBaseData,
      password: 'password123',
    });
    expect(result.success).toBe(false);
  });

  it('should reject password without number', () => {
    const result = studyRegistrationSchema.safeParse({
      ...validBaseData,
      password: 'Password',
    });
    expect(result.success).toBe(false);
  });

  it('should accept valid strong password', () => {
    const result = studyRegistrationSchema.safeParse({
      ...validBaseData,
      password: 'Password123',
      confirmPassword: 'Password123',
    });
    expect(result.success).toBe(true);
  });

  it('should reject mismatched passwords', () => {
    const result = studyRegistrationSchema.safeParse({
      ...validBaseData,
      password: 'Password123',
      confirmPassword: 'DifferentPass123',
    });
    expect(result.success).toBe(false);
  });

  it('should validate state values are in range 1-10', () => {
    const result = studyRegistrationSchema.safeParse({
      ...validBaseData,
      physicalState: 11,
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid membership type', () => {
    const result = studyRegistrationSchema.safeParse({
      ...validBaseData,
      membershipType: 'invalid',
    });
    expect(result.success).toBe(false);
  });

  it('should accept optional fields', () => {
    const result = studyRegistrationSchema.safeParse({
      ...validBaseData,
      professionalFindings: 'Some findings',
      note: 'Some note',
    });
    expect(result.success).toBe(true);
  });

  it('should reject text over max length', () => {
    const result = studyRegistrationSchema.safeParse({
      ...validBaseData,
      note: 'x'.repeat(2001),
    });
    expect(result.success).toBe(false);
  });
});

describe('healthQuestionnaireSchema', () => {
  const validHealthData = {
    hasPreExistingConditions: false,
    hasFamilyHistory: false,
    covidVaccinationStatus: 'two_doses' as const,
    takingMedications: false,
    gender: 'male' as const,
    workActivity: 'moderate' as const,
    exercisesRegularly: true,
    exerciseFrequency: '2_3_week' as const,
    onDietProgram: false,
    smokes: false,
    drinksAlcohol: false,
    hasAsthma: false,
    hasHighBloodPressure: 'no' as const,
    hasHeartCondition: false,
  };

  it('should validate correct health data', () => {
    const result = healthQuestionnaireSchema.safeParse(validHealthData);
    expect(result.success).toBe(true);
  });

  it('should reject invalid gender', () => {
    const result = healthQuestionnaireSchema.safeParse({
      ...validHealthData,
      gender: 'invalid',
    });
    expect(result.success).toBe(false);
  });

  it('should reject weight out of range', () => {
    const result = healthQuestionnaireSchema.safeParse({
      ...validHealthData,
      weight: 10,
    });
    expect(result.success).toBe(false);
  });

  it('should accept weight in valid range', () => {
    const result = healthQuestionnaireSchema.safeParse({
      ...validHealthData,
      weight: 70,
      height: 175,
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid covid vaccination status', () => {
    const result = healthQuestionnaireSchema.safeParse({
      ...validHealthData,
      covidVaccinationStatus: 'invalid',
    });
    expect(result.success).toBe(false);
  });

  it('should accept valid exercise frequency', () => {
    const result = healthQuestionnaireSchema.safeParse({
      ...validHealthData,
      exerciseFrequency: '4_5_week',
    });
    expect(result.success).toBe(true);
  });

  it('should accept optional fields', () => {
    const result = healthQuestionnaireSchema.safeParse({
      ...validHealthData,
      preExistingConditionsDetails: 'Some details',
      productsList: 'Vitamin D, Omega-3',
      otherConditions: 'None',
    });
    expect(result.success).toBe(true);
  });
});

describe('fullStudyRegistrationSchema', () => {
  const validFullData = {
    email: 'test@example.com',
    dateOfBirth: new Date('1990-01-01'),
    physicalState: 5,
    mentalState: 5,
    energyLevel: 5,
    stressLevel: 5,
    membershipType: 'individual' as const,
    hasPreExistingConditions: false,
    hasFamilyHistory: false,
    covidVaccinationStatus: 'two_doses' as const,
    takingMedications: false,
    gender: 'male' as const,
    workActivity: 'moderate' as const,
    exercisesRegularly: true,
    exerciseFrequency: '2_3_week' as const,
    onDietProgram: false,
    smokes: false,
    drinksAlcohol: false,
    hasAsthma: false,
    hasHighBloodPressure: 'no' as const,
    hasHeartCondition: false,
  };

  it('should validate complete registration data', () => {
    const result = fullStudyRegistrationSchema.safeParse(validFullData);
    expect(result.success).toBe(true);
  });

  it('should reject if registration part is invalid', () => {
    const result = fullStudyRegistrationSchema.safeParse({
      ...validFullData,
      email: 'invalid',
    });
    expect(result.success).toBe(false);
  });

  it('should reject if health part is invalid', () => {
    const result = fullStudyRegistrationSchema.safeParse({
      ...validFullData,
      gender: 'invalid',
    });
    expect(result.success).toBe(false);
  });

  it('should enforce password matching in full schema', () => {
    const result = fullStudyRegistrationSchema.safeParse({
      ...validFullData,
      password: 'Password123',
      confirmPassword: 'Different123',
    });
    expect(result.success).toBe(false);
  });
});

describe('STUDY_ENROLLMENT_QUESTIONNAIRE_ID', () => {
  it('should be a valid UUID', () => {
    expect(STUDY_ENROLLMENT_QUESTIONNAIRE_ID).toBe('00000000-0000-0000-0000-000000000001');
    expect(STUDY_ENROLLMENT_QUESTIONNAIRE_ID).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });
});
