/**
 * DiaryCalendar Component Tests
 *
 * Tests for the member diary calendar component:
 * - Month navigation (prev, next, today)
 * - Day rendering with activity icons
 * - Day click callback
 * - Legend rendering
 * - Distribution list rendering
 * - Empty state (no calendar data)
 *
 * @see src/components/member-diary/DiaryCalendar.tsx
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { format, addMonths, subMonths } from "date-fns";
import type { MemberDiaryCalendarResponse } from "@/lib/schemas/memberDiarySchemas";

// ---------- mocks ----------

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && "count" in opts) return `${key}:${opts.count}`;
      if (opts && "scale" in opts) return `${key}:${opts.scale}`;
      return key;
    },
    i18n: { language: "en", changeLanguage: vi.fn() },
  }),
}));

// ---------- fixtures ----------

const SELECTED_MONTH = new Date(2026, 0, 1); // January 2026

const CALENDAR_DATA: MemberDiaryCalendarResponse = {
  month: "2026-01",
  days: [
    {
      date: "2026-01-05",
      products_taken: 3,
      states_logged: 0,
      distribution_received: false,
      has_active_issues: false,
    },
    {
      date: "2026-01-10",
      products_taken: 0,
      states_logged: 2,
      distribution_received: false,
      has_active_issues: true,
    },
    {
      date: "2026-01-15",
      products_taken: 1,
      states_logged: 1,
      distribution_received: true,
      has_active_issues: false,
    },
    {
      date: "2026-01-20",
      products_taken: 0,
      states_logged: 0,
      distribution_received: false,
      has_active_issues: false,
    },
  ],
  distributions: [
    {
      date: "2026-01-15",
      status: "delivered",
      vial_count: 3,
      tracking_number: null,
      carrier: null,
      shipped_at: null,
      delivered_at: null,
    },
  ],
};

// ---------- helpers ----------

let DiaryCalendar: React.ComponentType<{
  calendarData: MemberDiaryCalendarResponse | undefined;
  selectedMonth: Date;
  onMonthChange: (month: Date) => void;
  onDayClick: (date: Date) => void;
  isLoading?: boolean;
}>;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import("@/components/member-diary/DiaryCalendar");
  DiaryCalendar = mod.DiaryCalendar;
});

// ---------- tests ----------

describe("DiaryCalendar", () => {
  describe("rendering", () => {
    it("renders month title and weekday headers", () => {
      const onMonthChange = vi.fn();
      const onDayClick = vi.fn();

      render(
        React.createElement(DiaryCalendar, {
          calendarData: CALENDAR_DATA,
          selectedMonth: SELECTED_MONTH,
          onMonthChange,
          onDayClick,
        }),
      );

      // Weekday headers
      expect(screen.getByText("memberDiary.calendar.weekDays.mon")).toBeInTheDocument();
      expect(screen.getByText("memberDiary.calendar.weekDays.tue")).toBeInTheDocument();
      expect(screen.getByText("memberDiary.calendar.weekDays.wed")).toBeInTheDocument();
      expect(screen.getByText("memberDiary.calendar.weekDays.thu")).toBeInTheDocument();
      expect(screen.getByText("memberDiary.calendar.weekDays.fri")).toBeInTheDocument();
      expect(screen.getByText("memberDiary.calendar.weekDays.sat")).toBeInTheDocument();
      expect(screen.getByText("memberDiary.calendar.weekDays.sun")).toBeInTheDocument();
    });

    it("renders all 31 days of January 2026", () => {
      render(
        React.createElement(DiaryCalendar, {
          calendarData: CALENDAR_DATA,
          selectedMonth: SELECTED_MONTH,
          onMonthChange: vi.fn(),
          onDayClick: vi.fn(),
        }),
      );

      // Check a few specific days exist
      expect(screen.getByText("1")).toBeInTheDocument();
      expect(screen.getByText("15")).toBeInTheDocument();
      expect(screen.getByText("31")).toBeInTheDocument();
    });

    it("renders legend with all indicator types", () => {
      render(
        React.createElement(DiaryCalendar, {
          calendarData: CALENDAR_DATA,
          selectedMonth: SELECTED_MONTH,
          onMonthChange: vi.fn(),
          onDayClick: vi.fn(),
        }),
      );

      expect(screen.getByText("memberDiary.legendProducts")).toBeInTheDocument();
      expect(screen.getByText("memberDiary.legendStatesOk")).toBeInTheDocument();
      expect(screen.getByText("memberDiary.legendStatesIssue")).toBeInTheDocument();
      expect(screen.getByText("memberDiary.legendDistribution")).toBeInTheDocument();
    });

    it("renders today button", () => {
      render(
        React.createElement(DiaryCalendar, {
          calendarData: CALENDAR_DATA,
          selectedMonth: SELECTED_MONTH,
          onMonthChange: vi.fn(),
          onDayClick: vi.fn(),
        }),
      );

      expect(screen.getByText("memberDiary.today")).toBeInTheDocument();
    });
  });

  describe("activity icons", () => {
    it("shows product indicator dot for days with products_taken > 0", () => {
      render(
        React.createElement(DiaryCalendar, {
          calendarData: CALENDAR_DATA,
          selectedMonth: SELECTED_MONTH,
          onMonthChange: vi.fn(),
          onDayClick: vi.fn(),
        }),
      );

      // Day 5 has 3 products, day 15 has 1 product
      // These render as colored dots with title attributes
      const productDots = screen.getAllByTitle(/memberDiary\.productsTaken/);
      expect(productDots.length).toBe(2); // day 5 and day 15
    });

    it("shows state indicator dot for days with states_logged > 0", () => {
      render(
        React.createElement(DiaryCalendar, {
          calendarData: CALENDAR_DATA,
          selectedMonth: SELECTED_MONTH,
          onMonthChange: vi.fn(),
          onDayClick: vi.fn(),
        }),
      );

      const stateDots = screen.getAllByTitle(/memberDiary\.statesLogged/);
      expect(stateDots.length).toBe(2); // day 10 and day 15
    });

    it("shows distribution indicator dot for days with distribution_received", () => {
      render(
        React.createElement(DiaryCalendar, {
          calendarData: CALENDAR_DATA,
          selectedMonth: SELECTED_MONTH,
          onMonthChange: vi.fn(),
          onDayClick: vi.fn(),
        }),
      );

      const distDots = screen.getAllByTitle("memberDiary.distributionReceived");
      expect(distDots.length).toBe(1); // day 15
    });

    it("uses warning color for states with active issues", () => {
      render(
        React.createElement(DiaryCalendar, {
          calendarData: CALENDAR_DATA,
          selectedMonth: SELECTED_MONTH,
          onMonthChange: vi.fn(),
          onDayClick: vi.fn(),
        }),
      );

      // Day 10 has has_active_issues=true → bg-warning class
      const stateDots = screen.getAllByTitle(/memberDiary\.statesLogged/);
      // One should have bg-warning (day 10), one bg-success (day 15)
      const warningDot = stateDots.find((dot) => dot.className.includes("bg-warning"));
      const successDot = stateDots.find((dot) => dot.className.includes("bg-success"));
      expect(warningDot).toBeDefined();
      expect(successDot).toBeDefined();
    });
  });

  describe("navigation", () => {
    it("calls onMonthChange with previous month when clicking prev button", () => {
      const onMonthChange = vi.fn();

      render(
        React.createElement(DiaryCalendar, {
          calendarData: CALENDAR_DATA,
          selectedMonth: SELECTED_MONTH,
          onMonthChange,
          onDayClick: vi.fn(),
        }),
      );

      // The prev button has ChevronLeft icon — find by role
      const navButtons = screen.getAllByRole("button");
      // First nav button should be the prev button (ChevronLeft)
      const prevButton = navButtons[0];
      fireEvent.click(prevButton);

      expect(onMonthChange).toHaveBeenCalledWith(subMonths(SELECTED_MONTH, 1));
    });

    it("calls onMonthChange with next month when clicking next button", () => {
      const onMonthChange = vi.fn();

      render(
        React.createElement(DiaryCalendar, {
          calendarData: CALENDAR_DATA,
          selectedMonth: SELECTED_MONTH,
          onMonthChange,
          onDayClick: vi.fn(),
        }),
      );

      // Find the next button (after today button)
      const navButtons = screen.getAllByRole("button");
      // Buttons order: prev, today, next, ...day buttons
      const nextButton = navButtons[2];
      fireEvent.click(nextButton);

      expect(onMonthChange).toHaveBeenCalledWith(addMonths(SELECTED_MONTH, 1));
    });

    it("calls onMonthChange with current date when clicking today button", () => {
      const onMonthChange = vi.fn();

      render(
        React.createElement(DiaryCalendar, {
          calendarData: CALENDAR_DATA,
          selectedMonth: SELECTED_MONTH,
          onMonthChange,
          onDayClick: vi.fn(),
        }),
      );

      fireEvent.click(screen.getByText("memberDiary.today"));

      expect(onMonthChange).toHaveBeenCalledTimes(1);
      const calledWith = onMonthChange.mock.calls[0][0] as Date;
      // Should be roughly "now"
      expect(calledWith.getFullYear()).toBe(new Date().getFullYear());
    });
  });

  describe("day click", () => {
    it("calls onDayClick with the correct date when clicking a day", () => {
      const onDayClick = vi.fn();

      render(
        React.createElement(DiaryCalendar, {
          calendarData: CALENDAR_DATA,
          selectedMonth: SELECTED_MONTH,
          onMonthChange: vi.fn(),
          onDayClick,
        }),
      );

      // Click on day 15
      fireEvent.click(screen.getByText("15"));

      expect(onDayClick).toHaveBeenCalledTimes(1);
      const clickedDate = onDayClick.mock.calls[0][0] as Date;
      expect(clickedDate.getDate()).toBe(15);
      expect(clickedDate.getMonth()).toBe(0); // January
      expect(clickedDate.getFullYear()).toBe(2026);
    });
  });

  describe("distributions section", () => {
    it("renders distribution list when distributions exist", () => {
      render(
        React.createElement(DiaryCalendar, {
          calendarData: CALENDAR_DATA,
          selectedMonth: SELECTED_MONTH,
          onMonthChange: vi.fn(),
          onDayClick: vi.fn(),
        }),
      );

      expect(screen.getByText("memberDiary.distributionsThisMonth")).toBeInTheDocument();
      expect(screen.getByText("delivered")).toBeInTheDocument();
    });

    it("does not render distribution section when no distributions", () => {
      const dataWithoutDist: MemberDiaryCalendarResponse = {
        ...CALENDAR_DATA,
        distributions: [],
      };

      render(
        React.createElement(DiaryCalendar, {
          calendarData: dataWithoutDist,
          selectedMonth: SELECTED_MONTH,
          onMonthChange: vi.fn(),
          onDayClick: vi.fn(),
        }),
      );

      expect(screen.queryByText("memberDiary.distributionsThisMonth")).not.toBeInTheDocument();
    });
  });

  describe("empty state", () => {
    it("renders calendar grid even without calendar data", () => {
      render(
        React.createElement(DiaryCalendar, {
          calendarData: undefined,
          selectedMonth: SELECTED_MONTH,
          onMonthChange: vi.fn(),
          onDayClick: vi.fn(),
        }),
      );

      // Days should still render
      expect(screen.getByText("1")).toBeInTheDocument();
      expect(screen.getByText("31")).toBeInTheDocument();
      // But no activity indicators
      expect(screen.queryByTitle(/memberDiary\.productsTaken/)).not.toBeInTheDocument();
    });

    it("renders calendar grid with no day activity when days array is empty", () => {
      const emptyData: MemberDiaryCalendarResponse = {
        month: "2026-01",
        days: [],
        distributions: [],
      };

      render(
        React.createElement(DiaryCalendar, {
          calendarData: emptyData,
          selectedMonth: SELECTED_MONTH,
          onMonthChange: vi.fn(),
          onDayClick: vi.fn(),
        }),
      );

      expect(screen.getByText("15")).toBeInTheDocument();
      expect(screen.queryByTitle(/memberDiary\.productsTaken/)).not.toBeInTheDocument();
    });
  });
});
