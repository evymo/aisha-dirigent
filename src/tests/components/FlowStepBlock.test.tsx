import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FlowStepBlock } from "@/components/storyloop/blocks/FlowStepBlock";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, fb?: string) => fb ?? k, i18n: { language: "en" } }),
}));

describe("FlowStepBlock", () => {
  it("renders an automation_step's label (first content line) and its agent output", () => {
    render(
      <FlowStepBlock
        metadata={{ flowboard: { kind: "automation_step", icon: "bot", status: "executed", output: "drafted reply" } }}
        content={"Knowledge agent — executed\n\ndrafted reply"}
      />,
    );
    expect(screen.getByText("Knowledge agent — executed")).toBeInTheDocument();
    expect(screen.getByText("drafted reply")).toBeInTheDocument();
  });

  it("renders the flow_run umbrella header", () => {
    render(
      <FlowStepBlock
        metadata={{ flowboard: { kind: "flow_run", icon: "play", status: "running" } }}
        content="Automation started"
      />,
    );
    expect(screen.getByText("Automation started")).toBeInTheDocument();
  });
});
