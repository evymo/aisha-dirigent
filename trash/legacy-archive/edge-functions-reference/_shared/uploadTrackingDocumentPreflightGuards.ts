export type GuardFailure = {
  status: number;
  error: string;
};

export const MAX_FILE_NAME_LENGTH = 150;

export function sanitizeFilename(filename: string): string {
  const base = filename.split("/").pop()?.split("\\").pop() ?? filename;
  const sanitized = base.replace(/[^a-zA-Z0-9._-]/g, "_");
  return sanitized.length > MAX_FILE_NAME_LENGTH
    ? sanitized.slice(0, MAX_FILE_NAME_LENGTH)
    : sanitized;
}

export function inferMimeType(filename: string): string | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lower.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (lower.endsWith(".ppt")) return "application/vnd.ms-powerpoint";
  if (lower.endsWith(".pptx")) {
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".csv")) return "text/csv";
  return null;
}

export type PreflightParsedBody = {
  filename: string;
  providedMimeType: string | null;
  size: number;
  category: string;
  title: string | null;
  description: string | null;
  documentDate: string | null;
  studyRegistrationId: string | null;
};

export function parsePreflightBody(body: unknown): PreflightParsedBody {
  const obj = (body !== null && typeof body === "object" ? body : {}) as Record<string, unknown>;

  return {
    filename: typeof obj.filename === "string" ? obj.filename : "",
    providedMimeType: typeof obj.mimeType === "string" ? obj.mimeType : null,
    size: typeof obj.size === "number" ? obj.size : Number.NaN,
    category: typeof obj.category === "string" ? obj.category : "other",
    title: typeof obj.title === "string" ? obj.title : null,
    description: typeof obj.description === "string" ? obj.description : null,
    documentDate: typeof obj.documentDate === "string" ? obj.documentDate : null,
    studyRegistrationId:
      typeof obj.studyRegistrationId === "string" ? obj.studyRegistrationId : null,
  };
}

export function filenameGuard(params: { filename: string }): GuardFailure | null {
  return params.filename ? null : { status: 400, error: "filename is required" };
}

export function sizeGuard(params: {
  size: number;
  maxBytes: number;
}): GuardFailure | null {
  if (!Number.isFinite(params.size) || params.size <= 0) {
    return { status: 400, error: "size is required" };
  }

  if (params.size > params.maxBytes) {
    return { status: 413, error: "File too large" };
  }

  return null;
}

export function categoryGuard(params: {
  category: string;
  allowedCategories: ReadonlySet<string>;
}): GuardFailure | null {
  return params.allowedCategories.has(params.category)
    ? null
    : { status: 400, error: "Invalid category" };
}

export function resolveMimeType(params: {
  filename: string;
  providedMimeType: string | null;
  allowedMimeTypes: ReadonlySet<string>;
}): { mimeType: string } | GuardFailure {
  const candidate =
    (params.providedMimeType && params.allowedMimeTypes.has(params.providedMimeType)
      ? params.providedMimeType
      : null) ?? inferMimeType(params.filename);

  if (!candidate || !params.allowedMimeTypes.has(candidate)) {
    return { status: 400, error: "Invalid file type" };
  }

  return { mimeType: candidate };
}
