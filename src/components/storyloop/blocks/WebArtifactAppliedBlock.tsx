/**
 * WebArtifactAppliedBlock — system-side note that a canvas landed on
 * the web_pages row. Offers a one-click Publish if not yet public.
 */
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Rocket } from 'lucide-react';
import type { WebArtifactAppliedMetadata } from '@/schemas/storyLoopSchemas';
import { CommunicationBlockTemplate, type CommunicationBlockAction } from './CommunicationBlockTemplate';
import { usePublishArtifact } from '@/hooks';

interface Props {
  metadata: WebArtifactAppliedMetadata;
  entryId: string;
  storyId: string;
}

export function WebArtifactAppliedBlock({ metadata, entryId: _entryId, storyId }: Props) {
  const { t } = useTranslation();
  const publishMut = usePublishArtifact();

  const actions: CommunicationBlockAction[] = metadata.published
    ? []
    : [
        {
          id: 'publish',
          label: t('storyloop.webArtifact.publish', 'Publish now'),
          onClick: () => publishMut.mutate({ storyId, job_id: metadata.job_id }),
          icon: <Rocket className="h-4 w-4" aria-hidden="true" />,
          disabled: publishMut.isPending,
        },
      ];

  return (
    <CommunicationBlockTemplate
      icon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
      title={t('storyloop.webArtifact.appliedTitle', 'Canvas applied to page')}
      subtitle={metadata.page_id}
      status={{
        label: metadata.published
          ? t('storyloop.webArtifact.statusPublished', 'published')
          : t('storyloop.webArtifact.statusDraft', 'draft'),
        className: metadata.published
          ? 'bg-success/10 text-success border-success/20'
          : 'bg-warning/10 text-warning border-warning/20',
      }}
      body={
        metadata.pre_apply_version_id && (
          <p className="text-xs text-muted-foreground">
            {t('storyloop.webArtifact.appliedSnapshot', 'Pre-apply snapshot: {{id}}', {
              id: metadata.pre_apply_version_id,
            })}
          </p>
        )
      }
      actions={actions}
    />
  );
}
