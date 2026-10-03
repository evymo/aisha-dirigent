/**
 * AishaPruvodceBlock Component Tests
 *
 * Verifies the first-visit guide deck: slide navigation (incl. quiz
 * gating — a question slide must be answered before advancing), answer
 * marking, score computation across the ≥80 % "ready" boundary, restart
 * reset, and the configurable skip link.
 *
 * @see src/components/web/blocks/AishaPruvodceBlock.tsx
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import React from "react";
import AishaPruvodceBlock from "@/components/web/blocks/AishaPruvodceBlock";

/* ── Mocks ────────────────────────────────────────────────────── */

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (params && "num" in params) return `${key}(${params.num}/${params.total})`;
      if (params && "answered" in params) return `${key}(${params.answered}/${params.total})`;
      return key;
    },
    i18n: { language: "en" },
  }),
  // Trans renders its i18nKey so assertions can target slide headings.
  Trans: ({ i18nKey }: { i18nKey: string }) => <span>{i18nKey}</span>,
}));

vi.mock("@/hooks/useDynamicTranslations", () => ({
  useDynamicTranslationsMap: () => ({}),
}));

/* ── Helpers ──────────────────────────────────────────────────── */

function renderBlock(config: Record<string, unknown> = {}) {
  return render(
    <MemoryRouter>
      <AishaPruvodceBlock config={config} />
    </MemoryRouter>,
  );
}

/** Advance from welcome through the 6 content slides to the first question. */
function goToFirstQuestion() {
  fireEvent.click(screen.getByText("pruvodce.s0.cta_go")); // slide 1
  for (let i = 0; i < 5; i++) {
    fireEvent.click(screen.getByLabelText("pruvodce.aria.next")); // slides 2-6
  }
  fireEvent.click(screen.getByText("pruvodce.s6.cta_start")); // slide 7 = Q1
}

/** Option keys (a-d) of the correct answer per question, mirroring QUIZ. */
const CORRECT = ["b", "c", "b", "a", "b"] as const;

/** Answer question qIdx (0-based) with the given option letter key. */
function answerQuestion(qIdx: number, letter: string) {
  fireEvent.click(screen.getByText(`pruvodce.q${qIdx + 1}.${letter}`));
}

function clickQuizNext() {
  // The in-slide button: "next" on Q1-4, "evaluate" on Q5.
  const next = screen.queryByText("pruvodce.quiz.next") ?? screen.getByText("pruvodce.quiz.evaluate");
  fireEvent.click(next);
}

/* ── Tests ────────────────────────────────────────────────────── */

describe("AishaPruvodceBlock", () => {
  it("renders the welcome slide with counter 1/13 and skip link to default /aisha", () => {
    renderBlock();
    expect(screen.getByText("pruvodce.s0.heading")).toBeInTheDocument();
    expect(screen.getByText("1 / 13")).toBeInTheDocument();
    const skip = screen.getByText("pruvodce.s0.cta_skip").closest("a");
    expect(skip).toHaveAttribute("href", "/aisha");
  });

  it("honours config.skipHref for the skip link", () => {
    renderBlock({ skipHref: "/landing" });
    const skip = screen.getByText("pruvodce.s0.cta_skip").closest("a");
    expect(skip).toHaveAttribute("href", "/landing");
  });

  it("navigates forward through content slides via arrow nav", () => {
    renderBlock();
    fireEvent.click(screen.getByText("pruvodce.s0.cta_go"));
    expect(screen.getByText("pruvodce.s1.heading")).toBeInTheDocument();
    expect(screen.getByText("2 / 13")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("pruvodce.aria.next"));
    expect(screen.getByText("pruvodce.s2.heading")).toBeInTheDocument();
  });

  it("gates a quiz slide: arrow next stays disabled until an answer is picked", () => {
    renderBlock();
    goToFirstQuestion();
    expect(screen.getByText("pruvodce.q1.question")).toBeInTheDocument();

    const nextArrow = screen.getByLabelText("pruvodce.aria.next");
    expect(nextArrow).toBeDisabled();

    answerQuestion(0, "b");
    expect(nextArrow).not.toBeDisabled();
  });

  it("marks the correct option after answering (✓ shown) and reveals the hint", () => {
    renderBlock();
    goToFirstQuestion();
    answerQuestion(0, "a"); // wrong answer
    // correct option B gets the ✓ mark regardless of what was clicked
    const correctOpt = screen.getByText("pruvodce.q1.b").closest("button");
    expect(correctOpt?.className).toContain("is-correct");
    expect(screen.getByText("pruvodce.q1.hint").closest("p")?.className).toContain("is-visible");
  });

  it("scores 5/5 as ready with the platform CTA linking to skipHref", () => {
    renderBlock({ skipHref: "/aisha" });
    goToFirstQuestion();
    for (let q = 0; q < 5; q++) {
      answerQuestion(q, CORRECT[q]);
      clickQuizNext();
    }
    expect(screen.getByText("pruvodce.result.ready_title")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    const cta = screen.getByText("pruvodce.result.cta_platform").closest("a");
    expect(cta).toHaveAttribute("href", "/aisha");
  });

  it("scores 3/5 as 'almost' with restart + browse-anyway CTAs", () => {
    renderBlock();
    goToFirstQuestion();
    const letters = [CORRECT[0], CORRECT[1], CORRECT[2], "b", "a"]; // q4 correct=a → b wrong; q5 correct=b → a wrong
    for (let q = 0; q < 5; q++) {
      answerQuestion(q, letters[q]);
      clickQuizNext();
    }
    expect(screen.getByText("pruvodce.result.soon_title")).toBeInTheDocument();
    expect(screen.getByText("pruvodce.result.cta_restart")).toBeInTheDocument();
    expect(screen.getByText("pruvodce.result.cta_anyway_soon")).toBeInTheDocument();
  });

  it("restart resets answers and returns to the welcome slide", () => {
    renderBlock();
    goToFirstQuestion();
    const letters = ["a", "a", "a", "b", "a"]; // all wrong → 0/5 → again branch
    for (let q = 0; q < 5; q++) {
      answerQuestion(q, letters[q]);
      clickQuizNext();
    }
    expect(screen.getByText("pruvodce.result.again_title")).toBeInTheDocument();

    fireEvent.click(screen.getByText("pruvodce.result.cta_restart"));
    expect(screen.getByText("pruvodce.s0.heading")).toBeInTheDocument();
    expect(screen.getByText("1 / 13")).toBeInTheDocument();
  });
});
