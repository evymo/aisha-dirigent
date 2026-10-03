/**
 * useStoryKnowledge — per-story KB management.
 *
 * Story-level KB upload/list/delete přes Ragnarok namespace (`kb_id = story-{storyId}`).
 * Wrappuje existující `useRagnarokKB*` hooky a vázs je na konkrétní story.
 *
 * Story upload entry point je JEDINÝ — žádný separátní KB tab v Workbench, žádný
 * upload v chat UI. Audit trail je zatím přes `audit_journal` v Edge Function
 * (ragnarok-upload). Do budoucna může být napojeno na `knowledge_items.story_id`
 * pipeline + `knowledge_moderation_queue` (separate ticket).
 *
 * @module
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { aisha } from '@/integrations/db/client';
import { getAccessToken } from '@/integrations/auth/oidc-client';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from 'react-i18next';
import { safeError } from '@/lib/security/safeLogger';
import { ragnarokUploadResponseSchema } from '@/hooks/useRagnarokKB';

interface StoryKnowledgeFile {
  kb_id: string;
  filename?: string;
  size_bytes?: number;
  uploaded_at?: string;
  language?: string;
}

interface StoryKnowledgeListResponse {
  files?: StoryKnowledgeFile[];
  knowledge_bases?: StoryKnowledgeFile[];
  [key: string]: unknown;
}

const QUERY_KEY_STORY_KB = (storyId: string) => ['story-knowledge', storyId];

/** Convert story_id UUID na Ragnarok kb_id namespace (per-story isolation). */
function storyKbId(storyId: string): string {
  return `story-${storyId}`;
}

function getGatewayUrl(): string {
  const configured = import.meta.env.VITE_AISHA_GATEWAY_URL?.trim();
  if (!configured) {
    throw new Error('Missing gateway URL. Set VITE_AISHA_GATEWAY_URL.');
  }
  return configured.replace(/\/+$/, '');
}

/**
 * List dokumentů uploadovaných pro tuto story.
 */
export function useStoryKnowledgeList(storyId: string | undefined) {
  return useQuery({
    queryKey: storyId ? QUERY_KEY_STORY_KB(storyId) : ['story-knowledge', '__no_story__'],
    enabled: Boolean(storyId),
    staleTime: 30_000,
    queryFn: async (): Promise<StoryKnowledgeFile[]> => {
      if (!storyId) return [];
      const { data, error } = await aisha.functions.invoke('ragnarok-upload', {
        body: {
          action: 'list',
          project_id: 'aisha',
          kb_id: storyKbId(storyId),
        },
      });
      if (error) {
        safeError('storyKnowledge.list.failed', error);
        throw new Error(String(error.message ?? error));
      }
      const response = data as StoryKnowledgeListResponse;
      return response?.files ?? response?.knowledge_bases ?? [];
    },
  });
}

/**
 * Upload souboru do Ragnaroku jako per-story KB document.
 */
export function useStoryKnowledgeUpload(storyId: string | undefined) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: async (params: { file: File; language?: string }) => {
      if (!storyId) {
        throw new Error('story_id is required');
      }
      const formData = new FormData();
      formData.append('file', params.file);
      formData.append('action', 'upload');
      formData.append('kb_id', storyKbId(storyId));
      formData.append('project_id', 'aisha');
      if (params.language) formData.append('language', params.language);

      const token = await getAccessToken();
      if (!token) throw new Error('Not authenticated');

      const gatewayUrl = getGatewayUrl();

      const response = await fetch(`${gatewayUrl}/functions/v1/ragnarok-upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
        signal: AbortSignal.timeout(60_000),
      });

      if (!response.ok) {
        const errBody = await response.json().catch((parseErr) => {
          safeError('storyKnowledge.upload.parseError', parseErr);
          return {};
        });
        throw new Error(
          (errBody as Record<string, string>).error ?? `Upload failed: ${response.status}`,
        );
      }
      return ragnarokUploadResponseSchema.parse(await response.json());
    },
    onSuccess: () => {
      if (storyId) {
        queryClient.invalidateQueries({ queryKey: QUERY_KEY_STORY_KB(storyId) });
        // Ragnarok hits cache pro story consult
        queryClient.invalidateQueries({ queryKey: ['ragnarok-search'] });
      }
      toast({ title: t('story.knowledge.uploadSuccess', 'Dokument nahrán do KB') });
    },
    onError: (error: unknown) => {
      safeError('storyKnowledge.upload.failed', error);
      toast({
        title: t('story.knowledge.uploadError', 'Nahrání dokumentu selhalo'),
        variant: 'destructive',
      });
    },
  });
}

/**
 * Delete dokumentu z per-story KB. (Pozn.: ragnarok-upload action='delete'
 * smaže celé KB s daným kb_id; pokud chceš per-file delete, je nutné rozšířit
 * Edge Function — to je separate ticket.)
 */
export function useStoryKnowledgeDelete(storyId: string | undefined) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: async (_params: { kb_id?: string }) => {
      if (!storyId) throw new Error('story_id is required');
      const { data, error } = await aisha.functions.invoke('ragnarok-upload', {
        body: {
          action: 'delete',
          project_id: 'aisha',
          kb_id: storyKbId(storyId),
        },
      });
      if (error) throw new Error(String(error.message ?? error));
      return data;
    },
    onSuccess: () => {
      if (storyId) {
        queryClient.invalidateQueries({ queryKey: QUERY_KEY_STORY_KB(storyId) });
        queryClient.invalidateQueries({ queryKey: ['ragnarok-search'] });
      }
      toast({ title: t('story.knowledge.deleteSuccess', 'Dokumenty smazány') });
    },
    onError: (error: unknown) => {
      safeError('storyKnowledge.delete.failed', error);
      toast({
        title: t('story.knowledge.deleteError', 'Mazání selhalo'),
        variant: 'destructive',
      });
    },
  });
}
