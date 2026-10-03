/**
 * Lab Order Block
 * 
 * Displays lab test orders and their status.
 */

import { useMemo } from 'react';
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { useTranslation } from 'react-i18next';
import { FlaskConical, Calendar, CheckCircle, Clock, FileText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { LabOrderMetadata } from '@/schemas/storyLoopSchemas';
import { format } from 'date-fns';
import { CommunicationBlockTemplate } from './CommunicationBlockTemplate';
import { getLabTestsCatalog } from '@/lib/lab-tests';

interface LabOrderBlockProps {
  metadata: LabOrderMetadata;
  entryId: string;
  storyId: string;
  onViewResults?: (resultId: string) => void;
  isPartnerView?: boolean;
}

const statusConfig: Record<string, { icon: React.ElementType; color: string }> = {
  ordered: { icon: Clock, color: 'bg-muted text-muted-foreground border-muted' },
  scheduled: { icon: Calendar, color: 'bg-info/10 text-info border-info/20' },
  completed: { icon: CheckCircle, color: 'bg-success/10 text-success border-success/20' },
  results_ready: { icon: FileText, color: 'bg-primary/10 text-primary border-primary/20' },
  reviewed: { icon: CheckCircle, color: 'bg-success/10 text-success border-success/20' },
};

export function LabOrderBlock({
  metadata,
  entryId: _entryId, // Reserved for future actions
  storyId: _storyId, // Reserved for future navigation
  onViewResults,
  isPartnerView: _isPartnerView = true, // Reserved for view-specific rendering
}: LabOrderBlockProps) {
  const { t, i18n } = useTranslation();
  const dateLocale = getDateFnsLocale(i18n.language);
  const testNameByCode = useMemo(() => {
    const catalog = getLabTestsCatalog();
    return new Map(catalog.tests.map((test) => [test.code, test.name_key] as const));
  }, []);
  
  const config = statusConfig[metadata.status] || statusConfig.ordered;
  const StatusIcon = config.icon;
  const resultId = metadata.result_id;
  const getTestLabel = (raw: string) => {
    const key = testNameByCode.get(raw);
    if (!key) return raw;
    return `${t(key)} (${raw})`;
  };

  const body = (
    <>
      {metadata.tests.length > 0 ? (
        <div>
          <p className="mb-1.5 text-xs text-muted-foreground">{t('storyloop.orderedTests')}:</p>
          <div className="flex flex-wrap gap-1">
            {metadata.tests.map((test, idx) => (
              <Badge key={`${test}-${idx}`} variant="secondary" className="text-xs">
                {getTestLabel(test)}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}

      {metadata.scheduled_date ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Calendar className="h-3.5 w-3.5" />
          <span>
            {t('storyloop.scheduledFor')}: {format(new Date(metadata.scheduled_date), 'PP', { locale: dateLocale })}
          </span>
        </div>
      ) : null}
    </>
  );

  const actions = (metadata.status === 'results_ready' || metadata.status === 'reviewed') &&
    resultId &&
    onViewResults
    ? [{
        id: 'view-lab-results',
        label: t('storyloop.viewLabResults'),
        onClick: () => onViewResults(resultId),
        icon: <FileText className="h-3.5 w-3.5" />,
        variant: 'default' as const,
      }]
    : [];

  return (
    <CommunicationBlockTemplate
      cardClassName={cn(config.color)}
      icon={<FlaskConical className="h-4 w-4 text-primary" />}
      title={t('storyloop.labOrder')}
      subtitle={metadata.lab_name}
      status={{
        label: t(`storyloop.labStatus.${metadata.status}`),
        icon: <StatusIcon className="h-3 w-3" />,
        className: config.color,
      }}
      body={body}
      actions={actions}
    />
  );
}
