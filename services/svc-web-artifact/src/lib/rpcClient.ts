/**
 * Thin PostgREST RPC client — calls back into Aisha DB through the
 * gateway with the service_role JWT. No legacy SDK — repo policy bans
 * the deprecated SDK identifier (see feedback memory on banned legacy SDKs).
 */
import { config } from '../config.js';

export class RpcError extends Error {
  constructor(message: string, public readonly status: number, public readonly body: string) {
    super(message);
    this.name = 'RpcError';
  }
}

async function rpc<TArgs extends Record<string, unknown>, TResult>(fn: string, args: TArgs): Promise<TResult> {
  const url = `${config.gatewayUrl.replace(/\/$/, '')}/rest/v1/rpc/${fn}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json',
      apikey: config.serviceKey,
      authorization: `Bearer ${config.serviceKey}`,
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new RpcError(`rpc/${fn} failed: ${res.status}`, res.status, text);
  }
  if (!text) return undefined as unknown as TResult;
  try {
    return JSON.parse(text) as TResult;
  } catch {
    return text as unknown as TResult;
  }
}

export const rpcClient = {
  markProcessing: (jobId: string) => rpc<{ p_job_id: string }, void>('mark_web_artifact_processing', { p_job_id: jobId }),

  complete: (args: {
    jobId: string;
    canvasData: unknown;
    canvasHtml: string;
    canvasCss: string;
    extractedTokens?: unknown;
    metadata?: unknown;
  }) =>
    rpc('complete_web_artifact_ingest', {
      p_job_id: args.jobId,
      p_canvas_data: args.canvasData,
      p_canvas_html: args.canvasHtml,
      p_canvas_css: args.canvasCss,
      p_extracted_tokens: args.extractedTokens ?? null,
      p_metadata: args.metadata ?? null,
    }),

  fail: (jobId: string, errorMessage: string) =>
    rpc('fail_web_artifact_ingest', { p_job_id: jobId, p_error_message: errorMessage }),

  start: (args: {
    storyId: string | null;
    kind: 'ingest_upload' | 'ingest_scrape' | 'redesign' | 'apply';
    sourceType: 'folder_upload' | 'url_scrape' | 'manual' | 'default_seed' | 'llm_redesign';
    sourceUrl?: string | null;
    sourceStoragePath?: string | null;
    idempotencyKey: string;
    metadata?: unknown;
  }) =>
    rpc<Record<string, unknown>, string>('start_web_artifact_ingest', {
      p_story_id: args.storyId,
      p_kind: args.kind,
      p_source_type: args.sourceType,
      p_source_url: args.sourceUrl ?? null,
      p_source_storage_path: args.sourceStoragePath ?? null,
      p_idempotency_key: args.idempotencyKey,
      p_metadata: args.metadata ?? {},
    }),

  apply: (args: { jobId: string; pageId: string; publish: boolean }) =>
    rpc('apply_web_artifact_to_page', {
      p_job_id: args.jobId,
      p_page_id: args.pageId,
      p_publish: args.publish,
    }),

  /** Pull bytes from a private storage bucket via the Aisha storage REST endpoint. */
  downloadStorageObject: async (storagePath: string): Promise<Buffer> => {
    const url = `${config.gatewayUrl.replace(/\/$/, '')}/storage/v1/object/${storagePath.replace(/^\//, '')}`;
    const res = await fetch(url, {
      headers: {
        apikey: config.serviceKey,
        authorization: `Bearer ${config.serviceKey}`,
      },
    });
    if (!res.ok) {
      throw new RpcError(`storage GET ${storagePath} -> ${res.status}`, res.status, await res.text());
    }
    return Buffer.from(await res.arrayBuffer());
  },

  /** Return the singleton stack-default story id, creating it if missing. */
  ensureStackDefaultStory: () =>
    rpc<Record<string, never>, string>('ensure_stack_default_story', {}),

  /**
   * SELECT a web_pages row by slug for the seed-default idempotency check.
   * Pass `hostname` to resolve the brand-scoped page (multi-site) via the
   * two-arg get_web_page_by_slug(p_slug, p_hostname); omit it for the global page.
   */
  getWebPageBySlug: (slug: string, hostname?: string) =>
    rpc<Record<string, unknown>, Array<{ id: string; canvas_data: unknown }>>(
      'get_web_page_by_slug',
      hostname ? { p_slug: slug, p_hostname: hostname } : { p_slug: slug },
    ),

  /**
   * Upsert a web_pages row (creates if missing, returns id). Pass
   * `brandingProfileId` to scope the page to a brand/site (multi-domain);
   * omit/NULL = global stack-default page.
   */
  upsertDefaultWebPage: (args: {
    slug: string;
    titleKey: string;
    descriptionKey: string;
    brandingProfileId?: string | null;
  }) =>
    rpc<Record<string, unknown>, string>('upsert_web_page_admin', {
      p_slug: args.slug,
      p_title_key: args.titleKey,
      p_description_key: args.descriptionKey,
      p_branding_profile_id: args.brandingProfileId ?? null,
    }),

  /**
   * Idempotent (hostname-keyed) upsert of a platform-level brand + its inbound
   * hostname mapping. Returns branding_profiles.id to attach pages to.
   */
  seedBrandingSite: (args: {
    hostname: string;
    brandVariant: string;
    operatorName?: string;
    landingPath?: string;
    colorPrimary?: string;
    colorBackground?: string;
    colorSurface?: string;
    colorForeground?: string;
    darkColorBackground?: string;
    darkColorSurface?: string;
    darkColorForeground?: string;
    fontFamilyBrand?: string;
    operatorEmail?: string;
    operatorUrl?: string;
  }) =>
    rpc<Record<string, unknown>, string>('seed_branding_site', {
      p_hostname: args.hostname,
      p_brand_variant: args.brandVariant,
      p_operator_name: args.operatorName ?? null,
      p_landing_path: args.landingPath ?? null,
      p_color_primary: args.colorPrimary ?? null,
      p_color_background: args.colorBackground ?? null,
      p_color_surface: args.colorSurface ?? null,
      p_color_foreground: args.colorForeground ?? null,
      p_dark_color_background: args.darkColorBackground ?? null,
      p_dark_color_surface: args.darkColorSurface ?? null,
      p_dark_color_foreground: args.darkColorForeground ?? null,
      p_font_family_brand: args.fontFamilyBrand ?? null,
      p_operator_email: args.operatorEmail ?? null,
      p_operator_url: args.operatorUrl ?? null,
    }),

  /** Idempotent upsert of translation rows ({key, locale, value, namespace}). */
  upsertTranslations: (rows: Array<{ key: string; locale: string; value: string; namespace: string }>) =>
    rpc<{ p_translations: unknown }, unknown>('upsert_translations', { p_translations: rows }),
};
