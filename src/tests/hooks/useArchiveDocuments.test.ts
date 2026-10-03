import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useArchiveDocuments, useArchiveDocument, useArchiveFilterOptions } from '@/hooks/useArchiveDocuments';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
      i18n: { language: 'en' },
    }),
  };
});

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
};

const mockDocuments = [
  {
    id: '550e8400-e29b-41d4-a716-446655440201',
    slug: 'historical-document-1',
    title: 'Historical Document 1',
    summary: 'Brief summary',
    description: 'Important study',
    editorial_note: 'Note here',
    what_you_are_looking_at: 'Description',
    standards_context: 'Context',
    content: 'Full content here',
    document_type: 'operational_study',
    year: 1965,
    decade: '1960s',
    place: 'Prague',
    facility: 'Research Center',
    preparation: 'Retisin',
    people: ['Dr. Smith', 'Dr. Jones'],
    keywords: ['study', 'operational'],
    provenance_badge: 'verified',
    scan_url: '/scans/doc1.pdf',
    transcript_url: '/transcripts/doc1.txt',
    storage_path: null,
    source_publication: null,
    original_language: null,
    page_count: null,
    is_featured: true,
    is_download_public: false,
    is_public: true,
    related_documents: null,
    parent_document_id: null,
    version: null,
    version_date: null,
    version_notes: null,
    is_current_version: true,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440202',
    slug: 'historical-document-2',
    title: 'Historical Document 2',
    summary: null,
    description: null,
    editorial_note: null,
    what_you_are_looking_at: null,
    standards_context: null,
    content: null,
    document_type: 'testimonial',
    year: 1972,
    decade: '1970s',
    place: 'Bratislava',
    facility: null,
    preparation: 'Lyastin',
    people: null,
    keywords: ['testimonial'],
    provenance_badge: 'pending',
    scan_url: null,
    transcript_url: null,
    storage_path: null,
    source_publication: null,
    original_language: null,
    page_count: null,
    is_featured: false,
    is_download_public: false,
    is_public: true,
    related_documents: null,
    parent_document_id: null,
    version: null,
    version_date: null,
    version_notes: null,
    is_current_version: true,
    created_at: '2024-01-02T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
  },
];

const mockFilterOptions = {
  decades: ['1960s', '1970s'],
  document_types: ['operational_study', 'testimonial'],
  preparations: ['Retisin', 'Lyastin'],
  places: ['Prague', 'Bratislava'],
  keywords: ['study', 'operational', 'testimonial'],
};

const expectedFilterOptions = {
  decades: ['1960s', '1970s'],
  documentTypes: ['operational_study', 'testimonial'],
  preparations: ['Retisin', 'Lyastin'],
  places: ['Prague', 'Bratislava'],
  keywords: ['study', 'operational', 'testimonial'],
};

const mockRpc = vi.fn();

vi.mock('@/integrations/db/client', () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

describe('useArchiveDocuments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch all documents without filters', async () => {
    mockRpc.mockResolvedValueOnce({
      data: mockDocuments,
      error: null,
    });

    const { result } = renderHook(() => useArchiveDocuments(), { wrapper: createWrapper() });

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.documents).toEqual(mockDocuments);
    expect(result.current.error).toBe(null);
    expect(mockRpc).toHaveBeenCalledWith('get_archive_documents_localized', {
      p_locale: 'en',
      p_decade: undefined,
      p_document_type: undefined,
      p_preparation: undefined,
      p_keywords: undefined,
      p_search_query: undefined,
    });
  });

  it('should filter by decade', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [mockDocuments[0]],
      error: null,
    });

    const { result } = renderHook(() => useArchiveDocuments({ decade: '1960s' }), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.documents).toEqual([mockDocuments[0]]);
    expect(mockRpc).toHaveBeenCalledWith('get_archive_documents_localized', {
      p_locale: 'en',
      p_decade: '1960s',
      p_document_type: undefined,
      p_preparation: undefined,
      p_keywords: undefined,
      p_search_query: undefined,
    });
  });

  it('should filter by document type', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [mockDocuments[0]],
      error: null,
    });

    const { result } = renderHook(() => useArchiveDocuments({ documentType: 'operational_study' }), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.documents).toEqual([mockDocuments[0]]);
    expect(mockRpc).toHaveBeenCalledWith('get_archive_documents_localized', {
      p_locale: 'en',
      p_decade: undefined,
      p_document_type: 'operational_study',
      p_preparation: undefined,
      p_keywords: undefined,
      p_search_query: undefined,
    });
  });

  it('should filter by preparation', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [mockDocuments[0]],
      error: null,
    });

    const { result } = renderHook(() => useArchiveDocuments({ preparation: 'Retisin' }), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.documents).toEqual([mockDocuments[0]]);
    expect(mockRpc).toHaveBeenCalledWith('get_archive_documents_localized', {
      p_locale: 'en',
      p_decade: undefined,
      p_document_type: undefined,
      p_preparation: 'Retisin',
      p_keywords: undefined,
      p_search_query: undefined,
    });
  });

  it('should filter by keywords array', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [mockDocuments[0]],
      error: null,
    });

    const { result } = renderHook(() => useArchiveDocuments({ keywords: ['study'] }), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.documents).toEqual([mockDocuments[0]]);
    expect(mockRpc).toHaveBeenCalledWith('get_archive_documents_localized', {
      p_locale: 'en',
      p_decade: undefined,
      p_document_type: undefined,
      p_preparation: undefined,
      p_keywords: ['study'],
      p_search_query: undefined,
    });
  });

  it('should filter by legacy keyword', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [mockDocuments[0]],
      error: null,
    });

    const { result } = renderHook(() => useArchiveDocuments({ keyword: 'operational' }), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.documents).toEqual([mockDocuments[0]]);
    expect(mockRpc).toHaveBeenCalledWith('get_archive_documents_localized', {
      p_locale: 'en',
      p_decade: undefined,
      p_document_type: undefined,
      p_preparation: undefined,
      p_keywords: ['operational'],
      p_search_query: undefined,
    });
  });

  it('should search by query', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [mockDocuments[0]],
      error: null,
    });

    const { result } = renderHook(() => useArchiveDocuments({ searchQuery: 'Important' }), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.documents).toEqual([mockDocuments[0]]);
    expect(mockRpc).toHaveBeenCalledWith('get_archive_documents_localized', {
      p_locale: 'en',
      p_decade: undefined,
      p_document_type: undefined,
      p_preparation: undefined,
      p_keywords: undefined,
      p_search_query: 'Important',
    });
  });

  it('should handle fetch error', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'Database error', code: 'PGRST000' },
    });

    const { result } = renderHook(() => useArchiveDocuments(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.documents).toEqual([]);
    expect(result.current.error).toBeTruthy();
  });

  it('should return empty array on null data', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const { result } = renderHook(() => useArchiveDocuments(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.documents).toEqual([]);
    expect(result.current.error).toBe(null);
  });
});

describe('useArchiveDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch single document by slug', async () => {
    mockRpc.mockResolvedValueOnce({
      data: mockDocuments[0],
      error: null,
    });

    const { result } = renderHook(() => useArchiveDocument('historical-document-1'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.document).toEqual(mockDocuments[0]);
    expect(result.current.error).toBe(null);
    expect(mockRpc).toHaveBeenCalledWith('get_archive_document_by_slug_localized', {
      p_slug: 'historical-document-1',
      p_locale: 'en',
    });
  });

  it('should handle document not found', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const { result } = renderHook(() => useArchiveDocument('non-existent'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.document).toBe(null);
    expect(result.current.error).toBe(null);
  });

  it('should handle fetch error', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'Not found', code: 'PGRST116' },
    });

    const { result } = renderHook(() => useArchiveDocument('error-slug'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.document).toBe(null);
    expect(result.current.error).toBeTruthy();
  });
});

describe('useArchiveFilterOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch filter options', async () => {
    mockRpc.mockResolvedValueOnce({
      data: mockFilterOptions,
      error: null,
    });

    const { result } = renderHook(() => useArchiveFilterOptions(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.filterOptions).toEqual(expectedFilterOptions);
    expect(mockRpc).toHaveBeenCalledWith('get_archive_filter_options');
  });

  it('should handle error when fetching filter options', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'Database error', code: 'PGRST000' },
    });

    const { result } = renderHook(() => useArchiveFilterOptions(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Hook catches errors silently, only logs them
    expect(result.current.filterOptions).toEqual({
      decades: [],
      documentTypes: [],
      preparations: [],
      places: [],
      keywords: [],
    });
  });

  it('should return default filter options on null data', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const { result } = renderHook(() => useArchiveFilterOptions(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.filterOptions).toEqual({
      decades: [],
      documentTypes: [],
      preparations: [],
      places: [],
      keywords: [],
    });
  });
});
