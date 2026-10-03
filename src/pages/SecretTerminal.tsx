import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { buildPublicUrl } from "@/config/publicSiteUrl";

/* ------------------------------------------------------------------ */
/*  SHA-256 hashing (Web Crypto API)                                   */
/* ------------------------------------------------------------------ */

const sha256 = async (input: string): Promise<string> => {
  const data = new TextEncoder().encode(input.toLowerCase().trim());
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

/**
 * Pre-computed SHA-256 hashes of accepted pass-phrases.
 * The actual words never appear in the bundle — only their digests.
 */
const ACCEPTED_HASHES: ReadonlySet<string> = new Set([
  "a08a0fcbdeafd3c1b3a4b495b9a9c9d96850f08946b52bc0622347d3b6e73b78", // net
  "0d8385b24bfe14165846abc67e140743ddb880a1c69273bf3e1827780353b9f8", // the net
  "83ed5207a41179600b50c409a460cfc229c60cb91bf06480d705c923c864e501", // sandra
  "470b2830637b690d3455246fbfd5c81fa61c41a047c2768f2aea4aaa823bc20f", // bullock
]);

const getRedirectUrl = (): string => {
  const configured = import.meta.env.VITE_SECRET_TERMINAL_REDIRECT_URL?.trim();
  return configured || buildPublicUrl("/");
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

/**
 * Secret retro terminal "login" page.
 *
 * - Full-screen dark terminal aesthetic with blinking cursor.
 * - Input is invisible (only the blinking block cursor moves).
 * - Accepted pass-phrases redirect to the configured public site origin.
 * - Wrong input shows a glitchy "ACCESS DENIED" line.
 */
export default function SecretTerminal() {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  /* auto-focus on mount */
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  /* keep focus when user clicks anywhere */
  const handleContainerClick = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  /* submit handler */
  const handleSubmit = useCallback(
    async (value: string) => {
      if (busy) return;
      const trimmed = value.trim();
      if (!trimmed) return;

      setBusy(true);
      setLines((prev) => [...prev, `> ${trimmed}`]);
      setInput("");

      /* tiny artificial delay for dramatic effect */
      await new Promise((r) => setTimeout(r, 400));

      const hash = await sha256(trimmed);

      if (ACCEPTED_HASHES.has(hash)) {
        setLines((prev) => [...prev, t("secretTerminal.accessGranted")]);
        await new Promise((r) => setTimeout(r, 600));
        window.location.href = getRedirectUrl();
      } else {
        setLines((prev) => [...prev, t("secretTerminal.accessDenied")]);
      }

      setBusy(false);
    },
    [busy, t],
  );

  /* key handler */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        void handleSubmit(input);
      }
    },
    [handleSubmit, input],
  );

  return (
    <div
      className="min-h-screen bg-black text-green-400 font-mono p-6 cursor-text select-none overflow-auto"
      onClick={handleContainerClick}
    >
      {/* Boot header */}
      <div className="mb-6 text-green-600 text-xs leading-relaxed whitespace-pre">
        {t("secretTerminal.bootHeader")}
      </div>

      {/* Welcome line */}
      <p className="mb-4 text-green-500 text-sm">
        {t("secretTerminal.welcomeMessage")}
      </p>

      {/* History lines */}
      {lines.map((line, i) => (
        <p
          key={i}
          className={`text-sm whitespace-pre-wrap ${
            line === t("secretTerminal.accessDenied")
              ? "text-red-500"
              : line === t("secretTerminal.accessGranted")
                ? "text-cyan-400"
                : "text-green-400"
          }`}
        >
          {line}
        </p>
      ))}

      {/* Prompt + hidden input + blinking cursor */}
      <div className="flex items-center text-sm mt-1">
        <span className="text-green-600 mr-2">{t("secretTerminal.prompt")}</span>

        {/* Visible echo of typed characters */}
        <span className="text-green-400 whitespace-pre">{input}</span>

        {/* Blinking block cursor */}
        <span className="inline-block w-2.5 h-5 bg-green-400 animate-pulse ml-px" />

        {/* Actual input — invisible, captures keystrokes */}
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          className="absolute opacity-0 w-0 h-0"
          autoComplete="off"
          spellCheck={false}
          aria-label={t("secretTerminal.inputLabel")}
        />
      </div>
    </div>
  );
}
