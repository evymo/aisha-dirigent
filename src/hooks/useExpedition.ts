import { useCallback, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useSession } from "./useSession";
import { safeError } from "@/lib/security/safeLogger";
import {
  parseRpcArray,
  parseRpcResponse,
  expeditionCalendarEntrySchema,
  expeditionPlanSchema,
  batchAvailabilitySchema,
  batchAllocationResultSchema,
  batchInventoryItemSchema,
} from "@/lib/validation/rpcSchemas.admin";

// ============================================================================
// Types (re-export from schema for backwards compatibility)
// ============================================================================

export type {
  ExpeditionCalendarEntryValidated as ExpeditionCalendarEntry,
  ExpeditionPlanValidated as ExpeditionPlan,
  BatchAvailabilityValidated as BatchAvailability,
  BatchAllocationResultValidated as BatchAllocationResult,
  BatchInventoryItemValidated as BatchInventoryItem,
} from "@/lib/validation/rpcSchemas.admin";

// ============================================================================
// Hook: useExpeditionCalendar
// ============================================================================

/**
 * Hook to fetch expedition calendar overview and generate plans.
 *
 * @param startDate - Optional start date filter.
 * @param endDate - Optional end date filter.
 * @returns Query object with calendar data and generatePlan mutation.
 */
export function useExpeditionCalendar(startDate?: Date, endDate?: Date) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["expedition-calendar", startDate?.toISOString(), endDate?.toISOString()],
    queryFn: async () => {
      const { data, error } = await aisha.rpc("get_expedition_overview_audited", {
        p_end_date: endDate?.toISOString().split("T")[0] ?? undefined
,
        p_start_date: startDate?.toISOString().split("T")[0] ?? undefined
    });

      if (error) throw new Error(error.message);
      return parseRpcArray(expeditionCalendarEntrySchema, data, "get_expedition_overview_audited");
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const generatePlan = useMutation({
    mutationFn: async ({ 
      expeditionDate, 
      cutOffDate 
    }: { 
      expeditionDate: Date; 
      cutOffDate?: Date;
    }) => {
      const { data, error } = await aisha.rpc("generate_expedition_plan", {
        p_cut_off_date: cutOffDate?.toISOString().split("T")[0] ?? undefined
,
        p_expedition_date: expeditionDate.toISOString().split("T")[0]
    });

      if (error) throw new Error(error.message);
      return parseRpcResponse(expeditionPlanSchema, data, "generate_expedition_plan");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expedition-calendar"] });
    },
    onError: (error) => {
      safeError("useExpedition.generatePlan", error);
    },
  });

  return {
    ...query,
    generatePlan,
    refresh: () => queryClient.invalidateQueries({ queryKey: ["expedition-calendar"] }),
  };
}

// ============================================================================
// Hook: useBatchAvailability
// ============================================================================

/**
 * Hook to check batch availability for a product.
 *
 * @returns Object containing availability data, loading state, error, and check function.
 */
export function useBatchAvailability() {
  const { user } = useSession();
  const [availability, setAvailability] = useState<ReturnType<typeof batchAvailabilitySchema.parse> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const checkAvailability = useCallback(async (productId: string, quantity: number) => {
    if (!user?.id) {
      throw new Error("Not authenticated");
    }
    
    setLoading(true);
    setError(null);
    
    try {
      const { data, error: rpcError } = await aisha.rpc("check_batch_availability", {
        p_product_id: productId,
        p_quantity: quantity,
      });

      if (rpcError) throw rpcError;
      
      const validated = parseRpcResponse(batchAvailabilitySchema, data, "check_batch_availability");
      setAvailability(validated);
      return validated;
    } catch (err) {
      const e = err instanceof Error ? err : new Error("Unknown error");
      setError(e);
      safeError("useExpedition.checkAvailability", e);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  return {
    availability,
    loading,
    error,
    checkAvailability,
    isAuthenticated: !!user?.id,
  };
}
/**
 * Hook to allocate batches for a shipment.
 *
 * @returns Object containing allocate function, loading state, and error.
 */

// ============================================================================
// Hook: useBatchAllocation
// ============================================================================

export function useBatchAllocation() {
  const queryClient = useQueryClient();

  const allocateMutation = useMutation({
    mutationFn: async ({
      shipmentId,
      productId,
      quantity,
    }: {
      shipmentId: string;
      productId: string;
      quantity: number;
    }) => {
      const { data, error } = await aisha.rpc("allocate_batch_for_shipment", {
        p_product_id: productId,
        p_quantity: quantity
,
        p_shipment_id: shipmentId
    });

      if (error) throw new Error(error.message);
      return parseRpcResponse(batchAllocationResultSchema, data, "allocate_batch_for_shipment");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shipment-records"] });
      queryClient.invalidateQueries({ queryKey: ["expedition-calendar"] });
      queryClient.invalidateQueries({ queryKey: ["batch-inventory"] });
    },
    onError: (error) => {
      safeError("Failed to allocate batch", error);
    },
  });

  return {
    allocate: allocateMutation.mutateAsync,
    isAllocating: allocateMutation.isPending,
    error: allocateMutation.error,
  };
}
/**
 * Hook to fetch batch inventory list.
 *
 * @param productId - Optional product ID filter.
 * @param status - Optional status filter.
 * @param includeEmpty - Whether to include empty batches (default: false).
 * @returns Query object with batches list and refresh function.
 */

// ============================================================================
// Hook: useBatchInventory (for inventory view)
// ============================================================================

export function useBatchInventory(productId?: string, status?: string, includeEmpty = false) {
  const query = useQuery({
    queryKey: ["batch-inventory", productId, status, includeEmpty],
    queryFn: async () => {
      const { data, error } = await aisha.rpc("get_batch_inventory_list", {
        p_include_empty: includeEmpty
,
        p_product_id: productId ?? undefined,
        p_status: status ?? undefined
    });

      if (error) throw new Error(error.message);
      return parseRpcArray(batchInventoryItemSchema, data, "get_batch_inventory_list");
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  return {
    ...query,
    batches: query.data || [],
    refresh: query.refetch,
  };
}
