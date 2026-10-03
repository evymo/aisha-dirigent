/**
 * MarketingContentEditor - Dynamic block-based editor for product marketing content
 *
 * Supports localized blocks with different types:
 * - section: title + description (for benefits, features)
 * - keyvalue: simple key-value pairs (for substances list)
 * - text: single text block
 */

import { useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Plus, Trash2, ChevronDown, ChevronRight, GripVertical } from "lucide-react";
import { LocalizedFieldEditor } from "./LocalizedFieldEditor";
import { type SupportedLocale, SUPPORTED_LOCALES } from "@/hooks/useDynamicTranslations";

// Block types
type BlockType = "section" | "keyvalue" | "text";

interface SectionBlock {
  type: "section";
  key: string;
  title: Record<SupportedLocale, string>;
  description: Record<SupportedLocale, string>;
}

interface KeyValueBlock {
  type: "keyvalue";
  key: string;
  value: Record<SupportedLocale, string>;
}

interface TextBlock {
  type: "text";
  key: string;
  text: Record<SupportedLocale, string>;
}

type ContentBlock = SectionBlock | KeyValueBlock | TextBlock;

interface MarketingContentEditorProps {
  /** Label for the content section */
  label: string;
  /** Current JSON string value */
  value: string;
  /** Callback when content changes */
  onChange: (value: string) => void;
  /** Currently selected primary (editing) locale */
  primaryLocale: SupportedLocale;
  /** The base/reference locale of the entity */
  baseLocale?: SupportedLocale;
  /** Available locales */
  locales?: SupportedLocale[];
  /** Locale display labels */
  localeLabels?: Record<SupportedLocale, string>;

  // --- Legacy dual-column props (kept for backward compatibility) ---
  /** @deprecated Use primaryLocale instead */
  sourceLocale?: SupportedLocale;
  /** @deprecated Use primaryLocale instead */
  targetLocale?: SupportedLocale;
  /** @deprecated No longer needed */
  onSourceLocaleChange?: (locale: SupportedLocale) => void;
  /** @deprecated No longer needed */
  onTargetLocaleChange?: (locale: SupportedLocale) => void;
}

const createEmptyLocalized = (): Record<SupportedLocale, string> =>
  SUPPORTED_LOCALES.reduce((acc, locale) => ({ ...acc, [locale]: "" }), {} as Record<SupportedLocale, string>);

/**
 * Parse legacy JSON structure into blocks
 * Supports both old object-based format and new block-based format
 */
function parseContentToBlocks(jsonString: string): ContentBlock[] {
  if (!jsonString.trim()) return [];

  try {
    const parsed = JSON.parse(jsonString);
    
    // Check if it's already block-based (array with type field)
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].type) {
      return parsed as ContentBlock[];
    }

    // Convert old locale-keyed format to blocks
    // Old format: { "cs": { "key1": { "title": "...", "description": "..." }, ... }, "en": { ... } }
    // Or: { "cs": { "key1": "simple value", ... }, "en": { ... } }
    
    const blocks: ContentBlock[] = [];
    const localeData = parsed as Record<string, Record<string, unknown>>;
    
    // Get all unique keys across all locales
    const allKeys = new Set<string>();
    Object.values(localeData).forEach((localeContent) => {
      if (localeContent && typeof localeContent === "object") {
        Object.keys(localeContent).forEach((key) => allKeys.add(key));
      }
    });

    // Create blocks for each key
    allKeys.forEach((key) => {
      // Check the structure of the first non-null value to determine block type
      let blockType: BlockType = "keyvalue";
      let hasTitle = false;
      let hasDescription = false;

      for (const locale of SUPPORTED_LOCALES) {
        const value = localeData[locale]?.[key];
        if (value && typeof value === "object") {
          const obj = value as Record<string, unknown>;
          if ("title" in obj) hasTitle = true;
          if ("description" in obj) hasDescription = true;
          if ("text" in obj) blockType = "text";
        }
      }

      if (hasTitle || hasDescription) {
        blockType = "section";
      }

      if (blockType === "section") {
        const block: SectionBlock = {
          type: "section",
          key,
          title: createEmptyLocalized(),
          description: createEmptyLocalized(),
        };
        SUPPORTED_LOCALES.forEach((locale) => {
          const value = localeData[locale]?.[key];
          if (value && typeof value === "object") {
            const obj = value as Record<string, unknown>;
            if (typeof obj.title === "string") block.title[locale] = obj.title;
            if (typeof obj.description === "string") block.description[locale] = obj.description;
          }
        });
        blocks.push(block);
      } else if (blockType === "text") {
        const block: TextBlock = {
          type: "text",
          key,
          text: createEmptyLocalized(),
        };
        SUPPORTED_LOCALES.forEach((locale) => {
          const value = localeData[locale]?.[key];
          if (value && typeof value === "object") {
            const obj = value as Record<string, unknown>;
            if (typeof obj.text === "string") block.text[locale] = obj.text;
          } else if (typeof value === "string") {
            block.text[locale] = value;
          }
        });
        blocks.push(block);
      } else {
        // keyvalue - simple string values
        const block: KeyValueBlock = {
          type: "keyvalue",
          key,
          value: createEmptyLocalized(),
        };
        SUPPORTED_LOCALES.forEach((locale) => {
          const value = localeData[locale]?.[key];
          if (typeof value === "string") {
            block.value[locale] = value;
          }
        });
        blocks.push(block);
      }
    });

    return blocks;
  } catch {
    return [];
  }
}

/**
 * Serialize blocks back to the legacy locale-keyed format
 * This ensures backward compatibility with existing product display
 */
function serializeBlocksToJson(blocks: ContentBlock[]): string {
  if (blocks.length === 0) return "";

  const result: Record<string, Record<string, unknown>> = {};

  // Initialize locale objects
  SUPPORTED_LOCALES.forEach((locale) => {
    result[locale] = {};
  });

  // Populate with block data
  blocks.forEach((block) => {
    SUPPORTED_LOCALES.forEach((locale) => {
      if (block.type === "section") {
        const hasContent = block.title[locale] || block.description[locale];
        if (hasContent) {
          result[locale][block.key] = {
            title: block.title[locale] || "",
            description: block.description[locale] || "",
          };
        }
      } else if (block.type === "text") {
        if (block.text[locale]) {
          result[locale][block.key] = block.text[locale];
        }
      } else if (block.type === "keyvalue") {
        if (block.value[locale]) {
          result[locale][block.key] = block.value[locale];
        }
      }
    });
  });

  // Remove empty locale objects
  SUPPORTED_LOCALES.forEach((locale) => {
    if (Object.keys(result[locale]).length === 0) {
      delete result[locale];
    }
  });

  if (Object.keys(result).length === 0) return "";

  return JSON.stringify(result, null, 2);
}

const BLOCK_TYPE_LABELS: Record<BlockType, string> = {
  section: "Section (Title + Description)",
  keyvalue: "Key-Value (Simple text)",
  text: "Text Block",
};

export function MarketingContentEditor({
  label,
  value,
  onChange,
  primaryLocale,
  baseLocale,
  locales,
  localeLabels,
  // Legacy props
  sourceLocale,
  targetLocale: _targetLocale,
  onSourceLocaleChange: _onSourceLocaleChange,
  onTargetLocaleChange: _onTargetLocaleChange,
}: MarketingContentEditorProps) {
  const { t } = useTranslation();
  const effectivePrimary = primaryLocale ?? sourceLocale ?? "en";
  const effectiveBase = baseLocale ?? effectivePrimary;
  const [expandedBlocks, setExpandedBlocks] = useState<Set<string>>(new Set());
  const [newBlockType, setNewBlockType] = useState<BlockType>("section");
  const [newBlockKey, setNewBlockKey] = useState("");

  const blocks = useMemo(() => parseContentToBlocks(value), [value]);

  const updateBlocks = useCallback(
    (newBlocks: ContentBlock[]) => {
      onChange(serializeBlocksToJson(newBlocks));
    },
    [onChange]
  );

  const toggleBlock = (key: string) => {
    setExpandedBlocks((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const addBlock = () => {
    const key = newBlockKey.trim() || `block_${blocks.length + 1}`;
    
    // Check for duplicate keys
    if (blocks.some((b) => b.key === key)) {
      return;
    }

    let newBlock: ContentBlock;
    if (newBlockType === "section") {
      newBlock = {
        type: "section",
        key,
        title: createEmptyLocalized(),
        description: createEmptyLocalized(),
      };
    } else if (newBlockType === "text") {
      newBlock = {
        type: "text",
        key,
        text: createEmptyLocalized(),
      };
    } else {
      newBlock = {
        type: "keyvalue",
        key,
        value: createEmptyLocalized(),
      };
    }

    updateBlocks([...blocks, newBlock]);
    setExpandedBlocks((prev) => new Set(prev).add(key));
    setNewBlockKey("");
  };

  const removeBlock = (key: string) => {
    updateBlocks(blocks.filter((b) => b.key !== key));
    setExpandedBlocks((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  };

  const updateBlock = (key: string, updates: Partial<ContentBlock>) => {
    updateBlocks(
      blocks.map((b) => (b.key === key ? { ...b, ...updates } as ContentBlock : b))
    );
  };

  const updateBlockKey = (oldKey: string, newKey: string) => {
    if (newKey === oldKey) return;
    if (blocks.some((b) => b.key === newKey)) return;

    updateBlocks(
      blocks.map((b) => (b.key === oldKey ? { ...b, key: newKey } : b))
    );
    setExpandedBlocks((prev) => {
      const next = new Set(prev);
      next.delete(oldKey);
      next.add(newKey);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">{label}</Label>
        <span className="text-xs text-muted-foreground">
          {blocks.length} {blocks.length === 1 ? "block" : "blocks"}
        </span>
      </div>

      {/* Existing blocks */}
      <div className="space-y-2">
        {blocks.map((block) => (
          <Card key={block.key} className="border">
            <Collapsible
              open={expandedBlocks.has(block.key)}
              onOpenChange={() => toggleBlock(block.key)}
            >
              <CardHeader className="py-2 px-3">
                <div className="flex items-center gap-2">
                  <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="p-0 h-auto">
                      {expandedBlocks.has(block.key) ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </Button>
                  </CollapsibleTrigger>
                  <span className="font-mono text-sm font-medium flex-1">
                    {block.key}
                  </span>
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                    {block.type}
                  </span>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t("common.confirmDelete")}</AlertDialogTitle>
                        <AlertDialogDescription>
                          {t("admin.products.form.deleteBlockConfirm", { key: block.key })}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                        <AlertDialogAction onClick={() => removeBlock(block.key)}>
                          {t("common.delete")}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardHeader>
              <CollapsibleContent>
                <CardContent className="pt-0 pb-4 px-3 space-y-4">
                  {/* Block key editor */}
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Block Key (ID)</Label>
                    <Input
                      value={block.key}
                      onChange={(e) => updateBlockKey(block.key, e.target.value.replace(/\s/g, "_"))}
                      className="font-mono text-sm h-8"
                      placeholder="unique_key"
                    />
                  </div>

                  {/* Section block fields */}
                  {block.type === "section" && (
                    <>
                      <LocalizedFieldEditor
                        label={t("admin.products.form.blockTitle")}
                        fieldId={`${block.key}-title`}
                        value={block.title}
                        onChange={(locale, val) =>
                          updateBlock(block.key, {
                            title: { ...block.title, [locale]: val },
                          } as Partial<SectionBlock>)
                        }
                        primaryLocale={effectivePrimary}
                        baseLocale={effectiveBase}
                        locales={locales}
                        localeLabels={localeLabels}
                      />
                      <LocalizedFieldEditor
                        label={t("admin.products.form.blockDescription")}
                        fieldId={`${block.key}-description`}
                        value={block.description}
                        onChange={(locale, val) =>
                          updateBlock(block.key, {
                            description: { ...block.description, [locale]: val },
                          } as Partial<SectionBlock>)
                        }
                        primaryLocale={effectivePrimary}
                        baseLocale={effectiveBase}
                        locales={locales}
                        localeLabels={localeLabels}
                        multiline
                        rows={3}
                      />
                    </>
                  )}

                  {/* Text block fields */}
                  {block.type === "text" && (
                    <LocalizedFieldEditor
                      label={t("admin.products.form.blockText")}
                      fieldId={`${block.key}-text`}
                      value={block.text}
                      onChange={(locale, val) =>
                        updateBlock(block.key, {
                          text: { ...block.text, [locale]: val },
                        } as Partial<TextBlock>)
                      }
                      primaryLocale={effectivePrimary}
                      baseLocale={effectiveBase}
                      locales={locales}
                      localeLabels={localeLabels}
                      multiline
                      rows={4}
                    />
                  )}

                  {/* KeyValue block fields */}
                  {block.type === "keyvalue" && (
                    <LocalizedFieldEditor
                      label={t("admin.products.form.blockValue")}
                      fieldId={`${block.key}-value`}
                      value={block.value}
                      onChange={(locale, val) =>
                        updateBlock(block.key, {
                          value: { ...block.value, [locale]: val },
                        } as Partial<KeyValueBlock>)
                      }
                      primaryLocale={effectivePrimary}
                      baseLocale={effectiveBase}
                      locales={locales}
                      localeLabels={localeLabels}
                    />
                  )}
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>
        ))}
      </div>

      {/* Add new block */}
      <div className="flex gap-2 items-end border rounded-lg p-3 bg-muted/30">
        <div className="flex-1 space-y-1">
          <Label className="text-xs">{t("admin.products.form.newBlockKey")}</Label>
          <Input
            value={newBlockKey}
            onChange={(e) => setNewBlockKey(e.target.value.replace(/\s/g, "_"))}
            placeholder="unique_key"
            className="font-mono text-sm h-8"
          />
        </div>
        <div className="w-48 space-y-1">
          <Label className="text-xs">{t("admin.products.form.blockType")}</Label>
          <Select value={newBlockType} onValueChange={(v) => setNewBlockType(v as BlockType)}>
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(BLOCK_TYPE_LABELS) as BlockType[]).map((type) => (
                <SelectItem key={type} value={type}>
                  {BLOCK_TYPE_LABELS[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addBlock}
          className="h-8"
        >
          <Plus className="h-4 w-4 mr-1" />
          {t("admin.products.form.addBlock")}
        </Button>
      </div>

      {/* Raw JSON toggle for advanced users */}
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="text-xs text-muted-foreground">
            {t("admin.products.form.showRawJson")}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <Textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="font-mono text-xs min-h-[100px] mt-2"
            placeholder="{}"
          />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
