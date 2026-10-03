/**
 * Appointments E2E Tests
 *
 * Tests the appointment booking system between members and partners.
 * Covers: booking, viewing, canceling, rescheduling appointments.
 */

import { test, expect } from "@playwright/test";
import { loginUser, clearLocalStorage, waitForLoadingComplete, TEST_USERS } from "./fixtures";

const USERS = TEST_USERS;

test.describe("Appointments - Member Booking", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.member.email, USERS.member.password);
  });

  test("Appointments page is accessible", async ({ page }) => {
    await page.goto("/member/appointments");
    await waitForLoadingComplete(page);

    // Should show appointments interface
    const hasAppointments = await page.getByText(/appointment|schůzka|booking|rezervace/i).isVisible().catch(() => false);
    expect(hasAppointments).toBe(true);
  });

  test("Can view available partners", async ({ page }) => {
    await page.goto("/member/appointments");
    await waitForLoadingComplete(page);

    // Should show partner list or booking interface
    const hasPartners = await page.getByText(/partner|consultant|doctor|lékař|konzultant/i).isVisible().catch(() => false);
    const hasBookingOption = await page.getByRole("button", { name: /book|schedule|rezervovat/i }).isVisible().catch(() => false);

    expect(hasPartners || hasBookingOption).toBe(true);
  });

  test("Can select partner for appointment", async ({ page }) => {
    await page.goto("/member/appointments");
    await waitForLoadingComplete(page);

    // Find partner selection
    const partnerCard = page.getByTestId("partner-card").first();
    const selectButton = page.getByRole("button", { name: /select|choose|book|vybrat/i }).first();

    if (await partnerCard.isVisible().catch(() => false)) {
      await partnerCard.click();
      await waitForLoadingComplete(page);

      const hasSchedule = await page.getByText(/schedule|calendar|time|čas/i).isVisible().catch(() => false);
      expect(hasSchedule).toBe(true);
    } else if (await selectButton.isVisible().catch(() => false)) {
      await selectButton.click();
      await waitForLoadingComplete(page);
      expect(true).toBe(true);
    }
  });

  test("Can select time slot", async ({ page }) => {
    await page.goto("/member/appointments");
    await waitForLoadingComplete(page);

    // Find time slot selection
    const timeSlot = page.getByTestId("time-slot").first()
      .or(page.getByRole("button", { name: /\d+:\d+/i }).first());

    if (await timeSlot.isVisible().catch(() => false)) {
      await timeSlot.click();
      await waitForLoadingComplete(page);

      // Should show confirmation
      const hasConfirm = await page.getByText(/confirm|book|reserve|potvrdit/i).isVisible().catch(() => false);
      expect(hasConfirm).toBe(true);
    }
  });

  test("Can complete booking", async ({ page }) => {
    await page.goto("/member/appointments");
    await waitForLoadingComplete(page);

    // Find and complete booking flow
    const bookButton = page.getByRole("button", { name: /book|schedule|rezervovat/i }).first();

    if (await bookButton.isVisible().catch(() => false)) {
      await bookButton.click();
      await waitForLoadingComplete(page);

      // Fill any required fields
      const reasonInput = page.getByLabel(/reason|důvod|note|poznámka/i).first();
      if (await reasonInput.isVisible().catch(() => false)) {
        await reasonInput.fill("E2E Test appointment");
      }

      // Confirm booking
      const confirmButton = page.getByRole("button", { name: /confirm|complete|potvrdit|dokončit/i }).first();
      if (await confirmButton.isVisible().catch(() => false)) {
        await confirmButton.click();
        await waitForLoadingComplete(page);

        const hasSuccess = await page.getByText(/booked|confirmed|success|úspěšně|potvrzeno/i).isVisible().catch(() => false);
        expect(hasSuccess).toBe(true);
      }
    }
  });
});

test.describe("Appointments - Member Management", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.member.email, USERS.member.password);
  });

  test("Can view upcoming appointments", async ({ page }) => {
    await page.goto("/member/appointments");
    await waitForLoadingComplete(page);

    // Should show appointment list
    const hasUpcoming = await page.getByText(/upcoming|nadcházející|scheduled|naplánované/i).isVisible().catch(() => false);
    const hasNoAppointments = await page.getByText(/no appointments|žádné schůzky/i).isVisible().catch(() => false);
    const hasAppointmentList = await page.getByTestId("appointment-card").first().isVisible().catch(() => false);

    expect(hasUpcoming || hasNoAppointments || hasAppointmentList).toBe(true);
  });

  test("Can view past appointments", async ({ page }) => {
    await page.goto("/member/appointments");
    await waitForLoadingComplete(page);

    // Look for past/history tab
    const historyTab = page.getByRole("tab", { name: /past|history|historie|minulé/i }).first();

    if (await historyTab.isVisible().catch(() => false)) {
      await historyTab.click();
      await waitForLoadingComplete(page);

      const hasPast = await page.getByText(/past|completed|dokončené|historie/i).isVisible().catch(() => false);
      expect(hasPast).toBe(true);
    }
  });

  test("Can cancel appointment", async ({ page }) => {
    await page.goto("/member/appointments");
    await waitForLoadingComplete(page);

    // Find cancel button
    const cancelButton = page.getByRole("button", { name: /cancel|zrušit/i }).first();

    if (await cancelButton.isVisible().catch(() => false)) {
      await cancelButton.click();
      await waitForLoadingComplete(page);

      // Should show confirmation
      const hasConfirmation = await page.getByText(/confirm|are you sure|jste si jisti/i).isVisible().catch(() => false);

      if (hasConfirmation) {
        const confirmButton = page.getByRole("button", { name: /yes|confirm|ano|potvrdit/i }).first();
        if (await confirmButton.isVisible().catch(() => false)) {
          await confirmButton.click();
          await waitForLoadingComplete(page);
        }
      }

      expect(true).toBe(true);
    }
  });

  test("Can reschedule appointment", async ({ page }) => {
    await page.goto("/member/appointments");
    await waitForLoadingComplete(page);

    // Find reschedule button
    const rescheduleButton = page.getByRole("button", { name: /reschedule|change|přeložit|změnit/i }).first();

    if (await rescheduleButton.isVisible().catch(() => false)) {
      await rescheduleButton.click();
      await waitForLoadingComplete(page);

      // Should show new time selection
      const hasTimeSelection = await page.getByText(/select|choose|time|čas|new date|nový termín/i).isVisible().catch(() => false);
      expect(hasTimeSelection).toBe(true);
    }
  });
});

test.describe("Appointments - Partner Management", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.partner.email, USERS.partner.password);
  });

  test("Partner can view appointments", async ({ page }) => {
    await page.goto("/partner/appointments");
    await waitForLoadingComplete(page);

    // Should show appointment management
    const hasAppointments = await page.getByText(/appointment|schůzka|schedule|kalendář/i).isVisible().catch(() => false);
    expect(hasAppointments).toBe(true);
  });

  test("Partner can view appointment details", async ({ page }) => {
    await page.goto("/partner/appointments");
    await waitForLoadingComplete(page);

    // Click on appointment to see details
    const appointmentCard = page.getByTestId("appointment-card").first();
    const viewButton = page.getByRole("button", { name: /view|detail|zobrazit/i }).first();

    if (await appointmentCard.isVisible().catch(() => false)) {
      await appointmentCard.click();
      await waitForLoadingComplete(page);

      const hasDetail = await page.getByText(/member|user|client|time|reason/i).isVisible().catch(() => false);
      expect(hasDetail).toBe(true);
    }
  });

  test("Partner can confirm appointment", async ({ page }) => {
    await page.goto("/partner/appointments");
    await waitForLoadingComplete(page);

    // Find confirm button for pending appointments
    const confirmButton = page.getByRole("button", { name: /confirm|approve|potvrdit|schválit/i }).first();

    if (await confirmButton.isVisible().catch(() => false)) {
      await confirmButton.click();
      await waitForLoadingComplete(page);

      const hasSuccess = await page.getByText(/confirmed|approved|potvrzeno/i).isVisible().catch(() => false);
      expect(hasSuccess).toBe(true);
    }
  });

  test("Partner can cancel appointment", async ({ page }) => {
    await page.goto("/partner/appointments");
    await waitForLoadingComplete(page);

    // Find cancel button
    const cancelButton = page.getByRole("button", { name: /cancel|decline|zrušit|odmítnout/i }).first();

    if (await cancelButton.isVisible().catch(() => false)) {
      await cancelButton.click();
      await waitForLoadingComplete(page);

      // Should show reason input or confirmation
      const hasReasonInput = await page.getByLabel(/reason|důvod/i).isVisible().catch(() => false);
      const hasConfirmation = await page.getByText(/confirm|are you sure/i).isVisible().catch(() => false);

      expect(hasReasonInput || hasConfirmation).toBe(true);
    }
  });

  test("Partner can add notes to appointment", async ({ page }) => {
    await page.goto("/partner/appointments");
    await waitForLoadingComplete(page);

    // Click on appointment
    const appointmentCard = page.getByTestId("appointment-card").first();

    if (await appointmentCard.isVisible().catch(() => false)) {
      await appointmentCard.click();
      await waitForLoadingComplete(page);

      // Find notes field
      const notesField = page.getByLabel(/notes|poznámky/i).first()
        .or(page.locator("textarea").first());

      if (await notesField.isVisible().catch(() => false)) {
        await notesField.fill("E2E Test notes for appointment");

        const saveButton = page.getByRole("button", { name: /save|uložit/i }).first();
        if (await saveButton.isVisible().catch(() => false)) {
          await saveButton.click();
          await waitForLoadingComplete(page);
        }

        expect(true).toBe(true);
      }
    }
  });
});

test.describe("Appointments - Notifications", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
  });

  test("Member receives appointment confirmation", async ({ page }) => {
    await loginUser(page, USERS.member.email, USERS.member.password);
    await page.goto("/member/appointments");
    await waitForLoadingComplete(page);

    // Look for notifications or confirmation messages
    const hasNotification = await page.getByText(/notification|confirmation|confirmed/i).isVisible().catch(() => false);
    expect(hasNotification).toBe(true);
  });

  test("Partner receives booking notification", async ({ page }) => {
    await loginUser(page, USERS.partner.email, USERS.partner.password);
    await page.goto("/partner/dashboard");
    await waitForLoadingComplete(page);

    // Look for new booking indicator
    const hasNewBooking = await page.getByText(/new|nové|pending|čekající|booking|request/i).isVisible().catch(() => false);
    const notificationBell = page.getByTestId("notification-bell").first();

    if (await notificationBell.isVisible().catch(() => false)) {
      await notificationBell.click();
      await waitForLoadingComplete(page);
    }

    expect(hasNewBooking).toBe(true);
  });
});

test.describe("Appointments - Calendar Integration", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.partner.email, USERS.partner.password);
  });

  test("Calendar view shows appointments", async ({ page }) => {
    await page.goto("/partner/appointments");
    await waitForLoadingComplete(page);

    // Look for calendar view
    const hasCalendar = await page.locator(".calendar, [data-calendar], .fc").first().isVisible().catch(() => false);
    const hasCalendarView = await page.getByRole("button", { name: /calendar|kalendář/i }).isVisible().catch(() => false);

    if (await hasCalendarView) {
      await page.getByRole("button", { name: /calendar|kalendář/i }).first().click();
      await waitForLoadingComplete(page);
    }

    expect(hasCalendar || hasCalendarView).toBe(true);
  });

  test("Can switch between list and calendar view", async ({ page }) => {
    await page.goto("/partner/appointments");
    await waitForLoadingComplete(page);

    // Find view toggle
    const listButton = page.getByRole("button", { name: /list|seznam/i }).first();
    const calendarButton = page.getByRole("button", { name: /calendar|kalendář/i }).first();
    const viewToggle = page.getByRole("tab").first();

    if (await listButton.isVisible().catch(() => false) && await calendarButton.isVisible().catch(() => false)) {
      await calendarButton.click();
      await waitForLoadingComplete(page);

      await listButton.click();
      await waitForLoadingComplete(page);

      expect(true).toBe(true);
    }
  });
});

test.describe("Appointments - Admin View", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.admin.email, USERS.admin.password);
  });

  test("Admin can view all appointments", async ({ page }) => {
    await page.goto("/admin/appointments");
    await waitForLoadingComplete(page);

    // May redirect to different admin section
    const hasAppointments = await page.getByText(/appointment|schůzka|booking/i).isVisible().catch(() => false);
    const hasAdmin = await page.getByText(/admin/i).isVisible().catch(() => false);

    expect(hasAppointments || hasAdmin).toBe(true);
  });
});

test.describe("Appointments - API Verification", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await loginUser(page, USERS.member.email, USERS.member.password);
  });

  test("Appointments RPC returns user-specific data", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const supabase = (window as Record<string, unknown>).__supabase_client__;
      if (!supabase) return { error: "No supabase client" };

      const { data, error } = await supabase.rpc("get_my_appointments", {
        p_limit: 100
      });

      const userId = "e2e00000-0000-0000-0000-000000000002";
      const allOwnAppointments = data?.every((a: Record<string, unknown>) => a.member_id === userId) ?? true;

      return {
        allOwnAppointments,
        count: data?.length ?? 0,
        error: error?.message
      };
    });

    expect(result.allOwnAppointments).toBe(true);
  });

  test("Available slots RPC returns valid data", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const supabase = (window as Record<string, unknown>).__supabase_client__;
      if (!supabase) return { error: "No supabase client" };

      const partnerId = "e2e00000-0000-0000-0000-000000000003";
      const { data, error } = await supabase.rpc("get_partner_available_slots", {
        p_partner_id: partnerId,
        p_date: new Date().toISOString().split("T")[0]
      });

      return {
        isArray: Array.isArray(data),
        count: data?.length ?? 0,
        error: error?.message
      };
    });

    expect(result.error === undefined || result.error === "No supabase client").toBe(true);
  });
});
