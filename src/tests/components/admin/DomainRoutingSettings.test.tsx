import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import { render } from "@/tests/utils/test-utils";
import { DomainRoutingSettings } from "@/components/admin/settings/DomainRoutingSettings";

const hoisted = vi.hoisted(() => ({
  mutateAsyncMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  useDomainRoutingConfigMock: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/hooks/useDomainRoutingSettings", () => ({
  isValidInternalServiceTarget: (value: string) => /^(?:[a-zA-Z0-9-]+):(?:[1-9][0-9]{0,4})$/.test(value),
  isValidRoutingDomain: (domain: string) =>
    /^(?:\*\.)?(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/.test(domain),
  useDomainRoutingConfig: () => hoisted.useDomainRoutingConfigMock(),
  useUpdateDomainRoutingConfig: () => ({
    isPending: false,
    mutateAsync: hoisted.mutateAsyncMock,
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => hoisted.toastErrorMock(...args),
    success: (...args: unknown[]) => hoisted.toastSuccessMock(...args),
  },
}));

describe("DomainRoutingSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.useDomainRoutingConfigMock.mockReturnValue({
      data: { rules: [] },
      isLoading: false,
    });
  });

  it("renders empty state when no rules exist", () => {
    render(<DomainRoutingSettings />);

    expect(
      screen.getByText("admin.settings.domainRouting.emptyState"),
    ).toBeInTheDocument();
  });

  it("adds a new row after clicking add rule", () => {
    render(<DomainRoutingSettings />);

    fireEvent.click(screen.getByRole("button", { name: "admin.settings.domainRouting.addRule" }));

    expect(screen.getByPlaceholderText("admin.settings.domainRouting.placeholders.domain")).toBeInTheDocument();
  });

  it("shows validation error for invalid domain and prevents save", async () => {
    render(<DomainRoutingSettings />);

    fireEvent.click(screen.getByRole("button", { name: "admin.settings.domainRouting.addRule" }));

    const domainInput = screen.getByPlaceholderText("admin.settings.domainRouting.placeholders.domain");
    fireEvent.change(domainInput, { target: { value: "invalid_domain" } });

    await waitFor(() => {
      expect(screen.getByText("admin.settings.domainRouting.errors.domainInvalid")).toBeInTheDocument();
    });

    const saveButton = screen.getByRole("button", { name: "common.save" });
    expect(saveButton).toBeDisabled();
  });

  it("saves normalized payload for valid row", async () => {
    hoisted.useDomainRoutingConfigMock.mockReturnValue({
      data: {
        rules: [
          {
            domain: "app.example.com",
            enabled: true,
            target_type: "internal_section",
            target_value: "admin",
          },
        ],
      },
      isLoading: false,
    });

    hoisted.mutateAsyncMock.mockResolvedValue(undefined);

    render(<DomainRoutingSettings />);

    fireEvent.change(
      screen.getByPlaceholderText("admin.settings.domainRouting.placeholders.domain"),
      { target: { value: "App.Example.com " } },
    );

    const saveButton = screen.getByRole("button", { name: "common.save" });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(hoisted.mutateAsyncMock).toHaveBeenCalledWith({
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

    expect(hoisted.toastSuccessMock).toHaveBeenCalled();
  });
});
