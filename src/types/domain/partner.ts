/**
 * Partner domain interfaces
 * 
 * Interfaces for partner profiles, appointments, and services.
 * 
 * @module types/domain/partner
 */

import type { BaseEntity, DateRange } from "./base";
import type { PartnerCertificationLevel } from "@/lib/types";

// ==========================================
// Partner Profile Types
// ==========================================

/**
 * Partner profile for UI display.
 */
export interface PartnerProfile extends BaseEntity {
  userId: string;
  displayName: string;
  businessName?: string;
  email?: string;
  phone?: string;
  website?: string;
  avatarUrl?: string;
  
  // Location
  city: string;
  country: string;
  address?: string;
  
  // Professional details
  description?: string;
  services?: string[];
  languages?: string[];
  isProductionProvider: boolean;
  
  // Certification
  certificationLevel: PartnerCertificationLevel;
  certificationScore?: number;
  certificationPassedAt?: string;
  
  // Visibility
  isVisible: boolean;
  notesForVisitors?: string;
  
  // Appointment settings
  acceptsOnlineAppointments?: boolean;
  acceptsInPersonAppointments?: boolean;
}

/**
 * Partner profile for public listing.
 */
export interface PartnerListItem {
  id: string;
  displayName: string;
  businessName?: string;
  avatarUrl?: string;
  city: string;
  country: string;
  services?: string[];
  languages?: string[];
  isProductionProvider: boolean;
  certificationLevel: PartnerCertificationLevel;
  acceptsOnlineAppointments?: boolean;
  acceptsInPersonAppointments?: boolean;
  averageRating?: number;
  reviewCount?: number;
}

/**
 * Partner registration form values.
 */
export interface PartnerRegistrationFormValues {
  displayName: string;
  businessName?: string;
  city: string;
  country: string;
  address?: string;
  phone?: string;
  website?: string;
  description?: string;
  services?: string[];
  languages?: string[];
  isProductionProvider: boolean;
}

/**
 * Partner search filters.
 */
export interface PartnerSearchFilters {
  city?: string;
  country?: string;
  service?: string;
  language?: string;
  isProductionProvider?: boolean;
  acceptsOnline?: boolean;
  acceptsInPerson?: boolean;
  certificationLevel?: PartnerCertificationLevel;
}

// ==========================================
// Partner Availability Types
// ==========================================

/**
 * Weekly availability slot.
 */
export interface AvailabilitySlot {
  id: string;
  partnerId: string;
  dayOfWeek: number; // 0-6 (Sunday-Saturday)
  startTime: string; // HH:mm format
  endTime: string;   // HH:mm format
  isOnline: boolean;
}

/**
 * Available time slot for booking.
 */
export interface BookableSlot {
  date: string;
  startTime: string;
  endTime: string;
  isOnline: boolean;
  isAvailable: boolean;
}

/**
 * Partner availability configuration.
 */
export interface PartnerAvailabilityConfig {
  partnerId: string;
  slots: AvailabilitySlot[];
  appointmentDuration: number; // minutes
  bufferTime: number; // minutes between appointments
  advanceBookingDays: number; // how far in advance to allow booking
}

// ==========================================
// Appointment Types
// ==========================================

/**
 * Appointment for UI display.
 */
export interface Appointment extends BaseEntity {
  partnerId: string;
  memberId: string;
  
  // Timing
  appointmentDate: string;
  startTime: string;
  endTime: string;
  
  // Details
  appointmentType: 'online' | 'in_person';
  service?: string;
  notes?: string;
  
  // Status
  status: AppointmentStatus;
  
  // Related data (for display)
  partnerName?: string;
  partnerAvatarUrl?: string;
  memberName?: string;
}

/**
 * Appointment status values.
 */
export type AppointmentStatus = 
  | 'pending'
  | 'confirmed'
  | 'cancelled'
  | 'completed'
  | 'no_show';

/**
 * Appointment booking form values.
 */
export interface AppointmentBookingFormValues {
  partnerId: string;
  appointmentDate: string;
  startTime: string;
  endTime: string;
  appointmentType: 'online' | 'in_person';
  service?: string;
  notes?: string;
}

/**
 * Appointment filters for queries.
 */
export interface AppointmentFilters {
  dateRange?: DateRange;
  status?: AppointmentStatus;
  partnerId?: string;
  memberId?: string;
  appointmentType?: 'online' | 'in_person';
}

// ==========================================
// Partner Review Types
// ==========================================

/**
 * Appointment review for UI display.
 */
export interface AppointmentReview extends BaseEntity {
  appointmentId: string;
  partnerId: string;
  memberId: string;
  rating: number; // 1-5
  comment?: string;
}

/**
 * Partner rating summary.
 */
export interface PartnerRatingSummary {
  partnerId: string;
  averageRating: number;
  totalReviews: number;
  ratingDistribution: {
    1: number;
    2: number;
    3: number;
    4: number;
    5: number;
  };
}

/**
 * Review form values.
 */
export interface ReviewFormValues {
  rating: number;
  comment?: string;
}

// ==========================================
// Partner Certification Types
// ==========================================

/**
 * Certification test result.
 */
export interface CertificationResult extends BaseEntity {
  userId: string;
  score: number;
  passed: boolean;
  completedAt: string;
  answers: Record<string, unknown>;
}

/**
 * Certification test question.
 */
export interface CertificationQuestion {
  id: string;
  question: string;
  options: CertificationOption[];
  correctAnswer: string;
  explanation?: string;
  category?: string;
}

/**
 * Certification question option.
 */
export interface CertificationOption {
  value: string;
  label: string;
}

/**
 * Certification test state.
 */
export interface CertificationTestState {
  questions: CertificationQuestion[];
  currentQuestionIndex: number;
  answers: Record<string, string>;
  startedAt: string;
  timeRemaining?: number;
}
