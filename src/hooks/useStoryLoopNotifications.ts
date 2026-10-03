/**
 * StoryLoop Notifications Hook
 * 
 * Creates and manages notifications for StoryLoop actions
 * (questionnaire requests, meeting invites, reminders, etc.)
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { aisha } from '@/integrations/db/client';
import { safeError } from '@/lib/security/safeLogger';

export type NotificationType = 
  | 'questionnaire_request'
  | 'meeting_request'
  | 'consent_request'
  | 'lab_order'
  | 'distribution_adjustment'
  | 'reminder'
  | 'message';

interface CreateNotificationParams {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
}

const getMetadataValue = (
  metadata: Record<string, unknown>,
  ...keys: string[]
): string | undefined => {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
};

/**
 * Build a member StoryLoop deep link pointing to a specific post.
 */
export function buildMemberStoryEntryLink(storyId: string, entryId: string): string {
  const params = new URLSearchParams({
    view: 'stories',
    story: storyId,
    post: entryId,
  });
  return `/member/story?${params.toString()}`;
}

/**
 * Create a notification for a member from StoryLoop
 */
export function useCreateStoryLoopNotification() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ userId, type, title, message, link }: CreateNotificationParams) => {
      const { data, error } = await aisha.rpc('create_storyloop_notification', {
        p_link: link ?? undefined,
        p_message: message,
        p_title: title,
        p_type: type,
        p_user_id: userId
      });

      if (error) {
        safeError('useCreateStoryLoopNotification.create', error);
        throw new Error(error.message);
      }

      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

/**
 * Helper to build notification content for different entry types
 */
export function buildNotificationContent(
  entryType: NotificationType,
  metadata: Record<string, unknown>,
  t: (key: string) => string
): { title: string; message: string; link?: string } {
  switch (entryType) {
    case 'questionnaire_request': {
      const questionnaireName = getMetadataValue(
        metadata,
        'questionnaire_name',
        'questionnaire_title',
        'questionnaire_key'
      );
      return {
        title: t('notifications.questionnaireRequest.title'),
        message: questionnaireName
          ? t('notifications.questionnaireRequest.message').replace('{{name}}', questionnaireName)
          : t('notifications.questionnaireRequest.title'),
        link: '/member/questionnaires',
      };
    }
    case 'meeting_request': {
      const meetingTitle = getMetadataValue(
        metadata,
        'meeting_title',
        'meeting_type'
      );
      return {
        title: t('notifications.meetingRequest.title'),
        message: meetingTitle
          ? t('notifications.meetingRequest.message').replace('{{title}}', meetingTitle)
          : t('notifications.meetingRequest.title'),
        link: '/member/calendar',
      };
    }
    case 'consent_request': {
      const consentTitle = getMetadataValue(
        metadata,
        'consent_title',
        'consent_name',
        'consent_template_key'
      );
      return {
        title: t('notifications.consentRequest.title'),
        message: consentTitle
          ? t('notifications.consentRequest.message').replace('{{title}}', consentTitle)
          : t('notifications.consentRequest.title'),
        link: '/member/consents',
      };
    }
    case 'lab_order':
      return {
        title: t('notifications.labOrder.title'),
        message: t('notifications.labOrder.message'),
        link: '/member/tracking',
      };

    case 'distribution_adjustment':
      return {
        title: t('notifications.distributionAdjustment.title'),
        message: t('notifications.distributionAdjustment.message'),
        link: '/member/dosing',
      };

    case 'reminder':
      return {
        title: t('notifications.reminder.title'),
        message: (metadata.message as string) || t('notifications.reminder.message'),
      };

    case 'message':
      {
      const preview =
        getMetadataValue(metadata, 'preview', 'content') ??
        t('notifications.message.message');
      return {
        title: t('notifications.message.title'),
        message: preview,
        link: '/member/story',
      };
      }

    default:
      return {
        title: t('notifications.generic.title'),
        message: t('notifications.generic.message'),
      };
  }
}
