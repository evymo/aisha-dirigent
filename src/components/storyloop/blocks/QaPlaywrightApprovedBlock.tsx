/**
 * QaPlaywrightApprovedBlock — admin approved a production_manual run.
 *
 * Approval is segregation-of-duties enforced in approve_playwright_run
 * (requester != approver), so just seeing this block confirms a second
 * authenticated admin signed off before the runner picked the job up.
 */
import { useTranslation } from 'react-i18next';
import { ShieldCheck } from 'lucide-react';
import type { QaPlaywrightApprovedMetadata } from '@/schemas/storyLoopSchemas';
import { CommunicationBlockTemplate } from './CommunicationBlockTemplate';

interface Props {
  metadata: QaPlaywrightApprovedMetadata;
  entryId: string;
  storyId: string;
}

export function QaPlaywrightApprovedBlock({ metadata, entryId: _entryId, storyId: _storyId }: Props) {
  const { t } = useTranslation();
  return (
    <CommunicationBlockTemplate
      icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
      title={t('storyloop.qaPlaywright.approvedTitle', 'Production Playwright run approved')}
      subtitle={metadata.target_env}
      status={{
        label: t('storyloop.qaPlaywright.statusApproved', 'approved'),
        className: 'bg-success/10 text-success border-success/20',
      }}
      body={
        <p className="text-xs text-muted-foreground">
          {t(
            'storyloop.qaPlaywright.approvedBody',
            'A second admin approved the run. Runner will pick it up on the next poll.',
          )}
        </p>
      }
    />
  );
}
