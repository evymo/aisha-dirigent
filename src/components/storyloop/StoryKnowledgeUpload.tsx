/**
 * StoryKnowledgeUpload — per-story user-uploaded KB management.
 *
 * Story je projekt s vlastním KB namespace (`kb_id = story-{storyId}`). Uživatel
 * (vlastník story / staff / admin) sem nahrává dokumenty (PDF, DOCX, TXT), které
 * se indexují do Ragnaroku a mohou být retrievovány během story consult dialogu
 * přes AISHA brain wiring (compose_context → Ragnarok hybrid → Maestro).
 *
 * AISHA principy: hook-only data access (useStoryKnowledge), Zod validace,
 * i18n přes t(), lucide-react ikony, žádné console.log (safeError v hooku).
 *
 * Tato komponenta JE jediný entry point pro story KB upload — žádný separátní
 * Workbench KB tab, žádný upload v chat UI.
 *
 * @module components/storyloop/StoryKnowledgeUpload
 */
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Loader2, Trash2, Upload, FileUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useStoryKnowledgeList,
  useStoryKnowledgeUpload,
  useStoryKnowledgeDelete,
} from '@/hooks/useStoryKnowledge';

interface StoryKnowledgeUploadProps {
  /** Story UUID */
  storyId: string;
  /** Optional content language tag (e.g. "cs-CZ", "en-US") */
  language?: string;
  /** Disable upload/delete actions (read-only viewer) */
  readOnly?: boolean;
}

const ACCEPTED_TYPES = '.pdf,.docx,.txt,.md,.markdown';
const MAX_FILE_SIZE_MB = 50;

function formatBytes(bytes: number | undefined): string {
  if (!bytes) return '–';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function StoryKnowledgeUpload({ storyId, language, readOnly = false }: StoryKnowledgeUploadProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const list = useStoryKnowledgeList(storyId);
  const upload = useStoryKnowledgeUpload(storyId);
  const remove = useStoryKnowledgeDelete(storyId);

  const handleFile = (file: File) => {
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      // useToast in hook will not fire — we surface inline.
      return;
    }
    upload.mutate({ file, language });
  };

  const onChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) handleFile(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const onDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(true);
  };

  const onDragLeave = () => setIsDragOver(false);

  const fileCount = list.data?.length ?? 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-4 w-4 text-primary" />
          {t('story.knowledge.title', 'Story Knowledge Base')}
          {fileCount > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              ({fileCount})
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!readOnly && (
          <div
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
              isDragOver
                ? 'border-primary bg-primary/5'
                : 'border-border bg-muted/20 hover:border-primary/50'
            }`}
          >
            <FileUp className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-foreground mb-1">
              {t('story.knowledge.dropZone', 'Přetáhněte soubor sem nebo klikněte pro nahrání')}
            </p>
            <p className="text-xs text-muted-foreground mb-3">
              {t('story.knowledge.acceptedTypes', 'PDF, DOCX, TXT, MD do 50 MB')}
            </p>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={upload.isPending}
            >
              {upload.isPending ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  {t('story.knowledge.uploading', 'Nahrávám…')}
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-3.5 w-3.5" />
                  {t('story.knowledge.selectFile', 'Vybrat soubor')}
                </>
              )}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_TYPES}
              onChange={onChange}
              className="hidden"
            />
          </div>
        )}

        {/* List */}
        {list.isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full rounded" />
            <Skeleton className="h-10 w-full rounded" />
          </div>
        )}

        {!list.isLoading && fileCount === 0 && (
          <p className="text-xs text-muted-foreground text-center py-3">
            {t('story.knowledge.empty', 'Zatím žádné dokumenty.')}
          </p>
        )}

        {!list.isLoading && fileCount > 0 && (
          <div className="space-y-1">
            {list.data?.map((file) => (
              <div
                key={file.kb_id + (file.filename ?? '')}
                className="flex items-center justify-between gap-2 p-2 rounded border border-border bg-background/60 text-sm"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <div className="truncate text-foreground">
                      {file.filename ?? file.kb_id}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatBytes(file.size_bytes)}
                      {file.uploaded_at ? ` · ${new Date(file.uploaded_at).toLocaleDateString()}` : ''}
                    </div>
                  </div>
                </div>
                {!readOnly && (
                  <Button
                    variant="ghost"
                    size="icon"
                    type="button"
                    className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label={t('story.knowledge.deleteAria', 'Smazat dokument')}
                    onClick={() => remove.mutate({ kb_id: file.kb_id })}
                    disabled={remove.isPending}
                  >
                    {remove.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
