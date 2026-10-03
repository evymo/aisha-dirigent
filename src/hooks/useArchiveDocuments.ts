import { useQuery, keepPreviousData, queryOptions } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { getUserFacingDataErrorMessage } from "@/lib/security/userFacingErrors";
import { archiveDocumentArraySchema, archiveFilterOptionsSchema } from "@/lib/schemas/archiveDocumentSchemas";

export interface ArchiveDocument {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  description: string | null;
  editorial_note: string | null;
  what_you_are_looking_at: string | null;
  standards_context: string | null;
  content: string | null;
  document_type: string;
  year: number | null;
  decade: string | null;
  place: string | null;
  facility: string | null;
  preparation: string | null;
  people: string[] | null;
  keywords: string[] | null;
  provenance_badge: string;
  scan_url: string | null;
  transcript_url: string | null;
  storage_path: string | null;
  source_publication: string | null;
  original_language: string | null;
  page_count: number | null;
  is_featured: boolean | null;
  is_download_public: boolean;
  is_public: boolean;
  related_documents: string[] | null;
  parent_document_id: string | null;
  version: string | null;
  version_date: string | null;
  version_notes: string | null;
  is_current_version: boolean | null;
  created_at: string;
  updated_at: string;
}

export interface ArchiveFilterOptions {
  decades: string[];
  documentTypes: string[];
  preparations: string[];
  places: string[];
  keywords: string[];
}

export interface UseArchiveDocumentsOptions {
  decade?: string | null;
  documentType?: string | null;
  preparation?: string | null;
  keywords?: string[] | null;
  keyword?: string | null;
  searchQuery?: string;
  locale?: string;
}

/**
 * Query options for fetching archive documents
 */
export const archiveDocumentsQueryOptions = (options: UseArchiveDocumentsOptions = {}) => {
  const keywordsArray = (Array.isArray(options.keywords) ? options.keywords : (options.keyword ? [options.keyword] : []))
    .filter((k): k is string => typeof k === "string" && k.trim().length > 0)
    .map((k) => k.trim())
    .filter((k, i, arr) => arr.indexOf(k) === i);
  const keywordFilter = keywordsArray.length > 0 ? keywordsArray : null;
  const locale = options.locale ?? "en";

  return queryOptions({
    queryKey: [
      "archive-documents",
      locale,
      options.decade ?? null,
      options.documentType ?? null,
      options.preparation ?? null,
      keywordsArray.sort().join("|"),
      options.searchQuery ?? null,
    ],
    queryFn: async (): Promise<ArchiveDocument[]> => {
      const { data, error } = await aisha.rpc("get_archive_documents_localized", {
        p_decade: options.decade ?? undefined,
        p_document_type: options.documentType ?? undefined,
        p_keywords: keywordFilter ?? undefined,
        p_locale: locale,
        p_preparation: options.preparation ?? undefined,
        p_search_query: options.searchQuery ?? undefined

      });

      if (error) {
        safeError("useArchiveDocuments.fetch", error);
        throw new Error(error.message);
      }

      const parsed = archiveDocumentArraySchema.safeParse(data);
      if (!parsed.success) {
        safeError("useArchiveDocuments.validation", parsed.error);
        return [];
      }
      return parsed.data as ArchiveDocument[];
    },
    staleTime: 10 * 60 * 1000, // 10 minutes
    gcTime: 60 * 60 * 1000, // 60 minutes
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });
};

/**
 * Hook for fetching archive documents with React Query caching.
 * Optimized with staleTime and gcTime to prevent flicker on navigation.
 */
export function useArchiveDocuments(options: UseArchiveDocumentsOptions = {}) {
  const { i18n } = useTranslation();
  const locale = options.locale ?? i18n.language ?? "en";
  const query = useQuery(archiveDocumentsQueryOptions({ ...options, locale }));

  return {
    documents: query.data ?? [],
    loading: query.isLoading,
    error: query.error ? getUserFacingDataErrorMessage(query.error) : null,
  };
}

/**
 * Query options for fetching a single archive document
 */
export const archiveDocumentQueryOptions = (slug: string, locale: string = "en") => queryOptions({
  queryKey: ["archive-document", slug, locale],
  queryFn: async (): Promise<ArchiveDocument | null> => {
    const { data, error } = await aisha.rpc("get_archive_document_by_slug_localized", {
      p_locale: locale
      ,
      p_slug: slug
    });

    if (error) {
      safeError("useArchiveDocument.fetch", error);
      throw new Error(error.message);
    }

    const result = Array.isArray(data) ? data[0] : data;
    if (!result) return null;

    const parsed = archiveDocumentArraySchema.element.safeParse(result);
    if (!parsed.success) {
      safeError("useArchiveDocument.validation", parsed.error);
      return null;
    }
    return parsed.data as ArchiveDocument;
  },
  enabled: Boolean(slug),
  staleTime: 10 * 60 * 1000,
  gcTime: 60 * 60 * 1000,
});

/**
 * Hook for fetching a single archive document by slug.
 */
export function useArchiveDocument(slug: string) {
  const { i18n } = useTranslation();
  const locale = i18n.language ?? "en";
  const query = useQuery(archiveDocumentQueryOptions(slug, locale));

  return {
    document: query.data ?? null,
    loading: query.isLoading,
    error: query.error ? getUserFacingDataErrorMessage(query.error) : null,
  };
}

/**
 * Query options for fetching archive filter options
 */
export const archiveFilterOptionsQueryOptions = () => ({
  queryKey: ["archive-filter-options"],
  queryFn: async (): Promise<ArchiveFilterOptions> => {
    const { data, error } = await aisha.rpc("get_archive_filter_options");

    if (error) {
      safeError("useArchiveFilterOptions.fetch", error);
      throw new Error(error.message);
    }

    const parsed = archiveFilterOptionsSchema.safeParse(data);
    if (parsed.success) {
      return {
        decades: parsed.data.decades,
        documentTypes: parsed.data.document_types,
        preparations: parsed.data.preparations,
        places: parsed.data.places,
        keywords: parsed.data.keywords,
      };
    }

    safeError("useArchiveFilterOptions.validation", parsed.error);
    return {
      decades: [],
      documentTypes: [],
      preparations: [],
      places: [],
      keywords: [],
    };
  },
  staleTime: 30 * 60 * 1000, // 30 minutes
  gcTime: 60 * 60 * 1000, // 60 minutes
  placeholderData: keepPreviousData, // Prevent flickering on refetch
  refetchOnWindowFocus: false,
} as const);

/**
 * Hook for fetching archive filter options with caching.
 */
export function useArchiveFilterOptions() {
  const query = useQuery(archiveFilterOptionsQueryOptions());

  return {
    filterOptions: query.data ?? {
      decades: [],
      documentTypes: [],
      preparations: [],
      places: [],
      keywords: [],
    },
    loading: query.isLoading,
  };
}

/**
 * Hook for fetching related archive documents by their slugs.
 * Replaces raw useEffect+aisha.rpc pattern in ArchiveDocument page.
 *
 * @param slugs - Array of document slugs to fetch.
 * @returns Related documents, loading and error state.
 */
export function useRelatedArchiveDocuments(slugs: string[] | null | undefined) {
  const query = useQuery({
    queryKey: ["archive-related-documents", ...(slugs ?? []).sort()],
    queryFn: async (): Promise<ArchiveDocument[]> => {
      if (!slugs || slugs.length === 0) return [];

      const { data, error } = await aisha.rpc("get_archive_documents_by_slugs", {
        p_slugs: slugs,
      });

      if (error) {
        safeError("useRelatedArchiveDocuments.fetch", error);
        throw new Error(error.message);
      }

      const parsed = archiveDocumentArraySchema.safeParse(data);
      if (!parsed.success) {
        safeError("useRelatedArchiveDocuments.validation", parsed.error);
        return [];
      }
      return parsed.data as ArchiveDocument[];
    },
    enabled: Array.isArray(slugs) && slugs.length > 0,
    staleTime: 10 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });

  return {
    relatedDocuments: query.data ?? [],
    loading: query.isLoading,
    error: query.error,
  };
}

// Helper to get localized field — RPC already returns locale-resolved values
export function getLocalizedField(
  document: ArchiveDocument,
  field: 'title' | 'description' | 'editorial_note' | 'standards_context' | 'what_you_are_looking_at',
  _locale: string
): string | null {
  return (document[field] as string | null) ?? null;
}

export function getLocalizedSummary(document: ArchiveDocument, _locale: string): string | null {
  // summary is already localized by RPC - return directly
  return document.summary || null;
}
