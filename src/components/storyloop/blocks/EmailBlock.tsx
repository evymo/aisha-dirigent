/**
 * Email Block
 *
 * Displays sent/received email notifications within a story timeline.
 */

import { useTranslation } from 'react-i18next';
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { Mail, CheckCircle, Clock, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { CommunicationBlockTemplate } from './CommunicationBlockTemplate';

interface EmailMetadata {
  type: 'email';
  subject: string;
  recipient?: string;
  status: 'draft' | 'sent' | 'delivered' | 'failed';
  sent_at?: string;
}

interface EmailBlockProps {
  metadata: EmailMetadata;
  entryId: string;
  storyId: string;
  isPartnerView?: boolean;
}

const statusConfig: Record<string, { icon: React.ElementType; color: string }> = {
  draft: { icon: Clock, color: 'bg-muted text-muted-foreground border-muted' },
  sent: { icon: CheckCircle, color: 'bg-info/10 text-info border-info/20' },
  delivered: { icon: CheckCircle, color: 'bg-success/10 text-success border-success/20' },
  failed: { icon: AlertCircle, color: 'bg-destructive/10 text-destructive border-destructive/20' },
};

export function EmailBlock({
  metadata,
  entryId: _entryId,
  storyId: _storyId,
  isPartnerView: _isPartnerView = true,
}: EmailBlockProps) {
  const { t, i18n } = useTranslation();
  const dateLocale = getDateFnsLocale(i18n.language);

  const config = statusConfig[metadata.status] || statusConfig.sent;
  const StatusIcon = config.icon;

  const body = metadata.sent_at ? (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <CheckCircle className="h-3.5 w-3.5" />
      <span>
        {t('storyloop.sentAt')}: {format(new Date(metadata.sent_at), 'PPp', { locale: dateLocale })}
      </span>
    </div>
  ) : null;

  return (
    <CommunicationBlockTemplate
      cardClassName={cn(config.color)}
      icon={<Mail className="h-4 w-4 text-info" />}
      title={metadata.subject}
      subtitle={
        metadata.recipient
          ? `${t('storyloop.emailRecipient')}: ${t(`storyloop.emailRecipientType.${metadata.recipient}`)}`
          : undefined
      }
      status={{
        label: t(`storyloop.emailStatus.${metadata.status}`),
        icon: <StatusIcon className="h-3 w-3" />,
        className: config.color,
      }}
      body={body}
    />
  );
}
