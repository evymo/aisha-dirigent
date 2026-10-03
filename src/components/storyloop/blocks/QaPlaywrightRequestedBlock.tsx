/**
 * QaPlaywrightRequestedBlock — operator/auto requested a Playwright run.
 *
 * Mirrors WebArtifactUploadBlock: rendered the moment a `qa_playwright_requested`
 * entry lands in the timeline. The actual run state lives on `playwright_runs`;
 * this block is the conversational marker that something is queued.
 *
 * Approval-required runs render a distinct chip so the team can spot them.
 */
import { useTranslation } from 'react-i18next';
import { FlaskConical } from 'lucide-react';
import type { QaPlaywrightRequestedMetadata } from '@/schemas/storyLoopSchemas';
import { CommunicationBlockTemplate } from './CommunicationBlockTemplate';

interface Props {
  metadata: QaPlaywrightRequestedMetadata;
  entryId: string;
  storyId: string;
}

export function QaPlaywrightRequestedBlock({ metadata, entryId: _entryId, storyId: _storyId }: Props) {
  const { t } = useTranslation();
  const trigger = metadata.trigger_kind;
  const awaitingApproval = metadata.approval_required;

  const statusLabel = awaitingApproval
    ? t('storyloop.qaPlaywright.statusAwaitingApproval', 'awaiting approval')
    : t('storyloop.qaPlaywright.statusQueued', 'queued');
  const statusClass = awaitingApproval
    ? 'bg-warning/10 text-warning border-warning/20'
    : 'bg-info/10 text-info border-info/20';

  const subtitle = metadata.app_name
    ? `${metadata.app_name}${metadata.active_slot ? ` · ${metadata.active_slot}` : ''} · ${metadata.target_env}`
    : metadata.target_base_url;

  return (
    <CommunicationBlockTemplate
      icon={<FlaskConical className="h-4 w-4" aria-hidden="true" />}
      title={t('storyloop.qaPlaywright.requestedTitle', 'Playwright run requested')}
      subtitle={subtitle}
      status={{ label: statusLabel, className: statusClass }}
      body={
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>
            {t('storyloop.qaPlaywright.triggerLabel', 'trigger')}
            {': '}
            <span className="font-medium">{trigger}</span>
            {' · '}
            {t('storyloop.qaPlaywright.suiteLabel', 'suite')}
            {': '}
            <span className="font-medium">{metadata.suite}</span>
            {metadata.deploy_ref ? (
              <>
                {' · '}
                {t('storyloop.qaPlaywright.deployRefLabel', 'deploy_ref')}
                {': '}
                <span className="font-medium">{metadata.deploy_ref}</span>
              </>
            ) : null}
          </p>
          <p className="break-all">{metadata.target_base_url}</p>
        </div>
      }
    />
  );
}
