/**
 * Hook for accessing centralized company data for i18n interpolation.
 *
 * Provides a stable object of interpolation values sourced from
 * {@link module:lib/constants/companyData} that can be spread
 * directly into `t()` calls requiring entity placeholders.
 *
 * @module hooks/useCompanyData
 * @example
 * ```tsx
 * const { consentInterpolation } = useCompanyData();
 * <span>{t("legal.consents.gdpr", consentInterpolation)}</span>
 * ```
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import {
  EKORTN,
  RTN_THERAPEUTICS,
  EVYMO,
  STUDY_INFO,
  DPO_CONTACT,
  type CompanyEntity,
} from "@/lib/constants/companyData";

// =====================================================
// Types
// =====================================================

/** Interpolation values for consent and legal text templates. */
export interface ConsentInterpolation {
  readonly operatorName: string;
  readonly operatorCompanyId: string;
  readonly operatorTaxId: string;
  readonly operatorAddress: string;
  readonly operatorCourt: string;
  readonly operatorWebsite: string;
  readonly organizerName: string;
  readonly organizerCompanyId: string;
  readonly organizerAddress: string;
  readonly organizerCourt: string;
  readonly processorName: string;
  readonly processorCompanyId: string;
  readonly processorAddress: string;
  readonly processorCourt: string;
  readonly studyName: string;
  readonly dpoName: string;
  readonly dpoEmail: string;
}

/** Return type of the `useCompanyData` hook. */
export interface UseCompanyDataReturn {
  /** Pre-built interpolation object for consent `t()` calls. */
  readonly consentInterpolation: ConsentInterpolation;
  /** Direct access to operator entity (operator). */
  readonly operator: CompanyEntity;
  /** Direct access to study organizer entity (study organizer). */
  readonly organizer: CompanyEntity;
  /** Direct access to data processor entity (Evymo). */
  readonly processor: CompanyEntity;
  /** Study name in the active locale (cs → Czech, otherwise English). */
  readonly studyName: string;
}

// =====================================================
// Hook
// =====================================================

/**
 * Provides company data constants and pre-built interpolation values.
 *
 * The `consentInterpolation` object is memoized and can be passed directly
 * as the second argument to any `t()` call that contains company placeholders
 * (e.g. `{{operatorName}}`, `{{processorCompanyId}}`).
 *
 * @returns Stable references to company entities and interpolation values.
 */
export function useCompanyData(): UseCompanyDataReturn {
  const { i18n } = useTranslation();
  const currentLang = i18n.language;

  const studyName = useMemo(
    () => (currentLang === "cs" ? STUDY_INFO.nameCz : STUDY_INFO.nameEn),
    [currentLang],
  );

  const consentInterpolation = useMemo<ConsentInterpolation>(
    () => ({
      operatorName: EKORTN.name,
      operatorCompanyId: EKORTN.companyId,
      operatorTaxId: EKORTN.taxId ?? "",
      operatorAddress: EKORTN.registeredOffice,
      operatorCourt: EKORTN.courtRegistration,
      operatorWebsite: EKORTN.website,
      organizerName: RTN_THERAPEUTICS.name,
      organizerCompanyId: RTN_THERAPEUTICS.companyId,
      organizerAddress: RTN_THERAPEUTICS.registeredOffice,
      organizerCourt: RTN_THERAPEUTICS.courtRegistration,
      processorName: EVYMO.name,
      processorCompanyId: EVYMO.companyId,
      processorAddress: EVYMO.registeredOffice,
      processorCourt: EVYMO.courtRegistration,
      studyName,
      dpoName: DPO_CONTACT.name,
      dpoEmail: DPO_CONTACT.email,
    }),
    [studyName],
  );

  return useMemo(
    () => ({
      consentInterpolation,
      operator: EKORTN,
      organizer: RTN_THERAPEUTICS,
      processor: EVYMO,
      studyName,
    }),
    [consentInterpolation, studyName],
  );
}
