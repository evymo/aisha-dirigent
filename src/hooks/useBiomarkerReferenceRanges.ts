import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { aisha } from '@/integrations/db/client';

export interface BiomarkerReferenceRange {
  id: string;
  biomarker_key: string;
  name_key: string;
  unit: string;
  min_value: number | null;
  max_value: number | null;
  optimal_min: number | null;
  optimal_max: number | null;
  critical_low: number | null;
  critical_high: number | null;
  category: string;
  description_key: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Hook to fetch active biomarker reference ranges.
 * Used for displaying reference values in charts and tables.
 *
 * @returns Query object containing list of active reference ranges.
 */
export const useBiomarkerReferenceRanges = () => {
  return useQuery({
    queryKey: ['biomarker-reference-ranges'],
    queryFn: async (): Promise<BiomarkerReferenceRange[]> => {
      // RPC-only: use get_biomarker_reference_ranges function
      const { data, error } = await aisha.rpc("get_biomarker_reference_ranges", {
        p_active_only: true,
      });

      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
};

/**
 * Hook to fetch all biomarker reference ranges (including inactive).
 * Used for admin management.
 *
 * @returns Query object containing list of all reference ranges.
 */
export const useAllBiomarkerReferenceRanges = () => {
  return useQuery({
    queryKey: ['biomarker-reference-ranges-all'],
    queryFn: async (): Promise<BiomarkerReferenceRange[]> => {
      // RPC-only: use get_biomarker_reference_ranges function with all
      const { data, error } = await aisha.rpc("get_biomarker_reference_ranges", {
        p_active_only: false,
      });

      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
};

/**
 * Hook to update an existing biomarker reference range.
 *
 * @returns Mutation object for updating a reference range.
 */
export const useUpdateBiomarkerReferenceRange = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<BiomarkerReferenceRange> & { id: string }) => {
      // RPC-only: use update_biomarker_reference_range function - use undefined for missing params
      const { error } = await aisha.rpc("update_biomarker_reference_range", {
        p_critical_high: updates.critical_high ?? undefined,
        p_critical_low: updates.critical_low ?? undefined,
        p_id: id,
        p_is_active: updates.is_active ?? undefined
,
        p_max_value: updates.max_value ?? undefined,
        p_min_value: updates.min_value ?? undefined,
        p_optimal_max: updates.optimal_max ?? undefined,
        p_optimal_min: updates.optimal_min ?? undefined
    });

      if (error) throw new Error(error.message);
      return { id, ...updates };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['biomarker-reference-ranges'] });
/**
 * Hook to create a new biomarker reference range.
 *
 * @returns Mutation object for creating a reference range.
 */
      queryClient.invalidateQueries({ queryKey: ['biomarker-reference-ranges-all'] });
    },
  });
};

export const useCreateBiomarkerReferenceRange = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (newRange: Omit<BiomarkerReferenceRange, 'id' | 'created_at' | 'updated_at'>) => {
      // RPC-only: use create_biomarker_reference_range function - use undefined for missing params
      const { data, error } = await aisha.rpc("create_biomarker_reference_range", {
        p_biomarker_key: newRange.biomarker_key,
        p_category: newRange.category,
        p_critical_high: newRange.critical_high ?? undefined,
        p_critical_low: newRange.critical_low ?? undefined,
        p_description_key: newRange.description_key ?? undefined,
        p_is_active: newRange.is_active
,
        p_max_value: newRange.max_value ?? undefined,
        p_min_value: newRange.min_value ?? undefined,
        p_name_key: newRange.name_key,
        p_optimal_max: newRange.optimal_max ?? undefined,
        p_optimal_min: newRange.optimal_min ?? undefined,
        p_unit: newRange.unit
    });

      if (error) throw new Error(error.message);
      return { id: data as string, ...newRange };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['biomarker-reference-ranges'] });
      queryClient.invalidateQueries({ queryKey: ['biomarker-reference-ranges-all'] });
    },
  });
};

export const useDeleteBiomarkerReferenceRange = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      // RPC-only: use delete_biomarker_reference_range function
      const { error } = await aisha.rpc("delete_biomarker_reference_range", {
        p_id: id,
      });

      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['biomarker-reference-ranges'] });
      queryClient.invalidateQueries({ queryKey: ['biomarker-reference-ranges-all'] });
    },
  });
};

// Helper function to get status of a value based on reference range
export const getBiomarkerStatus = (
  value: number | null,
  range: BiomarkerReferenceRange | undefined
): 'critical' | 'warning' | 'optimal' | 'normal' | 'unknown' => {
  if (value === null || value === undefined || !range) return 'unknown';

  // Check critical values first
  if (range.critical_low !== null && value < range.critical_low) return 'critical';
  if (range.critical_high !== null && value > range.critical_high) return 'critical';

  // Check if outside normal range
  if (range.min_value !== null && value < range.min_value) return 'warning';
  if (range.max_value !== null && value > range.max_value) return 'warning';

  // Check if in optimal range
  if (
    range.optimal_min !== null &&
    range.optimal_max !== null &&
    value >= range.optimal_min &&
    value <= range.optimal_max
  ) {
    return 'optimal';
  }

  // Within normal range but not optimal
  return 'normal';
};

export const getStatusColor = (status: ReturnType<typeof getBiomarkerStatus>): string => {
  switch (status) {
    case 'critical':
      return 'hsl(var(--destructive))';
    case 'warning':
      return 'hsl(var(--warning, 38 92% 50%))';
    case 'optimal':
      return 'hsl(var(--success, 142 76% 36%))';
    case 'normal':
      return 'hsl(var(--primary))';
    default:
      return 'hsl(var(--muted-foreground))';
  }
};
