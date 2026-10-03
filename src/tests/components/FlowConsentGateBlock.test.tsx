import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FlowConsentGateBlock } from "@/components/storyloop/blocks/FlowConsentGateBlock";

// t returns the key, so assertions key off the i18n key strings.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "en" } }),
}));

describe("FlowConsentGateBlock", () => {
  it("shows an Approve button while awaiting and calls onApprove with the entry + graph id", () => {
    const onApprove = vi.fn();
    render(
      <FlowConsentGateBlock
        metadata={{ flowboard: { status: "awaiting_approval", graphId: "g-1" } }}
        reason="Approve before sending"
        entryId="entry-7"
        onApprove={onApprove}
      />,
    );
    expect(screen.getByText("Approve before sending")).toBeInTheDocument();
    fireEvent.click(screen.getByText("flowboard.block.approveButton"));
    expect(onApprove).toHaveBeenCalledWith("entry-7", "g-1");
  });

  it("shows the approved state and NO button once approved", () => {
    render(
      <FlowConsentGateBlock
        metadata={{ flowboard: { status: "approved", graphId: "g-1" } }}
        entryId="entry-7"
        onApprove={vi.fn()}
      />,
    );
    expect(screen.getByText("flowboard.block.approved")).toBeInTheDocument();
    expect(screen.queryByText("flowboard.block.approveButton")).not.toBeInTheDocument();
  });

  it("renders no Approve button without a graphId (cannot resume)", () => {
    render(
      <FlowConsentGateBlock
        metadata={{ flowboard: { status: "awaiting_approval" } }}
        entryId="entry-7"
        onApprove={vi.fn()}
      />,
    );
    expect(screen.queryByText("flowboard.block.approveButton")).not.toBeInTheDocument();
  });
});
