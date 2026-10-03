/**
 * Odeslání fotografické evidence z terénu.
 *
 * JEDNA DRÁHA, DVĚ POUŽITÍ — řidič u sklopky fotí předání, správce fotí
 * elektroměr na zdi. Akvizice je táž, liší se jen entita, ke které snímek patří
 * (`entityKind` + `entityId`), takže tu není „upload předání" a vedle „upload
 * odečtu": druhá kopie by se rozešla při první opravě.
 *
 * Dvoukrokový handshake, protože obrázek NESMÍ téct přes API:
 *   1. preflight — server ověří nárok (má na tu entitu otevřený úkol?), založí
 *      záznam evidence a vrátí PODEPSANOU URL do MinIO,
 *   2. PUT syrových bajtů přímo do úložiště.
 *
 * Zapisovat obrázek do jsonb nebo ho posílat jako base64 v RPC by znamenalo
 * protáhnout megabajty vrstvou, která je čte při každém načtení fronty.
 */
import { api } from "@/config/api";
import { safeError } from "@/lib/security/safeLogger";
import type { CapturedPhoto, PhotoSet } from "@/lib/evidencePhotos";

/** Ke které entitě snímek patří. Uzavřené — server zná tytéž dva druhy. */
export type EvidenceEntityKind = "workflow_step" | "twin";

export interface EvidenceTarget {
  entityKind: EvidenceEntityKind;
  entityId: string;
}

/** Co o snímku víme po odeslání — reference, nikdy obsah. */
export interface UploadedEvidence {
  slot: string;
  objectKey: string;
  takenAt: string;
}

interface PreflightResponse {
  uploadUrl?: string;
  objectKey?: string;
}

/**
 * MIME z přípony, když ho picker neřekl.
 *
 * Server přijímá jen `image/*` a podepsanou URL váže na typ, takže tipovat
 * naslepo nejde. `jpeg` je tu proto, že fotoaparát telefonu nic jiného
 * nevrací — a když přípona řekne něco jiného, respektuje se ONA.
 */
function mimeOf(photo: CapturedPhoto): string {
  if (photo.mimeType) return photo.mimeType;
  const ext = photo.uri.split("?")[0].split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "heic" || ext === "heif") return "image/heic";
  return "image/jpeg";
}

function fileNameOf(photo: CapturedPhoto, slot: string): string {
  const ext = mimeOf(photo).split("/")[1] ?? "jpg";
  return `${slot}.${ext}`;
}

/**
 * Odešle JEDEN snímek. Vrací referenci, ne obsah.
 *
 * Chyba se NEPOLYKÁ: když se evidence neodešle, nesmí předání vypadat jako
 * kompletní. Volající rozhodne, jestli krok přesto dokončit — ale musí to
 * vědět, ne se to dozvědět až při reklamaci.
 */
export async function uploadEvidencePhoto(
  target: EvidenceTarget,
  slot: string,
  photo: CapturedPhoto,
): Promise<UploadedEvidence> {
  const mimeType = mimeOf(photo);
  const blob = await (await fetch(photo.uri)).blob();

  const { data, error } = await api.invoke<PreflightResponse>("upload-entity-evidence-preflight", {
    body: {
      bucket: "entity-evidence",
      filename: fileNameOf(photo, slot),
      contentType: mimeType,
      fileSizeBytes: blob.size,
      entityKind: target.entityKind,
      entityId: target.entityId,
      slot,
    },
  });
  if (error || !data?.uploadUrl || !data?.objectKey) {
    safeError("uploadEvidence.preflight", error);
    throw new Error(error?.message ?? "evidence preflight failed");
  }

  // `uploadUrl` nese vlastní právo (nahrávací token storage-auth, nebo presigned
  // URL tam, kde instance veřejnou adresu storage nemá) — Authorization se sem
  // nepřidává. Od 2026-09-18 míří na API (za dveřmi, které appka otevírá), ne
  // na MinIO: presigned URL nesla mesh host, na který tablet z LTE nedosáhne,
  // a fotky předání proto nikdy neodešly.
  const put = await fetch(data.uploadUrl, {
    method: "PUT",
    body: blob,
    headers: { "Content-Type": mimeType },
  });
  if (!put.ok) {
    safeError("uploadEvidence.put", { status: put.status });
    throw new Error(`evidence upload failed (${put.status})`);
  }

  return { slot, objectKey: data.objectKey, takenAt: photo.takenAt };
}

/**
 * Odešle celou sadu, SEKVENČNĚ.
 *
 * Souběžně by to bylo rychlejší na Wi-Fi a horší tam, kde se to používá: na
 * jednom sloupci signálu u lomu se tři paralelní PUTy perou o tutéž linku a
 * spadnou všechny. Sekvenčně navíc platí, že co prošlo, to je odeslané —
 * a při chybě se vrátí ty, které už jsou v úložišti.
 */
export async function uploadEvidenceSet(
  target: EvidenceTarget,
  photos: PhotoSet,
): Promise<UploadedEvidence[]> {
  const done: UploadedEvidence[] = [];
  for (const [slot, photo] of Object.entries(photos)) {
    if (!photo) continue;
    done.push(await uploadEvidencePhoto(target, slot, photo));
  }
  return done;
}
