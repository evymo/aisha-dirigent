import { cn } from "@/lib/utils";

export interface FeelingPreset {
  id: string;
  emoji: string;
  label: string;
  description?: string;
  values: Record<string, number>;
}

export interface FeelingPresetSelectorProps {
  presets: FeelingPreset[];
  selectedPresetId?: string;
  onChange: (preset: FeelingPreset) => void;
  disabled?: boolean;
  showLabels?: boolean;
  showDescriptions?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

/**
 * FeelingPresetSelector - Emoji-based feeling selector with 5 presets.
 * Large emoji cards for quick selection of overall state.
 * Selecting a preset sets all mapped values at once.
 */
export function FeelingPresetSelector({
  presets,
  selectedPresetId,
  onChange,
  disabled = false,
  showLabels = true,
  showDescriptions = true,
  size = "lg",
  className,
}: FeelingPresetSelectorProps) {
  const sizeClasses = {
    sm: {
      card: "p-3",
      emoji: "text-3xl",
      label: "text-xs",
      description: "text-xs",
    },
    md: {
      card: "p-4",
      emoji: "text-4xl",
      label: "text-sm",
      description: "text-xs",
    },
    lg: {
      card: "p-5 sm:p-6",
      emoji: "text-5xl sm:text-6xl",
      label: "text-base sm:text-lg",
      description: "text-sm",
    },
  };

  const classes = sizeClasses[size];

  return (
    <div
      role="radiogroup"
      aria-label="How are you feeling?"
      className={cn(
        "grid gap-3 sm:gap-4",
        // Responsive grid: 5 items = 5 cols on desktop, 3 on tablet, wrap on mobile
        presets.length === 5 && "grid-cols-2 sm:grid-cols-3 md:grid-cols-5",
        presets.length !== 5 && `grid-cols-2 sm:grid-cols-${Math.min(presets.length, 4)}`,
        className
      )}
    >
      {presets.map((preset) => {
        const isSelected = selectedPresetId === preset.id;

        return (
          <button
            key={preset.id}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-label={preset.label}
            disabled={disabled}
            onClick={() => onChange(preset)}
            className={cn(
              "relative rounded-2xl border-2 transition-all duration-300",
              "flex flex-col items-center justify-center text-center",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              classes.card,
              // Default state
              "border-border/40 bg-card/50 backdrop-blur-sm",
              "hover:border-primary/40 hover:bg-primary/5 hover:scale-105 hover:shadow-lg",
              // Selected state
              isSelected && [
                "border-primary bg-primary/10 shadow-xl scale-105",
                "ring-2 ring-primary/20",
              ],
              // Disabled state
              disabled && "opacity-50 cursor-not-allowed hover:scale-100 hover:shadow-none"
            )}
          >
            {/* Emoji */}
            <span
              className={cn(
                classes.emoji,
                "transition-transform duration-300",
                isSelected && "animate-bounce-subtle"
              )}
              aria-hidden="true"
            >
              {preset.emoji}
            </span>

            {/* Label */}
            {showLabels && (
              <span
                className={cn(
                  "font-semibold mt-2 text-foreground",
                  classes.label
                )}
              >
                {preset.label}
              </span>
            )}

            {/* Description */}
            {showDescriptions && preset.description && (
              <span
                className={cn(
                  "text-muted-foreground mt-1 line-clamp-2",
                  classes.description
                )}
              >
                {preset.description}
              </span>
            )}

            {/* Selection indicator */}
            {isSelected && (
              <span
                className="absolute -top-1 -right-1 w-4 h-4 bg-primary rounded-full flex items-center justify-center"
                aria-hidden="true"
              >
                <svg
                  className="w-2.5 h-2.5 text-primary-foreground"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={3}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// Add subtle bounce animation to index.css or use tailwind config
// For now, we'll use a simpler approach
