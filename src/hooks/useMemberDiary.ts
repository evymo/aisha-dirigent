/**
 * Member Diary Hooks
 * React Query hooks for member products, health states, and dashboard
 * Uses RPC-only pattern with Zod validation
 */

import { useQuery, useMutation, useQueryClient, queryOptions } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError, safeInfo } from "@/lib/security/safeLogger";
import { useSession } from "@/hooks/useSession";
import { parseRpcArray } from "@/lib/validation/rpcSchemas";
import {
  memberProductSchema,
  memberTrackingStateSchema,
  memberProductPlanSchema,
  memberDashboardWidgetSchema,
  memberDiaryCalendarResponseSchema,
  memberPartnerDiaryViewSchema,
  distributionHistoryItemSchema,
  type MemberProduct,
  type MemberTrackingState,
  type MemberProductPlan,
  type MemberDashboardWidget,
  type MemberDiaryCalendarResponse,
  type MemberPartnerDiaryView,
  type DistributionHistoryItem,
  type CreateProductInput,
  type CreateTrackingStateInput,
  type LogTrackingStateInput,
  type CreateProductPlanInput,
  type ConfirmProductTakenInput,
  type UpdateProductLogInput,
} from "@/lib/schemas/memberDiarySchemas";
import { format, startOfMonth } from "date-fns";
import { Json } from "@/integrations/db/types";

// =====================================================
// QUERY OPTIONS
// =====================================================

export const memberProductsQueryOptions = queryOptions({
  queryKey: ["member", "products"],
  queryFn: async (): Promise<MemberProduct[]> => {
    const { data, error } = await aisha.rpc("get_my_products_audited");

    if (error) {
      safeError("member.diary.productsFetchFailed", error);
      throw new Error(error.message);
    }

    return parseRpcArray(memberProductSchema, data, "get_my_products_audited");
  },
});

export const memberTrackingStatesQueryOptions = queryOptions({
  queryKey: ["member", "health-states"],
  queryFn: async (): Promise<MemberTrackingState[]> => {
    const { data, error } = await aisha.rpc("get_my_health_states_audited");

    if (error) {
      safeError("member.diary.healthStatesFetchFailed", error);
      throw new Error(error.message);
    }

    return parseRpcArray(memberTrackingStateSchema, data, "get_my_health_states_audited");
  },
});

export const memberProductPlansQueryOptions = queryOptions({
  queryKey: ["member", "product-plans"],
  queryFn: async (): Promise<MemberProductPlan[]> => {
    const { data, error } = await aisha.rpc("get_my_product_plans_audited");

    if (error) {
      safeError("member.diary.plansFetchFailed", error);
      throw new Error(error.message);
    }

    return parseRpcArray(memberProductPlanSchema, data, "get_my_product_plans_audited");
  },
});

export const memberDashboardWidgetsQueryOptions = queryOptions({
  queryKey: ["member", "dashboard-widgets"],
  queryFn: async (): Promise<MemberDashboardWidget[]> => {
    const { data, error } = await aisha.rpc("get_member_dashboard_widgets_audited");

    if (error) {
      safeError("member.diary.widgetsFetchFailed", error);
      throw new Error(error.message);
    }

    return parseRpcArray(memberDashboardWidgetSchema, data, "get_member_dashboard_widgets_audited");
  },
});

export const distributionHistoryQueryOptions = queryOptions({
  queryKey: ["member", "distribution-history"],
  queryFn: async (): Promise<DistributionHistoryItem[]> => {
    const { data, error } = await aisha.rpc("get_my_distribution_history_audited");

    if (error) {
      safeError("member.diary.distributionHistoryFetchFailed", error);
      throw new Error(error.message);
    }

    return parseRpcArray(distributionHistoryItemSchema, data, "get_my_distribution_history_audited");
  },
});

// =====================================================
// HOOKS
// =====================================================

/**
 * Fetch user's products (own + public community products)
 */
export function useMemberProducts() {
  return useQuery(memberProductsQueryOptions);
}

/**
 * Fetch user's health states with current severity
 */
export function useMemberTrackingStates() {
  return useQuery(memberTrackingStatesQueryOptions);
}

/**
 * Fetch user's product plans
 */
export function useMemberProductPlans() {
  return useQuery(memberProductPlansQueryOptions);
}

/**
 * Fetch user's dashboard widget configuration
 */
export function useMemberDashboardWidgets() {
  return useQuery(memberDashboardWidgetsQueryOptions);
}

/**
 * Fetch user's distribution history.
 */
export function useMemberDistributionHistory() {
  return useQuery(distributionHistoryQueryOptions);
}

/**
 * Fetch diary calendar data for a specific month
 */
export function useMemberDiaryCalendar(month: Date) {
  const monthStr = format(startOfMonth(month), "yyyy-MM-dd");

  return useQuery({
    queryKey: ["member", "diary-calendar", monthStr],
    queryFn: async (): Promise<MemberDiaryCalendarResponse> => {
      const { data, error } = await aisha.rpc("get_member_diary_calendar_audited", {
        p_month: monthStr,
      });

      if (error) {
        safeError("member.diary.calendarFetchFailed", error);
        throw new Error(error.message);
      }

      // RPC returns JSONB, validate it
      const parsed = memberDiaryCalendarResponseSchema.safeParse(data);
      if (!parsed.success) {
        safeError("member.diary.calendarValidationFailed", parsed.error);
        // Return empty structure
        return { month: monthStr.slice(0, 7), days: [], distributions: [] };
      }

      return parsed.data;
    },
  });
}

/**
 * Fetch member diary for partner (read-only with consent)
 */
export function useMemberDiaryForPartner(memberId: string | undefined) {
  return useQuery({
    queryKey: ["partner", "member-diary", memberId],
    queryFn: async (): Promise<MemberPartnerDiaryView | null> => {
      if (!memberId) return null;

      const { data, error } = await aisha.rpc("get_member_diary_for_partner_audited", {
        p_member_id: memberId,
      });

      if (error) {
        safeError("partner.memberDiaryFetchFailed", error);
        throw new Error(error.message);
      }

      if (!data) {
        return null;
      }

      // RPC returns JSONB - validate it
      const parsed = memberPartnerDiaryViewSchema.safeParse(data);
      if (!parsed.success) {
        safeError("partner.memberDiaryValidationFailed", parsed.error);
        return null;
      }

      return parsed.data;
    },
    enabled: !!memberId,
  });
}

// =====================================================
// MUTATIONS
// =====================================================

/**
 * Create a new product
 */
export function useCreateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateProductInput): Promise<string> => {
      const { data, error } = await aisha.rpc("create_member_product_audited", {
        p_category: input.category,
        p_default_dose_amount: input.default_dose_amount,
        p_default_dose_timing: input.default_dose_timing,
        p_default_dose_unit: input.default_dose_unit,
        p_default_doses_per_day: input.default_doses_per_day,
        p_description: input.description,
        p_is_public: input.is_public,
        p_name: input.name,
        p_package_size: input.package_size,
        p_package_unit: input.package_unit,
      });

      if (error) {
        safeError("member.diary.createProductFailed", error);
        throw new Error(error.message);
      }

      safeInfo("member.diary.productCreated", { id: data });
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["member", "products"] });
    },
  });
}

/**
 * Create a new health state
 * Requires authenticated user session
 */
export function useCreateTrackingState() {
  const { user } = useSession();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateTrackingStateInput): Promise<string> => {
      if (!user) {
        throw new Error("Authentication required");
      }

      const { data, error } = await aisha.rpc("create_member_health_state_audited", {
        p_color: input.color,
        p_custom_name: input.custom_name,
        p_icon: input.icon,
        p_name_key: input.name_key,
        p_severity_scale: input.severity_scale,
        p_show_on_dashboard: input.show_on_dashboard,
      });

      if (error) {
        safeError("member.diary.createTrackingStateFailed", error);
        throw new Error(error.message);
      }

      safeInfo("member.diary.healthStateCreated", { id: data });
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["member", "health-states"] });
    },
  });
}

/**
 * Log a health state entry
 * Returns log_id and tokens_earned
 * Requires authenticated user session
 */
export function useLogTrackingState() {
  const { user } = useSession();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: LogTrackingStateInput): Promise<{ log_id: string; tokens_earned: number }> => {
      if (!user) {
        throw new Error("Authentication required");
      }

      const { data, error } = await aisha.rpc("log_health_state_audited", {
        p_ended_at: input.ended_at,
        p_notes: input.notes,
        p_severity: input.severity,
        p_started_at: input.started_at ?? new Date().toISOString(),
        p_state_id: input.state_id,
      });

      if (error) {
        safeError("member.diary.logTrackingStateFailed", error);
        throw new Error(error.message);
      }

      // Parse response - can be JSON string or object
      const result = typeof data === 'string' 
        ? JSON.parse(data) as { success: boolean; log_id: string; tokens_earned?: number }
        : (data as { success: boolean; log_id: string; tokens_earned?: number } | null);
      safeInfo("member.diary.healthStateLogged", { id: result?.log_id });
      return { 
        log_id: result?.log_id ?? '', 
        tokens_earned: result?.tokens_earned ?? 0 
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["member", "health-states"] });
      queryClient.invalidateQueries({ queryKey: ["member", "diary-calendar"] });
    },
  });
}

/**
 * Create a new product plan
 */
export function useCreateProductPlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateProductPlanInput): Promise<string> => {
      const { data, error } = await aisha.rpc("create_member_product_plan_audited", {
        p_catalog_product_id: input.catalog_product_id,
        p_custom_distribution_instructions: input.custom_distribution_instructions,
        p_dose_amount: input.dose_amount,
        p_dose_timing: input.dose_timing,
        p_dose_unit: input.dose_unit,
        p_doses_per_day: input.doses_per_day,
        p_notes: input.notes,
        p_package_quantity: input.package_quantity,
        p_product_id: input.product_id,
        p_protocol_id: input.protocol_id,
        p_reminder_enabled: input.reminder_enabled,
        p_reminder_minutes_before: input.reminder_minutes_before,
      });

      if (error) {
        safeError("member.diary.createPlanFailed", error);
        throw new Error(error.message);
      }

      safeInfo("member.diary.planCreated", { id: data });
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["member", "product-plans"] });
      queryClient.invalidateQueries({ queryKey: ["member", "products"] });
    },
  });
}

/**
 * Confirm that a product was taken
 * Allows specifying custom dose amount if different from plan
 * Returns log_id and tokens_earned
 */
export function useConfirmProductTaken() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: ConfirmProductTakenInput): Promise<{ log_id: string; tokens_earned: number }> => {
      const { data, error } = await aisha.rpc("confirm_product_taken_audited", {
        p_dose_taken: params.dose_taken,
        p_notes: params.notes,
        p_plan_id: params.plan_id,
        p_taken_at: params.taken_at ?? new Date().toISOString(),
      });

      if (error) {
        safeError("member.diary.confirmTakenFailed", error);
        throw new Error(error.message);
      }

      // Parse response - can be JSON string or object
      const result = typeof data === 'string'
        ? JSON.parse(data) as { success: boolean; log_id: string; tokens_earned?: number }
        : (data as { success: boolean; log_id: string; tokens_earned?: number } | null);
      safeInfo("member.diary.productConfirmed", { id: result?.log_id });
      return { 
        log_id: result?.log_id ?? '', 
        tokens_earned: result?.tokens_earned ?? 0 
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["member", "product-plans"] });
      queryClient.invalidateQueries({ queryKey: ["member", "diary-calendar"] });
    },
  });
}

/**
 * Update an existing product log (correct dose, time, or notes)
 */
export function useUpdateProductLog() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: UpdateProductLogInput): Promise<boolean> => {
      const { data, error } = await aisha.rpc("update_product_log_audited", {
        p_dose_taken: params.dose_taken,
        p_log_id: params.log_id,
        p_notes: params.notes,
        p_taken_at: params.taken_at,
      });

      if (error) {
        safeError("member.diary.updateLogFailed", error);
        throw new Error(error.message);
      }

      safeInfo("member.diary.logUpdated", { id: params.log_id });
      return Boolean(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["member", "product-plans"] });
      queryClient.invalidateQueries({ queryKey: ["member", "diary-calendar"] });
    },
  });
}

/**
 * Update widget position (for drag & drop)
 */
export function useUpdateWidgetPosition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      widgetId: string;
      position: { row: number; col: number; width?: number; height?: number };
    }): Promise<boolean> => {
      const { data, error } = await aisha.rpc("update_member_widget_position_audited", {
        p_position: params.position as unknown as Json,
        p_widget_id: params.widgetId,
      });

      if (error) {
        safeError("member.diary.updateWidgetFailed", error);
        throw new Error(error.message);
      }

      return data as boolean;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["member", "dashboard-widgets"] });
    },
  });
}

/**
 * Create a dashboard widget
 */
export function useCreateWidget() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      widgetType: "product" | "health_state" | "quick_log" | "calendar" | "distribution";
      referenceId?: string;
      position?: { row: number; col: number; width?: number; height?: number };
      settings?: Record<string, unknown>;
    }): Promise<string> => {
      const { data, error } = await aisha.rpc("create_member_widget_audited", {
        p_is_visible: true,
        p_position: (params.position ?? { row: 0, col: 0, width: 1, height: 1 }) as unknown as Json,
        p_reference_id: params.referenceId,
        p_settings: (params.settings ?? {}) as unknown as Json,
        p_widget_type: params.widgetType,
      });

      if (error) {
        safeError("member.diary.createWidgetFailed", error);
        throw new Error(error.message);
      }

      safeInfo("member.diary.widgetCreated", { id: data });
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["member", "dashboard-widgets"] });
    },
  });
}

// =====================================================
// COMBINED DATA HOOK
// =====================================================

/**
 * Get all member diary data at once
 */
export function useMemberDiaryData() {
  const products = useMemberProducts();
  const healthStates = useMemberTrackingStates();
  const plans = useMemberProductPlans();
  const widgets = useMemberDashboardWidgets();
  const distributions = useMemberDistributionHistory();

  return {
    products,
    healthStates,
    plans,
    widgets,
    distributions,
    isLoading:
      products.isLoading ||
      healthStates.isLoading ||
      plans.isLoading ||
      widgets.isLoading ||
      distributions.isLoading,
    isError:
      products.isError ||
      healthStates.isError ||
      plans.isError ||
      widgets.isError ||
      distributions.isError,
  };
}
