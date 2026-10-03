/**
 * Consent Request Block
 * 
 * Displays and handles consent signature request entries.
 */

import { useTranslation } from 'react-i18next';
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { FileSignature, Clock, CheckCircle, XCircle, AlertCircle, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ConsentRequestMetadata } from '@/schemas/storyLoopSchemas';
import { format } from 'date-fns';
import { CommunicationBlockTemplate } from './CommunicationBlockTemplate';

interface ConsentRequestBlockProps {
  metadata: ConsentRequestMetadata;
  entryId: string;
  storyId: string;
  onViewConsent?: (consentId: string) => void;
  onResend?: (entryId: string) => void;
  isPartnerView?: boolean;
}

const statusConfig: Record<string, { icon: React.ElementType; color: string }> = {
  pending: { icon: Clock, color: 'bg-warning/10 text-warning border-warning/20' },
  signed: { icon: CheckCircle, color: 'bg-success/10 text-success border-success/20' },
  declined: { icon: XCircle, color: 'bg-destructive/10 text-destructive border-destructive/20' },
  expired: { icon: AlertCircle, color: 'bg-muted text-muted-foreground border-muted' },
};

export function ConsentRequestBlock({
  metadata,
  entryId,
  storyId: _storyId, // Reserved for future navigation
  onViewConsent,
  onResend,
  isPartnerView = true,
}: ConsentRequestBlockProps) {
  const { t, i18n } = useTranslation();
  const dateLocale = getDateFnsLocale(i18n.language);
  
  const config = statusConfig[metadata.status] || statusConfig.pending;
  const StatusIcon = config.icon;
  const consentId = metadata.consent_id;

  const body = (
    <>
      {metadata.status === 'signed' && metadata.signed_at ? (
        <div className="rounded-md border border-success/20 bg-success/5 p-2">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-success" />
            <span className="text-sm">
              {t('storyloop.signedAt')}: {format(new Date(metadata.signed_at), 'PPp', { locale: dateLocale })}
            </span>
          </div>
        </div>
      ) : null}

      {metadata.status === 'declined' ? (
        <div className="rounded-md border border-destructive/20 bg-destructive/5 p-2">
          <div className="flex items-center gap-2">
            <XCircle className="h-4 w-4 text-destructive" />
            <span className="text-sm text-destructive">{t('storyloop.consentDeclined')}</span>
          </div>
        </div>
      ) : null}
    </>
  );

  const actions = [
    ...(metadata.status === 'signed' && consentId && onViewConsent
      ? [{
          id: 'view-consent',
          label: t('storyloop.viewConsent'),
          onClick: () => onViewConsent(consentId),
          icon: <ExternalLink className="h-3.5 w-3.5" />,
          variant: 'default' as const,
        }]
      : []),
    ...(metadata.status === 'pending' && isPartnerView && onResend
      ? [{
          id: 'resend',
          label: t('storyloop.resendRequest'),
          onClick: () => onResend(entryId),
          variant: 'outline' as const,
        }]
      : []),
  ];

  return (
    <CommunicationBlockTemplate
      cardClassName={cn(config.color)}
      icon={<FileSignature className="h-4 w-4 text-primary" />}
      title={metadata.consent_name}
      subtitle={metadata.requires_signature ? t('storyloop.requiresSignature') : t('storyloop.noSignatureRequired')}
      status={{
        label: t(`storyloop.consentStatus.${metadata.status}`),
        icon: <StatusIcon className="h-3 w-3" />,
        className: config.color,
      }}
      body={body}
      actions={actions}
    />
  );
}
