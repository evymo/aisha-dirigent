/**
 * Tracking domain interfaces
 * 
 * Interfaces for tracking-related entities used in the UI layer.
 * All sensitive data data flows through RPC with audit logging.
 * 
 * @module types/domain/tracking
 */

import type { UserOwnedEntity, DateRange } from "./base";
import type { CheckInType, LabResultStatus, TrackingDocumentCategory, DocumentProcessingStatus } from "@/lib/types";

// ==========================================
// Tracking Check-In Types
// ==========================================

/**
 * Tracking check-in entry for UI display.
 */
export interface TrackingCheckIn extends UserOwnedEntity {
  checkInDate: string;
  checkInType: CheckInType;
  studyRegistrationId?: string;
  
  // Wellness metrics (1-10 scale)
  moodLevel?: number;
  energyLevel?: number;
  painLevel?: number;
  sleepQuality?: number;
  
  // Quantitative data
  sleepHours?: number;
  stepsCount?: number;
  activityMinutes?: number;
  
  // Pain details
  painLocation?: string;
  painNotes?: string;
  
  // Medication tracking
  tookMedication?: boolean;
  medicationNotes?: string;
  sideEffects?: string;
  
  // Activity details
  exerciseType?: string;
  
  // Notes
  generalNotes?: string;
  
  // WOMAC scores (for joint health studies)
  womacPain?: number;
  womacStiffness?: number;
  womacFunction?: number;
}

/**
 * Simplified check-in for list views.
 */
export interface TrackingCheckInSummary {
  id: string;
  checkInDate: string;
  checkInType: CheckInType;
  moodLevel?: number;
  energyLevel?: number;
  painLevel?: number;
}

/**
 * Check-in form input values.
 */
export interface TrackingCheckInFormValues {
  checkInType: CheckInType;
  moodLevel?: number;
  energyLevel?: number;
  painLevel?: number;
  sleepQuality?: number;
  sleepHours?: number;
  stepsCount?: number;
  activityMinutes?: number;
  painLocation?: string;
  painNotes?: string;
  tookMedication?: boolean;
  medicationNotes?: string;
  sideEffects?: string;
  exerciseType?: string;
  generalNotes?: string;
  womacPain?: number;
  womacStiffness?: number;
  womacFunction?: number;
}

/**
 * Check-in filters for queries.
 */
export interface TrackingCheckInFilters {
  dateRange?: DateRange;
  checkInType?: CheckInType;
  studyRegistrationId?: string;
}

// ==========================================
// Lab Results Types
// ==========================================

/**
 * Lab result entry for UI display.
 */
export interface LabResult extends UserOwnedEntity {
  testDate: string;
  status: LabResultStatus;
  labName?: string;
  studyRegistrationId?: string;
  notes?: string;
  
  // Blood markers
  glucose?: number;
  hba1c?: number;
  insulin?: number;
  
  // Lipid panel
  cholesterolTotal?: number;
  hdl?: number;
  ldl?: number;
  triglycerides?: number;
  
  // Inflammatory markers
  crp?: number;
  esr?: number;
  il6?: number;
  il4?: number;
  tnfAlpha?: number;
  
  // Complete blood count
  wbc?: number;
  rbc?: number;
  hemoglobin?: number;
  platelets?: number;
  
  // Immune markers
  cd4Count?: number;
  cd8Count?: number;
  nkCells?: number;
  
  // Kidney function
  creatinine?: number;
  urea?: number;
  
  // Liver function
  alt?: number;
  ast?: number;
  
  // Vitamins & products
  vitaminD?: number;
  vitaminB12?: number;
  omega3Index?: number;
  
  // Longevity markers
  nadNadhRatio?: number;
  
  // Review metadata
  reviewedBy?: string;
  reviewedAt?: string;
  
  // Raw data (for AI processing)
  rawData?: Record<string, unknown>;
}

/**
 * Lab result summary for list views.
 */
export interface LabResultSummary {
  id: string;
  testDate: string;
  status: LabResultStatus;
  labName?: string;
  keyFindings?: string[];
}

/**
 * Lab result filters for queries.
 */
export interface LabResultFilters {
  dateRange?: DateRange;
  status?: LabResultStatus;
  studyRegistrationId?: string;
}

// ==========================================
// Tracking Documents Types
// ==========================================

/**
 * Tracking document for UI display.
 */
export interface TrackingDocument extends UserOwnedEntity {
  fileName: string;
  filePath: string;
  fileSize?: number;
  mimeType?: string;
  
  category: TrackingDocumentCategory;
  title?: string;
  description?: string;
  documentDate?: string;
  
  processingStatus: DocumentProcessingStatus;
  processedAt?: string;
  
  // AI extraction results
  extractedText?: string;
  extractedData?: Record<string, unknown>;
  aiSummary?: string;
  aiCategories?: string[];
  aiInsights?: Record<string, unknown>;
  
  // Study association
  studyRegistrationId?: string;
  
  // Token rewards
  contributedToStatistics?: boolean;
  contributedAt?: string;
  tokensAwarded?: number;
  tokensAwardedAt?: string;
}

/**
 * Document upload input.
 */
export interface TrackingDocumentUpload {
  file: File;
  category: TrackingDocumentCategory;
  title?: string;
  description?: string;
  documentDate?: string;
  studyRegistrationId?: string;
}

// ==========================================
// Tracking Summary Types
// ==========================================

/**
 * Aggregated tracking summary for dashboard.
 */
export interface TrackingSummary {
  userId: string;
  lastCheckIn?: TrackingCheckInSummary;
  lastLabResult?: LabResultSummary;
  
  // Trend data
  averageMood?: number;
  averageEnergy?: number;
  averagePain?: number;
  averageSleep?: number;
  
  // Compliance
  checkInStreak?: number;
  checkInCompliancePercent?: number;
  
  // Alerts
  criticalFlags?: string[];
  pendingActions?: string[];
}

/**
 * Biomarker trend data point.
 */
export interface BiomarkerDataPoint {
  date: string;
  value: number;
  unit: string;
  referenceMin?: number;
  referenceMax?: number;
  isOutOfRange?: boolean;
}

/**
 * Biomarker trend series.
 */
export interface BiomarkerTrend {
  biomarkerKey: string;
  name: string;
  unit: string;
  dataPoints: BiomarkerDataPoint[];
  trend: 'improving' | 'stable' | 'declining' | 'insufficient_data';
}
