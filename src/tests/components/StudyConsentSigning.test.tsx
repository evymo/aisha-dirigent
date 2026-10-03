/**
 * Render tests for the member charter-signing surface.
 *
 * Proves the behaviour that cannot be checked by a type-check: the signature pad
 * only appears for signature-required templates, submit stays disabled until the
 * member actually signs, and the PNG data URL reaches submit_study_consent_acceptance.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockRpc = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && typeof opts.title === "string" ? `${key}:${opts.title}` : key,
    i18n: { language: "cs" },
  }),
}));

vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({ user: { id: "user-1" } }),
}));

vi.mock("@/integrations/db/client", () => ({
  aisha: { rpc: (fn: string, params?: unknown) => mockRpc(fn, params) },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { StudyConsentSigning } from "@/components/member/StudyConsentSigning";

const SIGNED_CONSENT = {
  id: "req-1",
  study_id: "study-1",
  study_name: "ONR Beta",
  consent_template_id: "tpl-1",
  template_key: "onr-charta",
  title: "Charta",
  content: "Znění charty…",
  version: "1.0",
  is_required: true,
  requires_signature: true,
};

function renderSurface() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <StudyConsentSigning />
    </QueryClientProvider>,
  );
}

/** Draw on the canvas so SignatureCanvas registers a signature. */
async function signOn(canvas: HTMLCanvasElement) {
  // jsdom has no real 2D context; stub what SignatureCanvas touches.
  canvas.getContext = vi.fn(() => ({
    strokeStyle: "", lineWidth: 0, lineCap: "", lineJoin: "",
    beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), clearRect: vi.fn(),
  })) as unknown as HTMLCanvasElement["getContext"];
  canvas.toDataURL = vi.fn(() => "data:image/png;base64,SIGNATURE");

  const { fireEvent } = await import("@testing-library/react");
  fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10 });
  fireEvent.mouseMove(canvas, { clientX: 40, clientY: 40 });
  fireEvent.mouseUp(canvas);
}

beforeEach(() => {
  mockRpc.mockReset();
});

describe("StudyConsentSigning", () => {
  it("shows the empty state when nothing is outstanding", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    renderSurface();
    await waitFor(() => expect(screen.getByText("studyConsents.noneOutstanding")).toBeInTheDocument());
  });

  it("requires a signature before submitting a signature-required consent", async () => {
    mockRpc.mockImplementation((fn: string) =>
      fn === "get_my_pending_consents"
        ? Promise.resolve({ data: [SIGNED_CONSENT], error: null })
        : Promise.resolve({ data: null, error: null }),
    );

    const { container } = renderSurface();
    await waitFor(() => expect(screen.getByText("Charta")).toBeInTheDocument());

    const submit = screen.getByRole("button", { name: /studyConsents.submit/ });
    expect(submit).toBeDisabled();

    const canvas = container.querySelector("canvas");
    expect(canvas, "signature pad must render for requires_signature").not.toBeNull();
    await signOn(canvas as HTMLCanvasElement);

    await waitFor(() => expect(submit).toBeEnabled());
    await userEvent.click(submit);

    await waitFor(() => {
      const call = mockRpc.mock.calls.find(([fn]) => fn === "submit_study_consent_acceptance");
      expect(call, "submit RPC must be called").toBeDefined();
      expect(call?.[1]).toMatchObject({
        p_consent_template_id: "tpl-1",
        p_granted: true,
        p_signature_data: "data:image/png;base64,SIGNATURE",
        p_study_id: "study-1",
      });
    });
  });

  it("submits without a signature pad when the template does not require one", async () => {
    mockRpc.mockImplementation((fn: string) =>
      fn === "get_my_pending_consents"
        ? Promise.resolve({
            data: [{ ...SIGNED_CONSENT, id: "req-2", requires_signature: false }],
            error: null,
          })
        : Promise.resolve({ data: null, error: null }),
    );

    const { container } = renderSurface();
    await waitFor(() => expect(screen.getByText("Charta")).toBeInTheDocument());

    expect(container.querySelector("canvas")).toBeNull();
    const submit = screen.getByRole("button", { name: /studyConsents.submit/ });
    expect(submit).toBeEnabled();

    await userEvent.click(submit);
    await waitFor(() => {
      const call = mockRpc.mock.calls.find(([fn]) => fn === "submit_study_consent_acceptance");
      expect(call?.[1]).toMatchObject({ p_signature_data: undefined });
    });
  });
});
