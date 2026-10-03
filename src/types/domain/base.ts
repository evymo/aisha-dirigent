/**
 * Base domain interfaces
 * 
 * These interfaces define the "frontend shape" of data:
 * - All optional fields use `?: T | undefined` (not `| null`)
 * - Required fields are always present
 * - Used in UI components and state management
 * 
 * @module types/domain/base
 */

// ==========================================
// Common Base Types
// ==========================================

/**
 * Base entity with ID and timestamps.
 * All domain entities extend this interface.
 */
export interface BaseEntity {
  id: string;
  createdAt: string;
  updatedAt?: string;
}

/**
 * Entity with user ownership.
 */
export interface UserOwnedEntity extends BaseEntity {
  userId: string;
}

/**
 * Audit metadata for trackable entities.
 */
export interface AuditableEntity extends BaseEntity {
  createdBy?: string;
  updatedBy?: string;
}

// ==========================================
// Localized Content
// ==========================================

/**
 * Content with Czech and English translations.
 */
export interface LocalizedContent {
  cs?: string;
  en?: string;
}

/**
 * Entity with localized name and description.
 */
export interface LocalizedEntity {
  nameCs?: string;
  nameEn?: string;
  descriptionCs?: string;
  descriptionEn?: string;
}

// ==========================================
// Address Types
// ==========================================

/**
 * Physical address structure.
 */
export interface Address {
  street?: string;
  city?: string;
  postalCode?: string;
  country?: string;
  state?: string;
}

/**
 * Contact information.
 */
export interface ContactInfo {
  email?: string;
  phone?: string;
  website?: string;
}

// ==========================================
// Pagination & Filtering
// ==========================================

/**
 * Pagination parameters for list queries.
 */
export interface PaginationParams {
  page: number;
  pageSize: number;
}

/**
 * Paginated response wrapper.
 */
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Date range filter.
 */
export interface DateRange {
  from?: string;
  to?: string;
}

/**
 * Common sort options.
 */
export interface SortOptions {
  field: string;
  direction: 'asc' | 'desc';
}

// ==========================================
// Status Types
// ==========================================

/**
 * Generic status with label.
 */
export interface StatusInfo {
  status: string;
  label: string;
  variant?: 'default' | 'success' | 'warning' | 'destructive';
}

/**
 * Processing state for async operations.
 */
export interface ProcessingState {
  isLoading: boolean;
  error?: string;
  progress?: number;
}

// ==========================================
// Selection & UI State
// ==========================================

/**
 * Generic selectable item for dropdowns/lists.
 */
export interface SelectableItem<T = string> {
  value: T;
  label: string;
  disabled?: boolean;
  description?: string;
}

/**
 * Tab definition.
 */
export interface TabDefinition {
  id: string;
  label: string;
  icon?: string;
  disabled?: boolean;
  badge?: string | number;
}

// ==========================================
// Form Types
// ==========================================

/**
 * Generic form field error.
 */
export interface FieldError {
  field: string;
  message: string;
}

/**
 * Form submission result.
 */
export interface FormResult<T = unknown> {
  success: boolean;
  data?: T;
  errors?: FieldError[];
}

// ==========================================
// API Response Types
// ==========================================

/**
 * Standard API success response.
 */
export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
}

/**
 * Standard API error response.
 */
export interface ApiErrorResponse {
  success: false;
  error: string;
  code?: string;
  details?: Record<string, unknown>;
}

/**
 * Union type for API responses.
 */
export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

// ==========================================
// Type Utilities
// ==========================================

/**
 * Make specific keys optional.
 */
export type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

/**
 * Make specific keys required.
 */
export type RequiredBy<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>;

/**
 * Extract non-nullable type.
 */
export type NonNullableFields<T> = {
  [K in keyof T]: NonNullable<T[K]>;
};
