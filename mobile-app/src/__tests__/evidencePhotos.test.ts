import { DEFAULT_SLOT, photoCount, photoSlots, setSlot } from "@/lib/evidencePhotos";
import type { CapturedPhoto, PhotoSet } from "@/lib/evidencePhotos";

const shot = (uri: string): CapturedPhoto => ({ uri, takenAt: "2026-08-03T10:00:00.000Z" });

describe("photoSlots", () => {
  it("reads the slots the node's template declares", () => {
    expect(
      photoSlots({ photo_slots: [{ key: "dl", label_key: "x.dl" }, { key: "misto" }] }),
    ).toEqual([{ key: "dl", label_key: "x.dl" }, { key: "misto" }]);
  });

  it("accepts bare strings, because template config is written by people", () => {
    expect(photoSlots({ photo_slots: ["dl", "misto"] })).toEqual([{ key: "dl" }, { key: "misto" }]);
  });

  it("gives one unnamed slot when the step declares nothing", () => {
    // "No configuration" must not be indistinguishable from "not allowed".
    expect(photoSlots(null)).toEqual([DEFAULT_SLOT]);
    expect(photoSlots({})).toEqual([DEFAULT_SLOT]);
    expect(photoSlots({ photo_slots: "nonsense" })).toEqual([DEFAULT_SLOT]);
    expect(photoSlots({ photo_slots: [] })).toEqual([DEFAULT_SLOT]);
  });

  it("drops entries that are not usable slots instead of drawing empty tiles", () => {
    expect(photoSlots({ photo_slots: [{ key: "dl" }, null, 42, { label_key: "no.key" }, { key: "  " }] }))
      .toEqual([{ key: "dl" }]);
  });

  it("keeps the first of a duplicated key — a second would overwrite a captured photo", () => {
    expect(photoSlots({ photo_slots: [{ key: "dl", label_key: "first" }, { key: "dl", label_key: "second" }] }))
      .toEqual([{ key: "dl", label_key: "first" }]);
  });
});

describe("photoCount", () => {
  it("counts only slots that actually hold a photo", () => {
    expect(photoCount({})).toBe(0);
    expect(photoCount({ dl: shot("a"), misto: undefined })).toBe(1);
    expect(photoCount({ dl: shot("a"), misto: shot("b") })).toBe(2);
  });
});

describe("setSlot", () => {
  it("captures into a slot without touching the others", () => {
    const next = setSlot({ dl: shot("a") }, "misto", shot("b"));
    expect(next.dl?.uri).toBe("a");
    expect(next.misto?.uri).toBe("b");
  });

  it("clears a slot when given nothing, leaving no empty key behind", () => {
    const next = setSlot({ dl: shot("a"), misto: shot("b") }, "dl", undefined);
    expect("dl" in next).toBe(false);
    expect(photoCount(next)).toBe(1);
  });

  it("returns a new object so React sees the change", () => {
    const before: PhotoSet = { dl: shot("a") };
    expect(setSlot(before, "misto", shot("b"))).not.toBe(before);
    // ...and the original is untouched, so no caller can be surprised by aliasing.
    expect(before.misto).toBeUndefined();
  });
});
