/**
 * Native renderer for extranet surface blocks — the mobile counterpart of the
 * web shells' es-* components, driven by the SAME block contract. Renders only
 * the block types the Porada needs today; unknown types degrade to a labelled
 * placeholder rather than throwing. Every value carries its provenance
 * ("žádné číslo bez zdroje"). Presentation length follows the naturel policy.
 */
import { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "@/hooks";
import { colors, spacing, typography } from "@/theme";
import { api } from "@/config/api";
import { useBlockData } from "./useSurface";
import { PaskaDne } from "./PaskaDne";
// Jazyk ESDK nativně — týž jazyk jako na webu, jen jiná platforma. Věty, které
// tyhle komponenty drží, jsou vypsané v `@aisha/extranet-sdk-ui` → `JAZYK.json`
// a brána `jazyk-parita` hlídá, že je dokládají OBA renderery.
import { Es, Fact, Lamp, Prov, type LampState } from "./esdk";
import type { BlockProvenance, SurfaceLayoutBlock } from "./useSurface";
import type { DialogPolicy } from "@/naturel/policy";

/**
 * Kam vede položka fronty, když na ni člověk klepne.
 *
 * Klíčem je `entity_kind` — ÚDAJ Z BLOKU, ne slug bloku a ne doménové jméno.
 * Fronta předání i fronta odečtů nesou obě `workflow_step`, takže obě vedou na
 * tutéž obrazovku bez jediné zmínky o dodáku; třetí fronta nad jiným druhem
 * entity sem přidá řádek, ne větev v renderu.
 *
 * Druh, který tu není, prostě není klikací — položka se vykreslí jako dřív.
 * Degradace je tichá ZÁMĚRNĚ: nový druh na starším buildu nesmí frontu shodit.
 */
const ENTITY_ROUTES: Record<string, (id: string) => void> = {
  workflow_step: (id) => router.push({ pathname: "/kroky", params: { step: id } }),
};

/**
 * Druh entity → její ÚKON (CTA karty TEĎ na pásce). Týž cíl jako ENTITY_ROUTES,
 * jen s přáním rovnou otevřít úkon — obrazovka ho splní, jen když krok úkon má
 * a ještě není hotový. Druh bez řádku: CTA vede na detail jako dřív.
 */
const ENTITY_ACTIONS: Record<string, (id: string) => void> = {
  workflow_step: (id) => router.push({ pathname: "/kroky", params: { step: id, akce: "predat" } }),
};

/**
 * Fill percentage for one chart point, 0–100.
 *
 * Prefers the point's own `pct` (the producer already knows what the value is a
 * share OF — a margin against plan is not the same as a share of the column
 * maximum). Falls back to scaling against the largest value in the set, which
 * is the only ratio derivable without that knowledge. Clamped, and guarded
 * against an all-zero set so an empty quarter renders as empty, not as NaN.
 */
function chartPct(point: ChartPointRow, points: ChartPointRow[]): number {
  const pct = Number(point?.pct);
  if (Number.isFinite(pct)) return Math.max(0, Math.min(100, pct));
  const max = Math.max(...points.map((p) => Number(p?.value) || 0), 0);
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, ((Number(point?.value) || 0) / max) * 100));
}

/**
 * Vlajky věže — sémantika je ZAVŘENÁ a nemění se (pravidlo P3 SDK):
 * zelená jede · žlutá kontrola · červená blokováno · modrá čeká na člověka ·
 * cíl doručeno.
 *
 * Barvy jsou STAVOVÉ tokeny, nikdy brand: kdyby vlajka brala primární barvu
 * instance, znamenala by v každé instanci něco jiného, a „blokováno" by mohlo
 * vyjít smířlivě zeleně. Proto se berou ze stavové části palety (error/warning/
 * success/info), která je napříč instancemi tatáž.
 */
const FLAGS: Record<string, { color: string }> = {
  green: { color: colors.success },
  yellow: { color: colors.warning },
  red: { color: colors.error },
  box: { color: colors.info },
  finish: { color: colors.textSecondary },
};

/**
 * Sekundy → čitelná délka. Řidič potřebuje řád veličiny („stojím tu 2 h"), ne
 * přesnost na vteřinu, takže se zaokrouhluje nahoru po minutách a nad hodinu se
 * minuty přidávají jen když nejsou nulové.
 */
function fmtDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const mins = Math.floor(total / 60);
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  if (hours < 24) return rest ? `${hours} h ${rest} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  const restH = hours % 24;
  return restH ? `${days} d ${restH} h` : `${days} d`;
}

/**
 * The mask catalogue this renderer draws — one entry per `block_type ===` branch
 * below, and the ONLY thing the "unknown type" notice consults.
 *
 * It used to be an inline list at the notice itself, which drifted out of the
 * parity gate's sight: the gate reads the equality branches below, so a second
 * hand-kept list could rot unseen, and did. Seven types that DO render also
 * printed "unknown type" underneath their own content, while `document_register`
 * and `obligation_queue` — RPC names, never block types — were listed as known,
 * so they degraded to a bare title in silence. The gate now reads this set too
 * and pins it equal to both the branches and the contract.
 */
const DRAWN_TYPES = new Set<string>([
  "alert_feed",
  "chart",
  "findings",
  "goal_progress",
  "kpi_tile",
  "narrative",
  "record_detail",
  "review_queue",
  "table",
  "timeline",
  "timing_tower",
  "handover_confirm",
  "action_form",
  "relation_web",
]);

/**
 * Provenience bloku.
 *
 * Jen ADAPTACE tvaru obálky na jazyk — kreslí `Prov` z `./esdk`, ne vlastní
 * text. Dřív si tenhle soubor tutéž větu psal po svém, což je přesně to
 * rozejití, kterému paritní brána brání: dvě „ZDROJ: …" by se lišily při první
 * změně jazyka a nikdo by si toho nevšiml.
 */
/**
 * Stáří údaje slovy, jak ho čte člověk u volantu.
 *
 * ⛔ NENÍ TO KOSMETIKA. Kontrakt nese `freshness_at` na sekundy, ale dokud se
 * kreslilo `toLocaleDateString()`, vypadal údaj starý šest hodin stejně čerstvě
 * jako údaj z posledních dvanácti sekund — obojí „2. 9. 2026". U dispečerských
 * čísel je přitom stáří půlka informace: „zdržení 22 min" znamená něco jiného,
 * když je z poslední minuty, a něco jiného, když je z rána.
 */
function stariSlovy(kdy: string): string | null {
  const t = Date.parse(kdy);
  if (!Number.isFinite(t)) return null;
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 0) return null;              // budoucnost = nedůvěryhodné razítko, radši nic
  if (s < 60) return `před ${s} s`;
  if (s < 3600) return `před ${Math.round(s / 60)} min`;
  if (s < 86_400) return `před ${Math.round(s / 3600)} h`;
  return new Date(t).toLocaleDateString();
}

function Provenance({ p }: { p?: BlockProvenance }) {
  if (!p?.source_slug) return null;
  // ⛔ CHYBĚJÍCÍ STÁŘÍ SE NEDOPLŇUJE. Dřív tu stálo `fresh || "aktuální"`, což
  // je tvrzení, které nikdo nedoložil: když razítko chybí, appka o čerstvosti
  // NEVÍ a nesmí ji slíbit. Je to týž zákon, jaký drží `Fact` („prázdný se
  // NEKRESLÍ") a `Prov` samo („žádné číslo bez zdroje") — jen se na něj tenhle
  // adaptér o patro výš zapomněl.
  const fresh = p.freshness_at ? stariSlovy(p.freshness_at) : null;
  return <Prov source={p.source_slug} freshness={fresh ?? undefined} />;
}

/**
 * Stav ukazatele → stav jazyka.
 *
 * `KpiState` je slovník KONTRAKTU (ok/warning/loss), `LampState` slovník
 * JAZYKA (ok/wait/fault/plan/mute). Nejsou to synonyma a mapa mezi nimi patří
 * sem — kdyby se kreslilo přímo z kontraktu, každý nový stav dat by znamenal
 * nový stav vzhledu a jazyk by se rozpustil v datech.
 *
 * Neznámý stav padá na `mute`, ne na `ok`: „nevím, co to je" se nesmí kreslit
 * jako „v pořádku".
 */
const KPI_LAMP: Record<string, LampState> = { ok: "ok", warning: "wait", loss: "fault" };

interface ChartPointRow {
  label?: string;
  value?: number;
  pct?: number;
  note?: string;
  state?: string;
}

interface Row {
  columns?: Array<{ key: string; label_key?: string; value_keys?: boolean }>;
  rows?: Array<Record<string, unknown>>;
  /** chart block — `kind` picks the visualisation, `points` is uniform across all three. */
  kind?: string;
  points?: ChartPointRow[];
  value?: unknown;
  state?: string;
  items?: Array<Record<string, unknown>>;
  /** review_queue — čeho se položky týkají (viz ENTITY_ROUTES). */
  entity_kind?: string;
  /** narrative */
  markdown?: string;
  /** record_detail */
  fields?: Array<Record<string, unknown>>;
  runs?: Array<ProcessRun>;
  /** timing_tower — sektory chodí ze šablony běhu, počet není konstanta. */
  towerRuns?: unknown;
  /** handover_confirm — potvrzení úkonu v terénu (kontrakt HandoverConfirmBlock). */
  step_id?: string;
  title?: string;
  steps?: Array<{ label: string; state: "done" | "now" | "next" }>;
  facts?: Array<{ label: string; value?: string | null }>;
  measure?: { label?: string; unit?: string; suggested?: string | null };
  evidence?: Array<{ slot: string; label?: string; filled: boolean }>;
  signature_required?: boolean;
  weight?: number;
  /** relation_web — síť vazeb (kontrakt RelationWebBlock); telefon ji kreslí jako seznam. */
  center?: { label?: string; sub?: string };
  groups?: Array<{ key: string; label_key: string; nodes: Array<Record<string, unknown>> }>;
  /** action_form — akce správy z plochy (kontrakt ActionFormBlock, K4). */
  target_kind?: string;
  target_id?: string | null;
  actions?: Array<Record<string, unknown>>;
}

/** goal_progress contract — a process run projected on its milestones. */
interface ProcessRun {
  batch_id?: string;
  title?: string;
  pos?: number;
  state?: string;
  milestones?: Array<{ code?: string; name?: string; order?: number; status?: string }>;
  goal?: { met?: boolean; completed?: number; total?: number };
}

/**
 * Řádek fronty. Klikací JEN tehdy, když blok řekl druh entity a položka nese id.
 *
 * Wrapper místo `onPress` přímo na `View` proto, že „otevřít" je vlastnost
 * POLOŽKY, ne kreslení: totéž se používá na pásce i na dispečerském seznamu a
 * obě větve tak nemůžou dostat jiné chování.
 */
function QueueRow({
  kind,
  id,
  style,
  children,
}: {
  kind?: string;
  id?: unknown;
  style?: object;
  children: React.ReactNode;
}) {
  const open = kind ? ENTITY_ROUTES[kind] : undefined;
  const entityId = typeof id === "string" && id ? id : null;
  if (!open || !entityId) return <View style={style}>{children}</View>;
  return (
    <TouchableOpacity
      style={style}
      onPress={() => open(entityId)}
      accessibilityRole="button"
      testID={`queue-open-${entityId}`}
    >
      {children}
    </TouchableOpacity>
  );
}

type MobileActionField = {
  key: string;
  label_key: string;
  type: string;
  required?: boolean;
  options?: Array<{ value: string; label_key: string }>;
  default?: string;
};
type MobileActionDef = { slug: string; title_key: string; description_key?: string; fields: MobileActionField[] };
type MobileActionState = "idle" | "submitting" | "done" | "error";

/**
 * Formulář akce správy (parita s web shellem). Vstupy podle DEKLARACE pole:
 * enum/boolean = volba z nabídky, ostatní = textový vstup s klávesnicí podle
 * typu. Server hodnoty ověří znovu — appka jen nepustí prázdné povinné pole.
 */
function MobileActionForm({
  targetKind,
  targetId,
  actions,
}: {
  targetKind: string;
  targetId: string | null;
  actions: MobileActionDef[];
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<MobileActionDef | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<MobileActionState>("idle");
  const canRun = targetId !== null;
  const targetParam = targetKind === "twin" ? "twin_id" : targetKind === "actor" ? "user_id" : "story_id";

  const pick = (a: MobileActionDef) => {
    const init: Record<string, string> = {};
    for (const f of a.fields) if (f.default !== undefined) init[f.key] = f.default;
    setValues(init);
    setStatus("idle");
    setOpen(a);
  };
  const complete = (a: MobileActionDef) => a.fields.every((f) => !f.required || (values[f.key] ?? "").trim() !== "");

  const send = async () => {
    if (!open || !canRun || status === "submitting" || !complete(open)) return;
    setStatus("submitting");
    try {
      const payload: Record<string, string> = {};
      for (const f of open.fields) {
        const v = (values[f.key] ?? "").trim();
        if (v !== "") payload[f.key] = v;
      }
      // Parametry abecedně — brána rpc-params-alphabetical (PostgREST cache signatur).
      await api.rpc("submit_surface_action", {
        p_action_slug: open.slug,
        p_payload: payload,
        p_target: { [targetParam]: targetId },
      });
      setStatus("done");
    } catch {
      setStatus("error");
    }
  };

  if (actions.length === 0) {
    return <Text style={styles.narrative}>{t("extranet.actionNone")}</Text>;
  }
  return (
    <View>
      <View style={styles.actionList}>
        {actions.map((a) => (
          <TouchableOpacity
            key={a.slug}
            disabled={!canRun}
            onPress={() => pick(a)}
            style={[styles.actionButton, open?.slug === a.slug && styles.actionButtonActive, !canRun && styles.actionButtonOff]}
            accessibilityRole="button"
            accessibilityLabel={t(a.title_key)}
          >
            <Text style={[styles.actionButtonText, open?.slug === a.slug && styles.actionButtonTextActive]}>{t(a.title_key)}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {open && canRun && (
        <View style={styles.actionForm}>
          {open.description_key ? <Text style={styles.narrative}>{t(open.description_key)}</Text> : null}
          {open.fields.map((f) => {
            const v = values[f.key] ?? "";
            const set = (nv: string) => setValues((s) => ({ ...s, [f.key]: nv }));
            const choices =
              f.type === "enum"
                ? (f.options ?? []).map((o) => ({ value: o.value, label: t(o.label_key) }))
                : f.type === "boolean"
                  ? [
                      { value: "true", label: t("extranet.actionYes") },
                      { value: "false", label: t("extranet.actionNo") },
                    ]
                  : null;
            return (
              <View key={f.key} style={styles.actionField}>
                <Text style={styles.actionLabel}>
                  {t(f.label_key)}
                  {f.required ? ` · ${t("extranet.actionRequired")}` : ""}
                </Text>
                {choices ? (
                  <View style={styles.actionChoices}>
                    {choices.map((c) => (
                      <TouchableOpacity
                        key={c.value}
                        onPress={() => set(v === c.value ? "" : c.value)}
                        style={[styles.actionChoice, v === c.value && styles.actionChoiceActive]}
                        accessibilityRole="button"
                      >
                        <Text style={[styles.actionChoiceText, v === c.value && styles.actionChoiceTextActive]}>{c.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : (
                  <TextInput
                    value={v}
                    onChangeText={set}
                    multiline={f.type === "textarea"}
                    secureTextEntry={f.type === "secret"}
                    autoComplete={f.type === "secret" ? "off" : undefined}
                    keyboardType={f.type === "integer" ? "number-pad" : "default"}
                    placeholder={f.type === "date" ? "YYYY-MM-DD" : f.type === "timestamptz" ? "YYYY-MM-DD HH:MM" : undefined}
                    placeholderTextColor={colors.textSecondary}
                    style={[styles.actionInput, f.type === "textarea" && styles.actionInputMulti]}
                  />
                )}
              </View>
            );
          })}
          <View style={styles.actionButtons}>
            <TouchableOpacity
              disabled={status === "submitting" || status === "done" || !complete(open)}
              onPress={() => void send()}
              style={[styles.actionSubmit, (status === "submitting" || status === "done" || !complete(open)) && styles.actionButtonOff]}
              accessibilityRole="button"
            >
              <Text style={styles.actionSubmitText}>{t("extranet.actionSubmit")}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setOpen(null)} style={styles.actionButton} accessibilityRole="button">
              <Text style={styles.actionButtonText}>{t("extranet.actionCancel")}</Text>
            </TouchableOpacity>
          </View>
          {status === "done" ? <Text style={styles.actionDone}>{t("extranet.actionDone")}</Text> : null}
          {status === "error" ? <Text style={styles.actionError}>{t("extranet.actionFailed")}</Text> : null}
        </View>
      )}
    </View>
  );
}

export function BlockRenderer({
  block,
  policy,
  params,
}: {
  block: SurfaceLayoutBlock;
  policy: DialogPolicy;
  /**
   * Na co se ptá UŽIVATEL (vybraný den…). Jde to k blokovému RPC jako
   * `p_params`, které dispatcher slučuje NAD konfiguraci bloku. Renderer sám
   * nic nevymýšlí a klíčům nerozumí — blok, který je nezná, je ignoruje.
   */
  params?: Record<string, unknown>;
}) {
  const { t } = useTranslation();
  const query = useBlockData(block.block_slug, params);
  const title = t(block.title_key);

  if (query.isLoading) {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.muted}>{t("common.loading")}</Text>
      </View>
    );
  }
  // ⛔ NAMĚŘENO 2026-08-20. Tady stálo `query.isError || !query.data` s jednou
  // hláškou pro obojí — SELHÁNÍ tedy vypadalo úplně stejně jako „nemáš data".
  // Když toho dne spadl backend, extranet se tvářil jako normální prázdný
  // extranet: žádná chyba, žádné vysvětlení. Majitel se přihlásil a nevěděl,
  // jestli je vada u něj, v přihlášení, nebo u nás.
  //
  // Jsou to DVA různé světy a člověk potřebuje vědět, ve kterém je:
  //   isError → technické selhání; NENÍ to jeho chyba a má smysl to zkusit znovu
  //   !data   → oprávnění nedávají nic (RLS); legitimní stav, žádný poplach
  //
  // Sloučit je zpět znamená ušetřit jeden `if` za cenu toho, že se porucha tváří
  // jako klid — táž třída jako zelená brána nad vadou.
  if (query.isError) {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.muted}>{t("extranet.blockFailed")}</Text>
        <Text style={styles.muted}>{t("extranet.blockFailedHint")}</Text>
      </View>
    );
  }
  if (!query.data) {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.muted}>{t("extranet.blockNoAccess")}</Text>
      </View>
    );
  }

  const { data, provenance, block_type, target } = query.data;
  const d = (data ?? {}) as Row;
  // The naturel policy controls how much we expand up front (E8: never drops
  // facts — only how many table rows show before "show more" on mobile).
  const rowCap = policy.message.length === "brief" ? 3 : policy.message.length === "rich" ? 20 : 8;
  // Bound once: TS re-widens `d.points` inside the map callbacks below.
  const chartPoints: ChartPointRow[] = Array.isArray(d.points) ? d.points : [];

  // Arrangement is a HINT from the layout, not a renderer name: an unrecognised
  // presentation falls through to the block's default drawing, so a new value
  // in the data can never blank a row on an older build.
  const isTape = block.presentation === "tape";

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>

      {/*
        ⭐ CÍL — „a je to tenhle záznam".
        Táž mapa jako u fronty: druh entity → obrazovka. Odpověď AIŠE, fronta
        i cokoli dalšího tak vede na totéž místo, a nový druh entity je řádek
        v ENTITY_ROUTES, ne větev tady. Druh, který klient nezná, se nenabídne —
        cíl je nabídka, ne příkaz.
      */}
      {target?.entity_id && ENTITY_ROUTES[target.entity_kind] && (
        <TouchableOpacity
          style={styles.targetLink}
          onPress={() => ENTITY_ROUTES[target.entity_kind]!(target.entity_id)}
          testID={`block-target-${target.entity_kind}`}
        >
          <Text style={styles.targetText}>
            {t("extranet.target.open", { label: target.label ?? target.entity_id })}
          </Text>
        </TouchableOpacity>
      )}

      {/*
        ⛔ STAV NESMÍ BÝT JEN BARVA (JAZYK-01). Do 2026-08-09 se `warning` kreslil
        POUZE obarvením čísla — na slunci za sklem kabiny zmizí barevný rozdíl
        první a barvoslepý ho nemá nikdy, takže varování bylo pro část řidičů
        neviditelné. Teď je pod číslem lampa: glyf + slovo.

        `null` zůstává '—' (NEMĚŘENO). Nula by tvrdila měření, které nikdo
        neprovedl — viz kontrakt.
      */}
      {block_type === "kpi_tile" && (
        <View>
          <Text style={styles.kpi}>{String(d.value ?? "—")}</Text>
          {typeof d.state === "string" && d.state !== "ok" && (
            <Lamp state={KPI_LAMP[d.state] ?? "mute"} label={t(`extranet.kpi_state.${d.state}`)} />
          )}
        </View>
      )}

      {/*
        Chart — one contract type, three kinds. Drawn with Views, not SVG: this
        screen is a card stack on a phone, and the platform law is that device
        adaptation is the RENDERER's job, never an axis of the layout. So the
        ring becomes a fill bar and the trend a column spark — the figure stays
        the information, the shape follows the device.
      */}
      {block_type === "chart" && Array.isArray(d.points) && (
        <View>
          {!chartPoints.length && <Text style={styles.muted}>{t("extranet.queueEmpty")}</Text>}

          {d.kind === "bar" &&
            chartPoints.slice(0, rowCap).map((p, i) => (
              <View key={String(p.label ?? i)} style={styles.chartRow}>
                <Text style={styles.chartLabel} numberOfLines={1}>{String(p.label ?? "")}</Text>
                <View style={styles.trackBar}>
                  <View style={[styles.trackFill, { width: `${chartPct(p, chartPoints)}%` }]} />
                </View>
                <Text style={styles.chartValue}>{String(p.value ?? "")}</Text>
              </View>
            ))}

          {d.kind === "trend" && (
            <View style={styles.sparkRow}>
              {chartPoints.slice(-rowCap).map((p, i) => (
                <View key={String(p.label ?? i)} style={[styles.sparkCol, { height: Math.max(2, chartPct(p, chartPoints) * 0.44) }]} />
              ))}
            </View>
          )}

          {d.kind === "donut" && !!chartPoints.length && (
            <View>
              <Text style={styles.kpi}>{String(chartPoints[0].value ?? "—")}</Text>
              <View style={styles.trackBar}>
                <View style={[styles.trackFill, { width: `${chartPct(chartPoints[0], chartPoints)}%` }]} />
              </View>
              <Text style={styles.muted} numberOfLines={1}>{String(chartPoints[0].label ?? "")}</Text>
            </View>
          )}
        </View>
      )}

      {/*
        Síť vazeb na telefonu = SEZNAM po skupinách (síť by se na šířku karty
        rozsypala) se stejnými údaji: glyf stavu, hodnota a SLOVO JISTOTY
        (potvrzeno · navrženo · odvozeno) — jistota se nečte z barvy ani tady.
        Proklik z uzlu mobil zatím nemá (drill-down obrazovky), takže řádek
        není ovladač; zobrazení je pravdivé, jen neinteraktivní.
      */}
      {block_type === "relation_web" && Array.isArray(d.groups) && (
        <View>
          {!!d.center && <Text style={styles.kpi} numberOfLines={2}>{String(d.center.label ?? "")}</Text>}
          {!!d.center?.sub && <Text style={styles.muted}>{String(d.center.sub)}</Text>}
          {d.groups.length === 0 && <Text style={styles.muted}>{t("extranet.queueEmpty")}</Text>}
          {d.groups.map((g) => (
            <View key={g.key} style={{ marginTop: 10 }}>
              <Text style={styles.muted}>{`${t(g.label_key)} · ${g.nodes.length}`}</Text>
              {g.nodes.slice(0, rowCap).map((n, i) => (
                <View key={String(n.id ?? i)} style={styles.chartRow}>
                  <Text style={styles.chartLabel} numberOfLines={1}>
                    {`${n.state === "fault" ? "■ " : n.state === "wait" ? "▲ " : n.state === "ok" ? "● " : ""}${String(n.label ?? "")}`}
                  </Text>
                  {typeof n.value === "number" && (
                    <Text style={styles.chartValue}>{`${n.value}${n.unit_key ? ` ${t(String(n.unit_key))}` : ""}`}</Text>
                  )}
                  <Text style={styles.muted}>{t(`app.web.certainty.${String(n.certainty ?? "confirmed")}`)}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      )}

      {/*
        Timing tower na telefonu: žebříček bez sektorových proužků — na šířku
        karty se nevejdou čitelně, a informace je POŘADÍ a vlajka, ne grafika.
        Přizpůsobení zařízení je práce rendereru, ne osa layoutu.
      */}
      {block_type === "timing_tower" && Array.isArray(d.runs) && (
        <View>
          {!d.runs.length && <Text style={styles.muted}>{t("extranet.queueEmpty")}</Text>}
          {(d.runs as Array<Record<string, unknown>>).slice(0, rowCap).map((r, i) => {
            const sectors = Array.isArray(r.sectors) ? (r.sectors as Array<Record<string, unknown>>) : [];
            const done = sectors.filter((x) => x.status === "completed").length;
            const flag = FLAGS[String(r.flag)] ? String(r.flag) : null;
            const gate = r.gate && typeof r.gate === "object" ? (r.gate as Record<string, unknown>) : null;
            return (
              <View key={String(r.batch_id ?? i)} style={styles.queueItem}>
                <View style={styles.runHeader}>
                  <Text style={styles.queueTitle} numberOfLines={1}>{String(r.title ?? "")}</Text>
                  <Text style={styles.chartValue}>{done}/{sectors.length}</Text>
                </View>

                {/*
                  Vlajka je VŽDY tečka/čtvereček A SLOVO (pravidlo P3 SDK).
                  Samotná barva by na telefonu v ostrém světle a pro barvoslepé
                  nesdělila nic — a „blokováno" je přesně ta informace, kterou si
                  řidič nesmí přehlédnout. Červená proto nese ještě tvar ■.
                */}
                {flag && (
                  <View style={styles.flagRow}>
                    <View style={[styles.flagDot, { backgroundColor: FLAGS[flag].color },
                                  flag === "red" && styles.flagSquare]} />
                    <Text style={styles.flagLabel}>{t(`extranet.tower.flag.${flag}`)}</Text>
                    {/*
                      Čas ve fázi. `ent` chybí = neměřeno, a to se řekne pomlčkou;
                      dosadit nulu by tvrdilo měření, které nikdo neprovedl.
                    */}
                    {flag !== "finish" && (
                      <Text style={styles.flagTime}>
                        {t("extranet.tower.inPhase")}{" "}
                        {typeof r.ent === "number" ? fmtDuration(r.ent) : t("extranet.tower.notMeasured")}
                      </Text>
                    )}
                  </View>
                )}

                <View style={styles.trackBar}>
                  <View style={[styles.trackFill, { width: `${sectors.length ? (done / sectors.length) * 100 : 0}%` }]} />
                </View>

                {/*
                  Brána — na koho se čeká. Pro řidiče je tohle ta nejcennější
                  věta na celé desce: „čeká se na TEBE" je jiná zpráva než
                  „běh stojí". Chybějící gate se nekreslí, protože se nečeká.
                */}
                {gate && Boolean(gate.label) && (
                  <View style={styles.gateBox}>
                    <Text style={styles.gateOverline}>{t("extranet.tower.waitingFor")}</Text>
                    <Text style={styles.gateLabel} numberOfLines={1}>{String(gate.label)}</Text>
                    {Boolean(gate.desc) && (
                      <Text style={styles.gateDesc} numberOfLines={2}>{String(gate.desc)}</Text>
                    )}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}

      {/*
        Potvrzení úkonu v terénu. Táž maska odbaví předání dodáku i odečet —
        ptá se DAT (`measure`, `evidence`), ne jména kroku. Slova jazyka
        (Stepper/Fact/Measure/Evidence/Gate) přicházejí z balíku, takže se web
        a mobil nemohou rozejít v tom, CO věta znamená.

        ⛔ Appka tu NEROZHODUJE. `suggested` je odhad stroje kreslený vedle
        hodnoty; fakt vzniká až tím, co potvrdí člověk (JAZYK-04/05/06).
      */}
      {block_type === "handover_confirm" && d.step_id != null && (
        <View style={styles.handover}>
          {Array.isArray(d.steps) && d.steps.length > 0 && (
            <Es.Stepper
              steps={d.steps.map((s: { label: string; state: string }) => `${s.label}=${s.state}`).join("|")}
            />
          )}
          {d.title ? <Text style={styles.queueTitle}>{String(d.title)}</Text> : null}
          {(d.facts ?? []).map((f: { label: string; value?: string | null }) => (
            <Fact key={f.label} label={f.label} value={f.value} />
          ))}
          {d.measure && (
            <Es.Measure
              label={d.measure.label}
              unit={d.measure.unit}
              suggested={d.measure.suggested}
              value={null}
            />
          )}
          {Array.isArray(d.evidence) && d.evidence.length > 0 && <Es.Evidence slots={d.evidence} />}
        </View>
      )}

      {/*
        AKCE SPRÁVY Z PLOCHY (ADR-003, K4). Tlačítka z allowlistu (řádky
        surface_actions, které RLS volajícímu pustí), formulář z DEKLARACE polí,
        odeslání přes JEDNO auditované RPC — jméno cílové funkce appka nezná.
        Parita s web shellem (blocks.tsx ActionForm): stejná data, stejný submit.
      */}
      {block_type === "action_form" && Array.isArray(d.actions) && (
        <MobileActionForm
          targetKind={String(d.target_kind ?? "none")}
          targetId={typeof d.target_id === "string" ? d.target_id : null}
          actions={d.actions as MobileActionDef[]}
        />
      )}
      {block_type === "table" && Array.isArray(d.rows) && (
        <View>
          {d.rows.slice(0, rowCap).map((r, i) => (
            <View key={String(r.id ?? i)} style={styles.tableRow}>
              {(d.columns ?? []).slice(0, 3).map((c) => (
                <Text key={c.key} style={styles.cell} numberOfLines={1}>
                  {c.value_keys && typeof r[c.key] === "string" && r[c.key] ? t(String(r[c.key])) : String(r[c.key] ?? "")}
                </Text>
              ))}
            </View>
          ))}
          {d.rows.length > rowCap && <Text style={styles.muted}>{t("extranet.moreRows", { n: d.rows.length - rowCap })}</Text>}
        </View>
      )}

      {block_type === "review_queue" && Array.isArray(d.items) && !isTape && (
        <View>
          {d.items.slice(0, rowCap).map((it, i) => {
            /*
              CO O PŘEDMĚTU TVRDÍ ZDROJ — ne stav naší práce. Chodí jen
              u vět, které zdroj uzavřel (dodák vyřízený v účetnictví),
              takže řádek, který tu je k odbavení, tenhle štítek nenese.
              Vykreslit se MUSÍ: kontrakt ten klíč od 2026-09-25 zná, a
              přijmout data a zahodit je je táž vada jako je neznat —
              uživatel by viděl položku, o které zdroj něco řekl, a nikde by
              se to nedozvěděl. `as_of` říká STÁŘÍ toho tvrzení; bez něj se
              nepozná čerstvá věta od loňské.
            */
            const zdroj = it.source_state as { label_key?: string; as_of?: string } | undefined;
            return (
            <QueueRow key={String(it.id ?? i)} kind={d.entity_kind} id={it.id} style={styles.queueItem}>
              <Text style={styles.queueTitle} numberOfLines={2}>
                {String(it.title ?? "")}
              </Text>
              {it.quote ? <Text style={styles.quote} numberOfLines={2}>„{String(it.quote)}"</Text> : null}
              {zdroj?.label_key ? (
                <Text style={styles.sourceState} numberOfLines={1}>
                  {t(zdroj.label_key)}
                  {zdroj.as_of ? ` · ${zdroj.as_of.slice(0, 10)}` : ""}
                </Text>
              ) : null}
            </QueueRow>
            );
          })}
          {!d.items.length && <Text style={styles.muted}>{t("extranet.queueEmpty")}</Text>}
        </View>
      )}

      {/*
        The day's tape — the SAME review_queue contract, arranged as one stream:
        done (counted, collapsed) → TEĎ (the first waiting item, hero) → ahead.
        The web shell has drawn it since the tape landed; this client dropped the
        `presentation` hint, so the phone showed a flat list of the same rows.
        Nothing here knows what a delivery note is: titles, quotes and order are
        block data, the renderer only arranges — and on a phone that means one
        column, because device adaptation is the renderer's job, never an axis
        of the layout.
      */}
      {block_type === "review_queue" && Array.isArray(d.items) && isTape && (
        // Tvar pásky (maketa řidiče, 2026-09-29) bydlí v `PaskaDne`; renderer jen
        // předá data bloku a mapu „druh entity → obrazovka". Pravidla (dělení,
        // pořadí, hero) zůstávají v `arrange`, aby je test měřil bez kreslení.
        <PaskaDne
          items={d.items}
          entityKind={d.entity_kind}
          otevri={d.entity_kind ? ENTITY_ROUTES[d.entity_kind] : undefined}
          otevriAkci={d.entity_kind ? ENTITY_ACTIONS[d.entity_kind] : undefined}
          rowCap={rowCap}
        />
      )}

      {/*
        The five types the shells already draw. They were missing here, so a
        layout carrying any of them rendered a bare title on the phone while the
        web showed content — a silent divergence, not a crash. Contract parity is
        the point: the section decides WHAT appears, the renderer only HOW.
      */}
      {block_type === "timeline" && Array.isArray(d.items) && (
        <View>
          {d.items.slice(0, rowCap).map((it, i) => (
            <View key={String(it.at ?? i)} style={styles.queueItem}>
              <Text style={styles.chartLabel} numberOfLines={2}>
                {String(it.label ?? (it.label_key ? t(String(it.label_key)) : ""))}
              </Text>
              <Text style={styles.prov}>{it.at ? new Date(String(it.at)).toLocaleString() : ""}</Text>
            </View>
          ))}
          {!d.items.length && <Text style={styles.muted}>{t("extranet.queueEmpty")}</Text>}
        </View>
      )}

      {block_type === "alert_feed" && Array.isArray(d.items) && (
        <View>
          {d.items.slice(0, rowCap).map((it, i) => (
            <View key={String(it.id ?? i)} style={styles.queueItem}>
              <Text style={[styles.queueTitle, it.severity === "critical" && styles.kpiWarn]} numberOfLines={2}>
                {it.kind_key ? t(String(it.kind_key)) : ""}
              </Text>
              <Text style={styles.prov}>{it.at ? new Date(String(it.at)).toLocaleString() : ""}</Text>
            </View>
          ))}
          {!d.items.length && <Text style={styles.muted}>{t("extranet.queueEmpty")}</Text>}
        </View>
      )}

      {block_type === "narrative" && typeof d.markdown === "string" && (
        // Grounded story-loop prose. Rendered as text, not parsed markdown: a
        // markdown engine on this screen would be a dependency for one block.
        <Text style={styles.narrative}>{d.markdown}</Text>
      )}

      {block_type === "findings" && Array.isArray(d.items) && (
        <View>
          {d.items.slice(0, rowCap).map((it, i) => (
            <View key={String(it.id ?? i)} style={styles.queueItem}>
              <Text style={[styles.queueTitle, (it.severity === "critical" || it.severity === "high") && styles.kpiWarn]} numberOfLines={2}>
                {it.title_key ? t(String(it.title_key)) : String(it.id ?? "")}
              </Text>
              <Text style={styles.prov}>{String(it.severity ?? "")}</Text>
            </View>
          ))}
          {!d.items.length && <Text style={styles.muted}>{t("extranet.queueEmpty")}</Text>}
        </View>
      )}

      {/*
        `Fact` z jazyka, ne vlastní řádek: prázdný údaj se NEKRESLÍ (JAZYK-03).
        Dřív se tu vykreslil řádek s popiskem a prázdnou hodnotou — vypadal jako
        údaj a četl se jako „nezjištěno", i když třeba jen nebylo o co se ptát.
      */}
      {block_type === "record_detail" && Array.isArray(d.fields) && (
        <View>
          {d.fields.slice(0, rowCap).map((f, i) => (
            <Fact
              key={String(f.key ?? i)}
              label={f.label_key ? t(String(f.label_key)) : String(f.key ?? "")}
              value={f.value != null ? String(f.value) : f.value_key ? t(String(f.value_key)) : null}
            />
          ))}
        </View>
      )}

      {block_type === "goal_progress" && Array.isArray(d.runs) && (
        <View>
          {d.runs.slice(0, rowCap).map((run, i) => {
            const pos = Math.max(0, Math.min(1, Number(run.pos ?? 0)));
            return (
              <View key={String(run.batch_id ?? i)} style={styles.run}>
                <View style={styles.runHeader}>
                  <Text style={styles.queueTitle} numberOfLines={1}>{String(run.title ?? "")}</Text>
                  {run.goal?.met ? <Text style={styles.goalMet}>✓</Text> : null}
                </View>
                <View style={styles.trackBar}>
                  <View style={[styles.trackFill, { width: `${Math.round(pos * 100)}%` }]} />
                </View>
                <View style={styles.milestoneRow}>
                  {(run.milestones ?? []).map((m) => (
                    <Text
                      key={String(m.code ?? m.order)}
                      style={[
                        styles.milestone,
                        m.status === "completed" && styles.milestoneDone,
                        m.status === "failed" && styles.milestoneFailed,
                      ]}
                      numberOfLines={1}
                    >
                      {m.status === "completed" ? "●" : m.status === "failed" ? "✕" : "○"} {String(m.name ?? "")}
                    </Text>
                  ))}
                </View>
              </View>
            );
          })}
          {!d.runs.length && <Text style={styles.muted}>{t("extranet.queueEmpty")}</Text>}
        </View>
      )}

      {!DRAWN_TYPES.has(block_type) && (
        <Text style={styles.muted}>{t("extranet.blockType", { type: block_type })}</Text>
      )}

      <Provenance p={provenance} />
    </View>
  );
}

const styles = StyleSheet.create({
  actionList: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  actionButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  actionButtonActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  actionButtonOff: { opacity: 0.45 },
  actionButtonText: { color: colors.text, fontSize: 14, fontWeight: "600" },
  actionButtonTextActive: { color: colors.background },
  actionForm: { marginTop: spacing.md, gap: spacing.sm },
  actionField: { gap: 4 },
  // Popisek pole NESE INFORMACI (které pole to je), takže patří nad podlahu
  // terénní čitelnosti: `textSecondary` 6.90:1 místo `textMuted` 3.60:1 a 13 px
  // místo 12. Řidič to čte u rampy, na slunci, přes brýle.
  actionLabel: { color: colors.textSecondary, fontSize: 13 },
  actionInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    color: colors.text,
    fontSize: 14,
    backgroundColor: colors.surface,
  },
  actionInputMulti: { minHeight: 72, textAlignVertical: "top" },
  actionChoices: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  actionChoice: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionChoiceActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  actionChoiceText: { color: colors.text, fontSize: 13 },
  actionChoiceTextActive: { color: colors.background },
  actionButtons: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  actionSubmit: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 8,
    backgroundColor: colors.primary,
  },
  actionSubmitText: { color: colors.background, fontSize: 14, fontWeight: "600" },
  actionDone: { color: colors.success, fontSize: 13, marginTop: spacing.xs },
  actionError: { color: colors.error, fontSize: 13, marginTop: spacing.xs },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: "700", marginBottom: spacing.sm },
  kpi: { color: colors.text, fontSize: 28, fontWeight: "800", fontVariant: ["tabular-nums"] },
  kpiWarn: { color: colors.warning },
  tableRow: { flexDirection: "row", gap: spacing.sm, paddingVertical: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  cell: { flex: 1, color: colors.textSecondary, fontSize: 13 },
  targetLink: {
    backgroundColor: colors.primary, borderRadius: 8,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md, marginBottom: spacing.sm,
  },
  targetText: { color: colors.background, fontSize: 13.5, fontWeight: "800", textAlign: "center" },
  queueItem: { paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  handover: { gap: 8 },
  queueTitle: { color: colors.text, fontSize: 14, fontWeight: "600" },
  quote: { color: colors.textSecondary, fontSize: 13, fontStyle: "italic", marginTop: 2 },
  // Tvrzení zdroje je kontext, ne akce — tiššeji než titulek a bez zvýraznění,
  // aby si ho nikdo nespletl s potvrzením, které dal člověk.
  sourceState: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  muted: { color: colors.textSecondary, fontSize: 13 },
  // Původ je nejdrobnější údaj na obrazovce — má být čitelný, ne nápadný.
  // ⛔ `colors.textMuted` má proti pozadí appky pod 4.5:1, tedy POD AA — a je
  // to nejmenší písmo na obrazovce, takže právě tam je ztráta kontrastu nejvíc
  // znát. „Nenápadný" se dělá VELIKOSTÍ a odstupem (obojí tu je), ne ztrátou
  // čitelnosti: u rampy v ostrém světle by údaj prostě zmizel. Sousední
  // `quote` i `muted` už `textSecondary` používají.
  prov: {
    color: colors.textSecondary,
    fontSize: typography.dataMicro.fontSize,
    fontFamily: typography.dataMicro.fontFamily,
    marginTop: spacing.sm,
    fontVariant: ["tabular-nums"],
  },
  run: { paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  runHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.xs },
  goalMet: { color: colors.primary, fontSize: 14, fontWeight: "800" },
  trackBar: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: "hidden", marginBottom: spacing.xs },
  flagRow: { flexDirection: "row", alignItems: "center", marginBottom: spacing.xs, gap: spacing.xs },
  // Kruh = běžný stav. Červená ho přepne na čtverec (flagSquare), aby se
  // „blokováno" poznalo i bez barvy — tvar je druhý, nezávislý kanál.
  flagDot: { width: 9, height: 9, borderRadius: 5 },
  flagSquare: { borderRadius: 1 },
  flagLabel: { color: colors.text, fontSize: 13, fontWeight: "600" },
  flagTime: { color: colors.textSecondary, fontSize: 13, marginLeft: "auto" },
  gateBox: {
    marginTop: spacing.xs, padding: spacing.sm, borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.info, backgroundColor: colors.surfaceLight,
  },
  gateOverline: { color: colors.info, fontSize: 9.5, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  gateLabel: { color: colors.text, fontSize: 13, fontWeight: "600", marginTop: 3 },
  gateDesc: { color: colors.textSecondary, fontSize: 13, lineHeight: 16, marginTop: 2 },
  trackFill: { height: 6, borderRadius: 3, backgroundColor: colors.primary },
  narrative: { color: colors.text, fontSize: 14, lineHeight: 21 },
  chartRow: { marginBottom: spacing.sm },
  chartLabel: { color: colors.text, fontSize: 13, marginBottom: 2 },
  chartValue: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  // Column spark: a fixed-height strip so cards keep one rhythm whatever the series.
  sparkRow: { flexDirection: "row", alignItems: "flex-end", height: 44, gap: 3, marginTop: spacing.xs },
  sparkCol: { flex: 1, borderRadius: 2, backgroundColor: colors.primary },
  // Styly pásky bydlí v `PaskaDne` (jazyk ESDK, paleta instance).
  milestoneRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  milestone: { color: colors.textSecondary, fontSize: 13 },
  milestoneDone: { color: colors.primary },
  milestoneFailed: { color: colors.error },
});
