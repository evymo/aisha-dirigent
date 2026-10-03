/**
 * Hook that resolves i18n translation status for the selected
 * GrapesJS component and injects DB translations into the canvas.
 *
 * Uses `useDynamicTranslationsMap` to fetch translations for all
 * `data-i18n-key` elements in the current canvas and provides
 * per-key status (filled / missing / stale) for the sidebar.
 *
 * @module
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Component, Editor } from "grapesjs";
import {
  useDynamicTranslationsMultiLocale,
} from "@/hooks/useDynamicTranslations";
import { getTranslationLocale } from "@/lib/i18n/locale";
import { useActiveLocales } from "@/hooks/useActiveLocales";
import type { LocaleCode } from "@/hooks/useDynamicTranslations";
import {
  WEB_I18N_ATTRIBUTE_BINDINGS,
  WEB_TEXT_I18N_KEY_ATTRS,
} from "./webI18nBindings";
import { zapisLocalePlatna } from "@/lib/builder/canvasLocale";

/** Translation entry with per-locale status for an i18n key. */
export interface I18nKeyStatus {
  /** The i18n key (e.g. "web.hero.title") */
  key: string;
  /** Map of locale → { value, status } */
  locales: Map<LocaleCode, { value: string; status: "filled" | "missing" }>;
}

/**
 * Extract all unique data-i18n-key values from a GrapesJS component tree.
 */
function extractKeysFromComponent(root: Component): string[] {
  const keys = new Set<string>();
  const walk = (c: Component) => {
    const attrs = c.getAttributes();
    for (const attr of WEB_TEXT_I18N_KEY_ATTRS) {
      const key = attrs[attr];
      if (typeof key === "string" && key.trim()) keys.add(key.trim());
    }
    for (const binding of WEB_I18N_ATTRIBUTE_BINDINGS) {
      const key = attrs[binding.keyAttr];
      if (typeof key === "string" && key.trim()) keys.add(key.trim());
    }
    c.components().forEach((child: Component) => walk(child));
  };
  walk(root);
  return [...keys];
}

/**
 * Resolve i18n translations for all data-i18n-key elements in the
 * GrapesJS editor and provide translation status per key.
 *
 * @param editor - GrapesJS editor instance (from useEditor)
 * @returns Object with i18nKeys (all keys in canvas), keyStatuses, and injectTranslations function
 */
export function useEditorI18nResolver(editor: Editor | undefined) {
  const { i18n } = useTranslation();
  const [i18nKeys, setI18nKeys] = useState<string[]>([]);
  const currentLocale = getTranslationLocale(i18n.language);
  const { codes: activeLocales, labels: localeLabels } = useActiveLocales();

  // Fetch multi-locale translations for all i18n keys in the canvas
  const multiLocaleMap = useDynamicTranslationsMultiLocale(
    i18nKeys,
    "web",
  );

  // Extract i18n keys whenever editor components change
  useEffect(() => {
    if (!editor) return;

    const refreshKeys = () => {
      const wrapper = editor.getWrapper();
      if (wrapper) {
        const keys = extractKeysFromComponent(wrapper);
        setI18nKeys((prev) => {
          const same =
            prev.length === keys.length &&
            prev.every((k, i) => k === keys[i]);
          return same ? prev : keys;
        });
      }
    };

    // Initial extraction
    refreshKeys();

    // Listen for component changes
    editor.on("component:add", refreshKeys);
    editor.on("component:remove", refreshKeys);
    editor.on("component:update", refreshKeys);
    editor.on("component:update:attributes", refreshKeys);
    editor.on("load", refreshKeys);

    return () => {
      editor.off("component:add", refreshKeys);
      editor.off("component:remove", refreshKeys);
      editor.off("component:update", refreshKeys);
      editor.off("component:update:attributes", refreshKeys);
      editor.off("load", refreshKeys);
    };
  }, [editor]);

  // Build key statuses from multiLocaleMap.
  //
  // The locale set comes from `supported_languages` (DB) — NOT a literal list.
  // A hardcoded ["cs","en","de","fr","ru","th"] used to live here, which meant
  // the builder reported status for languages the instance does not publish
  // (permanently "missing") while silently omitting the ones it does.
  const keyStatuses: I18nKeyStatus[] = i18nKeys.map((key) => {
    const localeMap = multiLocaleMap.get(key);
    const locales = new Map<LocaleCode, { value: string; status: "filled" | "missing" }>();

    for (const locale of activeLocales) {
      const val = localeMap?.get(locale);
      locales.set(locale, {
        value: val ?? "",
        status: val ? "filled" : "missing",
      });
    }

    return { key, locales };
  });

  // Inject resolved translations into canvas components
  const injectTranslations = useCallback(() => {
    if (!editor || multiLocaleMap.size === 0) return;
    const wrapper = editor.getWrapper();
    if (!wrapper) return;

    const walk = (c: Component) => {
      const attrs = c.getAttributes();
      const key = WEB_TEXT_I18N_KEY_ATTRS
        .map((attr) => attrs[attr])
        .find((value): value is string => typeof value === "string" && !!value.trim())
        ?.trim();
      if (key) {
        const localeMap = multiLocaleMap.get(key);
        const translated = localeMap?.get(currentLocale);
        if (translated) {
          // Update component text content non-destructively
          const currentContent = c.get("content") as string | undefined;
          if (currentContent !== translated) {
            c.set("content", translated);
          }
        }
      }
      for (const binding of WEB_I18N_ATTRIBUTE_BINDINGS) {
        const attrKey = attrs[binding.keyAttr];
        if (typeof attrKey !== "string" || !attrKey.trim()) continue;
        const localeMap = multiLocaleMap.get(attrKey.trim());
        const translated = localeMap?.get(currentLocale);
        if (!translated || attrs[binding.targetAttr] === translated) continue;
        c.addAttributes({ [binding.targetAttr]: translated });
      }
      c.components().forEach((child: Component) => walk(child));
    };
    walk(wrapper);
    // ⛔ PLÁTNO SI PAMATUJE, V JAKÉ LOCALE JE (naměřeno 2026-09-03, audit U5-2).
    // Bez toho uložení zapisovalo texty z plátna pod jazyk UI administrátora:
    // plátno se načítá z canvas_html (zdrojová angličtina) a překlady se do
    // něj dostanou JEN tímhle tlačítkem — admin s českým UI tak při uložení
    // přepsal všechny české hodnoty anglickým zdrojem. Značka na editoru je
    // společný bod s CanvasEditor.handleSave, který ukládá, je canvasLocale.ts.
    zapisLocalePlatna(editor, currentLocale);
  }, [currentLocale, editor, multiLocaleMap]);

  return {
    /** All i18n keys found in the current canvas */
    i18nKeys,
    /** Per-key translation status across all locales */
    keyStatuses,
    /** Inject DB translations into canvas components */
    injectTranslations,
    /** Current editor locale */
    currentLocale,
    /** Locales this instance publishes (`supported_languages`), in admin order */
    activeLocales,
    /** code → display name (`name_native`), for rendering locale badges */
    localeLabels,
  };
}
