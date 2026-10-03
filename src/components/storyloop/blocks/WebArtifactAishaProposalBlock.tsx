/**
 * WebArtifactAishaProposalBlock — Aisha-side bubble surfacing a parsed/
 * redesigned canvas ready for review. Holds runtime-block suggestions
 * (Accept/Reject per item) and Apply / Iterate actions.
 */
import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, CheckCircle2, RotateCcw } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { WebArtifactAishaProposalMetadata } from '@/schemas/storyLoopSchemas';
import { CommunicationBlockTemplate, type CommunicationBlockAction } from './CommunicationBlockTemplate';
import { useApplyArtifact } from '@/hooks';

/**
 * `RuntimeBlockSuggestionsReview` lives in `src/components/admin/` which Vite
 * assigns to the `admin-area` chunk. This block file lives in `storyloop/`
 * which is part of the `shared` chunk (member + admin both consume the
 * storyloop renderer).
 *
 * A static value-import from here would create a top-level circular chunk
 * dependency: `shared ↔ admin-area`. ESM evaluates both chunks "interleaved"
 * when a cycle is detected — and when `admin-area` reaches into `shared` for
 * an uninitialised `const` binding, the engine throws:
 *
 *   Uncaught ReferenceError: Cannot access 'Ce' before initialization
 *
 * Lazy-loading the admin review component decouples the build-time graph:
 * `admin-area` is no longer a static parent of `shared`, so the cycle is
 * broken at the bundler level. As a side-benefit, the admin chunk never
 * downloads for member-only sessions that never render this block.
 *
 * This pattern is also enforced by the
 * `src/tests/gates/chunk-cycle-prevention.gate.test.ts` gate.
 */
const RuntimeBlockSuggestionsReview = lazy(() =>
  import('@/components/admin/stories/RuntimeBlockSuggestionsReview').then((m) => ({
    default: m.RuntimeBlockSuggestionsReview,
  })),
);

interface Props {
  metadata: WebArtifactAishaProposalMetadata;
  entryId: string;
  storyId: string;
}

const SOURCE_LABEL: Record<string, string> = {
  folder_upload: 'storyloop.webArtifact.fromUpload',
  url_scrape: 'storyloop.webArtifact.fromScrape',
  default_seed: 'storyloop.webArtifact.fromSeed',
  llm_redesign: 'storyloop.webArtifact.fromRedesign',
  manual: 'storyloop.webArtifact.fromManual',
};

export function WebArtifactAishaProposalBlock({ metadata, entryId: _entryId, storyId }: Props) {
  const { t } = useTranslation();
  const [pageId, setPageId] = useState('');
  const applyMut = useApplyArtifact();

  const sourceKey = SOURCE_LABEL[metadata.source_type] ?? 'storyloop.webArtifact.fromUnknown';

  const actions: CommunicationBlockAction[] = [
    {
      id: 'apply',
      label: t('storyloop.webArtifact.apply', 'Apply this version'),
      onClick: () =>
        applyMut.mutate({ storyId, job_id: metadata.job_id, page_id: pageId, publish: false }),
      icon: <CheckCircle2 className="h-4 w-4" aria-hidden="true" />,
      disabled: !pageId || applyMut.isPending,
    },
    {
      id: 'iterate',
      label: t('storyloop.webArtifact.iterate', 'Iterate further'),
      onClick: () => {
        const focusComposer = document.querySelector('[data-test="composer-tab-brief"]') as HTMLElement | null;
        focusComposer?.click();
        focusComposer?.scrollIntoView({ behavior: 'smooth' });
      },
      icon: <RotateCcw className="h-4 w-4" aria-hidden="true" />,
      variant: 'outline',
    },
  ];

  return (
    <CommunicationBlockTemplate
      icon={<Sparkles className="h-4 w-4" aria-hidden="true" />}
      title={t('storyloop.webArtifact.proposalTitle', 'Canvas ready for review')}
      subtitle={t(sourceKey, metadata.source_type)}
      cardClassName="bg-accent/30 border-accent"
      status={{
        label: metadata.style_band ?? t('storyloop.webArtifact.statusReady', 'ready_for_review'),
        className: 'bg-success/10 text-success border-success/20',
      }}
      body={
        <div className="space-y-3">
          {metadata.runtime_block_suggestions.length > 0 && (
            <div className="rounded-md border bg-background p-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                {t(
                  'storyloop.webArtifact.suggestionsHeader',
                  'I found these patterns. Which should I wire into runtime blocks?',
                )}
              </p>
              <Suspense fallback={null}>
                <RuntimeBlockSuggestionsReview suggestions={metadata.runtime_block_suggestions} />
              </Suspense>
            </div>
          )}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{t('storyloop.webArtifact.applyTarget', 'Apply target page id')}:</span>
            <Input
              className="h-7 flex-1"
              placeholder="web_pages.id (uuid)"
              value={pageId}
              onChange={(e) => setPageId(e.target.value)}
              data-test="apply-page-id"
            />
          </div>
          {applyMut.isError && (
            <p className="text-xs text-destructive">{applyMut.error?.message}</p>
          )}
        </div>
      }
      actions={actions}
    />
  );
}
