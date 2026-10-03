/**
 * Which photos a step asks for — and how many are in hand.
 *
 * The slots are DATA. The driver design names three (unloading, the delivery
 * note, the state of the place), but those are transport vocabulary and have no
 * business being compiled into the app: a different process wants different
 * shots, and a client should not need a release to say so. The workflow node's
 * template config carries them, exactly like the reward it already declares.
 *
 * A step that declares none still gets one unnamed slot — photographing
 * something is a reasonable thing to allow anywhere, and refusing to draw
 * anything would make "no configuration" indistinguishable from "not allowed".
 */
import type { Json } from "@/types/database";

export interface PhotoSlot {
  /** Stable key stored with the photo; never shown to a person. */
  key: string;
  /** i18n key for the label, or undefined → the generic caption. */
  label_key?: string;
}

/** The one slot a step gets when its template says nothing. */
export const DEFAULT_SLOT: PhotoSlot = { key: "photo" };

/**
 * Slots declared by the node's `input_data.photo_slots`.
 *
 * Defensive because template config is data written by humans: anything that is
 * not a usable slot is dropped rather than rendered as an empty tile, and a
 * duplicate key would silently overwrite a captured photo, so the first wins.
 */
export function photoSlots(inputData: Json | null | undefined): PhotoSlot[] {
  const raw = (inputData as { photo_slots?: unknown } | null)?.photo_slots;
  if (!Array.isArray(raw)) return [DEFAULT_SLOT];

  const seen = new Set<string>();
  const slots: PhotoSlot[] = [];
  for (const entry of raw) {
    const key = typeof entry === "string" ? entry : (entry as PhotoSlot)?.key;
    if (typeof key !== "string" || !key.trim() || seen.has(key)) continue;
    seen.add(key);
    const label_key = typeof entry === "object" && entry ? (entry as PhotoSlot).label_key : undefined;
    slots.push(label_key ? { key, label_key } : { key });
  }
  return slots.length ? slots : [DEFAULT_SLOT];
}

/** One captured photo, before it is uploaded. */
export interface CapturedPhoto {
  /** Local file URI from the picker. */
  uri: string;
  /** When the shutter fired, as the device saw it. */
  takenAt: string;
  mimeType?: string;
  fileSizeBytes?: number;
}

export type PhotoSet = Record<string, CapturedPhoto | undefined>;

/** How many slots actually hold a photo — what the summary reports. */
export function photoCount(photos: PhotoSet): number {
  return Object.values(photos).filter(Boolean).length;
}

/**
 * Toggle a slot: capture replaces, tapping a filled slot clears it.
 *
 * Returned fresh rather than mutated so the caller's state update is a plain
 * assignment and React sees a new object.
 */
export function setSlot(photos: PhotoSet, key: string, photo: CapturedPhoto | undefined): PhotoSet {
  const next: PhotoSet = { ...photos };
  if (photo) next[key] = photo;
  else delete next[key];
  return next;
}
