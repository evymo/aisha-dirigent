/**
 * Story Entry Block Renderer
 * 
 * Renders the appropriate block component based on entry type.
 */

import type {
  StoryEntry,
  MeetingRequestMetadata,
  QuestionnaireRequestMetadata,
  ConsentRequestMetadata,
  LabOrderMetadata,
  DistributionAdjustmentMetadata,
  BloodMatrixAnalysisMetadata,
  WebArtifactUploadMetadata,
  WebArtifactScrapeMetadata,
  WebArtifactAishaProposalMetadata,
  WebArtifactAppliedMetadata,
  WebArtifactPublishedMetadata,
  WebArtifactFailedMetadata,
  QaPlaywrightRequestedMetadata,
  QaPlaywrightApprovedMetadata,
  QaPlaywrightPassedMetadata,
  QaPlaywrightFailedMetadata,
} from '@/schemas/storyLoopSchemas';
import { MeetingRequestBlock } from './MeetingRequestBlock';
import { QuestionnaireRequestBlock } from './QuestionnaireRequestBlock';
import { ConsentRequestBlock } from './ConsentRequestBlock';
import { FlowConsentGateBlock } from './FlowConsentGateBlock';
import { RepriceProposalBlock } from './RepriceProposalBlock';
import { FlowStepBlock } from './FlowStepBlock';
import { LabOrderBlock } from './LabOrderBlock';
import { DistributionAdjustmentBlock } from './DistributionAdjustmentBlock';
import { BloodMatrixAnalysisBlock } from './BloodMatrixAnalysisBlock';
import { EmailBlock } from './EmailBlock';
import { WebArtifactUploadBlock } from './WebArtifactUploadBlock';
import { WebArtifactScrapeBlock } from './WebArtifactScrapeBlock';
import { WebArtifactAishaProposalBlock } from './WebArtifactAishaProposalBlock';
import { WebArtifactAppliedBlock } from './WebArtifactAppliedBlock';
import { WebArtifactPublishedBlock } from './WebArtifactPublishedBlock';
import { WebArtifactFailedBlock } from './WebArtifactFailedBlock';
import { QaPlaywrightRequestedBlock } from './QaPlaywrightRequestedBlock';
import { QaPlaywrightApprovedBlock } from './QaPlaywrightApprovedBlock';
import { QaPlaywrightPassedBlock } from './QaPlaywrightPassedBlock';
import { QaPlaywrightFailedBlock } from './QaPlaywrightFailedBlock';

interface StoryEntryBlockRendererProps {
  entry: StoryEntry;
  storyId: string;
  onMeetingAccept?: (entryId: string, time?: string) => void;
  onMeetingDecline?: (entryId: string) => void;
  onMeetingReschedule?: (entryId: string) => void;
  onQuestionnaireViewResults?: (responseId: string) => void;
  onQuestionnaireSendReminder?: (entryId: string) => void;
  onConsentView?: (consentId: string) => void;
  onConsentResend?: (entryId: string) => void;
  onApproveFlowGate?: (entryId: string, graphId: string) => void;
  onConfirmReprice?: (entryId: string) => void;
  onRejectReprice?: (entryId: string) => void;
  onLabViewResults?: (resultId: string) => void;
  isPartnerView?: boolean;
}

/**
 * Renders the appropriate block component for structured entry types
 */
export function StoryEntryBlockRenderer({
  entry,
  storyId,
  onMeetingAccept,
  onMeetingDecline,
  onMeetingReschedule,
  onQuestionnaireViewResults,
  onQuestionnaireSendReminder,
  onConsentView,
  onConsentResend,
  onApproveFlowGate,
  onConfirmReprice,
  onRejectReprice,
  onLabViewResults,
  isPartnerView = true,
}: StoryEntryBlockRendererProps) {
  const metadata = entry.metadata as Record<string, unknown>;
  const registry = {
    meeting_request: () => (
      <MeetingRequestBlock
        metadata={metadata as unknown as MeetingRequestMetadata}
        entryId={entry.id}
        storyId={storyId}
        onAccept={onMeetingAccept}
        onDecline={onMeetingDecline}
        onReschedule={onMeetingReschedule}
        isPartnerView={isPartnerView}
      />
    ),
    questionnaire_request: () => (
      <QuestionnaireRequestBlock
        metadata={metadata as unknown as QuestionnaireRequestMetadata}
        entryId={entry.id}
        storyId={storyId}
        onViewResults={onQuestionnaireViewResults}
        onSendReminder={onQuestionnaireSendReminder}
        isPartnerView={isPartnerView}
      />
    ),
    consent_request: () => {
      // The flowboard consent gate shares entry_type with the clinical consent block —
      // discriminate on metadata.flowboard.kind.
      const fb = (metadata as { flowboard?: { kind?: string } }).flowboard;
      return fb?.kind === 'consent_request' ? (
        <FlowConsentGateBlock
          metadata={metadata}
          reason={entry.content ?? undefined}
          entryId={entry.id}
          onApprove={onApproveFlowGate}
        />
      ) : (
        <ConsentRequestBlock
          metadata={metadata as unknown as ConsentRequestMetadata}
          entryId={entry.id}
          storyId={storyId}
          onViewConsent={onConsentView}
          onResend={onConsentResend}
          isPartnerView={isPartnerView}
        />
      );
    },
    reprice_proposal: () => (
      <RepriceProposalBlock
        metadata={metadata}
        reason={entry.content ?? undefined}
        entryId={entry.id}
        onConfirm={onConfirmReprice}
        onReject={onRejectReprice}
      />
    ),
    flow_run: () => <FlowStepBlock metadata={metadata} content={entry.content ?? undefined} />,
    automation_step: () => <FlowStepBlock metadata={metadata} content={entry.content ?? undefined} />,
    lab_order: () => (
      <LabOrderBlock
        metadata={metadata as unknown as LabOrderMetadata}
        entryId={entry.id}
        storyId={storyId}
        onViewResults={onLabViewResults}
        isPartnerView={isPartnerView}
      />
    ),
    distribution_adjustment: () => (
      <DistributionAdjustmentBlock
        metadata={metadata as unknown as DistributionAdjustmentMetadata}
        entryId={entry.id}
        storyId={storyId}
        isPartnerView={isPartnerView}
      />
    ),
    blood_matrix_analysis: () => (
      <BloodMatrixAnalysisBlock
        metadata={metadata as unknown as BloodMatrixAnalysisMetadata}
        entryId={entry.id}
        storyId={storyId}
        isPartnerView={isPartnerView}
      />
    ),
    email: () => (
      <EmailBlock
        metadata={metadata as unknown as { type: 'email'; subject: string; recipient?: string; status: 'draft' | 'sent' | 'delivered' | 'failed'; sent_at?: string }}
        entryId={entry.id}
        storyId={storyId}
        isPartnerView={isPartnerView}
      />
    ),
    web_artifact_upload: () => (
      <WebArtifactUploadBlock
        metadata={metadata as unknown as WebArtifactUploadMetadata}
        entryId={entry.id}
        storyId={storyId}
      />
    ),
    web_artifact_scrape: () => (
      <WebArtifactScrapeBlock
        metadata={metadata as unknown as WebArtifactScrapeMetadata}
        entryId={entry.id}
        storyId={storyId}
      />
    ),
    web_artifact_aisha_proposal: () => (
      <WebArtifactAishaProposalBlock
        metadata={metadata as unknown as WebArtifactAishaProposalMetadata}
        entryId={entry.id}
        storyId={storyId}
      />
    ),
    web_artifact_applied: () => (
      <WebArtifactAppliedBlock
        metadata={metadata as unknown as WebArtifactAppliedMetadata}
        entryId={entry.id}
        storyId={storyId}
      />
    ),
    web_artifact_published: () => (
      <WebArtifactPublishedBlock
        metadata={metadata as unknown as WebArtifactPublishedMetadata}
        entryId={entry.id}
        storyId={storyId}
      />
    ),
    web_artifact_failed: () => (
      <WebArtifactFailedBlock
        metadata={metadata as unknown as WebArtifactFailedMetadata}
        entryId={entry.id}
        storyId={storyId}
      />
    ),
    qa_playwright_requested: () => (
      <QaPlaywrightRequestedBlock
        metadata={metadata as unknown as QaPlaywrightRequestedMetadata}
        entryId={entry.id}
        storyId={storyId}
      />
    ),
    qa_playwright_approved: () => (
      <QaPlaywrightApprovedBlock
        metadata={metadata as unknown as QaPlaywrightApprovedMetadata}
        entryId={entry.id}
        storyId={storyId}
      />
    ),
    qa_playwright_passed: () => (
      <QaPlaywrightPassedBlock
        metadata={metadata as unknown as QaPlaywrightPassedMetadata}
        entryId={entry.id}
        storyId={storyId}
      />
    ),
    qa_playwright_failed: () => (
      <QaPlaywrightFailedBlock
        metadata={metadata as unknown as QaPlaywrightFailedMetadata}
        entryId={entry.id}
        storyId={storyId}
      />
    ),
  } satisfies Partial<Record<StoryEntry['entry_type'], () => JSX.Element>>;

  const renderBlock = registry[entry.entry_type];
  return renderBlock ? renderBlock() : null;
}
