import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import {
  useAnalyzeDocument,
  useContributeToStatistics,
  useDeleteTrackingDocument,
  useDocumentSharingPermissions,
  useGrantDocumentSharing,
  useTrackingDocuments,
  useRevokeDocumentSharing,
  useUploadTrackingDocument,
  getDocumentUrl,
} from '@/hooks/useTrackingDocuments';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

beforeEach(() => {
  vi.clearAllMocks();
});

// Mock user
const mockUser = {
  id: 'test-user-id',
  email: 'test@example.com',
};

let mockAuthReturn: {
  user: { id: string; email: string } | null;
  isAuthenticated: boolean;
  loading: boolean;
} = {
  user: mockUser,
  isAuthenticated: true,
  loading: false,
};

let mockPhiModeReturn: {
  isEnabled: boolean;
  secureClient: unknown | null;
} = {
  isEnabled: true,
  secureClient: null,
};

const toastSuccess = vi.fn();
const toastError = vi.fn();

const invokeEdgeFunctionMock = vi.fn();

// Hoisted so the vi.mock factories (and any module that calls safeWarn/safeError
// at import time, e.g. oidc-config) can reference these before the const block
// would otherwise be initialized.
const { safeErrorMock, safeWarnMock } = vi.hoisted(() => ({
  safeErrorMock: vi.fn(),
  safeWarnMock: vi.fn(),
}));

vi.mock('@/hooks/useSession', () => ({
  useSession: vi.fn(() => ({
    user: mockAuthReturn.user,
    session: mockAuthReturn.user ? { user: mockAuthReturn.user } : null,
    isLoading: mockAuthReturn.loading,
    hasRole: vi.fn(),
    roles: [],
    isAdmin: false,
    signOut: vi.fn(),
  })),
}));

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

vi.mock('@/i18n', () => ({
  default: {
    t: (key: string) => key,
  },
}));

vi.mock('@/integrations/api/edge', () => ({
  invokeEdgeFunction: (...args: unknown[]) => invokeEdgeFunctionMock(...args),
  invokeEdgeFunctionLegacy: (...args: unknown[]) => invokeEdgeFunctionMock(...args),
}));

vi.mock('@/lib/security/safeLogger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security/safeLogger')>();
  return {
    ...actual,
    safeError: (...args: unknown[]) => safeErrorMock(...args),
    safeWarn: (...args: unknown[]) => safeWarnMock(...args),
    safeInfo: vi.fn(),
  };
});

// Mock Supabase (sensitive data client)
const mockRpc = vi.fn();

// Storage deletes go through the canonical @/integrations/api/storage module
// (ApiClient/secureClient has no storage surface), so mock that module. Spies
// are hoisted so the vi.mock factory (also hoisted) can reference them.
const { storageFrom, storageRemove, storageUploadToSignedUrl } = vi.hoisted(() => {
  const removeSpy = vi.fn();
  const uploadToSignedUrlSpy = vi.fn();
  const fromSpy = vi.fn(() => ({
    remove: removeSpy,
    uploadToSignedUrl: uploadToSignedUrlSpy,
  }));
  return {
    storageFrom: fromSpy,
    storageRemove: removeSpy,
    storageUploadToSignedUrl: uploadToSignedUrlSpy,
  };
});

vi.mock('@/integrations/api/storage', async (importOriginal) => {
  // `dokonciNahrani` je SKUTEČNÁ funkce: posílá ohlášení přes `fetch`, který si tenhle
  // test stubuje sám, takže mockovat ji by z testu odstranilo právě ten krok, který
  // dokument oskenuje a promuje (2026-09-21).
  const actual = await importOriginal<typeof import('@/integrations/api/storage')>();
  return { ...actual, storage: { from: storageFrom } };
});

const mockPhiClient = {
  rpc: mockRpc,
};

vi.mock('@/hooks/useSecureMode', () => ({
  useSecureMode: vi.fn(() => ({
    isEnabled: mockPhiModeReturn.isEnabled,
    isEnabling: false,
    enabledAt: Date.now(),
    secureClient: mockPhiModeReturn.secureClient,
    secureAccessToken: 'test-token',
    enableWithPassword: vi.fn(),
    disable: vi.fn(),
  })),
}));


const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });

const createWrapper = (queryClient: QueryClient) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };

describe('useTrackingDocuments', () => {
  const mockDocuments = [
    {
      id: 'doc-1',
      user_id: 'test-user-id',
      file_name: 'test-report.pdf',
      category: 'lab_results',
      created_at: '2023-01-01T00:00:00Z',
    },
    {
      id: 'doc-2',
      user_id: 'test-user-id',
      file_name: 'scan.jpg',
      category: 'imaging',
      created_at: '2023-01-02T00:00:00Z',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthReturn = {
      user: mockUser,
      isAuthenticated: true,
      loading: false,
    };

    mockPhiModeReturn = {
      isEnabled: true,
      secureClient: mockPhiClient,
    };

    mockRpc.mockImplementation((fn: string) => {
      if (fn === 'get_my_health_documents_audited') {
        return Promise.resolve({ data: mockDocuments, error: null });
      }
      if (fn === 'delete_my_health_document_audited') {
        return Promise.resolve({ data: true, error: null });
      }
      if (fn === 'mark_health_document_contributed_audited') {
        return Promise.resolve({
          data: [
            {
              id: 'doc-1',
              contributed_to_statistics: true,
              contributed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    storageRemove.mockResolvedValue({ error: null });
    storageUploadToSignedUrl.mockResolvedValue({ error: null });

    invokeEdgeFunctionMock.mockReset();
  });

  it('should fetch health documents successfully', async () => {
    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useTrackingDocuments(), { wrapper: createWrapper(queryClient) });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[0].file_name).toBe('test-report.pdf');
  });

  it('should return empty array when user is not authenticated', async () => {
    mockAuthReturn = {
      user: null,
      isAuthenticated: false,
      loading: false,
    };

    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useTrackingDocuments(), { wrapper: createWrapper(queryClient) });

    // When not authenticated, the query is disabled (enabled: !!user?.id)
    // So status should be 'pending' and fetchStatus 'idle'
    expect(result.current.status).toBe('pending');
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('should not fetch when secure mode is disabled', async () => {
    mockPhiModeReturn = {
      isEnabled: false,
      secureClient: mockPhiClient,
    };

    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useTrackingDocuments(), { wrapper: createWrapper(queryClient) });

    expect(result.current.status).toBe('pending');
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe('useDocumentSharingPermissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthReturn = {
      user: mockUser,
      isAuthenticated: true,
      loading: false,
    };
    mockPhiModeReturn = {
      isEnabled: true,
      secureClient: mockPhiClient,
    };
    mockRpc.mockResolvedValue({ 
      data: [{ 
        id: '550e8400-e29b-41d4-a716-446655440401',
        document_id: '550e8400-e29b-41d4-a716-446655440400',
        user_id: '550e8400-e29b-41d4-a716-446655440100',
        shared_with_partner_id: '550e8400-e29b-41d4-a716-446655440500',
        shared_with_study_id: null,
        can_view: true,
        can_use_for_research: false,
        can_use_for_statistics: false,
        granted_at: '2024-01-01T00:00:00Z',
        revoked_at: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      }], 
      error: null 
    });
  });

  it('should fetch permissions when enabled and documentId provided', async () => {
    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useDocumentSharingPermissions('550e8400-e29b-41d4-a716-446655440400'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(mockRpc).toHaveBeenCalledWith('get_my_document_sharing_permissions_audited', {
      p_document_id: '550e8400-e29b-41d4-a716-446655440400',
    });
  });
});

describe('useUploadTrackingDocument', () => {
  it('should upload successfully and toast success', async () => {
    mockAuthReturn = {
      user: mockUser,
      isAuthenticated: true,
      loading: false,
    };
    mockPhiModeReturn = {
      isEnabled: true,
      secureClient: mockPhiClient,
    };

    invokeEdgeFunctionMock.mockResolvedValue({
      documentId: 'doc-123',
      uploadUrl: 'https://minio.internal/health-documents/user/doc.pdf?sig=abc',
      // ⛔ Bajty jdou do KARANTÉNY; promoci spustí až ohlášení /upload-complete
      // (2026-09-21). Bez něj dokument existuje a neservíruje se.
      quarantineKey: 'health-documents/user/doc.pdf',
      objectKey: 'user/doc.pdf',
      mimeType: 'application/pdf',
    });
    const putFetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200 })  // PUT bajtů do karantény
      .mockResolvedValueOnce({                           // ohlášení → sken → promoce
        ok: true,
        status: 200,
        json: async () => ({ bucket: 'health-documents', objectKey: 'user/doc.pdf', status: 'clean' }),
      });
    const origFetch = globalThis.fetch;
    globalThis.fetch = putFetch as unknown as typeof fetch;

    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useUploadTrackingDocument(), {
      wrapper: createWrapper(queryClient),
    });

    const file = {
      name: 'doc.pdf',
      type: 'application/pdf',
      size: 5,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    } as unknown as File;

    await act(async () => {
      const res = await result.current.mutateAsync({
        file,
        category: 'lab_results',
        title: 'doc.pdf',
      });
      expect(res).toEqual({ id: 'doc-123' });
    });

    expect(invokeEdgeFunctionMock).toHaveBeenCalledWith(
      mockPhiClient,
      expect.objectContaining({
        functionName: 'upload-health-document-preflight',
        context: 'useUploadTrackingDocument.preflight',
        body: expect.objectContaining({
          filename: 'doc.pdf',
          category: 'lab_results',
          title: 'doc.pdf',
        }),
      })
    );

    expect(putFetch).toHaveBeenCalledWith(
      'https://minio.internal/health-documents/user/doc.pdf?sig=abc',
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({ 'Content-Type': 'application/pdf' }),
      })
    );
    globalThis.fetch = origFetch;

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['health-documents'], refetchType: 'all' });
    expect(toastSuccess).toHaveBeenCalledWith('trackingDocuments.uploadSuccess');
  });

  it('should cleanup db row and toast error when upload fails', async () => {
    mockAuthReturn = {
      user: mockUser,
      isAuthenticated: true,
      loading: false,
    };
    mockPhiModeReturn = {
      isEnabled: true,
      secureClient: mockPhiClient,
    };
    mockRpc.mockResolvedValue({ data: true, error: null });

    invokeEdgeFunctionMock.mockResolvedValue({
      documentId: 'doc-err',
      uploadUrl: 'https://minio.internal/health-documents/user/doc.pdf?sig=err',
      objectKey: 'user/doc.pdf',
      mimeType: 'application/pdf',
    });
    const putFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const origFetch = globalThis.fetch;
    globalThis.fetch = putFetch as unknown as typeof fetch;

    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useUploadTrackingDocument(), {
      wrapper: createWrapper(queryClient),
    });

    const file = {
      name: 'doc.pdf',
      type: 'application/pdf',
      size: 5,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    } as unknown as File;

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          file,
          category: 'lab_results',
          title: 'doc.pdf',
        })
      ).rejects.toThrow(/Upload failed/);
    });
    globalThis.fetch = origFetch;

    expect(mockRpc).toHaveBeenCalledWith('delete_my_health_document_audited', {
      p_document_id: 'doc-err',
    });
    expect(safeErrorMock).toHaveBeenCalledWith('useUploadTrackingDocument.onError', expect.any(Error));
    expect(toastError).toHaveBeenCalledWith('trackingDocuments.uploadError');
  });

  it('should throw Not authenticated when sensitive data disabled', async () => {
    mockPhiModeReturn = {
      isEnabled: false,
      secureClient: mockPhiClient,
    };

    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useUploadTrackingDocument(), {
      wrapper: createWrapper(queryClient),
    });

    const file = {
      name: 'doc.pdf',
      type: 'application/pdf',
      size: 5,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    } as unknown as File;

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          file,
          category: 'lab_results',
          title: 'doc.pdf',
        })
      ).rejects.toThrow('Not authenticated');
    });
  });
});

describe('useDeleteTrackingDocument', () => {
  it('should remove from storage and delete record', async () => {
    mockPhiModeReturn = {
      isEnabled: true,
      secureClient: mockPhiClient,
    };
    mockRpc.mockResolvedValue({ data: true, error: null });

    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useDeleteTrackingDocument(), {
      wrapper: createWrapper(queryClient),
    });

    const doc = {
      id: 'doc-1',
      file_path: 'user/doc.pdf',
    } as never;

    await act(async () => {
      await result.current.mutateAsync(doc);
    });

    expect(storageFrom).toHaveBeenCalledWith('health-documents');
    expect(storageRemove).toHaveBeenCalledWith(['user/doc.pdf']);
    expect(mockRpc).toHaveBeenCalledWith('delete_my_health_document_audited', {
      p_document_id: 'doc-1',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['health-documents'], refetchType: 'all' });
    expect(toastSuccess).toHaveBeenCalledWith('trackingDocuments.deleteSuccess');
  });
});

describe('useGrantDocumentSharing', () => {
  it('should insert sharing permission and toast success', async () => {
    mockAuthReturn = {
      user: mockUser,
      isAuthenticated: true,
      loading: false,
    };
    mockPhiModeReturn = {
      isEnabled: true,
      secureClient: mockPhiClient,
    };
    mockRpc.mockResolvedValue({ data: [{ id: 'perm-1' }], error: null });

    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useGrantDocumentSharing(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        documentId: 'doc-1',
        partnerId: 'partner-1',
        canView: true,
        canUseForResearch: true,
      });
    });

    expect(mockRpc).toHaveBeenCalledWith('grant_document_sharing_permission_audited', {
      p_document_id: 'doc-1',
      p_partner_id: 'partner-1',
      p_study_id: undefined,
      p_can_view: true,
      p_can_use_for_statistics: false,
      p_can_use_for_research: true,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['document-sharing', 'doc-1'] });
    expect(toastSuccess).toHaveBeenCalledWith('trackingDocuments.shareSuccess');
  });
});

describe('useRevokeDocumentSharing', () => {
  it('should update revoked_at and toast success', async () => {
    mockPhiModeReturn = {
      isEnabled: true,
      secureClient: mockPhiClient,
    };
    mockRpc.mockResolvedValue({ data: true, error: null });

    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useRevokeDocumentSharing(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ permissionId: 'perm-1', documentId: 'doc-1' });
    });

    expect(mockRpc).toHaveBeenCalledWith('revoke_document_sharing_permission_audited', {
      p_permission_id: 'perm-1',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['document-sharing', 'doc-1'] });
    expect(toastSuccess).toHaveBeenCalledWith('trackingDocuments.revokeSuccess');
  });
});

describe('useAnalyzeDocument', () => {
  it('should call edge function and toast success', async () => {
    mockPhiModeReturn = {
      isEnabled: true,
      secureClient: mockPhiClient,
    };
    invokeEdgeFunctionMock.mockResolvedValue({ success: true });

    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useAnalyzeDocument(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ documentId: 'doc-1' });
    });

    expect(invokeEdgeFunctionMock).toHaveBeenCalledWith(
      mockPhiClient,
      expect.objectContaining({
        functionName: 'analyze-health-document',
        context: 'useAnalyzeDocument',
        body: { documentId: 'doc-1', customRedactions: [] },
      })
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['health-documents'], refetchType: 'all' });
    expect(toastSuccess).toHaveBeenCalledWith('trackingDocuments.analysisSuccess');
  });
});

describe('useContributeToStatistics', () => {
  it('should update contributed_to_statistics and toast success', async () => {
    mockPhiModeReturn = {
      isEnabled: true,
      secureClient: mockPhiClient,
    };
    mockRpc.mockResolvedValue({
      data: [
        {
          id: 'doc-1',
          contributed_to_statistics: true,
          contributed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
      error: null,
    });

    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useContributeToStatistics(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync('doc-1');
    });

    expect(mockRpc).toHaveBeenCalledWith('mark_health_document_contributed_audited', {
      p_document_id: 'doc-1',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['health-documents'], refetchType: 'all' });
    expect(toastSuccess).toHaveBeenCalledWith('trackingDocuments.contributeSuccess');
  });
});

describe('getDocumentUrl', () => {
  it('should return signedUrl on success', async () => {
    invokeEdgeFunctionMock.mockResolvedValue({ signedUrl: 'https://example.com/file', expiresInSeconds: 60 });

    const url = await getDocumentUrl('doc-1', mockPhiClient as never);
    expect(url).toBe('https://example.com/file');
    expect(invokeEdgeFunctionMock).toHaveBeenCalledWith(
      mockPhiClient,
      expect.objectContaining({ functionName: 'download-health-document', context: 'getDocumentUrl' })
    );
  });

  it('should return null and log safeError on failure', async () => {
    invokeEdgeFunctionMock.mockRejectedValue(new Error('boom'));

    const url = await getDocumentUrl('doc-1', mockPhiClient as never);
    expect(url).toBeNull();
    expect(safeErrorMock).toHaveBeenCalledWith('getDocumentUrl', expect.any(Error));
  });
});
