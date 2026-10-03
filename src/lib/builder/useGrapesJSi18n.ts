/**
 * Hook to bridge react-i18next with GrapesJS I18n module.
 *
 * Synchronizes the current locale and translation strings
 * from react-i18next into the GrapesJS editor I18n system.
 *
 * @module
 */

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { Editor } from "grapesjs";

/**
 * Synchronize react-i18next locale with a GrapesJS editor.
 *
 * Call this hook in the component that renders the GrapesJS
 * editor. It will update the editor locale whenever the app
 * locale changes.
 *
 * @param editor - GrapesJS editor instance (null when not yet initialized)
 */
export function useGrapesJSi18n(editor: Editor | null): void {
  const { i18n } = useTranslation();

  useEffect(() => {
    if (!editor) return;

    const locale = i18n.language;
    const editorI18n = editor.I18n;

    // Set the locale in GrapesJS
    editorI18n.setLocale(locale);
  }, [editor, i18n.language]);
}
