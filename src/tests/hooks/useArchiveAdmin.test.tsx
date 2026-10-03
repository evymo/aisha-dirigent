import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor, act } from '@testing-library/react';
import { renderHookWithProviders } from '@/tests/utils/test-utils';

const mockToast = vi.hoisted(() =>
  Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(),
    loading: vi.fn(), dismiss: vi.fn(), promise: vi.fn(),
  })
);

vi.mock("sonner", () => ({
  toast: mockToast,
}));

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}));

vi.mock('@/i18n', () => ({
  default: {
    t: (key: string) => key,
  },
}));

const hoisted = vi.hoisted(() => ({
  rpcMock: vi.fn(),
}));

vi.mock('@/integrations/db/client', () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (...args: unknown[]) => hoisted.rpcMock(...args),
  },
}));

import {
  useArchiveDocumentsAdmin,
  useCreateArchiveDocument,
  useUpdateArchiveDocument,
  useDeleteArchiveDocument,
  type ArchiveDocumentInput,
} from '@/hooks/useArchiveAdmin';
import { mockAdminPermissions } from '@/tests/utils/permissions';

// Full mock data matching adminArchiveDocumentSchema (all fields required)
const validDocument = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  slug: 'test-document',
  title: 'Test Document',
  title_key: 'archive.test-document.title',
  description: 'Test description',
  description_key: 'archive.test-document.description',
  summary_key: '',
  content: '',
  document_type: 'operational_study',
  provenance_badge: 'verified',
  year: 1965,
  decade: '1960s',
  facility: 'Research Center',
  place: 'Prague',
  preparation: 'Retisin',
  scan_url: '',
  transcript_url: '',
  editorial_note: '',
  editorial_note_key: '',
  what_you_are_looking_at: '',
  what_you_are_looking_at_key: '',
  standards_context: '',
  standards_context_key: '',
  source_publication: '',
  original_language: 'cs',
  page_count: 0,
  is_featured: true,
  is_public: false,
  is_current_version: true,
  people: ['Dr. Smith'],
  keywords: ['study', 'operational'],
  related_documents: [],
  parent_document_id: '',
  version: '1.0',
  version_date: '',
  version_notes: '',
  storage_path: '',
  is_download_public: false,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

const validInput: ArchiveDocumentInput = {
  slug: 'test-document',
  title: 'Test Document',
  description: 'Test description',
  document_type: 'operational_study',
  provenance_badge: 'verified',
  year: 1965,
  decade: '1960s',
  facility: 'Research Center',
  place: 'Prague',
  preparation: 'Retisin',
  is_featured: true,
  people: ['Dr. Smith'],
  keywords: ['study', 'operational'],
};

describe('useArchiveAdmin hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminPermissions();
    hoisted.rpcMock.mockReset();
    mockToast.mockReset();
  });

  describe('useArchiveDocumentsAdmin', () => {
    it('fetches all archive documents for admin via RPC', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [validDocument],
        error: null,
      });

      const { result } = renderHookWithProviders(() => useArchiveDocumentsAdmin());

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith('get_archive_documents_admin');
      expect(result.current.data).toHaveLength(1);
      expect(result.current.data?.[0]?.slug).toBe('test-document');
    });

    it('handles fetch error', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
      });

      const { result } = renderHookWithProviders(() => useArchiveDocumentsAdmin());

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });

    it('returns empty array when no documents exist', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [],
        error: null,
      });

      const { result } = renderHookWithProviders(() => useArchiveDocumentsAdmin());

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual([]);
    });
  });

  describe('useCreateArchiveDocument', () => {
    it('creates document via RPC and invalidates cache', async () => {
      const newDocId = '550e8400-e29b-41d4-a716-446655440001';
      hoisted.rpcMock.mockResolvedValue({
        data: newDocId,
        error: null,
      });

      const { result, queryClient } = renderHookWithProviders(() => useCreateArchiveDocument());
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      await act(async () => {
        await result.current.mutateAsync(validInput);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith('create_archive_document_admin', {
        p_data: expect.objectContaining({
          slug: 'test-document',
          title: 'Test Document',
          document_type: 'operational_study',
        }),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['admin-archive-documents'] });
      expect(mockToast.success).toHaveBeenCalled();
    });

    it('shows error toast on create failure', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: { message: 'Create failed' },
      });

      const { result } = renderHookWithProviders(() => useCreateArchiveDocument());

      await act(async () => {
        await expect(result.current.mutateAsync(validInput)).rejects.toBeTruthy();
      });

      expect(mockToast.error).toHaveBeenCalled();
    });

    it('validates input with Zod schema before RPC call', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: 'new-id',
        error: null,
      });

      const { result } = renderHookWithProviders(() => useCreateArchiveDocument());

      // Missing required fields should fail Zod validation
      const invalidInput = { title: 'Test' } as ArchiveDocumentInput;

      await act(async () => {
        await expect(result.current.mutateAsync(invalidInput)).rejects.toThrow();
      });

      // RPC should not be called if validation fails
      expect(hoisted.rpcMock).not.toHaveBeenCalled();
    });
  });

  describe('useUpdateArchiveDocument', () => {
    it('updates document via RPC and invalidates cache', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: null,
      });

      const { result, queryClient } = renderHookWithProviders(() => useUpdateArchiveDocument());
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      await act(async () => {
        await result.current.mutateAsync({
          id: validDocument.id,
          data: { title: 'Updated Title' },
        });
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith('update_archive_document_admin', {
        p_id: validDocument.id,
        p_data: expect.objectContaining({
          title: 'Updated Title',
        }),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['admin-archive-documents'] });
      expect(mockToast.success).toHaveBeenCalled();
    });

    it('shows error toast on update failure', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: { message: 'Update failed' },
      });

      const { result } = renderHookWithProviders(() => useUpdateArchiveDocument());

      await act(async () => {
        await expect(
          result.current.mutateAsync({
            id: validDocument.id,
            data: { title: 'Updated Title' },
          })
        ).rejects.toBeTruthy();
      });

      expect(mockToast.error).toHaveBeenCalled();
    });

    it('allows partial updates with Zod partial schema', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: null,
      });

      const { result } = renderHookWithProviders(() => useUpdateArchiveDocument());

      // Should work with just a subset of fields
      await act(async () => {
        await result.current.mutateAsync({
          id: validDocument.id,
          data: { is_featured: false },
        });
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith('update_archive_document_admin', {
        p_id: validDocument.id,
        p_data: { is_featured: false },
      });
    });
  });

  describe('useDeleteArchiveDocument', () => {
    it('deletes document via RPC and invalidates cache', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: null,
      });

      const { result, queryClient } = renderHookWithProviders(() => useDeleteArchiveDocument());
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      await act(async () => {
        await result.current.mutateAsync(validDocument.id);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith('delete_archive_document_admin', {
        p_id: validDocument.id,
      });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['admin-archive-documents'] });
      expect(mockToast.success).toHaveBeenCalled();
    });

    it('shows error toast on delete failure', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: { message: 'Delete failed' },
      });

      const { result } = renderHookWithProviders(() => useDeleteArchiveDocument());

      await act(async () => {
        await expect(result.current.mutateAsync(validDocument.id)).rejects.toBeTruthy();
      });

      expect(mockToast.error).toHaveBeenCalled();
    });
  });
});
