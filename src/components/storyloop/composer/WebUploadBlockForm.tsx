/**
 * Web Upload Block Form
 *
 * Operator picks a static-site zip and the start_web_artifact_ingest RPC
 * spawns a job + a story_entries row of type 'web_artifact_upload'. The
 * existing storyloop timeline surfaces it via WebArtifactUploadBlock.
 *
 * Does NOT use the composer's generic createEntry path — the RPC creates
 * the entry server-side as part of the job-start transaction (single
 * source of truth for the lifecycle).
 */
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useStartIngestUpload } from '@/hooks';

interface Props {
  storyId: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export function WebUploadBlockForm({ storyId, onSuccess, onCancel }: Props) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [chosenFile, setChosenFile] = useState<File | null>(null);
  const mutation = useStartIngestUpload();

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!chosenFile) return;
    try {
      await mutation.mutateAsync({ storyId, file: chosenFile });
      onSuccess();
    } catch {
      // Error surfaces via mutation.error below
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t(
          'storyloop.webArtifact.uploadFormHint',
          'I will sanitize the HTML/CSS, extract design tokens, and propose runtime-block substitutions for review.',
        )}
      </p>

      <Input
        ref={fileInputRef}
        type="file"
        accept=".zip,application/zip,application/x-zip-compressed"
        onChange={(e) => setChosenFile(e.target.files?.[0] ?? null)}
        disabled={mutation.isPending}
        data-test="zip-input"
      />
      {chosenFile && (
        <p className="text-xs text-muted-foreground">
          {t('storyloop.webArtifact.uploadFormSelected', 'Selected: {{name}} ({{kb}} KB)', {
            name: chosenFile.name,
            kb: Math.round(chosenFile.size / 1024),
          })}
        </p>
      )}
      {mutation.isError && (
        <p className="text-xs text-destructive">{mutation.error?.message ?? 'upload failed'}</p>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={mutation.isPending}>
          {t('common.cancel', 'Cancel')}
        </Button>
        <Button type="submit" disabled={!chosenFile || mutation.isPending} data-test="confirm-upload">
          {mutation.isPending ? (
            <Loader2 className="mr-1 inline size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Upload className="mr-1 inline size-4" aria-hidden="true" />
          )}
          {t('storyloop.webArtifact.uploadFormSubmit', 'Upload + start parse')}
        </Button>
      </div>
    </form>
  );
}
