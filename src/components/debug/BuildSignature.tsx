import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useBuildInfo } from "@/hooks/useBuildInfo";

import type { BuildInfoRow } from "@/hooks/useBuildInfo";

/* ---------- sub-component ---------- */

function InfoValue({ row }: { row: BuildInfoRow }) {
  const cls = row.mono ? "font-medium font-mono" : "font-medium";

  if (row.href) {
    return (
      <div className={`truncate ${cls}`}>
        <a href={row.href} target="_blank" rel="noreferrer" className="underline underline-offset-2">
          {row.value}
        </a>
      </div>
    );
  }

  return <div className={cls}>{row.value}</div>;
}

/* ---------- main component ---------- */

/**
 * Universal build-signature panel.
 *
 * Renders a small "π" trigger that opens a tooltip with build /
 * environment metadata.  Includes a discrete "Login" link that
 * navigates to `/terminal`.
 *
 * Drop this component anywhere you need environment debug info —
 * footer, admin page, status page, etc.
 *
 * @example
 * <BuildSignature />
 * <BuildSignature className="text-muted-foreground" />
 */
export function BuildSignature({ className }: { className?: string }) {
  const { t } = useTranslation();
  const info = useBuildInfo();

  if (!info.visible) return null;

  return (
    <div className={`flex items-center justify-center gap-3 ${className ?? ""}`}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="text-[11px] text-background/80 tracking-[0.12em] text-center font-medium hover:text-background transition-colors"
              aria-label={t("footer.buildSignatureLabel")}
            >
              {t("footer.buildSignatureLabel")}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-sm">
            <div className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
              {info.rows.map((row) => (
                <div key={row.label} className="contents">
                  <div className="text-muted-foreground">{row.label}</div>
                  <InfoValue row={row} />
                </div>
              ))}
            </div>
            <div className="mt-2 pt-2 border-t border-border/40 text-center">
              <Link
                to="/terminal"
                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors tracking-widest uppercase"
              >
                {t("footer.terminalLogin")}
              </Link>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
