import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigationState } from "@/hooks/useNavigationState";

interface BackButtonProps {
  /** Fallback path if no return path or browser history available */
  fallback?: string;
  /** Custom label (defaults to i18n "common.back") */
  label?: string;
  /** Additional CSS classes */
  className?: string;
  /** Button variant */
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  /** Button size */
  size?: "default" | "sm" | "lg" | "icon";
}

/**
 * Reusable back navigation button that uses the navigation state system.
 * 
 * Behavior:
 * 1. If location.state contains a return path, navigates there
 * 2. If browser history exists, uses browser back
 * 3. Falls back to specified fallback path
 * 
 * @example
 * ```tsx
 * // Simple usage
 * <BackButton fallback="/studies" />
 * 
 * // With custom label
 * <BackButton fallback="/archive" label={t("archive.backToList")} />
 * ```
 */
export function BackButton({
  fallback = "/",
  label,
  className = "",
  variant = "ghost",
  size = "default",
}: BackButtonProps) {
  const { t } = useTranslation();
  const { goBack } = useNavigationState();

  return (
    <Button
      variant={variant}
      size={size}
      onClick={() => goBack(fallback)}
      className={`inline-flex items-center gap-2 ${className}`}
    >
      <ArrowLeft className="h-4 w-4" />
      {label || t("common.back")}
    </Button>
  );
}
