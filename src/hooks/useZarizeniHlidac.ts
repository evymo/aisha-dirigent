import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { gatewayUrl } from "@/integrations/api/client";
import { getAccessToken } from "@/integrations/auth/oidc-client";
import { nahraniSPrubehem } from "@/lib/nahravani/nahraniSPrubehem";
import { safeError } from "@/lib/security/safeLogger";

/**
 * Volitelná schopnost "zařízení" (tablety s hlídačem) — co o ní ví storage-auth.
 *
 * Instance, která ji nedeklarovala, odpoví `zapnuto: false` (případně s důvodem,
 * když je deklarace vadná) — administrace to řekne, místo aby panel nabízela.
 */
const APK_TYP = "application/vnd.android.package-archive";
const QUERY_KEY = "zarizeni-hlidac";

const konfiguraceSchema = z.discriminatedUnion("zapnuto", [
  z.object({ zapnuto: z.literal(false), chyba: z.string().optional() }),
  z.object({
    zapnuto: z.literal(true),
    hlidac: z.object({
      applicationId: z.string(),
      kioskPackage: z.string(),
      certSha256: z.string(),
      checksum: z.string(),
      spravce: z.string(),
      versionName: z.string(),
      versionCode: z.number(),
      timeZone: z.string().optional(),
      locale: z.string().optional(),
      // Výbava pro appku (adresa API + dveře). Není tajemství; z ní se staví QR.
      vybava: z
        .object({
          apiUrl: z.string(),
          knock: z.object({ host: z.string(), port: z.number(), kid: z.string(), scope: z.string() }).optional(),
        })
        .optional(),
    }),
    stazeni: z.string().nullable(),
    apk: z.object({ bajtu: z.number(), nahrano: z.string(), sha256: z.string().nullable() }).nullable(),
    /**
     * Appky, které hlídač rozdává tabletům mimo Obchod Play.
     *
     * `.optional()` schválně: starší storage-auth klíč neposílá a administrace
     * kvůli tomu nesmí přestat fungovat — jinak by výpadek jedné schopnosti
     * shodil celý panel. Táž úvaha jako u `zapnuto: false`.
     */
    appky: z
      .array(
        z.object({
          balicek: z.string(),
          versionCode: z.number(),
          versionName: z.string(),
          sha256: z.string(),
          nahrano: z.string().nullable(),
          bajtuVUlozisti: z.number().nullable(),
          stav: z.enum(["chybi", "drzi", "nesedi"]),
        }),
      )
      .optional(),
  }),
]);

export type KonfiguraceZarizeni = z.infer<typeof konfiguraceSchema>;

async function hlavicky(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra };
}

export function useZarizeniKonfigurace() {
  return useQuery({
    queryKey: [QUERY_KEY],
    queryFn: async (): Promise<KonfiguraceZarizeni> => {
      const res = await fetch(`${gatewayUrl}/storage/v1/zarizeni/konfigurace`, {
        headers: await hlavicky(),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        safeError("zarizeni.konfigurace.failed", { status: res.status });
        throw new Error(`zarizeni konfigurace ${res.status}`);
      }
      return konfiguraceSchema.parse(await res.json());
    },
    staleTime: 30_000,
  });
}

/** Chyba nahrání hlídače: `kod` je `error` z těla odpovědi serveru (přeložitelný). */
export class ChybaNahraniHlidace extends Error {
  constructor(public kod: string, public status: number) {
    super(kod);
    this.name = "ChybaNahraniHlidace";
  }
}

export interface NahraniHlidace {
  soubor: File;
  onProgress?: (podil: number) => void;
  signal?: AbortSignal;
}

/**
 * Nahraje APK hlídače do úložiště instance (odkud si ho tablety stáhnou při
 * nastavení). Přes XMLHttpRequest s průběhem (2026-09-24): balíček má desítky MB
 * a bez ukazatele je nahrání jen zamrzlé tlačítko. Kód chyby ze serveru
 * (např. `sha256_mismatch`) jde volajícímu netknutý, aby ho mohl přeložit.
 */
export function useNahratHlidace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ soubor, onProgress, signal }: NahraniHlidace) => {
      const odpoved = await nahraniSPrubehem(`${gatewayUrl}/storage/v1/zarizeni/hlidac`, {
        method: "PUT",
        headers: await hlavicky({ "Content-Type": APK_TYP }),
        body: soubor,
        onProgress: onProgress ? (podil) => onProgress(podil) : undefined,
        signal,
        timeoutMs: 120_000,
      });
      if (!odpoved.ok) {
        const telo = odpoved.json<{ error?: string }>();
        safeError("zarizeni.nahrani.failed", { status: odpoved.status, error: telo?.error });
        throw new ChybaNahraniHlidace(telo?.error ?? `upload_${odpoved.status}`, odpoved.status);
      }
      return odpoved.json<{ bajtu: number; sha256: string }>() ?? { bajtu: soubor.size, sha256: "" };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [QUERY_KEY] }),
  });
}

/**
 * Nahraje APK DEKLAROVANÉ appky (odkud si ji hlídač na tabletu stáhne).
 *
 * POZOR: nahrává se JEN to, co instance deklarovala, a jen se shodným otiskem —
 * server odpoví 409, když se rozejdou. Administrace tu neurčuje, co má být
 * nainstalované; to říká deklarace v datech instance.
 *
 * POZOR: delší čekání než u hlídače. Hlídač má desítky kB, appka desítky MB: se
 * 120 s by nahrávání na pomalé lince spadlo na timeout a vypadalo by to jako
 * chyba serveru.
 */
export function useNahratAppku() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ balicek, soubor }: { balicek: string; soubor: File }) => {
      const res = await fetch(`${gatewayUrl}/storage/v1/zarizeni/appky/${encodeURIComponent(balicek)}`, {
        method: "PUT",
        headers: await hlavicky({ "Content-Type": APK_TYP }),
        body: soubor,
        signal: AbortSignal.timeout(900_000),
      });
      if (!res.ok) {
        const telo = (await res.json().catch((e: unknown) => {
          safeError("zarizeni.appka.parseError", e);
          return {};
        })) as { error?: string; deklarovano?: string; nahrano?: string };
        safeError("zarizeni.appka.failed", { status: res.status, error: telo.error });
        throw new Error(
          telo.error === "sha256_mismatch"
            ? "otisk nahraného souboru neodpovídá deklaraci instance"
            : (telo.error ?? `upload ${res.status}`),
        );
      }
      return (await res.json()) as { balicek: string; bajtu: number; sha256: string; versionCode: number };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [QUERY_KEY] }),
  });
}

/**
 * Žádosti o nastavení tabletu — co šlo do QR, aby se dalo vzít jako vzor.
 *
 * ⛔ Tajemství (heslo k Wi-Fi, PIN ani jeho otisk) server nepřijme — tělo s nimi
 *    odmítne celé. Předloha nese jen NASTAVENÍ; tajemství technik zadá znovu.
 */
const ZADOSTI_KEY = "zarizeni-zadosti";

const zadostSchema = z.object({
  id: z.string(),
  vytvoreno: z.string(),
  autor: z.string(),
  poznamka: z.string().nullable(),
  sit: z.object({ ssid: z.string(), zabezpeceni: z.enum(["WPA", "WEP", "NONE"]) }).nullable(),
  okno: z.string(),
  hlidac: z.object({ versionCode: z.number(), checksum: z.string() }),
});

export type ZadostHlidace = z.infer<typeof zadostSchema>;
export type NovaZadost = Pick<ZadostHlidace, "poznamka" | "sit" | "okno">;

export function useZadostiHlidace(zapnuto: boolean) {
  return useQuery({
    queryKey: [ZADOSTI_KEY],
    enabled: zapnuto,
    queryFn: async (): Promise<ZadostHlidace[]> => {
      const res = await fetch(`${gatewayUrl}/storage/v1/zarizeni/zadosti`, {
        headers: await hlavicky(),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        safeError("zarizeni.zadosti.failed", { status: res.status });
        throw new Error(`zarizeni zadosti ${res.status}`);
      }
      return z.object({ zadosti: z.array(zadostSchema) }).parse(await res.json()).zadosti;
    },
    staleTime: 30_000,
  });
}

export function useUlozitZadost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (zadost: NovaZadost): Promise<ZadostHlidace> => {
      const res = await fetch(`${gatewayUrl}/storage/v1/zarizeni/zadosti`, {
        method: "POST",
        headers: await hlavicky({ "Content-Type": "application/json" }),
        body: JSON.stringify(zadost),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        const telo = (await res.json().catch((e: unknown) => {
          safeError("zarizeni.zadost.parseError", e);
          return {};
        })) as { error?: string; detail?: string };
        safeError("zarizeni.zadost.failed", { status: res.status, error: telo.error });
        throw new Error(telo.detail ?? telo.error ?? `zadost ${res.status}`);
      }
      return zadostSchema.parse(await res.json());
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [ZADOSTI_KEY] }),
  });
}

// ── Přehled zařízení (hlášení tabletů) ─────────────────────────────────────
const HLASENI_KEY = "zarizeni-hlaseni";

const hlaseniSchema = z.object({
  zarizeni: z.string(),
  model: z.string(),
  android: z.string(),
  kioskAdmin: z.object({ versionName: z.string(), versionCode: z.number() }),
  appky: z.array(z.object({ balicek: z.string(), versionCode: z.number() })),
  webview: z.string().nullable(),
  rezim: z.enum(["kiosk", "servis"]),
  stav: z.string(),
  prijato: z.string(),
  prvni: z.string(),
});
const cilSchema = z.object({ balicek: z.string(), versionCode: z.number(), versionName: z.string() });

const prehledSchema = z.object({ zarizeni: z.array(hlaseniSchema), appky: z.array(cilSchema), kioskAdmin: cilSchema });

export type HlaseniTabletu = z.infer<typeof hlaseniSchema>;
export type CilovaVerze = z.infer<typeof cilSchema>;
export type PrehledZarizeni = z.infer<typeof prehledSchema>;

/** Hlášení tabletů + co na nich má být (deklarace instance). Obnovuje se samo každou minutu. */
export function useHlaseniZarizeni(zapnuto: boolean) {
  return useQuery({
    queryKey: [HLASENI_KEY],
    enabled: zapnuto,
    // Tablet hlásí po rozdávání, instalaci a startu — minutová obnova stačí,
    // přepnutí záložky nemá tahat přehled znovu.
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<PrehledZarizeni> => {
      const res = await fetch(`${gatewayUrl}/storage/v1/zarizeni/hlaseni`, {
        headers: await hlavicky(),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        safeError("zarizeni.hlaseni.failed", { status: res.status });
        throw new Error(`zarizeni hlaseni ${res.status}`);
      }
      return prehledSchema.parse(await res.json());
    },
  });
}
