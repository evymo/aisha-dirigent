/**
 * Tests for src/hooks/useAdminHeroSlides.ts
 *
 * Two exports, but `useAdminHeroSlides` is *compound* — one composite hook
 * that exposes a query + 3 mutations (create/update/delete) plus their
 * loading flags. We test each operation via the returned API surface.
 *
 *   - useAdminHeroSlides:
 *       - slides[]                          (query result)
 *       - createSlide(payload)              (create_hero_slide_admin)
 *       - updateSlide({ id, data })         (update_hero_slide_admin)
 *       - deleteSlide(id)                   (delete_hero_slide_admin)
 *   - useHeroImageUpload:
 *       - uploadImage(file)                 (storage; validation gate)
 *
 * NOT tested (out of scope for unit-test layer):
 *   - aisha.storage.upload / getPublicUrl happy path — that's an
 *     integration concern. We DO test the client-side validation gates
 *     (file size, file type) since those are pure local logic.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  useAdminHeroSlides,
  useHeroImageUpload,
} from "@/hooks/useAdminHeroSlides";

const {
  mockRpc,
  mockStorageUpload,
  mockStorageGetPublicUrl,
  mockHasPermission,
  mockUser,
  mockGuardAdminMutation,
  mockToastSuccess,
  mockToastError,
} = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockStorageUpload: vi.fn(),
  mockStorageGetPublicUrl: vi.fn(() => ({
    data: { publicUrl: "https://example.test/hero-images/abc.jpg" },
  })),
  mockHasPermission: vi.fn(),
  mockUser: { id: "admin-id" },
  mockGuardAdminMutation: (_rpc: string, fn: (args: unknown) => unknown) => fn,
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock("@/integrations/db/client", () => ({
  aisha: {
    rpc: mockRpc,
    storage: {
      from: vi.fn(() => ({
        upload: mockStorageUpload,
        getPublicUrl: mockStorageGetPublicUrl,
      })),
    },
  },
}));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ hasPermission: mockHasPermission }),
}));
vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({ user: mockUser, isLoading: false }),
}));
vi.mock("@/hooks/useAdminGuard", () => ({
  useAdminGuard: () => ({ guardAdminMutation: mockGuardAdminMutation }),
}));
vi.mock("sonner", () => ({
  toast: {
    success: mockToastSuccess,
    error: mockToastError,
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

function createWrapper(qc?: QueryClient) {
  const queryClient =
    qc ??
    new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  return { Wrapper, queryClient };
}

const UUID_SLIDE = "c0000000-0000-4000-a000-000000000001";
const UUID_PRODUCT = "c0000000-0000-4000-a000-000000000002";

const mockSlideRow = {
  id: UUID_SLIDE,
  base_locale: "cs",
  title_key: "hero.slide1.title",
  subtitle_key: "hero.slide1.subtitle",
  badge_key: "hero.slide1.badge",
  target_audience: "all",
  background_image_url: "https://example.test/bg.jpg",
  background_gradient: "linear-gradient(45deg, #000, #fff)",
  cta_text_key: "hero.slide1.cta",
  cta_url: "/about",
  linked_product_id: null,
  linked_product_name: "",
  is_active: true,
  sort_order: 10,
  created_at: "2026-03-01T00:00:00Z",
  updated_at: "2026-03-01T01:00:00Z",
  circle_icon_key: "hero.slide1.circleIcon",
  circle_text_key: "hero.slide1.circleText",
};

// ── useAdminHeroSlides (compound) ──────────────────────────────

describe("useAdminHeroSlides — query", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("fetches hero slides via get_hero_slides_admin", async () => {
    mockRpc.mockResolvedValue({ data: [mockSlideRow], error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useAdminHeroSlides(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockRpc).toHaveBeenCalledWith("get_hero_slides_admin");
    expect(result.current.slides).toHaveLength(1);
    expect(result.current.slides?.[0].id).toBe(UUID_SLIDE);
  });

  it("returns undefined slides + isLoading=false when admin permission is denied", async () => {
    mockHasPermission.mockReturnValue(false);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useAdminHeroSlides(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

// ── useAdminHeroSlides — createSlide ───────────────────────────

describe("useAdminHeroSlides — createSlide", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls create_hero_slide_admin with target_audience default 'all' and is_active default true", async () => {
    mockRpc
      .mockResolvedValueOnce({ data: [], error: null }) // initial query
      .mockResolvedValueOnce({ data: UUID_SLIDE, error: null }); // create

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useAdminHeroSlides(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      result.current.createSlide({ title_key: "x.t" });
    });

    await waitFor(() => expect(result.current.isCreating).toBe(false));

    const createCall = mockRpc.mock.calls.find(
      (c) => c[0] === "create_hero_slide_admin",
    );
    expect(createCall).toBeTruthy();
    expect(createCall?.[1]).toMatchObject({
      p_title_key: "x.t",
      p_target_audience: "all",
      p_is_active: true,
      p_sort_order: 0,
    });
    expect(mockToastSuccess).toHaveBeenCalledWith("admin.heroSlides.created");
  });

  it("surfaces an i18n-keyed error toast when the create RPC fails", async () => {
    mockRpc
      .mockResolvedValueOnce({ data: [], error: null }) // initial query
      .mockResolvedValueOnce({
        data: null,
        error: { message: "duplicate sort_order" },
      });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useAdminHeroSlides(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      result.current.createSlide({ title_key: "x.t" });
    });

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith(
        "admin.heroSlides.errors.createFailed",
      ),
    );
  });
});

// ── useAdminHeroSlides — updateSlide ───────────────────────────

describe("useAdminHeroSlides — updateSlide", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls update_hero_slide_admin with p_id threaded through", async () => {
    mockRpc
      .mockResolvedValueOnce({ data: [mockSlideRow], error: null }) // initial
      .mockResolvedValueOnce({ data: null, error: null }); // update

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useAdminHeroSlides(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      result.current.updateSlide({
        id: UUID_SLIDE,
        data: { is_active: false, sort_order: 5 },
      });
    });
    await waitFor(() => expect(result.current.isUpdating).toBe(false));

    const updateCall = mockRpc.mock.calls.find(
      (c) => c[0] === "update_hero_slide_admin",
    );
    expect(updateCall?.[1]).toMatchObject({
      p_id: UUID_SLIDE,
      p_is_active: false,
      p_sort_order: 5,
    });
    expect(mockToastSuccess).toHaveBeenCalledWith("admin.heroSlides.updated");
  });
});

// ── useAdminHeroSlides — deleteSlide ───────────────────────────

describe("useAdminHeroSlides — deleteSlide", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls delete_hero_slide_admin with p_id", async () => {
    mockRpc
      .mockResolvedValueOnce({ data: [mockSlideRow], error: null }) // initial
      .mockResolvedValueOnce({ data: null, error: null }); // delete

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useAdminHeroSlides(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      result.current.deleteSlide(UUID_SLIDE);
    });
    await waitFor(() => expect(result.current.isDeleting).toBe(false));

    expect(mockRpc).toHaveBeenCalledWith("delete_hero_slide_admin", {
      p_id: UUID_SLIDE,
    });
    expect(mockToastSuccess).toHaveBeenCalledWith("admin.heroSlides.deleted");
  });

  it("surfaces error toast on delete failure (e.g. FK violation)", async () => {
    mockRpc
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { message: "FK violation: slide referenced by translations" },
      });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useAdminHeroSlides(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      result.current.deleteSlide(UUID_SLIDE);
    });

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith(
        "admin.heroSlides.errors.deleteFailed",
      ),
    );
  });
});

// ── useHeroImageUpload ─────────────────────────────────────────

describe("useHeroImageUpload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeFile(name: string, type: string, sizeBytes: number) {
    // Browser File constructor in JSDOM accepts an array of BlobParts;
    // we pass a single Uint8Array sized to the requested byte count.
    const blob = new Blob([new Uint8Array(sizeBytes)], { type });
    return new File([blob], name, { type });
  }

  it("rejects unsupported mime types before any storage call", async () => {
    const { result } = renderHook(() => useHeroImageUpload());
    const badFile = makeFile("evil.svg", "image/svg+xml", 100);

    await expect(result.current.uploadImage(badFile)).rejects.toThrow(
      "Unsupported hero image type",
    );
    expect(mockStorageUpload).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalled();
  });

  it("rejects files larger than 5 MiB before storage call", async () => {
    const { result } = renderHook(() => useHeroImageUpload());
    const oversized = makeFile("big.jpg", "image/jpeg", 5 * 1024 * 1024 + 1);

    await expect(result.current.uploadImage(oversized)).rejects.toThrow(
      "Hero image too large",
    );
    expect(mockStorageUpload).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalled();
  });

  it("happy path: uploads accepted file and returns publicUrl", async () => {
    mockStorageUpload.mockResolvedValue({ error: null });

    const { result } = renderHook(() => useHeroImageUpload());
    const file = makeFile("ok.png", "image/png", 1024);

    const url = await result.current.uploadImage(file);
    expect(mockStorageUpload).toHaveBeenCalledTimes(1);
    expect(url).toBe("https://example.test/hero-images/abc.jpg");
  });

  it("surfaces storage upload errors", async () => {
    mockStorageUpload.mockResolvedValue({
      error: { message: "storage 500 internal error" },
    });

    const { result } = renderHook(() => useHeroImageUpload());
    const file = makeFile("ok.png", "image/png", 1024);

    await expect(result.current.uploadImage(file)).rejects.toThrow(
      "storage 500",
    );
    expect(mockToastError).toHaveBeenCalled();
  });
});
