import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useScrollReveal, useRevealClass, getStaggerDelay } from "@/hooks/useScrollReveal";

// ---------------------------------------------------------------------------
// IntersectionObserver mock
// ---------------------------------------------------------------------------

type IOCallback = (entries: IntersectionObserverEntry[]) => void;

let observerInstances: Array<{
  callback: IOCallback;
  options: IntersectionObserverInit | undefined;
  elements: Set<Element>;
}>;

function triggerIntersect(element: Element, isIntersecting: boolean) {
  for (const instance of observerInstances) {
    if (instance.elements.has(element)) {
      const entry = { isIntersecting, target: element } as unknown as IntersectionObserverEntry;
      instance.callback([entry]);
      return;
    }
  }
  throw new Error("Element is not observed by any IntersectionObserver");
}

beforeEach(() => {
  observerInstances = [];

  // @ts-expect-error -- mock IntersectionObserver for JSDOM
  globalThis.IntersectionObserver = class MockIO {
    private _cb: IOCallback;
    private _opts: IntersectionObserverInit | undefined;
    elements = new Set<Element>();

    constructor(cb: IOCallback, opts?: IntersectionObserverInit) {
      this._cb = cb;
      this._opts = opts;
      observerInstances.push({ callback: cb, options: opts, elements: this.elements });
    }

    observe(el: Element) {
      this.elements.add(el);
    }
    unobserve(el: Element) {
      this.elements.delete(el);
    }
    disconnect() {
      this.elements.clear();
    }
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// useScrollReveal
// ---------------------------------------------------------------------------
describe("useScrollReveal", () => {
  it("starts with isVisible false", () => {
    const { result } = renderHook(() => useScrollReveal());
    expect(result.current.isVisible).toBe(false);
  });

  it("returns a stable callback ref", () => {
    const { result, rerender } = renderHook(() => useScrollReveal());
    const firstRef = result.current.ref;
    rerender();
    expect(result.current.ref).toBe(firstRef);
  });

  it("sets isVisible to true when element intersects", () => {
    const { result } = renderHook(() => useScrollReveal());

    // Simulate DOM attachment via callback ref
    const el = document.createElement("div");
    act(() => {
      result.current.ref(el);
    });

    expect(result.current.isVisible).toBe(false);

    // Simulate intersection
    act(() => {
      triggerIntersect(el, true);
    });

    expect(result.current.isVisible).toBe(true);
  });

  it("unobserves after first intersection when once=true (default)", () => {
    const { result } = renderHook(() => useScrollReveal());
    const el = document.createElement("div");
    act(() => {
      result.current.ref(el);
    });

    act(() => {
      triggerIntersect(el, true);
    });

    // After unobserve the element should no longer be tracked
    const instance = observerInstances.find((i) => i.elements.size >= 0);
    expect(instance).toBeDefined();
    // Element was unobserved — set should not contain it
    expect(instance!.elements.has(el)).toBe(false);
  });

  it("toggles visibility when once=false", () => {
    const { result } = renderHook(() => useScrollReveal({ once: false }));
    const el = document.createElement("div");
    act(() => {
      result.current.ref(el);
    });

    act(() => {
      triggerIntersect(el, true);
    });
    expect(result.current.isVisible).toBe(true);

    act(() => {
      triggerIntersect(el, false);
    });
    expect(result.current.isVisible).toBe(false);
  });

  it("passes custom threshold and rootMargin to IntersectionObserver", () => {
    const { result } = renderHook(() =>
      useScrollReveal({ threshold: 0.5, rootMargin: "10px" })
    );

    const el = document.createElement("div");
    act(() => {
      result.current.ref(el);
    });

    const instance = observerInstances[observerInstances.length - 1];
    expect(instance.options?.threshold).toBe(0.5);
    expect(instance.options?.rootMargin).toBe("10px");
  });

  it("handles deferred ref attachment (loading → data pattern)", () => {
    // Simulates the critical bug: component first renders loading state
    // without attaching the ref, then re-renders with the ref attached.
    const { result, rerender } = renderHook(() => useScrollReveal());

    // Phase 1: no element attached (loading state)
    expect(result.current.isVisible).toBe(false);
    expect(observerInstances.length).toBe(0);

    // Phase 2: simulate data loaded — element gets attached
    rerender();
    const el = document.createElement("div");
    act(() => {
      result.current.ref(el);
    });

    // Observer should now be active
    expect(observerInstances.length).toBeGreaterThan(0);
    const hasElement = observerInstances.some((i) => i.elements.has(el));
    expect(hasElement).toBe(true);

    // Intersect → visible
    act(() => {
      triggerIntersect(el, true);
    });
    expect(result.current.isVisible).toBe(true);
  });

  it("cleans up observer when ref is detached (element set to null)", () => {
    const { result } = renderHook(() => useScrollReveal());
    const el = document.createElement("div");
    act(() => {
      result.current.ref(el);
    });

    // Observer tracking the element
    const activeInstance = observerInstances.find((i) => i.elements.has(el));
    expect(activeInstance).toBeDefined();

    // Detach — simulates component unmount / conditional rendering
    act(() => {
      result.current.ref(null);
    });

    // Previous observer should have disconnected (elements cleared)
    expect(activeInstance!.elements.has(el)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// useRevealClass
// ---------------------------------------------------------------------------
describe("useRevealClass", () => {
  it("returns reveal-hidden class when not visible (default variant)", () => {
    const { result } = renderHook(() => useRevealClass());
    expect(result.current.className).toBe("reveal-fade-up reveal-hidden");
    expect(result.current.isVisible).toBe(false);
  });

  it("returns reveal-visible class when element intersects", () => {
    const { result } = renderHook(() => useRevealClass("fade-scale"));
    const el = document.createElement("div");
    act(() => {
      result.current.ref(el);
    });
    act(() => {
      triggerIntersect(el, true);
    });
    expect(result.current.className).toBe("reveal-fade-scale reveal-visible");
    expect(result.current.isVisible).toBe(true);
  });

  it.each([
    ["fade-up", "reveal-fade-up"],
    ["fade-in", "reveal-fade-in"],
    ["fade-scale", "reveal-fade-scale"],
    ["slide-left", "reveal-slide-left"],
    ["slide-right", "reveal-slide-right"],
  ] as const)("supports variant %s", (variant, expectedBase) => {
    const { result } = renderHook(() => useRevealClass(variant));
    expect(result.current.className).toContain(expectedBase);
  });
});

// ---------------------------------------------------------------------------
// getStaggerDelay
// ---------------------------------------------------------------------------
describe("getStaggerDelay", () => {
  it("returns correct transition and animation delay", () => {
    const style = getStaggerDelay(3);
    expect(style).toEqual({
      transitionDelay: "240ms",
      animationDelay: "240ms",
    });
  });

  it("supports custom base milliseconds", () => {
    const style = getStaggerDelay(2, 120);
    expect(style).toEqual({
      transitionDelay: "240ms",
      animationDelay: "240ms",
    });
  });

  it("returns 0ms for index 0", () => {
    const style = getStaggerDelay(0);
    expect(style).toEqual({
      transitionDelay: "0ms",
      animationDelay: "0ms",
    });
  });
});
