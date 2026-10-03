/**
 * My workflow steps — generic field-worker path over the production workflow
 * system (NOT a bespoke domain feature). A step ("node of the process graph")
 * is assigned to a user or a role; the assignee completes it in the field via
 * `complete_workflow_step`, and the node's template config may declare
 * a token reward that the completion pays out (returned in `reward`).
 *
 * Contracts (verified live, 2026-07-24, E2E dry-run incl. token mint):
 *   get_my_workflow_steps(p_status?) → rows assigned to me (direct or via
 *     role) joined with batch identity; RLS on the table is admin-only, this
 *     RPC is the self-scoped read.
 *   complete_workflow_step(p_step_id, p_output_data, p_notes,
 *     p_has_deviation, p_occurred_at) → { ok, status, reward? } — offline
 *     backdating via p_occurred_at; deviation routes to 'failed', no reward.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/config/api";
import { asError } from "@/lib/asError";
import type { Json } from "@/types/database";
import type { DevicePositionPayload } from "@/lib/polohaZarizeni";

// Narrow typed bridge (RPCs not yet in generated database.ts — mirrors useSurface).
type WorkflowRpc = {
  (fn: "get_my_workflow_steps", args: { p_status?: string | null }): Promise<{ data: unknown; error: unknown }>;
  (fn: "complete_workflow_step", args: {
    p_step_id: string; p_output_data?: Json; p_notes?: string | null;
    p_has_deviation?: boolean; p_occurred_at?: string | null;
  }): Promise<{ data: unknown; error: unknown }>;
  (fn: "submit_evidence_review_audited", args: {
    p_entity_kind: string; p_entity_id: string; p_decision: string;
    p_note?: string | null; p_evidence?: Json;
    /** Kdy se to stalo v terénu (offline potvrzení), NULL = teď. */
    p_occurred_at?: string | null;
  }): Promise<{ data: unknown; error: unknown }>;
  (fn: "get_workflow_step_polozky", args: { p_step_id: string }): Promise<{ data: unknown; error: unknown }>;
};
const workflowRpc = api.rpc as unknown as WorkflowRpc;

export interface WorkflowStepReward {
  token_type: string;
  amount: number;
}

export interface WorkflowStep {
  step_id: string;
  step_code: string | null;
  step_name: string;
  step_order: number;
  status: string;
  batch_id: string;
  batch_code: string | null;
  product_name: string | null;
  assigned_role: string | null;
  description: string | null;
  /** Node config from the template — carries e.g. `reward`. */
  input_data: { reward?: WorkflowStepReward } & Record<string, unknown> | null;
  output_data: Json | null;
  completed_at: string | null;
}

export interface CompleteStepResult {
  ok: boolean;
  error?: string;
  status?: string;
  step_name?: string;
  /** award_tokens result when the node declared a reward (null otherwise). */
  reward?: { success?: boolean; amount_awarded?: number; new_balance?: number; error?: string } | null;
}

/** Steps assigned to me (directly or through my role). */
export function useMyWorkflowSteps(status?: string) {
  return useQuery<WorkflowStep[]>({
    queryKey: ["my-workflow-steps", status ?? "all"],
    staleTime: 30 * 1000,
    queryFn: async () => {
      const { data, error } = await workflowRpc("get_my_workflow_steps", { p_status: status ?? null });
      if (error) throw asError("workflow.steps", error);
      return Array.isArray(data) ? (data as WorkflowStep[]) : [];
    },
  });
}

/**
 * JEDEN krok se vším, co o něm platí — včetně toho, ČÍ je.
 *
 * `get_my_workflow_steps` je z principu osobní fronta; tohle je opačná otázka
 * („ukaž mi tenhle krok") a odpovídá na ni i tomu, kdo dispečuje. Pole navíc
 * proto nejsou kosmetika: dispečer musí vidět realitu — stav, komu je krok
 * přiřazený, kdo ho uzavřel — ne pohled, který předstírá, že je jeho.
 */
export interface WorkflowStepDetail extends WorkflowStep {
  production_date: string | null;
  started_at: string | null;
  has_deviation: boolean | null;
  notes: string | null;
  /** Jméno účtu, kterému je krok přiřazen (jen dispečerovi a člověku o sobě). */
  assigned_to: string | null;
  /** Label twinu, na který je uzel vázaný — u dodáku řidič. */
  assigned_twin: string | null;
  completed_by_name: string | null;
  /**
   * Dosáhl bych na tenhle krok i BEZ dispečerského rozsahu? `false` = dívám se
   * na cizí práci. Rozhoduje o tom server (týž predikát, jen bez rozsahu), aby
   * si to klient nemusel — a nemohl — domýšlet.
   */
  is_mine: boolean;
}

/** Detail jednoho kroku podle id. Bez id se nedotazuje. */
export function useWorkflowStep(stepId?: string | null) {
  return useQuery<WorkflowStepDetail | null>({
    queryKey: ["workflow-step", stepId ?? ""],
    enabled: Boolean(stepId),
    staleTime: 30 * 1000,
    queryFn: async () => {
      const { data, error } = await api.rpc("get_workflow_step_detail", { p_step_id: stepId! });
      if (error) throw asError("workflow.step", error);
      // Prázdno = krok neexistuje NEBO na něj volající nemá nárok. Server ty dva
      // případy nerozlišuje schválně (jinak by šlo zjišťovat existenci cizích
      // běhů), takže je nerozlišuje ani tenhle klient.
      const rows = Array.isArray(data) ? data : [];
      return (rows[0] as WorkflowStepDetail | undefined) ?? null;
    },
  });
}

/** Položky dokladu, které server vydá S KROKEM (co, kolik a čeho odvézt). */
export interface PolozkyKroku {
  /** Server doklad kroku našel. `false` = poctivé „nevím“, ne chyba. */
  doklad: boolean;
  polozky: Record<string, unknown>[];
}

/**
 * Položky dokladu kroku — HLAVNÍ cesta (majitel 2026-09-30: „nevidím detail
 * dodávky — co, kolik a čeho odvézt“). Nárok je nárok na KROK, takže položky
 * dostane i tablet v kabině (jen klíče, které instance pustí). Druhá, samostatná
 * cesta je detail dokladu pro člověka s nárokem na DOKLAD (`get_document_detail`)
 * — tahle ji nezastupuje a mezi nimi se tiše nepřepíná.
 */
export function usePolozkyKroku(stepId?: string | null) {
  return useQuery<PolozkyKroku | null>({
    queryKey: ["workflow-step-polozky", stepId ?? ""],
    enabled: Boolean(stepId),
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data, error } = await workflowRpc("get_workflow_step_polozky", { p_step_id: stepId! });
      if (error) throw asError("workflow.step.polozky", error);
      const r = (data ?? null) as { ok?: unknown; doklad?: unknown; polozky?: unknown } | null;
      // Krok bez nároku i neexistující krok = týž „nenalezeno“ (server je schválně nerozlišuje).
      if (!r || r.ok !== true) return null;
      return {
        doklad: r.doklad === true,
        polozky: Array.isArray(r.polozky) ? (r.polozky as Record<string, unknown>[]) : [],
      };
    },
  });
}

export interface CompleteStepInput {
  stepId: string;
  /** Node measurement — what only the human on site knows (identity, consent…). */
  outputData?: Record<string, unknown>;
  note?: string | null;
  hasDeviation?: boolean;
  /** Offline backdating — when the completion really happened. */
  occurredAt?: string | null;
}

/** Complete my assigned step; pays the node's declared token reward. */
export function useCompleteWorkflowStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CompleteStepInput): Promise<CompleteStepResult> => {
      const { data, error } = await workflowRpc("complete_workflow_step", {
        p_step_id: input.stepId,
        p_output_data: (input.outputData ?? {}) as Json,
        p_notes: input.note ?? null,
        p_has_deviation: input.hasDeviation ?? false,
        p_occurred_at: input.occurredAt ?? null,
      });
      if (error) throw asError("workflow.complete", error);
      const result = data as CompleteStepResult;
      if (!result?.ok) throw new Error(result?.error ?? "workflow step completion failed");
      return result;
    },
    // Obě fronty: osobní seznam i právě otevřený krok (dispečer se dívá na jeden).
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-workflow-steps"] });
      qc.invalidateQueries({ queryKey: ["workflow-step"] });
    },
  });
}

/**
 * The confirming decision. Anything else routes the step to a deviation
 * (`p_has_deviation => p_decision <> 'HUMAN_CONFIRMED'` inside the RPC), which
 * means no reward — so this string is not cosmetic and is not ours to invent.
 */
export const HANDOVER_CONFIRMED = "HUMAN_CONFIRMED";

export interface HandoverInput {
  stepId: string;
  /** Who took delivery. */
  recipient: string;
  /** Their mark, as an image data URI (see components/SignaturePad). */
  signature: string;
  note?: string | null;
  /** Non-confirming decisions become deviations; default confirms. */
  decision?: string;
  /**
   * Kdy k předání došlo V TERÉNU. Bez signálu se potvrzení odesílá se
   * zpožděním a čas synchronizace by byl údaj o naší síti, ne o dodávce.
   */
  occurredAt?: string | null;
  /**
   * Poloha TABLETU při potvrzení — metainformace vedle polohy vozu, kterou server
   * odvozuje sám (viz lib/polohaZarizeni). Chybí-li, nese důvod (`unavailable`).
   */
  devicePosition?: DevicePositionPayload;
}

/**
 * Handover with evidence — what only a person standing at the tailgate supplies.
 *
 * Goes through `submit_evidence_review_audited` rather than straight to
 * `complete_workflow_step`, because that is the seam the audit hangs on: the
 * journal records the FACT and the SIZE of a signature, never the image, and
 * the position is derived server-side rather than taken from the client. The
 * evidence key set is CLOSED — `recipient`, `signature` and `device_position`,
 * an unknown key raises. `device_position` (2026-09-18) is the TABLET's own
 * reading, stored beside the derived position as `device_geo` — metadata that
 * corroborates the record, never a replacement for the evidence position.
 */
export function useSubmitHandover() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: HandoverInput): Promise<CompleteStepResult> => {
      const { data, error } = await workflowRpc("submit_evidence_review_audited", {
        p_entity_kind: "workflow_step",
        p_entity_id: input.stepId,
        p_decision: input.decision ?? HANDOVER_CONFIRMED,
        p_note: input.note ?? null,
        p_evidence: {
          recipient: input.recipient,
          signature: input.signature,
          ...(input.devicePosition ? { device_position: input.devicePosition } : {}),
        } as Json,
        p_occurred_at: input.occurredAt ?? null,
      });
      if (error) throw asError("workflow.handover", error);
      // The RPC turns a refused completion into an exception, so reaching here
      // with a falsy `ok` would be a contract change, not a normal outcome.
      const result = data as CompleteStepResult;
      if (result && result.ok === false) throw new Error(result.error ?? "handover refused");
      return result;
    },
    // Obě fronty: osobní seznam i právě otevřený krok (dispečer se dívá na jeden).
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-workflow-steps"] });
      qc.invalidateQueries({ queryKey: ["workflow-step"] });
    },
  });
}

export interface MeterReadingInput {
  stepId: string;
  /** Hodnota POTVRZENÁ člověkem u měřidla — ne návrh čtečky. */
  value: number;
  unit?: string | null;
  note?: string | null;
  /** Co appka vyčetla, než to člověk potvrdil (stopa kvality čtečky). */
  suggested?: number | null;
  /** Klíč nahraného snímku v úložišti; foto je doklad navíc, ne podmínka. */
  photoKey?: string | null;
  /** Kdy se odečet stal V TERÉNU (offline fronta odesílá později). */
  occurredAt?: string | null;
}

/**
 * Odečet měřidla — hodnota jde SPOLU s potvrzením.
 *
 * Appka hodnotu z displeje vyčte a nabídne, člověk ji potvrdí nebo přepíše;
 * odesílá se tedy HODNOTA, ne úkol vyčíst ji později. Stroj pomáhá, ale
 * validace zůstává na tom, kdo pořizuje — proto je `value` povinná a `suggested`
 * (strojní návrh) jde vedle ní jen jako stopa, nikdy jako autorita.
 *
 * RPC zapíše pozorování k twinu MĚŘIDLA a rovnou uzavře milník: člověk u
 * měřidla potvrdil, tím je odečet hotový a na nikoho dalšího se nečeká.
 */
export function useSubmitMeterReading() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: MeterReadingInput): Promise<CompleteStepResult> => {
      // Parametry ABECEDNĚ — drží brána rpc-params-alphabetical.
      // Nepovinné parametry se VYNECHÁVAJÍ, ne posílají jako null: generované
      // typy je mají `?: T`, takže null by neprošel — a serveru je to jedno,
      // protože má u obou defaulty. Parametry ABECEDNĚ (brána rpc-params-alphabetical).
      const { data, error } = await api.rpc("submit_meter_reading_audited", {
        ...(input.note ? { p_note: input.note } : {}),
        ...(input.occurredAt ? { p_occurred_at: input.occurredAt } : {}),
        ...(input.photoKey ? { p_photo_key: input.photoKey } : {}),
        p_step_id: input.stepId,
        ...(input.suggested != null ? { p_suggested: input.suggested } : {}),
        ...(input.unit ? { p_unit: input.unit } : {}),
        p_value: input.value,
      });
      if (error) throw asError("meter.reading", error);
      const result = data as unknown as CompleteStepResult;
      if (result && result.ok === false) throw new Error(result.error ?? "reading refused");
      return result;
    },
    // Obě fronty: osobní seznam i právě otevřený krok (dispečer se dívá na jeden).
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-workflow-steps"] });
      qc.invalidateQueries({ queryKey: ["workflow-step"] });
    },
  });
}


