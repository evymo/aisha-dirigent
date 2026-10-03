/**
 * Meeting Request Block
 * 
 * Displays and handles meeting request entries.
 */

import { useTranslation } from 'react-i18next';
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { Calendar, Video, Phone, MapPin, Check, X, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { MeetingRequestMetadata } from '@/schemas/storyLoopSchemas';
import { format } from 'date-fns';
import { CommunicationBlockTemplate } from './CommunicationBlockTemplate';

interface MeetingRequestBlockProps {
  metadata: MeetingRequestMetadata;
  entryId: string;
  storyId: string;
  onAccept?: (entryId: string, time?: string) => void;
  onDecline?: (entryId: string) => void;
  onReschedule?: (entryId: string) => void;
  isPartnerView?: boolean;
}

const locationIcons = {
  video: Video,
  phone: Phone,
  in_person: MapPin,
};

const statusColors: Record<string, string> = {
  pending: 'bg-warning/10 text-warning border-warning/20',
  accepted: 'bg-success/10 text-success border-success/20',
  declined: 'bg-destructive/10 text-destructive border-destructive/20',
  rescheduled: 'bg-info/10 text-info border-info/20',
  completed: 'bg-muted text-muted-foreground border-muted',
};

export function MeetingRequestBlock({
  metadata,
  entryId,
  storyId: _storyId, // Reserved for future navigation
  onAccept,
  onDecline,
  onReschedule,
  isPartnerView = true,
}: MeetingRequestBlockProps) {
  const { t, i18n } = useTranslation();
  const dateLocale = getDateFnsLocale(i18n.language);
  
  const LocationIcon = metadata.location ? locationIcons[metadata.location] : Calendar;
  const isPending = metadata.status === 'pending';

  const body = (
    <>
      {metadata.proposed_times && metadata.proposed_times.length > 0 && isPending ? (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">{t('storyloop.proposedTimes')}:</p>
          {metadata.proposed_times.map((time, idx) => (
            <div
              key={`${time.start}-${idx}`}
              className="flex items-center justify-between rounded-md bg-muted/50 p-2"
            >
              <div className="flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-sm">
                  {format(new Date(time.start), 'PPp', { locale: dateLocale })}
                </span>
              </div>
              {isPartnerView && onAccept ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2"
                  onClick={() => onAccept(entryId, time.start)}
                >
                  <Check className="h-3.5 w-3.5 text-success" />
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {metadata.accepted_time ? (
        <div className="rounded-md border border-success/20 bg-success/5 p-2">
          <div className="flex items-center gap-2">
            <Check className="h-4 w-4 text-success" />
            <span className="text-sm font-medium">
              {format(new Date(metadata.accepted_time), 'PPp', { locale: dateLocale })}
            </span>
          </div>
        </div>
      ) : null}

      {metadata.notes ? <p className="text-sm text-muted-foreground">{metadata.notes}</p> : null}
    </>
  );

  const actions = isPartnerView && isPending
    ? [
        ...(!metadata.proposed_times?.length && onAccept
          ? [{
              id: 'accept',
              label: t('storyloop.acceptMeeting'),
              onClick: () => onAccept(entryId),
              icon: <Check className="h-3.5 w-3.5" />,
              variant: 'default' as const,
            }]
          : []),
        ...(onDecline
          ? [{
              id: 'decline',
              label: t('storyloop.declineMeeting'),
              onClick: () => onDecline(entryId),
              icon: <X className="h-3.5 w-3.5" />,
              variant: 'outline' as const,
            }]
          : []),
        ...(onReschedule
          ? [{
              id: 'reschedule',
              label: t('storyloop.rescheduleMeeting'),
              onClick: () => onReschedule(entryId),
              variant: 'ghost' as const,
            }]
          : []),
      ]
    : [];

  return (
    <CommunicationBlockTemplate
      cardClassName={cn(statusColors[metadata.status])}
      icon={<Calendar className="h-4 w-4 text-primary" />}
      title={t(`storyloop.meetingType.${metadata.meeting_type}`)}
      subtitle={
        metadata.location ? (
          <span className="inline-flex items-center gap-1">
            <LocationIcon className="h-3 w-3" />
            {t(`storyloop.location.${metadata.location}`)}
          </span>
        ) : undefined
      }
      status={{
        label: t(`storyloop.meetingStatus.${metadata.status}`),
        className: statusColors[metadata.status],
      }}
      body={body}
      actions={actions}
    />
  );
}
