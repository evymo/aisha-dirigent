/**
 * useRagnarok — read-only hybrid search nad AISHA knowledge base (BM25 + KNN
 * přes Elasticsearch). Volá MCP /ragnarok/search endpoint přes Aisha gateway.
 *
 * Pro DIALOG (multi-turn) NIKDY nevolat Ragnarok přímo — místo toho `useStoryAiConsult`
 * (svc-ai-chat orchestrace s Tao + Psyche + Hippocampus + Maestro brain wiringem).
 * Tento hook je vhodný pro:
 *   - Story KB tab (live preview hits)
 *   - Search box ve story details
 *   - Admin curation (NocoDB / Appsmith přes Edge Functions)
 *
 * AISHA principy: Hook-Only Data Access, Zod Validation, no console.log.
 *
 * @module
 */
import { useQuery } from '@tanstack/react-query';
import { aisha } from '@/integrations/db/client';
import { safeError } from '@/lib/security/safeLogger';
import {
  RagnarokSearchRequestSchema,
  RagnarokSearchResponseSchema,
  type RagnarokSearchRequest,
  type RagnarokSearchResponse,
} from '@/schemas/insightSchemas';

export interface UseRagnarokSearchOptions {
  query: string;
  projectId?: string;
  kbIds?: string[];
  lang?: string;
  returnHighlights?: boolean;
  enabled?: boolean;
  staleTimeMs?: number;
}

/**
 * Hybrid search via Ragnarok. Returns parsed RagnarokSearchResponse.
 * Empty query → disabled (no fetch).
 */
export function useRagnarokSearch(options: UseRagnarokSearchOptions) {
  const {
    query,
    projectId,
    kbIds,
    lang = 'cs-CZ',
    returnHighlights = true,
    enabled = true,
    staleTimeMs = 30_000,
  } = options;

  return useQuery<RagnarokSearchResponse>({
    queryKey: ['ragnarok-search', projectId ?? 'aisha', query, kbIds ?? [], lang],
    enabled: enabled && query.trim().length > 0,
    staleTime: staleTimeMs,
    queryFn: async () => {
      const request: RagnarokSearchRequest = RagnarokSearchRequestSchema.parse({
        query: query.trim(),
        project_id: projectId,
        kb_ids: kbIds,
        lang,
        return_highlights: returnHighlights,
        return_matched_chunks: true,
      });

      const { data, error } = await aisha.functions.invoke('ragnarok-search', {
        body: request,
      });

      if (error) {
        safeError('ragnarok.search.failed', error);
        throw new Error(error.message ?? 'Ragnarok search failed');
      }

      const parsed = RagnarokSearchResponseSchema.safeParse(data);
      if (!parsed.success) {
        safeError('ragnarok.search.validation', parsed.error);
        throw new Error('Invalid Ragnarok response format');
      }

      return parsed.data;
    },
  });
}

/**
 * Convenience: extract matched chunks from response (handles both
 * `matched_chunks` and `chunks` shape).
 */
export function extractRagnarokChunks(response?: RagnarokSearchResponse) {
  if (!response?.data) return [];
  return response.data.matched_chunks ?? response.data.chunks ?? [];
}
