import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RepriceProposalBlock } from "@/components/storyloop/blocks/RepriceProposalBlock";

// t returns the key, so assertions key off the i18n key strings.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "en" } }),
}));

describe("RepriceProposalBlock", () => {
  it("while pending shows Confirm + Reject and calls the right callback with the entry id", () => {
    const onConfirm = vi.fn();
    const onReject = vi.fn();
    render(
      <RepriceProposalBlock
        metadata={{ proposed_price_retail: 1092.5, old_price_retail: 1000, trigger: "fx_change", reprice: { status: "pending" } }}
        reason="Návrh přecenění (fx_change): 1000 → 1092,50 CZK"
        entryId="entry-9"
        onConfirm={onConfirm}
        onReject={onReject}
      />,
    );
    expect(screen.getByText("Návrh přecenění (fx_change): 1000 → 1092,50 CZK")).toBeInTheDocument();
    expect(screen.getByText("storyloop.reprice.awaiting")).toBeInTheDocument();

    fireEvent.click(screen.getByText("storyloop.reprice.confirmButton"));
    expect(onConfirm).toHaveBeenCalledWith("entry-9");

    fireEvent.click(screen.getByText("storyloop.reprice.rejectButton"));
    expect(onReject).toHaveBeenCalledWith("entry-9");
  });

  it("once confirmed shows the confirmed status and NO action buttons", () => {
    render(
      <RepriceProposalBlock
        metadata={{ reprice: { status: "confirmed" } }}
        entryId="entry-9"
        onConfirm={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByText("storyloop.reprice.confirmed")).toBeInTheDocument();
    expect(screen.queryByText("storyloop.reprice.confirmButton")).not.toBeInTheDocument();
    expect(screen.queryByText("storyloop.reprice.rejectButton")).not.toBeInTheDocument();
  });

  it("renders no action buttons when callbacks are absent (read-only)", () => {
    render(
      <RepriceProposalBlock
        metadata={{ reprice: { status: "pending" } }}
        entryId="entry-9"
      />,
    );
    expect(screen.queryByText("storyloop.reprice.confirmButton")).not.toBeInTheDocument();
  });
});
