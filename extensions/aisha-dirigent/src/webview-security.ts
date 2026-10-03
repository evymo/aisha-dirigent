/**
 * Shared security helpers for extension-owned webviews.
 */

const NONCE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const UNSAFE_URL_CHARS = new Set(['"', "'", "<", ">", "`", "\\"]);

function hasUnsafeUrlChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const charCode = value.charCodeAt(i);
    if (charCode <= 0x1f || charCode === 0x7f || UNSAFE_URL_CHARS.has(value[i])) {
      return true;
    }
  }
  return false;
}

/** Generate a crypto-strong CSP nonce for inline webview assets. */
export function getNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);

  let nonce = "";
  for (let i = 0; i < bytes.length; i++) {
    nonce += NONCE_CHARS.charAt(bytes[i] % NONCE_CHARS.length);
  }
  return nonce;
}

/**
 * Normalize a URL before it is used in iframe src or CSP frame-src.
 * Workspace settings can influence dashboard URLs, so reject anything that
 * is not a plain http(s) URL or that could break out of an HTML attribute.
 */
export function sanitizeWebviewFrameUrl(input: string | null | undefined): string {
  const value = typeof input === "string" ? input.trim() : "";
  if (!value || hasUnsafeUrlChars(value)) return "";

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (url.username || url.password) return "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

/** Append a path to a sanitized http(s) base URL. */
export function appendWebPath(baseUrl: string, path: string): string {
  const safeBase = sanitizeWebviewFrameUrl(baseUrl);
  if (!safeBase) return "";

  try {
    return sanitizeWebviewFrameUrl(new URL(path, `${safeBase}/`).toString());
  } catch {
    return "";
  }
}

/** Convert allowed frame URLs into a CSP frame-src source list. */
export function buildFrameSrcCsp(urls: readonly string[]): string {
  const sources = new Set<string>();

  for (const rawUrl of urls) {
    const safeUrl = sanitizeWebviewFrameUrl(rawUrl);
    if (!safeUrl) continue;

    try {
      sources.add(new URL(safeUrl).origin);
    } catch {
      // sanitizeWebviewFrameUrl already parsed it; keep defensive guard local.
    }
  }

  return sources.size > 0 ? Array.from(sources).join(" ") : "about:blank";
}
