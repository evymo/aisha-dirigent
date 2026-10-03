import { cn } from "@/lib/utils";

export interface RatingButtonsProps {
  value: number | undefined;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  labels?: { low: string; high: string; mid?: string };
  icons?: string[];
  className?: string;
  disabled?: boolean;
}

/**
 * RatingButtons - Accessible button-based rating component
 * Optimized for quick input with clear visual feedback
 * WCAG AA compliant with keyboard navigation and screen reader support
 */
export function RatingButtons({
  value,
  onChange,
  min = 0,
  max = 10,
  labels,
  icons,
  className,
  disabled = false,
}: RatingButtonsProps) {
  const range = Array.from({ length: max - min + 1 }, (_, i) => i + min);

  return (
    <div className={cn("space-y-3", className)}>
      {/* Button Grid */}
      <div
        role="radiogroup"
        aria-label={labels ? `${labels.low} – ${labels.high}` : undefined}
        className="grid grid-cols-6 sm:grid-cols-11 gap-2"
      >
        {range.map((num) => {
          const isSelected = value === num;
          const icon = icons?.[num];
          
          return (
            <button
              key={num}
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-label={`${num}`}
              disabled={disabled}
              onClick={() => onChange(num)}
              className={cn(
                "relative h-12 sm:h-14 rounded-lg font-medium transition-all duration-200",
                "flex items-center justify-center",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                "disabled:pointer-events-none disabled:opacity-50",
                // Default state
                "bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:scale-105",
                // Selected state - organic primary color
                isSelected && [
                  "bg-primary text-primary-foreground shadow-md scale-105",
                  "hover:bg-primary/90 hover:scale-110",
                ]
              )}
            >
              {icon ? (
                <span className="text-xl sm:text-2xl" aria-hidden="true">
                  {icon}
                </span>
              ) : (
                <span className="text-base sm:text-lg font-semibold">{num}</span>
              )}
              {isSelected && (
                <span className="absolute -top-1 -right-1 w-3 h-3 bg-accent rounded-full" aria-hidden="true" />
              )}
            </button>
          );
        })}
      </div>

      {/* Labels */}
      {labels && (
        <div className="flex justify-between text-sm text-muted-foreground px-1">
          <span>{labels.low}</span>
          {labels.mid ? (
            <span>{labels.mid}</span>
          ) : value !== undefined ? (
            <span className="font-medium text-foreground">
              {value} / {max}
            </span>
          ) : null}
          <span>{labels.high}</span>
        </div>
      )}
    </div>
  );
}
