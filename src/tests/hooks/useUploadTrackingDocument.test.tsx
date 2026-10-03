import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode } from 'react';

const hoisted = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  invokeEdgeFunctionLegacy: vi.fn(),
  fetch: vi.fn(),
  rpc: vi.fn(),
}));

// storage-auth /upload-preflight returns a MinIO presigned PUT target; the hook PUTs
// the raw bytes via fetch (the Supabase storage client is banned platform-wide).
//
// ⛔ TŘI KROKY, NE DVA (2026-09-21). PUT doručí bajty do KARANTÉNNÍHO bucketu;
// dokument se oskenuje a promuje do `health-documents` teprve po ohlášení
// `/upload-complete`. Bez toho by soubor ležel v karanténě, ze které se nic
// neservíruje — uživatel by viděl „nahráno" u dokumentu, ke kterému se nedostane.
const mockPhiClient = {
  rpc: (name: string, params?: Record<string, unknown>) => {
    hoisted.rpc(name, params);
    return Promise.resolve({ data: null, error: null });
  },
};

vi.mock('@/integrations/api/edge', () => ({
  invokeEdgeFunctionLegacy: (...args: unknown[]) => hoisted.invokeEdgeFunctionLegacy(...args),
  invokeEdgeFunction: vi.fn(),
  EdgeFunctionInvokeError: class extends Error {},
}));

vi.mock('sonner', () => ({
  toast: {
    success: hoisted.toastSuccess,
    error: hoisted.toastError,
  },
}));

vi.mock('@/i18n', () => ({
  default: {
    t: (key: string) => key,
  },
}));

vi.mock('@/lib/security/safeLogger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security/safeLogger')>();
  return {
    ...actual,
    safeError: vi.fn(),
    safeWarn: vi.fn(),
    safeInfo: vi.fn(),
  };
});

const mockUser = { id: 'user-123', email: 'test@example.com' };

vi.mock('@/hooks/useSession', () => ({
  useSession: () => ({
    user: mockUser,
    session: { user: mockUser },
    isLoading: false,
    hasRole: vi.fn(),
    roles: [],
    isAdmin: false,
    signOut: vi.fn(),
    error: null,
    refetchRoles: vi.fn(),
  }),
}));

vi.mock('@/hooks/useSecureMode', () => ({
  useSecureMode: () => ({
    isEnabled: true,
    isEnabling: false,
    enabledAt: Date.now(),
    secureAccessToken: 'test-token',
    secureClient: mockPhiClient,
    enableWithPassword: vi.fn(),
    disable: vi.fn(),
  }),
}));

vi.mock('@/integrations/db/client', () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    ...mockPhiClient,
  },
}));

import { useUploadTrackingDocument } from '@/hooks/useTrackingDocuments';

function createMockFile(params: { name: string; type: string; bytes: Uint8Array }): File {
  const fileLike = {
    name: params.name,
    type: params.type,
    size: params.bytes.byteLength,
    arrayBuffer: async () => params.bytes.buffer,
  };
  return fileLike as unknown as File;
}

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

const PRESIGNED_URL = 'https://minio.internal/health-documents/user-123/uuid_test.pdf?X-Amz-Signature=abc';

describe('useUploadTrackingDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', hoisted.fetch);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uploads via preflight then PUTs bytes to the presigned MinIO URL', async () => {
    hoisted.invokeEdgeFunctionLegacy.mockResolvedValueOnce({
      documentId: 'doc-1',
      uploadUrl: PRESIGNED_URL,
      quarantineKey: 'health-documents/user-123/uuid_test.pdf',
      objectKey: 'user-123/uuid_test.pdf',
      bucket: 'health-documents',
      mimeType: 'application/pdf',
    });
    hoisted.fetch
      .mockResolvedValueOnce({ ok: true, status: 200 })   // PUT bajtů do karantény
      .mockResolvedValueOnce({                            // ohlášení → sken → promoce
        ok: true,
        status: 200,
        json: async () => ({ bucket: 'health-documents', objectKey: 'user-123/uuid_test.pdf', status: 'clean' }),
      });

    const { result } = renderHook(() => useUploadTrackingDocument(), { wrapper: createWrapper() });
    const file = createMockFile({ name: 'test.pdf', type: 'application/pdf', bytes: new Uint8Array([1, 2, 3]) });

    await act(async () => {
      await result.current.mutateAsync({ file, category: 'lab_results', title: 'My report' });
    });

    expect(hoisted.invokeEdgeFunctionLegacy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        functionName: 'upload-health-document-preflight',
        body: expect.objectContaining({
          filename: 'test.pdf',
          mimeType: 'application/pdf',
          size: file.size,
          category: 'lab_results',
          title: 'My report',
        }),
      }),
    );

    // Raw bytes PUT to the presigned URL with the resolved Content-Type.
    expect(hoisted.fetch).toHaveBeenCalledWith(
      PRESIGNED_URL,
      expect.objectContaining({
        method: 'PUT',
        body: expect.objectContaining({ name: 'test.pdf', type: 'application/pdf' }),
        headers: expect.objectContaining({ 'Content-Type': 'application/pdf' }),
      }),
    );
    // Ohlášení dokončení — teprve ono spustí sken a promoci.
    expect(hoisted.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/upload-complete'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          objectKey: 'health-documents/user-123/uuid_test.pdf',
          documentId: 'doc-1',
        }),
      }),
    );
    expect(hoisted.toastSuccess).toHaveBeenCalled();
  });

  it('nepromovaný dokument = chyba a úklid řádku (fail-closed)', async () => {
    hoisted.invokeEdgeFunctionLegacy.mockResolvedValueOnce({
      documentId: 'doc-3',
      uploadUrl: PRESIGNED_URL,
      quarantineKey: 'health-documents/user-123/uuid_test3.pdf',
      objectKey: 'user-123/uuid_test3.pdf',
      bucket: 'health-documents',
      mimeType: 'application/pdf',
    });
    hoisted.fetch
      .mockResolvedValueOnce({ ok: true, status: 200 })  // PUT projde
      .mockResolvedValueOnce({                           // sken nedostupný
        ok: false,
        status: 502,
        json: async () => ({ error: 'scan_unavailable' }),
      });

    const { result } = renderHook(() => useUploadTrackingDocument(), { wrapper: createWrapper() });
    const file = createMockFile({ name: 'test3.pdf', type: 'application/pdf', bytes: new Uint8Array([1]) });

    await act(async () => {
      await expect(result.current.mutateAsync({ file, category: 'lab_results' })).rejects.toBeTruthy();
    });

    expect(hoisted.rpc).toHaveBeenCalledWith('delete_my_health_document_audited', {
      p_document_id: 'doc-3',
    });
    expect(hoisted.toastError).toHaveBeenCalled();
  });

  it('fails when preflight errors, without attempting the upload PUT', async () => {
    hoisted.invokeEdgeFunctionLegacy.mockRejectedValueOnce(new Error('preflight failed'));

    const { result } = renderHook(() => useUploadTrackingDocument(), { wrapper: createWrapper() });
    const file = createMockFile({ name: 'test.pdf', type: 'application/pdf', bytes: new Uint8Array([1]) });

    await act(async () => {
      await expect(result.current.mutateAsync({ file, category: 'lab_results' })).rejects.toBeTruthy();
    });

    expect(hoisted.fetch).not.toHaveBeenCalled();
    expect(hoisted.toastError).toHaveBeenCalled();
  });

  it('cleans up the DB row when the presigned PUT fails', async () => {
    hoisted.invokeEdgeFunctionLegacy.mockResolvedValueOnce({
      documentId: 'doc-2',
      uploadUrl: PRESIGNED_URL,
      quarantineKey: 'health-documents/user-123/uuid_test2.pdf',
      objectKey: 'user-123/uuid_test2.pdf',
      bucket: 'health-documents',
      mimeType: 'application/pdf',
    });
    hoisted.fetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const { result } = renderHook(() => useUploadTrackingDocument(), { wrapper: createWrapper() });
    const file = createMockFile({ name: 'test2.pdf', type: 'application/pdf', bytes: new Uint8Array([1]) });

    await act(async () => {
      await expect(result.current.mutateAsync({ file, category: 'lab_results' })).rejects.toBeTruthy();
    });

    expect(hoisted.rpc).toHaveBeenCalledWith('delete_my_health_document_audited', {
      p_document_id: 'doc-2',
    });
    expect(hoisted.toastError).toHaveBeenCalled();
  });
});
