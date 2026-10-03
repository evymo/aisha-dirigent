import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitFor, act, cleanup } from '@testing-library/react';
import { renderHookWithProviders, createTestQueryClient } from '../utils/test-utils';

// Hoisted mocks
const hoisted = vi.hoisted(() => ({
  rpcMock: vi.fn(),
}));

vi.mock('@/integrations/db/client', () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (...args: unknown[]) => hoisted.rpcMock(...args),
  },
}));

// Import after mocks
import {
  useSupportedLanguages,
  useCreateLanguage,
  useUpdateLanguage,
  useDeleteLanguage,
} from '@/hooks/useSupportedLanguages';

// Global cleanup after each test
afterEach(() => {
  cleanup();
});

describe('useSupportedLanguages', () => {
  beforeEach(() => {
    hoisted.rpcMock.mockReset();
  });

  it('fetches languages (activeOnly=false) via get_all_supported_languages RPC', async () => {
    const data = [
      {
        code: 'cs',
        name_native: 'Čeština',
        name_key: 'languages.czech',
        is_active: true,
        is_default: true,
        sort_order: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    hoisted.rpcMock.mockResolvedValue({ data, error: null });

    const { result } = renderHookWithProviders(() => useSupportedLanguages(false));

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
      expect(result.current.data).toEqual(data);
    });

    expect(hoisted.rpcMock).toHaveBeenCalledWith('get_all_supported_languages');
  });

  it('fetches only active languages via get_supported_languages RPC when activeOnly=true', async () => {
    const activeData = [
      {
        code: 'cs',
        name_native: 'Čeština',
        name_key: 'languages.czech',
        is_active: true,
        is_default: true,
        sort_order: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    hoisted.rpcMock.mockResolvedValue({ data: activeData, error: null });

    const { result } = renderHookWithProviders(() => useSupportedLanguages(true));

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(hoisted.rpcMock).toHaveBeenCalledWith('get_supported_languages');
  });

  it('create/update/delete invalidate supported-languages queries', async () => {
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const createdLanguage = {
      code: 'sk',
      name_native: 'Slovenčina',
      name_key: 'languages.slovak',
      is_active: true,
      is_default: false,
      sort_order: 2,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const updatedLanguage = {
      ...createdLanguage,
      is_active: false,
    };

    // Mock for create_supported_language RPC (returns array)
    hoisted.rpcMock.mockResolvedValueOnce({ data: [createdLanguage], error: null });

    const { result: createResult } = renderHookWithProviders(() => useCreateLanguage(), { queryClient });

    await act(async () => {
      await createResult.current.mutateAsync({
        code: 'sk',
        name_native: 'Slovenčina',
        name_key: 'languages.slovak',
        is_active: true,
        is_default: false,
        sort_order: 2,
      });
    });

    expect(hoisted.rpcMock).toHaveBeenCalledWith('create_supported_language', {
      p_code: 'sk',
      p_name_native: 'Slovenčina',
      p_name_key: 'languages.slovak',
      p_is_active: true,
      p_is_default: false,
      p_sort_order: 2,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['supported-languages'] });

    // Reset for update test
    hoisted.rpcMock.mockReset();
    invalidateSpy.mockClear();

    // Mock for update_supported_language RPC (returns array)
    hoisted.rpcMock.mockResolvedValueOnce({ data: [updatedLanguage], error: null });

    const { result: updateResult } = renderHookWithProviders(() => useUpdateLanguage(), { queryClient });

    await act(async () => {
      await updateResult.current.mutateAsync({ code: 'sk', is_active: false });
    });

    expect(hoisted.rpcMock).toHaveBeenCalledWith('update_supported_language', {
      p_code: 'sk',
      p_name_native: undefined,
      p_name_key: undefined,
      p_is_active: false,
      p_is_default: undefined,
      p_sort_order: undefined,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['supported-languages'] });

    // Reset for delete test
    hoisted.rpcMock.mockReset();
    invalidateSpy.mockClear();

    // Mock for delete_supported_language RPC
    hoisted.rpcMock.mockResolvedValueOnce({ data: null, error: null });

    const { result: deleteResult } = renderHookWithProviders(() => useDeleteLanguage(), { queryClient });

    await act(async () => {
      await deleteResult.current.mutateAsync('sk');
    });

    expect(hoisted.rpcMock).toHaveBeenCalledWith('delete_supported_language', {
      p_code: 'sk',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['supported-languages'] });
  });
});
