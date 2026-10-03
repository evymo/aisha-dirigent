/**
 * Profile and user domain interfaces
 * 
 * Interfaces for user profiles, memberships, and account data.
 * 
 * @module types/domain/profile
 */

import type { BaseEntity, Address, ContactInfo } from "./base";
import type { MembershipStatus, MembershipTier, SubscriptionPeriod, PaymentType, AppRole } from "@/lib/types";

// ==========================================
// User Profile Types
// ==========================================

/**
 * User profile for UI display.
 */
export interface UserProfile extends BaseEntity {
  userId: string;
  displayName?: string;
  email?: string;
  phone?: string;
  avatarUrl?: string;
  
  // Personal info
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  gender?: string;
  
  // Address
  address?: Address;
  
  // Preferences
  preferredLanguage?: string;
  timezone?: string;
  notificationPreferences?: NotificationPreferences;
  
  // Status
  isVerified?: boolean;
  verifiedAt?: string;
  lastActiveAt?: string;
}

/**
 * Profile form input values.
 */
export interface ProfileFormValues {
  displayName?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  dateOfBirth?: string;
  gender?: string;
  address?: Address;
  preferredLanguage?: string;
  timezone?: string;
}

/**
 * Notification preferences structure.
 */
export interface NotificationPreferences {
  email?: boolean;
  push?: boolean;
  sms?: boolean;
  marketing?: boolean;
  studyUpdates?: boolean;
  appointmentReminders?: boolean;
  healthAlerts?: boolean;
}

// ==========================================
// Membership Types
// ==========================================

/**
 * Membership for UI display.
 */
export interface Membership extends BaseEntity {
  userId: string;
  tier: MembershipTier;
  status: MembershipStatus;
  
  // Subscription details
  paymentType: PaymentType;
  subscriptionPeriod?: SubscriptionPeriod;
  autoRenew?: boolean;
  
  // Dates
  startsAt: string;
  expiresAt?: string;
  
  // Stripe integration
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  
  // Tokens
  tokensGovernance?: number;
  tokensImpact?: number;
  tokensData?: number;
  
  // Notes
  notes?: string;
}

/**
 * Membership summary for dashboard.
 */
export interface MembershipSummary {
  tier: MembershipTier;
  status: MembershipStatus;
  expiresAt?: string;
  daysRemaining?: number;
  totalTokens: number;
}

/**
 * Membership upgrade options.
 */
export interface MembershipUpgradeOption {
  tier: MembershipTier;
  period: SubscriptionPeriod;
  price: number;
  currency: string;
  features: string[];
  recommended?: boolean;
}

// ==========================================
// User Role Types
// ==========================================

/**
 * User role assignment.
 */
export interface UserRole extends BaseEntity {
  userId: string;
  role: AppRole;
  grantedAt: string;
  grantedBy?: string;
  expiresAt?: string;
}

/**
 * User with roles for admin views.
 */
export interface UserWithRoles extends UserProfile {
  roles: AppRole[];
  primaryRole: AppRole;
}

// ==========================================
// Consultant Types
// ==========================================

/**
 * Consultant profile for UI display.
 */
export interface ConsultantProfile extends BaseEntity {
  userId: string;
  displayName?: string;
  email?: string;
  phone?: string;
  avatarUrl?: string;
  
  // Professional info
  specializations?: string[];
  qualifications?: string[];
  bio?: string;
  
  // Availability
  isAvailable?: boolean;
  maxUsers?: number;
  currentUserCount?: number;
  
  // Contact
  contactInfo?: ContactInfo;
}

/**
 * Consultant assignment to user.
 */
export interface ConsultantAssignment {
  consultantId: string;
  userId: string;
  assignedAt: string;
  assignedBy?: string;
  role: 'primary' | 'secondary';
  status: 'active' | 'ended';
  endedAt?: string;
  notes?: string;
}

// ==========================================
// Onboarding Types
// ==========================================

/**
 * Onboarding responses for new members.
 */
export interface OnboardingResponses {
  userId: string;
  onboardingCompleted?: boolean;
  
  // Demographics
  ageRange?: string;
  
  // Tracking concerns
  primaryConcern?: string;
  secondaryConcerns?: string[];
  hasChronicCondition?: boolean;
  conditionBrief?: string;
  
  // Goals
  mainGoal?: string;
  timeframeExpectation?: string;
  
  // Current state (1-10 scale)
  overallFeeling?: number;
  energyPerception?: number;
  sleepSatisfaction?: number;
  mentalWellbeing?: number;
  physicalConfidence?: number;
  
  // Preferences
  communicationStyle?: string;
  mentorPreference?: string;
  
  // Assignment
  assignedPartnerId?: string;
  phoneCallScheduledAt?: string;
  phoneCallCompletedAt?: string;
}

/**
 * Onboarding step definition.
 */
export interface OnboardingStep {
  id: string;
  title: string;
  description?: string;
  isCompleted: boolean;
  isRequired: boolean;
  order: number;
}

/**
 * Onboarding progress.
 */
export interface OnboardingProgress {
  steps: OnboardingStep[];
  currentStep: number;
  completedSteps: number;
  totalSteps: number;
  percentComplete: number;
}
