/**
 * RepriceProposalBlock — a pricing proposal awaiting the operator's decision IN the story.
 *
 * AISHA composes a reprice (the hamburger) and posts a `reprice_proposal` entry; the
 * responsible person confirms or rejects it here. The decision goes through the canonical
 * gate (respond_to_story_block_audited confirm_reprice/reject_reprice) — authorized by
 * story ownership — which stamps metadata.reprice.status; a trigger then syncs the
 * hub_reprice_proposal projection and the connector applies the price into the target.
 * Mirrors FlowConsentGateBlock (the flowboard consent gate).
 */
import { useTranslation } from 'react-i18next';
import { Tag, Check, X } from 'lucide-react';
import { CommunicationBlockTemplate } from './CommunicationBlockTemplate';

interface RepriceMetadata {
  old_price_retail?: number | string | null;
  proposed_price_retail?: number | string | null;
  trigger?: string;
  reprice?: { status?: string };
}

interface Props {
  metadata: Record<string, unknown>;
  /** the entry's human-readable line (e.g. "Návrh přecenění (fx_change): 1000 → 1092,50 CZK") */
  reason?: string;
  entryId: string;
  onConfirm?: (entryId: string) => void;
  onReject?: (entryId: string) => void;
}

export function RepriceProposalBlock({ metadata, reason, entryId, onConfirm, onReject }: Props) {
  const { t } = useTranslation();
  const m = metadata as RepriceMetadata;
  const status = m.reprice?.status ?? 'pending';
  const pending = status === 'pending';
  const confirmed = status === 'confirmed';

  const statusBadge = confirmed
    ? { label: t('storyloop.reprice.confirmed'), className: 'bg-success/10 text-success border-success/20', icon: <Check className="h-3 w-3" /> }
    : status === 'rejected'
      ? { label: t('storyloop.reprice.rejected'), className: 'bg-muted text-muted-foreground border-border' }
      : { label: t('storyloop.reprice.awaiting'), className: 'bg-amber-500/10 text-amber-600 border-amber-500/20' };

  return (
    <CommunicationBlockTemplate
      cardClassName={pending ? 'border-amber-500/30 bg-amber-500/5' : undefined}
      icon={<Tag className="h-4 w-4" aria-hidden="true" />}
      title={t('storyloop.reprice.title')}
      status={statusBadge}
      body={reason ? <p className="text-xs text-muted-foreground">{reason}</p> : undefined}
      actions={
        pending && onConfirm && onReject
          ? [
              {
                id: 'confirm-reprice',
                label: t('storyloop.reprice.confirmButton'),
                onClick: () => onConfirm(entryId),
                variant: 'default',
                icon: <Check className="h-3.5 w-3.5" />,
              },
              {
                id: 'reject-reprice',
                label: t('storyloop.reprice.rejectButton'),
                onClick: () => onReject(entryId),
                variant: 'outline',
                icon: <X className="h-3.5 w-3.5" />,
              },
            ]
          : []
      }
    />
  );
}
