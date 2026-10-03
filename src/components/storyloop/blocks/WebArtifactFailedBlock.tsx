/**
 * WebArtifactFailedBlock — terminal failure marker (parser, LLM verify,
 * concurrency guard).
 */
import { useTranslation } from 'react-i18next';
import { AlertCircle } from 'lucide-react';
import type { WebArtifactFailedMetadata } from '@/schemas/storyLoopSchemas';
import { CommunicationBlockTemplate } from './CommunicationBlockTemplate';

interface Props {
  metadata: WebArtifactFailedMetadata;
  entryId: string;
  storyId: string;
}

export function WebArtifactFailedBlock({ metadata, entryId: _entryId, storyId: _storyId }: Props) {
  const { t } = useTranslation();
  return (
    <CommunicationBlockTemplate
      icon={<AlertCircle className="h-4 w-4" aria-hidden="true" />}
      title={t('storyloop.webArtifact.failedTitle', 'Web artifact step failed')}
      subtitle={t('storyloop.webArtifact.failedKind', 'kind: {{kind}}', { kind: metadata.kind })}
      cardClassName="bg-destructive/10 border-destructive/20"
      status={{
        label: t('storyloop.webArtifact.statusFailed', 'failed'),
        className: 'bg-destructive/10 text-destructive border-destructive/20',
      }}
      body={<p className="text-xs text-destructive">{metadata.error_message}</p>}
    />
  );
}
