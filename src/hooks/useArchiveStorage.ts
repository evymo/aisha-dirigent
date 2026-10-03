import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";

export interface UploadArchiveFileParams {
  file: File;
  type: "scan" | "transcript";
  slug: string;
}

export interface UploadArchiveFileResult {
  publicUrl: string;
}

/**
 * Upload a file to archive storage bucket
 * Returns the public URL of the uploaded file
 */
export async function uploadArchiveFile({
  file,
  type,
  slug,
}: UploadArchiveFileParams): Promise<UploadArchiveFileResult> {
  const fileExt = file.name.split(".").pop()?.toLowerCase();
  const fileName = `${slug || Date.now()}-${type}.${fileExt}`;
  const filePath = `${type}s/${fileName}`;

  const contentType = file.type || (fileExt === "pdf" ? "application/pdf" : undefined);

  const { error: uploadError } = await aisha.storage
    .from("archive-scans")
    .upload(filePath, file, {
      upsert: true,
      contentType,
    });

  if (uploadError) {
    safeError("archive.storage.uploadFailed", uploadError);
    throw uploadError;
  }

  const {
    data: { publicUrl },
  } = aisha.storage.from("archive-scans").getPublicUrl(filePath);

  return { publicUrl };
}
