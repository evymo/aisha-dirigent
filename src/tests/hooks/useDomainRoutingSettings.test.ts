import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, waitFor } from "@testing-library/react";

import { renderHookWithProviders } from "@/tests/utils/test-utils";
import {
  DEFAULT_DOMAIN_ROUTING_CONFIG,
  isValidInternalServiceTarget,
  isValidRoutingDomain,
  useDomainRoutingConfig,
  useUpdateDomainRoutingConfig,
} from "@/hooks/useDomainRoutingSettings";

const hoisted = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  safeErrorMock: vi.fn(),
}));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (...args: unknown[]) => hoisted.rpcMock(...args),
  },
}));

vi.mock("@/lib/security/safeLogger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security/safeLogger")>();
  return {
    ...actual,
    safeError: hoisted.safeErrorMock,
  };
});

describe("useDomainRoutingSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("validators", () => {
    it("validates routing domain", () => {
      expect(isValidRoutingDomain("app.example.com")).toBe(true);
      expect(isValidRoutingDomain("*.example.com")).toBe(true);
      expect(isValidRoutingDomain("https://example.com")).toBe(false);
      expect(isValidRoutingDomain("invalid_domain")).toBe(false);
    });

    it("validates internal service target host:port", () => {
      expect(isValidInternalServiceTarget("web:80")).toBe(true);
      expect(isValidInternalServiceTarget("api-gw:8080")).toBe(true);
      expect(isValidInternalServiceTarget("web:0")).toBe(false);
      expect(isValidInternalServiceTarget("web:70000")).toBe(false);
      expect(isValidInternalServiceTarget("web80")).toBe(false);
    });
  });

  describe("useDomainRoutingConfig", () => {
    it("loads and normalizes legacy routes into rules", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: {
          routes: [
            {
              domain: "App.Example.com",
              enabled: true,
              target: "/admin",
            },
            {
              domain: "api.example.com",
              service: "gateway:8000",
            },
          ],
        },
        error: null,
      });

      const { result } = renderHookWithProviders(() => useDomainRoutingConfig());

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.rules).toEqual([
        {
          domain: "App.Example.com",
          enabled: true,
          target_type: "internal_path",
          target_value: "/admin",
        },
        {
          domain: "api.example.com",
          enabled: true,
          target_type: "internal_service",
          target_value: "gateway:8000",
        },
      ]);
      expect(hoisted.rpcMock).toHaveBeenCalledWith("get_system_config", {
        p_key: "domain_routing_config",
      });
    });

    it("returns defaults on RPC error", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: { message: "not found" },
      });

      const { result } = renderHookWithProviders(() => useDomainRoutingConfig());

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(DEFAULT_DOMAIN_ROUTING_CONFIG);
    });
  });

  describe("useUpdateDomainRoutingConfig", () => {
    it("stores domain routing config via set_system_config_admin", async () => {
      hoisted.rpcMock.mockResolvedValue({ data: null, error: null });

      const { result } = renderHookWithProviders(() => useUpdateDomainRoutingConfig());

      await act(async () => {
        await result.current.mutateAsync({
          rules: [
            {
              domain: "app.example.com",
              enabled: true,
              target_type: "internal_section",
              target_value: "admin",
            },
          ],
        });
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith("set_system_config_admin", {
        p_category: "routing",
        p_description: "Domain routing configuration for admin-defined host routing targets",
        p_is_public: false,
        p_key: "domain_routing_config",
        p_value: {
          rules: [
            {
              domain: "app.example.com",
              enabled: true,
              target_type: "internal_section",
              target_value: "admin",
            },
          ],
        },
      });
    });

    it("throws when RPC update fails", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: { message: "Admin role required" },
      });

      const { result } = renderHookWithProviders(() => useUpdateDomainRoutingConfig());

      await expect(
        act(async () => {
          await result.current.mutateAsync({
            rules: [
              {
                domain: "app.example.com",
                enabled: true,
                target_type: "internal_section",
                target_value: "admin",
              },
            ],
          });
        }),
      ).rejects.toThrow("Admin role required");
    });
  });
});
