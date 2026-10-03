/**
 * Web Scrape Block Form
 *
 * Operator pastes a public URL; start_web_artifact_ingest RPC spawns a job
 * + a story_entries row of type 'web_artifact_scrape'. svc-web-artifact
 * fetches with SSRF guard, parses, and emits the Aisha proposal.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useStartIngestScrape } from '@/hooks';

interface Props {
  storyId: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export function WebScrapeBlockForm({ storyId, onSuccess, onCancel }: Props) {
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  const mutation = useStartIngestScrape();

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!url) return;
    try {
      await mutation.mutateAsync({ storyId, sourceUrl: url });
      onSuccess();
    } catch {
      // Error surfaces via mutation.error below
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t(
          'storyloop.webArtifact.scrapeFormHint',
          'Public URL only. CSR-only sites (SPA shells) will fail with csr_unrenderable — static export them first.',
        )}
      </p>

      <div className="flex gap-2">
        <Globe className="mt-2 size-4 text-muted-foreground" aria-hidden="true" />
        <Input
          type="url"
          placeholder="https://example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={mutation.isPending}
          required
          data-test="scrape-url-input"
        />
      </div>
      {mutation.isError && (
        <p className="text-xs text-destructive">{mutation.error?.message ?? 'scrape failed'}</p>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={mutation.isPending}>
          {t('common.cancel', 'Cancel')}
        </Button>
        <Button type="submit" disabled={!url || mutation.isPending} data-test="scrape-url-submit">
          {mutation.isPending ? (
            <Loader2 className="mr-1 inline size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="mr-1 inline size-4" aria-hidden="true" />
          )}
          {t('storyloop.webArtifact.scrapeFormSubmit', 'Fetch + parse')}
        </Button>
      </div>
    </form>
  );
}
