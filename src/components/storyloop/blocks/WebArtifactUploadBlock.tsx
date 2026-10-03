/**
 * WebArtifactUploadBlock — operator uploaded a static folder for parsing.
 *
 * Rendered when a story_entry of type 'web_artifact_upload' lands in the
 * timeline. The matching `web_artifact_jobs` row carries the long-running
 * parser state — this block is the operator-side conversational marker.
 */
import { useTranslation } from 'react-i18next';
import { Upload } from 'lucide-react';
import type { WebArtifactUploadMetadata } from '@/schemas/storyLoopSchemas';
import { CommunicationBlockTemplate } from './CommunicationBlockTemplate';

interface Props {
  metadata: WebArtifactUploadMetadata;
  entryId: string;
  storyId: string;
}

export function WebArtifactUploadBlock({ metadata, entryId: _entryId, storyId: _storyId }: Props) {
  const { t } = useTranslation();
  return (
    <CommunicationBlockTemplate
      icon={<Upload className="h-4 w-4" aria-hidden="true" />}
      title={t('storyloop.webArtifact.uploadTitle', 'Static folder uploaded')}
      subtitle={metadata.source_filename ?? metadata.source_storage_path}
      status={{
        label: t('storyloop.webArtifact.statusProcessing', 'Aisha is parsing…'),
        className: 'bg-info/10 text-info border-info/20',
      }}
      body={
        <p className="text-xs text-muted-foreground">
          {t(
            'storyloop.webArtifact.uploadBody',
            'I will sanitize the HTML/CSS, extract tokens, and look for runtime-block matches.',
          )}
        </p>
      }
    />
  );
}
