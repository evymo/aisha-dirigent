import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import AgentMarketplace from "@/pages/AgentMarketplace";
import AgentMarketplaceDetail from "@/pages/AgentMarketplaceDetail";
import type { AvailableAgent } from "@/lib/schemas/agentMarketplaceSchemas";

const mockUseAvailableAgents = vi.fn();
const mockUseAvailableAgent = vi.fn();
const mockInstall = vi.fn();

vi.mock("@/components/layout/Header", () => ({ Header: () => null }));
vi.mock("@/components/layout/Footer", () => ({ Footer: () => null }));

// t returns the key — assertions are on the i18n key strings (proves no hardcoded text).
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/hooks/useAvailableAgents", () => ({
  useAvailableAgents: () => mockUseAvailableAgents(),
  useAvailableAgent: () => mockUseAvailableAgent(),
  useInstallAgent: () => ({ mutateAsync: mockInstall, isPending: false }),
}));

const AGENT: AvailableAgent = {
  plugin_id: "11111111-1111-1111-1111-111111111111",
  slug: "legal-reviewer",
  name: "Legal Reviewer",
  description: "Reviews contracts for risk.",
  kind: "agent",
  trust_tier: "partner",
  status: "ga",
  capabilities: ["agent.run_as_story"],
  version: "1.0.0",
};

describe("AgentMarketplace (list)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders agent cards from the listing", () => {
    mockUseAvailableAgents.mockReturnValue({ data: [AGENT], isLoading: false });
    render(
      <MemoryRouter>
        <AgentMarketplace />
      </MemoryRouter>,
    );
    expect(screen.getByText("guild.agents.title")).toBeInTheDocument();
    expect(screen.getByText("Legal Reviewer")).toBeInTheDocument();
    expect(screen.getByText("Reviews contracts for risk.")).toBeInTheDocument();
    // link to the detail page uses the slug, not an id
    const link = screen.getAllByRole("link").find((a) => a.getAttribute("href") === "/agents/legal-reviewer");
    expect(link).toBeTruthy();
  });

  it("shows the empty state when there are no agents", () => {
    mockUseAvailableAgents.mockReturnValue({ data: [], isLoading: false });
    render(
      <MemoryRouter>
        <AgentMarketplace />
      </MemoryRouter>,
    );
    expect(screen.getByText("guild.agents.noAgents")).toBeInTheDocument();
    expect(screen.queryByText("Legal Reviewer")).not.toBeInTheDocument();
  });

  it("renders skeletons while loading (no agent names yet)", () => {
    mockUseAvailableAgents.mockReturnValue({ data: undefined, isLoading: true });
    render(
      <MemoryRouter>
        <AgentMarketplace />
      </MemoryRouter>,
    );
    expect(screen.queryByText("Legal Reviewer")).not.toBeInTheDocument();
    expect(screen.queryByText("guild.agents.noAgents")).not.toBeInTheDocument();
  });
});

describe("AgentMarketplaceDetail", () => {
  beforeEach(() => vi.clearAllMocks());

  const renderAt = (slug: string) =>
    render(
      <MemoryRouter initialEntries={[`/agents/${slug}`]}>
        <Routes>
          <Route path="/agents/:agentSlug" element={<AgentMarketplaceDetail />} />
        </Routes>
      </MemoryRouter>,
    );

  it("renders the agent + the run-as-story install action", () => {
    mockUseAvailableAgent.mockReturnValue({ data: AGENT, isLoading: false });
    renderAt("legal-reviewer");
    expect(screen.getByText("Legal Reviewer")).toBeInTheDocument();
    expect(screen.getByText("guild.agents.runAsStory")).toBeInTheDocument();
    expect(screen.getByText("guild.agents.install")).toBeInTheDocument();
    expect(screen.getByText("agent.run_as_story")).toBeInTheDocument(); // capability badge
  });

  it("shows a not-found state for an unknown slug", () => {
    mockUseAvailableAgent.mockReturnValue({ data: null, isLoading: false });
    renderAt("does-not-exist");
    expect(screen.getByText("guild.agents.notFound")).toBeInTheDocument();
    expect(screen.getByText("guild.agents.backToAgents")).toBeInTheDocument();
  });
});
