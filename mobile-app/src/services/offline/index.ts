/**
 * Offline queue service.
 * Stores mutations while offline, processes sequentially on reconnect.
 * Max 3 retries per mutation, cache persistence for React Query.
 */
import { TrezorNecitelny } from "@/lib/trezor";
import { prectiAMigruj, smaz, zapis, type TrezorStoreDeps } from "@/services/trezorStore";
import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import { api } from "@/config/api";
import { safeError, safeInfo } from "@/lib/security/safeLogger";
import type { Json } from "@/types/database";

const OFFLINE_QUEUE_KEY = "@aisha/offline_queue";
const QUERY_CACHE_KEY = "@aisha/query_cache";
const MAX_RETRIES = 3;
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

export type OfflineMutationType =
  | "send_chat_message"
  | "transition_status"
  | "submit_questionnaire"
  | "rate_message"
  | "save_naturel_style"
  /**
   * Dokončení milníku v terénu — předání dodáku, odečet měřidla.
   *
   * Tohle je ten důvod, proč fronta existuje: v lomu ani na odlehlém odběrném
   * místě signál není, a potvrzení, které se nedá odeslat, je potvrzení, které
   * se nestalo. Do 2026-08-05 fronta znala jen tři mutace a předání mezi nimi
   * nebylo — offline řidič tedy narazil, jen o vrstvu níž než dřív.
   */
  | "complete_workflow_step"
  /**
   * Odečet měřidla pořízený bez signálu.
   *
   * Odběrná místa bývají odlehlá — právě tam signál nebývá. Hodnota, kterou
   * člověk u měřidla potvrdil, se proto uloží a odešle sama; OCR běží na
   * zařízení, takže bez sítě funguje i vyčtení. Bez tohohle by odečet vypadal
   * jako „appka to nevzala" přesně na místech, kvůli kterým existuje.
   */
  | "submit_meter_reading";

export interface OfflineMutation {
  id: string;
  payload: Record<string, unknown>;
  retryCount: number;
  timestamp: number;
  type: OfflineMutationType;
  /**
   * ⭐ ČÍ TA PRÁCE JE — KC `sub` toho, kdo ji v terénu odvedl.
   *
   * Bez tohohle pole šla práce řidiče A odeslat pod účtem řidiče B, který se na
   * sdílený telefon směny přihlásil po něm: server zapíše `completed_by = B`
   * k podpisu, který sbíral A, a AUDIT PAK TVRDÍ NEPRAVDU. Podpis je právní
   * důkaz pro fakturaci — jméno u něj musí sedět.
   *
   * `undefined` = mutace z buildu PŘED touhle změnou. Takovou nelze nikomu
   * přiřknout, takže se NIKDY neodešle sama a NIKDY nesmaže; rozhodne o ní
   * člověk.
   */
  ownerUid?: string;
  /**
   * ⭐ VRATNÉ OKNO — dřív než tenhle čas se mutace NEODESÍLÁ.
   *
   * Předloha majitele („VRATNÉ 15 MIN") dává řidiči chvíli, kdy jde předání
   * vzít zpět. Je to ZDRŽENÍ OUTBOXU, ne mazání auditního záznamu: dokud práce
   * neodešla, na serveru nic nevzniklo a vrácení je prosté zahození řádku ve
   * frontě. Kdyby se odesílalo hned a vracelo kompenzací, musel by se rušit
   * záznam o právním důkazu — a ten se ruší hůř než čeká.
   *
   * `undefined` = odeslat při první příležitosti (odečty, běžné mutace).
   */
  notBefore?: number;
  /**
   * Vyčerpala pokusy a čeká na člověka.
   *
   * ZŮSTÁVÁ VE FRONTĚ. Dřív se v tomhle místě mutace zahodila, takže odvedená
   * práce z terénu zmizela a zbyl po ní jen řádek v logu. Zahodit ji smí jedině
   * člověk, který ji vidí.
   */
  needsAttention?: boolean;
  /** Proč naposledy selhala — aby se dalo říct PROČ čeká, ne jen ŽE čeká. */
  lastFailure?: FailureKind;
}

type MutationHandler = (payload: Record<string, unknown>) => Promise<void>;

const handlers = new Map<OfflineMutationType, MutationHandler>();
let defaultHandlersRegistered = false;

function requireString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Offline mutation payload missing ${key}`);
  }
  return value;
}

function optionalString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function requireRecord(payload: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = payload[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Offline mutation payload missing ${key}`);
  }
  return value as Record<string, unknown>;
}

/**
 * Selhání, které si s sebou nese HTTP status.
 *
 * Obyčejná `Error` ho ztratí, a bez statusu nejde odlišit „server odmítl mou
 * identitu" od „server nerozuměl datům" — což je přesně ten rozdíl, na kterém
 * stojí, jestli se spotřebuje pokus a jestli se práce z terénu zahodí.
 */
export class RpcFailure extends Error {
  readonly status?: number;
  /** `code` z odpovědi — u 403 rozhoduje, ČÍ to odmítnutí je (viz classifyFailure). */
  readonly code?: string;
  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = "RpcFailure";
    this.status = status;
    this.code = code;
  }
}

/**
 * Odpověď serveru → chyba, kterou umí přečíst `classifyFailure`.
 *
 * ⛔ NESMÍ NIC ZAHODIT. Do 2026-08-08 se tady ztrácel `status` a nebylo z čeho
 * odlišit „server odmítl mou identitu" od „server nerozuměl datům" — po třech
 * odmítnutích u dveří zmizela řidičova práce (PR #154). 2026-08-19 se ukázalo,
 * že o patro dál padal do stejné pasti `code`: dveřník i aplikace mluví
 * statusem 403 a rozlišit je jde JEN podle `code`, který se tu nepřenášel.
 *
 * Pravidlo: co server o odmítnutí řekl, to se donese celé. Vyhodnocuje se až
 * v `classifyFailure`, na jednom místě.
 */
function throwRpcError(scope: string, error: unknown): never {
  safeError(scope, error);
  if (error instanceof Error) throw error;
  if (error && typeof error === "object" && "message" in error) {
    const e = error as { message: unknown; status?: unknown; code?: unknown };
    throw new RpcFailure(
      String(e.message),
      typeof e.status === "number" ? e.status : undefined,
      typeof e.code === "string" ? e.code : undefined,
    );
  }
  throw new Error(scope);
}

/**
 * Proč se mutace nepovedla. Rozhoduje o dvou věcech: jestli se spotřebuje
 * pokus a jestli má smysl pokračovat na další mutaci.
 *
 * ⭐ POKUS SMÍ SPOTŘEBOVAT JEN `rejected`. Ostatní tři nejsou vada TÉ MUTACE —
 * jsou to okolnosti (síť, zamčení, výpadek serveru). Do 2026-08-08 se
 * nerozlišovaly vůbec a po třech takových okolnostech se řidičův odečet i
 * potvrzené předání ZAHODILY z fronty. Potvrzení, které se stalo a pak zmizelo,
 * je horší než potvrzení, které se nedá odeslat.
 *
 * ⭐ CHYBĚJÍCÍ STATUS = `unreachable`, ne „neznámo". Když odpověď nedorazila,
 * server o mutaci neví; opakovat ji je bezpečné a nic to nestojí.
 */
export type FailureKind =
  /** Odpověď nedorazila (fetch selhal) — server o mutaci neví. */
  | "unreachable"
  /** Server odmítl IDENTITU (401/403). Tohle je stav, ve kterém má smysl zaklepat. */
  | "denied"
  /** Server má potíže nebo brzdí (408, 429, ≥500) — počkat, ne trestat mutaci. */
  | "transient"
  /** Server rozuměl a odmítl OBSAH — jediné, co je vada té mutace. */
  | "rejected";

/** Značka dveřníka, jak ji `api-core` překládá z hlavičky `x-aisha-door`. */
const DOOR_ERROR_CODE = "AISHA_DOOR_LOCKED";

export function classifyFailure(error: unknown): FailureKind {
  const status =
    error instanceof RpcFailure
      ? error.status
      : error && typeof error === "object" && typeof (error as { status?: unknown }).status === "number"
        ? ((error as { status: number }).status)
        : undefined;
  const code =
    error instanceof RpcFailure
      ? error.code
      : error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
        ? ((error as { code: string }).code)
        : undefined;

  if (status === undefined) return "unreachable";
  // 401 je identita vždy a bez výjimky — vypršelý token není vada mutace.
  if (status === 401) return "denied";
  if (status === 403) {
    // ⭐ 403 ŘÍKAJÍ DVA RŮZNÍ MLUVČÍ (2026-08-19, zadání majitele: vyhodnocení
    // odpovědi edge musí být JEDNOZNAČNÉ).
    //   · DVEŘNÍK — „jsi zamčený". Okolnost: zastaví běh a smysl má zaťukat.
    //   · APLIKACE — „na TENHLE úkon nemáš nárok" (RLS, errcode 42501; osm míst
    //     v SoT). Vada té jedné mutace: ostatní práce má jet dál a zaťukání by
    //     bylo naučené zbytečné zadávání break-glass materiálu.
    // Dispečer přehodí dodávku jinému řidiči → tohle je ten druhý případ.
    if (code === DOOR_ERROR_CODE) return "denied";
    // Aplikace odpověděla DŮVODEM (nese `code`) ⇒ mluvila aplikace, ne dveřník.
    if (code) return "rejected";
    // ⚠️ HOLÉ 403 BEZ ZNAČKY = jako dosud: dveřník. Je to degradace pro pořadí
    // nasazení (appka může jít ven dřív než brána se značkou) a je vědomě
    // v BEZPEČNÉM směru: horší, než je dnes, to nebude nikdy — jen to zůstane
    // stejné, dokud jedna ze dvou stran nezačne mluvit.
    return "denied";
  }
  if (status === 408 || status === 429 || status >= 500) return "transient";
  return "rejected";
}

/** Register a handler for a mutation type. Called from hooks at init. */
export function registerMutationHandler(
  type: OfflineMutationType,
  handler: MutationHandler
): void {
  handlers.set(type, handler);
}

/** Register built-in replay handlers for mobile mutations that are safe to retry. */
export function registerDefaultMutationHandlers(): void {
  if (defaultHandlersRegistered) return;

  registerMutationHandler("transition_status", async (payload) => {
    const storyId = requireString(payload, "storyId");
    const toStatus = requireString(payload, "toStatus");
    const { error } = await api.rpc("update_story_status_audited", {
      p_status: toStatus,
      p_story_id: storyId,
    });
    if (error) throwRpcError("offline.transition_status", error);
  });

  registerMutationHandler("submit_questionnaire", async (payload) => {
    const questionnaireId = requireString(payload, "questionnaireId");
    const responses = requireRecord(payload, "responses");
    const studyRegistrationId = optionalString(payload, "studyRegistrationId");
    const { error } = await api.rpc("submit_questionnaire_response", {
      p_questionnaire_id: questionnaireId,
      p_responses: responses as Json,
      p_study_registration_id: studyRegistrationId,
    });
    if (error) throwRpcError("offline.submit_questionnaire", error);
  });

  registerMutationHandler("save_naturel_style", async (payload) => {
    // Naturel style choice made offline (SDK rule: "Mobil snapshot-first" —
    // queue and write after login, never drop silently). Payload carries the
    // complete storyloop_settings patch; the RPC merges shallowly server-side.
    const settings = requireRecord(payload, "settings");
    const { error } = await api.rpc("update_my_storyloop_ui_preferences", {
      p_storyloop_settings: settings as Json,
    });
    if (error) throwRpcError("offline.save_naturel_style", error);
  });

  /**
   * Předání / odečet pořízené offline.
   *
   * Pořadí je dané: NEJDŘÍV evidence, POTOM milník. Kdyby se krok dokončil dřív,
   * mohl by po pádu uploadu zůstat uzavřený bez fotek, které ho dokládají —
   * a milník bez evidence je přesně to, kvůli čemu se evidence sbírá.
   *
   * ⭐ `occurredAt` = kdy řidič potvrdil V TERÉNU, ne kdy se sync povedl. Bez
   * něj by se do dokladu s právní váhou zapsal čas naší sítě.
   *
   * ⚠️ Idempotence uploadu: klíč objektu vyrábí server při preflightu, takže
   * opakovaný pokus by jinak vyrobil DRUHOU událost o téže fotce. Po každém
   * úspěšném snímku se proto payload ve frontě zkrátí — co je nahrané, se
   * podruhé nenahrává.
   */
  registerMutationHandler("complete_workflow_step", async (payload) => {
    const stepId = requireString(payload, "stepId");
    const mutationId = requireString(payload, "mutationId");
    const occurredAt = requireString(payload, "occurredAt");
    const signature = optionalString(payload, "signature");
    const note = optionalString(payload, "note");
    const recipient = optionalString(payload, "recipient");
    const hasDeviation = payload.hasDeviation === true;
    const photos = Array.isArray(payload.photos) ? (payload.photos as QueuedPhoto[]) : [];
    // Poloha tabletu změřená PŘI POTVRZENÍ (ne teď, při přehrání fronty).
    // Starší položky fronty ji nemají — pak se klíč vůbec neposílá.
    const devicePosition =
      payload.devicePosition && typeof payload.devicePosition === "object" ? (payload.devicePosition as Json) : null;

    const pending = [...photos];
    while (pending.length > 0) {
      const shot = pending[0];
      // Import je líný schválně: fronta se nahrává při startu appky a upload
      // evidence tahá `api` i picker types, které offline vrstva jinak nepotřebuje.
      const { uploadEvidencePhoto } = await import("@/lib/uploadEvidence");
      await uploadEvidencePhoto(
        { entityKind: "workflow_step", entityId: stepId },
        shot.slot,
        { uri: shot.uri, takenAt: shot.takenAt, mimeType: shot.mimeType, fileSizeBytes: shot.fileSizeBytes },
      );
      pending.shift();
      await updateQueuedPayload(mutationId, { ...payload, photos: pending });
    }

    // Dva švy, tentýž rozdíl jako online: s podpisem jde dokončení auditovanou
    // evidenční cestou, bez něj obyčejnou. Vynutit evidenční cestu vždy by
    // znamenalo vymyslet podpis, který nikdo nedal.
    if (signature) {
      // Parametry ABECEDNĚ — drží to brána rpc-params-alphabetical.
      const { error } = await api.rpc("submit_evidence_review_audited", {
        p_decision: hasDeviation ? "DEVIATION" : "HUMAN_CONFIRMED",
        p_entity_id: stepId,
        p_entity_kind: "workflow_step",
        p_evidence: {
          recipient: recipient ?? "",
          signature,
          ...(devicePosition ? { device_position: devicePosition } : {}),
        } as Json,
        p_note: note,
        p_occurred_at: occurredAt,
      });
      if (error) throwRpcError("offline.complete_workflow_step.evidence", error);
      return;
    }

    const { error } = await api.rpc("complete_workflow_step", {
      p_has_deviation: hasDeviation,
      p_notes: note,
      p_occurred_at: occurredAt,
      p_output_data: {
        recipient: recipient ?? null,
        items_ok: payload.itemsOk !== false,
        ...(devicePosition ? { device_position: devicePosition } : {}),
      } as Json,
      p_step_id: stepId,
    });
    if (error) throwRpcError("offline.complete_workflow_step", error);
  });

  /**
   * Odečet odeslaný z fronty.
   *
   * Pořadí je totéž jako online: NEJDŘÍV doklad, POTOM hodnota — a foto smí
   * selhat, aniž by odečet padl. Hodnota je to, co člověk potvrdil; doklad je
   * navíc a jeho nedostupnost nesmí zahodit práci, kvůli které tam jel.
   *
   * ⚠️ Idempotence: `submit_meter_reading_audited` klíčuje událost KROKEM, takže
   * opakované přehrání tutéž hodnotu přepíše místo aby vyrobilo druhý odečet.
   * Klíčem je stav, nikdy čas.
   */
  registerMutationHandler("submit_meter_reading", async (payload) => {
    const stepId = requireString(payload, "stepId");
    const mutationId = requireString(payload, "mutationId");
    const occurredAt = requireString(payload, "occurredAt");
    const value = Number(payload.value);
    if (!Number.isFinite(value)) {
      throw new Error("Offline meter reading has no usable value");
    }
    const note = optionalString(payload, "note");
    const suggested = typeof payload.suggested === "number" ? payload.suggested : undefined;
    const photos = Array.isArray(payload.photos) ? (payload.photos as QueuedPhoto[]) : [];

    let photoKey = optionalString(payload, "photoKey");
    if (!photoKey && photos.length > 0) {
      try {
        const { uploadEvidencePhoto } = await import("@/lib/uploadEvidence");
        const shot = photos[0];
        const up = await uploadEvidencePhoto(
          { entityKind: "workflow_step", entityId: stepId },
          shot.slot,
          { uri: shot.uri, takenAt: shot.takenAt, mimeType: shot.mimeType, fileSizeBytes: shot.fileSizeBytes },
        );
        photoKey = up.objectKey;
        // Co je nahrané, se podruhé nenahrává — jinak by každý retry vyrobil
        // další kopii téhož snímku.
        await updateQueuedPayload(mutationId, { ...payload, photoKey, photos: [] });
      } catch {
        // Doklad se nepovedl; hodnota je pořád platná a musí odejít.
        photoKey = undefined;
      }
    }

    // Parametry ABECEDNĚ (brána rpc-params-alphabetical); nepovinné se vynechávají.
    const { error } = await api.rpc("submit_meter_reading_audited", {
      ...(note ? { p_note: note } : {}),
      p_occurred_at: occurredAt,
      ...(photoKey ? { p_photo_key: photoKey } : {}),
      p_step_id: stepId,
      ...(suggested != null ? { p_suggested: suggested } : {}),
      p_value: value,
    });
    if (error) throwRpcError("offline.submit_meter_reading", error);
  });

  defaultHandlersRegistered = true;
}

/** Jeden snímek čekající ve frontě — jen odkaz na lokální soubor, nikdy obsah. */
interface QueuedPhoto {
  slot: string;
  uri: string;
  takenAt: string;
  mimeType?: string;
  fileSizeBytes?: number;
}

/**
 * Přepíše payload čekající mutace.
 *
 * Existuje kvůli dílčímu postupu: mutace, která nahrála dvě fotky ze tří a pak
 * ztratila signál, se musí vrátit do fronty BEZ těch dvou. Jinak by každý retry
 * začínal od začátku a vyráběl duplicitní evidenci — a čím horší síť, tím víc
 * duplikátů, tedy přesně tam, kde to nejmíň chceme.
 */
export async function updateQueuedPayload(
  id: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const queue = await loadQueue();
  const hit = queue.find((m) => m.id === id);
  if (!hit) return;
  hit.payload = payload;
  await saveQueue(queue);
}

/**
 * Trezor pro frontu — DOSAZUJE HO APPKA, tenhle modul si ho nebere sám.
 *
 * ⛔ PROČ NE STATICKÝ IMPORT NATIVNÍHO ADAPTÉRU. `knock-native.ts` má
 * v hlavičce napsané „tenhle soubor se do jestu netahá" — linkuje
 * `react-native-udp` a nativní krypto. Jenže `services/offline` importují
 * testy, takže by ten import vtáhl C++ do jestu a celá sada by se ani
 * nespustila. (Ověřeno tvrdě: sada přestala parsovat hned, jak jsem to zkusil.)
 *
 * ⛔ A ŽÁDNÝ FALLBACK NA NEZAMČENÉ ÚLOŽIŠTĚ. Kdyby si tenhle modul při chybějící
 * vazbě sáhl rovnou na AsyncStorage, vznikl by build, ve kterém šifrování mlčky
 * neplatí — podpisy by ležely v plaintextu a nic by nezakřičelo. Nezapojený
 * trezor je proto CHYBA, ne režim.
 */
let trezorDeps: TrezorStoreDeps | null = null;

/** Zapojí úložiště. Volá appka při startu (a testy si dosadí paměťové). */
export function setTrezorDeps(d: TrezorStoreDeps | null): void {
  trezorDeps = d;
}

/**
 * Kdo je právě přihlášený. Injektuje appka — TENTÝŽ důvod jako u trezoru:
 * `config/oidc` tahá `expo-linking`, a statickým importem by se rozbila celá
 * testovací sada (ověřeno tvrdě o pár commitů dřív).
 *
 * ⛔ Bez poskytovatele se práce NEODESÍLÁ. Fronta bez identity je přesně stav,
 * ve kterém vznikl nález N3 — a tichý průchod „když nevím, tak pošli" by ho
 * vrátil zpátky.
 */
let identityProvider: (() => Promise<string | null>) | null = null;

/** Zapojí identitu. Volá appka při startu (a testy si dosadí svoji). */
export function setIdentityProvider(fn: (() => Promise<string | null>) | null): void {
  identityProvider = fn;
}

async function kdoJsem(): Promise<string | null> {
  if (!identityProvider) return null;
  try {
    return await identityProvider();
  } catch {
    // „Nevím, kdo jsem" se chová jako cizí: radši neodeslat než odeslat pod
    // nesprávným jménem. Ztráta se nekoná — práce zůstává ve frontě.
    return null;
  }
}

function trezor(): TrezorStoreDeps {
  if (!trezorDeps) {
    throw new Error(
      "offline: trezor není zapojený — zavolej setTrezorDeps() při startu appky. " +
      "Bez něj by fronta ležela na disku nezamčená a nikdo by si toho nevšiml.",
    );
  }
  return trezorDeps;
}

/**
 * Načte frontu.
 *
 * ⛔ TADY BYLO `catch { return [] }` A BYLA TO NEJHORŠÍ VĚTA V CELÉM SOUBORU.
 * Se šifrováním je přímo smrtelná: nečitelný trezor (ztracený klíč po obnově
 * systému) by vypadal jako prázdná fronta, appka by řekla „nic nemáš" a první
 * zápis by ten obsah PŘEPSAL — z dočasné nečitelnosti by se stala trvalá ztráta
 * podepsaného předání.
 *
 * Nečitelnost se proto propouští ven jako výjimka. Volající s ní musí něco
 * udělat; nikdo ji nesmí zaměnit za prázdno.
 */
async function loadQueue(): Promise<OfflineMutation[]> {
  const p = await prectiAMigruj(trezor(), OFFLINE_QUEUE_KEY);
  if (p === null) return [];
  try {
    const parsed: unknown = JSON.parse(p.text);
    // Obsah, který se rozšifroval, ale není fronta, NENÍ prázdná fronta —
    // je to poškozený obsah a platí pro něj totéž pravidlo.
    if (!Array.isArray(parsed)) throw new TrezorNecitelny("obsah není fronta");
    return parsed as OfflineMutation[];
  } catch (e) {
    throw e instanceof TrezorNecitelny ? e : new TrezorNecitelny("fronta nejde přečíst jako JSON");
  }
}

/** Zapíše frontu ZAMČENOU. */
async function saveQueue(queue: OfflineMutation[]): Promise<void> {
  await zapis(trezor(), OFFLINE_QUEUE_KEY, JSON.stringify(queue));
}

/** Enqueue a mutation for later processing. */
export async function enqueueMutation(
  id: string,
  payload: Record<string, unknown>,
  type: OfflineMutationType,
  opts?: { notBefore?: number },
): Promise<void> {
  const queue = await loadQueue();
  queue.push({
    id,
    // Vlastník se zapisuje PŘI ZAŘAZENÍ, ne při odeslání: v tu chvíli je ještě
    // jisté, kdo tu práci odvedl. Při odeslání už na telefonu může být někdo jiný.
    notBefore: opts?.notBefore,
    ownerUid: (await kdoJsem()) ?? undefined,
    payload,
    retryCount: 0,
    timestamp: Date.now(),
    type,
  });
  await saveQueue(queue);
  safeInfo("offline.enqueued", { id, type });
}

export interface QueueRunResult {
  /** Odesláno a potvrzeno serverem. */
  processed: number;
  /** Vyčerpalo pokusy a čeká na člověka — ale JE POŘÁD VE FRONTĚ. */
  needsAttention: number;
  /**
   * Práce, která NENÍ přihlášeného — čeká na svého člověka.
   *
   * ⭐ Vlastní číslo, ne součást `needsAttention`: „vyčerpalo pokusy" znamená
   * „server to opakovaně odmítl", kdežto tohle znamená „nikdo se o to
   * nepokusil, protože to není tvoje". Slít je dohromady by z cizí práce
   * udělalo vadnou a někdo by ji šel „opravovat".
   */
  cizi: number;
  /**
   * Práce, které ještě běží vratné okno — NEODEŠLA a je to v pořádku.
   *
   * Vlastní číslo ze stejného důvodu jako `cizi`: „ještě nemá odejít" není
   * „nepovedlo se". Slité do chyb by z běžného stavu udělalo poplach.
   */
  drzene: number;
  /**
   * Proč se běh zastavil, nebo `null` když doběhl celý.
   *
   * `denied` je stav, ve kterém má smysl nabídnout zaklepání: máme spojení,
   * ale protistrana nás odmítá. `unreachable` naopak znamená „nemáme signál" —
   * tam by se člověk na kód ptal zbytečně.
   */
  /**
   * ⭐ `unreadable-store` NENÍ `FailureKind`: ten popisuje, proč selhala MUTACE.
   * Tohle je o ÚLOŽIŠTI — nedá se přečíst, takže se ani neví, co ve frontě je.
   * Slít to do „rejected" by znamenalo trestat mutaci, kterou nikdo neviděl.
   */
  stoppedBy: FailureKind | "unreadable-store" | null;
  /** Zpětná kompatibilita s volajícími, kteří četli `failed`. */
  failed: number;
}

/**
 * Odešle, co čeká ve frontě.
 *
 * ⛔ NIC SE NEZAHAZUJE. Fronta drží práci, kterou člověk odvedl v terénu —
 * odečet u měřidla, potvrzené předání, podpis. Jediné, co se s ní smí stát bez
 * člověka, je odeslání. Vyčerpané pokusy ji označí `needsAttention`, ale
 * nechají ji na místě.
 *
 * ⭐ BĚH SE ZASTAVÍ na první okolnosti, která není vada mutace (nedostupnost,
 * odmítnutá identita, výpadek serveru). Pokračovat nemá smysl — další mutace
 * narazí na totéž — a hlavně by se tím spotřebovaly pokusy za okolnost, se
 * kterou ta data nemají nic společného. Obchodní odmítnutí (`rejected`) je
 * naopak vlastnost TÉ mutace, takže se pokračuje dál.
 */
export async function processOfflineQueue(): Promise<QueueRunResult> {
  registerDefaultMutationHandlers();
  let queue: OfflineMutation[];
  try {
    queue = await loadQueue();
  } catch (e) {
    // ⛔ NEČITELNÝ TREZOR: běh se nekoná a ÚLOŽIŠTĚ SE NEDOTKNEME. Jakýkoli
    // zápis by přepsal obsah, který jen momentálně nejde otevřít (jiný profil,
    // klíč po obnově systému) — a udělal by ze ztráty trvalou. Vrací se to
    // volajícímu, aby to vyslovil; ticho by vypadalo jako prázdná fronta.
    if (e instanceof TrezorNecitelny) {
      safeError("offline.storeUnreadable", { message: e.message });
      return { cizi: 0, drzene: 0, failed: 0, needsAttention: 0, processed: 0, stoppedBy: "unreadable-store" };
    }
    throw e;
  }
  if (queue.length === 0) {
    return { cizi: 0, drzene: 0, failed: 0, needsAttention: 0, processed: 0, stoppedBy: null };
  }

  safeInfo("offline.processing", { count: queue.length });

  const remaining: OfflineMutation[] = [];
  let processed = 0;
  let cizi = 0;
  let drzene = 0;
  let stoppedBy: FailureKind | null = null;

  // Kdo právě sedí za volantem. Zjišťuje se JEDNOU na začátku běhu: kdyby se
  // ptalo per mutaci, mohl by se uprostřed běhu přihlásit někdo jiný a půlka
  // fronty by odešla pod jedním jménem a půlka pod druhým.
  const jaUid = await kdoJsem();

  for (const mutation of queue) {
    // Jakmile běh narazil na okolnost, zbytek se BEZE ZMĚNY vrací do fronty:
    // nezkoušel se, takže nemá co spotřebovat.
    if (stoppedBy) {
      remaining.push(mutation);
      continue;
    }

    /*
      ⛔ CIZÍ PRÁCE SE NEODESÍLÁ — a NESMAŽE.

      Sdílený telefon směny: řidič A zaznamená předání offline, telefon převezme
      řidič B a přihlásí se. Bez téhle větve by se A práce odeslala pod účtem B,
      server by zapsal `completed_by = B` k podpisu, který sbíral A, a audit by
      tvrdil nepravdu o právním důkazu pro fakturaci.

      Není to okolnost (`stoppedBy`) — běh POKRAČUJE, aby vlastní práce
      přihlášeného odešla. Je to vlastnost té jedné položky: počká na svého
      člověka. Odhlášení frontu nemaže (rozhodnutí majitele 08-19: „zamknout",
      ne blokovat odhlášení), takže se odešle, až se A vrátí.

      `undefined` vlastník = mutace z buildu před touhle změnou. Přiřknout ji
      komukoli by byla táž vada; rozhodne o ní člověk.
    */
    /*
      ⭐ DRŽENÁ PRÁCE — vratné okno ještě běží.

      Není to vada mutace ani okolnost: nikdo ji nezkoušel, protože ještě NEMÁ
      odejít. Pokus se proto nespotřebuje, běh POKRAČUJE na další položku a
      držená se vrací do fronty beze změny. Kdyby se počítala jako `cizi` nebo
      `needsAttention`, vypadala by v appce jako problém — a přitom je to úplně
      normální stav prvních patnácti minut po předání.
    */
    if (mutation.notBefore !== undefined && mutation.notBefore > Date.now()) {
      remaining.push(mutation);
      drzene++;
      continue;
    }

    if (jaUid === null || mutation.ownerUid !== jaUid) {
      safeInfo("offline.cizi", { id: mutation.id, type: mutation.type });
      remaining.push({ ...mutation, needsAttention: true });
      cizi++;
      continue;
    }

    const handler = handlers.get(mutation.type);
    if (!handler) {
      // Chybějící handler NENÍ důvod smazat práci. Je to vada aplikace (starší
      // build, přejmenovaný typ), a ta se opraví aktualizací — data mezitím
      // musí přežít. Dřív se tady mutace zahodila okamžitě, bez jediného pokusu.
      safeError("offline.noHandler", { type: mutation.type });
      remaining.push({ ...mutation, lastFailure: "rejected", needsAttention: true });
      continue;
    }

    try {
      await handler(mutation.payload);
      processed++;
    } catch (err) {
      const kind = classifyFailure(err);
      if (kind !== "rejected") {
        // Okolnost, ne vada mutace: pokus se NEspotřebuje a běh končí.
        stoppedBy = kind;
        safeInfo("offline.stopped", { id: mutation.id, kind, type: mutation.type });
        remaining.push({ ...mutation, lastFailure: kind });
        continue;
      }

      const retryCount = mutation.retryCount + 1;
      const exhausted = retryCount >= MAX_RETRIES;
      if (exhausted) {
        safeError("offline.needsAttention", { id: mutation.id, type: mutation.type });
      }
      remaining.push({
        ...mutation,
        lastFailure: "rejected",
        retryCount,
        ...(exhausted ? { needsAttention: true } : {}),
      });
    }
  }

  await saveQueue(remaining);
  const needsAttention = remaining.filter((m) => m.needsAttention).length;
  safeInfo("offline.processed", {
    cizi,
    needsAttention,
    processed,
    remaining: remaining.length,
    stoppedBy,
  });
  return { cizi, drzene, failed: needsAttention, needsAttention, processed, stoppedBy };
}

/** Kolik položek čeká na člověka (vyčerpaly pokusy, ale nejsou ztracené). */
export async function getNeedsAttentionCount(): Promise<number> {
  const queue = await loadQueue();
  return queue.filter((m) => m.needsAttention).length;
}

/** Get current queue size. */
export async function getQueueSize(): Promise<number> {
  const queue = await loadQueue();
  return queue.length;
}

/**
 * Vrátí předání, kterému ještě běží vratné okno.
 *
 * ⭐ VRACET JDE JEN TO, CO JEŠTĚ NEODEŠLO — a je to celý důvod, proč se drží
 * v outboxu místo okamžitého odeslání. Dokud práce nedorazila na server, nic
 * tam nevzniklo a vrácení je prosté zahození řádku. Po odeslání už existuje
 * auditovaný záznam o právním důkazu a ten se neruší mazáním; k tomu vede
 * kompenzující úkon, ne tahle funkce.
 *
 * Vrací `true`, když se opravdu vrátilo. `false` znamená „nešlo" — položka
 * mezitím odešla, okno vypršelo, nebo tam vůbec není. ⛔ NIKDY nemaže něco,
 * čemu okno neběží; tichý úspěch by z „už je pryč" udělal „zrušeno".
 */
export async function vratDrzenePredani(id: string): Promise<boolean> {
  const queue = await loadQueue();
  const hit = queue.find((m) => m.id === id);
  if (!hit || hit.notBefore === undefined || hit.notBefore <= Date.now()) return false;
  await saveQueue(queue.filter((m) => m.id !== id));
  safeInfo("offline.vraceno", { id, type: hit.type });
  return true;
}

/** Clear offline queue. */
export async function clearQueue(): Promise<void> {
  await smaz(trezor(), OFFLINE_QUEUE_KEY);
}

/** Current network state, treating unknown internet reachability as usable when the link is connected. */
export async function isNetworkConnected(): Promise<boolean> {
  const state = await NetInfo.fetch();
  return state.isConnected === true && state.isInternetReachable !== false;
}

/**
 * Uloží cache dotazů, aby byla páska čitelná i bez signálu.
 *
 * ⭐ ZAPOJENO 2026-08-19 (rozhodnutí majitele). Tahle dvojice funkcí tu do
 * dneška LEŽELA NEPOUŽITÁ — definovaná, otestovaná nikým a nikým nevolaná.
 * Mrtvý kód není ověřený kód; v tomhle repu to naposledy dokázal `knock.ts`,
 * který měl šest testů a první skutečný import shodil archiv.
 *
 * ⛔ A JDE PŘES TREZOR, ne přes holý AsyncStorage. Cache pásky nese jména
 * odběratelů, adresy míst a čísla dodáků — tedy totéž, co fronta. Zapojit ji
 * nezamčenou by znamenalo zamknout přední dveře a otevřít zadní.
 */
export async function persistQueryCache(cacheData: unknown): Promise<void> {
  try {
    await zapis(trezor(), QUERY_CACHE_KEY, JSON.stringify({ data: cacheData, timestamp: Date.now() }));
  } catch (error) {
    // Cache je POHODLÍ, ne pravda: když se ji nepodaří uložit, appka funguje
    // dál a jen si příště sáhne na server. Fronta má opačné pravidlo — tam
    // ticho znamená ztracenou práci.
    safeError("offline.persistCache", error);
  }
}

/**
 * Vrátí cache, pokud ještě není stará.
 *
 * ⛔ Nečitelná cache se MLČKY zahodí — a je to tady správně, na rozdíl od
 * fronty. Cache je odvozená kopie serveru: ztratit ji znamená jedno síťové
 * volání navíc. Fronta je JEDINÝ výskyt práce, kterou člověk odvedl v terénu,
 * a proto tam totéž ticho znamená ztrátu. Týž zápis, opačné pravidlo — proto
 * to tu stojí napsané.
 */
export async function restoreQueryCache(): Promise<unknown | null> {
  try {
    const p = await prectiAMigruj(trezor(), QUERY_CACHE_KEY);
    if (!p) return null;
    const { data, timestamp } = JSON.parse(p.text) as { data: unknown; timestamp: number };
    if (Date.now() - timestamp > CACHE_MAX_AGE_MS) {
      await smaz(trezor(), QUERY_CACHE_KEY);
      return null;
    }
    return data;
  } catch (error) {
    safeError("offline.restoreCache", error);
    return null;
  }
}

/** Subscribe to network state changes. Returns unsubscribe function. */
export function subscribeToNetworkChanges(
  callback: (isConnected: boolean) => void
): () => void {
  return NetInfo.addEventListener((state: NetInfoState) => {
    callback(state.isConnected === true && state.isInternetReachable !== false);
  });
}
