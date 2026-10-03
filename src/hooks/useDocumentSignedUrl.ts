import { useMutation } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";

interface SignedUrlResult {
  signedUrl: string;
}

interface SignedUrlParams {
  bucket: string;
  storagePath: string;
  expiresIn?: number;
}

/**
 * Parse storage path in format "bucket/path/to/file" into bucket and file path
 */
export function parseStoragePath(storagePath: string): { bucket: string; filePath: string } {
  const parts = storagePath.split("/");
  const bucket = parts[0];
  const filePath = parts.slice(1).join("/");
  return { bucket, filePath };
}

/**
 * Public buckets that don't require signed URLs
 * These buckets allow public read access - access control is enforced in application layer
 */
const PUBLIC_BUCKETS = ["archive-scans", "hero-images"];

/**
 * Hook to get a signed URL for document download from Supabase Storage
 */
export function useDocumentSignedUrl() {
  return useMutation({
    mutationFn: async ({
      bucket,
      storagePath,
      expiresIn = 60,
    }: SignedUrlParams): Promise<SignedUrlResult> => {
      // For public buckets, use getPublicUrl instead
      if (PUBLIC_BUCKETS.includes(bucket)) {
        const { data } = aisha.storage.from(bucket).getPublicUrl(storagePath);
        return { signedUrl: data.publicUrl };
      }

      const { data, error } = await aisha.storage
        .from(bucket)
        .createSignedUrl(storagePath, expiresIn);

      if (error) {
        safeError("storage.signedUrl.failed", error);
        throw new Error(error.message);
      }

      if (!data?.signedUrl) {
        throw new Error("No signed URL returned");
      }

      return { signedUrl: data.signedUrl };
    },
  });
}

/**
 * Hook to get a URL for archive documents (supports both public and private buckets)
 * 
 * @param storagePath - Path in format "bucket/path/to/file.pdf" (e.g., "archive-scans/document.pdf")
 */
export function useArchiveDocumentSignedUrl() {
  const mutation = useDocumentSignedUrl();

  return {
    ...mutation,
    getSignedUrl: (storagePath: string, expiresIn = 60) => {
      const { bucket, filePath } = parseStoragePath(storagePath);
      return mutation.mutateAsync({
        bucket,
        storagePath: filePath,
        expiresIn,
      });
    },
  };
}

/**
 * Hook to get a signed URL specifically for health documents
 */
export function useTrackingDocumentSignedUrl() {
  const mutation = useDocumentSignedUrl();

  return {
    ...mutation,
    getSignedUrl: (storagePath: string, expiresIn = 300) =>
      mutation.mutateAsync({
        bucket: "health-documents",
        storagePath,
        expiresIn,
      }),
  };
}
