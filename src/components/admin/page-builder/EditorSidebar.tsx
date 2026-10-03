/**
 * EditorSidebar — Side panel for the GrapesJS page editor.
 *
 * Provides tabbed access to:
 * - Blocks: drag-and-drop block library
 * - Styles: CSS style manager (backgrounds, layout, typography, decorations)
 * - Traits: component property editor (data-variant, custom settings)
 * - Layers: component tree / layer manager
 *
 * Uses @grapesjs/react providers for seamless integration.
 *
 * @module
 */

import { useState } from "react";
import DOMPurify from "dompurify";
import { useTranslation } from "react-i18next";
import {
  BlocksProvider,
  StylesProvider,
  TraitsProvider,
  LayersProvider,
  useEditorMaybe,
} from "@grapesjs/react";
import {
  LayoutGrid,
  Paintbrush,
  Settings2,
  Layers,
  Languages,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEditorI18nResolver } from "@/lib/builder/useEditorI18nResolver";
import type { I18nKeyStatus } from "@/lib/builder/useEditorI18nResolver";
import type { LocaleCode } from "@/hooks/useDynamicTranslations";
import { useUpsertTranslations } from "@/hooks/useDynamicTranslations";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TranslationStatusBadge } from "@/components/admin/TranslationStatusBadge";
import { TranslationEditModal } from "@/components/admin/TranslationEditModal";
import { getTranslationStatus } from "@/components/admin/translationStatusUtils";

// =====================================================
// Types
// =====================================================

type SidebarTab = "blocks" | "styles" | "traits" | "layers" | "i18n";

/**
 * Namespace the builder's `data-i18n-key` values live under.
 *
 * Matches what the canvas resolver reads (useEditorI18nResolver) and what
 * PageRenderer resolves at runtime — an edit here must land where the page
 * reads it back.
 */
const WEB_I18N_NAMESPACE = "web";

// =====================================================
// Tab definitions
// =====================================================

const TABS: { id: SidebarTab; icon: React.ElementType; labelKey: string }[] = [
  { id: "blocks", icon: LayoutGrid, labelKey: "builder.sidebar.blocks" },
  { id: "styles", icon: Paintbrush, labelKey: "builder.sidebar.styles" },
  { id: "traits", icon: Settings2, labelKey: "builder.sidebar.traits" },
  { id: "layers", icon: Layers, labelKey: "builder.sidebar.layers" },
  { id: "i18n", icon: Languages, labelKey: "builder.sidebar.i18n" },
];

// =====================================================
// Component
// =====================================================

/**
 * Tabbed sidebar for the GrapesJS page editor.
 *
 * Renders GrapesJS provider components that automatically bind
 * to the active editor instance set up by GjsEditor.
 */
export function EditorSidebar() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<SidebarTab>("blocks");
  const editor = useEditorMaybe();
  const {
    activeLocales,
    currentLocale,
    injectTranslations,
    keyStatuses,
    localeLabels,
  } = useEditorI18nResolver(editor);

  // GrapesJS providers crash if editor is not fully initialized
  if (!editor) {
    return (
      <div className="flex flex-col h-full w-[280px] border-l border-border bg-background items-center justify-center">
        <p className="text-xs text-muted-foreground">{t("builder.status.loading")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-[280px] border-l border-border bg-background">
      {/* Tab bar */}
      <div className="flex border-b border-border shrink-0">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              className={cn(
                "flex-1 flex flex-col items-center gap-0.5 py-2 text-xs transition-colors",
                activeTab === tab.id
                  ? "text-primary border-b-2 border-primary bg-muted/30"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/20",
              )}
              onClick={() => setActiveTab(tab.id)}
              title={t(tab.labelKey)}
            >
              <Icon className="h-4 w-4" />
              <span className="leading-none">{t(tab.labelKey)}</span>
            </button>
          );
        })}
      </div>

      {/* Panel content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {activeTab === "blocks" && (
          <BlocksProvider>
            {(props) => {
              const categorized = [...(props?.mapCategoryBlocks ?? [])];
              return (
              <div className="gjs-blocks-panel p-2 grid grid-cols-2 gap-1.5">
                {categorized.map(([category, blocks]) => (
                  <div key={category} className="col-span-2">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-1 py-1.5 mt-1">
                      {category}
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {blocks.map((block) => (
                        <div
                          key={block.getId()}
                          draggable
                          className={cn(
                            "flex flex-col items-center justify-center gap-1 p-2 rounded border border-border/60",
                            "text-xs text-center cursor-grab hover:border-primary/40 hover:bg-muted/30 transition-colors",
                            "select-none",
                          )}
                          onDragStart={(e) => {
                            // GrapesJS handles block drag via its own system;
                            // this acts as a visual hint only. The actual drag
                            // is handled by the GrapesJS internal drag manager.
                            e.dataTransfer.setData("text/plain", block.getId());
                          }}
                          ref={(el) => {
                            // Register element with GrapesJS block drag system.
                            // "el" is a runtime-only Backbone attribute (not part of
                            // the typed BlockProperties), so set it via a structural cast.
                            if (el) {
                              (block as unknown as { set: (key: string, value: unknown) => void }).set("el", el);
                            }
                          }}
                        >
                          <span
                            className="text-[20px] leading-none"
                            dangerouslySetInnerHTML={{
                              __html: DOMPurify.sanitize(block.get("media") || "&#9638;"),
                            }}
                          />
                          <span className="leading-tight line-clamp-2">
                            {block.getLabel()}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              );
            }}
          </BlocksProvider>
        )}

        {activeTab === "styles" && (
          <StylesProvider>
            {(styleProps) => {
              const sectors = styleProps?.sectors ?? [];
              return (
              <div className="gjs-styles-panel p-2 space-y-3">
                {sectors.length === 0 ? (
                  <p className="text-xs text-muted-foreground p-2">
                    {t("builder.sidebar.selectElement")}
                  </p>
                ) : (
                  sectors.map((sector) => (
                    <SectorPanel key={sector.getId()} sector={sector as unknown as SectorType} />
                  ))
                )}
              </div>
              );
            }}
          </StylesProvider>
        )}

        {activeTab === "traits" && (
          <TraitsProvider>
            {(traitProps) => {
              const traits = traitProps?.traits ?? [];
              return (
              <div className="gjs-traits-panel p-2 space-y-3">
                {traits.length === 0 ? (
                  <p className="text-xs text-muted-foreground p-2">
                    {t("builder.sidebar.selectElement")}
                  </p>
                ) : (
                  <GroupedTraitsList traits={traits as unknown as TraitType[]} />
                )}
              </div>
              );
            }}
          </TraitsProvider>
        )}

        {activeTab === "layers" && (
          <LayersProvider>
            {(layerProps) => {
              const root = layerProps?.root;
              return (
              <div className="gjs-layers-panel p-2">
                {root ? (
                  <LayerItem layer={root as unknown as LayerType} level={0} />
                ) : (
                  <p className="text-xs text-muted-foreground p-2">
                    {t("builder.sidebar.emptyCanvas")}
                  </p>
                )}
              </div>
              );
            }}
          </LayersProvider>
        )}

        {activeTab === "i18n" && (
          <I18nStatusPanel
            activeLocales={activeLocales}
            currentLocale={currentLocale}
            injectTranslations={injectTranslations}
            keyStatuses={keyStatuses}
            localeLabels={localeLabels}
          />
        )}
      </div>
    </div>
  );
}

// =====================================================
// Sub-components
// =====================================================

/**
 * Panel showing translation status for all i18n keys found in the canvas.
 * Each key shows per-locale badges (filled vs missing) and a button
 * to inject DB translations into the canvas preview.
 */
function I18nStatusPanel({
  activeLocales,
  currentLocale,
  injectTranslations,
  keyStatuses,
  localeLabels,
}: {
  activeLocales: LocaleCode[];
  currentLocale: LocaleCode;
  injectTranslations: () => void;
  keyStatuses: I18nKeyStatus[];
  localeLabels: Record<LocaleCode, string>;
}) {
  const { t } = useTranslation();

  return (
    <div className="p-2 space-y-3">
      {/* Inject button */}
      <button
        type="button"
        className="w-full text-xs font-medium py-1.5 px-2 rounded border border-primary/40 text-primary hover:bg-primary/10 transition-colors"
        onClick={injectTranslations}
      >
        {t("builder.i18n.injectTranslations")}
      </button>

      {keyStatuses.length === 0 ? (
        <p className="text-xs text-muted-foreground p-2">
          {t("builder.i18n.noKeys")}
        </p>
      ) : (
        <TooltipProvider delayDuration={200}>
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-1">
              {t("builder.i18n.keysFound", { count: keyStatuses.length })}
            </p>
            {keyStatuses.map((entry) => (
              <I18nKeyRow
                activeLocales={activeLocales}
                currentLocale={currentLocale}
                entry={entry}
                key={entry.key}
                localeLabels={localeLabels}
              />
            ))}
          </div>
        </TooltipProvider>
      )}
    </div>
  );
}

/**
 * Single i18n key row with per-locale status dots.
 */
function I18nKeyRow({
  activeLocales,
  currentLocale,
  entry,
  localeLabels,
}: {
  activeLocales: LocaleCode[];
  currentLocale: LocaleCode;
  entry: I18nKeyStatus;
  localeLabels: Record<LocaleCode, string>;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<Partial<Record<LocaleCode, string>>>({});
  const upsertTranslations = useUpsertTranslations();

  // Draft overlays the canvas-resolved values so edits show immediately; the
  // refetched DB state takes over once the upsert settles.
  const values: Partial<Record<LocaleCode, string>> = Object.fromEntries(
    activeLocales.map((locale) => [
      locale,
      draft[locale] ?? entry.locales.get(locale)?.value ?? "",
    ]),
  );

  const filledCount = activeLocales.filter(
    (locale) => getTranslationStatus(values[locale]) === "filled",
  ).length;

  // Persist on close rather than per keystroke — one upsert per actually-changed
  // locale, matching how the admin forms batch their translation writes.
  const handleOpenChange = (open: boolean) => {
    setModalOpen(open);
    if (open) return;

    const changed = activeLocales
      .filter((locale) => draft[locale] !== undefined)
      .filter((locale) => draft[locale] !== (entry.locales.get(locale)?.value ?? ""))
      .map((locale) => ({
        key: entry.key,
        locale,
        value: draft[locale] ?? "",
        namespace: WEB_I18N_NAMESPACE,
      }));

    if (changed.length > 0) upsertTranslations.mutate(changed);
    setDraft({});
  };

  return (
    <>
      <div className="border border-border/40 rounded p-1.5 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-mono text-foreground truncate flex-1" title={entry.key}>
            {entry.key}
          </span>
          <span className="text-[10px] text-muted-foreground ml-1 shrink-0">
            {filledCount}/{activeLocales.length}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {activeLocales.map((locale) => (
            <TranslationStatusBadge
              className={cn(locale === currentLocale && "ring-1 ring-primary")}
              key={locale}
              locale={locale}
              onClick={() => setModalOpen(true)}
              status={getTranslationStatus(values[locale])}
              value={values[locale] ?? ""}
            />
          ))}
        </div>
      </div>

      <TranslationEditModal
        baseLocale={currentLocale}
        fieldLabel={entry.key}
        locales={activeLocales}
        localeLabels={localeLabels}
        multiline
        onChange={(locale, value) => setDraft((prev) => ({ ...prev, [locale]: value }))}
        onOpenChange={handleOpenChange}
        open={modalOpen}
        values={values}
      />
    </>
  );
}

/** Trait type from GrapesJS TraitsProvider */
type TraitType = Record<string, unknown> & {
  getId: () => string;
  getLabel: () => string;
  getType: () => string;
  getValue: () => string;
  setValue: (v: string | boolean) => void;
  getOptions?: () => Array<{ id: string; label?: string }>;
  getCategoryLabel?: () => string;
};

/** Style Manager property shape (subset used by the sidebar) */
type StylePropType = Record<string, unknown> & {
  getId: () => string;
  getLabel: () => string;
  getType: () => string;
  getValue: () => string;
  upValue: (v: string) => void;
  getOptions?: () => Array<{ id: string; label?: string }>;
};

/** Style Manager sector shape (subset used by the sidebar) */
type SectorType = {
  getName: () => string;
  getProperties?: () => StylePropType[];
};

/** Layer Manager component shape (subset used by the sidebar) */
type LayerType = Record<string, unknown> & {
  getName: () => string;
  isSelected: () => boolean;
  isVisible: () => boolean;
  setVisible: (v: boolean) => void;
  select: () => void;
  getComponents: () => LayerType[];
};

/**
 * Groups traits by their `category` label and renders them
 * in collapsible sections. Traits without a category are placed
 * in an "Other" group at the end.
 */
function GroupedTraitsList({ traits }: { traits: TraitType[] }) {
  const { t } = useTranslation();
  const groups = new Map<string, TraitType[]>();

  for (const trait of traits) {
    const cat = trait.getCategoryLabel?.() || t("builder.traitGroups.other");
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(trait);
  }

  return (
    <>
      {[...groups.entries()].map(([groupName, groupTraits]) => (
        <TraitGroup key={groupName} label={groupName} traits={groupTraits} />
      ))}
    </>
  );
}

/**
 * Collapsible group of traits with a header label.
 */
function TraitGroup({ label, traits }: { label: string; traits: TraitType[] }) {
  const [open, setOpen] = useState(true);

  return (
    <div className="border border-border/40 rounded">
      <button
        type="button"
        className="w-full flex items-center justify-between px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-foreground hover:bg-muted/20"
        onClick={() => setOpen(!open)}
      >
        <span>{label}</span>
        <span className="text-muted-foreground">{open ? "\u2212" : "+"}</span>
      </button>
      {open && (
        <div className="px-2 pb-2 space-y-1.5">
          {traits.map((trait) => (
            <TraitField key={trait.getId()} trait={trait} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Renders a single Style Manager sector (e.g. "Background", "Layout").
 */
function SectorPanel({ sector }: { sector: SectorType }) {
  const [open, setOpen] = useState(true);

  return (
    <div className="border border-border/40 rounded">
      <button
        type="button"
        className="w-full flex items-center justify-between px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-foreground hover:bg-muted/20"
        onClick={() => setOpen(!open)}
      >
        <span>{sector.getName()}</span>
        <span className="text-muted-foreground">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="px-2 pb-2 space-y-1.5">
          {(sector.getProperties?.() ?? []).map((prop: StylePropType) => (
            <StyleProperty key={prop.getId()} prop={prop} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Renders a single style property input.
 */
function StyleProperty({ prop }: { prop: Record<string, unknown> & { getId: () => string; getLabel: () => string; getType: () => string; getValue: () => string; upValue: (v: string) => void; getOptions?: () => Array<{ id: string; label?: string }> } }) {
  const type = prop.getType();
  const value = prop.getValue() ?? "";
  const label = prop.getLabel();

  if (type === "select" && prop.getOptions) {
    return (
      <div className="flex items-center gap-2">
        <label className="text-[11px] text-muted-foreground w-20 shrink-0 truncate" title={label}>
          {label}
        </label>
        <select
          className="flex-1 text-xs border border-border rounded px-1.5 py-1 bg-background"
          value={value}
          onChange={(e) => prop.upValue(e.target.value)}
        >
          {prop.getOptions!().map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label || opt.id}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (type === "color") {
    return (
      <div className="flex items-center gap-2">
        <label className="text-[11px] text-muted-foreground w-20 shrink-0 truncate" title={label}>
          {label}
        </label>
        <div className="flex items-center gap-1 flex-1">
          <input
            type="color"
            className="w-6 h-6 rounded border border-border cursor-pointer"
            value={value || "#000000"}
            onChange={(e) => prop.upValue(e.target.value)}
          />
          <input
            type="text"
            className="flex-1 text-xs border border-border rounded px-1.5 py-1 bg-background"
            value={value}
            onChange={(e) => prop.upValue(e.target.value)}
          />
        </div>
      </div>
    );
  }

  // Default: text/number input
  return (
    <div className="flex items-center gap-2">
      <label className="text-[11px] text-muted-foreground w-20 shrink-0 truncate" title={label}>
        {label}
      </label>
      <input
        type="text"
        className="flex-1 text-xs border border-border rounded px-1.5 py-1 bg-background"
        value={value}
        onChange={(e) => prop.upValue(e.target.value)}
      />
    </div>
  );
}

/**
 * Renders a single trait field (component property).
 */
function TraitField({ trait }: { trait: Record<string, unknown> & { getId: () => string; getLabel: () => string; getType: () => string; getValue: () => string; setValue: (v: string | boolean) => void; getOptions?: () => Array<{ id: string; label?: string }> } }) {
  const type = trait.getType();
  const value = trait.getValue() ?? "";
  const label = trait.getLabel();

  if (type === "select" && trait.getOptions) {
    return (
      <div className="flex items-center gap-2">
        <label className="text-[11px] text-muted-foreground w-20 shrink-0 truncate" title={label}>
          {label}
        </label>
        <select
          className="flex-1 text-xs border border-border rounded px-1.5 py-1 bg-background"
          value={value}
          onChange={(e) => trait.setValue(e.target.value)}
        >
          {trait.getOptions!().map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label || opt.id}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (type === "checkbox") {
    return (
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          className="rounded border-border"
          checked={!!value}
          onChange={(e) => trait.setValue(e.target.checked)}
        />
        <label className="text-[11px] text-muted-foreground truncate" title={label}>
          {label}
        </label>
      </div>
    );
  }

  if (type === "color") {
    return (
      <div className="flex items-center gap-2">
        <label className="text-[11px] text-muted-foreground w-20 shrink-0 truncate" title={label}>
          {label}
        </label>
        <div className="flex items-center gap-1 flex-1">
          <input
            type="color"
            className="w-6 h-6 rounded border border-border cursor-pointer"
            value={value || "#000000"}
            onChange={(e) => trait.setValue(e.target.value)}
          />
          <input
            type="text"
            className="flex-1 text-xs border border-border rounded px-1.5 py-1 bg-background"
            value={value}
            onChange={(e) => trait.setValue(e.target.value)}
          />
        </div>
      </div>
    );
  }

  // Default: text input
  return (
    <div className="flex items-center gap-2">
      <label className="text-[11px] text-muted-foreground w-20 shrink-0 truncate" title={label}>
        {label}
      </label>
      <input
        type="text"
        className="flex-1 text-xs border border-border rounded px-1.5 py-1 bg-background"
        value={value}
        onChange={(e) => trait.setValue(e.target.value)}
      />
    </div>
  );
}

/**
 * Renders a single layer in the component tree.
 */
function LayerItem({ layer, level }: { layer: LayerType; level: number }) {
  const children = layer.getComponents?.() ?? [];

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1 py-0.5 px-1 rounded text-xs cursor-pointer hover:bg-muted/30",
          layer.isSelected() && "bg-primary/10 text-primary",
        )}
        style={{ paddingLeft: `${level * 12 + 4}px` }}
        onClick={() => layer.select()}
      >
        <button
          type="button"
          className={cn(
            "w-3 h-3 rounded-sm border text-[8px] leading-none flex items-center justify-center",
            layer.isVisible() ? "border-primary bg-primary/10" : "border-border bg-muted",
          )}
          onClick={(e) => {
            e.stopPropagation();
            layer.setVisible(!layer.isVisible());
          }}
        >
          {layer.isVisible() ? "●" : "○"}
        </button>
        <span className="truncate">{layer.getName()}</span>
      </div>
      {children.length > 0 &&
        children.map((child) => (
          <LayerItem key={(child as unknown as { getId: () => string }).getId()} layer={child} level={level + 1} />
        ))}
    </div>
  );
}
