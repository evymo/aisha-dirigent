/**
 * Distribution Adjustment Block
 * 
 * Displays distribution change notifications.
 */

import { useTranslation } from 'react-i18next';
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { Pill, ArrowRight, Calendar, Info } from 'lucide-react';
import type { DistributionAdjustmentMetadata } from '@/schemas/storyLoopSchemas';
import { format } from 'date-fns';
import { CommunicationBlockTemplate } from './CommunicationBlockTemplate';

interface DistributionAdjustmentBlockProps {
  metadata: DistributionAdjustmentMetadata;
  entryId: string;
  storyId: string;
  isPartnerView?: boolean;
}

export function DistributionAdjustmentBlock({
  metadata,
  entryId: _entryId, // Reserved for future actions
  storyId: _storyId, // Reserved for future navigation
  isPartnerView: _isPartnerView = true, // Reserved for view-specific rendering
}: DistributionAdjustmentBlockProps) {
  const { t, i18n } = useTranslation();
  const dateLocale = getDateFnsLocale(i18n.language);

  const body = (
    <>
      <div className="flex items-center gap-3 rounded-md bg-background p-2">
        {metadata.previous_dose ? (
          <>
            <div className="text-center">
              <p className="text-xs text-muted-foreground">{t('storyloop.previousDose')}</p>
              <p className="font-mono text-sm text-muted-foreground line-through">
                {metadata.previous_dose}
              </p>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </>
        ) : null}

        <div className="text-center">
          <p className="text-xs text-muted-foreground">{t('storyloop.newDose')}</p>
          <p className="font-mono text-sm font-medium text-foreground">{metadata.new_dose}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Calendar className="h-3.5 w-3.5" />
        <span>
          {t('storyloop.effectiveFrom')}:{' '}
          {(() => {
            try {
              const d = new Date(metadata.effective_from);
              return Number.isNaN(d.getTime()) ? metadata.effective_from : format(d, 'PP', { locale: dateLocale });
            } catch {
              return metadata.effective_from;
            }
          })()}
        </span>
      </div>

      {metadata.reason ? (
        <div className="flex items-start gap-2 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span>{metadata.reason}</span>
        </div>
      ) : null}
    </>
  );

  return (
    <CommunicationBlockTemplate
      cardClassName="border-warning/20 bg-warning/5"
      icon={<Pill className="h-4 w-4 text-warning" />}
      title={t('storyloop.distributionAdjustment')}
      subtitle={metadata.product_name}
      status={{
        label: t('storyloop.distributionChange'),
        className: 'bg-warning/10 text-warning border-warning/20',
      }}
      body={body}
    />
  );
}
