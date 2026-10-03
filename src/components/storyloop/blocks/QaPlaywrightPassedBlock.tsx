/**
 * QaPlaywrightPassedBlock — terminal pass.
 *
 * App-linked runs flip the active slot to `healthy` in coolify_app_slots; the
 * subtitle surfaces that link so the operator sees the B/G slot context.
 */
import { useTranslation } from 'react-i18next';
import { CheckCircle2 } from 'lucide-react';
import type { QaPlaywrightPassedMetadata } from '@/schemas/storyLoopSchemas';
import { CommunicationBlockTemplate } from './CommunicationBlockTemplate';

interface Props {
  metadata: QaPlaywrightPassedMetadata;
  entryId: string;
  storyId: string;
}

function formatDuration(ms: number | null | undefined): string | null {
  if (ms === null || ms === undefined) return null;
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

export function QaPlaywrightPassedBlock({ metadata, entryId: _entryId, storyId: _storyId }: Props) {
  const { t } = useTranslation();
  const duration = formatDuration(metadata.duration_ms);
  const subtitle = metadata.app_name
    ? `${metadata.app_name}${metadata.active_slot ? ` · ${metadata.active_slot}` : ''}`
    : undefined;

  return (
    <CommunicationBlockTemplate
      icon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
      title={t('storyloop.qaPlaywright.passedTitle', 'Playwright run passed')}
      subtitle={subtitle}
      cardClassName="bg-success/5 border-success/20"
      status={{
        label: t('storyloop.qaPlaywright.statusPassed', 'passed'),
        className: 'bg-success/10 text-success border-success/20',
      }}
      body={
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>
            {t('storyloop.qaPlaywright.countsLabel', 'tests')}
            {': '}
            <span className="font-medium">
              {metadata.passed ?? 0}/{metadata.total ?? 0}
            </span>
            {metadata.skipped ? (
              <>
                {' · '}
                {t('storyloop.qaPlaywright.skippedLabel', 'skipped')}
                {': '}
                <span className="font-medium">{metadata.skipped}</span>
              </>
            ) : null}
            {duration ? (
              <>
                {' · '}
                {t('storyloop.qaPlaywright.durationLabel', 'duration')}
                {': '}
                <span className="font-medium">{duration}</span>
              </>
            ) : null}
          </p>
          {metadata.app_name && metadata.active_slot ? (
            <p>
              {t(
                'storyloop.qaPlaywright.slotHealthHealthy',
                'B/G slot {{slot}} marked healthy.',
                { slot: metadata.active_slot },
              )}
            </p>
          ) : null}
        </div>
      }
    />
  );
}
