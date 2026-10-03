import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor } from '@testing-library/react';

import { renderHookWithProviders } from '@/tests/utils/test-utils';

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
  getBiomarkerStatus,
  getStatusColor,
  useAllBiomarkerReferenceRanges,
  useBiomarkerReferenceRanges,
  useCreateBiomarkerReferenceRange,
  useDeleteBiomarkerReferenceRange,
  useUpdateBiomarkerReferenceRange,
} from '@/hooks/useBiomarkerReferenceRanges';

describe('useBiomarkerReferenceRanges', () => {
  beforeEach(() => {
    hoisted.rpcMock.mockReset();
  });

  it('načte pouze aktivní rozsahy', async () => {
    hoisted.rpcMock.mockResolvedValueOnce({ data: [{ id: 'b1' }], error: null });

    const { result } = renderHookWithProviders(() => useBiomarkerReferenceRanges());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(hoisted.rpcMock).toHaveBeenCalledWith('get_biomarker_reference_ranges', { p_active_only: true });
    expect(result.current.data).toEqual([{ id: 'b1' }]);
  });

  it('načte všechny rozsahy', async () => {
    hoisted.rpcMock.mockResolvedValueOnce({ data: [{ id: 'b1' }, { id: 'b2' }], error: null });

    const { result } = renderHookWithProviders(() => useAllBiomarkerReferenceRanges());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(hoisted.rpcMock).toHaveBeenCalledWith('get_biomarker_reference_ranges', { p_active_only: false });
    expect(result.current.data).toEqual([{ id: 'b1' }, { id: 'b2' }]);
  });

  it('create invaliduje queries', async () => {
    hoisted.rpcMock.mockResolvedValueOnce({ data: 'new-id', error: null });

    const { queryClient } = renderHookWithProviders(() => ({ ok: true }));
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result: createResult } = renderHookWithProviders(() => useCreateBiomarkerReferenceRange(), { queryClient });
    await createResult.current.mutateAsync({
      biomarker_key: 'k',
      name_key: 'biomarkers.k',
      unit: 'u',
      min_value: null,
      max_value: null,
      optimal_min: null,
      optimal_max: null,
      critical_low: null,
      critical_high: null,
      category: 'c',
      description_key: null,
      is_active: true,
    });

    expect(hoisted.rpcMock).toHaveBeenCalledWith('create_biomarker_reference_range', expect.objectContaining({
      p_biomarker_key: 'k',
      p_name_key: 'biomarkers.k',
      p_unit: 'u',
      p_category: 'c',
      p_is_active: true,
    }));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['biomarker-reference-ranges'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['biomarker-reference-ranges-all'] });
  });

  it('update invaliduje queries', async () => {
    hoisted.rpcMock.mockResolvedValueOnce({ data: null, error: null });

    const { queryClient } = renderHookWithProviders(() => ({ ok: true }));
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result: updateResult } = renderHookWithProviders(() => useUpdateBiomarkerReferenceRange(), { queryClient });
    await updateResult.current.mutateAsync({ id: 'b1', is_active: false });

    expect(hoisted.rpcMock).toHaveBeenCalledWith('update_biomarker_reference_range', expect.objectContaining({
      p_id: 'b1',
      p_is_active: false,
    }));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['biomarker-reference-ranges'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['biomarker-reference-ranges-all'] });
  });

  it('delete invaliduje queries', async () => {
    hoisted.rpcMock.mockResolvedValueOnce({ data: null, error: null });

    const { queryClient } = renderHookWithProviders(() => ({ ok: true }));
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result: deleteResult } = renderHookWithProviders(() => useDeleteBiomarkerReferenceRange(), { queryClient });
    await deleteResult.current.mutateAsync('b1');

    expect(hoisted.rpcMock).toHaveBeenCalledWith('delete_biomarker_reference_range', { p_id: 'b1' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['biomarker-reference-ranges'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['biomarker-reference-ranges-all'] });
  });

  it('zpracuje chybu při načítání', async () => {
    hoisted.rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'DB error' } });

    const { result } = renderHookWithProviders(() => useBiomarkerReferenceRanges());
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBeDefined();
  });
});

describe('biomarker status helpers', () => {
  const baseRange = {
    id: 'b1',
    biomarker_key: 'k',
    name_key: 'biomarkers.n',
    unit: 'u',
    min_value: 10,
    max_value: 20,
    optimal_min: 12,
    optimal_max: 18,
    critical_low: 5,
    critical_high: 30,
    category: 'c',
    description_key: null,
    is_active: true,
    created_at: '2025-01-01',
    updated_at: '2025-01-01',
  };

  it('vrací unknown pro null/undefined', () => {
    expect(getBiomarkerStatus(null, baseRange as never)).toBe('unknown');
    expect(getBiomarkerStatus(10, undefined)).toBe('unknown');
  });

  it('kritické hodnoty mají prioritu', () => {
    expect(getBiomarkerStatus(4, baseRange as never)).toBe('critical');
    expect(getBiomarkerStatus(31, baseRange as never)).toBe('critical');
  });

  it('mimo normu je warning', () => {
    expect(getBiomarkerStatus(9, baseRange as never)).toBe('warning');
    expect(getBiomarkerStatus(21, baseRange as never)).toBe('warning');
  });

  it('v optimu je optimal, jinak normal', () => {
    expect(getBiomarkerStatus(15, baseRange as never)).toBe('optimal');
    expect(getBiomarkerStatus(11, baseRange as never)).toBe('normal');
  });

  it('status -> barva je deterministická', () => {
    expect(getStatusColor('critical')).toContain('destructive');
    expect(getStatusColor('warning')).toContain('warning');
    expect(getStatusColor('optimal')).toContain('success');
    expect(getStatusColor('normal')).toContain('primary');
    expect(getStatusColor('unknown')).toContain('muted-foreground');
  });
});
