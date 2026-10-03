import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHookWithProviders } from "../utils/test-utils";
import { AdminPermissionError, useAdminGuard } from "@/hooks/useAdminGuard";

const hasPermissionMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasPermission: hasPermissionMock,
  }),
}));

describe("useAdminGuard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasPermissionMock.mockReturnValue(true);
  });

  it("allows guardAdminRead when admin permission exists", async () => {
    const { result } = renderHookWithProviders(() => useAdminGuard());
    const readFn = vi.fn().mockResolvedValue("ok");
    const guarded = result.current.guardAdminRead("get_notification_campaign_runs_admin", readFn);

    await expect(guarded()).resolves.toBe("ok");
    expect(readFn).toHaveBeenCalled();
  });

  it("blocks guardAdminRead without admin permission", async () => {
    hasPermissionMock.mockReturnValue(false);
    const { result } = renderHookWithProviders(() => useAdminGuard());
    const readFn = vi.fn().mockResolvedValue("ok");
    const guarded = result.current.guardAdminRead("get_notification_campaign_schedules_admin", readFn);

    await expect(guarded()).rejects.toBeInstanceOf(AdminPermissionError);
    expect(readFn).not.toHaveBeenCalled();
  });

  it("allows guardAdminMutation when admin permission exists", async () => {
    const { result } = renderHookWithProviders(() => useAdminGuard());
    const mutationFn = vi.fn().mockResolvedValue({ ok: true });
    const guarded = result.current.guardAdminMutation("upsert_notification_campaign_admin", mutationFn);

    await expect(guarded({ id: "123" })).resolves.toEqual({ ok: true });
    expect(mutationFn).toHaveBeenCalledWith({ id: "123" });
  });

  it("blocks guardAdminMutation without admin permission", async () => {
    hasPermissionMock.mockReturnValue(false);
    const { result } = renderHookWithProviders(() => useAdminGuard());
    const mutationFn = vi.fn().mockResolvedValue({ ok: true });
    const guarded = result.current.guardAdminMutation("delete_notification_campaign_admin", mutationFn);

    await expect(guarded({ id: "123" })).rejects.toBeInstanceOf(AdminPermissionError);
    expect(mutationFn).not.toHaveBeenCalled();
  });
});
