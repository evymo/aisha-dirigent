/**
 * WebArtifactScrapeBlock — operator asked Aisha to scrape an external URL.
 */
import { useTranslation } from 'react-i18next';
import { Globe } from 'lucide-react';
import type { WebArtifactScrapeMetadata } from '@/schemas/storyLoopSchemas';
import { CommunicationBlockTemplate } from './CommunicationBlockTemplate';

interface Props {
  metadata: WebArtifactScrapeMetadata;
  entryId: string;
  storyId: string;
}

export function WebArtifactScrapeBlock({ metadata, entryId: _entryId, storyId: _storyId }: Props) {
  const { t } = useTranslation();
  return (
    <CommunicationBlockTemplate
      icon={<Globe className="h-4 w-4" aria-hidden="true" />}
      title={t('storyloop.webArtifact.scrapeTitle', 'URL snapshot requested')}
      subtitle={
        <a href={metadata.source_url} target="_blank" rel="noreferrer" className="break-all text-xs underline">
          {metadata.source_url}
        </a>
      }
      status={{
        label: t('storyloop.webArtifact.statusProcessing', 'Aisha is parsing…'),
        className: 'bg-info/10 text-info border-info/20',
      }}
      body={
        <p className="text-xs text-muted-foreground">
          {t(
            'storyloop.webArtifact.scrapeBody',
            'I will fetch the page with an SSRF guard, sanitize, and surface anything that maps onto an existing runtime block.',
          )}
        </p>
      }
    />
  );
}
