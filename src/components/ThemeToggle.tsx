import { useTranslation } from "react-i18next";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Single-click theme toggle button.
 *
 * Default follows system preference (configured in ThemeProvider).
 * Each click toggles between light and dark mode.
 * Uses `next-themes` for persistence and system preference detection.
 *
 * @example
 * <ThemeToggle />
 */
export function ThemeToggle() {
  const { t } = useTranslation();
  const { resolvedTheme, setTheme } = useTheme();

  const toggleTheme = () => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      className="rounded-full hover:bg-primary/10"
      aria-label={t("common.theme.toggle")}
      onClick={toggleTheme}
    >
      <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
    </Button>
  );
}
