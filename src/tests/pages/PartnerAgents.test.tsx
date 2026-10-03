import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import MyContributedAgents from "@/pages/partner/MyContributedAgents";
import ContributeAgent from "@/pages/partner/ContributeAgent";
import type { MyAgent } from "@/lib/schemas/agentMarketplaceSchemas";

const mockUseMyAgents = vi.fn();
const mockUseMyAgent = vi.fn();
const mockSubmit = vi.fn();
const mockPublish = vi.fn();

vi.mock("@/components/layout/Header", () => ({ Header: () => null }));
vi.mock("@/components/layout/Footer", () => ({ Footer: () => null }));

// t returns the key — assertions on i18n keys prove there are no hardcoded strings.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en", changeLanguage: vi.fn() } }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useSession", () => ({ useSession: () => ({ user: { id: "u1" }, isLoading: false }) }));

vi.mock("@/hooks/usePartnerAgents", () => ({
  useMyAgents: () => mockUseMyAgents(),
  useMyAgent: () => mockUseMyAgent(),
  useSubmitAgent: () => ({ mutateAsync: mockSubmit, isPending: false }),
  usePublishAgent: () => ({ mutateAsync: mockPublish, isPending: false }),
}));

const AGENT: MyAgent = {
  id: "11111111-1111-1111-1111-111111111111",
  slug: "legal-reviewer",
  name: "Legal Reviewer",
  description: "Reviews contracts for risk.",
  kind: "agent",
  trust_tier: "partner",
  status: "submitted",
  capabilities: ["agent.run_as_story"],
  agent_spec: { purpose: "review", version: "1.0.0" },
  author: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
};

describe("MyContributedAgents", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the partner's agents with status + edit/publish actions", () => {
    mockUseMyAgents.mockReturnValue({ data: [AGENT], isLoading: false });
    render(
      <MemoryRouter>
        <MyContributedAgents />
      </MemoryRouter>,
    );
    expect(screen.getByText("guild.myAgents.title")).toBeInTheDocument();
    expect(screen.getByText("Legal Reviewer")).toBeInTheDocument();
    // status label resolves the submitted lifecycle state
    expect(screen.getByText("guild.agents.status.submitted")).toBeInTheDocument();
    // a submitted agent can be sent for review
    expect(screen.getByText("guild.contributeAgent.publish")).toBeInTheDocument();
    const edit = screen.getAllByRole("link").find((a) => a.getAttribute("href") === "/partner/agents/legal-reviewer/edit");
    expect(edit).toBeTruthy();
  });

  it("shows the empty state when the partner has no agents", () => {
    mockUseMyAgents.mockReturnValue({ data: [], isLoading: false });
    render(
      <MemoryRouter>
        <MyContributedAgents />
      </MemoryRouter>,
    );
    expect(screen.getByText("guild.myAgents.empty")).toBeInTheDocument();
    expect(screen.queryByText("Legal Reviewer")).not.toBeInTheDocument();
  });

  it("publishes a submitted agent via publish_agent (by plugin id)", async () => {
    mockUseMyAgents.mockReturnValue({ data: [AGENT], isLoading: false });
    mockPublish.mockResolvedValue({ status: "review" });
    render(
      <MemoryRouter>
        <MyContributedAgents />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("guild.contributeAgent.publish"));
    await waitFor(() => expect(mockPublish).toHaveBeenCalledWith(AGENT.id));
  });
});

describe("ContributeAgent (create)", () => {
  beforeEach(() => vi.clearAllMocks());

  const renderCreate = () =>
    render(
      <MemoryRouter initialEntries={["/partner/agents/new"]}>
        <Routes>
          <Route path="/partner/agents/new" element={<ContributeAgent />} />
          <Route path="/partner/agents" element={<div>list</div>} />
        </Routes>
      </MemoryRouter>,
    );

  it("renders the create form with i18n labels (no hardcoded strings)", () => {
    mockUseMyAgent.mockReturnValue({ data: null, isLoading: false });
    renderCreate();
    expect(screen.getByText("guild.contributeAgent.createTitle")).toBeInTheDocument();
    expect(screen.getByText("guild.contributeAgent.nameLabel")).toBeInTheDocument();
    expect(screen.getByText("guild.contributeAgent.identityTitle")).toBeInTheDocument();
  });

  it("assembles a valid agent manifest on submit (kind, slug, default capability)", async () => {
    mockUseMyAgent.mockReturnValue({ data: null, isLoading: false });
    mockSubmit.mockResolvedValue({ plugin_id: "x", slug: "test-agent", status: "submitted" });
    renderCreate();

    fireEvent.change(screen.getByPlaceholderText("guild.contributeAgent.namePlaceholder"), {
      target: { value: "Test Agent" },
    });
    fireEvent.click(screen.getByRole("button", { name: /guild\.contributeAgent\.create/ }));

    await waitFor(() => expect(mockSubmit).toHaveBeenCalled());
    const arg = mockSubmit.mock.calls[0][0] as { manifest: Record<string, unknown> };
    const manifest = arg.manifest;
    expect(manifest.kind).toBe("agent");
    expect(manifest.id).toBe("test-agent"); // auto-slugged from the name
    expect(manifest.name).toBe("Test Agent");
    expect(manifest.capabilities).toContain("agent.run_as_story");
    expect((manifest.agent_spec as Record<string, unknown>).version).toBe("1.0.0");
  });
});
