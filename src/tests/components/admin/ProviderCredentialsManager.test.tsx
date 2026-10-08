import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import { render } from "@/tests/utils/test-utils";
import { ProviderCredentialsManager } from "@/components/admin/settings/ProviderCredentialsManager";
import type { ProviderCredential } from "@/hooks/useProviderCredentials";

const hoisted = vi.hoisted(() => ({
  useProviderCredentialsMock: vi.fn(),
  setMock: vi.fn(),
  deleteMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts?.name ? `${key}:${String(opts.name)}` : key),
  }),
}));

vi.mock("@/hooks/useProviderCredentials", () => ({
  useProviderCredentials: () => hoisted.useProviderCredentialsMock(),
  useSetProviderCredential: () => ({ isPending: false, mutateAsync: hoisted.setMock }),
  useDeleteProviderCredential: () => ({ isPending: false, mutateAsync: hoisted.deleteMock }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => hoisted.toastSuccessMock(...args),
    error: (...args: unknown[]) => hoisted.toastErrorMock(...args),
  },
}));

const KATALOG: ProviderCredential[] = [
  {
    envVar: "AGENT_CLAUDE_OAUTH_TOKEN",
    usedBy: [{ kind: "runtime", slug: "cli:claude-cli", displayName: "Claude CLI" }],
    isSet: false,
    updatedAt: null,
    updatedBy: null,
    source: null,
  },
  {
    envVar: "ANTHROPIC_API_KEY",
    usedBy: [{ kind: "provider", slug: "anthropic", displayName: "Anthropic (direct)" }],
    isSet: true,
    updatedAt: "2026-10-02T10:00:00Z",
    updatedBy: "00000000-0000-0000-0000-000000000001",
    source: "env",
  },
  {
    envVar: "OLD_PLUGIN_TOKEN",
    usedBy: [],
    isSet: true,
    updatedAt: "2026-09-01T10:00:00Z",
    updatedBy: null,
    source: "admin",
  },
];

const SENTINEL = "SENTINEL-ui-hodnota";

describe("ProviderCredentialsManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.useProviderCredentialsMock.mockReturnValue({ data: KATALOG, isLoading: false, isError: false, refetch: vi.fn() });
    hoisted.setMock.mockResolvedValue(undefined);
    hoisted.deleteMock.mockResolvedValue(undefined);
  });

  it("vypíše katalog z DB: jméno, kdo ho používá, stav a původ", () => {
    render(<ProviderCredentialsManager />);
    expect(screen.getByText("AGENT_CLAUDE_OAUTH_TOKEN")).toBeInTheDocument();
    expect(screen.getByText("Claude CLI")).toBeInTheDocument();
    expect(screen.getByText("Anthropic (direct)")).toBeInTheDocument();
    expect(screen.getByText("admin.settings.providerCredentials.sourceEnv")).toBeInTheDocument();
    expect(screen.getAllByText("admin.settings.configured")).toHaveLength(2);
    expect(screen.getAllByText("admin.settings.notConfigured")).toHaveLength(1);
  });

  it("nenastavené pověření nabízí Nastavit, nastavené Nahradit; pole je typu password", () => {
    render(<ProviderCredentialsManager />);
    const radekClaude = screen.getByTestId("provider-credential-AGENT_CLAUDE_OAUTH_TOKEN");
    expect(radekClaude.querySelector("input")?.getAttribute("type")).toBe("password");
    expect(radekClaude.textContent).toContain("admin.settings.providerCredentials.set");
    const radekAnthropic = screen.getByTestId("provider-credential-ANTHROPIC_API_KEY");
    expect(radekAnthropic.textContent).toContain("admin.settings.providerCredentials.replace");
  });

  it("uložení pošle oříznutou hodnotu jen do mutace, pole vyprázdní a hodnotu nikde nezobrazí", async () => {
    render(<ProviderCredentialsManager />);
    const radek = screen.getByTestId("provider-credential-AGENT_CLAUDE_OAUTH_TOKEN");
    const pole = radek.querySelector("input") as HTMLInputElement;
    fireEvent.change(pole, { target: { value: `  ${SENTINEL}\n` } });
    fireEvent.click(screen.getByRole("button", { name: "admin.settings.providerCredentials.set" }));
    await waitFor(() => expect(hoisted.setMock).toHaveBeenCalledWith({ envVar: "AGENT_CLAUDE_OAUTH_TOKEN", value: SENTINEL }));
    await waitFor(() => expect(pole.value).toBe(""));
    expect(document.body.textContent).not.toContain(SENTINEL);
    expect(hoisted.toastSuccessMock).toHaveBeenCalledWith("admin.settings.providerCredentials.saved:AGENT_CLAUDE_OAUTH_TOKEN");
    expect(JSON.stringify(hoisted.toastSuccessMock.mock.calls)).not.toContain(SENTINEL);
  });

  it("chyba uložení se ohlásí bez hodnoty", async () => {
    hoisted.setMock.mockRejectedValue(new Error("Hodnota pověření nesmí být prázdná"));
    render(<ProviderCredentialsManager />);
    const radek = screen.getByTestId("provider-credential-ANTHROPIC_API_KEY");
    fireEvent.change(radek.querySelector("input") as HTMLInputElement, { target: { value: SENTINEL } });
    fireEvent.click(screen.getByRole("button", { name: "admin.settings.providerCredentials.replace" }));
    await waitFor(() => expect(hoisted.toastErrorMock).toHaveBeenCalled());
    expect(JSON.stringify(hoisted.toastErrorMock.mock.calls)).not.toContain(SENTINEL);
  });

  it("osiřelé pověření: bez pole pro zápis, jde jen smazat — a smazání chce potvrzení", async () => {
    render(<ProviderCredentialsManager />);
    const radek = screen.getByTestId("provider-credential-OLD_PLUGIN_TOKEN");
    expect(radek.querySelector("input")).toBeNull();
    expect(radek.textContent).toContain("admin.settings.providerCredentials.orphan");
    fireEvent.click(screen.getByRole("button", { name: "admin.settings.providerCredentials.deleteAria:OLD_PLUGIN_TOKEN" }));
    expect(hoisted.deleteMock).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "common.delete" }));
    await waitFor(() => expect(hoisted.deleteMock).toHaveBeenCalledWith({ envVar: "OLD_PLUGIN_TOKEN" }));
  });

  it("nenastavené pověření nemá tlačítko smazat", () => {
    render(<ProviderCredentialsManager />);
    expect(
      screen.queryByRole("button", { name: "admin.settings.providerCredentials.deleteAria:AGENT_CLAUDE_OAUTH_TOKEN" }),
    ).toBeNull();
  });

  it("chyba načtení katalogu se ukáže nahlas", () => {
    hoisted.useProviderCredentialsMock.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: vi.fn() });
    render(<ProviderCredentialsManager />);
    expect(screen.getByText("admin.settings.providerCredentials.loadError")).toBeInTheDocument();
  });
});
