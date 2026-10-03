/**
 * Web Redesign Block Form
 *
 * Operator asks Aisha to redesign a prior canvas. Picks one of the
 * `ready_for_review` jobs in this story as the seed; writes a brief +
 * picks a slot profile; request_web_artifact_redesign RPC spawns the
 * redesign job + a story_entries row of type 'web_artifact_aisha_proposal'
 * (once the LLM chain completes).
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Wand2, Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useRequestRedesign, useWebArtifactJobs } from '@/hooks';
import type { WebArtifactJob } from '@/lib/schemas/webArtifactSchemas';

interface Props {
  storyId: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export function WebRedesignBlockForm({ storyId, onSuccess, onCancel }: Props) {
  const { t } = useTranslation();
  const { data: jobs } = useWebArtifactJobs(storyId);
  const mutation = useRequestRedesign();
  const [brief, setBrief] = useState('');
  const [slot, setSlot] = useState<'budget' | 'balanced' | 'maxQuality'>('balanced');

  const candidates = useMemo(
    () =>
      ((jobs ?? []) as WebArtifactJob[]).filter(
        (j) => j.status === 'ready_for_review' || j.status === 'applied',
      ),
    [jobs],
  );

  const [seedJobId, setSeedJobId] = useState<string>('');

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!brief || !seedJobId) return;
    try {
      await mutation.mutateAsync({
        storyId,
        job_id: seedJobId,
        brief,
        slot_profile: slot,
        creativity_seed: 0.5,
      });
      onSuccess();
    } catch {
      // Error surfaces via mutation.error below
    }
  };

  if (candidates.length === 0) {
    return (
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          {t(
            'storyloop.webArtifact.redesignFormNoCandidate',
            'No ready_for_review or applied canvas to iterate from. Upload a static folder or scrape a URL first.',
          )}
        </p>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('common.close', 'Close')}
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t(
          'storyloop.webArtifact.redesignFormHint',
          'I will preserve every content text and every runtime-block placeholder. Only styling moves.',
        )}
      </p>

      <div className="space-y-2">
        <Label>{t('storyloop.webArtifact.redesignFormSeed', 'Iterate from')}</Label>
        <Select value={seedJobId} onValueChange={setSeedJobId}>
          <SelectTrigger>
            <SelectValue placeholder={t('storyloop.webArtifact.redesignFormSeedPlaceholder', 'Pick a prior canvas')} />
          </SelectTrigger>
          <SelectContent>
            {candidates.map((job) => (
              <SelectItem key={job.id} value={job.id}>
                {job.kind} · {job.source_type} · {new Date(job.created_at).toLocaleString()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>{t('storyloop.webArtifact.redesignFormBrief', 'Brief for Aisha')}</Label>
        <Textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          rows={3}
          placeholder={t('storyloop.webArtifact.redesignFormBriefPlaceholder', 'Lighter typography, modern spacing…') ?? ''}
          disabled={mutation.isPending}
          required
          data-test="brief"
        />
      </div>

      <div className="space-y-2">
        <Label>{t('storyloop.webArtifact.redesignFormSlot', 'Cost profile')}</Label>
        <Select value={slot} onValueChange={(v) => setSlot(v as 'budget' | 'balanced' | 'maxQuality')}>
          <SelectTrigger data-test="slot-profile"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="budget">budget</SelectItem>
            <SelectItem value="balanced">balanced</SelectItem>
            <SelectItem value="maxQuality">maxQuality</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {mutation.isError && (
        <p className="text-xs text-destructive">{mutation.error?.message ?? 'redesign failed'}</p>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={mutation.isPending}>
          {t('common.cancel', 'Cancel')}
        </Button>
        <Button
          type="submit"
          disabled={!brief || !seedJobId || mutation.isPending}
          data-test="confirm-redesign"
        >
          {mutation.isPending ? (
            <Loader2 className="mr-1 inline size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="mr-1 inline size-4" aria-hidden="true" />
          )}
          {t('storyloop.webArtifact.redesignFormSubmit', 'Send brief')}
        </Button>
      </div>
    </form>
  );
}
