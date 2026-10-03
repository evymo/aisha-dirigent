/**
 * Partner Template Schemas
 * 
 * Defines the structure for partner-created templates.
 * Templates can only use predefined blocks/questionnaires from our library.
 */

import { z } from 'zod';
// StoryEntryTypeSchema reserved for future block-to-entry mapping

// =====================================================
// Available Block Types for Templates
// =====================================================

/**
 * Predefined block types that partners can use in templates.
 * Partners cannot create completely custom blocks - only select from this library.
 */
export const TemplateBlockTypeSchema = z.enum([
  // Meeting blocks
  'meeting_onboarding',
  'meeting_consultation',
  'meeting_check_in',

  // Questionnaire blocks (dynamic - loaded from study_questionnaires)
  // Using 'questionnaire_dynamic' for real study questionnaires
  'questionnaire_dynamic',

  // Legacy/fallback questionnaire blocks (for templates without study context)
  'questionnaire_subjective',
  'questionnaire_womac',
  'questionnaire_pain_assessment',
  'questionnaire_quality_of_life',
  'questionnaire_medication_adherence',

  // Consent blocks
  'consent_data_sharing',
  'consent_study_participation',
  'consent_research_use',

  // Information blocks
  'info_welcome',
  'info_study_overview',
  'info_distribution_instructions',

  // Action blocks
  'action_upload_document',
  'action_schedule_lab',
  'action_review_results',
]);

export type TemplateBlockType = z.infer<typeof TemplateBlockTypeSchema>;

// =====================================================
// Block Configuration in Template
// =====================================================

export const TemplateBlockConfigSchema = z.object({
  id: z.string().uuid(),
  block_type: TemplateBlockTypeSchema,
  order: z.number(),
  is_required: z.boolean(),
  delay_days: z.number().int().nonnegative().optional(),
  custom_title: z.string().optional(),
  custom_description: z.string().optional(),
  condition: z
    .object({
      depends_on: z.string().uuid().optional(),
      require_status: z.enum(['completed', 'any']).optional(),
    })
    .optional(),

  // For dynamic questionnaire blocks - reference to actual questionnaire
  questionnaire_key: z.string().optional(),
  questionnaire_id: z.string().uuid().optional(),

  // For dynamic consent blocks - reference to actual consent template
  consent_template_id: z.string().uuid().optional(),
});

export type TemplateBlockConfig = z.infer<typeof TemplateBlockConfigSchema>;

// =====================================================
// Partner Template
// =====================================================

export const PartnerTemplateSchema = z.object({
  id: z.string().uuid(),
  partner_id: z.string().uuid(),

  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  category: z.enum(['onboarding', 'follow_up', 'assessment', 'custom']),
  is_active: z.boolean(),
  is_default: z.boolean(),

  blocks: z.array(TemplateBlockConfigSchema),
  study_id: z.string().uuid().optional(),

  usage_count: z.number(),
  last_used_at: z.string().nullable(),

  created_at: z.string(),
  updated_at: z.string(),
});

export type PartnerTemplate = z.infer<typeof PartnerTemplateSchema>;

// =====================================================
// Block Library Entry (what partners see when selecting)
// =====================================================

export const BlockLibraryEntrySchema = z.object({
  block_type: TemplateBlockTypeSchema,
  category: z.enum(['meeting', 'questionnaire', 'consent', 'info', 'action']),
  name_key: z.string(),
  description_key: z.string(),
  icon: z.string(),
  estimated_duration_minutes: z.number().optional(),
  requires_consent: z.boolean(),

  questionnaire_key: z.string().optional(),
  questionnaire_id: z.string().uuid().optional(),
  consent_template_key: z.string().optional(),

  display_name: z.string().optional(),
  display_description: z.string().optional(),
});

export type BlockLibraryEntry = z.infer<typeof BlockLibraryEntrySchema>;

// =====================================================
// Block Library (predefined blocks partners can use)
// =====================================================

export const BLOCK_LIBRARY: BlockLibraryEntry[] = [
  // Meeting blocks
  {
    block_type: 'meeting_onboarding',
    category: 'meeting',
    name_key: 'templates.blockLibrary.meetingOnboarding',
    description_key: 'templates.blockLibrary.meetingOnboardingDesc',
    icon: 'Calendar',
    estimated_duration_minutes: 30,
    requires_consent: false,
  },
  {
    block_type: 'meeting_consultation',
    category: 'meeting',
    name_key: 'templates.blockLibrary.meetingConsultation',
    description_key: 'templates.blockLibrary.meetingConsultationDesc',
    icon: 'Calendar',
    estimated_duration_minutes: 45,
    requires_consent: false,
  },
  {
    block_type: 'meeting_check_in',
    category: 'meeting',
    name_key: 'templates.blockLibrary.meetingCheckIn',
    description_key: 'templates.blockLibrary.meetingCheckInDesc',
    icon: 'Calendar',
    estimated_duration_minutes: 15,
    requires_consent: false,
  },

  // Questionnaire blocks
  {
    block_type: 'questionnaire_subjective',
    category: 'questionnaire',
    name_key: 'templates.blockLibrary.questionnaireSubjective',
    description_key: 'templates.blockLibrary.questionnaireSubjectiveDesc',
    icon: 'ClipboardList',
    estimated_duration_minutes: 5,
    requires_consent: true,
    questionnaire_key: 'OS-SUBJECTIVE',
  },
  {
    block_type: 'questionnaire_womac',
    category: 'questionnaire',
    name_key: 'templates.blockLibrary.questionnaireWomac',
    description_key: 'templates.blockLibrary.questionnaireWomacDesc',
    icon: 'ClipboardList',
    estimated_duration_minutes: 10,
    requires_consent: true,
    questionnaire_key: 'WOMAC',
  },
  {
    block_type: 'questionnaire_pain_assessment',
    category: 'questionnaire',
    name_key: 'templates.blockLibrary.questionnairePain',
    description_key: 'templates.blockLibrary.questionnairePainDesc',
    icon: 'Activity',
    estimated_duration_minutes: 5,
    requires_consent: true,
    questionnaire_key: 'PAIN-ASSESSMENT',
  },
  {
    block_type: 'questionnaire_quality_of_life',
    category: 'questionnaire',
    name_key: 'templates.blockLibrary.questionnaireQol',
    description_key: 'templates.blockLibrary.questionnaireQolDesc',
    icon: 'Heart',
    estimated_duration_minutes: 10,
    requires_consent: true,
    questionnaire_key: 'QUALITY-OF-LIFE',
  },
  {
    block_type: 'questionnaire_medication_adherence',
    category: 'questionnaire',
    name_key: 'templates.blockLibrary.questionnaireAdherence',
    description_key: 'templates.blockLibrary.questionnaireAdherenceDesc',
    icon: 'Pill',
    estimated_duration_minutes: 3,
    requires_consent: true,
    questionnaire_key: 'MEDICATION-ADHERENCE',
  },

  // Consent blocks
  {
    block_type: 'consent_data_sharing',
    category: 'consent',
    name_key: 'templates.blockLibrary.consentDataSharing',
    description_key: 'templates.blockLibrary.consentDataSharingDesc',
    icon: 'FileSignature',
    requires_consent: false,
    consent_template_key: 'DATA_SHARING',
  },
  {
    block_type: 'consent_study_participation',
    category: 'consent',
    name_key: 'templates.blockLibrary.consentStudy',
    description_key: 'templates.blockLibrary.consentStudyDesc',
    icon: 'FileSignature',
    requires_consent: false,
    consent_template_key: 'STUDY_PARTICIPATION',
  },
  {
    block_type: 'consent_research_use',
    category: 'consent',
    name_key: 'templates.blockLibrary.consentResearch',
    description_key: 'templates.blockLibrary.consentResearchDesc',
    icon: 'FileSignature',
    requires_consent: false,
    consent_template_key: 'RESEARCH_USE',
  },

  // Info blocks
  {
    block_type: 'info_welcome',
    category: 'info',
    name_key: 'templates.blockLibrary.infoWelcome',
    description_key: 'templates.blockLibrary.infoWelcomeDesc',
    icon: 'MessageSquare',
    requires_consent: false,
  },
  {
    block_type: 'info_study_overview',
    category: 'info',
    name_key: 'templates.blockLibrary.infoStudy',
    description_key: 'templates.blockLibrary.infoStudyDesc',
    icon: 'BookOpen',
    requires_consent: false,
  },
  {
    block_type: 'info_distribution_instructions',
    category: 'info',
    name_key: 'templates.blockLibrary.infoDistribution',
    description_key: 'templates.blockLibrary.infoDistributionDesc',
    icon: 'Pill',
    requires_consent: false,
  },

  // Action blocks
  {
    block_type: 'action_upload_document',
    category: 'action',
    name_key: 'templates.blockLibrary.actionUpload',
    description_key: 'templates.blockLibrary.actionUploadDesc',
    icon: 'Upload',
    requires_consent: true,
  },
  {
    block_type: 'action_schedule_lab',
    category: 'action',
    name_key: 'templates.blockLibrary.actionLab',
    description_key: 'templates.blockLibrary.actionLabDesc',
    icon: 'FlaskConical',
    requires_consent: false,
  },
  {
    block_type: 'action_review_results',
    category: 'action',
    name_key: 'templates.blockLibrary.actionReview',
    description_key: 'templates.blockLibrary.actionReviewDesc',
    icon: 'CheckCircle',
    requires_consent: true,
  },
];

// =====================================================
// Helper Functions
// =====================================================

export function getBlockByType(blockType: TemplateBlockType): BlockLibraryEntry | undefined {
  return BLOCK_LIBRARY.find(b => b.block_type === blockType);
}

export function getBlocksByCategory(category: BlockLibraryEntry['category']): BlockLibraryEntry[] {
  return BLOCK_LIBRARY.filter(b => b.category === category);
}

/**
 * Merge static block library with dynamic study questionnaires.
 * Study questionnaires are added as 'questionnaire_dynamic' blocks.
 */
export function mergeWithStudyQuestionnaires(
  studyQuestionnaires: Array<{
    id: string;
    title: string;
    description: string;
    is_required: boolean;
  }>
): BlockLibraryEntry[] {
  // Create dynamic questionnaire entries
  const dynamicQuestionnaireEntries: BlockLibraryEntry[] = studyQuestionnaires.map((q) => ({
    block_type: 'questionnaire_dynamic' as const,
    category: 'questionnaire' as const,
    name_key: 'templates.blockLibrary.questionnaireDynamic',
    description_key: 'templates.blockLibrary.questionnaireDynamicDesc',
    icon: 'ClipboardList',
    estimated_duration_minutes: 5,
    requires_consent: true,
    questionnaire_id: q.id,
    display_name: q.title,
    display_description: q.description,
  }));

  // Filter out static questionnaire blocks when dynamic ones are available
  const staticBlocksFiltered = dynamicQuestionnaireEntries.length > 0
    ? BLOCK_LIBRARY.filter(b => b.category !== 'questionnaire')
    : BLOCK_LIBRARY;

  return [...staticBlocksFiltered, ...dynamicQuestionnaireEntries];
}

/**
 * Get merged blocks by category, including dynamic questionnaires.
 */
export function getMergedBlocksByCategory(
  category: BlockLibraryEntry['category'],
  allBlocks: BlockLibraryEntry[]
): BlockLibraryEntry[] {
  return allBlocks.filter(b => b.category === category);
}
