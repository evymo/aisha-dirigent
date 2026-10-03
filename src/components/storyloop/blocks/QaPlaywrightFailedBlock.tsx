/**
 * QaPlaywrightFailedBlock — terminal failure.
 *
 * Two flavors:
 *  • staging_auto + app-linked → record_playwright_result auto-called
 *    request_rollback(); the linked rollback_id is shown so the operator
 *    can jump to rollback_history without copy-pasting.
 *  • everything else → operator decides next step (rerun / approve / abort).
 *
 * The block surfaces error_message verbatim from the runner so we don't
 * hide regressions; report_storage_path is rendered as code so it can be
 * copied into a `storage:read` admin tool.
 */
import { useTranslation } from 'react-i18next';
import { AlertCircle } from 'lucide-react';
import type { QaPlaywrightFailedMetadata } from '@/schemas/storyLoopSchemas';
import { CommunicationBlockTemplate } from './CommunicationBlockTemplate';

interface Props {
  metadata: QaPlaywrightFailedMetadata;
  entryId: string;
  storyId: string;
}

function formatDuration(ms: number | null | undefined): string | null {
  if (ms === null || ms === undefined) return null;
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

export function QaPlaywrightFailedBlock({ metadata, entryId: _entryId, storyId: _storyId }: Props) {
  const { t } = useTranslation();
  const duration = formatDuration(metadata.duration_ms);
  const subtitle = metadata.app_name
    ? `${metadata.app_name}${metadata.active_slot ? ` · ${metadata.active_slot}` : ''}`
    : undefined;
  const rollbackTriggered = metadata.rollback_id !== null && metadata.rollback_id !== undefined;

  return (
    <CommunicationBlockTemplate
      icon={<AlertCircle className="h-4 w-4" aria-hidden="true" />}
      title={t('storyloop.qaPlaywright.failedTitle', 'Playwright run failed')}
      subtitle={subtitle}
      cardClassName="bg-destructive/5 border-destructive/20"
      status={{
        label: metadata.result_status,
        className: 'bg-destructive/10 text-destructive border-destructive/20',
      }}
      body={
        <div className="space-y-1 text-xs text-destructive">
          {(metadata.failed !== null && metadata.failed !== undefined) || metadata.total !== null ? (
            <p>
              {t('storyloop.qaPlaywright.failedCountsLabel', 'failed')}
              {': '}
              <span className="font-medium">
                {metadata.failed ?? 0}/{metadata.total ?? 0}
              </span>
              {duration ? (
                <>
                  {' · '}
                  {t('storyloop.qaPlaywright.durationLabel', 'duration')}
                  {': '}
                  <span className="font-medium">{duration}</span>
                </>
              ) : null}
            </p>
          ) : null}
          {metadata.error_message ? (
            <p className="break-words">{metadata.error_message}</p>
          ) : null}
          {metadata.app_name && metadata.active_slot ? (
            <p>
              {t(
                'storyloop.qaPlaywright.slotHealthDegraded',
                'B/G slot {{slot}} marked degraded.',
                { slot: metadata.active_slot },
              )}
            </p>
          ) : null}
          {rollbackTriggered ? (
            <p className="text-warning">
              {t(
                'storyloop.qaPlaywright.rollbackTriggered',
                'Auto-rollback requested (rollback_id: {{id}}).',
                { id: metadata.rollback_id },
              )}
            </p>
          ) : null}
        </div>
      }
    />
  );
}
