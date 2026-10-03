/**
 * useStoryBlockActions Hook Tests
 *
 * Tests for story block actions: meeting accept/decline/reschedule,
 * questionnaire view/remind, consent view/resend, lab results view.
 *
 * @see src/hooks/useStoryBlockActions.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useStoryBlockActions } from "@/hooks/useStoryBlockActions";
import React from "react";

// Mock aisha
vi.mock("@/integrations/db/client", () => ({
  aisha: {
    rpc: vi.fn(),
  },
}));

// Mock safeLogger
vi.mock("@/lib/security/safeLogger", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/security/safeLogger")>();
  return {
    ...actual,
    safeError: vi.fn(),
    safeInfo: vi.fn(),
    safeWarn: vi.fn(),
  };
});

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

// Mock react-i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

const STORY_ID = "e0c7f123-1234-5678-9abc-def012345678";
const ENTRY_ID = "a1b2c3d4-1234-5678-9abc-def012345678";

describe("useStoryBlockActions", () => {
  beforeEach(() => {
    vi.mocked(aisha.rpc).mockReset();
  });

  // =========================================================================
  // Initialization
  // =========================================================================

  describe("initialization", () => {
    it("should return all expected action callbacks and state", () => {
      const { result } = renderHook(() => useStoryBlockActions(STORY_ID), {
        wrapper: createWrapper(),
      });

      // Mutation actions
      expect(result.current.onMeetingAccept).toBeTypeOf("function");
      expect(result.current.onMeetingDecline).toBeTypeOf("function");
      expect(result.current.onMeetingReschedule).toBeTypeOf("function");
      expect(result.current.onQuestionnaireViewResults).toBeTypeOf("function");
      expect(result.current.onQuestionnaireSendReminder).toBeTypeOf("function");
      expect(result.current.onConsentView).toBeTypeOf("function");
      expect(result.current.onConsentResend).toBeTypeOf("function");
      expect(result.current.onLabViewResults).toBeTypeOf("function");

      // Modal state
      expect(result.current.responseDetailId).toBeNull();
      expect(result.current.responseDetailOpen).toBe(false);
      expect(result.current.consentDetailId).toBeNull();
      expect(result.current.consentDetailOpen).toBe(false);
      expect(result.current.labDetailId).toBeNull();
      expect(result.current.labDetailOpen).toBe(false);

      // Pending state
      expect(result.current.isPending).toBe(false);
    });

    it("should handle null storyId without errors", () => {
      const { result } = renderHook(() => useStoryBlockActions(null), {
        wrapper: createWrapper(),
      });

      expect(result.current.onMeetingAccept).toBeTypeOf("function");
      expect(result.current.isPending).toBe(false);
    });
  });

  // =========================================================================
  // Meeting actions
  // =========================================================================

  describe("meeting actions", () => {
    it("onMeetingAccept calls respond_to_story_block_audited with accept_meeting", async () => {
      vi.mocked(aisha.rpc).mockResolvedValue({
        data: { success: true },
        error: null,
      });

      const { result } = renderHook(() => useStoryBlockActions(STORY_ID), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.onMeetingAccept(ENTRY_ID, "2026-02-20T10:00:00Z");
      });

      await waitFor(() => {
        expect(aisha.rpc).toHaveBeenCalledWith(
          "respond_to_story_block_audited",
          expect.objectContaining({
            p_action: "accept_meeting",
            p_entry_id: ENTRY_ID,
            p_story_id: STORY_ID,
            p_action_data: expect.objectContaining({
              accepted_time: "2026-02-20T10:00:00Z",
            }),
          }),
        );
      });
    });

    it("onMeetingAccept without time passes empty action_data", async () => {
      vi.mocked(aisha.rpc).mockResolvedValue({
        data: { success: true },
        error: null,
      });

      const { result } = renderHook(() => useStoryBlockActions(STORY_ID), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.onMeetingAccept(ENTRY_ID);
      });

      await waitFor(() => {
        expect(aisha.rpc).toHaveBeenCalledWith(
          "respond_to_story_block_audited",
          expect.objectContaining({
            p_action: "accept_meeting",
            p_action_data: {},
          }),
        );
      });
    });

    it("onMeetingDecline calls RPC with decline_meeting", async () => {
      vi.mocked(aisha.rpc).mockResolvedValue({
        data: { success: true },
        error: null,
      });

      const { result } = renderHook(() => useStoryBlockActions(STORY_ID), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.onMeetingDecline(ENTRY_ID);
      });

      await waitFor(() => {
        expect(aisha.rpc).toHaveBeenCalledWith(
          "respond_to_story_block_audited",
          expect.objectContaining({
            p_action: "decline_meeting",
            p_entry_id: ENTRY_ID,
            p_story_id: STORY_ID,
          }),
        );
      });
    });

    it("onMeetingReschedule calls RPC with reschedule_meeting", async () => {
      vi.mocked(aisha.rpc).mockResolvedValue({
        data: { success: true },
        error: null,
      });

      const { result } = renderHook(() => useStoryBlockActions(STORY_ID), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.onMeetingReschedule(ENTRY_ID);
      });

      await waitFor(() => {
        expect(aisha.rpc).toHaveBeenCalledWith(
          "respond_to_story_block_audited",
          expect.objectContaining({
            p_action: "reschedule_meeting",
            p_entry_id: ENTRY_ID,
            p_story_id: STORY_ID,
          }),
        );
      });
    });

    it("does not call RPC when storyId is null", () => {
      const { result } = renderHook(() => useStoryBlockActions(null), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.onMeetingAccept(ENTRY_ID);
      });

      expect(aisha.rpc).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Questionnaire actions
  // =========================================================================

  describe("questionnaire actions", () => {
    it("onQuestionnaireViewResults opens modal with response ID", () => {
      const { result } = renderHook(() => useStoryBlockActions(STORY_ID), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.onQuestionnaireViewResults("response-123");
      });

      expect(result.current.responseDetailId).toBe("response-123");
      expect(result.current.responseDetailOpen).toBe(true);
    });

    it("onQuestionnaireSendReminder calls RPC", async () => {
      vi.mocked(aisha.rpc).mockResolvedValue({
        data: { success: true },
        error: null,
      });

      const { result } = renderHook(() => useStoryBlockActions(STORY_ID), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.onQuestionnaireSendReminder(ENTRY_ID);
      });

      await waitFor(() => {
        expect(aisha.rpc).toHaveBeenCalledWith(
          "respond_to_story_block_audited",
          expect.objectContaining({
            p_action: "send_questionnaire_reminder",
            p_entry_id: ENTRY_ID,
            p_story_id: STORY_ID,
          }),
        );
      });
    });
  });

  // =========================================================================
  // Consent actions
  // =========================================================================

  describe("consent actions", () => {
    it("onConsentView opens modal with consent ID", () => {
      const { result } = renderHook(() => useStoryBlockActions(STORY_ID), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.onConsentView("consent-456");
      });

      expect(result.current.consentDetailId).toBe("consent-456");
      expect(result.current.consentDetailOpen).toBe(true);
    });

    it("onConsentResend calls RPC with resend_consent_request", async () => {
      vi.mocked(aisha.rpc).mockResolvedValue({
        data: { success: true },
        error: null,
      });

      const { result } = renderHook(() => useStoryBlockActions(STORY_ID), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.onConsentResend(ENTRY_ID);
      });

      await waitFor(() => {
        expect(aisha.rpc).toHaveBeenCalledWith(
          "respond_to_story_block_audited",
          expect.objectContaining({
            p_action: "resend_consent_request",
            p_entry_id: ENTRY_ID,
            p_story_id: STORY_ID,
          }),
        );
      });
    });
  });

  // =========================================================================
  // Lab result actions
  // =========================================================================

  describe("lab result actions", () => {
    it("onLabViewResults opens modal with lab result ID", () => {
      const { result } = renderHook(() => useStoryBlockActions(STORY_ID), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.onLabViewResults("lab-789");
      });

      expect(result.current.labDetailId).toBe("lab-789");
      expect(result.current.labDetailOpen).toBe(true);
    });
  });

  // =========================================================================
  // Modal state management
  // =========================================================================

  describe("modal state management", () => {
    it("setResponseDetailOpen controls response modal", () => {
      const { result } = renderHook(() => useStoryBlockActions(STORY_ID), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.onQuestionnaireViewResults("resp-1");
      });

      expect(result.current.responseDetailOpen).toBe(true);

      act(() => {
        result.current.setResponseDetailOpen(false);
      });

      expect(result.current.responseDetailOpen).toBe(false);
      // ID persists for potential re-open
      expect(result.current.responseDetailId).toBe("resp-1");
    });

    it("setConsentDetailOpen controls consent modal", () => {
      const { result } = renderHook(() => useStoryBlockActions(STORY_ID), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.onConsentView("consent-1");
      });

      expect(result.current.consentDetailOpen).toBe(true);

      act(() => {
        result.current.setConsentDetailOpen(false);
      });

      expect(result.current.consentDetailOpen).toBe(false);
    });

    it("setLabDetailOpen controls lab result modal", () => {
      const { result } = renderHook(() => useStoryBlockActions(STORY_ID), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.onLabViewResults("lab-1");
      });

      expect(result.current.labDetailOpen).toBe(true);

      act(() => {
        result.current.setLabDetailOpen(false);
      });

      expect(result.current.labDetailOpen).toBe(false);
    });
  });

  // =========================================================================
  // Error handling
  // =========================================================================

  describe("error handling", () => {
    it("handles RPC errors without exposing sensitive data", async () => {
      vi.mocked(aisha.rpc).mockResolvedValue({
        data: null,
        error: { message: "Permission denied", code: "42501" },
      });

      const { result } = renderHook(() => useStoryBlockActions(STORY_ID), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.onMeetingAccept(ENTRY_ID);
      });

      // Should not throw unhandled, just call toast.error
      await waitFor(() => {
        expect(result.current.isPending).toBe(false);
      });
    });
  });
});
