/**
 * Story Block Actions Hook
 *
 * Provides callbacks for block-level actions in StoryDetail:
 * meeting accept/decline/reschedule, questionnaire view/remind,
 * consent view/resend, lab results view.
 *
 * All mutations go through `respond_to_story_block_audited` RPC.
 * Detail views (questionnaire, consent, lab) open modal dialogs
 * via state managed by this hook.
 *
 * @module useStoryBlockActions
 */

import { useCallback, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { aisha } from '@/integrations/db/client';
import { safeError } from '@/lib/security/safeLogger';
import { storyLoopKeys } from './useStoryLoop';

// =====================================================
// Core mutation
// =====================================================

interface RespondToBlockParams {
  action: string;
  action_data?: Record<string, unknown>;
  entry_id: string;
  story_id: string;
}

function useRespondToStoryBlock() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: RespondToBlockParams) => {
      const { data, error } = await aisha.rpc('respond_to_story_block_audited', {
        p_action: params.action,
        p_action_data: JSON.parse(JSON.stringify(params.action_data ?? {})),
        p_entry_id: params.entry_id,
        p_story_id: params.story_id,
      });

      if (error) {
        safeError('storyloop.respondToBlock', error);
        throw new Error(error.message);
      }

      return data as Record<string, unknown>;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: storyLoopKeys.story(variables.story_id) });
      queryClient.invalidateQueries({ queryKey: storyLoopKeys.stories() });
    },
  });
}

// =====================================================
// Public hook
// =====================================================

/**
 * Hook that provides all block action callbacks for a given story.
 *
 * Usage in StoryDetail:
 * ```tsx
 * const actions = useStoryBlockActions(storyId);
 * <StoryEntryBlockRenderer
 *   {...props}
 *   onMeetingAccept={actions.onMeetingAccept}
 *   onMeetingDecline={actions.onMeetingDecline}
 *   ... />
 * ```
 */
export function useStoryBlockActions(storyId: string | null) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const respondMutation = useRespondToStoryBlock();

  // ── Response detail modal state ────────────────
  const [responseDetailId, setResponseDetailId] = useState<string | null>(null);
  const [responseDetailOpen, setResponseDetailOpen] = useState(false);

  // ── Consent detail modal state ────────────────
  const [consentDetailId, setConsentDetailId] = useState<string | null>(null);
  const [consentDetailOpen, setConsentDetailOpen] = useState(false);

  // ── Lab result detail modal state ─────────────
  const [labDetailId, setLabDetailId] = useState<string | null>(null);
  const [labDetailOpen, setLabDetailOpen] = useState(false);

  const effectiveStoryId = storyId ?? '';

  // ── Meeting ───────────────────────────────────

  const onMeetingAccept = useCallback(
    (entryId: string, time?: string) => {
      if (!effectiveStoryId) return;
      respondMutation.mutate(
        {
          action: 'accept_meeting',
          action_data: time ? { accepted_time: time } : {},
          entry_id: entryId,
          story_id: effectiveStoryId,
        },
        {
          onSuccess: () => toast.success(t('storyloop.blockActions.meetingAccepted')),
          onError: () => toast.error(t('storyloop.blockActions.actionFailed')),
        },
      );
    },
    [effectiveStoryId, respondMutation, t],
  );

  const onMeetingDecline = useCallback(
    (entryId: string) => {
      if (!effectiveStoryId) return;
      respondMutation.mutate(
        {
          action: 'decline_meeting',
          entry_id: entryId,
          story_id: effectiveStoryId,
        },
        {
          onSuccess: () => toast.success(t('storyloop.blockActions.meetingDeclined')),
          onError: () => toast.error(t('storyloop.blockActions.actionFailed')),
        },
      );
    },
    [effectiveStoryId, respondMutation, t],
  );

  const onMeetingReschedule = useCallback(
    (entryId: string) => {
      if (!effectiveStoryId) return;
      respondMutation.mutate(
        {
          action: 'reschedule_meeting',
          entry_id: entryId,
          story_id: effectiveStoryId,
        },
        {
          onSuccess: () => toast.success(t('storyloop.blockActions.meetingRescheduled')),
          onError: () => toast.error(t('storyloop.blockActions.actionFailed')),
        },
      );
    },
    [effectiveStoryId, respondMutation, t],
  );

  // ── Questionnaire ─────────────────────────────

  const onQuestionnaireViewResults = useCallback(
    (responseId: string) => {
      setResponseDetailId(responseId);
      setResponseDetailOpen(true);
    },
    [],
  );

  const onQuestionnaireSendReminder = useCallback(
    (entryId: string) => {
      if (!effectiveStoryId) return;
      respondMutation.mutate(
        {
          action: 'send_questionnaire_reminder',
          entry_id: entryId,
          story_id: effectiveStoryId,
        },
        {
          onSuccess: () => toast.success(t('storyloop.blockActions.reminderSent')),
          onError: () => toast.error(t('storyloop.blockActions.actionFailed')),
        },
      );
    },
    [effectiveStoryId, respondMutation, t],
  );

  // ── Consent ───────────────────────────────────

  const onConsentView = useCallback(
    (consentId: string) => {
      setConsentDetailId(consentId);
      setConsentDetailOpen(true);
    },
    [],
  );

  const onConsentResend = useCallback(
    (entryId: string) => {
      if (!effectiveStoryId) return;
      respondMutation.mutate(
        {
          action: 'resend_consent_request',
          entry_id: entryId,
          story_id: effectiveStoryId,
        },
        {
          onSuccess: () => toast.success(t('storyloop.blockActions.consentResent')),
          onError: () => toast.error(t('storyloop.blockActions.actionFailed')),
        },
      );
    },
    [effectiveStoryId, respondMutation, t],
  );

  // ── Flowboard consent gate ────────────────────

  const onApproveFlowGate = useCallback(
    (entryId: string, graphId: string) => {
      if (!effectiveStoryId) return;
      const sid = effectiveStoryId;
      respondMutation.mutate(
        { action: 'approve_flow_gate', entry_id: entryId, story_id: sid },
        {
          onSuccess: async () => {
            // Resume the run: re-invoke the executor, which reads the approval from the story's
            // provenance and continues past the gate, then refresh the timeline.
            const { error } = await aisha.functions.invoke('flowboard-execute', {
              body: { graph_id: graphId, story_id: sid },
            });
            if (error) {
              toast.error(t('storyloop.blockActions.actionFailed'));
              return;
            }
            toast.success(t('flowboard.page.runResumed'));
            queryClient.invalidateQueries({ queryKey: storyLoopKeys.story(sid) });
          },
          onError: () => toast.error(t('storyloop.blockActions.actionFailed')),
        },
      );
    },
    [effectiveStoryId, respondMutation, queryClient, t],
  );

  // ── Reprice (the cenotvorba gate: confirm/reject in the story) ─────────────

  const onConfirmReprice = useCallback(
    (entryId: string) => {
      if (!effectiveStoryId) return;
      respondMutation.mutate(
        { action: 'confirm_reprice', entry_id: entryId, story_id: effectiveStoryId },
        {
          onSuccess: () => toast.success(t('storyloop.reprice.confirmedToast')),
          onError: () => toast.error(t('storyloop.blockActions.actionFailed')),
        },
      );
    },
    [effectiveStoryId, respondMutation, t],
  );

  const onRejectReprice = useCallback(
    (entryId: string) => {
      if (!effectiveStoryId) return;
      respondMutation.mutate(
        { action: 'reject_reprice', entry_id: entryId, story_id: effectiveStoryId },
        {
          onSuccess: () => toast.success(t('storyloop.reprice.rejectedToast')),
          onError: () => toast.error(t('storyloop.blockActions.actionFailed')),
        },
      );
    },
    [effectiveStoryId, respondMutation, t],
  );

  // ── Lab ───────────────────────────────────────

  const onLabViewResults = useCallback(
    (resultId: string) => {
      setLabDetailId(resultId);
      setLabDetailOpen(true);
    },
    [],
  );

  return {
    /** UUID of the consent being viewed in the detail modal */
    consentDetailId,
    /** Whether the consent detail modal is open */
    consentDetailOpen,
    onApproveFlowGate,
    onConfirmReprice,
    onRejectReprice,
    onConsentResend,
    onConsentView,
    onLabViewResults,
    onMeetingAccept,
    onMeetingDecline,
    onMeetingReschedule,
    onQuestionnaireViewResults,
    onQuestionnaireSendReminder,
    /** UUID of the response being viewed in the detail modal */
    responseDetailId,
    /** Whether the response detail modal is open */
    responseDetailOpen,
    /** Setter for the consent detail modal open state */
    setConsentDetailOpen,
    /** UUID of the lab result being viewed in the detail modal */
    labDetailId,
    /** Whether the lab detail modal is open */
    labDetailOpen,
    /** Setter for the lab detail modal open state */
    setLabDetailOpen,
    /** Setter for the response detail modal open state */
    setResponseDetailOpen,
    /** True while a block mutation is in flight */
    isPending: respondMutation.isPending,
  };
}
