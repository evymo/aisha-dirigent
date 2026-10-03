import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface TagOption {
  value: string;
  emoji?: string;
  icon?: LucideIcon;
  label: string;
  description?: string;
}

export interface TagSelectorProps {
  options: TagOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  multiSelect?: boolean;
  maxSelected?: number;
  minSelected?: number;
  disabled?: boolean;
  layout?: "grid" | "list" | "wrap";
  columns?: number;
  className?: string;
  size?: "sm" | "md" | "lg";
}

/**
 * TagSelector - Multi/single select tag grid with icon support.
 * Optimized for quick selection with clear visual feedback.
 * WCAG AA compliant with keyboard navigation.
 */
export function TagSelector({
  options,
  selected,
  onChange,
  multiSelect = false,
  maxSelected,
  minSelected = 0,
  disabled = false,
  layout = "grid",
  columns = 2,
  className,
  size = "md",
}: TagSelectorProps) {
  const handleSelect = (value: string) => {
    if (disabled) return;

    if (multiSelect) {
      if (selected.includes(value)) {
        // Deselect - check minSelected
        if (selected.length > minSelected) {
          onChange(selected.filter((v) => v !== value));
        }
      } else {
        // Select - check maxSelected
        if (!maxSelected || selected.length < maxSelected) {
          onChange([...selected, value]);
        }
      }
    } else {
      // Single select - toggle or replace
      if (selected.includes(value)) {
        if (minSelected === 0) {
          onChange([]);
        }
      } else {
        onChange([value]);
      }
    }
  };

  // Size variants
  const sizeClasses = {
    sm: "px-3 py-2 text-sm",
    md: "px-4 py-3",
    lg: "px-5 py-4 text-lg",
  };

  const iconSizes = {
    sm: "h-4 w-4",
    md: "h-5 w-5",
    lg: "h-6 w-6",
  };

  return (
    <div
      role="group"
      aria-label="Tag selection"
      className={cn(
        layout === "grid" && "grid gap-3",
        layout === "list" && "flex flex-col gap-2",
        layout === "wrap" && "flex flex-wrap gap-2",
        className
      )}
      style={layout === "grid" ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
    >
      {options.map((option) => {
        const isSelected = selected.includes(option.value);
        const isDisabledByMax = !isSelected && maxSelected !== undefined && selected.length >= maxSelected;

        return (
          <button
            key={option.value}
            type="button"
            role={multiSelect ? "checkbox" : "radio"}
            aria-checked={isSelected}
            aria-disabled={disabled || isDisabledByMax}
            disabled={disabled || isDisabledByMax}
            onClick={() => handleSelect(option.value)}
            className={cn(
              "relative rounded-xl border-2 transition-all duration-200",
              "flex items-center gap-3 text-left",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              sizeClasses[size],
              // Default state
              "border-border/50 bg-card hover:border-primary/30 hover:bg-primary/5",
              // Selected state
              isSelected && [
                "border-primary bg-primary/10 shadow-sm",
                "hover:border-primary hover:bg-primary/15",
              ],
              // Disabled state
              (disabled || isDisabledByMax) && "opacity-50 cursor-not-allowed hover:border-border/50 hover:bg-card"
            )}
          >
            {/* Icon */}
            {option.icon && (
              <option.icon className={cn(iconSizes[size], "text-muted-foreground")} aria-hidden="true" />
            )}

            {/* Label and description */}
            <div className="flex-1 min-w-0">
              <span className={cn(
                "block font-medium text-foreground",
                size === "sm" && "text-sm",
                size === "lg" && "text-base"
              )}>
                {option.label}
              </span>
              {option.description && (
                <span className={cn(
                  "block text-muted-foreground mt-0.5",
                  size === "sm" ? "text-xs" : "text-sm"
                )}>
                  {option.description}
                </span>
              )}
            </div>

            {/* Check indicator */}
            {isSelected && (
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                <Check className="w-3 h-3 text-primary-foreground" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
