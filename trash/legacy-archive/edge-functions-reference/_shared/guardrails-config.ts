/**
 * Guardrails Configuration for AI Chat Access Levels
 * 
 * This module defines the restrictions and permissions for different user access levels.
 * Access levels are determined by the `get_chat_access_level` RPC.
 * 
 * Implements multi-tier guardrails inspired by OpenAI Agents SDK pattern.
 */

export type ChatAccessLevel = 
  | 'none'
  | 'basic'
  | 'enrolled'
  | 'active'
  | 'qualified'
  | 'certified'
  | 'premium'
  | 'partner'
  | 'partner_certified'
  | 'partner_premium';

export interface PIIDetectionConfig {
  block: boolean;
  detectEncodedPii: boolean;
  entities: string[];
}

export interface HallucinationConfig {
  enabled: boolean;
  model: string;
  confidenceThreshold: number;
}

export interface JailbreakConfig {
  enabled: boolean;
  blockOnDetection: boolean;
}

export interface ModerationConfig {
  enabled: boolean;
  flaggedCategories: string[];
}

export interface GuardrailsConfig {
  accessLevel: ChatAccessLevel;
  maxResponseLength: number;
  allowedCategories: string[];
  contentRestrictions: {
    allowMedicalAdvice: boolean;
    allowDistributionInfo: boolean;
    allowStudyDetails: boolean;
    allowResearchData: boolean;
    allowPartnerTools: boolean;
    allowUserContext: boolean;
  };
  requireDisclaimer: boolean;
  piiDetection: PIIDetectionConfig;
  hallucinationDetection: HallucinationConfig;
  jailbreakDetection: JailbreakConfig;
  moderation: ModerationConfig;
  useSimplicityAgent: boolean;
}

/**
 * Guardrail check results from analysis
 */
export interface GuardrailCheckResult {
  passed: boolean;
  pii: {
    detected: boolean;
    detectedCounts: Record<string, number>;
    anonymizedText?: string;
  };
  hallucination: {
    detected: boolean;
    reasoning?: string;
    hallucinatedStatements?: string[];
  };
  jailbreak: {
    detected: boolean;
    confidence?: number;
  };
  moderation: {
    flagged: boolean;
    categories?: string[];
  };
}

const ALL_CATEGORIES = [
  'RTN 33 - odvozené preparáty',
  'RTN praxe',
  'RTN produkce',
  'RTN R&D',
  'RTN Studie',
  'RTN reVýzkum',
  'RTN History',
  'Else',
];

const BASE_PII_ENTITIES = ['CREDIT_CARD', 'US_BANK_NUMBER', 'US_PASSPORT', 'US_SSN', 'EMAIL', 'PHONE', 'RODNE_CISLO'];

/**
 * Single default model for all guardrails tasks.
 * AISHA's router validates actual availability at runtime.
 */
import { getDefaultModel } from "./defaultModel.ts";
const GUARDRAILS_MODEL = getDefaultModel();

/**
 * Get guardrails configuration for a given access level.
 * Matches frontend `getGuardrailsForAccessLevel()` in `useChatAccess.ts`.
 */
export function getGuardrailsConfig(accessLevel: ChatAccessLevel): GuardrailsConfig {
  const baseConfig: GuardrailsConfig = {
    accessLevel,
    maxResponseLength: 500,
    allowedCategories: ['Else'],
    contentRestrictions: {
      allowMedicalAdvice: false,
      allowDistributionInfo: false,
      allowStudyDetails: false,
      allowResearchData: false,
      allowPartnerTools: false,
      allowUserContext: false,
    },
    requireDisclaimer: true,
    piiDetection: {
      block: false,
      detectEncodedPii: true,
      entities: BASE_PII_ENTITIES,
    },
    hallucinationDetection: {
      enabled: true,
      model: GUARDRAILS_MODEL,
      confidenceThreshold: 0.7,
    },
    jailbreakDetection: {
      enabled: true,
      blockOnDetection: true,
    },
    moderation: {
      enabled: true,
      flaggedCategories: ['hate', 'harassment', 'self-harm', 'sexual', 'violence'],
    },
    useSimplicityAgent: false,
  };

  switch (accessLevel) {
    // ===========================================
    // MEMBER TIERS (Regular users)
    // ===========================================
    
    case 'none':
    case 'basic':
      return {
        ...baseConfig,
        maxResponseLength: 500,
        allowedCategories: ['Else', 'RTN History'],
        contentRestrictions: {
          allowMedicalAdvice: false,
          allowDistributionInfo: false,
          allowStudyDetails: false,
          allowResearchData: false,
          allowPartnerTools: false,
          allowUserContext: false,
        },
        requireDisclaimer: true,
        useSimplicityAgent: true, // Simpler responses for basic users
      };

    case 'enrolled':
      return {
        ...baseConfig,
        maxResponseLength: 1000,
        allowedCategories: ['Else', 'RTN History', 'RTN praxe', 'RTN 33 - odvozené preparáty'],
        contentRestrictions: {
          allowMedicalAdvice: false,
          allowDistributionInfo: true,
          allowStudyDetails: true,
          allowResearchData: false,
          allowPartnerTools: false,
          allowUserContext: false,
        },
        requireDisclaimer: true,
        useSimplicityAgent: true,
      };

    case 'active':
      return {
        ...baseConfig,
        maxResponseLength: 2000,
        allowedCategories: ALL_CATEGORIES.filter(c => c !== 'RTN R&D'),
        contentRestrictions: {
          allowMedicalAdvice: false,
          allowDistributionInfo: true,
          allowStudyDetails: true,
          allowResearchData: true,
          allowPartnerTools: false,
          allowUserContext: false,
        },
        requireDisclaimer: true,
        useSimplicityAgent: true,
      };

    case 'qualified':
      return {
        ...baseConfig,
        maxResponseLength: 3000,
        allowedCategories: ALL_CATEGORIES,
        contentRestrictions: {
          allowMedicalAdvice: true,
          allowDistributionInfo: true,
          allowStudyDetails: true,
          allowResearchData: true,
          allowPartnerTools: false,
          allowUserContext: false,
        },
        requireDisclaimer: true,
        hallucinationDetection: {
          enabled: true,
          model: GUARDRAILS_MODEL,
          confidenceThreshold: 0.65,
        },
        useSimplicityAgent: true,
      };

    case 'certified':
      return {
        ...baseConfig,
        maxResponseLength: 4000,
        allowedCategories: ALL_CATEGORIES,
        contentRestrictions: {
          allowMedicalAdvice: true,
          allowDistributionInfo: true,
          allowStudyDetails: true,
          allowResearchData: true,
          allowPartnerTools: false,
          allowUserContext: false,
        },
        requireDisclaimer: false, // Certified users understand context
        hallucinationDetection: {
          enabled: true,
          model: GUARDRAILS_MODEL,
          confidenceThreshold: 0.6,
        },
        useSimplicityAgent: false, // Full detailed responses
      };

    case 'premium':
      return {
        ...baseConfig,
        maxResponseLength: 5000,
        allowedCategories: ALL_CATEGORIES,
        contentRestrictions: {
          allowMedicalAdvice: true,
          allowDistributionInfo: true,
          allowStudyDetails: true,
          allowResearchData: true,
          allowPartnerTools: false,
          allowUserContext: false,
        },
        requireDisclaimer: false,
        hallucinationDetection: {
          enabled: true,
          model: GUARDRAILS_MODEL,
          confidenceThreshold: 0.5, // Lower threshold for premium
        },
        jailbreakDetection: {
          enabled: true,
          blockOnDetection: false, // Warn but don't block premium
        },
        useSimplicityAgent: false,
      };

    // ===========================================
    // PARTNER TIERS (Production professionals)
    // ===========================================

    case 'partner':
      return {
        ...baseConfig,
        maxResponseLength: 4000,
        allowedCategories: ALL_CATEGORIES,
        contentRestrictions: {
          allowMedicalAdvice: true, // Partners are production professionals
          allowDistributionInfo: true,
          allowStudyDetails: true,
          allowResearchData: true,
          allowPartnerTools: true, // Access to partner-specific tools
          allowUserContext: false, // Basic partners don't get user context
        },
        requireDisclaimer: true, // Still need disclaimers for legal reasons
        hallucinationDetection: {
          enabled: true,
          model: GUARDRAILS_MODEL,
          confidenceThreshold: 0.6,
        },
        useSimplicityAgent: false,
      };

    case 'partner_certified':
      return {
        ...baseConfig,
        maxResponseLength: 6000,
        allowedCategories: ALL_CATEGORIES,
        contentRestrictions: {
          allowMedicalAdvice: true,
          allowDistributionInfo: true,
          allowStudyDetails: true,
          allowResearchData: true,
          allowPartnerTools: true,
          allowUserContext: true, // Can access user context with consent
        },
        requireDisclaimer: false, // Certified partners understand context
        piiDetection: {
          block: false,
          detectEncodedPii: true,
          entities: BASE_PII_ENTITIES,
        },
        hallucinationDetection: {
          enabled: true,
          model: GUARDRAILS_MODEL,
          confidenceThreshold: 0.55,
        },
        jailbreakDetection: {
          enabled: true,
          blockOnDetection: false,
        },
        useSimplicityAgent: false,
      };

    case 'partner_premium':
      return {
        ...baseConfig,
        maxResponseLength: 8000,
        allowedCategories: ALL_CATEGORIES,
        contentRestrictions: {
          allowMedicalAdvice: true,
          allowDistributionInfo: true,
          allowStudyDetails: true,
          allowResearchData: true,
          allowPartnerTools: true,
          allowUserContext: true,
        },
        requireDisclaimer: false,
        piiDetection: {
          block: false,
          detectEncodedPii: true,
          entities: BASE_PII_ENTITIES,
        },
        hallucinationDetection: {
          enabled: true,
          model: GUARDRAILS_MODEL,
          confidenceThreshold: 0.5,
        },
        jailbreakDetection: {
          enabled: true,
          blockOnDetection: false,
        },
        moderation: {
          enabled: true,
          flaggedCategories: ['hate', 'self-harm'], // Reduced moderation for premium partners
        },
        useSimplicityAgent: false,
      };

    default:
      return baseConfig;
  }
}

/**
 * Apply guardrails to response content.
 * Truncates if necessary and appends disclaimer if required.
 */
export function applyGuardrailsToResponse(
  content: string,
  config: GuardrailsConfig,
  language: 'cs' | 'en' = 'cs'
): string {
  let result = content;

  // Truncate if exceeds max length
  if (result.length > config.maxResponseLength) {
    result = result.substring(0, config.maxResponseLength);
    // Find last complete sentence
    const lastPeriod = result.lastIndexOf('. ');
    if (lastPeriod > config.maxResponseLength * 0.7) {
      result = result.substring(0, lastPeriod + 1);
    }
    result += language === 'cs' 
      ? '\n\n[Odpověď byla zkrácena]' 
      : '\n\n[Response was truncated]';
  }

  // Append disclaimer if required
  if (config.requireDisclaimer) {
    const disclaimer = language === 'cs'
      ? '\n\n---\n*Toto není lékařská rada. Pro zdravotní rozhodnutí se vždy poraďte s lékařem.*'
      : '\n\n---\n*This is not medical advice. Always consult a physician for health decisions.*';
    result += disclaimer;
  }

  return result;
}

/**
 * Check if a category is allowed for the given access level.
 */
export function isCategoryAllowed(category: string, config: GuardrailsConfig): boolean {
  return config.allowedCategories.includes(category) || config.allowedCategories.includes('Else');
}

/**
 * Build content restriction prompt based on guardrails config.
 */
export function buildRestrictionPrompt(config: GuardrailsConfig, language: 'cs' | 'en' = 'cs'): string {
  const restrictions: string[] = [];

  if (!config.contentRestrictions.allowMedicalAdvice) {
    restrictions.push(language === 'cs' 
      ? 'NEPOSKYTUJ lékařské rady ani diagnózy'
      : 'DO NOT provide medical advice or diagnoses');
  }

  if (!config.contentRestrictions.allowDistributionInfo) {
    restrictions.push(language === 'cs'
      ? 'NEUVÁDEJ konkrétní dávkování'
      : 'DO NOT mention specific distributions');
  }

  if (!config.contentRestrictions.allowStudyDetails) {
    restrictions.push(language === 'cs'
      ? 'NEODKAZUJ na detaily studií ani protokolů'
      : 'DO NOT reference study details or protocols');
  }

  if (!config.contentRestrictions.allowResearchData) {
    restrictions.push(language === 'cs'
      ? 'NEUVÁDEJ výzkumná data ani statistiky'
      : 'DO NOT mention research data or statistics');
  }

  if (!config.contentRestrictions.allowPartnerTools) {
    restrictions.push(language === 'cs'
      ? 'NEPOSKYTUJ přístup k partnerským nástrojům'
      : 'DO NOT provide access to partner tools');
  }

  if (!config.contentRestrictions.allowUserContext) {
    restrictions.push(language === 'cs'
      ? 'NEPOUŽÍVEJ kontext pacienta v odpovědích'
      : 'DO NOT use user context in responses');
  }

  if (restrictions.length === 0) {
    return '';
  }

  const header = language === 'cs' ? '### OMEZENÍ PRO TUTO ODPOVĚĎ:' : '### RESTRICTIONS FOR THIS RESPONSE:';
  return `${header}\n${restrictions.map(r => `- ${r}`).join('\n')}\n`;
}

/**
 * Mask PII in text (simple implementation for edge function).
 */
export function maskPII(text: string): string {
  // Credit card patterns
  let result = text.replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, '[CARD]');
  
  // Email patterns
  result = result.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL]');
  
  // Phone patterns (CZ and international)
  result = result.replace(/(\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{3,4}/g, '[PHONE]');
  
  // Czech birth number (rodné číslo)
  result = result.replace(/\b\d{6}\/?\d{3,4}\b/g, '[RODNECISLO]');
  
  return result;
}

/**
 * Get guardrails tier label for logging/display
 */
export function getGuardrailsTierLabel(accessLevel: ChatAccessLevel): string {
  const labels: Record<ChatAccessLevel, string> = {
    'none': 'Basic (No Access)',
    'basic': 'Basic Member',
    'enrolled': 'Enrolled Member',
    'active': 'Active Member',
    'qualified': 'Qualified Member',
    'certified': 'Certified Member',
    'premium': 'Premium Member',
    'partner': 'Partner',
    'partner_certified': 'Certified Partner',
    'partner_premium': 'Premium Partner',
  };
  return labels[accessLevel] || 'Unknown';
}

// =============================================================================
// Anti-Lazy-Delegation Detection
// =============================================================================

/** Patterns that indicate vague, non-actionable delegation in synthesis specs. */
const LAZY_DELEGATION_PATTERNS: RegExp[] = [
  /fix\s+based\s+on\s+(the\s+)?findings/i,
  /implement\s+the\s+suggested\s+changes/i,
  /apply\s+the\s+recommendations/i,
  /as\s+described\s+above/i,
  /make\s+the\s+necessary\s+changes/i,
  /address\s+the\s+(issues?|problems?)\s+mentioned/i,
  /resolve\s+the\s+above/i,
  /do\s+what\s+(is\s+)?needed/i,
];

/** Result of anti-lazy-delegation analysis. */
export interface LazyDelegationCheckResult {
  isLazy: boolean;
  matchedPatterns: string[];
}

/**
 * Check if a synthesis/delegation text contains vague, non-actionable language.
 *
 * Concrete specs should reference specific files, functions, and changes.
 * Lazy delegation uses phrases like "fix based on findings" without specifics.
 */
export function detectLazyDelegation(text: string): LazyDelegationCheckResult {
  const matched: string[] = [];
  for (const pattern of LAZY_DELEGATION_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      matched.push(match[0]);
    }
  }
  return { isLazy: matched.length > 0, matchedPatterns: matched };
}
