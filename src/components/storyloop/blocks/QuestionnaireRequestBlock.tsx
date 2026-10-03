/**
 * Questionnaire Request Block
 * 
 * Displays and handles questionnaire/test request entries.
 */

import { useTranslation } from 'react-i18next';
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { ClipboardList, Clock, CheckCircle, AlertCircle, ExternalLink, Coins } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import type { QuestionnaireRequestMetadata } from '@/schemas/storyLoopSchemas';
import { format, isPast } from 'date-fns';
import { CommunicationBlockTemplate } from './CommunicationBlockTemplate';

interface QuestionnaireRequestBlockProps {
  metadata: QuestionnaireRequestMetadata;
  entryId: string;
  storyId: string;
  onViewResults?: (responseId: string) => void;
  onSendReminder?: (entryId: string) => void;
  isPartnerView?: boolean;
}

const statusConfig: Record<string, { icon: React.ElementType; color: string }> = {
  pending: { icon: Clock, color: 'bg-warning/10 text-warning border-warning/20' },
  started: { icon: ClipboardList, color: 'bg-info/10 text-info border-info/20' },
  completed: { icon: CheckCircle, color: 'bg-success/10 text-success border-success/20' },
  expired: { icon: AlertCircle, color: 'bg-destructive/10 text-destructive border-destructive/20' },
};

export function QuestionnaireRequestBlock({
  metadata,
  entryId,
  storyId: _storyId, // Reserved for future navigation
  onViewResults,
  onSendReminder,
  isPartnerView = true,
}: QuestionnaireRequestBlockProps) {
  const { t, i18n } = useTranslation();
  const dateLocale = getDateFnsLocale(i18n.language);
  
  const config = statusConfig[metadata.status] || statusConfig.pending;
  const StatusIcon = config.icon;
  
  const isOverdue = metadata.due_date && isPast(new Date(metadata.due_date)) && metadata.status === 'pending';
  const canSendReminder = isPartnerView && metadata.status === 'pending' && !metadata.reminder_sent;
  const responseId = metadata.response_id;

  const body = (
    <>
      {metadata.due_date ? (
        <div
          className={cn(
            'flex items-center gap-2 text-sm',
            isOverdue ? 'text-destructive' : 'text-muted-foreground'
          )}
        >
          <Clock className="h-3.5 w-3.5" />
          <span>
            {t('storyloop.dueDate')}: {format(new Date(metadata.due_date), 'PP', { locale: dateLocale })}
          </span>
          {isOverdue ? (
            <Badge variant="destructive" className="text-xs">
              {t('storyloop.overdue')}
            </Badge>
          ) : null}
        </div>
      ) : null}

      {metadata.status === 'started' ? (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{t('storyloop.inProgress')}</span>
            <span>--</span>
          </div>
          <Progress value={50} className="h-1.5" />
        </div>
      ) : null}

      {metadata.status === 'completed' && metadata.completed_at ? (
        <div className="rounded-md border border-success/20 bg-success/5 p-2">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-success" />
            <span className="text-sm">
              {t('storyloop.completedAt')}: {format(new Date(metadata.completed_at), 'PPp', { locale: dateLocale })}
            </span>
          </div>
        </div>
      ) : null}
    </>
  );

  const actions = [
    ...(metadata.status === 'completed' && responseId && onViewResults
      ? [{
          id: 'view-results',
          label: t('storyloop.viewResults'),
          onClick: () => onViewResults(responseId),
          icon: <ExternalLink className="h-3.5 w-3.5" />,
          variant: 'default' as const,
        }]
      : []),
    ...(canSendReminder && onSendReminder
      ? [{
          id: 'send-reminder',
          label: t('storyloop.sendReminder'),
          onClick: () => onSendReminder(entryId),
          variant: 'outline' as const,
        }]
      : []),
  ];

  return (
    <CommunicationBlockTemplate
      cardClassName={cn(config.color)}
      icon={<ClipboardList className="h-4 w-4 text-primary" />}
      title={metadata.questionnaire_name}
      subtitle={metadata.questionnaire_key}
      status={{
        label: t(`storyloop.questionnaireStatus.${metadata.status}`),
        icon: <StatusIcon className="h-3 w-3" />,
        className: config.color,
      }}
      headerAside={
        metadata.token_reward && metadata.token_reward > 0 && metadata.status !== 'completed' ? (
          <Badge
            variant="secondary"
            className="gap-1 bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
          >
            <Coins className="h-3 w-3" />
            +{metadata.token_reward}
          </Badge>
        ) : null
      }
      body={body}
      actions={actions}
    />
  );
}
