import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RatingButtons } from "@/components/ui/rating-buttons";

describe("RatingButtons", () => {
  it("should render all rating buttons from min to max", () => {
    render(
      <RatingButtons
        value={undefined}
        onChange={vi.fn()}
        min={0}
        max={10}
      />
    );

    // Should render 11 buttons (0-10)
    for (let i = 0; i <= 10; i++) {
      expect(screen.getByRole("radio", { name: `${i}` })).toBeInTheDocument();
    }
  });

  it("should highlight selected value", () => {
    render(
      <RatingButtons
        value={7}
        onChange={vi.fn()}
        min={0}
        max={10}
      />
    );

    const selectedButton = screen.getByRole("radio", { name: "7" });
    expect(selectedButton).toHaveAttribute("aria-checked", "true");
    expect(selectedButton).toHaveClass("bg-primary");
  });

  it("should call onChange when button is clicked", async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();

    render(
      <RatingButtons
        value={undefined}
        onChange={handleChange}
        min={0}
        max={10}
      />
    );

    const button5 = screen.getByRole("radio", { name: "5" });
    await user.click(button5);

    expect(handleChange).toHaveBeenCalledWith(5);
  });

  it("should display labels when provided", () => {
    render(
      <RatingButtons
        value={5}
        onChange={vi.fn()}
        min={0}
        max={10}
        labels={{ low: "No Pain", high: "Severe Pain" }}
      />
    );

    expect(screen.getByText("No Pain")).toBeInTheDocument();
    expect(screen.getByText("Severe Pain")).toBeInTheDocument();
    expect(screen.getByText("5 / 10")).toBeInTheDocument();
  });

  it("should be keyboard accessible", async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();

    render(
      <RatingButtons
        value={undefined}
        onChange={handleChange}
        min={0}
        max={10}
      />
    );

    const button3 = screen.getByRole("radio", { name: "3" });
    button3.focus();
    expect(button3).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(handleChange).toHaveBeenCalledWith(3);
  });

  it("should be disabled when disabled prop is true", () => {
    const handleChange = vi.fn();

    render(
      <RatingButtons
        value={5}
        onChange={handleChange}
        min={0}
        max={10}
        disabled={true}
      />
    );

    const buttons = screen.getAllByRole("radio");
    buttons.forEach((button) => {
      expect(button).toBeDisabled();
    });
  });

  it("should display icons when provided", () => {
    const icons = ["😢", "😐", "😊"];
    
    render(
      <RatingButtons
        value={1}
        onChange={vi.fn()}
        min={0}
        max={2}
        icons={icons}
      />
    );

    expect(screen.getByText("😢")).toBeInTheDocument();
    expect(screen.getByText("😐")).toBeInTheDocument();
    expect(screen.getByText("😊")).toBeInTheDocument();
  });

  it("should have proper ARIA attributes for accessibility", () => {
    render(
      <RatingButtons
        value={5}
        onChange={vi.fn()}
        min={0}
        max={10}
        labels={{ low: "Low", high: "High" }}
      />
    );

    const radiogroup = screen.getByRole("radiogroup");
    expect(radiogroup).toHaveAttribute("aria-label", "Low – High");

    const selectedButton = screen.getByRole("radio", { name: "5" });
    expect(selectedButton).toHaveAttribute("aria-checked", "true");

    const unselectedButton = screen.getByRole("radio", { name: "3" });
    expect(unselectedButton).toHaveAttribute("aria-checked", "false");
  });
});
