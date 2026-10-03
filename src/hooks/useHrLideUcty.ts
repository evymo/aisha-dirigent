import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { getUserFacingDataErrorMessage } from "@/lib/security/userFacingErrors";

/**
 * HR „Lidé a účty" — účty platformy × osoby z twinverse.
 *
 * Nad EXISTUJÍCÍ cestou vazeb: `twin_accounts_missing` (osoby bez účtu),
 * `hr_ucty_admin` (účty a jejich osoba), `hr_prirad_ucet_admin` (návrh +
 * lidské potvrzení v jedné transakci), `hr_odvaz_ucet_admin` (konec platnosti).
 */
const KLIC_OSOBY = "hr-osoby-bez-uctu";
const KLIC_UCTY = "hr-ucty";

const osobaSchema = z.object({
  twin_id: z.string(),
  twin_label: z.string().nullable(),
  entity_type: z.string(),
  refs: z.array(z.object({ source: z.string(), source_key: z.string(), ref_kind: z.string() })).default([]),
  pozvanky: z.array(z.object({ invitation_id: z.string(), is_active: z.boolean().nullable() })).default([]),
  navrhy_uctu: z.array(z.object({ ref_id: z.string() })).default([]),
  kroky: z.object({ celkem: z.number(), ceka: z.number() }).nullable().default(null),
});
const seznamOsobSchema = z.object({ items: z.array(osobaSchema), count: z.number(), limitovano: z.boolean() });

const ucetSchema = z.object({
  user_id: z.string(),
  email: z.string().nullable(),
  jmeno: z.string().nullable(),
  vytvoreno: z.string().nullable(),
  osoba: z
    .object({ ref_id: z.string(), twin_id: z.string(), label: z.string().nullable(), entity_type: z.string(), od: z.string().nullable() })
    .nullable(),
});
const seznamUctuSchema = z.object({ items: z.array(ucetSchema), count: z.number(), limitovano: z.boolean() });

export type OsobaBezUctu = z.infer<typeof osobaSchema>;

const druhSchema = z.object({ entity_type: z.string(), celkem: z.number(), bez_uctu: z.number() });
export type DruhOsob = z.infer<typeof druhSchema>;

/**
 * Druhy twinů z DAT (hr_druhy_osob_admin) — nabídka filtru. Dřív se skládala
 * z prvních 200 načtených osob, a když byly abecedně napřed firmy, „driver"
 * v nabídce chyběl (naměřeno po nasazení 2026-09-23).
 */
export function useDruhyOsob() {
  return useQuery({
    queryKey: ["hr-druhy-osob"],
    queryFn: async (): Promise<DruhOsob[]> => {
      const { data, error } = await aisha.rpc("hr_druhy_osob_admin");
      if (error) {
        safeError("hr.druhy.failed", error);
        throw new Error(getUserFacingDataErrorMessage(error));
      }
      return z.object({ items: z.array(druhSchema) }).parse(data).items;
    },
    staleTime: 60_000,
  });
}
export type UcetHr = z.infer<typeof ucetSchema>;

export function useOsobyBezUctu(hledat: string, typ: string | null) {
  return useQuery({
    queryKey: [KLIC_OSOBY, hledat, typ],
    queryFn: async () => {
      const { data, error } = await aisha.rpc("twin_accounts_missing", {
        p_entity_type: typ ?? undefined,
        p_hledat: hledat || undefined,
        p_limit: 200,
      });
      if (error) {
        safeError("hr.osoby.failed", error);
        throw new Error(getUserFacingDataErrorMessage(error));
      }
      return seznamOsobSchema.parse(data);
    },
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useHrUcty(hledat: string) {
  return useQuery({
    queryKey: [KLIC_UCTY, hledat],
    queryFn: async () => {
      const { data, error } = await aisha.rpc("hr_ucty_admin", { p_hledat: hledat || undefined, p_limit: 200 });
      if (error) {
        safeError("hr.ucty.failed", error);
        throw new Error(getUserFacingDataErrorMessage(error));
      }
      return seznamUctuSchema.parse(data);
    },
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

/** Chyba, kterou UI umí vysvětlit — ne obecné „něco se nepovedlo". */
export class OsobaMaJinyUcet extends Error {}

export function usePriraditUcet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, twinId }: { userId: string; twinId: string }) => {
      const { data, error } = await aisha.rpc("hr_prirad_ucet_admin", { p_twin_id: twinId, p_user_id: userId });
      if (error) {
        // Server říká PROČ strojově čitelně — jinak by správce nevěděl, že má
        // nejdřív odvázat druhý účet (a zkoušel by to pořád dokola).
        if (String(error.message ?? "").includes("person_has_other_account")) throw new OsobaMaJinyUcet();
        safeError("hr.prirazeni.failed", error);
        throw new Error(getUserFacingDataErrorMessage(error));
      }
      return z
        .object({ already: z.boolean(), predchozi_twin_id: z.string().nullable().optional() })
        .passthrough()
        .parse(data);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: [KLIC_OSOBY] });
      void qc.invalidateQueries({ queryKey: [KLIC_UCTY] });
    },
  });
}

export function useOdvazatUcet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (refId: string) => {
      const { error } = await aisha.rpc("hr_odvaz_ucet_admin", { p_ref_id: refId });
      if (error) {
        safeError("hr.odvazani.failed", error);
        throw new Error(getUserFacingDataErrorMessage(error));
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: [KLIC_OSOBY] });
      void qc.invalidateQueries({ queryKey: [KLIC_UCTY] });
    },
  });
}

// ── Sjednocení osoby (v2) ────────────────────────────────────────────────────
// ⭐ Rozhodnutí majitele (2026-09-23): HR spojuje nález s člověkem (identita);
// kokpit ingestu navrhuje. Náhled je výchozí, rozhodnutí je vratné.

const KLIC_ROZHODNUTI = "hr-rozhodnuti-sjednoceni";

const poctySchema = z.object({
  vazeb_presunout: z.number(),
  vazeb_ukoncit: z.number(),
  kroku_prepojit: z.number(),
  kroku_hotovych_zustava: z.number(),
  zaznamu_archivovat: z.number(),
  relaci_zustava: z.number(),
});
export type PoctySjednoceni = z.infer<typeof poctySchema>;

/** Odmítnutí serveru nese strojový kód — UI ho umí vysvětlit. */
export class OdmitnutiSjednoceni extends Error {
  constructor(public kod: string) {
    super(kod);
  }
}

export function useSjednotitOsobu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { kanon: string; ulomky: string[]; duvod?: string; nahled: boolean }) => {
      const { data, error } = await aisha.rpc("hr_sjednot_osobu_admin", {
        p_dry_run: v.nahled,
        p_duvod: v.duvod,
        p_kanon: v.kanon,
        p_ulomky: v.ulomky,
      });
      if (error) {
        safeError("hr.sjednoceni.failed", error);
        throw new Error(getUserFacingDataErrorMessage(error));
      }
      const r = z
        .object({ ok: z.boolean(), error: z.string().optional(), decision_id: z.string().optional(), pocty: poctySchema.optional() })
        .parse(data);
      if (!r.ok) throw new OdmitnutiSjednoceni(r.error ?? "neznamy");
      return r;
    },
    onSuccess: (_r, v) => {
      if (v.nahled) return;
      void qc.invalidateQueries({ queryKey: [KLIC_OSOBY] });
      void qc.invalidateQueries({ queryKey: [KLIC_UCTY] });
      void qc.invalidateQueries({ queryKey: [KLIC_ROZHODNUTI] });
    },
  });
}

const rozhodnutiSchema = z.object({
  decision_id: z.string(),
  akce: z.string(),
  kdy: z.string(),
  souhrn: z.string().nullable(),
  duvod: z.string().nullable(),
  vratne: z.boolean(),
  vraceno: z.object({ kdy: z.string() }).passthrough().nullable(),
});
export type RozhodnutiSjednoceni = z.infer<typeof rozhodnutiSchema>;

export function useRozhodnutiSjednoceni() {
  return useQuery({
    queryKey: [KLIC_ROZHODNUTI],
    queryFn: async () => {
      const { data, error } = await aisha.rpc("get_decisions_admin", { p_druh: "twin_decision", p_limit: 30 });
      if (error) {
        safeError("hr.rozhodnuti.failed", error);
        throw new Error(getUserFacingDataErrorMessage(error));
      }
      const r = z.object({ items: z.array(rozhodnutiSchema.passthrough()) }).parse(data);
      // Jen rozhodnutí HR o osobě — pohlcení zdrojů (#365) sem nepatří.
      return r.items.filter((i) => i.akce === "twin.person_unified");
    },
    staleTime: 30_000,
  });
}

export function useVratitRozhodnuti() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { decisionId: string; duvod: string }) => {
      const { data, error } = await aisha.rpc("revert_twin_decision_admin", {
        p_decision_id: v.decisionId,
        p_dry_run: false,
        p_reason: v.duvod,
      });
      if (error) {
        safeError("hr.vraceni.failed", error);
        throw new Error(getUserFacingDataErrorMessage(error));
      }
      const r = z
        .object({
          ok: z.boolean(),
          error: z.string().optional(),
          twinu: z.number().optional(),
          kroku_zpet: z.number().optional(),
          preskoceno_zmenene: z.number().optional(),
        })
        .passthrough()
        .parse(data);
      if (!r.ok) throw new Error(r.error ?? "vrácení odmítnuto");
      return r;
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: [KLIC_OSOBY] });
      void qc.invalidateQueries({ queryKey: [KLIC_UCTY] });
      void qc.invalidateQueries({ queryKey: [KLIC_ROZHODNUTI] });
    },
  });
}

// ── Sekce extranetu u účtu (2026-09-28) ─────────────────────────────────────
// ⭐ Rozhodnutí majitele: přístup do sekce se nastavuje u uživatele (osa publika
// „udeleni"), data v ní dál řídí nárok z vazeb. Nabídku (udělitelné sekce)
// i stav vrací surface_udeleni_admin, zápis surface_udel_admin (audit).

const KLIC_SEKCE = "hr-sekce-uctu";

const sekceSchema = z.object({
  surface: z.string(),
  title_key: z.string().nullable(),
  udeleno: z.boolean(),
  granted_at: z.string().nullable(),
});
export type SekceUctuRadek = z.infer<typeof sekceSchema>;

export function useSekceUctu(userId: string | null) {
  return useQuery({
    queryKey: [KLIC_SEKCE, userId],
    enabled: userId !== null,
    queryFn: async (): Promise<SekceUctuRadek[]> => {
      const { data, error } = await aisha.rpc("surface_udeleni_admin", { p_user_id: userId as string });
      if (error) {
        safeError("hr.sekce.failed", error);
        throw new Error(getUserFacingDataErrorMessage(error));
      }
      return z.array(sekceSchema).parse(data);
    },
    staleTime: 30_000,
  });
}

export function useUdelitSekci() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { userId: string; surface: string; udelit: boolean }) => {
      const { error } = await aisha.rpc("surface_udel_admin", {
        p_surface: v.surface,
        p_udelit: v.udelit,
        p_user_id: v.userId,
      });
      if (error) {
        safeError("hr.sekce.udeleni.failed", error);
        throw new Error(getUserFacingDataErrorMessage(error));
      }
    },
    onSettled: (_d, _e, v) => {
      void qc.invalidateQueries({ queryKey: [KLIC_SEKCE, v.userId] });
    },
  });
}

// ── Vazby na data u účtu (2026-09-28) ───────────────────────────────────────
// ⭐ Rozhodnutí majitele: k čemu se účet dostane, nastavuje správa u uživatele.
// Sekce otevírá udělení (výš), data vazba osoby účtu na identitu druhem, který
// znají pravidla nároku (hr_vazby_uctu_admin / hr_prirad_identitu_admin /
// hr_odeber_identitu_admin; hledání identit hr_identity_hledat_admin).

const KLIC_VAZBY = "hr-vazby-uctu";

const vazbaSchema = z.object({
  relation_id: z.string(),
  twin_id: z.string(),
  label: z.string().nullable(),
  entity_type: z.string(),
  relation_kind: z.string(),
  od: z.string().nullable(),
  identifikatoru: z.number(),
});
const vazbyUctuSchema = z.object({
  osoba: z.object({ twin_id: z.string(), label: z.string().nullable() }).nullable(),
  druhy: z.array(z.string()),
  vazby: z.array(vazbaSchema),
});
export type VazbyUctuData = z.infer<typeof vazbyUctuSchema>;

const identitaSchema = z.object({
  twin_id: z.string(),
  label: z.string().nullable(),
  entity_type: z.string(),
  identifikatoru: z.number(),
});
export type IdentitaHledani = z.infer<typeof identitaSchema>;

export function useVazbyUctu(userId: string | null) {
  return useQuery({
    queryKey: [KLIC_VAZBY, userId],
    enabled: userId !== null,
    queryFn: async (): Promise<VazbyUctuData> => {
      const { data, error } = await aisha.rpc("hr_vazby_uctu_admin", { p_user_id: userId as string });
      if (error) {
        safeError("hr.vazby.failed", error);
        throw new Error(getUserFacingDataErrorMessage(error));
      }
      return vazbyUctuSchema.parse(data);
    },
    staleTime: 30_000,
  });
}

export function useHledatIdentity(hledat: string) {
  return useQuery({
    queryKey: ["hr-identity-hledat", hledat],
    enabled: hledat.length >= 2,
    queryFn: async (): Promise<IdentitaHledani[]> => {
      const { data, error } = await aisha.rpc("hr_identity_hledat_admin", { p_hledat: hledat, p_limit: 30 });
      if (error) {
        safeError("hr.identity.hledat.failed", error);
        throw new Error(getUserFacingDataErrorMessage(error));
      }
      return z.array(identitaSchema).parse(data);
    },
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function usePriraditIdentitu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { relationKind: string; twinId: string; userId: string }) => {
      const { data, error } = await aisha.rpc("hr_prirad_identitu_admin", {
        p_relation_kind: v.relationKind,
        p_twin_id: v.twinId,
        p_user_id: v.userId,
      });
      if (error) {
        safeError("hr.vazby.prirazeni.failed", error);
        throw new Error(getUserFacingDataErrorMessage(error));
      }
      return z.object({ uz_existuje: z.boolean() }).passthrough().parse(data);
    },
    onSettled: (_d, _e, v) => {
      void qc.invalidateQueries({ queryKey: [KLIC_VAZBY, v.userId] });
      void qc.invalidateQueries({ queryKey: [KLIC_UCTY] });
    },
  });
}

export function useOdebratIdentitu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { relationId: string; userId: string }) => {
      const { error } = await aisha.rpc("hr_odeber_identitu_admin", { p_relation_id: v.relationId });
      if (error) {
        safeError("hr.vazby.odebrani.failed", error);
        throw new Error(getUserFacingDataErrorMessage(error));
      }
    },
    onSettled: (_d, _e, v) => {
      void qc.invalidateQueries({ queryKey: [KLIC_VAZBY, v.userId] });
    },
  });
}

// ── Zdroje dat u účtu (2026-09-28) ──────────────────────────────────────────
// ⭐ Rozhodnutí majitele: přístup ke zdroji dat (agenda Money, složka vstupu, firma) uděluje
// správa u uživatele; ingest o přístupu nerozhoduje. Nabídka z dat (klíče původu),
// hr_zdroje_uctu_admin / hr_udel_zdroj_admin (audit).

const KLIC_ZDROJE = "hr-zdroje-uctu";

const zdrojSchema = z.object({
  zdroj: z.string(),
  label: z.string(),
  dokladu: z.number(),
  udeleno: z.boolean(),
  uroven: z.number().optional(),
  ico: z.string().optional(),
  druhy: z.string().optional(),
});
export type ZdrojDatRadek = z.infer<typeof zdrojSchema>;

const zdrojeSchema = z.object({
  vse: z.object({ zdroj: z.string(), dokladu: z.number(), udeleno: z.boolean() }),
  vstupy: z.array(zdrojSchema),
  dvojcata: z.array(zdrojSchema),
  instance: z.array(zdrojSchema),
  slozky: z.array(zdrojSchema),
  firmy: z.array(zdrojSchema),
});
export type ZdrojeUctu = z.infer<typeof zdrojeSchema>;

export function useZdrojeUctu(userId: string | null) {
  return useQuery({
    queryKey: [KLIC_ZDROJE, userId],
    enabled: userId !== null,
    queryFn: async (): Promise<ZdrojeUctu> => {
      const { data, error } = await aisha.rpc("hr_zdroje_uctu_admin", { p_user_id: userId as string });
      if (error) {
        safeError("hr.zdroje.failed", error);
        throw new Error(getUserFacingDataErrorMessage(error));
      }
      return zdrojeSchema.parse(data);
    },
    staleTime: 30_000,
  });
}

export function useUdelitZdroj() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { userId: string; zdroj: string; udelit: boolean }) => {
      const { error } = await aisha.rpc("hr_udel_zdroj_admin", {
        p_udelit: v.udelit,
        p_user_id: v.userId,
        p_zdroj: v.zdroj,
      });
      if (error) {
        safeError("hr.zdroje.udeleni.failed", error);
        throw new Error(getUserFacingDataErrorMessage(error));
      }
    },
    onSettled: (_d, _e, v) => {
      void qc.invalidateQueries({ queryKey: [KLIC_ZDROJE, v.userId] });
    },
  });
}
