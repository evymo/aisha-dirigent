/**
 * WebArtifactPublishedBlock — terminal marker: web is live at slug.
 */
import { useTranslation } from 'react-i18next';
import { Rocket } from 'lucide-react';
import type { WebArtifactPublishedMetadata } from '@/schemas/storyLoopSchemas';
import { CommunicationBlockTemplate } from './CommunicationBlockTemplate';

interface Props {
  metadata: WebArtifactPublishedMetadata;
  entryId: string;
  storyId: string;
}

export function WebArtifactPublishedBlock({ metadata, entryId: _entryId, storyId: _storyId }: Props) {
  const { t } = useTranslation();
  return (
    <CommunicationBlockTemplate
      icon={<Rocket className="h-4 w-4" aria-hidden="true" />}
      title={t('storyloop.webArtifact.publishedTitle', 'Web published')}
      subtitle={
        <a href={`/${metadata.slug}`} className="text-xs underline">
          /{metadata.slug}
        </a>
      }
      cardClassName="bg-success/10 border-success/20"
      status={{
        label: t('storyloop.webArtifact.statusPublished', 'published'),
        className: 'bg-success/10 text-success border-success/20',
      }}
    />
  );
}
