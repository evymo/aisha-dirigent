/**
 * Document validation utilities for file uploads
 * 
 * Provides constants and functions to validate document uploads
 * based on MIME types and file extensions.
 */

/**
 * Set of allowed MIME types for document uploads
 */
export const ALLOWED_DOCUMENT_MIME_TYPES = new Set([
    // PDF
    'application/pdf',
    // Images
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif',
    // Office Documents
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    // Text
    'text/plain',
    'text/csv',
    // Rich text
    'application/rtf',
]);

/**
 * List of allowed file extensions (lowercase, with dot)
 */
export const ALLOWED_DOCUMENT_EXTENSIONS = [
    '.pdf',
    '.jpg',
    '.jpeg',
    '.png',
    '.webp',
    '.gif',
    '.heic',
    '.heif',
    '.doc',
    '.docx',
    '.xls',
    '.xlsx',
    '.ppt',
    '.pptx',
    '.txt',
    '.csv',
    '.rtf',
] as const;

/**
 * Check if a file is an allowed document type
 * 
 * @param file - The File object to validate
 * @returns true if the file is an allowed document type
 * 
 * @example
 * ```typescript
 * const files = event.dataTransfer.files;
 * const allowedFiles = Array.from(files).filter(isAllowedDocument);
 * ```
 */
export function isAllowedDocument(file: File): boolean {
    // Check MIME type first (more reliable when available)
    if (file.type && ALLOWED_DOCUMENT_MIME_TYPES.has(file.type)) {
        return true;
    }

    // Fallback to extension check for files without MIME type
    const fileName = file.name.toLowerCase();
    return ALLOWED_DOCUMENT_EXTENSIONS.some(ext => fileName.endsWith(ext));
}

/**
 * Get human-readable list of allowed file types for display
 */
export function getAllowedDocumentTypesDisplay(): string {
    return 'PDF, JPG, PNG, WEBP, GIF, HEIC, DOC, DOCX, XLS, XLSX, PPT, PPTX, TXT, CSV, RTF';
}
