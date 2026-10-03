/**
 * useMemberDiary Hook Tests
 *
 * Tests for member diary hooks: products, health states,
 * product plans, distribution history, dashboard widgets,
 * calendar, and partner diary view.
 *
 * @see src/hooks/useMemberDiary.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import React from "react";

// ---------- mocks ----------

vi.mock("@/integrations/db/client", () => ({
  aisha: { rpc: vi.fn() },
}));

vi.mock("@/lib/security/safeLogger", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/security/safeLogger")>();
  return {
    ...actual,
    safeError: vi.fn(),
    safeInfo: vi.fn(),
    safeWarn: vi.fn(),
  };
});

const MOCK_USER_ID = "aaaaaaaa-1111-2222-3333-444444444444";

vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({
    user: { id: MOCK_USER_ID },
    session: { access_token: "test-token" },
  }),
}));

// ---------- helpers ----------

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { Wrapper, queryClient };
}

// ---------- lazy imports (after mocks) ----------

const importHooks = async () => import("@/hooks/useMemberDiary");

// ---------- fixtures ----------

const PRODUCT_ROW = {
  category: "product",
  created_at: "2026-01-01T00:00:00Z",
  created_by: MOCK_USER_ID,
  default_dose_amount: 500,
  default_dose_timing: ["morning"],
  default_dose_unit: "mg",
  default_doses_per_day: 1,
  description: "Test supp",
  id: "bbbbbbbb-1111-2222-3333-444444444444",
  is_public: false,
  name: "Vitamin C",
  package_size: 60,
  package_unit: "caps",
  usage_count: 3,
};

const HEALTH_STATE_ROW = {
  color: "#3b82f6",
  created_at: "2026-01-01T00:00:00Z",
  current_severity: 3,
  custom_name: null,
  dashboard_position: null,
  icon: "wind",
  id: "cccccccc-1111-2222-3333-444444444444",
  is_active: true,
  last_logged_at: "2026-01-15T00:00:00Z",
  name_key: "asthma",
  severity_scale: 5,
  show_on_dashboard: true,
  updated_at: "2026-01-15T00:00:00Z",
  user_id: MOCK_USER_ID,
};

const PRODUCT_PLAN_ROW = {
  created_at: "2026-01-01T00:00:00Z",
  custom_distribution_instructions: null,
  dose_amount: 500,
  dose_timing: ["08:00"],
  dose_unit: "mg",
  doses_per_day: 1,
  id: "dddddddd-1111-2222-3333-444444444444",
  is_active: true,
  last_taken_at: null,
  next_reminder_at: null,
  notes: null,
  package_quantity: 1,
  protocol_id: null,
  protocol_name: null,
  remaining_doses: 60,
  reminder_enabled: true,
  reminder_minutes_before: 15,
  reminder_mode: null,
  product_id: PRODUCT_ROW.id,
  product_name: "Vitamin C",
  updated_at: "2026-01-01T00:00:00Z",
  user_id: MOCK_USER_ID,
  last_distribution_date: null,
  last_distribution_vials: null,
};

const WIDGET_ROW = {
  created_at: "2026-01-01T00:00:00Z",
  id: "eeeeeeee-1111-2222-3333-444444444444",
  is_visible: true,
  position: { row: 0, col: 0, width: 1, height: 1 },
  reference_id: null,
  settings: null,
  updated_at: "2026-01-01T00:00:00Z",
  user_id: MOCK_USER_ID,
  widget_type: "product",
};

const DISTRIBUTION_ROW = {
  carrier: "DHL",
  created_at: "2026-01-10T00:00:00Z",
  delivered_at: "2026-01-12T00:00:00Z",
  id: "ffffffff-1111-2222-3333-444444444444",
  scheduled_date: "2026-01-11",
  shipped_at: "2026-01-10T12:00:00Z",
  status: "delivered",
  study_id: "11111111-1111-1111-1111-111111111111",
  study_name: "Study Alpha",
  tracking_number: "DHL12345",
  user_id: MOCK_USER_ID,
  vial_count: 4,
};

// ---------- Query hooks ----------

describe("useMemberProducts", () => {
  beforeEach(() => {
    vi.mocked(aisha.rpc).mockReset();
  });

  it("should fetch products via RPC", async () => {
    vi.mocked(aisha.rpc).mockResolvedValue({
      data: [PRODUCT_ROW],
      error: null,
    } as never);

    const { useMemberProducts } = await importHooks();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useMemberProducts(), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].name).toBe("Vitamin C");
    expect(vi.mocked(aisha.rpc)).toHaveBeenCalledWith(
      "get_my_products_audited",
    );
  });

  it("should return empty array on error", async () => {
    vi.mocked(aisha.rpc).mockResolvedValue({
      data: null,
      error: { message: "DB error", code: "500", details: "", hint: "" },
    } as never);

    const { useMemberProducts } = await importHooks();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useMemberProducts(), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useMemberTrackingStates", () => {
  beforeEach(() => {
    vi.mocked(aisha.rpc).mockReset();
  });

  it("should fetch health states via RPC", async () => {
    vi.mocked(aisha.rpc).mockResolvedValue({
      data: [HEALTH_STATE_ROW],
      error: null,
    } as never);

    const { useMemberTrackingStates } = await importHooks();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useMemberTrackingStates(), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].name_key).toBe("asthma");
  });
});

describe("useMemberProductPlans", () => {
  beforeEach(() => {
    vi.mocked(aisha.rpc).mockReset();
  });

  it("should fetch product plans via RPC", async () => {
    vi.mocked(aisha.rpc).mockResolvedValue({
      data: [PRODUCT_PLAN_ROW],
      error: null,
    } as never);

    const { useMemberProductPlans } = await importHooks();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useMemberProductPlans(), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].product_name).toBe("Vitamin C");
  });
});

describe("useMemberDashboardWidgets", () => {
  beforeEach(() => {
    vi.mocked(aisha.rpc).mockReset();
  });

  it("should fetch dashboard widgets via RPC", async () => {
    vi.mocked(aisha.rpc).mockResolvedValue({
      data: [WIDGET_ROW],
      error: null,
    } as never);

    const { useMemberDashboardWidgets } = await importHooks();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useMemberDashboardWidgets(), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].widget_type).toBe("product");
  });
});

describe("useMemberDistributionHistory", () => {
  beforeEach(() => {
    vi.mocked(aisha.rpc).mockReset();
  });

  it("should fetch distribution history via RPC", async () => {
    vi.mocked(aisha.rpc).mockResolvedValue({
      data: [DISTRIBUTION_ROW],
      error: null,
    } as never);

    const { useMemberDistributionHistory } = await importHooks();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useMemberDistributionHistory(), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].tracking_number).toBe("DHL12345");
    expect(vi.mocked(aisha.rpc)).toHaveBeenCalledWith(
      "get_my_distribution_history_audited",
    );
  });
});

describe("useMemberDiaryCalendar", () => {
  beforeEach(() => {
    vi.mocked(aisha.rpc).mockReset();
  });

  it("should fetch calendar data via RPC and parse JSON", async () => {
    const calendarData = {
      month: "2026-01",
      days: [
        {
          date: "2026-01-15",
          products_taken: 2,
          states_logged: 1,
          has_active_issues: false,
          distribution_received: false,
        },
      ],
      distributions: [],
    };

    vi.mocked(aisha.rpc).mockResolvedValue({
      data: calendarData,
      error: null,
    } as never);

    const { useMemberDiaryCalendar } = await importHooks();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => useMemberDiaryCalendar(new Date("2026-01-15")),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.month).toBe("2026-01");
    expect(result.current.data?.days).toHaveLength(1);
    expect(vi.mocked(aisha.rpc)).toHaveBeenCalledWith(
      "get_member_diary_calendar_audited",
      expect.objectContaining({ p_month: expect.stringContaining("2026-01") }),
    );
  });

  it("should return empty structure when data is null", async () => {
    vi.mocked(aisha.rpc).mockResolvedValue({
      data: null,
      error: null,
    } as never);

    const { useMemberDiaryCalendar } = await importHooks();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => useMemberDiaryCalendar(new Date("2026-01-15")),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Null data fails Zod validation → fallback empty structure
    expect(result.current.data?.days).toEqual([]);
    expect(result.current.data?.distributions).toEqual([]);
  });
});

// ---------- Mutation hooks ----------

describe("useCreateProduct", () => {
  beforeEach(() => {
    vi.mocked(aisha.rpc).mockReset();
  });

  it("should call create_product_audited RPC", async () => {
    vi.mocked(aisha.rpc).mockResolvedValue({
      data: "new-product-id",
      error: null,
    } as never);

    const { useCreateProduct } = await importHooks();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateProduct(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({
        name: "Zinc",
        category: "product",
        default_dose_amount: 25,
        default_dose_unit: "mg",
        default_doses_per_day: 1,
        default_dose_timing: ["morning"],
        is_public: false,
      });
    });

    expect(vi.mocked(aisha.rpc)).toHaveBeenCalledWith(
      "create_member_product_audited",
      expect.objectContaining({
        p_name: "Zinc",
        p_category: "product",
        p_default_dose_amount: 25,
      }),
    );
  });

  it("should throw on RPC error without exposing sensitive data", async () => {
    vi.mocked(aisha.rpc).mockResolvedValue({
      data: null,
      error: { message: "DB constraint", code: "23505", details: "", hint: "" },
    } as never);

    const { useCreateProduct } = await importHooks();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateProduct(), {
      wrapper: Wrapper,
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          name: "Zinc",
          category: "product",
          default_dose_amount: 25,
          default_dose_unit: "mg",
          default_doses_per_day: 1,
          default_dose_timing: ["morning"],
          is_public: false,
        });
      }),
    ).rejects.toThrow("DB constraint");
  });
});

describe("useCreateTrackingState", () => {
  beforeEach(() => {
    vi.mocked(aisha.rpc).mockReset();
  });

  it("should call create_health_state_audited RPC", async () => {
    vi.mocked(aisha.rpc).mockResolvedValue({
      data: "new-state-id",
      error: null,
    } as never);

    const { useCreateTrackingState } = await importHooks();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateTrackingState(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({
        name_key: "headache",
        severity_scale: 5,
        icon: "brain",
        color: "#8b5cf6",
        show_on_dashboard: true,
      });
    });

    expect(vi.mocked(aisha.rpc)).toHaveBeenCalledWith(
      "create_member_health_state_audited",
      expect.objectContaining({
        p_name_key: "headache",
        p_severity_scale: 5,
        p_icon: "brain",
      }),
    );
  });
});

describe("useLogTrackingState", () => {
  beforeEach(() => {
    vi.mocked(aisha.rpc).mockReset();
  });

  it("should call log_health_state_audited RPC", async () => {
    vi.mocked(aisha.rpc).mockResolvedValue({
      data: { success: true, log_id: "new-log-id", tokens_earned: 3 },
      error: null,
    } as never);

    const { useLogTrackingState } = await importHooks();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useLogTrackingState(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({
        state_id: HEALTH_STATE_ROW.id,
        severity: 4,
      });
    });

    expect(vi.mocked(aisha.rpc)).toHaveBeenCalledWith(
      "log_health_state_audited",
      expect.objectContaining({
        p_state_id: HEALTH_STATE_ROW.id,
        p_severity: 4,
      }),
    );
  });
});

describe("useConfirmProductTaken", () => {
  beforeEach(() => {
    vi.mocked(aisha.rpc).mockReset();
  });

  it("should call confirm_product_taken_audited and parse response", async () => {
    vi.mocked(aisha.rpc).mockResolvedValue({
      data: { success: true, log_id: "log-123", tokens_earned: 5 },
      error: null,
    } as never);

    const { useConfirmProductTaken } = await importHooks();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useConfirmProductTaken(), {
      wrapper: Wrapper,
    });

    let res: { log_id: string; tokens_earned: number } | undefined;
    await act(async () => {
      res = await result.current.mutateAsync({
        plan_id: PRODUCT_PLAN_ROW.id,
        dose_taken: 500,
      });
    });

    expect(res?.log_id).toBe("log-123");
    expect(res?.tokens_earned).toBe(5);
    expect(vi.mocked(aisha.rpc)).toHaveBeenCalledWith(
      "confirm_product_taken_audited",
      expect.objectContaining({
        p_plan_id: PRODUCT_PLAN_ROW.id,
        p_dose_taken: 500,
      }),
    );
  });

  it("should parse JSON string response format", async () => {
    // Some DB versions return stringified JSON
    vi.mocked(aisha.rpc).mockResolvedValue({
      data: JSON.stringify({ success: true, log_id: "log-456", tokens_earned: 10 }),
      error: null,
    } as never);

    const { useConfirmProductTaken } = await importHooks();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useConfirmProductTaken(), {
      wrapper: Wrapper,
    });

    let res: { log_id: string; tokens_earned: number } | undefined;
    await act(async () => {
      res = await result.current.mutateAsync({
        plan_id: PRODUCT_PLAN_ROW.id,
      });
    });

    expect(res?.log_id).toBe("log-456");
    expect(res?.tokens_earned).toBe(10);
  });
});

describe("useUpdateProductLog", () => {
  beforeEach(() => {
    vi.mocked(aisha.rpc).mockReset();
  });

  it("should call update_product_log_audited RPC", async () => {
    vi.mocked(aisha.rpc).mockResolvedValue({
      data: true,
      error: null,
    } as never);

    const { useUpdateProductLog } = await importHooks();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateProductLog(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({
        log_id: "log-123",
        dose_taken: 250,
        notes: "Half dose today",
      });
    });

    expect(vi.mocked(aisha.rpc)).toHaveBeenCalledWith(
      "update_product_log_audited",
      expect.objectContaining({
        p_log_id: "log-123",
        p_dose_taken: 250,
        p_notes: "Half dose today",
      }),
    );
  });
});

describe("useUpdateWidgetPosition", () => {
  beforeEach(() => {
    vi.mocked(aisha.rpc).mockReset();
  });

  it("should call update_member_widget_position_audited RPC", async () => {
    vi.mocked(aisha.rpc).mockResolvedValue({
      data: true,
      error: null,
    } as never);

    const { useUpdateWidgetPosition } = await importHooks();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateWidgetPosition(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({
        widgetId: WIDGET_ROW.id,
        position: { row: 1, col: 2, width: 2, height: 1 },
      });
    });

    expect(vi.mocked(aisha.rpc)).toHaveBeenCalledWith(
      "update_member_widget_position_audited",
      expect.objectContaining({
        p_widget_id: WIDGET_ROW.id,
        p_position: { row: 1, col: 2, width: 2, height: 1 },
      }),
    );
  });
});

describe("useCreateWidget", () => {
  beforeEach(() => {
    vi.mocked(aisha.rpc).mockReset();
  });

  it("should call create_member_widget_audited RPC", async () => {
    vi.mocked(aisha.rpc).mockResolvedValue({
      data: "new-widget-id",
      error: null,
    } as never);

    const { useCreateWidget } = await importHooks();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateWidget(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({
        widgetType: "calendar",
        position: { row: 0, col: 0 },
      });
    });

    expect(vi.mocked(aisha.rpc)).toHaveBeenCalledWith(
      "create_member_widget_audited",
      expect.objectContaining({
        p_widget_type: "calendar",
        p_is_visible: true,
      }),
    );
  });
});

// ---------- Composite hook ----------

describe("useMemberDiaryData", () => {
  beforeEach(() => {
    vi.mocked(aisha.rpc).mockReset();
  });

  it("should aggregate loading state from all sub-hooks", async () => {
    // All RPCs return empty arrays
    vi.mocked(aisha.rpc).mockResolvedValue({
      data: [],
      error: null,
    } as never);

    const { useMemberDiaryData } = await importHooks();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useMemberDiaryData(), {
      wrapper: Wrapper,
    });

    // Initially loading
    expect(result.current.isLoading).toBe(true);

    // Wait for queries to settle
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isError).toBe(false);
  });

  it("should aggregate error state when any sub-hook fails", async () => {
    let callCount = 0;
    vi.mocked(aisha.rpc).mockImplementation((() => {
      callCount++;
      // Fail the second call (health states)
      if (callCount === 2) {
        return Promise.resolve({
          data: null,
          error: { message: "fail", code: "500", details: "", hint: "" },
        });
      }
      return Promise.resolve({ data: [], error: null });
    }) as never);

    const { useMemberDiaryData } = await importHooks();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useMemberDiaryData(), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isError).toBe(true);
  });
});

// ---------- Zod validation ----------

describe("parseRpcArray validation", () => {
  beforeEach(() => {
    vi.mocked(aisha.rpc).mockReset();
  });

  it("should silently drop rows with invalid schema fields", async () => {
    const invalidRow = { ...PRODUCT_ROW, id: "not-a-uuid" };
    vi.mocked(aisha.rpc).mockResolvedValue({
      data: [PRODUCT_ROW, invalidRow],
      error: null,
    } as never);

    const { useMemberProducts } = await importHooks();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useMemberProducts(), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Only valid row survives parseRpcArray safeParse
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].id).toBe(PRODUCT_ROW.id);
  });
});

// ---------- Partner diary view ----------

describe("useMemberDiaryForPartner", () => {
  beforeEach(() => {
    vi.mocked(aisha.rpc).mockReset();
  });

  it("should fetch partner diary view via RPC", async () => {
    const partnerView = {
      health_logs: [],
      health_states: [],
      product_logs: [],
      product_plans: [],
    };

    vi.mocked(aisha.rpc).mockResolvedValue({
      data: partnerView,
      error: null,
    } as never);

    const { useMemberDiaryForPartner } = await importHooks();
    const { Wrapper } = createWrapper();
    const memberId = "22222222-aaaa-bbbb-cccc-dddddddddddd";
    const { result } = renderHook(
      () => useMemberDiaryForPartner(memberId),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeDefined();
    expect(vi.mocked(aisha.rpc)).toHaveBeenCalledWith(
      "get_member_diary_for_partner_audited",
      expect.objectContaining({ p_member_id: memberId }),
    );
  });

  it("should be disabled when memberId is undefined", async () => {
    const { useMemberDiaryForPartner } = await importHooks();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => useMemberDiaryForPartner(undefined as unknown as string),
      { wrapper: Wrapper },
    );

    // Should not fetch
    expect(result.current.isFetching).toBe(false);
    expect(vi.mocked(aisha.rpc)).not.toHaveBeenCalled();
  });
});
