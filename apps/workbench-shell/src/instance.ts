import type { Ed25519Jwk } from '@aisha/surface-blocks';

/**
 * Instance overlay contract — EVERYTHING implementation-specific enters the shell
 * exclusively through this object (compile-time define from AISHA_INSTANCE_DIR,
 * or a globalThis injection in tests). The shell contains zero instance literals.
 *
 * Candidate for extraction to a shared
 * @aisha/surface-client package once a second consumer justifies the seam).
 */
export interface InstanceConfig {
  /** Instance slug used for storage prefixes (not shown to users). */
  instance_slug: string;
  api: {
    /** PostgREST base URL (RPC-only). */
    postgrest_url: string;
    /** svc-token-exchange base URL. */
    token_exchange_url: string;
    /** Published snapshot URL — unused by the workbench (live-only). */
    snapshot_url?: string;
  };
  auth: {
    /** OIDC issuer, e.g. https://<idp>/realms/<realm>. */
    issuer: string;
    client_id: string;
  };
  i18n: {
    default_locale: string;
    locales: string[];
  };
  /**
   * ARCHETYP VZHLEDU — druhá polovina páru k `data-theme`.
   *
   * Tokeny `@aisha/extranet-sdk-ui` existují POUZE pod dvojicí
   * `[data-theme] + [data-archetype]`; bez archetypu nemají komponenty SDK
   * token layer a kreslí se do prázdna. Naměřeno 2026-08-08: shell nastavoval
   * jen téma, takže ESDK byl v repu, most `sdk.ts` hotový — a přesto ho nešlo
   * použít dál než na Banner.
   *
   * ⭐ JE TO VLASTNOST INSTANCE, ne shellu. Původní oprava psala hodnotu natvrdo
   * do generického `index.html` a brána split-rule to právem odmítla: instanční
   * název v generickém kanálu. Archetyp proto chodí touž cestou jako všechno
   * ostatní instanční — konfigurací.
   */
  archetype?: string;
  /** Pinned Ed25519 PUBLIC key (unused by the workbench; kept for overlay parity). */
  snapshot_public_jwk: Ed25519Jwk | null;
  /** Dev-only preview: renders a local UNSIGNED synthetic fixture with a banner. */
  preview: {
    enabled: boolean;
    fixture_url?: string;
  };
  /**
   * Workbench-specific overlay. detail_blocks are the block slugs loaded (scoped by
   * document_id — the key the detail RPCs read) when an operator opens a document
   * from the register. Absent = master only (no drill-in). Keeps the shell
   * instance-agnostic — the slugs are DATA.
   * client_id lets the workbench use a distinct OIDC client from the mobile shell while
   * sharing one overlay dir; falls back to auth.client_id when absent.
   */
  workbench?: {
    detail_blocks: string[];
    /**
     * Čím se otevírá KTERÝ DRUH záznamu (`row_kind`, který vydává RPC).
     * `param` je klíč, pod kterým se `id` pošle čtečce — u dokladu `document_id`,
     * u odběratele `debtor`.
     *
     * Je to DATA, ne větvení ve shellu: kdyby tu stálo `if (kind === 'counterparty')`,
     * byl by v generickém kódu zadrátovaný jeden podnikový pojem. Chybějící druh
     * znamená „tenhle řádek se neotvírá" a shell to ŘEKNE — tiché nic je ta vada,
     * kvůli které tenhle rozcestník vznikl.
     */
    detail_by_kind?: Record<string, { param: string; blocks: string[] }>;
    client_id?: string;
    /** Workbench preview fixture (distinct shape/path from the mobile snapshot fixture). */
    fixture_url?: string;
  };

  /**
   * Asking the data in plain language. `answer_block` is the block slug whose RPC
   * answers a `question` param — DATA, so another instance points at its own
   * answering surface. Absent = no ask affordance (the shell stays honest rather
   * than showing an input that answers nothing).
   */
  ask?: {
    answer_block: string;
    /** Gateway path of the governed chat lane (e.g. "/chat"). Present = the ask
     * panel rides the FULL answer chain (local model + tools + ai_runs) and the
     * answer_block RPC becomes its deterministic fallback. Absent = RPC only. */
    chat_path?: string;
    /** Kolik ms čekat na formulaci AISHY (model uvnitř bývá pomalý). Ověřená
     * odpověď z dat stojí už předtím, vypršení ji jen ponechá. Bez hodnoty se
     * čeká neomezeně. */
    chain_timeout_ms?: number;
  };
}

export interface InstanceBundle {
  config: InstanceConfig;
  i18n: Record<string, Record<string, string>>;
}

declare const __AISHA_INSTANCE__: InstanceBundle | undefined;

function resolveInstance(): InstanceBundle {
  const injected = (globalThis as { __AISHA_INSTANCE__?: InstanceBundle }).__AISHA_INSTANCE__;
  if (injected) return injected;
  if (typeof __AISHA_INSTANCE__ !== 'undefined' && __AISHA_INSTANCE__) return __AISHA_INSTANCE__;
  throw new Error('instance bundle missing: build with AISHA_INSTANCE_DIR or inject __AISHA_INSTANCE__');
}

export const instance: InstanceBundle = resolveInstance();
