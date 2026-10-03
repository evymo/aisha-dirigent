/**
 * @fileoverview Admin production quality hooks — deviations, CAPA, release decisions
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import type { Json } from "@/integrations/db/types";
import { usePermissions } from "../usePermissions";
import {
  parseRpcArraySafe,
  productionDeviationSchema,
  productionCapaSchema,
  productionReleaseDecisionSchema,
  type ProductionDeviation,
  type ProductionCapa,
  type ProductionReleaseDecision,
} from "./erpSchemas";

// ==================== Deviations ====================

/**
 * Hook for fetching production deviations.
 *
 * @param filters - Optional filters for batch_id, severity, status
 * @returns Query result with production deviations
 */
export function useProductionDeviationsAdmin(filters?: {
  batch_id?: string;
  severity?: string;
  status?: string;
}) {
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_dashboard");
  return useQuery({
    queryKey: ["admin-production-deviations", filters],
    queryFn: async (): Promise<ProductionDeviation[]> => {
      if (!canView) return [];
      const { data, error } = await aisha.rpc("get_production_deviations_admin", {
        p_batch_id: filters?.batch_id,
        p_severity: filters?.severity,
        p_status: filters?.status,
      });
      if (error) throw new Error(error.message);
      return parseRpcArraySafe(productionDeviationSchema, data, "productionDeviations");
    },
    enabled: canView,
  });
}

/**
 * Mutation hook for creating/updating production deviations.
 *
 * @returns Mutation for upserting a production deviation
 */
export function useUpsertProductionDeviationMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (deviation: Partial<ProductionDeviation> & {
      deviation_number: string;
      title: string;
      description: string;
    }) => {
      // Partial<DBRow>: coerce null → undefined for RPC arg compatibility.
      const { data, error } = await aisha.rpc("upsert_production_deviation_admin", {
        p_approved_by: deviation.approved_by ?? undefined,
        p_batch_id: deviation.batch_id ?? undefined,
        p_category: deviation.category ?? undefined,
        p_description: deviation.description,
        p_deviation_number: deviation.deviation_number,
        p_disposition: deviation.disposition ?? undefined,
        p_equipment_id: deviation.equipment_id ?? undefined,
        p_id: deviation.id ?? undefined,
        p_immediate_action: deviation.immediate_action ?? undefined,
        p_investigated_by: deviation.investigated_by ?? undefined,
        p_lot_id: deviation.lot_id ?? undefined,
        p_metadata: (deviation.metadata ?? undefined) as Json | undefined,
        p_notes: deviation.notes ?? undefined,
        p_root_cause: deviation.root_cause ?? undefined,
        p_severity: deviation.severity ?? "minor",
        p_status: deviation.status ?? "open",
        p_step_id: deviation.step_id ?? undefined,
        p_title: deviation.title,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-production-deviations"] });
    },
  });
}

// ==================== CAPA ====================

/**
 * Hook for fetching production CAPA records.
 *
 * @param filters - Optional filters for capa_type, source_deviation_id, status
 * @returns Query result with CAPA records
 */
export function useProductionCapaAdmin(filters?: {
  capa_type?: string;
  source_deviation_id?: string;
  status?: string;
}) {
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_dashboard");
  return useQuery({
    queryKey: ["admin-production-capa", filters],
    queryFn: async (): Promise<ProductionCapa[]> => {
      if (!canView) return [];
      const { data, error } = await aisha.rpc("get_production_capa_admin", {
        p_capa_type: filters?.capa_type,
        p_source_deviation_id: filters?.source_deviation_id,
        p_status: filters?.status,
      });
      if (error) throw new Error(error.message);
      return parseRpcArraySafe(productionCapaSchema, data, "productionCapa");
    },
    enabled: canView,
  });
}

/**
 * Mutation hook for creating/updating CAPA records.
 *
 * @returns Mutation for upserting a CAPA record
 */
export function useUpsertProductionCapaMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (capa: Partial<ProductionCapa> & {
      capa_number: string;
      title: string;
      description: string;
    }) => {
      // Partial<DBRow>: coerce null → undefined for RPC arg compatibility.
      const { data, error } = await aisha.rpc("upsert_production_capa_admin", {
        p_actions: (capa.actions ?? undefined) as Json | undefined,
        p_capa_number: capa.capa_number,
        p_capa_type: capa.capa_type ?? "corrective",
        p_description: capa.description,
        p_due_date: capa.due_date ?? undefined,
        p_effectiveness_check: (capa.effectiveness_check ?? undefined) as Json | undefined,
        p_id: capa.id ?? undefined,
        p_metadata: (capa.metadata ?? undefined) as Json | undefined,
        p_notes: capa.notes ?? undefined,
        p_owner_id: capa.owner_id ?? undefined,
        p_source_deviation_id: capa.source_deviation_id ?? undefined,
        p_status: capa.status ?? "open",
        p_title: capa.title,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-production-capa"] });
    },
  });
}

// ==================== Release Decisions ====================

/**
 * Hook for fetching production release decisions (immutable QA records).
 *
 * @param filters - Optional filters for batch_id, decision
 * @returns Query result with release decisions
 */
export function useProductionReleaseDecisionsAdmin(filters?: {
  batch_id?: string;
  decision?: string;
}) {
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_dashboard");
  return useQuery({
    queryKey: ["admin-production-release-decisions", filters],
    queryFn: async (): Promise<ProductionReleaseDecision[]> => {
      if (!canView) return [];
      const { data, error } = await aisha.rpc("get_production_release_decisions_admin", {
        p_batch_id: filters?.batch_id,
        p_decision: filters?.decision,
      });
      if (error) throw new Error(error.message);
      return parseRpcArraySafe(productionReleaseDecisionSchema, data, "productionReleaseDecisions");
    },
    enabled: canView,
  });
}

/**
 * Mutation hook for creating release decisions (immutable — no update).
 *
 * @returns Mutation for creating a release decision
 */
export function useCreateProductionReleaseDecisionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (decision: {
      batch_id: string;
      decision: string;
      conditions?: string;
      linked_deviation_id?: string;
      metadata?: Json;
      reason?: string;
      review_checklist?: Json;
      review_notes?: string;
    }) => {
      const { data, error } = await aisha.rpc("create_production_release_decision_admin", {
        p_batch_id: decision.batch_id,
        p_conditions: decision.conditions,
        p_decision: decision.decision,
        p_linked_deviation_id: decision.linked_deviation_id,
        p_metadata: decision.metadata,
        p_reason: decision.reason,
        p_review_checklist: decision.review_checklist,
        p_review_notes: decision.review_notes,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-production-release-decisions"] });
    },
  });
}
