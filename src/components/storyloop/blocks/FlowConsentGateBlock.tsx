/**
 * FlowConsentGateBlock — a halted Flowboard consent gate in the StoryLoop.
 *
 * Distinct from the clinical ConsentRequestBlock (which shares entry_type
 * 'consent_request'): the flowboard gate is discriminated by
 * metadata.flowboard.kind === 'consent_request'. While awaiting approval it
 * shows an Approve button; clicking it stamps the gate approved
 * (respond_to_story_block_audited) and resumes the run (re-invoke executor).
 */
import { useTranslation } from 'react-i18next';
import { Lock, Check } from 'lucide-react';
import { CommunicationBlockTemplate } from './CommunicationBlockTemplate';

interface FlowGateMetadata {
  flowboard?: {
    status?: string;
    graphId?: string;
  };
}

interface Props {
  metadata: Record<string, unknown>;
  reason?: string;
  entryId: string;
  onApprove?: (entryId: string, graphId: string) => void;
}

export function FlowConsentGateBlock({ metadata, reason, entryId, onApprove }: Props) {
  const { t } = useTranslation();
  const fb = (metadata.flowboard ?? {}) as NonNullable<FlowGateMetadata['flowboard']>;
  const approved = fb.status === 'approved';
  const graphId = fb.graphId ?? '';

  return (
    <CommunicationBlockTemplate
      cardClassName={approved ? undefined : 'border-amber-500/30 bg-amber-500/5'}
      icon={<Lock className="h-4 w-4" aria-hidden="true" />}
      title={t('flowboard.block.consentTitle')}
      status={
        approved
          ? {
              label: t('flowboard.block.approved'),
              className: 'bg-success/10 text-success border-success/20',
              icon: <Check className="h-3 w-3" />,
            }
          : { label: t('flowboard.block.awaiting'), className: 'bg-amber-500/10 text-amber-600 border-amber-500/20' }
      }
      body={reason ? <p className="text-xs text-muted-foreground">{reason}</p> : undefined}
      actions={
        !approved && onApprove && graphId
          ? [
              {
                id: 'approve-flow-gate',
                label: t('flowboard.block.approveButton'),
                onClick: () => onApprove(entryId, graphId),
                variant: 'default',
                icon: <Check className="h-3.5 w-3.5" />,
              },
            ]
          : []
      }
    />
  );
}
