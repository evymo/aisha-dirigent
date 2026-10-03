/**
 * Centralized company data constants.
 *
 * Single source of truth for all legal entities associated with the deployment.
 * Used in legal documents, consent forms, order confirmations, manufacturing protocols,
 * and label templates.
 *
 * @module lib/constants/companyData
 */

// =====================================================
// Company Entity Interface
// =====================================================

/** Legal entity details for a company in the deployment. */
export interface CompanyEntity {
  /** Official company name */
  readonly name: string;
  /** Company identification number (IČ) */
  readonly companyId: string;
  /** Tax identification number (DIČ), if applicable */
  readonly taxId: string | null;
  /** Registered office address */
  readonly registeredOffice: string;
  /** Court registration details */
  readonly courtRegistration: string;
  /** Role within the deployment */
  readonly role: CompanyRole;
  /** Primary contact email */
  readonly email: string;
  /** Contact phone number */
  readonly phone: string;
  /** Website URL */
  readonly website: string;
}

/** Known roles of legal entities in the deployment. */
export type CompanyRole =
  | "website_operator"
  | "study_organizer"
  | "data_processor";

// =====================================================
// Company Entity Definitions
// =====================================================

/**
 * Example Operator s.r.o. — Website operator and content provider.
 *
 * Placeholder legal entity for the website operator role.
 * Replace with your own deployment's details before going live.
 */
export const EKORTN: CompanyEntity = {
  name: "Example Operator s.r.o.",
  companyId: "000 00 000",
  taxId: "CZ00000000",
  registeredOffice: "Example Street 1, 000 00 Example City",
  courtRegistration:
    "Example Registration Court, file no. C 00000",
  role: "website_operator",
  email: "operator@example.com",
  phone: "", // instance data — set the deployment's real number; never ship a dialable-looking placeholder
  website: "www.example.com",
} as const;

/**
 * Example Organizer s.r.o. — Study organizer.
 *
 * Placeholder legal entity for the study organizer role.
 * Replace with your own deployment's details before going live.
 */
export const RTN_THERAPEUTICS: CompanyEntity = {
  name: "Example Organizer s.r.o.",
  companyId: "000 00 000",
  taxId: null,
  registeredOffice: "Example Street 2, 000 00 Example City",
  courtRegistration:
    "Example Registration Court, section C, entry 00000",
  role: "study_organizer",
  email: "organizer@example.com",
  phone: "", // instance data — set the deployment's real number; never ship a dialable-looking placeholder
  website: "www.example.com",
} as const;

/**
 * Example Processor s.r.o. — GDPR data processor.
 *
 * Placeholder legal entity for the personal data processor role
 * under Regulation (EU) 2016/679 (GDPR).
 * Replace with your own deployment's details before going live.
 */
export const EVYMO: CompanyEntity = {
  name: "Example Processor s.r.o.",
  companyId: "000 00 000",
  taxId: null,
  registeredOffice: "Example Street 3, 000 00 Example City",
  courtRegistration:
    "Example Registration Court, section C, entry 00000",
  role: "data_processor",
  email: "processor@example.com",
  phone: "", // instance data — set the deployment's real number; never ship a dialable-looking placeholder
  website: "www.example.com",
} as const;

// =====================================================
// Aggregate Exports
// =====================================================

/** All companies indexed by their role. */
export const COMPANIES_BY_ROLE: Record<CompanyRole, CompanyEntity> = {
  website_operator: EKORTN,
  study_organizer: RTN_THERAPEUTICS,
  data_processor: EVYMO,
} as const;

/** All companies as a flat array. */
export const ALL_COMPANIES: readonly CompanyEntity[] = [
  EKORTN,
  RTN_THERAPEUTICS,
  EVYMO,
] as const;

// =====================================================
// Contact & DPO
// =====================================================

/** Data Protection Officer contact details. */
export const DPO_CONTACT = {
  title: "Data Protection Officer",
  name: "Example DPO",
  email: "dpo@example.com",
  personalEmail: "dpo@example.com",
  phone: "", // instance data — set the deployment's real DPO number; never ship a dialable-looking placeholder
} as const;

/** Study details used across consent forms and legal documents. */
export const STUDY_INFO = {
  /** Canonical Czech name of the study */
  nameCz:
    "Ukázková studie",
  /** Canonical English name of the study */
  nameEn:
    "Example Study",
  /** Organizer entity */
  organizer: RTN_THERAPEUTICS,
  /** Distributor entity */
  distributor: EKORTN,
} as const;
