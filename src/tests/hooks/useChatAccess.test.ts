import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import { getGuardrailsForAccessLevel, useChatAccess } from "@/hooks/useChatAccess";

const mocks = vi.hoisted(() => ({
  useSession: vi.fn(),
  useMembership: vi.fn(),
  useRIIMembership: vi.fn(),
  useMyRegistrations: vi.fn(),
}));

vi.mock("@/hooks/useSession", () => ({ useSession: () => mocks.useSession() }));
vi.mock("@/hooks/useMembership", () => ({ useMembership: () => mocks.useMembership() }));
vi.mock("@/hooks/useRIIMembership", () => ({ useRIIMembership: () => mocks.useRIIMembership() }));
vi.mock("@/hooks/useStudies", () => ({ useMyRegistrations: () => mocks.useMyRegistrations() }));

describe("useChatAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mocks.useMembership).mockReturnValue({ membership: null, loading: false });
    vi.mocked(mocks.useRIIMembership).mockReturnValue({
      isRIIMember: false,
      isPendingRII: false,
      isRIIActive: false,
      hasCompletedQuestionnaire: false,
      canTakeQualificationTest: false,
      isLoading: false,
    });
    vi.mocked(mocks.useMyRegistrations).mockReturnValue({ registrations: [], loading: false });
  });

  it("blocks unauthenticated users", () => {
    vi.mocked(mocks.useSession).mockReturnValue({ user: null, isLoading: false });

    const { result } = renderHook(() => useChatAccess());

    expect(result.current.canChat).toBe(false);
    expect(result.current.blockReason).toBe("not_authenticated");
  });

  it("returns pending_approval for pending RII users", () => {
    vi.mocked(mocks.useSession).mockReturnValue({ user: { id: "u1" }, isLoading: false });
    vi.mocked(mocks.useRIIMembership).mockReturnValue({
      isRIIMember: false,
      isPendingRII: true,
      isRIIActive: false,
      hasCompletedQuestionnaire: true,
      canTakeQualificationTest: false,
      isLoading: false,
    });

    const { result } = renderHook(() => useChatAccess());

    expect(result.current.canChat).toBe(false);
    expect(result.current.blockReason).toBe("pending_approval");
    expect(result.current.accessLevel).toBe("enrolled");
  });

  it("grants premium access for upgraded tier", () => {
    vi.mocked(mocks.useSession).mockReturnValue({ user: { id: "u1" }, isLoading: false });
    vi.mocked(mocks.useMembership).mockReturnValue({ membership: { tier: "upgraded" }, loading: false });
    vi.mocked(mocks.useRIIMembership).mockReturnValue({
      isRIIMember: true,
      isPendingRII: false,
      isRIIActive: true,
      hasCompletedQuestionnaire: true,
      canTakeQualificationTest: true,
      isLoading: false,
    });

    const { result } = renderHook(() => useChatAccess());

    expect(result.current.canChat).toBe(true);
    expect(result.current.accessLevel).toBe("premium");
  });
});

describe("getGuardrailsForAccessLevel", () => {
  it("uses strict defaults for none", () => {
    const guardrails = getGuardrailsForAccessLevel("none");
    expect(guardrails.allowMedicalAdvice).toBe(false);
    expect(guardrails.requireDisclaimer).toBe(true);
  });

  it("enables advanced capabilities for premium", () => {
    const guardrails = getGuardrailsForAccessLevel("premium");
    expect(guardrails.maxResponseLength).toBe(5000);
    expect(guardrails.allowMedicalAdvice).toBe(true);
    expect(guardrails.requireDisclaimer).toBe(false);
  });
});
